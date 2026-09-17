// Ghost Proxy — backend fetch + rewrite.
//
// Two entry modes:
//   1. SDK invoke (POST JSON body, no ?url=): fetches the target, injects a client
//      interceptor, and returns the HTML as JSON. The frontend puts it into the
//      iframe via srcDoc — srcDoc documents carry NO Content-Security-Policy, so
//      the target site's scripts actually execute. (Direct GET responses from
//      functions get `script-src 'none'` injected by the platform, which would
//      blank every SPA — that's why we do NOT load the document via the URL.)
//   2. Direct browser GET (?url=...): streams non-HTML resources (JS/CSS/images/
//      fonts/API JSON) through with permissive CORS + long cache. CSP on those
//      responses is irrelevant (CSP is enforced on the embedding document, not on
//      the resource), so scripts/css loaded this way still work inside srcDoc.

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";

const BLOCK_PATTERNS = [
  /\/sorry\/index/i,          // Google anti-bot
  /captcha/i,
  /access\s*denied/i,
  /verify\s*you\s*are\s*a\s*human/i,
  /are\s*you\s*a\s*robot/i,
  /blocked/i,
];

function isBlockPage(html: string): boolean {
  if (html.length < 2000) {
    for (const re of BLOCK_PATTERNS) if (re.test(html)) return true;
  }
  return false;
}

export default async function(req: Request): Promise<Response> {
  const reqUrl = new URL(req.url);
  const proxyOrigin = reqUrl.origin;
  const urlParam = reqUrl.searchParams.get("url");
  const isSdk = !urlParam && req.method === "POST";

  // SDK invocations arrive through an internal dispatcher, so reqUrl.origin is
  // NOT the public app host. The frontend sends the real public origin in the
  // body; use that for the injected PROXY_ORIGIN so sub-resource fetches from
  // the srcDoc iframe resolve to a URL the user's browser can actually reach.
  let clientOrigin = proxyOrigin;
  let target = "";
  if (urlParam) target = urlParam;
  else if (isSdk) {
    const body = await req.json().catch(() => ({}));
    target = body.url || body.target || "";
    if (body.origin && /^https?:\/\//i.test(body.origin)) clientOrigin = body.origin.replace(/\/$/, "");
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
  const method = isSdk ? "GET" : req.method || "GET";
  if (!isSdk && method !== "GET") {
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
  const fetchOpts: any = { method, headers, redirect: "follow" };
  if (!["GET", "HEAD"].includes(method)) {
    fetchOpts.body = isSdk ? undefined : await req.arrayBuffer();
  }

  let resp: Response;
  try {
    resp = await fetch(parsed.href, fetchOpts);
  } catch (e: any) {
    console.log("[proxyFetch] network error", parsed.href, e.message);
    if (isSdk) return Response.json({ ok: false, blocked: true, error: e.message || "Network error", finalUrl: parsed.href });
    return new Response("Proxy fetch failed: " + (e.message || ""), { status: 502, headers: { "content-type": "text/plain" } });
  }

  const contentType = resp.headers.get("content-type") || "";
  const finalUrl = resp.url || parsed.href;
  const isHtml = contentType.includes("text/html") || contentType.includes("application/xhtml");
  console.log("[proxyFetch]", parsed.href, "->", resp.status, contentType, "html=" + isHtml, "final=" + finalUrl);

  // ---- SDK path: return JSON for the frontend to put into srcDoc ----
  if (isSdk) {
    if (!isHtml) {
      // non-HTML (image/pdf/etc.) — frontend will open it directly
      return Response.json({ ok: true, nonHtml: true, finalUrl, contentType, status: resp.status });
    }
    let html = await resp.text();
    if (isBlockPage(html)) {
      console.log("[proxyFetch] block page detected", finalUrl);
      return Response.json({ ok: false, blocked: true, error: "Site served an anti-bot page", finalUrl, status: resp.status });
    }
    // Show the page (including 404/5xx error pages) rather than blanking —
    // only network failures and anti-bot pages trigger open-direct.
    html = inject(html, finalUrl, clientOrigin);
    return Response.json({ ok: true, html, finalUrl, contentType, status: resp.status });
  }

  // ---- Direct browser GET path: stream resources through ----
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders(proxyOrigin) });
  }

  if (isHtml) {
    // Document loaded directly (shouldn't normally happen from srcDoc). CSP will
    // strip scripts, but at least return something usable.
    let html = await resp.text();
    html = inject(html, finalUrl, proxyOrigin);
    return new Response(html, {
      status: 200,
      headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "referrer-policy": "no-referrer", ...corsHeaders(proxyOrigin) },
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

function corsHeaders(origin: string): Record<string, string> {
  return {
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
    "access-control-allow-headers": "*",
    "access-control-expose-headers": "*",
  };
}

function inject(html: string, finalUrl: string, origin: string): string {
  const script = '<base href="' + finalUrl + '"><script>' + clientScript(origin, finalUrl) + "</script>";
  if (/<head[^>]*>/i.test(html)) return html.replace(/<head[^>]*>/i, (m) => m + script);
  if (/<html[^>]*>/i.test(html)) return html.replace(/<html[^>]*>/i, (m) => m + script);
  return script + html;
}

function clientScript(origin: string, finalUrl: string): string {
  let path = "/";
  try { const u = new URL(finalUrl); path = u.pathname + u.search + u.hash; } catch {}
  return [
    "var PROXY_ORIGIN=" + JSON.stringify(origin) + ";",
    "var P=PROXY_ORIGIN+'/functions/proxyFetch?url=';",
    "var VP_PATH=" + JSON.stringify(path) + ";",
    "function rp(u){if(!u)return u;if(typeof u!=='string')u=String(u);if(u.indexOf(P)===0)return u;if(/^(data:|blob:|javascript:|mailto:|tel:|#)/.test(u))return u;try{var abs=new URL(u,document.baseURI).href;return P+encodeURIComponent(abs)}catch(e){return u}}",
    "var of=window.fetch;if(of)window.fetch=function(input,init){try{if(typeof input==='string')input=rp(input);else if(input&&input.url)input=new Request(rp(input.url),input)}catch(e){}return of.call(this,input,init)};",
    "var X=window.XMLHttpRequest;if(X){var o=X.prototype.open;X.prototype.open=function(m,u){arguments[1]=rp(u);return o.apply(this,arguments)}}",
    "var sb=navigator.sendBeacon&&navigator.sendBeacon.bind(navigator);if(sb)navigator.sendBeacon=function(u,d){try{u=rp(u)}catch(e){}return sb(u,d)};",
    "function s(h){try{parent.postMessage({__vp:1,url:h},'*')}catch(e){}}",
    "try{history.replaceState(null,'',VP_PATH)}catch(e){}",
    "try{var OL=Location.prototype;['assign','replace'].forEach(function(m){OL[m]=function(u){try{var abs=new URL(u,document.baseURI).href;s(abs)}catch(e){s(u)}}});var hd=Object.getOwnPropertyDescriptor(OL,'href');if(hd&&hd.get&&hd.set){Object.defineProperty(OL,'href',{configurable:true,enumerable:true,get:function(){return hd.get.call(this)},set:function(u){try{var abs=new URL(u,document.baseURI).href;s(abs)}catch(e){s(u)}}})}}catch(e){}",
    "document.addEventListener('click',function(e){var t=e.target;var a=t&&t.closest&&t.closest('a[href]');if(!a)return;var h=a.getAttribute('href');if(!h||h.indexOf('javascript:')===0||h.charAt(0)==='#')return;e.preventDefault();try{var abs=new URL(h,document.baseURI).href;s(abs)}catch(err){s(h)}},true);",
    "document.addEventListener('submit',function(e){e.preventDefault()},true);",
  ].join("");
}