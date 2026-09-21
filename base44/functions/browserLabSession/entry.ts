// Browser-Lab session manager — proxies session create/delete/list to the
// self-hosted Browser-Lab Go server (github.com/snakecased/browser-lab), which
// runs real Chromium with WHIP/WebRTC streaming + CDP.
//
// Session management is authenticated here. The session-scoped CDP (WebSocket)
// and WHIP (WebRTC) endpoints are connected to DIRECTLY by the browser — neither
// WebSockets nor WebRTC can be proxied through a serverless function — so this
// function returns the server's base URL to authenticated callers.

import { createClientFromRequest } from 'npm:@base44/sdk@0.8.48';
import { secrets } from 'base44:runtime';

function getBaseUrl(): string {
  const url = (secrets.get("BROWSER_LAB_URL") || "").replace(/\/$/, "");
  if (!url) throw new Error("The Browser-Lab server is not configured. Set BROWSER_LAB_URL in app secrets.");
  if (!/^https?:\/\//i.test(url)) throw new Error("BROWSER_LAB_URL must start with http:// or https://");
  return url;
}

function authHeaders(): Record<string, string> {
  const key = secrets.get("BROWSER_LAB_API_KEY") || "";
  return key ? { "x-api-key": key } : {};
}

async function labRequest(path: string, init: RequestInit, timeoutMs = 20000): Promise<Response> {
  const base = getBaseUrl();
  try {
    return await fetch(base + path, {
      ...init,
      headers: { ...(init.headers as Record<string, string>), ...authHeaders() },
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    throw new Error(
      error.name === "TimeoutError" || error.name === "AbortError"
        ? "The Browser-Lab server timed out."
        : "Could not reach the Browser-Lab server."
    );
  }
}

export default async function (req: Request): Promise<Response> {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ ok: false, error: "Unauthorized" }, { status: 401 });

    const body = await req.json().catch(() => ({}));
    const action = body.action || "create";

    if (action === "config") {
      const configured = !!(secrets.get("BROWSER_LAB_URL") || "").trim();
      return Response.json({ ok: true, configured, baseUrl: configured ? getBaseUrl() : null });
    }

    if (action === "create") {
      const resp = await labRequest("/sessions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          width: Number(body.width) || 1280,
          height: Number(body.height) || 720,
          ...(body.url ? { url: String(body.url) } : {}),
        }),
      });
      const text = await resp.text();
      if (!resp.ok) {
        return Response.json({ ok: false, error: "Browser-Lab returned HTTP " + resp.status + ". " + text.slice(0, 200) });
      }
      let data: Record<string, unknown> = {};
      try { data = JSON.parse(text); } catch { /* server may return a bare id */ }
      const sessionId = data.id || data.sessionId || data.session_id || text.trim().replace(/^"|"$/g, "");
      if (!sessionId) return Response.json({ ok: false, error: "Browser-Lab did not return a session id." });
      return Response.json({ ok: true, sessionId, baseUrl: getBaseUrl(), session: data });
    }

    if (action === "delete") {
      const id = String(body.sessionId || "");
      if (!id) return Response.json({ ok: false, error: "Missing sessionId" }, { status: 400 });
      const resp = await labRequest("/sessions/" + encodeURIComponent(id), { method: "DELETE" }, 10000);
      await resp.body?.cancel();
      return Response.json({ ok: resp.ok });
    }

    if (action === "list") {
      const resp = await labRequest("/sessions", { method: "GET" }, 10000);
      if (!resp.ok) { await resp.body?.cancel(); return Response.json({ ok: false, error: "Browser-Lab returned HTTP " + resp.status }); }
      return Response.json({ ok: true, sessions: await resp.json().catch(() => []) });
    }

    return Response.json({ ok: false, error: "Unknown action" }, { status: 400 });
  } catch (error) {
    console.error("[browserLabSession]", error.message);
    return Response.json({ ok: false, error: error.message });
  }
}