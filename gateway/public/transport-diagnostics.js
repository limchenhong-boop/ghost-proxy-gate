// Metadata only: no URLs/paths, query strings, headers, bodies, or cookies.
const requests = new Map();
function reportTransport(data) {
  if (!self.GHOST_CONFIG?.diagnostics) return;
  console.info("[Scramjet transport]", data);
  fetch("/transport-log", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify(data) }).catch(() => {});
}
function destinationMeta(url) {
  return { host: url.hostname, port: Number(url.port || (url.protocol === "https:" ? 443 : 80)) };
}
function attachTransportDiagnostics(scramjet) {
  scramjet.addEventListener("request", (event) => {
    const meta = { ...destinationMeta(event.url), method: event.method, id: crypto.randomUUID() };
    if (requests.size > 2000) requests.clear();
    const queue = requests.get(event.url.href) || []; queue.push(meta); requests.set(event.url.href, queue);
    reportTransport({ ...meta, stage: "request" });
  });
  scramjet.addEventListener("handleResponse", (event) => {
    const queue = requests.get(event.url.href) || [];
    const meta = queue.shift() || destinationMeta(event.url);
    if (!queue.length) requests.delete(event.url.href);
    const rawType = event.rawResponse.headers.get("content-type") || "";
    Object.assign(meta, { status: event.status, contentType: rawType.split(";")[0].trim() });
    reportTransport({ ...meta, stage: "response" });
    const body = event.responseBody;
    if (body instanceof ReadableStream) {
      let bytes = 0;
      event.responseBody = body.pipeThrough(new TransformStream({
        transform(chunk, controller) { bytes += chunk.byteLength ?? new TextEncoder().encode(String(chunk)).length; controller.enqueue(chunk); },
        flush() { reportTransport({ ...meta, stage: "response-end", bytes }); },
      }));
    } else {
      const bytes = body == null ? 0 : typeof body === "string" ? new TextEncoder().encode(body).length : body.byteLength ?? body.size;
      reportTransport({ ...meta, stage: "response-end", bytes });
    }
  });
}