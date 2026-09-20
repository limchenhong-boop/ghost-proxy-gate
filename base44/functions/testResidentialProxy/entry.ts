// Residential proxy tester — forwards a user-supplied proxy + target to the
// gateway's /test-proxy endpoint, which fetches the target through that proxy
// and returns diagnostics (egress IP, status, timing, headers, body snippet).

import { secrets } from "base44:runtime";
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.48';

export default async function(req: Request): Promise<Response> {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

    const body = await req.json().catch(() => ({}));
    const { proxy, target } = body as { proxy?: string; target?: string };
    if (!proxy || typeof proxy !== "string") {
      return Response.json({ ok: false, error: "A proxy URL is required." }, { status: 400 });
    }
    if (!target || typeof target !== "string") {
      return Response.json({ ok: false, error: "A target URL is required." }, { status: 400 });
    }

    const gatewayUrl = (secrets.get("GATEWAY_URL") || "").replace(/\/$/, "");
    const gatewayKey = secrets.get("GATEWAY_API_KEY") || "";
    if (!gatewayUrl || !gatewayKey) {
      return Response.json({ ok: false, error: "The browsing gateway is not configured." }, { status: 503 });
    }

    const response = await fetch(gatewayUrl + "/test-proxy", {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": gatewayKey },
      body: JSON.stringify({ proxy, target }),
      signal: AbortSignal.timeout(45000),
    });
    const data = await response.json();
    if (!response.ok) {
      return Response.json({ ok: false, error: data.error || "Gateway test failed." }, { status: 502 });
    }
    return Response.json(data);
  } catch (error) {
    console.error("[testResidentialProxy]", error.message);
    return Response.json({ ok: false, error: error.message || "Proxy test failed." }, { status: 500 });
  }
}