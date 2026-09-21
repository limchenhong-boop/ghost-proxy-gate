// Browser settings — stored in localStorage. The PROXY_BACKEND_URL lets the
// user point the browser shell at their own Render-hosted proxy backend
// without changing Base44 secrets. If empty, proxyFetch falls back to the
// GATEWAY_URL secret configured in the dashboard.

const BACKEND_URL_KEY = "ghost_proxy_backend_url";

export function loadBackendUrl() {
  try { return localStorage.getItem(BACKEND_URL_KEY) || ""; } catch { return ""; }
}

export function saveBackendUrl(url) {
  try { localStorage.setItem(BACKEND_URL_KEY, url); } catch {}
}