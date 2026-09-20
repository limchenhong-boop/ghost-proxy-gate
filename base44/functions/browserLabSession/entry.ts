// Browser-Lab session manager — proxies session create/delete to the
// self-hosted Browser-Lab Go server (github.com/snakecased/browser-lab).
// The server runs real Chromium with WHIP/WebRTC streaming + CDP.
// Session creation/deletion is authenticated; session-specific CDP and
// WHIP endpoints are returned to the frontend for direct browser-to-server
// connections (WebRTC and WebSocket can't be proxied through serverless functions).

import { createClientFromRequest } from 'npm:@base44/sdk@0.8.48';
import { secrets } from 'base44:runtime';

function getBaseUrl() {
  const url = (secrets.get("BROWSER_LAB_URL") || "").replace(/\/$/, "");
  if (!url) throw new Error("The Browser-Lab server is not configured. Set BROWSER_LAB_URL in app secrets.");
  if (!/^https?:\/\//i.test(url)) throw new Error("BROWSER_LAB_URL must start with http:// or https://");
  return url;
}

function authHeaders() {
  const key = secrets.get("BROWSER_LAB_API_KEY") || "";
  return key ? { "x-api-key": key } : {};
}

export default async function(req: Request): Promise<Response> {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ ok: false, error: "Unauthorized" }, { status: 401 });

    const body = await req.json().catch(() => ({}));
    const baseUrl = getBaseUrl();

    if (body.action === "create") {
      const duration = Math.min(Math.max(Number(body.durationMinutes) || 30, 5), 120);
      let resp: Response;
      try {
        resp = await fetch(baseUrl + "/sessions", {
          method: "POST",
          headers: { "Content-Type": "application/json", ...authHeaders() },
          body: JSON.stringify({ duration_minutes: duration }),
          signal: AbortSignal.timeout(15000),
        });
      } catch {
        return Response.json({ ok: false, error: "Could not connect to the Browser-Lab server. Make sure it is deployed and BROWSER_LAB_URL is set correctly." }, { status: 502 });
      }
      if (!resp.ok) {
        const text = await resp.text().catch(() => "");
        return Response.json({ ok: false, error: "Browser-Lab could not create a session." + (text ? " (" + text.slice(0, 200) + ")" : "") }, { status: 502 });
      }
      const data: any = await resp.json();
      if (!data?.id || !data?.cdp_url) {
        return Response.json({ ok: false, error: "Browser-Lab returned an invalid session response." }, { status: 502 });
      }
      // Construct the WHIP endpoint URL from the CDP URL's origin (handles APP_HOST).
      const cdpOrigin = new URL(data.cdp_url).origin;
      const whipUrl = cdpOrigin + "/sessions/" + data.id + "/whip";
      return Response.json({
        ok: true,
        sessionId: data.id,
        cdpUrl: data.cdp_url,
        whipUrl,
        expiresAt: data.expires_at,
      });
    }

    if (body.action === "delete") {
      if (!body.sessionId) return Response.json({ ok: false, error: "Missing sessionId" }, { status: 400 });
      try {
        await fetch(baseUrl + "/sessions/" + body.sessionId, {
          method: "DELETE",
          headers: authHeaders(),
          signal: AbortSignal.timeout(10000),
        });
      } catch {}
      return Response.json({ ok: true });
    }

    if (body.action === "list") {
      if (user.role !== "admin") return Response.json({ ok: false, error: "Forbidden" }, { status: 403 });
      const resp = await fetch(baseUrl + "/sessions", { headers: authHeaders(), signal: AbortSignal.timeout(10000) });
      const data = await resp.json();
      return Response.json({ ok: true, sessions: data });
    }

    return Response.json({ ok: false, error: "Unknown action" }, { status: 400 });
  } catch (error) {
    return Response.json({ ok: false, error: error.message }, { status: 500 });
  }
}