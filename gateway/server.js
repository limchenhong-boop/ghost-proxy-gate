// Ghost Proxy Gateway — Scramjet interception proxy
//
// Serves the Scramjet static files, a Wisp WebSocket transport, and a custom
// top-level isolated proxy page launched by the Base44 app. The service worker
// (registered by the proxy page) intercepts all requests from the proxied
// site and routes them through the Wisp server, giving full SPA support
// (YouTube, TikTok, etc.) that the old srcDoc approach couldn't match.
//
// Endpoints:
//   GET  /                  -> proxy.html (the proxy page)
//   GET  /scram/*           -> Scramjet core files (wasm, js)
//   GET  /libcurl/*         -> libcurl transport files
//   GET  /baremux/*         -> BareMux connection files
//   GET  /sw.js             -> service worker
//   GET  /config.js         -> scramjet config
//   WS   /wisp/             -> Wisp WebSocket transport
//   GET  /health            -> { ok: true }
//
// Env:
//   PORT   listen port (default 8080)

import { createServer } from "node:http";
import { fileURLToPath } from "url";
import { dirname, join } from "node:path";
import Fastify from "fastify";
import fastifyStatic from "@fastify/static";
import { server as wisp, logging } from "@mercuryworkshop/wisp-js/server";

import residentialRoutes from "./residential.js";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { upstreamPool, getSession, newSession, sessionCookie } from "./upstream-pool.js";
import socketForSession from "./wisp-socket.js";
import diagnostics, { diagnosticSessions } from "./diagnostics.js";
import transportLogs from "./transport-logs.js";

import { scramjetPath } from "@mercuryworkshop/scramjet/path";
import { libcurlPath } from "@mercuryworkshop/libcurl-transport";
import { baremuxPath } from "@mercuryworkshop/bare-mux/node";
import { epoxyPath } from "@mercuryworkshop/epoxy-transport";
import { bareModulePath } from "@mercuryworkshop/bare-as-module3";
import { uvPath } from "@titaniumnetwork-dev/ultraviolet";

const __dirname = dirname(fileURLToPath(import.meta.url));
const publicPath = join(__dirname, "public");
const PORT = parseInt(process.env.PORT || "8080", 10);

// Pin and verify the implementation whose TCPSocket contract we inspected.
const installedWisp = JSON.parse(readFileSync(new URL("../../package.json", import.meta.resolve("@mercuryworkshop/wisp-js/server")), "utf8")).version;
if (installedWisp !== "0.4.1") throw new Error("Expected wisp-js 0.4.1; reinstall the pinned gateway dependencies");
if (!process.env.GATEWAY_API_KEY) throw new Error("GATEWAY_API_KEY is required for signed browsing sessions and developer diagnostics");
upstreamPool(); // Fail closed before listening; never silently use direct egress.
logging.set_level(logging.ERROR); // Custom transport diagnostics redact sensitive values.
Object.assign(wisp.options, {
  allow_udp_streams: false,
  allow_private_ips: false,
  allow_loopback_ips: false,
  dns_method: "lookup",
  dns_result_order: "ipv4first",
});

const fastify = Fastify({
  serverFactory: (handler) => {
    return createServer()
      .on("request", (req, res) => {
        // libcurl requires a top-level isolated gateway document. Do not embed
        // proxy.html cross-origin and do not exempt it from these headers.
        res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
        res.setHeader("Cross-Origin-Embedder-Policy", "require-corp");
        res.setHeader("Cross-Origin-Resource-Policy", "same-origin");
        const pathname = new URL(req.url, "http://gateway.invalid").pathname;
        if (["/", "/proxy.html", "/diagnostics"].includes(pathname)) {
          const session = getSession(req) || newSession();
          const secure = req.headers["x-forwarded-proto"] === "https" || Boolean(req.socket.encrypted);
          res.setHeader("Set-Cookie", sessionCookie(session, secure));
          res.setHeader("Cache-Control", "no-store");
        }
        if (["/sw.js", "/config.js", "/proxy.js"].includes(pathname)) res.setHeader("Cache-Control", "no-store");
        if (pathname === "/sw.js") res.setHeader("Service-Worker-Allowed", "/");
        handler(req, res);
      })
      .on("upgrade", (req, socket, head) => {
        const diagnostic = diagnosticSessions.get(req.url);
        if (req.url !== "/wisp/" && !diagnostic) { socket.destroy(); return; }
        const session = diagnostic?.session || getSession(req) || newSession();
        const trace = diagnostic?.trace || { id: randomUUID(), streams: [] };
        // The FOURTH argument is the real wisp-js 0.4.1 connection option.
        // Every TCP stream in this connection captures the SAME upstream.
        wisp.routeRequest(req, socket, head, { TCPSocket: socketForSession(session, trace) });
      });
  },
});

// Force HTTPS on Render / behind a proxy (ported from Space-proxy).
if (process.env.FORCE_HTTPS === "true") {
  fastify.addHook("onRequest", async (req, reply) => {
    if (req.headers["x-forwarded-proto"] === "http") {
      return reply.redirect(`https://${req.headers.host}${req.raw.url}`);
    }
  });
}

// Residential fetch endpoints (/fetch + /raw) used by the Base44 proxyFetch
// function. Registered first so its body parser and auth hook are scoped here.
fastify.register(residentialRoutes);
fastify.register(diagnostics);
fastify.register(transportLogs);

// Serve our custom proxy page + service worker
fastify.register(fastifyStatic, {
  root: publicPath,
  decorateReply: true,
  serve: false, // Explicit routes prevent bypassing developer diagnostic auth.
});
fastify.get("/", (req, reply) => reply.sendFile("proxy.html"));

// Explicit routes for critical proxy files (reliable fallback)
fastify.get("/proxy.html", (req, reply) => reply.sendFile("proxy.html"));
fastify.get("/proxy.js", (req, reply) => reply.sendFile("proxy.js"));
fastify.get("/sw.js", (req, reply) => reply.sendFile("sw.js"));
fastify.get("/config.js", (req, reply) => reply.type("application/javascript").send(`self.GHOST_CONFIG = ${JSON.stringify({ prefix: "/service/", diagnostics: process.env.WISP_DIAGNOSTICS !== "0" })};`));
fastify.get("/transport-diagnostics.js", (req, reply) => reply.sendFile("transport-diagnostics.js"));

// Serve Scramjet core files at /scram/
fastify.register(fastifyStatic, {
  root: scramjetPath,
  prefix: "/scram/",
  decorateReply: false,
});

// Serve libcurl transport at /libcurl/
fastify.register(fastifyStatic, {
  root: libcurlPath,
  prefix: "/libcurl/",
  decorateReply: false,
});

// Serve BareMux at /baremux/
fastify.register(fastifyStatic, {
  root: baremuxPath,
  prefix: "/baremux/",
  decorateReply: false,
});

// Serve the epoxy transport at /epoxy/ (ported from Space-proxy)
fastify.register(fastifyStatic, {
  root: epoxyPath,
  prefix: "/epoxy/",
  decorateReply: false,
});

// Serve bare-as-module3 at /baremod/ (alternative bare transport)
fastify.register(fastifyStatic, {
  root: bareModulePath,
  prefix: "/baremod/",
  decorateReply: false,
});

// Serve Ultraviolet at /_uv/ (alternative proxy backend assets)
fastify.register(fastifyStatic, {
  root: uvPath,
  prefix: "/_uv/",
  decorateReply: false,
});

fastify.get("/health", async (req, reply) => {
  reply.header("access-control-allow-origin", "*");
  reply.header("cache-control", "no-store");
  return ({
  ok: true,
  build: "scramjet-v6-wisp-connect",
  wispVersion: installedWisp,
  transport: "http-connect",
  directFallback: false,
  residentialEndpoints: upstreamPool().length,
  });
});

fastify.listen({ port: PORT, host: "0.0.0.0" }, (err) => {
  if (err) {
    console.error(err);
    process.exit(1);
  }
  console.log(`Ghost Proxy (Scramjet) gateway listening on :${PORT}`);
});