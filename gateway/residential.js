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
//   RESIDENTIAL_PROXY  http(s) proxy URL, e.g. http://user:pass@host:port
//                      (when unset, requests go out directly)

import { Readable } from "node:stream";
import { ProxyAgent, request as undiciRequest } from "undici";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";

let agent;
let agentResolved = false;

// Lazily build the ProxyAgent so a bad proxy URL can never crash boot.
function proxyAgent() {
  if (agentResolved) return agent;
  agentResolved = true;
  const raw = (process.env.RESIDENTIAL_PROXY || "").trim();
  if (!raw) {
    console.warn("[residential] RESIDENTIAL_PROXY not set — egressing directly");
    return (agent = undefined);
  }
  if (!/^https?:\/\//i.test(raw)) {
    console.error("[residential] RESIDENTIAL_PROXY must be an http(s):// URL — egressing directly");
    return (agent = undefined);
  }
  try {
    agent = new ProxyAgent(raw);
    console.log("[residential] proxy agent ready");
  } catch (err) {
    console.error("[residential] bad RESIDENTIAL_PROXY:", err.message);
    agent = undefined;
  }
  return agent;
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

export default async function residentialRoutes(fastify) {
  // Accept any request body on /raw as a Buffer (POST/PUT passthrough).
  fastify.addContentTypeParser("*", { parseAs: "buffer" }, (req, payload, done) => done(null, payload));

  fastify.addHook("onRequest", async (req, reply) => {
    if (!req.url.startsWith("/fetch") && !req.url.startsWith("/raw")) return;
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
}