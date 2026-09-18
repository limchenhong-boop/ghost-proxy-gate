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

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";

const GATEWAY_URL = (secrets.get("GATEWAY_URL") || "").replace(/\/$/, "");
const GATEWAY_API_KEY = secrets.get("GATEWAY_API_KEY") || "";

// Fetch a target HTML document through the residential-proxy gateway. The
// gateway host tunnels via undici's ProxyAgent (Base44's runtime can't tunnel),
// so the site sees a residential IP instead of a datacenter worker IP — this
// is what gets past the anti-bot blocks that blank out YouTube/TikTok/etc.
// Returns null if the gateway isn't configured or the call fails (caller
// falls back to a direct fetch).
async function fetchViaGateway(target: string): Promise<{ status: number; contentType: string; finalUrl: string; body: string } | null> {
  if (!GATEWAY_URL || !GATEWAY_API_KEY) return null;
  try {
    const r = await fetch(GATEWAY_URL + "/fetch", {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": GATEWAY_API_KEY },
      body: JSON.stringify({ url: target }),
    });
    if (!r.ok) { console.log("[proxyFetch] gateway non-ok", r.status); return null; }
    const j: any = await r.json();
    if (!j || j.ok !== true) { console.log("[proxyFetch] gateway err", j); return null; }
    return { status: j.status, contentType: j.contentType || "", finalUrl: j.finalUrl || target, body: j.body || "" };
  } catch (e: any) {
    console.log("[proxyFetch] gateway fetch failed", e.message);
    return null;
  }
}

// Stream a same-origin sub-resource (JS/CSS/image/API GET) through the gateway's
// /raw endpoint so it egresses from the residential IP too. Without this, the
// main document arrives via the residential proxy but its same-origin resources
// are fetched from the Base44 worker's datacenter IP — sites detect the mismatch
// and block them, leaving the page blank.
async function fetchRawViaGateway(target: string, req: Request): Promise<Response | null> {
  if (!GATEWAY_URL || !GATEWAY_API_KEY) return null;
  try {
    const u = new URL(GATEWAY_URL + "/raw");
    u.searchParams.set("url", target);
    const gh: Record<string, string> = { "x-api-key": GATEWAY_API_KEY };
    const range = req.headers.get("range");
    if (range) gh["range"] = range;
    const r = await fetch(u.href, { method: "GET", headers: gh, redirect: "follow" });
    if (!r.ok) { console.log("[proxyFetch] gateway /raw non-ok", r.status); return null; }
    return r;
  } catch (e: any) {
    console.log("[proxyFetch] gateway /raw failed", e.message);
    return null;
  }
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
  const reqUrl = new URL(req.url);
  const proxyOrigin = reqUrl.origin;
  const urlParam = reqUrl.searchParams.get("url");

  // Debug: inspect request headers to find the real public origin (the
  // internal dispatcher rewrites req.url, so reqUrl.origin is wrong).
  if (reqUrl.searchParams.get("__vp_debug") === "1") {
    const hdrs: Record<string, string> = {};
    for (const [k, v] of req.headers.entries()) hdrs[k] = v;
    return Response.json({
      reqUrl: req.url, origin: reqUrl.origin, host: req.headers.get("host"),
      xfh: req.headers.get("x-forwarded-host"), xfp: req.headers.get("x-forwarded-proto"),
      forwarded: req.headers.get("forwarded"), all: hdrs,
    });
  }

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

  const headers: Record<string, string> = {
    "user-agent": UA,
    accept:
      "text/html,application/xhtml+xml,application/xml;q=0.9,application/json;q=0.8,*/*;q=0.8",
    "accept-language": "en-US,en;q=0.9",
    "cache-control": "max-age=0",
    "upgrade-insecure-requests": "1",
    "sec-ch-ua": '"Chromium";v="122", "Not(A:Brand";v="24", "Google Chrome";v="122"',
    "sec-ch-ua-mobile": "?0",
    "sec-ch-ua-platform": '"Windows"',
    "sec-fetch-dest": "document",
    "sec-fetch-mode": "navigate",
    "sec-fetch-site": "none",
    "sec-fetch-user": "?1",
    referer: parsed.origin + "/",
  };
  const method = isSdk ? sdkMethod : req.method || "GET";
  if (!isSdk && method !== "GET") {
    // Forward non-GET headers from the browser request (proxied fetch/XHR).
    const skip = new Set([
      "host", "connection", "content-length", "accept-encoding", "transfer-encoding",
      "upgrade", "origin", "referer", "cookie", "authorization",
    ]);
    for (const [k, v] of req.headers.entries()) {
      const lk = k.toLowerCase();
      if (skip.has(lk) || lk.startsWith("x-") || lk.startsWith("cf-") || lk.startsWith("cdn-") || lk === "via" || lk === "true-client-ip") continue;
      headers[lk] = v;
    }
  }
  if (isSdk && sdkMethod !== "GET" && sdkBody !== undefined) {
    headers["content-type"] = sdkContentType || "application/x-www-form-urlencoded";
  }
  const fetchOpts: any = { method, headers, redirect: "follow" };
  if (!["GET", "HEAD"].includes(method)) {
    fetchOpts.body = isSdk ? sdkBody : await req.arrayBuffer();
  }

  let resp: Response;
  let gwHtml: string | null = null;
  let gwFinalUrl = "";
  let gwContentType = "";
  let gwStatus = 0;
  if (isSdk) {
    const g = await fetchViaGateway(parsed.href);
    if (g && g.body && /text\/html|application\/xhtml/i.test(g.contentType)) {
      gwHtml = g.body;
      gwFinalUrl = g.finalUrl;
      gwContentType = g.contentType;
      gwStatus = g.status;
    }
  }
  if (gwHtml === null) {
    let gwResp: Response | null = null;
    if (!isSdk && method === "GET") gwResp = await fetchRawViaGateway(parsed.href, req);
    if (gwResp) {
      resp = gwResp;
      console.log("[proxyFetch] using gateway /raw for", parsed.href);
    } else {
      try {
        resp = await fetch(parsed.href, fetchOpts);
      } catch (e: any) {
        console.log("[proxyFetch] network error", parsed.href, e.message);
        if (isSdk) return Response.json({ ok: false, blocked: true, error: e.message || "Network error", finalUrl: parsed.href });
        return new Response("Proxy fetch failed: " + (e.message || ""), { status: 502, headers: { "content-type": "text/plain" } });
      }
    }
  }

  // Gateway returned the HTML document — short-circuit. The residential egress
  // avoids the anti-bot block pages a direct worker fetch would hit.
  if (gwHtml !== null) {
    if (isBlockPage(gwHtml)) {
      console.log("[proxyFetch] block page detected (gateway)", gwFinalUrl);
      return Response.json({ ok: false, blocked: true, error: "Site served an anti-bot or block page", finalUrl: gwFinalUrl, status: gwStatus });
    }
    const html = inject(gwHtml, gwFinalUrl, clientOrigin);
    return Response.json({ ok: true, html, finalUrl: gwFinalUrl, contentType: gwContentType, status: gwStatus });
  }

  const contentType = resp.headers.get("content-type") || "";
  const finalUrl = resp.url || parsed.href;
  const isHtml = contentType.includes("text/html") || contentType.includes("application/xhtml");
  const isCss = contentType.includes("text/css");
  // The public origin the browser used to reach us — passed explicitly by the
  // client as `o` (reqUrl.origin is the internal dispatcher, NOT the public
  // host, so it can't be used to build reachable proxy URLs).
  const oParam = reqUrl.searchParams.get("o");
  const pubOrigin = (oParam && /^https?:\/\//i.test(oParam)) ? oParam.replace(/\/$/, "") : proxyOrigin;
  console.log("[proxyFetch]", parsed.href, "->", resp.status, contentType, "html=" + isHtml, "css=" + isCss, "final=" + finalUrl, "pubOrigin=" + pubOrigin);

  // ---- SDK path: return JSON for the frontend to put into srcDoc ----
  if (isSdk) {
    if (!isHtml) {
      // non-HTML (image/pdf/etc.) — frontend opens it directly (correct behavior)
      return Response.json({ ok: true, nonHtml: true, finalUrl, contentType, status: resp.status });
    }
    let html = await resp.text();
    if (isBlockPage(html)) {
      console.log("[proxyFetch] block page detected", finalUrl);
      return Response.json({ ok: false, blocked: true, error: "Site served an anti-bot or block page", finalUrl, status: resp.status });
    }
    html = inject(html, finalUrl, clientOrigin);
    return Response.json({ ok: true, html, finalUrl, contentType, status: resp.status });
  }

  // ---- Direct browser GET path: stream resources through ----
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders(proxyOrigin) });
  }

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
    css = rewriteCss(css, parsed.href, pubOrigin);
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

// Static asset extensions and known CDN hosts. These are loaded DIRECTLY by
// the browser (not tunneled through Base44) — the single biggest speed win,
// because YouTube/TikTok/etc. pull most of their bytes (video chunks,
// thumbnails, player JS, fonts) from CDNs that serve any origin. Same-origin
// resources (host == page host) are still proxied, since those may need the
// proxy to reach the real site.
const STATIC_EXT = /\.(js|mjs|css|png|jpe?g|gif|webp|avif|svg|ico|woff2?|ttf|eot|otf|mp4|webm|m3u8|m4s|ts|mp3|wav|ogg|pdf)(?:[?#]|$)/i;
const CDN_HOSTS = /(googleapis|gstatic|googlevideo|ytimg|ggpht|tiktokcdn|akamaized|akamaihd|cloudfront|fastly|jsdelivr|unpkg|cdnjs|fbcdn|edgecast|llnwd|cdn\.|\.cdn)/i;

function isDirectResource(u: string, base: string): boolean {
  try {
    const x = new URL(u, base);
    const pageHost = new URL(base).host;
    if (x.host === pageHost) return false; // same-origin -> still proxy
    return STATIC_EXT.test(x.pathname) || CDN_HOSTS.test(x.host);
  } catch { return false; }
}

// Resource URL builder: direct absolute URL for static/CDN third-party assets,
// proxied URL otherwise. Used for <img>/<script>/<link>/<source>/<media> src
// and CSS url()/@import.
function makeResProxy(origin: string, base: string) {
  const proxy = makeProxy(origin, base);
  return (u: string) => {
    if (!u) return u;
    const s = String(u).trim();
    if (!s) return u;
    if (/^(data:|blob:|javascript:|mailto:|tel:|#)/i.test(s)) return u;
    if (isDirectResource(s, base)) {
      try { return new URL(s, base).href; } catch { return u; }
    }
    return proxy(s);
  };
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
    out += rewriteAttrs(html.slice(last, m.index), resProxy, navProxy) + m[0];
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
function rr(u){if(!u)return u;if(typeof u!=='string')u=String(u);if(/^(data:|blob:|javascript:|mailto:|tel:|#)/.test(u))return u;if(isStatic(u))return u;return rp(u)}
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