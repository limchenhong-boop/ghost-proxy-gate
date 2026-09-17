export function normalizeQuery(input) {
  const s = (input || "").trim();
  if (!s) return null;
  if (/^https?:\/\//i.test(s)) return s;
  // looks like a domain (has a dot, no spaces)
  if (!/\s/.test(s) && /^[\w-]+(\.[\w-]+)+([/:?#].*)?$/i.test(s)) {
    return "https://" + s;
  }
  // otherwise treat as a search query — use DuckDuckGo's lite HTML endpoint,
  // which is pure HTML (no JS) and renders reliably through the proxy so the
  // results are actually visible.
  return "https://html.duckduckgo.com/html/?q=" + encodeURIComponent(s);
}

export function prettyUrl(url) {
  try {
    const u = new URL(url);
    return u.hostname.replace(/^www\./, "") + (u.pathname === "/" ? "" : u.pathname);
  } catch {
    return url;
  }
}