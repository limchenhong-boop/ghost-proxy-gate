export default async function(req: Request): Promise<Response> {
  try {
    const reqUrl = new URL(req.url);
    const urlParam = reqUrl.searchParams.get("url");
    let target = urlParam || "";
    let fromSdk = false;
    let clientOrigin = reqUrl.origin;
    if (!target) {
      const body = await req.json().catch(() => ({}));
      target = body.url || body.target || "";
      fromSdk = true;
      if (body.origin && /^https?:\/\//i.test(body.origin)) clientOrigin = body.origin.replace(/\/$/, "");
    }
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
    const method = fromSdk ? "GET" : req.method || "GET";
    const headers: Record<string, string> = {
      "user-agent": ua,
      accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "accept-language": "en-US,en;q=0.9",
      referer: parsed.href,
      origin: parsed.origin,
    };
    if (!fromSdk) {
      const skip = new Set([
        "host", "connection", "content-length", "accept-encoding", "transfer-encoding", "upgrade",
        "origin", "referer", "user-agent", "accept", "accept-language",
        "sec-fetch-mode", "sec-fetch-site", "sec-fetch-dest", "sec-fetch-user",
        "sec-ch-ua", "sec-ch-ua-mobile", "sec-ch-ua-platform",
      ]);
      for (const [k, v] of req.headers.entries()) {
        if (!skip.has(k.toLowerCase())) headers[k] = v;
      }
    }
    const fetchOpts: any = { method, headers, redirect: "follow" };
    if (!["GET", "HEAD"].includes(method)) {
      fetchOpts.body = fromSdk ? undefined : await req.arrayBuffer();
    }

    const resp = await fetch(parsed.href, fetchOpts);
    const contentType = resp.headers.get("content-type") || "";
    const finalUrl = resp.url || parsed.href;
    const proxyBase = clientOrigin + "/functions/proxyFetch?url=";
    const isHtml = contentType.includes("text/html") || contentType.includes("application/xhtml");

    if (fromSdk) {
      if (!isHtml) {
        return Response.json({ ok: true, html: null, finalUrl, contentType, nonHtml: true });
      }
      let html = await resp.text();
      html = rewriteHtml(html, finalUrl, proxyBase);
      html = inject(html, finalUrl, clientOrigin);
      return Response.json({ ok: true, html, finalUrl, contentType });
    }

    // direct browser request (asset or API)
    const baseHeaders = {
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
    if (isHtml) {
      let html = await resp.text();
      html = rewriteHtml(html, finalUrl, proxyBase);
      html = inject(html, finalUrl, clientOrigin);
      return new Response(html, { status: resp.status, headers: { ...baseHeaders, "content-type": "text/html; charset=utf-8" } });
    }
    if (contentType.includes("text/css")) {
      const css = await resp.text();
      return new Response(rewriteCssUrls(css, finalUrl, proxyBase), { status: resp.status, headers: baseHeaders });
    }
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

function proxify(url, base, proxyBase) {
  const u = (url || "").trim();
  if (!u) return u;
  if (/^(data:|javascript:|mailto:|tel:|blob:|#)/i.test(u)) return u;
  try {
    const abs = new URL(u, base).href;
    return proxyBase + encodeURIComponent(abs);
  } catch {
    return u;
  }
}

function rewriteSrcset(value, base, proxyBase) {
  return value
    .split(",")
    .map((part) => {
      const seg = part.trim();
      if (!seg) return seg;
      const [u, ...d] = seg.split(/\s+/);
      return proxify(u, base, proxyBase) + (d.length ? " " + d.join(" ") : "");
    })
    .join(", ");
}

function rewriteCssUrls(css, base, proxyBase) {
  return css
    .replace(/url\(\s*['"]?([^'")]+)['"]?\s*\)/gi, (m, u) => "url(" + proxify(u, base, proxyBase) + ")")
    .replace(/@import\s+['"]([^'"]+)['"]/gi, (m, u) => "@import '" + proxify(u, base, proxyBase) + "'");
}

function rewriteHtml(html, base, proxyBase) {
  html = html.replace(/<link\b[^>]*>/gi, (tag) =>
    tag
      .replace(/(\shref\s*=\s*")([^"]*)"/i, (m, pre, v) => pre + proxify(v, base, proxyBase) + '"')
      .replace(/(\shref\s*=\s*')([^']*)'/i, (m, pre, v) => pre + proxify(v, base, proxyBase) + "'")
  );
  html = html
    .replace(/(\s(?:src|poster|data-src)\s*=\s*")([^"]*)"/gi, (m, pre, v) => pre + proxify(v, base, proxyBase) + '"')
    .replace(/(\s(?:src|poster|data-src)\s*=\s*')([^']*)'/gi, (m, pre, v) => pre + proxify(v, base, proxyBase) + "'");
  html = html
    .replace(/(\ssrcset\s*=\s*")([^"]*)"/gi, (m, pre, v) => pre + rewriteSrcset(v, base, proxyBase) + '"')
    .replace(/(\ssrcset\s*=\s*')([^']*)'/gi, (m, pre, v) => pre + rewriteSrcset(v, base, proxyBase) + "'");
  html = html
    .replace(/(\sstyle\s*=\s*")([^"]*)"/gi, (m, pre, v) => pre + rewriteCssUrls(v, base, proxyBase).replace(/"/g, "&quot;") + '"')
    .replace(/(\sstyle\s*=\s*')([^']*)'/gi, (m, pre, v) => pre + rewriteCssUrls(v, base, proxyBase) + "'");
  html = html.replace(/<style\b[^>]*>([\s\S]*?)<\/style>/gi, (m, inner) => "<style>" + rewriteCssUrls(inner, base, proxyBase) + "</style>");
  return html;
}