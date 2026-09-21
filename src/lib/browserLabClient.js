// Browser-Lab client — owns one session's CDP (WebSocket) + WHIP (WebRTC)
// connections. Navigation, mouse, keyboard and scroll are forwarded to the real
// remote Chromium instance over CDP. The viewport arrives either as a WebRTC
// video track or as JPEG frames on a data channel, depending on server build.
//
// Browser-Lab API (github.com/snakecased/browser-lab):
//   WS     /sessions/{id}/cdp    — CDP WebSocket proxy
//   POST   /sessions/{id}/whip   — SDP offer -> 201 + SDP answer (Location header)
//   DELETE {whip resource}       — terminate the WHIP resource

const STUN_SERVERS = [
  { urls: "stun:stun.l.google.com:19302" },
  { urls: "stun:stun.cloudflare.com:3478" },
];

export default class BrowserLabClient {
  constructor(baseUrl, sessionId) {
    this.baseUrl = String(baseUrl).replace(/\/$/, "");
    this.sessionId = sessionId;
    this.ws = null;
    this.pc = null;
    this.whipResource = null;
    this.msgId = 0;
    this.pending = new Map();
    this.closed = false;
    // Consumer callbacks
    this.onFrame = null;   // (ArrayBuffer) JPEG frame
    this.onStream = null;  // (MediaStream) WebRTC video
    this.onUrl = null;     // (string)
    this.onLoading = null; // (boolean)
    this.onClose = null;   // ()
  }

  async connect() {
    await this.openCdp();
    await this.openWhip();
  }

  openCdp() {
    const wsUrl = this.baseUrl.replace(/^http/i, "ws") + "/sessions/" + encodeURIComponent(this.sessionId) + "/cdp";
    return new Promise((resolve, reject) => {
      let settled = false;
      const ws = new WebSocket(wsUrl);
      this.ws = ws;
      const timer = setTimeout(() => {
        if (!settled) { settled = true; try { ws.close(); } catch { /* ignore */ } reject(new Error("The Browser-Lab engine did not respond.")); }
      }, 15000);

      ws.onopen = () => {
        settled = true;
        clearTimeout(timer);
        this.send("Page.enable").catch(() => {});
        resolve();
      };
      ws.onerror = () => {
        if (!settled) { settled = true; clearTimeout(timer); reject(new Error("Could not connect to the Browser-Lab engine.")); }
      };
      ws.onclose = () => { if (!this.closed) this.onClose?.(); };
      ws.onmessage = (e) => this.handleCdpMessage(e.data);
    });
  }

  handleCdpMessage(raw) {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }
    if (msg.id && this.pending.has(msg.id)) {
      const { resolve, reject } = this.pending.get(msg.id);
      this.pending.delete(msg.id);
      if (msg.error) reject(new Error(msg.error.message || "CDP error"));
      else resolve(msg.result);
      return;
    }
    if (msg.method === "Page.frameNavigated" && msg.params?.frame && !msg.params.frame.parentId) {
      this.onUrl?.(msg.params.frame.url);
    } else if (msg.method === "Page.frameStartedLoading") {
      this.onLoading?.(true);
    } else if (msg.method === "Page.loadEventFired" || msg.method === "Page.frameStoppedLoading") {
      this.onLoading?.(false);
    }
  }

  send(method, params) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return Promise.reject(new Error("The Browser-Lab engine is not connected."));
    }
    const id = ++this.msgId;
    this.ws.send(JSON.stringify({ id, method, params: params || {} }));
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      setTimeout(() => {
        if (this.pending.has(id)) { this.pending.delete(id); reject(new Error("Browser-Lab request timed out.")); }
      }, 20000);
    });
  }

  async openWhip() {
    const pc = new RTCPeerConnection({ iceServers: STUN_SERVERS });
    this.pc = pc;

    pc.ontrack = (e) => { if (e.streams?.[0]) this.onStream?.(e.streams[0]); };
    pc.ondatachannel = (e) => this.bindChannel(e.channel);
    this.bindChannel(pc.createDataChannel("frames"));
    pc.addTransceiver("video", { direction: "recvonly" });

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);

    const resp = await fetch(this.baseUrl + "/sessions/" + encodeURIComponent(this.sessionId) + "/whip", {
      method: "POST",
      headers: { "content-type": "application/sdp" },
      body: pc.localDescription.sdp,
    });
    if (!resp.ok) throw new Error("The Browser-Lab viewport stream could not be started (HTTP " + resp.status + ").");

    const location = resp.headers.get("location");
    if (location) this.whipResource = new URL(location, this.baseUrl).href;
    const answer = await resp.text();
    await pc.setRemoteDescription({ type: "answer", sdp: answer });
  }

  bindChannel(channel) {
    if (!channel) return;
    channel.binaryType = "arraybuffer";
    channel.onmessage = (e) => {
      if (typeof e.data === "string") return;
      this.onFrame?.(e.data);
    };
  }

  // --- Page control -------------------------------------------------------
  navigate(url) { return this.send("Page.navigate", { url }); }
  reload() { return this.send("Page.reload", { ignoreCache: true }); }
  stop() { return this.send("Page.stopLoading").catch(() => {}); }
  goBack() { return this.send("Runtime.evaluate", { expression: "history.back()" }); }
  goForward() { return this.send("Runtime.evaluate", { expression: "history.forward()" }); }

  setViewport(width, height) {
    return this.send("Emulation.setDeviceMetricsOverride", {
      width: Math.round(width), height: Math.round(height),
      deviceScaleFactor: window.devicePixelRatio || 1, mobile: false,
    }).catch(() => {});
  }

  // --- Input --------------------------------------------------------------
  mouse(type, x, y, { button = "left", clickCount = 1, modifiers = 0 } = {}) {
    return this.send("Input.dispatchMouseEvent", {
      type, x: Math.round(x), y: Math.round(y),
      button: type === "mouseMoved" ? "none" : button,
      clickCount: type === "mouseMoved" ? 0 : clickCount,
      modifiers,
    }).catch(() => {});
  }

  wheel(x, y, deltaX, deltaY, modifiers = 0) {
    return this.send("Input.dispatchMouseEvent", {
      type: "mouseWheel", x: Math.round(x), y: Math.round(y),
      deltaX, deltaY, button: "none", modifiers,
    }).catch(() => {});
  }

  key(type, { key, code, vk, text, modifiers = 0 }) {
    return this.send("Input.dispatchKeyEvent", {
      type, key, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk,
      modifiers, ...(text ? { text, unmodifiedText: text } : {}),
    }).catch(() => {});
  }

  insertText(text) { return this.send("Input.insertText", { text }).catch(() => {}); }

  close() {
    this.closed = true;
    this.pending.clear();
    try { this.ws?.close(); } catch { /* ignore */ }
    try { this.pc?.close(); } catch { /* ignore */ }
    if (this.whipResource) fetch(this.whipResource, { method: "DELETE" }).catch(() => {});
    this.ws = null;
    this.pc = null;
  }
}