// Browserbase session manager — creates a cloud browser session, navigates it
// to the target URL via CDP, and returns the live-view (debugger) URL for
// embedding in an iframe. Also supports releasing sessions on cleanup.

import { secrets } from "base44:runtime";
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.48';

const BB_API = "https://api.browserbase.com/v1";

export default async function(req: Request): Promise<Response> {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

    const body = await req.json().catch(() => ({}));
    const action = body.action || "create";

    const apiKey = secrets.get("BROWSERBASE_API_KEY") || "";
    if (!apiKey) return Response.json({ ok: false, error: "Browserbase API key is not configured." }, { status: 503 });

    if (action === "release") {
      return releaseSession(apiKey, body.sessionId);
    }

    // action === "create"
    let target = String(body.url || body.target || "").trim();
    if (!target) return Response.json({ ok: false, error: "A target URL is required." }, { status: 400 });
    if (!/^https?:\/\//i.test(target)) target = "https://" + target;
    try { new URL(target); } catch { return Response.json({ ok: false, error: "Invalid URL." }, { status: 400 }); }

    // Resolve project ID (explicit secret, or auto-discover first project)
    const projectId = secrets.get("BROWSERBASE_PROJECT_ID") || await resolveProjectId(apiKey);
    if (!projectId) return Response.json({ ok: false, error: "No Browserbase project found. Set the BROWSERBASE_PROJECT_ID secret." }, { status: 503 });

    // Create session with stealth + ad-blocking enabled
    const sessionRes = await fetch(`${BB_API}/sessions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-BB-API-Key": apiKey },
      body: JSON.stringify({
        projectId,
        keepAlive: true,
        browserSettings: { advancedStealth: true, blockAds: true },
      }),
      signal: AbortSignal.timeout(15000),
    });
    const session = await sessionRes.json();
    if (!sessionRes.ok || !session.id) {
      throw new Error(session.message || session.error || `Failed to create session (${sessionRes.status})`);
    }

    // Navigate the session to the target URL via CDP over WebSocket
    let navError: string | null = null;
    try {
      await navigateViaCdp(session.connectUrl, target);
    } catch (e) {
      navError = e.message;
      console.error("[createBrowserSession] CDP navigation failed:", e.message);
    }

    // Get the live-view (debugger) URL for iframe embedding
    const debugRes = await fetch(`${BB_API}/sessions/${session.id}/debug`, {
      headers: { "X-BB-API-Key": apiKey },
      signal: AbortSignal.timeout(10000),
    });
    const debug = await debugRes.json();
    if (!debugRes.ok || !debug.debuggerFullscreenUrl) {
      throw new Error(debug.message || `Failed to get live-view URL (${debugRes.status})`);
    }

    return Response.json({
      ok: true,
      sessionId: session.id,
      debugUrl: debug.debuggerFullscreenUrl,
      navError,
    });
  } catch (error) {
    console.error("[createBrowserSession]", error.message);
    return Response.json({ ok: false, error: error.message || "Failed to create browser session." }, { status: 500 });
  }
}

async function resolveProjectId(apiKey: string): Promise<string | null> {
  try {
    const res = await fetch(`${BB_API}/projects`, {
      headers: { "X-BB-API-Key": apiKey },
      signal: AbortSignal.timeout(10000),
    });
    const data = await res.json();
    if (!res.ok || !Array.isArray(data) || data.length === 0) return null;
    return data[0].id;
  } catch { return null; }
}

async function releaseSession(apiKey: string, sessionId: string): Promise<Response> {
  if (!sessionId) return Response.json({ ok: false, error: "sessionId is required." }, { status: 400 });
  const res = await fetch(`${BB_API}/sessions/${sessionId}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-BB-API-Key": apiKey },
    body: JSON.stringify({ status: "REQUEST_RELEASE" }),
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    return Response.json({ ok: false, error: data.message || "Failed to release session." }, { status: 502 });
  }
  return Response.json({ ok: true });
}

// ---- Minimal CDP client over raw WebSocket ----
// Connects to the browser-level CDP endpoint, attaches to the page target,
// enables the Page domain, and navigates to the target URL. Waits for the
// frame to stop loading before resolving.
async function navigateViaCdp(connectUrl: string, targetUrl: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(connectUrl);
    let msgId = 0;
    const pending = new Map<number, (data: any) => void>();
    let pageSessionId: string | null = null;
    let settled = false;

    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      try { ws.close(); } catch {}
      reject(new Error("CDP navigation timed out"));
    }, 20000);

    const finish = (err?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      try { ws.close(); } catch {}
      if (err) reject(err); else resolve();
    };

    ws.onerror = () => finish(new Error("CDP connection failed"));

    ws.onmessage = (event) => {
      let msg;
      try {
        const text = typeof event.data === "string" ? event.data : "";
        msg = JSON.parse(text);
      } catch { return; }
      if (!msg) return;

      if (msg.id && pending.has(msg.id)) {
        const cb = pending.get(msg.id)!;
        pending.delete(msg.id);
        cb(msg);
      }
      if (msg.method === "Target.attachedToTarget" && msg.params?.targetInfo?.type === "page" && !pageSessionId) {
        pageSessionId = msg.params.sessionId;
      }
      if (msg.method === "Page.frameStoppedLoading" && pageSessionId && msg.sessionId === pageSessionId) {
        setTimeout(() => finish(), 800);
      }
    };

    const send = (method: string, params: any = {}, sessionId?: string): Promise<any> => {
      return new Promise((resolveSend, rejectSend) => {
        const id = ++msgId;
        const msg: any = { id, method, params };
        if (sessionId) msg.sessionId = sessionId;
        pending.set(id, (data) => {
          if (data.error) rejectSend(new Error(data.error.message || "CDP error"));
          else resolveSend(data);
        });
        ws.send(JSON.stringify(msg));
      });
    };

    ws.onopen = async () => {
      try {
        const targetsResp = await send("Target.getTargets");
        const pageTarget = targetsResp.result.targetInfos?.find((t: any) => t.type === "page");
        if (!pageTarget) throw new Error("No page target found");

        const attachResp = await send("Target.attachToTarget", { targetId: pageTarget.targetId, flatten: true });
        pageSessionId = attachResp.result.sessionId;

        await send("Page.enable", {}, pageSessionId);
        await send("Page.navigate", { url: targetUrl }, pageSessionId);

        // Fallback: resolve after 12s even if frameStoppedLoading never fires
        setTimeout(() => finish(), 12000);
      } catch (e) {
        finish(e);
      }
    };
  });
}