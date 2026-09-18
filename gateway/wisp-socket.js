import { connectTunnel } from "./connect-tunnel.js";

// Socket contract verified against wisp-js 0.4.1 ServerStream / NodeTCPSocket.
// TLS belongs to libcurl, not this server: never parse or rewrite tunnel bytes.
export default function socketForSession(session, trace) {
  return class ResidentialTCPSocket {
    constructor(hostname, port) {
      this.hostname = hostname;
      this.port = port;
      this.socket = null;
      this.closed = false;
      this.queue = [];
      this.waiter = null;
      this.report = { targetHost: hostname, targetPort: port, transport: "http-connect", upstream: session.upstream.id, method: "opaque TCP (TLS stays in libcurl)", receivedBytes: 0, sentBytes: 0, stage: "created" };
      trace.streams.push(this.report);
      if (trace.streams.length > 200) trace.streams.shift();
    }
    log(label, extra = {}) {
      if (process.env.WISP_DIAGNOSTICS !== "0" || label === "WISP ERROR") console.log(`[${label}]`, JSON.stringify({ connection: trace.id, session: session.cookie.split(".")[0], ...this.report, ...extra }));
    }
    async connect() {
      this.log("WISP REQUEST");
      try {
        const socket = await connectTunnel(session.upstream, this.hostname, this.port, this.report);
        if (this.closed) { socket.destroy(); return; }
        this.socket = socket;
        socket.on("data", (data) => {
          this.report.receivedBytes += data.length;
          if (this.waiter) { const resolve = this.waiter; this.waiter = null; resolve(data); }
          else { this.queue.push(data); socket.pause(); }
        });
        socket.on("error", (error) => { this.report.error = error.code || "TUNNEL_ERROR"; this.log("WISP ERROR"); });
        socket.once("close", () => {
          this.closed = true;
          if (this.waiter) { this.waiter(null); this.waiter = null; }
          this.log("WISP RESPONSE", { status: "opaque TLS", contentType: "opaque TLS", responseSize: this.report.receivedBytes, sizeUnit: "tunnel bytes, not HTTP body" });
        });
        this.log("WISP CONNECT", { connectStatus: this.report.connectStatus });
        socket.resume();
      } catch (error) {
        this.report.error = error.code || "CONNECT_FAILED";
        this.log("WISP ERROR");
        throw new Error(this.report.error); // Never propagate credential-bearing errors.
      }
    }
    recv() {
      if (this.queue.length) return Promise.resolve(this.queue.shift());
      if (this.closed) return Promise.resolve(null);
      return new Promise((resolve) => { this.waiter = resolve; this.socket?.resume(); });
    }
    send(data) {
      if (!this.socket || this.closed) return Promise.reject(new Error("TUNNEL_CLOSED"));
      this.report.sentBytes += data.length;
      return new Promise((resolve, reject) => this.socket.write(data, (error) => error ? reject(new Error("TUNNEL_WRITE_FAILED")) : resolve()));
    }
    pause() { this.socket?.pause(); }
    resume() { if (!this.queue.length && !this.closed) this.socket?.resume(); }
    close() {
      this.closed = true;
      this.socket?.destroy();
      this.queue = [];
      if (this.waiter) { this.waiter(null); this.waiter = null; }
    }
  };
}