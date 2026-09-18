importScripts("/config.js", "/scram/scramjet.all.js", "/transport-diagnostics.js");

const { ScramjetServiceWorker } = $scramjetLoadWorker();
const scramjet = new ScramjetServiceWorker();
// In v1.1.0 the built-in config message only assigns this.config. Reload from
// IndexedDB so loadConfig also sets shared codecs/config and initializes WASM.
let configReady;
self.addEventListener("message", ({ data }) => {
  if (data?.scramjet$type === "loadConfig") { scramjet.config = undefined; configReady = undefined; }
});
if (self.GHOST_CONFIG?.diagnostics) attachTransportDiagnostics(scramjet);
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

async function handleRequest(event) {
  if (!configReady) configReady = scramjet.loadConfig();
  await configReady;
  if (scramjet.config && scramjet.route(event)) {
    const response = await scramjet.fetch(event);
    if (response.status >= 500) {
      try {
        const target = new URL(decodeURIComponent(new URL(event.request.url).pathname.slice(self.GHOST_CONFIG.prefix.length)));
        reportTransport({ ...destinationMeta(target), method: event.request.method, status: response.status, stage: "error", error: "SCRAMJET_RESPONSE_ERROR" });
      } catch { /* Never log the encoded URL or its query tokens. */ }
    }
    return response;
  }
  const url = new URL(event.request.url);
  if (/^https?:$/.test(url.protocol) && url.origin !== self.location.origin) {
    reportTransport({ ...destinationMeta(url), method: event.request.method, stage: "error", error: "UNREWRITTEN_EXTERNAL_REQUEST" });
    return new Response("Request escaped Scramjet rewriting; direct network fallback is disabled.", { status: 502 });
  }
  return fetch(event.request);
}

self.addEventListener("fetch", (event) => {
  event.respondWith(handleRequest(event));
});