// Ghost Proxy — backend fetch + rewrite.
//
// Two entry modes:
//   1. SDK invoke (POST JSON body, no ?url=): fetches the target, rewrites the
//      HTML (resource attributes -> proxy URLs), injects a client interceptor,
//      and returns the HTML as JSON. The frontend puts it into the iframe via
//      srcDoc — srcDoc documents carry NO Content-Security-Policy, so the
//      target site's scripts actually execute. (Direct GET responses from
//      functions get `script-src 'none'` injected by the platform, which would
//      blank every SPA — that's why we do NOT load the document via the URL.)
//   2. Direct browser GET (?url=...): streams resources (JS/CSS/images/fonts/API
//      JSON) through with permissive CORS + long cache. CSS is rewritten so
//      url()/@import resolve through the proxy. CSP on resource responses is
//      irrelevant (CSP is enforced on the embedding document, not on the
//      resource), so scripts/css loaded this way still work inside srcDoc.

import { secrets } from "base44:runtime";
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.48';

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";

// SSRF blocklist — reject requests to private IP ranges, localhost, and cloud
// metadata endpoints. Prevents credential theft and internal network scanning.
function isSsrfTarget(url: string): boolean {
  let parsed: URL;
  try { parsed = new URL(url); } catch { return false; }
  const host = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (host === "localhost" || host === "metadata.google.internal" || host === "metadata") return true;
  const ip = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ip) {
    const [a, b] = [parseInt(ip[1]), parseInt(ip[2])];
    if (a === 10 || a === 127 || a === 0) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 169 && b === 254) return true;
  }
  if (host === "::1" || host.startsWith("fe80:") || host.startsWith("fc") || host.startsWith("fd")) return true;
  return false;
}

function gatewayConfig() {
  const url = (secrets.get("GATEWAY_URL") || "").replace(/\/$/, "");
  const key = secrets.get("GATEWAY_API_KEY") || "";
  if (!url || !key) throw new Error("The residential gateway is not configured.");
  return { url, key };
}

async function gatewayRequest(path, options, timeoutMs) {
  const { url, key } = gatewayConfig();
  let response;
  try {
    response = await fetch(url + path, {
      ...options,
      headers: { ...options.headers, "x-api-key": key },
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    throw new Error(error.name === "TimeoutError" || error.name === "AbortError"
      ? "The residential gateway timed out. Check the Render service and its proxy connection."
      : "Could not connect to the residential gateway on Render.");
  }
  if (!response.ok && !response.headers.get("x-final-url")) {
    await response.body?.cancel();
    throw new Error("The residential gateway returned HTTP " + response.status + ". No direct connection or Google Translate fallback was used.");
  }
  return response;
}

async function fetchViaGateway(target, method, body, contentType) {
  const response = await gatewayRequest("/fetch", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ url: target, method, body, contentType }),
  }, 22000);
  const data = await response.json();
  if (!data || data.ok !== true || typeof data.body !== "string") {
    throw new Error("The residential gateway returned an invalid page response.");
  }
  return data;
}

async function fetchRawViaGateway(target, req) {
  const headers = {};
  for (const name of ["range", "content-type", "accept", "if-none-match", "if-modified-since"]) {
    const value = req.headers.get(name);
    if (value) headers[name] = value;
  }
  const method = req.method;
  return gatewayRequest("/raw?url=" + encodeURIComponent(target), {
    method, headers,
    ...(!["GET", "HEAD"].includes(method) ? { body: await req.arrayBuffer() } : {}),
  }, 60000);
}

// ---- Direct fetch from the Base44 runtime (Cloudflare Workers) ----
// Works for most sites without the residential gateway. The gateway is only
// needed for anti-bot-protected sites (Google, YouTube, TikTok, etc.), so we
// try direct first and fall back to the gateway when direct is blocked/fails.

function directHeaders(target: string): Record<string, string> {
  let origin = target;
  try { origin = new URL(target).origin + "/"; } catch {}
  return {
    "user-agent": UA,
    "accept": "text/html,application/xhtml+xml,application/xml;q=0.9,application/json;q=0.8,*/*;q=0.8",
    "accept-language": "en-US,en;q=0.9",
    "sec-ch-ua": '"Chromium";v="122", "Not(A:Brand";v="24", "Google Chrome";v="122"',
    "sec-ch-ua-mobile": "?0",
    "sec-ch-ua-platform": '"Windows"',
    "sec-fetch-dest": "document",
    "sec-fetch-mode": "navigate",
    "sec-fetch-site": "none",
    "sec-fetch-user": "?1",
    "referer": origin,
  };
}

async function fetchDirect(target: string, method: string, body?: string, contentType?: string) {
  const headers = directHeaders(target);
  if (method === "POST" && contentType) headers["content-type"] = contentType;
  const opts: any = { method, headers, redirect: "follow", signal: AbortSignal.timeout(15000) };
  if (!["GET", "HEAD"].includes(method) && body != null) opts.body = body;
  const r = await fetch(target, opts);
  const ct = r.headers.get("content-type") || "";
  const finalUrl = r.url || target;
  const buf = await r.arrayBuffer();
  const isText = /^(text\/|application\/(json|javascript|x-javascript|xml|xhtml\+xml))/i.test(ct) || !ct;
  const textBody = isText ? new TextDecoder("utf-8").decode(buf) : "";
  return { ok: true, status: r.status, contentType: ct, finalUrl, body: textBody, isText };
}

async function fetchRawDirect(target: string, req: Request) {
  let referer = target;
  try { referer = new URL(target).origin + "/"; } catch {}
  const headers: Record<string, string> = {
    "user-agent": UA,
    "accept": "*/*",
    "accept-language": "en-US,en;q=0.9",
    "referer": referer,
    "sec-fetch-dest": "empty",
    "sec-fetch-mode": "cors",
    "sec-fetch-site": "same-origin",
  };
  for (const name of ["range", "accept", "if-none-match", "if-modified-since"]) {
    const value = req.headers.get(name);
    if (value) headers[name] = value;
  }
  const method = req.method;
  const opts: any = { method, headers, redirect: "follow", signal: AbortSignal.timeout(30000) };
  if (!["GET", "HEAD"].includes(method)) opts.body = await req.arrayBuffer();
  return fetch(target, opts);
}

const BLOCK_PATTERNS = [
  /\/sorry\/index/i,          // Google anti-bot
  /captcha/i,
  /access\s*denied/i,
  /verify\s*you\s*are\s*a\s*human/i,
  /are\s*you\s*a\s*robot/i,
  /unusual\s*traffic/i,
];

function isBlockPage(html: string): boolean {
  // Only short pages can be block pages; real sites have large HTML.
  if (html.length < 4000) {
    for (const re of BLOCK_PATTERNS) if (re.test(html)) return true;
  }
  return false;
}

export default async function(req: Request): Promise<Response> {
  try {
    // Authenticate the caller — this function exposes a proxy endpoint and a
    // secret gateway URL, so only logged-in workspace members may use it.
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

    // Config endpoint: return the gateway URL so the frontend can construct
    // the Scramjet proxy iframe src. The gateway URL is a secret, so the
    // frontend can't access it directly — it goes through this function.
    const reqUrl0 = new URL(req.url);
    if (req.method === "POST" && !reqUrl0.searchParams.has("url")) {
      const body = await req.clone().json().catch(() => ({}));
      if (body.action === "config") {
        const gatewayUrl = (secrets.get("GATEWAY_URL") || "").replace(/\/$/, "");
        if (!gatewayUrl) return Response.json({ ok: false, error: "The browsing gateway is not configured." }, { status: 503 });
        const parsedGateway = new URL(gatewayUrl);
        if (parsedGateway.protocol !== "https:") return Response.json({ ok: false, error: "The browsing gateway requires HTTPS." }, { status: 503 });
        const healthResponse = await fetch(new URL("/health", parsedGateway), { signal: AbortSignal.timeout(12000) });
        if (!healthResponse.ok) return Response.json({ ok: false, error: "The browsing gateway is unavailable." }, { status: 503 });
        const health = await healthResponse.json();
        return Response.json({ ok: true, gatewayUrl, health });
      }
    }
    return await handleProxyRequest(req);
  } catch (error) {
    console.error("[proxyFetch]", error.message);
    const sdkRequest = req.method === "POST" && !new URL(req.url).searchParams.has("url");
    const message = /gateway/i.test(error.message || "") ? error.message : "The residential proxy request failed while loading the response.";
    return sdkRequest
      ? Response.json({ ok: false, error: message, transport: "residential" })
      : new Response(message, { status: 502, headers: { "content-type": "text/plain", ...corsHeaders("") } });
  }
}

async function handleProxyRequest(req: Request): Promise<Response> {
  const reqUrl = new URL(req.url);
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders("") });
  const proxyOrigin = reqUrl.origin;
  const urlParam = reqUrl.searchParams.get("url");

  const isSdk = !urlParam && req.method === "POST";

  // SDK invocations arrive through an internal dispatcher, so reqUrl.origin is
  // NOT the public app host. The frontend sends the real public origin in the
  // body; use that for the injected PROXY_ORIGIN so sub-resource fetches from
  // the srcDoc iframe resolve to a URL the user's browser can actually reach.
  let clientOrigin = proxyOrigin;
  let target = "";
  let sdkMethod = "GET";
  let sdkBody: string | undefined;
  let sdkContentType: string | undefined;
  if (urlParam) target = urlParam;
  else if (isSdk) {
    const body = await req.json().catch(() => ({}));
    target = body.url || body.target || "";
    if (body.origin && /^https?:\/\//i.test(body.origin)) clientOrigin = body.origin.replace(/\/$/, "");
    if (body.method) sdkMethod = String(body.method).toUpperCase();
    if (body.body != null) sdkBody = String(body.body);
    if (body.contentType) sdkContentType = String(body.contentType);
  }
  if (!target || typeof target !== "string") {
    return Response.json({ error: "Missing url" }, { status: 400 });
  }
  if (!/^https?:\/\//i.test(target)) target = "https://" + target;
  let parsed: URL;
  try {
    parsed = new URL(target);
  } catch {
    return Response.json({ error: "Invalid url" }, { status: 400 });
  }

  if (!["http:", "https:"].includes(parsed.protocol)) {
    return Response.json({ ok: false, error: "Only HTTP and HTTPS websites are supported." }, { status: 400 });
  }
  if (isSsrfTarget(parsed.href)) {
    return Response.json({ ok: false, error: "Requests to private networks and metadata endpoints are blocked." }, { status: 403 });
  }
  if (!["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"].includes(sdkMethod)) {
    return Response.json({ ok: false, error: "Unsupported request method." }, { status: 400 });
  }

  if (isSdk) {
    let htmlBody = "";
    let finalUrl = parsed.href;
    let contentType = "";
    let status = 0;
    let transport = "direct";
    let gotPage = false;
    let nonHtml = false;

    // 1. Try the residential gateway first — consistent residential IP egress
    //    bypasses anti-bot blocks on Google, YouTube, TikTok, etc.
    try {
      const page = await fetchViaGateway(parsed.href, sdkMethod, sdkBody, sdkContentType);
      transport = "residential";
      finalUrl = page.finalUrl || finalUrl;
      contentType = page.contentType || contentType;
      status = page.status;
      if (!/text\/html|application\/xhtml/i.test(contentType)) {
        return Response.json({ ok: true, nonHtml: true, finalUrl, contentType, status, transport });
      }
      if (page.status < 400 && !isBlockPage(page.body)) {
        htmlBody = page.body;
        gotPage = true;
      }
    } catch (e) {
      console.log("[proxyFetch] gateway fetch failed:", e.message);
    }

    // 2. Fall back to a direct fetch if the gateway is unavailable.
    if (!gotPage) {
      try {
        const direct = await fetchDirect(parsed.href, sdkMethod, sdkBody, sdkContentType);
        transport = "direct";
        contentType = direct.contentType;
        finalUrl = direct.finalUrl;
        status = direct.status;
        if (!/text\/html|application\/xhtml/i.test(contentType)) {
          return Response.json({ ok: true, nonHtml: true, finalUrl, contentType, status, transport });
        }
        if (direct.status < 400 && !isBlockPage(direct.body)) {
          htmlBody = direct.body;
          gotPage = true;
        }
      } catch (e) {
        console.log("[proxyFetch] direct fetch failed:", e.message);
      }
    }

    if (!gotPage) {
      return Response.json({ ok: false, error: "The residential gateway and direct connection both failed to load this page.", finalUrl, status, transport });
    }
    return Response.json({ ok: true, html: inject(htmlBody, finalUrl, clientOrigin), finalUrl, contentType, status, transport });
  }

  // Try direct fetch for sub-resources (fast, works for CDNs). Fall back to the
  // residential gateway on network errors AND on anti-bot block responses
  // (403/429/503) so same-origin resources on protected sites load fully.
  let resp: Response;
  const reqForGateway = req.clone();
  try {
    resp = await fetchRawDirect(parsed.href, req);
    if ([403, 429, 503].includes(resp.status)) {
      try { resp.body?.cancel(); } catch {}
      try {
        const gwResp = await fetchRawViaGateway(parsed.href, reqForGateway);
        if (gwResp.status < 500) resp = gwResp;
      } catch (e2) {
        console.log("[proxyFetch] gateway fallback for blocked resource failed:", e2.message);
      }
    }
  } catch (e) {
    console.log("[proxyFetch] raw direct failed, trying gateway:", e.message);
    try {
      resp = await fetchRawViaGateway(parsed.href, reqForGateway);
    } catch (e2) {
      return new Response("Sub-resource could not be loaded: " + e2.message, { status: 502, headers: { "content-type": "text/plain", ...corsHeaders(proxyOrigin) } });
    }
  }
  const contentType = resp.headers.get("content-type") || "";
  const finalUrl = resp.headers.get("x-final-url") || resp.url || parsed.href;
  const isHtml = contentType.includes("text/html") || contentType.includes("application/xhtml");
  const isCss = contentType.includes("text/css");
  // The public origin the browser used to reach us — passed explicitly by the
  // client as `o` (reqUrl.origin is the internal dispatcher, NOT the public
  // host, so it can't be used to build reachable proxy URLs).
  const oParam = reqUrl.searchParams.get("o");
  const pubOrigin = (oParam && /^https?:\/\//i.test(oParam)) ? oParam.replace(/\/$/, "") : proxyOrigin;
  console.log("[proxyFetch]", parsed.href, "->", resp.status, contentType, "html=" + isHtml, "css=" + isCss, "final=" + finalUrl, "pubOrigin=" + pubOrigin);

  if (isHtml) {
    // Document loaded directly (nested iframe). The platform injects script-src
    // 'none' here, so nested-iframe scripts won't run — a known limitation.
    let html = await resp.text();
    html = inject(html, finalUrl, pubOrigin);
    return new Response(html, {
      status: 200,
      headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "referrer-policy": "no-referrer", ...corsHeaders(pubOrigin) },
    });
  }

  if (isCss) {
    // Rewrite url()/@import so CSS assets resolve through the proxy (against the
    // stylesheet's own URL, NOT the Base44 app URL). Use the public origin from
    // the `o` param so the generated URLs are reachable.
    let css = await resp.text();
    css = rewriteCss(css, finalUrl, pubOrigin);
    return new Response(css, {
      status: resp.status,
      headers: { "content-type": contentType, "cache-control": "public, max-age=31536000, immutable", "referrer-policy": "no-referrer", ...corsHeaders(proxyOrigin) },
    });
  }

  const baseHeaders: Record<string, string> = {
    "content-type": contentType || "application/octet-stream",
    "referrer-policy": "no-referrer",
    ...corsHeaders(proxyOrigin),
  };
  const cl = resp.headers.get("content-length"); if (cl) baseHeaders["content-length"] = cl;
  const cr = resp.headers.get("content-range"); if (cr) baseHeaders["content-range"] = cr;
  const ar = resp.headers.get("accept-ranges"); if (ar) baseHeaders["accept-ranges"] = ar;
  const isStaticAsset = /^(text\/css|application\/javascript|text\/javascript|application\/x-javascript|image\/|font\/|application\/font|audio\/|video\/)/.test(contentType);
  baseHeaders["cache-control"] = isStaticAsset ? "public, max-age=31536000, immutable" : "no-store";
  return new Response(resp.body, { status: resp.status, headers: baseHeaders });
}

function corsHeaders(_origin: string): Record<string, string> {
  return {
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
    "access-control-allow-headers": "*",
    "access-control-expose-headers": "*",
  };
}

// ---------------------------------------------------------------------------
// HTML rewriting
// ---------------------------------------------------------------------------

function inject(html: string, finalUrl: string, origin: string): string {
  const body = rewriteHtml(html, finalUrl, origin);
  const boot = '<base href="' + finalUrl + '"><script>' + clientScript(origin, finalUrl) + "</script>";
  if (/<head[^>]*>/i.test(body)) return body.replace(/<head[^>]*>/i, (m) => m + boot);
  if (/<html[^>]*>/i.test(body)) return body.replace(/<html[^>]*>/i, (m) => m + boot);
  return boot + body;
}

function makeProxy(origin: string, base: string) {
  const P = origin + "/functions/proxyFetch?url=";
  const o = "&o=" + encodeURIComponent(origin);
  return (u: string) => {
    if (!u) return u;
    const s = String(u).trim();
    if (!s) return u;
    if (/^(data:|blob:|javascript:|mailto:|tel:|#)/i.test(s)) return u;
    if (s.indexOf(P) === 0) return u;
    try { return P + encodeURIComponent(new URL(s, base).href) + o; } catch { return u; }
  };
}

// Documents and resource requests must use the same residential transport.
function makeResProxy(origin: string, base: string) {
  return makeProxy(origin, base);
}

function rewriteHtml(html: string, finalUrl: string, origin: string): string {
  const resProxy = makeResProxy(origin, finalUrl);
  const navProxy = makeProxy(origin, finalUrl);
  // Strip upstream CSP meta tags — they could block the proxied document's
  // scripts (which are now same-origin with the srcDoc via the proxy).
  html = html.replace(/<meta\b[^>]*?http-equiv\s*=\s*["']?Content-Security-Policy[^>]*?>/gi, "");
  // Split out <script>/<style> contents so we never rewrite inside them.
  const re = /(<script\b[\s\S]*?<\/script>|<style\b[\s\S]*?<\/style>)/gi;
  let out = "", last = 0, m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    out += rewriteAttrs(html.slice(last, m.index), resProxy, navProxy);
    const tag = m[0];
    const openingEnd = tag.indexOf(">") + 1;
    if (/^<script\b/i.test(tag)) {
      // Rewrite the script tag's src, without corrupting its JavaScript body.
      out += rewriteAttrs(tag.slice(0, openingEnd), resProxy, navProxy) + tag.slice(openingEnd);
    } else {
      const closingStart = tag.toLowerCase().lastIndexOf("</style");
      out += tag.slice(0, openingEnd) + rewriteCss(tag.slice(openingEnd, closingStart), finalUrl, origin) + tag.slice(closingStart);
    }
    last = m.index + m[0].length;
  }
  out += rewriteAttrs(html.slice(last), resProxy, navProxy);
  return out;
}

function rewriteAttrs(chunk: string, res: (u: string) => string, nav: (u: string) => string): string {
  // Remove SRI integrity attributes — proxied CSS is rewritten, so hashes would
  // mismatch and block the resource. (Proxied JS is byte-identical, but removing
  // integrity uniformly is simpler and safe.)
  chunk = chunk.replace(/\s+integrity\s*=\s*(?:"[^"]*"|'[^']*')/gi, "");

  // srcset / imagesrcset: "url 1x, url 2x"
  chunk = chunk.replace(/(\s(?:srcset|imagesrcset))\s*=\s*("([^"]*)"|'([^']*)')/gi, (full, attr, q, dq, sq) => {
    const v = dq !== undefined ? dq : sq;
    const list = v.split(",").map((c: string) => {
      const t = c.trim();
      if (!t) return t;
      const sp = t.indexOf(" ");
      const u = sp === -1 ? t : t.slice(0, sp);
      const d = sp === -1 ? "" : t.slice(sp);
      return res(u) + d;
    }).join(", ");
    return attr + "=" + q.charAt(0) + list + q.charAt(0);
  });

  // <link href> (resources — stylesheets, preloads, icons). NOT <a href>.
  chunk = chunk.replace(/(<link\b[^>]*?\shref\s*=\s*)("([^"]*)"|'([^']*)')/gi, (full, pre, q, dq, sq) => {
    const v = dq !== undefined ? dq : sq;
    return pre + q.charAt(0) + res(v) + q.charAt(0);
  });

  // src / data / poster / manifest / background (resources, not navigation)
  chunk = chunk.replace(/(\s(?:src|data|poster|manifest|background)\s*=\s*)("([^"]*)"|'([^']*)')/gi, (full, pre, q, dq, sq) => {
    const v = dq !== undefined ? dq : sq;
    return pre + q.charAt(0) + res(v) + q.charAt(0);
  });

  // <meta http-equiv="refresh" content="3; url=..."> -> rewrite the url (navigation)
  chunk = chunk.replace(/(<meta\b[^>]*?http-equiv\s*=\s*["']?refresh["']?[^>]*?content\s*=\s*)("([^"]*)"|'([^']*)')/gi, (full, pre, q, dq, sq) => {
    const v = dq !== undefined ? dq : sq;
    const rewritten = v.replace(/^(\s*\d+\s*;\s*url\s*=\s*)(.*)$/i, (_mm: string, pfx: string, u: string) => pfx + nav(u));
    return pre + q.charAt(0) + rewritten + q.charAt(0);
  });

  return chunk;
}

function rewriteCss(css: string, cssUrl: string, origin: string): string {
  const res = makeResProxy(origin, cssUrl);
  return css
    // url(...)
    .replace(/url\(\s*(?:"([^"]*)"|'([^']*)'|([^)]*))\s*\)/gi, (m, dq, sq, bare) => {
      const u = dq !== undefined ? dq : sq !== undefined ? sq : bare;
      return "url(" + res(u) + ")";
    })
    // @import "..." / @import '...' (the @import url(...) form is handled above)
    .replace(/@import\s+("([^"]*)"|'([^']*)')/gi, (m, dq, sq) => {
      const u = dq !== undefined ? dq : sq;
      const p = res(u).replace(/"/g, "");
      return '@import "' + p + '"';
    });
}

// ---------------------------------------------------------------------------
// Client interceptor — runs first inside the srcDoc document
// ---------------------------------------------------------------------------

function clientScript(origin: string, finalUrl: string): string {
  let path = "/";
  try { const u = new URL(finalUrl); path = u.pathname + u.search + u.hash; } catch {}
  return `
var PROXY_ORIGIN=${JSON.stringify(origin)};
var P=PROXY_ORIGIN+'/functions/proxyFetch?url=';
var VP_PATH=${JSON.stringify(path)};
var OR0=history.replaceState;
function rp(u){if(!u)return u;if(typeof u!=='string')u=String(u);if(u.indexOf(P)===0)return u;if(/^(data:|blob:|javascript:|mailto:|tel:|#)/.test(u))return u;try{var abs=new URL(u,document.baseURI).href;return P+encodeURIComponent(abs)+'&o='+encodeURIComponent(PROXY_ORIGIN)}catch(e){return u}}
function sendMsg(o){try{parent.postMessage(o,PROXY_ORIGIN)}catch(e){}}
function navTo(u){sendMsg({__vp:1,url:u})}
var of=window.fetch;if(of)window.fetch=function(input,init){try{if(typeof input==='string')input=rp(input);else if(input&&input.url)input=new Request(rp(input.url),input)}catch(e){}return of.call(this,input,init)};
var X=window.XMLHttpRequest;if(X){var ox=X.prototype.open;X.prototype.open=function(m,u){try{arguments[1]=rp(u)}catch(e){}return ox.apply(this,arguments)}}
var sb=navigator.sendBeacon&&navigator.sendBeacon.bind(navigator);if(sb)navigator.sendBeacon=function(u,d){try{u=rp(u)}catch(e){}return sb(u,d)};
var OE=window.EventSource;if(OE)window.EventSource=function(u,c){try{u=rp(u)}catch(e){}return new OE(u,c)};
var STATIC_EXT=/\.(js|mjs|css|png|jpe?g|gif|webp|avif|svg|ico|woff2?|ttf|eot|otf|mp4|webm|m3u8|m4s|ts|mp3|wav|ogg|pdf)(?:[?#]|$)/i;
var CDN_HOSTS=/(googleapis|gstatic|googlevideo|ytimg|ggpht|tiktokcdn|akamaized|akamaihd|cloudfront|fastly|jsdelivr|unpkg|cdnjs|fbcdn|edgecast|cdn\.|\.cdn)/i;
function isStatic(u){try{var x=new URL(u,document.baseURI);var ph=new URL(document.baseURI).host;if(x.host===ph)return false;return STATIC_EXT.test(x.pathname)||CDN_HOSTS.test(x.host)}catch(e){return false}}
function rr(u){return rp(u)}
function hookEl(cn,prop,fn){var c=window[cn];if(!c||!c.prototype)return;var d=Object.getOwnPropertyDescriptor(c.prototype,prop);if(d&&d.set){var os=d.set;Object.defineProperty(c.prototype,prop,{configurable:true,enumerable:d.enumerable||true,get:d.get,set:function(v){try{v=(fn||rp)(v)}catch(e){}return os.call(this,v)}})}}
hookEl('HTMLImageElement','src',rr);hookEl('HTMLScriptElement','src',rr);hookEl('HTMLLinkElement','href',rr);hookEl('HTMLSourceElement','src',rr);hookEl('HTMLMediaElement','src',rr);hookEl('HTMLIFrameElement','src');
try{var OL=Location.prototype;['assign','replace'].forEach(function(m){OL[m]=function(u){try{var abs=new URL(u,document.baseURI).href;navTo(abs)}catch(e){navTo(u)}}});var hd=Object.getOwnPropertyDescriptor(OL,'href');if(hd&&hd.get&&hd.set){Object.defineProperty(OL,'href',{configurable:true,enumerable:true,get:function(){return hd.get.call(this)},set:function(u){try{var abs=new URL(u,document.baseURI).href;navTo(abs)}catch(e){navTo(u)}}})}}catch(e){}
try{var OP=history.pushState,OR=history.replaceState;history.pushState=function(s,t,u){try{if(u){var abs=new URL(u,document.baseURI).href;sendMsg({__vp:1,url:abs,soft:1})}}catch(e){}try{return OP.apply(this,arguments)}catch(e){}};history.replaceState=function(s,t,u){try{if(u){var abs=new URL(u,document.baseURI).href;sendMsg({__vp:1,url:abs,soft:1,replace:1})}}catch(e){}try{return OR.apply(this,arguments)}catch(e){}};window.addEventListener('popstate',function(){try{sendMsg({__vp:1,url:document.baseURI,soft:1,pop:1})}catch(e){}})}catch(e){}
var oo=window.open;window.open=function(u){try{if(u){var abs=new URL(u,document.baseURI).href;navTo(abs);return null}}catch(e){}return oo?oo.apply(this,arguments):null};
document.addEventListener('click',function(e){var t=e.target;var a=t&&t.closest&&t.closest('a[href]');if(!a)return;var h=a.getAttribute('href');if(!h||h.indexOf('javascript:')===0||h.charAt(0)==='#')return;e.preventDefault();try{var abs=new URL(h,document.baseURI).href;navTo(abs)}catch(err){navTo(h)}},true);
document.addEventListener('submit',function(e){var f=e.target;if(!f||f.tagName!=='FORM')return;e.preventDefault();try{var act=f.getAttribute('action')||'';var abs=act?new URL(act,document.baseURI).href:document.baseURI;var method=(f.getAttribute('method')||'GET').toUpperCase();var fd=new FormData(f);if(method==='GET'){var q=new URLSearchParams(fd).toString();navTo(abs+(abs.indexOf('?')>=0?'&':'?')+q)}else{var pairs=[];fd.forEach(function(v,k){pairs.push([k,v==null?'':String(v)])});sendMsg({__vp:1,formSubmit:{url:abs,method:method,data:pairs}})}}catch(err){}},true);
try{OR0.call(history,null,'',VP_PATH)}catch(e){}
`;
}