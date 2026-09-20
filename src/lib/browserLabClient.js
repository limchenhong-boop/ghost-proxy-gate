// Browser-Lab client — manages one browser session's CDP (WebSocket) + WebRTC
// (WHIP data channel) connections. This is the core abstraction layer:
// navigation, mouse, keyboard, and scroll are forwarded to the real remote
// Chromium instance via CDP. The browser viewport is streamed as JPEG frames
// over a WebRTC data channel and drawn to a canvas.
//
// Browser-Lab API (github.com/snakecased/browser-lab):
//   POST   /sessions/{id}/whip  — WHIP SDP offer → 201 + SDP answer
//   WS     /sessions/{id}/cdp   — CDP WebSocket proxy
//   DELETE /sessions/{id}/whip/{resourceId} — terminate WHIP resource

import { base44 } from "@/api/base44Client";

const STUN_SERVERS = [
  { urls: "stun:stun.l.google.com:19302" },
  { urls: "stun:stun.cloudflare.com:3478" },
];

// Windows Virtual Key codes for CDP Input.dispatchKeyEvent
const VK_MAP = {
  Enter: 13, Backspace: 8, Tab: 9, Escape: 27,
  ArrowUp: 38, ArrowDown: 40, ArrowLeft: 37, ArrowRight: 39,
  " ": 32, Delete: 46, Home: 36, End: 35, PageUp: 33, PageDown: 34,
  Shift: 16, Control: 17, Alt: 18, Meta: 91, CapsLock: 20,
  F1: 112, F2: 113, F3: 114, F4: 115, F5: 116, F6: 117, F7: 118, F8: 119, F9: 120, F10: 121, F11: 122, F12: 123,
};

export function getVKCode(key) {
  if (VK_MAP[key]) return VK_MAP[key];
  if (key.length === 1) {
    const c = key.toUpperCase().charCodeAt(0);
    if (c >= 65 && c <= 90) return c;       // A-Z
    if (c >= 48 && c <= 57) return c;       // 0-9
  }
  return 0;
}

export function getModifiers(e) {
  return (e.altKey ? 1 : 0) | (e.ctrlKey ? 2 : 0) | (e.metaKey ? 4 : 0) | (e.shiftKey ? 8 : 0);
}

export async function createBrowserLabSession(durationMinutes = 30) {
  const resp = await base44.functions.invoke("browserLabSession", { action: "create", durationMinutes });
  return resp.data;
}

export async function deleteBrowserLabSession(sessionId) {
  await base44.functions.invoke("browserLabSession", { action: "delete", sessionId });
}

export class BrowserSession {
  constructor({ sessionId, cdpUrl, whipUrl, onStateChange, onDisconnect }) {
    this.sessionId = sessionId;
    this.cdpUrl = cdpUrl;
    this.whipUrl = whipUrl;
    this.onStateChange = onStateChange || (() => {});
    this.onDisconnect = onDisconnect || (() => {});

    this.pc = null;
    this.dc = null;
    this.ws = null;
    this.whipResourceUrl = null;
    this.cdpId = 0;
    this.cdpCallbacks = new Map();
    this.frameBuffer = null;
    this.lastFrame = null;
    this._frameCallback = null;
    this.browserWidth = 1280;
    this.browserHeight = 720;

    this.state = {
      url: "", title: "", loading: false,
      canGoBack: false, canGoForward: false, connected: false,
    };
  }

  _update(patch) {
    Object.assign(this.state, patch);
    this.onStateChange({ ...this.state });
  }

  async connect(initialUrl) {
    await this._connectCDP();
    await this._connectWebRTC();
    this._update({ connected: true });
    // Override the server's demo auto-navigate to google.com.
    await this.navigate(initialUrl || "about:blank");
  }

  _connectCDP() {
    return new Promise((resolve, reject) => {
      try {
        this.ws = new WebSocket(this.cdpUrl);
      } catch (e) {
        reject(new Error("Invalid CDP URL"));
        return;
      }
      const timeout = setTimeout(() => reject(new Error("CDP connection timed out")), 15000);
      this.ws.onopen = () => {
        clearTimeout(timeout);
        this._send("Page.enable");
        this._send("Runtime.enable");
        resolve();
      };
      this.ws.onmessage = (ev) => {
        try { this._handleCDP(JSON.parse(ev.data)); } catch {}
      };
      this.ws.onerror = () => { clearTimeout(timeout); reject(new Error("CDP connection failed")); };
      this.ws.onclose = () => {
        this._update({ connected: false });
        this.onDisconnect();
      };
    });
  }

  _send(method, params = {}) {
    const id = ++this.cdpId;
    return new Promise((resolve, reject) => {
      if (!this.ws || this.ws.readyState !== 1) { reject(new Error("CDP not connected")); return; }
      this.cdpCallbacks.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  async _handleCDP(msg) {
    if (msg.id && this.cdpCallbacks.has(msg.id)) {
      const cb = this.cdpCallbacks.get(msg.id);
      this.cdpCallbacks.delete(msg.id);
      if (msg.error) cb.reject(new Error(msg.error?.message || "CDP error"));
      else cb.resolve(msg.result);
      return;
    }
    if (msg.method === "Page.frameNavigated") {
      const url = msg.params?.frame?.url;
      if (url && url !== "about:blank") {
        this._update({ url, loading: true });
        try {
          const r = await this._send("Runtime.evaluate", { expression: "document.title" });
          if (r?.result?.value) this._update({ title: r.result.value });
        } catch {}
        this._refreshNavState();
      }
    }
    if (msg.method === "Page.lifecycleEvent") {
      if (msg.params?.name === "load") this._update({ loading: false });
    }
  }

  async _refreshNavState() {
    try {
      const h = await this._send("Page.getNavigationHistory");
      this._update({
        canGoBack: h.currentIndex > 0,
        canGoForward: h.currentIndex < h.entries.length - 1,
      });
    } catch {}
  }

  async _connectWebRTC() {
    this.pc = new RTCPeerConnection({ iceServers: STUN_SERVERS });
    this.dc = this.pc.createDataChannel("screencast");
    this.dc.onmessage = (ev) => this._handleFrame(ev.data);

    const offer = await this.pc.createOffer();
    await this.pc.setLocalDescription(offer);
    await new Promise((resolve) => {
      if (this.pc.iceGatheringState === "complete") return resolve();
      const check = () => { if (this.pc.iceGatheringState === "complete") { this.pc.removeEventListener("icegatheringstatechange", check); resolve(); } };
      this.pc.addEventListener("icegatheringstatechange", check);
      setTimeout(() => { this.pc.removeEventListener("icegatheringstatechange", check); resolve(); }, 10000);
    });

    const resp = await fetch(this.whipUrl, {
      method: "POST",
      headers: { "Content-Type": "application/sdp" },
      body: this.pc.localDescription.sdp,
    });
    if (!resp.ok) throw new Error("WebRTC negotiation failed (" + resp.status + ")");
    this.whipResourceUrl = resp.headers.get("Location");
    if (this.whipResourceUrl && !/^https?:/.test(this.whipResourceUrl)) {
      this.whipResourceUrl = new URL(this.whipResourceUrl, this.whipUrl).href;
    }
    const answer = await resp.text();
    await this.pc.setRemoteDescription({ type: "answer", sdp: answer });
  }

  _handleFrame(data) {
    if (typeof data === "string") {
      try {
        const msg = JSON.parse(data);
        if (msg.type === "frame-start") {
          this.frameBuffer = { total: msg.size, received: 0, buf: new Uint8Array(msg.size) };
        }
      } catch {}
    } else {
      if (!this.frameBuffer) return;
      const chunk = new Uint8Array(data);
      this.frameBuffer.buf.set(chunk, this.frameBuffer.received);
      this.frameBuffer.received += chunk.length;
      if (this.frameBuffer.received >= this.frameBuffer.total) {
        const blob = new Blob([this.frameBuffer.buf], { type: "image/jpeg" });
        const url = URL.createObjectURL(blob);
        const img = new Image();
        img.onload = () => { this.lastFrame = img; this._frameCallback?.(img); URL.revokeObjectURL(url); };
        img.src = url;
        this.frameBuffer = null;
      }
    }
  }

  // --- Navigation ---
  async navigate(url) {
    this._update({ loading: true, url: url === "about:blank" ? "" : url });
    await this._send("Page.navigate", { url });
    this._refreshNavState();
  }
  async goBack() { const h = await this._send("Page.getNavigationHistory"); if (h.currentIndex > 0) await this._send("Page.navigateToHistoryEntry", { entryId: h.entries[h.currentIndex - 1].id }); this._refreshNavState(); }
  async goForward() { const h = await this._send("Page.getNavigationHistory"); if (h.currentIndex < h.entries.length - 1) await this._send("Page.navigateToHistoryEntry", { entryId: h.entries[h.currentIndex + 1].id }); this._refreshNavState(); }
  async reload() { this._update({ loading: true }); await this._send("Page.reload"); }
  async stop() { await this._send("Page.stopLoading"); }

  // --- Mouse ---
  async mouseMove(x, y) { await this._send("Input.dispatchMouseEvent", { type: "mouseMoved", x: Math.round(x), y: Math.round(y) }); }
  async mouseDown(x, y, button = "left") { await this._send("Input.dispatchMouseEvent", { type: "mousePressed", x: Math.round(x), y: Math.round(y), button, clickCount: 1 }); }
  async mouseUp(x, y, button = "left") { await this._send("Input.dispatchMouseEvent", { type: "mouseReleased", x: Math.round(x), y: Math.round(y), button, clickCount: 1 }); }
  async scroll(x, y, deltaX, deltaY) { await this._send("Input.dispatchMouseEvent", { type: "mouseWheel", x: Math.round(x), y: Math.round(y), deltaX: Math.round(deltaX), deltaY: Math.round(deltaY) }); }

  // --- Keyboard ---
  async sendKey(type, params) { await this._send("Input.dispatchKeyEvent", { type, ...params }); }

  async disconnect() {
    if (this.whipResourceUrl) { try { await fetch(this.whipResourceUrl, { method: "DELETE" }); } catch {} }
    try { this.dc?.close(); } catch {}
    try { this.pc?.close(); } catch {}
    try { this.ws?.close(); } catch {}
    this.pc = null; this.dc = null; this.ws = null; this.connected = false;
  }
}