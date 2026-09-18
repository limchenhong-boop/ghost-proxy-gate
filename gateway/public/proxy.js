"use strict";

// Ghost Proxy — Scramjet proxy page
// Opened as a top-level isolated document by the unchanged Base44 launcher.
// Reads the target URL, registers the service worker, sets up the libcurl transport
// over Wisp, creates a Scramjet frame, and navigates to the target.

const params = new URLSearchParams(location.search);
const targetUrl = params.get("url") || "";
const returnUrl = params.get("return");
if (returnUrl) {
  try {
    const home = new URL(returnUrl);
    if (home.protocol === "https:" && !home.username && !home.password) document.getElementById("vp-home").href = home.href;
  } catch { /* Keep the known app homepage when the return address is invalid. */ }
}

function showError(msg) {
  const el = document.getElementById("vp-error");
  document.getElementById("vp-error-msg").textContent = msg;
  el.style.display = "flex";
  document.getElementById("vp-loading").classList.add("hidden");
}

function hideLoading() {
  document.getElementById("vp-loading").classList.add("hidden");
}

function search(input, template) {
  try { return new URL(input).toString(); } catch {}
  try {
    const u = new URL("http://" + input);
    if (u.hostname.includes(".")) return u.toString();
  } catch {}
  return template.replace("%s", encodeURIComponent(input));
}

async function init() {
  if (!targetUrl) { showError("No URL provided."); return; }
  const url = search(targetUrl, "https://duckduckgo.com/html/?q=%s");
  if (!/^https?:\/\//i.test(url)) { showError("Only HTTP and HTTPS websites are supported."); return; }
  if (window.top !== window.self || !crossOriginIsolated || typeof SharedArrayBuffer === "undefined") {
    showError("Scramjet requires a top-level gateway page with cross-origin isolation; it cannot run inside a cross-origin embed.");
    return;
  }
  if (!navigator.serviceWorker) { showError("This browser does not support service workers."); return; }
  let stage = "Scramjet configuration";
  try {
    // Create IndexedDB stores/config BEFORE the worker's cookie jar opens them.
    const { ScramjetController } = $scramjetLoadController();
    const scramjet = new ScramjetController({
      prefix: self.GHOST_CONFIG.prefix,
      files: { wasm: "/scram/scramjet.wasm.wasm", all: "/scram/scramjet.all.js", sync: "/scram/scramjet.sync.js" },
    });
    await scramjet.init();
    stage = "service worker activation";
    await navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" });
    await navigator.serviceWorker.ready;
    if (!navigator.serviceWorker.controller) {
      await new Promise((resolve) => {
        const done = () => { navigator.serviceWorker.removeEventListener("controllerchange", done); resolve(); };
        navigator.serviceWorker.addEventListener("controllerchange", done);
        if (navigator.serviceWorker.controller) done();
      });
    }
    stage = "BareMux/libcurl transport";
    const wispUrl = `${location.protocol === "https:" ? "wss:" : "ws:"}//${location.host}/wisp/`;
    const connection = new BareMux.BareMuxConnection("/baremux/worker.js");
    await connection.setTransport("/libcurl/index.mjs", [{ websocket: wispUrl }]);
    stage = "Scramjet navigation";
    const frame = scramjet.createFrame();
    frame.frame.id = "sj-frame";
    frame.frame.style.cssText = "width:100vw;height:100vh;border:none;display:block";
    frame.frame.addEventListener("load", hideLoading, { once: true });
    document.body.appendChild(frame.frame);
    frame.go(url);
  } catch {
    showError(`Failed during ${stage}. Check the developer transport diagnostics; no HTML-only or direct-site fallback was used.`);
  }
}

init();