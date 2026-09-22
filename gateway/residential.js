// Residential fetch endpoints for the Ghost Proxy gateway.
//
// The Base44 `proxyFetch` function calls these two routes so that page loads
// and sub-resources egress from the residential proxy IP instead of the
// Base44 runtime IP (which anti-bot systems block).
//
//   POST /fetch          { url, method, body, contentType }
//                        -> { ok, status, contentType, finalUrl, body }
//   ANY  /raw?url=...    streams the resource through, with x-final-url
//
// Both require the x-api-key header to match GATEWAY_API_KEY.
//
// Env:
//   GATEWAY_API_KEY    shared secret with the Base44 function (required)
//   RESIDENTIAL_PROXY  one or more proxy endpoints, separated by newlines,
//                      commas or spaces. Each may be written as
//                        http://user:pass@host:port
//                        user:pass@host:port
//                        host:port:user:pass   (proxy-seller list format)
//                      Requests are spread round-robin across all of them, so
//                      pasting a whole 500-port list here is the intended use.
//                      (when unset, requests go out directly)

import { Readable } from "node:stream";
import { ProxyAgent, request as undiciRequest } from "undici";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";

let agents;
let cursor = 0;

// Normalize one list entry into an http:// proxy URL, or null if unusable.
function toProxyUrl(entry) {
  const s = entry.trim();
  if (!s) return null;
  if (/^https?:\/\//i.test(s)) return s;
  const parts = s.split(":");
  // host:port:user:pass (proxy-seller download format)
  if (parts.length === 4 && /^\d+$/.test(parts[1])) {
    return `http://${encodeURIComponent(parts[2])}:${encodeURIComponent(parts[3])}@${parts[0]}:${parts[1]}`;
  }
  // user:pass@host:port or host:port
  if (s.includes("@") || parts.length === 2) return "http://" + s;
  return null;
}

// Lazily build the agent pool so a bad entry can never crash boot.
function proxyAgents() {
  if (agents) return agents;
  agents = [];
  const raw = (process.env.RESIDENTIAL_PROXY || "").trim();
  if (!raw) {
    console.warn("[residential] RESIDENTIAL_PROXY not set — egressing directly");
    return agents;
  }
  const seen = new Set();
  for (const entry of raw.split(/[\s,]+/)) {
    const url = toProxyUrl(entry);
    if (!url || seen.has(url)) continue;
    seen.add(url);
    try {
      agents.push(new ProxyAgent(url));
    } catch (err) {
      console.error("[residential] bad proxy entry skipped:", err.message);
    }
  }
  console.log(`[residential] ${agents.length} proxy endpoint(s) ready`);
  return agents;
}

// Round-robin so concurrent sub-resource requests use different ports.
function proxyAgent() {
  const pool = proxyAgents();
  if (!pool.length) return undefined;
  return pool[cursor++ % pool.length];
}

function docHeaders(target) {
  let origin = target;
  try { origin = new URL(target).origin + "/"; } catch {}
  return {
    "user-agent": UA,
    accept: "text/html,application/xhtml+xml,application/xml;q=0.9,application/json;q=0.8,*/*;q=0.8",
    "accept-language": "en-US,en;q=0.9",
    "accept-encoding": "identity",
    "sec-ch-ua": '"Chromium";v="122", "Not(A:Brand";v="24", "Google Chrome";v="122"',
    "sec-ch-ua-mobile": "?0",
    "sec-ch-ua-platform": '"Windows"',
    "sec-fetch-dest": "document",
    "sec-fetch-mode": "navigate",
    "sec-fetch-site": "none",
    "sec-fetch-user": "?1",
    "upgrade-insecure-requests": "1",
    referer: origin,
  };
}

function isHttpUrl(u) {
  try {
    const p = new URL(u);
    return p.protocol === "http:" || p.protocol === "https:";
  } catch {
    return false;
  }
}

function send(target, { method = "GET", headers, body, bodyTimeout, headersTimeout }) {
  return undiciRequest(target, {
    method,
    headers,
    body,
    dispatcher: proxyAgent(),
    maxRedirections: 8,
    headersTimeout,
    bodyTimeout,
  });
}

// Tracking / ad domains blocked on the generic //* proxy route (ported from
// Space-proxy). Requests to these never leave the gateway.
const TRACKING_DOMAINS = [
  "trk.pinterest.com", "widgets.pinterest.com", "events.reddit.com", "events.redditmedia.com",
  "ads.youtube.com", "ads-api.tiktok.com", "analytics.tiktok.com", "ads-sg.tiktok.com",
  "business-api.tiktok.com", "ads.tiktok.com", "log.byteoversea.com", "ads.yahoo.com",
  "analytics.yahoo.com", "geo.yahoo.com", "udc.yahoo.com", "udcm.yahoo.com", "advertising.yahoo.com",
  "analytics.query.yahoo.com", "partnerads.ysm.yahoo.com", "log.fc.yahoo.com", "gemini.yahoo.com",
  "extmaps-api.yandex.net", "analytics-sg.tiktok.com", "adtech.yahooinc.com", "adfstat.yandex.ru",
  "appmetrica.yandex.ru", "metrika.yandex.ru", "advertising.yandex.ru", "offerwall.yandex.net",
  "adfox.yandex.ru", "auction.unityads.unity3d.com", "webview.unityads.unity3d.com", "config.unityads.unity3d.com",
  "bdapi-ads.realmemobile.com", "bdapi-in-ads.realmemobile.com", "api.ad.xiaomi.com", "data.mistat.xiaomi.com",
  "data.mistat.india.xiaomi.com", "data.mistat.rus.xiaomi.com", "sdkconfig.ad.xiaomi.com", "sdkconfig.ad.intl.xiaomi.com",
  "globalapi.ad.xiaomi.com", "tracking.rus.miui.com", "adsfs.oppomobile.com", "adx.ads.oppomobile.com",
  "ck.ads.oppomobile.com", "data.ads.oppomobile.com", "metrics.data.hicloud.com", "metrics2.data.hicloud.com",
  "grs.hicloud.com", "logservice.hicloud.com", "logservice1.hicloud.com", "logbak.hicloud.com",
  "click.oneplus.cn", "open.oneplus.net", "samsungads.com", "smetrics.samsung.com",
  "analytics-api.samsunghealthcn.com", "samsung-com.112.2o7.net", "nmetrics.samsung.com",
  "advertising.apple.com", "tr.iadsdk.apple.com", "iadsdk.apple.com", "metrics.icloud.com",
  "metrics.apple.com", "metrics.mzstatic.com", "api-adservices.apple.com", "books-analytics-events.apple.com",
  "weather-analytics-events.apple.com", "notes-analytics-events.apple.com", "fwtracks.freshmarketer.com", "adtago.s3.amazonaws.com",
  "analytics.s3.amazonaws.com", "advice-ads.s3.amazonaws.com", "advertising-api-eu.amazon.com", "pagead2.googlesyndication.com",
  "adservice.google.com", "afs.googlesyndication.com", "mediavisor.doubleclick.net", "ads30.adcolony.com",
  "adc3-launch.adcolony.com", "events3alt.adcolony.com", "wd.adcolony.com", "adservetx.media.net",
  "analytics.google.com", "app-measurement.com", "click.googleanalytics.com", "identify.hotjar.com",
  "events.hotjar.io", "o2.mouseflow.com", "gtm.mouseflow.com", "api.mouseflow.com", "realtime.luckyorange.com",
  "upload.luckyorange.net", "cs.luckyorange.net", "an.facebook.com", "static.ads-twitter.com",
  "adserver.unityads.unity3d.com", "iot-eu-logser.realme.com", "iot-logser.realme.com", "ads-api.twitter.com",
  "adroll.com", "hotjar.com", "mixpanel.com", "adjust.com", "amazon-adsystem.com",
  "kochava.com", "sentry.io", "cloudflareinsights.com", "appsflyer.com",
  "ad.doubleclick.net", "google-analytics.com", "bluekai.com", "onelink.me",
];

// Headers stripped from //* proxy responses so proxied pages can embed and
// scripts run without upstream CSP/X-Frame-Options blocking them.
const STRIP_HEADERS = new Set([
  "content-security-policy", "content-security-policy-report-only",
  "x-frame-options", "x-content-type-options",
  "cross-origin-embedder-policy", "cross-origin-opener-policy",
  "cross-origin-resource-policy", "strict-transport-security",
  "set-cookie", "server", "x-powered-by", "x-ua-compatible",
  "x-forwarded-for", "x-real-ip", "referer", "user-agent",
]);

// Small in-memory GET cache for the //* route (bounded, LRU-ish).
const routeCache = new Map();
const ROUTE_CACHE_MAX = 200;

export default async function residentialRoutes(fastify) {
  // Accept any request body on /raw as a Buffer (POST/PUT passthrough).
  fastify.addContentTypeParser("*", { parseAs: "buffer" }, (req, payload, done) => done(null, payload));

  fastify.addHook("onRequest", async (req, reply) => {
    if (!req.url.startsWith("/fetch") && !req.url.startsWith("/raw") && !req.url.startsWith("/test-proxy") && !req.url.startsWith("//") && !req.url.startsWith("/return")) return;
    const expected = process.env.GATEWAY_API_KEY || "";
    if (!expected || req.headers["x-api-key"] !== expected) {
      reply.code(401).send({ ok: false, error: "Unauthorized" });
    }
  });

  // ---- Document fetch: returns the page as JSON text ----
  fastify.post("/fetch", async (req, reply) => {
    const { url: target, method = "GET", body, contentType } = req.body || {};
    if (!target || !isHttpUrl(target)) {
      return reply.code(400).send({ ok: false, error: "A valid http(s) url is required." });
    }
    const headers = docHeaders(target);
    if (contentType) headers["content-type"] = contentType;

    let res;
    try {
      res = await send(target, {
        method: method.toUpperCase(),
        headers,
        body: ["GET", "HEAD"].includes(method.toUpperCase()) ? undefined : body,
        headersTimeout: 20000,
        bodyTimeout: 20000,
      });
    } catch (err) {
      console.error("[residential] /fetch failed:", target, err.message);
      return reply.code(200).send({ ok: false, error: "Residential fetch failed: " + err.message });
    }

    const resContentType = res.headers["content-type"] || "";
    const finalUrl = res.context?.history?.length
      ? String(res.context.history[res.context.history.length - 1])
      : target;
    const text = await res.body.text();
    return reply.send({
      ok: true,
      status: res.statusCode,
      contentType: resContentType,
      finalUrl,
      body: text,
    });
  });

  // ---- Raw resource passthrough: streams JS/CSS/images/fonts/API JSON ----
  fastify.route({
    method: ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    url: "/raw",
    handler: async (req, reply) => {
      const target = req.query?.url;
      if (!target || !isHttpUrl(target)) {
        return reply.code(400).send({ ok: false, error: "A valid http(s) url is required." });
      }
      let referer = target;
      try { referer = new URL(target).origin + "/"; } catch {}
      const headers = {
        "user-agent": UA,
        accept: "*/*",
        "accept-language": "en-US,en;q=0.9",
        referer,
        "sec-fetch-dest": "empty",
        "sec-fetch-mode": "cors",
        "sec-fetch-site": "same-origin",
      };
      for (const name of ["range", "content-type", "if-none-match", "if-modified-since"]) {
        if (req.headers[name]) headers[name] = req.headers[name];
      }
      if (req.headers.accept) headers.accept = req.headers.accept;

      let res;
      try {
        res = await send(target, {
          method: req.method,
          headers,
          body: ["GET", "HEAD"].includes(req.method) ? undefined : req.body,
          headersTimeout: 30000,
          bodyTimeout: 55000,
        });
      } catch (err) {
        console.error("[residential] /raw failed:", target, err.message);
        return reply.code(502).send({ ok: false, error: "Residential resource fetch failed: " + err.message });
      }

      const finalUrl = res.context?.history?.length
        ? String(res.context.history[res.context.history.length - 1])
        : target;
      reply.code(res.statusCode);
      reply.header("x-final-url", finalUrl);
      for (const name of ["content-type", "content-length", "content-range", "accept-ranges", "etag", "last-modified"]) {
        if (res.headers[name]) reply.header(name, res.headers[name]);
      }
      reply.header("access-control-allow-origin", "*");
      return reply.send(Readable.from(res.body));
    },
  });

  // ---- Proxy tester: test an arbitrary residential proxy against a target ----
  fastify.post("/test-proxy", async (req, reply) => {
    const { proxy, target } = req.body || {};
    if (!proxy || typeof proxy !== "string") {
      return reply.code(400).send({ ok: false, error: "A proxy URL is required." });
    }
    if (!target || !isHttpUrl(target)) {
      return reply.code(400).send({ ok: false, error: "A valid http(s) target URL is required." });
    }
    const proxyUrl = toProxyUrl(proxy);
    if (!proxyUrl) {
      return reply.code(400).send({ ok: false, error: "Invalid proxy format. Use http://user:pass@host:port or host:port:user:pass." });
    }
    let agent;
    try {
      agent = new ProxyAgent(proxyUrl);
    } catch (err) {
      return reply.code(400).send({ ok: false, error: "Could not create proxy agent: " + err.message });
    }

    const redacted = proxyUrl.replace(/\/\/([^:]+):([^@]+)@/, "//$1:****@");

    const through = async (url, headers, timeoutMs) => {
      const start = Date.now();
      const res = await undiciRequest(url, {
        method: "GET",
        headers,
        dispatcher: agent,
        maxRedirections: 8,
        headersTimeout: timeoutMs,
        bodyTimeout: timeoutMs,
      });
      return { res, elapsed: Date.now() - start };
    };

    // 1. Egress IP via an IP echo service through the proxy
    let egressIp = null;
    let ipError = null;
    try {
      const { res } = await through("https://api.ipify.org?format=json", {
        "user-agent": UA,
        accept: "application/json",
      }, 15000);
      const ipBody = JSON.parse(await res.body.text());
      egressIp = ipBody.ip || null;
    } catch (err) {
      ipError = err.message;
    }

    // 2. Fetch the target through the proxy
    try {
      const { res, elapsed } = await through(target, docHeaders(target), 25000);
      const contentType = res.headers["content-type"] || "";
      const finalUrl = res.context?.history?.length
        ? String(res.context.history[res.context.history.length - 1])
        : target;
      const raw = await res.body.text();
      const titleMatch = raw.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
      return reply.send({
        ok: true,
        egressIp,
        ipError,
        proxy: redacted,
        target: {
          status: res.statusCode,
          contentType,
          finalUrl,
          timingMs: elapsed,
          title: titleMatch ? titleMatch[1].trim().slice(0, 200) : null,
          bodyLength: raw.length,
          bodySnippet: raw.slice(0, 2000),
          headers: {
            server: res.headers["server"] || null,
            "content-type": contentType,
            "content-length": res.headers["content-length"] || null,
            "x-frame-options": res.headers["x-frame-options"] || null,
          },
        },
      });
    } catch (err) {
      return reply.send({
        ok: false,
        egressIp,
        ipError,
        proxy: redacted,
        targetError: err.message,
      });
    }
  });

  // ---- Generic URL proxy: GET //<url> — fetches through the residential proxy,
  //      strips anti-embed + tracking headers, blocks tracking domains, compresses
  //      if the client supports it, and caches GET responses. (Ported from
  //      Space-proxy's //* route, but routed through residential egress.)
  fastify.get("//*", async (req, reply) => {
    const target = req.params["*"];
    if (!target || !isHttpUrl(target)) {
      return reply.code(400).send({ ok: false, error: "A valid http(s) url is required." });
    }
    if (TRACKING_DOMAINS.some((d) => target.includes(d))) {
      return reply.code(403).send("Blocked tracking domain");
    }

    const cacheKey = target;
    const cached = routeCache.get(cacheKey);
    if (cached) {
      reply.headers(cached.headers);
      reply.type(cached.type);
      if (cached.encoding) reply.header("content-encoding", cached.encoding);
      return reply.send(cached.body);
    }

    let res;
    try {
      res = await send(target, {
        method: "GET",
        headers: {
          "user-agent": UA,
          accept: "*/*",
          "accept-language": "en-US,en;q=0.9",
          "accept-encoding": "identity",
        },
        headersTimeout: 20000,
        bodyTimeout: 25000,
      });
    } catch (err) {
      return reply.code(502).send({ ok: false, error: "Residential fetch failed: " + err.message });
    }

    const responseHeaders = {};
    for (const [key, value] of Object.entries(res.headers)) {
      if (!STRIP_HEADERS.has(key.toLowerCase())) {
        reply.header(key, value);
        responseHeaders[key] = value;
      }
    }
    const typeHeader = res.headers["content-type"] || "application/octet-stream";
    reply.type(typeHeader);

    let body = Buffer.from(await res.body.arrayBuffer());
    const acceptEncoding = req.headers["accept-encoding"] || "";
    let encoding = null;
    if (acceptEncoding.includes("br")) {
      const zlib = await import("node:zlib");
      body = zlib.brotliCompressSync(body);
      encoding = "br";
    } else if (acceptEncoding.includes("gzip")) {
      const zlib = await import("node:zlib");
      body = zlib.gzipSync(body);
      encoding = "gzip";
    }
    if (encoding) {
      reply.header("content-encoding", encoding);
      responseHeaders["content-encoding"] = encoding;
    }

    routeCache.set(cacheKey, { headers: responseHeaders, type: typeHeader, body, encoding });
    if (routeCache.size > ROUTE_CACHE_MAX) routeCache.delete(routeCache.keys().next().value);
    return reply.send(body);
  });

  // ---- DuckDuckGo autocomplete: GET /return?q=... (ported from Space-proxy,
  //      egressed through the residential proxy so the gateway IP stays hidden)
  fastify.get("/return", async (req, reply) => {
    const q = req.query?.q;
    if (!q) return reply.code(400).send({ error: "query parameter?" });
    try {
      const res = await send(`https://duckduckgo.com/ac/?q=${encodeURIComponent(q)}`, {
        method: "GET",
        headers: { "user-agent": UA, accept: "application/json" },
        headersTimeout: 10000,
        bodyTimeout: 10000,
      });
      reply.header("access-control-allow-origin", "*");
      return reply.send(await res.body.json());
    } catch (err) {
      return reply.code(502).send({ error: "request failed: " + err.message });
    }
  });
}