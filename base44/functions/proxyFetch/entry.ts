export default async function(req: Request): Promise<Response> {
  try {
    const reqUrl = new URL(req.url);
    let target = reqUrl.searchParams.get("url") || "";
    const proxyOrigin = reqUrl.origin;
    if (!target || typeof target !== "string") {
      return Response.json({ error: "Missing url" }, { status: 400 });
    }
    if (!/^https?:\/\//i.test(target)) target = "https://" + target;
    let parsed;
    try {
      parsed = new URL(target);
    } catch {
      return Response.json({ error: "Invalid url" }, { status: 400 });
    }

    const ua =
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";
    const method = req.method || "GET";
    const headers: Record<string, string> = {
      "user-agent": ua,
      accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
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
    if (method !== "GET") {
      const skip = new Set([
        "host", "connection", "content-length", "accept-encoding", "transfer-encoding", "upgrade",
        "origin", "referer", "cookie", "authorization",
      ]);
      for (const [k, v] of req.headers.entries()) {
        const lk = k.toLowerCase();
        if (skip.has(lk) || lk.startsWith("x-") || lk.startsWith("cf-") || lk.startsWith("cdn-") || lk === "via" || lk === "true-client-ip") continue;
        headers[lk] = v;
      }
    }
    const fetchOpts: any = { method, headers, redirect: "follow" };
    if (!["GET", "HEAD"].includes(method)) {
      fetchOpts.body = await req.arrayBuffer();
    }

    const resp = await fetch(parsed.href, fetchOpts);
    const contentType = resp.headers.get("content-type") || "";
    const finalUrl = resp.url || parsed.href;
    const isHtml = contentType.includes("text/html") || contentType.includes("application/xhtml");

    if (isHtml) {
      let html = await resp.text();
      html = inject(html, finalUrl, proxyOrigin);
      return new Response(html, {
        status: 200,
        headers: {
          "content-type": "text/html; charset=utf-8",
          "access-control-allow-origin": proxyOrigin,
          "access-control-allow-credentials": "true",
          "referrer-policy": "no-referrer",
          "cache-control": "no-store",
        },
      });
    }

    // non-HTML: stream through with permissive CORS + long cache for static assets
    const baseHeaders: Record<string, string> = {
      "content-type": contentType || "application/octet-stream",
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "*",
      "access-control-allow-headers": "*",
      "access-control-expose-headers": "*",
      "referrer-policy": "no-referrer",
    };
    const cl = resp.headers.get("content-length"); if (cl) baseHeaders["content-length"] = cl;
    const cr = resp.headers.get("content-range"); if (cr) baseHeaders["content-range"] = cr;
    const ar = resp.headers.get("accept-ranges"); if (ar) baseHeaders["accept-ranges"] = ar;
    const isStaticAsset = /^(text\/css|application\/javascript|text\/javascript|application\/x-javascript|image\/|font\/|application\/font|audio\/|video\/)/.test(contentType);
    baseHeaders["cache-control"] = isStaticAsset ? "public, max-age=31536000, immutable" : "no-store";
    return new Response(resp.body, { status: resp.status, headers: baseHeaders });
  } catch (error) {
    return Response.json({ error: error.message || "Proxy failed" }, { status: 500 });
  }
}

function inject(html: string, finalUrl: string, origin: string): string {
  const script =
    '<base href="' + finalUrl + '">' +
    "<script>" + clientScript(origin, finalUrl) + "</script>";
  if (/<head[^>]*>/i.test(html)) {
    return html.replace(/<head[^>]*>/i, (m) => m + script);
  }
  if (/<html[^>]*>/i.test(html)) {
    return html.replace(/<html[^>]*>/i, (m) => m + script);
  }
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