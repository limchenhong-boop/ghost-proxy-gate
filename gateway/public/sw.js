importScripts("/config.js", "/scram/scramjet.all.js", "/transport-diagnostics.js");

const { ScramjetServiceWorker } = $scramjetLoadWorker();
const scramjet = new ScramjetServiceWorker();
if (self.GHOST_CONFIG?.diagnostics) attachTransportDiagnostics(scramjet);
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

async function handleRequest(event) {
  await scramjet.loadConfig();
  if (scramjet.config && scramjet.route(event)) {
    const response = await scramjet.fetch(event);
    if (response.status >= 500) console.warn("[Scramjet transport] Request failed", { method: event.request.method, status: response.status, destination: event.request.destination });
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