// Ghost Proxy — Cloudflare Worker gateway
//
// Drop-in replacement for the Render Node gateway. Matches the exact contract
// the Base44 `proxyFetch` function expects, so NO frontend or function change
// is needed — just set GATEWAY_URL to your Worker URL and GATEWAY_API_KEY to
// the matching secret.
//
// Endpoints (all require x-api-key header = GATEWAY_API_KEY env var):
//   POST /fetch   { url, method, body, contentType } -> { ok, body, finalUrl, contentType, status }
//   GET  /raw?url=...                                 -> raw resource stream (CORS + x-final-url)
//   GET  /health                                      -> { ok, build, transport }
//
// IMPORTANT limitation vs the Render gateway:
//   Cloudflare Workers fetch from Cloudflare's edge IPs — they CANNOT route
//   through a residential proxy (no raw TCP / CONNECT support). Basic sites
//   work; anti-bot sites (TikTok, etc.) that block datacenter IPs will fail
//   and need the existing "Open directly" fallback. This is the tradeoff for
//   free, always-on hosting without Render.

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";

function corsHeaders() {
  return {
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
    "access-control-allow-headers": "*",
    "access-control-expose-headers": "*",
  };
}

// Basic SSRF guard — block obvious private/internal hostnames. Workers can't
// do synchronous DNS resolution, so this is a string-level check (the platform
// also blocks RFC1918 egress by default on free plans).
function isBlockedHost(hostname) {
  const h = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (h === "localhost" || h === "metadata.google.internal" || h === "metadata") return true;
  const ip = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ip) {
    const a = parseInt(ip[1]), b = parseInt(ip[2]);
    if (a === 10 || a === 127 || a === 0) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 169 && b === 254) return true;
  }
  if (h === "::1" || h.startsWith("fe80:") || h.startsWith("fc") || h.startsWith("fd")) return true;
  return false;
}

function json(data, status = 200, extra = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json", ...corsHeaders(), ...extra },
  });
}

export default {
  async fetch(request, env) {
    const reqUrl = new URL(request.url);

    // Auth — every endpoint requires the shared key (except CORS preflight).
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders() });
    }
    const expectedKey = env.GATEWAY_API_KEY;
    if (expectedKey) {
      const sent = request.headers.get("x-api-key");
      if (sent !== expectedKey) return json({ ok: false, error: "Unauthorized" }, 401);
    }

    // ---- /health ----
    if (reqUrl.pathname === "/health") {
      return json({ ok: true, build: "cf-worker-v1", transport: "cloudflare", directFallback: false, residentialEndpoints: 0 });
    }

    // ---- /fetch (page fetch, returns JSON with HTML body) ----
    if (reqUrl.pathname === "/fetch" && request.method === "POST") {
      let body;
      try { body = await request.json(); } catch { return json({ ok: false, error: "Invalid JSON body" }, 400); }
      const target = body.url || body.target;
      const method = (body.method || "GET").toUpperCase();
      if (!target) return json({ ok: false, error: "Missing url" }, 400);
      let parsed;
      try { parsed = new URL(target); } catch { return json({ ok: false, error: "Invalid url" }, 400); }
      if (!["http:", "https:"].includes(parsed.protocol)) return json({ ok: false, error: "Only HTTP(S) supported" }, 400);
      if (isBlockedHost(parsed.hostname)) return json({ ok: false, error: "Blocked host" }, 403);

      const headers = {
        "user-agent": UA,
        "accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "accept-language": "en-US,en;q=0.9",
      };
      if (body.contentType) headers["content-type"] = body.contentType;
      const init = { method, headers, redirect: "follow" };
      if (!["GET", "HEAD"].includes(method) && body.body != null) init.body = body.body;

      try {
        const resp = await fetch(parsed.href, init);
        const contentType = resp.headers.get("content-type") || "";
        const finalUrl = resp.url || parsed.href;
        const text = await resp.text();
        return json({ ok: true, body: text, finalUrl, contentType, status: resp.status });
      } catch (e) {
        return json({ ok: false, error: "Worker fetch failed: " + (e.message || String(e)) }, 502);
      }
    }

    // ---- /raw (resource stream) ----
    if (reqUrl.pathname === "/raw") {
      const target = reqUrl.searchParams.get("url");
      if (!target) return json({ ok: false, error: "Missing url" }, 400);
      let parsed;
      try { parsed = new URL(target); } catch { return json({ ok: false, error: "Invalid url" }, 400); }
      if (!["http:", "https:"].includes(parsed.protocol)) return json({ ok: false, error: "Only HTTP(S) supported" }, 400);
      if (isBlockedHost(parsed.hostname)) return json({ ok: false, error: "Blocked host" }, 403);

      const headers = { "user-agent": UA };
      for (const h of ["range", "content-type", "accept", "if-none-match", "if-modified-since"]) {
        const v = request.headers.get(h);
        if (v) headers[h] = v;
      }
      const init = { method: request.method, headers, redirect: "follow" };
      if (!["GET", "HEAD"].includes(request.method)) init.body = request.body;

      try {
        const resp = await fetch(parsed.href, init);
        const outHeaders = corsHeaders();
        const ct = resp.headers.get("content-type"); if (ct) outHeaders["content-type"] = ct;
        const cl = resp.headers.get("content-length"); if (cl) outHeaders["content-length"] = cl;
        const cr = resp.headers.get("content-range"); if (cr) outHeaders["content-range"] = cr;
        const ar = resp.headers.get("accept-ranges"); if (ar) outHeaders["accept-ranges"] = ar;
        outHeaders["x-final-url"] = resp.url || parsed.href;
        outHeaders["cache-control"] = "no-store";
        return new Response(resp.body, { status: resp.status, headers: outHeaders });
      } catch (e) {
        return new Response("Worker fetch failed: " + (e.message || String(e)), { status: 502, headers: { "content-type": "text/plain", ...corsHeaders() } });
      }
    }

    return json({ ok: false, error: "Not found" }, 404);
  },
};