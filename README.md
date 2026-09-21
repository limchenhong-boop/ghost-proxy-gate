# Ghost Proxy — Managed Proxy Browser

A browser-like web browsing tool where the **frontend is a browser shell only** and all actual page fetching is handled by a **separate backend service hosted on Render**. The backend routes outbound traffic through a residential proxy, rewrites pages for proxied navigation, and returns browser-safe content to the frontend.

This is a **managed proxy browsing architecture**, not an unrestricted open proxy. Access is authenticated, the proxy is not exposed to end users, and all credentials live server-side.

## Architecture

```
┌─────────────────────────────┐     ┌──────────────────────────────────┐
│  Frontend (Base44 app)      │     │  Backend (Render)                 │
│  Browser shell only         │     │  Proxy + page fetcher             │
│                             │     │                                  │
│  • Tabs, address bar, nav   │     │  • Accepts target URL            │
│  • History, bookmarks       │────▶│  • Routes through residential    │
│  • Settings panel           │     │    proxy (never exposed to FE)  │
│  • Renders proxied HTML     │◀────│  • Fetches page + assets         │
│  • Intercepts in-page nav   │     │  • Rewrites links/assets/CSS     │
│    and sends back to backend│     │  • Handles redirects, cookies    │
│                             │     │  • Returns rewritten HTML        │
│  No direct page fetching    │     │  • SSRF protection, rate limiting │
│  No proxy credentials in FE │     │  • All config in env vars        │
└─────────────────────────────┘     └──────────────────────────────────┘
```

**Frontend → Backend contract:**
- Frontend sends `{ url: "https://example.com", origin: "https://your-app.base44.app" }`
- Backend returns `{ ok: true, html: "<rewritten HTML>", finalUrl: "...", status: 200 }` or `{ ok: false, error: "..." }`

The rewritten HTML includes a client interceptor that:
- Rewrites all sub-resource URLs (images, CSS, JS, XHR) to go through the proxy
- Intercepts link clicks, form submissions, and history changes
- Posts navigation messages to the parent browser shell
- Supports Ctrl/Cmd+click and middle-click to open links in new tabs

## Frontend Setup

The frontend is a Base44 app. No additional setup is needed beyond the Base44 platform.

### Frontend → Backend Communication

The frontend calls the `proxyFetch` Base44 function (via `base44.functions.invoke`), which:
1. Authenticates the user (only logged-in workspace members can use the proxy)
2. Forwards the request to the Render-hosted gateway
3. Returns rewritten HTML to the frontend

The frontend renders the HTML in a sandboxed `srcDoc` iframe. The client interceptor in the HTML posts navigation events back to the parent, which calls `proxyFetch` again for the next page.

### Settings Panel

The browser has a settings panel (gear icon, top-right) where you can set the **Proxy Backend URL** — the URL of your Render-hosted gateway. This is stored in `localStorage` and passed to `proxyFetch` as `gatewayUrl`. If left empty, `proxyFetch` falls back to the `GATEWAY_URL` secret configured in the Base44 dashboard.

## Backend Setup (Render)

The backend is a Node.js gateway server in the `gateway/` directory. It uses [Scramjet](https://github.com/MercuryWorkshop/scramjet) for interception and a residential proxy pool for outbound traffic.

### Deploy to Render

1. Create a new **Web Service** on [Render](https://render.com)
2. Connect this repository
3. Configure:
   - **Build Command:** `cd gateway && npm install`
   - **Start Command:** `cd gateway && node server.js`
   - **Node Version:** 20+
4. Set environment variables (see below)
5. Deploy

### Environment Variables (Render)

| Variable | Required | Description |
|---|---|---|
| `RESIDENTIAL_PROXY` | Yes | Residential proxy URL(s), comma-separated. Format: `http://user:pass@host:port` |
| `GATEWAY_API_KEY` | Yes | API key for gateway authentication. Must match the `GATEWAY_API_KEY` secret in the Base44 app. |
| `PORT` | No | Listen port (default: 8080, Render sets this automatically) |
| `WISP_DIAGNOSTICS` | No | Set to `0` to disable transport diagnostics (default: enabled) |

### Base44 Secrets (Dashboard → Secrets)

| Secret | Required | Description |
|---|---|---|
| `GATEWAY_URL` | Yes | Public URL of your Render gateway (e.g., `https://your-gateway.onrender.com`) |
| `GATEWAY_API_KEY` | Yes | Must match the `GATEWAY_API_KEY` env var on Render |
| `RESIDENTIAL_PROXY` | No | Can also be set here as a fallback (Render env var takes priority) |

## Security

- **Residential proxy credentials** are never exposed to the frontend. They live only in the Render environment.
- **Gateway API key** is shared between the Render env var and the Base44 secret. The frontend never sees it — `proxyFetch` injects it server-side.
- **SSRF protection** — the backend rejects requests to private IP ranges, localhost, and cloud metadata endpoints.
- **Authentication** — only logged-in workspace members can use the proxy. The `proxyFetch` function validates the user on every request.
- **No open proxy** — the gateway does not accept requests from unauthenticated sources. The API key is required on all endpoints.

## Limitations

- **WebSocket features** (real-time chat, live updates) are not supported through the proxy.
- **Anti-bot protected sites** (Google, YouTube, TikTok) may require the residential proxy to be active and healthy.
- **Login-required sites** may render as logged-out due to the stateless proxy environment.
- **Sites with strict CSP** may not fully render even after CSP meta tags are stripped.
- **X-Frame-Options / COOP / COEP** — the proxy rewrites content to be same-origin with the app, so these headers don't apply to the rewritten HTML.

## Reference

The proxy concept is inspired by [whistle](https://github.com/avwo/whistle) — a Node.js proxy and debugging tool. The backend uses [Scramjet](https://github.com/MercuryWorkshop/scramjet) for interception and a Wisp WebSocket transport for full SPA support.

## Disclaimer

This is a managed proxy browsing architecture. It is not an unrestricted open proxy. Access is authenticated, the residential proxy is used only by the backend, and all credentials are isolated server-side. The browser shell provides a familiar browsing experience while maintaining a safe architecture where actual page retrieval is isolated in a separate backend service.