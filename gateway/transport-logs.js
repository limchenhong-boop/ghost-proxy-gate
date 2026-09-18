import { getSession } from "./upstream-pool.js";

// HTTP metadata exists in Scramjet, not in the opaque Wisp TLS tunnel.
// These explicitly labelled client reports complement server CONNECT evidence.
export default async function transportLogs(fastify) {
  const limits = new Map();
  fastify.post("/transport-log", { bodyLimit: 2048 }, async (req, reply) => {
    if (process.env.WISP_DIAGNOSTICS === "0") return reply.code(204).send();
    const session = getSession(req);
    let origin;
    try { origin = new URL(req.headers.origin).host; } catch { return reply.code(403).send(); }
    if (!session || origin !== req.headers.host) return reply.code(403).send();
    const sessionId = session.cookie.split(".")[0];
    const minute = Math.floor(Date.now() / 60000);
    const limit = limits.get(sessionId);
    const count = limit?.minute === minute ? limit.count + 1 : 1;
    if (limits.size > 1000) limits.clear();
    limits.set(sessionId, { minute, count });
    if (count > 2400) return reply.code(429).send();
    const data = req.body || {};
    if (!["request", "response", "response-end", "error"].includes(data.stage)) return reply.code(400).send();
    if (typeof data.host !== "string" || !/^[a-zA-Z0-9.:[\]-]{1,253}$/.test(data.host)) return reply.code(400).send();
    const record = { source: "scramjet-client-report", session: sessionId, upstream: session.upstream.id, transport: "wisp/http-connect", targetHost: data.host, stage: data.stage };
    if (Number.isInteger(data.port) && data.port > 0 && data.port < 65536) record.targetPort = data.port;
    if (["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"].includes(data.method)) record.method = data.method;
    if (Number.isInteger(data.status) && data.status >= 100 && data.status <= 599) record.status = data.status;
    if (Number.isSafeInteger(data.bytes) && data.bytes >= 0) record.responseSize = data.bytes;
    if (typeof data.contentType === "string" && /^[a-zA-Z0-9.+/-]{1,100}$/.test(data.contentType)) record.contentType = data.contentType;
    if (typeof data.id === "string" && /^[a-f0-9-]{36}$/.test(data.id)) record.requestId = data.id;
    if (["SCRAMJET_RESPONSE_ERROR", "UNREWRITTEN_EXTERNAL_REQUEST", "STREAM_FAILED"].includes(data.error)) record.error = data.error;
    console.log(data.stage === "request" ? "[WISP REQUEST]" : data.stage === "error" ? "[WISP ERROR]" : "[WISP RESPONSE]", JSON.stringify(record));
    return reply.code(204).send();
  });
}