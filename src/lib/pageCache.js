// In-memory page cache so back/forward and repeat visits render instantly
// instead of doing another Base44 -> Render -> residential-proxy round trip.
// Memory only (never persisted) so nothing browsed is written to disk.

const MAX_ENTRIES = 30;
const TTL_MS = 5 * 60 * 1000;

const cache = new Map(); // url -> { html, finalUrl, title, at }

export function getCachedPage(url) {
  if (!url) return null;
  const hit = cache.get(url);
  if (!hit) return null;
  if (Date.now() - hit.at > TTL_MS) {
    cache.delete(url);
    return null;
  }
  // refresh recency
  cache.delete(url);
  cache.set(url, hit);
  return hit;
}

export function setCachedPage(url, entry) {
  if (!url || !entry?.html) return;
  cache.delete(url);
  cache.set(url, { ...entry, at: Date.now() });
  while (cache.size > MAX_ENTRIES) {
    cache.delete(cache.keys().next().value);
  }
}

export function clearPageCache() {
  cache.clear();
}