export default async function(req: Request): Promise<Response> {
  try {
    const body = await req.json().catch(() => ({}));
    let target = body.url || body.target || "";
    if (!target || typeof target !== "string") {
      return Response.json({ error: "Missing url" }, { status: 400 });
    }
    if (!/^https?:\/\//i.test(target)) {
      target = "https://" + target;
    }
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

    if (!contentType.includes("text/html") && !contentType.includes("application/xhtml")) {
      return Response.json({
        ok: true,
        html: null,
        finalUrl,
        contentType,
        nonHtml: true,
      });
    }

    let html = await resp.text();

    const injection =
      '<base href="' + finalUrl + '">' +
      "<script>(function(){function s(h){try{parent.postMessage({__vp:1,url:h},'*')}catch(e){}}" +
      "document.addEventListener('click',function(e){var t=e.target;var a=t&&t.closest&&t.closest('a[href]');" +
      "if(!a)return;var h=a.getAttribute('href');if(!h||h.indexOf('javascript:')===0||h.charAt(0)==='#')return;" +
      "e.preventDefault();try{var abs=new URL(h,document.baseURI).href;s(abs)}catch(err){s(h)}},true);" +
      "document.addEventListener('submit',function(e){e.preventDefault()},true);})();</script>";

    if (/<head[^>]*>/i.test(html)) {
      html = html.replace(/<head[^>]*>/i, (m) => m + injection);
    } else if (/<html[^>]*>/i.test(html)) {
      html = html.replace(/<html[^>]*>/i, (m) => m + injection);
    } else {
      html = injection + html;
    }

    return Response.json({ ok: true, html, finalUrl, contentType });
  } catch (error) {
    return Response.json({ error: error.message || "Proxy failed" }, { status: 500 });
  }
}