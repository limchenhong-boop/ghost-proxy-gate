export default async function(req: Request): Promise<Response> {
  try {
    const reqUrl = new URL(req.url);
    const urlParam = reqUrl.searchParams.get("url");
    let target = urlParam || "";
    let fromSdk = false;
    if (!target) {
      const body = await req.json().catch(() => ({}));
      target = body.url || body.target || "";
      fromSdk = true;
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
    const resp = await fetch(parsed.href, {
      headers: {
        "user-agent": ua,
        accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "accept-language": "en-US,en;q=0.9",
      },
      redirect: "follow",
    });

    const contentType = resp.headers.get("content-type") || "";
    const finalUrl = resp.url || parsed.href;
    const proxyBase = reqUrl.origin + "/functions/proxyFetch?url=";
    const isHtml = contentType.includes("text/html") || contentType.includes("application/xhtml");

    if (!isHtml) {
      if (fromSdk) {
        return Response.json({ ok: true, html: null, finalUrl, contentType, nonHtml: true });
      }
      const headers = {
        "content-type": contentType || "application/octet-stream",
        "access-control-allow-origin": "*",
        "referrer-policy": "no-referrer",
      };
      if (contentType.includes("text/css")) {
        const css = await resp.text();
        return new Response(rewriteCssUrls(css, finalUrl, proxyBase), { status: 200, headers });
      }
      return new Response(await resp.arrayBuffer(), { status: 200, headers });
    }

    let html = await resp.text();
    html = rewriteHtml(html, finalUrl, proxyBase);

    const injection =
      '<base href="' + finalUrl + '">' +
      "<script>(function(){function s(h){try{parent.postMessage({__vp:1,url:h},'*')}catch(e){}}" +
      "document.addEventListener('click',function(e){var t=e.target;var a=t&&t.closest&&t.closest('a[href]');if(!a)return;var h=a.getAttribute('href');if(!h||h.indexOf('javascript:')===0||h.charAt(0)==='#')return;" +
      "e.preventDefault();try{var abs=new URL(h,document.baseURI).href;s(abs)}catch(err){s(h)}},true);" +
      "document.addEventListener('submit',function(e){e.preventDefault()},true);})();</script>";

    if (/<head[^>]*>/i.test(html)) {
      html = html.replace(/<head[^>]*>/i, (m) => m + injection);
    } else if (/<html[^>]*>/i.test(html)) {
      html = html.replace(/<html[^>]*>/i, (m) => m + injection);
    } else {
      html = injection + html;
    }

    if (fromSdk) {
      return Response.json({ ok: true, html, finalUrl, contentType });
    }
    return new Response(html, {
      status: 200,
      headers: { "content-type": "text/html; charset=utf-8", "access-control-allow-origin": "*" },
    });
  } catch (error) {
    return Response.json({ error: error.message || "Proxy failed" }, { status: 500 });
  }
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
  // <link href> (stylesheets, icons, preloads, manifests)
  html = html.replace(/<link\b[^>]*>/gi, (tag) =>
    tag
      .replace(/(\shref\s*=\s*")([^"]*)"/i, (m, pre, v) => pre + proxify(v, base, proxyBase) + '"')
      .replace(/(\shref\s*=\s*')([^']*)'/i, (m, pre, v) => pre + proxify(v, base, proxyBase) + "'")
  );
  // src / poster / data-src
  html = html
    .replace(/(\s(?:src|poster|data-src)\s*=\s*")([^"]*)"/gi, (m, pre, v) => pre + proxify(v, base, proxyBase) + '"')
    .replace(/(\s(?:src|poster|data-src)\s*=\s*')([^']*)'/gi, (m, pre, v) => pre + proxify(v, base, proxyBase) + "'");
  // srcset
  html = html
    .replace(/(\ssrcset\s*=\s*")([^"]*)"/gi, (m, pre, v) => pre + rewriteSrcset(v, base, proxyBase) + '"')
    .replace(/(\ssrcset\s*=\s*')([^']*)'/gi, (m, pre, v) => pre + rewriteSrcset(v, base, proxyBase) + "'");
  // inline style url()
  html = html
    .replace(/(\sstyle\s*=\s*")([^"]*)"/gi, (m, pre, v) => pre + rewriteCssUrls(v, base, proxyBase).replace(/"/g, "&quot;") + '"')
    .replace(/(\sstyle\s*=\s*')([^']*)'/gi, (m, pre, v) => pre + rewriteCssUrls(v, base, proxyBase) + "'");
  // <style> blocks
  html = html.replace(/<style\b[^>]*>([\s\S]*?)<\/style>/gi, (m, inner) => "<style>" + rewriteCssUrls(inner, base, proxyBase) + "</style>");
  return html;
}