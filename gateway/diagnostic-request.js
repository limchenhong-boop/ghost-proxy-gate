import { Duplex } from "node:stream";
import tls from "node:tls";
import https from "node:https";

// A real Wisp stream becomes the network socket for Node TLS and HTTP.
// https cannot open a fallback network connection: createConnection returns
// only the TLS socket whose bytes are transported by this Wisp stream.
export default function diagnosticRequest(connection, hostname, path = "/") {
  const evidence = { hostname, method: "GET", dnsAndConnect: false, tls: false, responseReceived: false };
  return new Promise((resolve) => {
    const stream = connection.create_stream(hostname, 443);
    const bridge = new Duplex({
      read() {},
      write(chunk, encoding, done) { stream.send(new Uint8Array(chunk)); done(); },
      destroy(error, done) { if (connection.connected) stream.close(); done(error); },
    });
    stream.onmessage = (data) => bridge.push(Buffer.from(data));
    stream.onclose = (reason) => {
      if (reason > 2) bridge.destroy(Object.assign(new Error("Wisp stream closed"), { code: `WISP_CLOSE_${reason}` }));
      else bridge.push(null);
    };
    const secure = tls.connect({ socket: bridge, servername: hostname, rejectUnauthorized: true, ALPNProtocols: ["http/1.1"] });
    const agent = new https.Agent({ keepAlive: false });
    agent.createConnection = () => secure;
    let request;
    let finished = false;
    const finish = (error) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      if (error) evidence.error = error.code || "DIAGNOSTIC_FAILED";
      request?.destroy(); secure.destroy(); bridge.destroy(); agent.destroy();
      resolve(evidence);
    };
    const timer = setTimeout(() => finish({ code: "DIAGNOSTIC_TIMEOUT" }), 30000);
    bridge.on("error", finish);
    secure.on("error", finish);
    secure.once("secureConnect", () => {
      evidence.dnsAndConnect = true;
      evidence.tls = secure.authorized;
      request = https.request({ hostname, port: 443, path, method: "GET", agent, headers: { Accept: "*/*", "Accept-Encoding": "identity", Connection: "close" } }, (response) => {
        evidence.status = response.statusCode;
        evidence.contentType = response.headers["content-type"] || "";
        evidence.bytes = 0;
        const body = [];
        response.on("data", (chunk) => {
          evidence.bytes += chunk.length;
          if (evidence.bytes > 1048576) { finish({ code: "DIAGNOSTIC_SIZE_LIMIT" }); return; }
          if (hostname === "api.ipify.org") body.push(chunk);
        });
        response.on("error", finish);
        response.on("end", () => {
          evidence.responseReceived = response.complete;
          if (hostname === "api.ipify.org") {
            try { evidence.egressIp = JSON.parse(Buffer.concat(body).toString("utf8")).ip; } catch { evidence.error = "IP_ECHO_INVALID"; }
          }
          finish();
        });
      });
      request.on("error", finish);
      request.end();
    });
  });
}