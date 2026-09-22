# Ghost Proxy — Cloudflare Worker gateway

A free, always-on replacement for the Render Node gateway. Matches the exact
`/fetch`, `/raw`, `/health` contract the Base44 `proxyFetch` function expects,
so no frontend or function code changes are needed.

## Deploy (5 minutes)

1. Go to **https://dash.cloudflare.com** → **Workers & Pages** → **Create application** → **Create Worker**.
2. Name it (e.g. `ghost-gateway`) and click **Deploy**.
3. Click **Edit code**, paste the contents of `worker.js`, and **Save and deploy**.
4. Copy your Worker URL (e.g. `https://ghost-gateway.<your-subdomain>.workers.dev`).
5. In the Worker's **Settings → Variables**, add:
   - `GATEWAY_API_KEY` = the same key you use in the Base44 app secret.
6. In your Base44 app **Secrets**, set:
   - `GATEWAY_URL` = your Worker URL (e.g. `https://ghost-gateway.xxx.workers.dev`)
   - `GATEWAY_API_KEY` = the matching key.

That's it — the browser will now fetch through the Worker.

## How it works

- `POST /fetch` — fetches a page, returns `{ ok, body, finalUrl, contentType, status }` as JSON. The Base44 `proxyFetch` function rewrites the HTML and injects it into the browser tab.
- `GET /raw?url=...` — streams a sub-resource (JS/CSS/images/fonts) with permissive CORS so the proxied document can load it.
- `GET /health` — liveness check used by the app on startup.

## Limitations vs the Render gateway

- **No residential proxy egress.** Cloudflare Workers fetch from Cloudflare's
  edge IPs — they cannot route through an HTTP/CONNECT residential proxy.
  Basic sites work; anti-bot sites (TikTok, Instagram, etc.) that block
  datacenter IPs will fail and fall back to "Open directly".
- **Free-tier limits:** 100k requests/day, 10ms CPU per request. The Worker
  only fetches and returns bytes (no heavy rewriting — that stays in
  `proxyFetch`), so CPU is rarely the bottleneck.
- **No WebSocket transport.** The Wisp/Scramjet interactive transport from the
  Render gateway is not available; the Worker is a fetch-and-rewrite proxy only.

## Files

- `worker.js` — the Worker code (paste into the Cloudflare editor).