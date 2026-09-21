# Ghost Proxy — Managed Proxy Browser

**The Base44 frontend is only a browser shell. Render is the sole page-fetching service. No AI browser API or frontend-side target-site request is used.**

## Architecture

```
Base44 frontend (browser shell)
    ↓ authenticated request
Render proxy backend
    ↓ residential proxy
Target website
```

The Base44 app is a browser shell only — it handles tabs, address bar, history, bookmarks, and navigation state. It never fetches target websites directly. All page retrieval is handled by a separate backend service hosted on Render, which routes traffic through a residential proxy.

### What the frontend does
- Renders the browser UI (tabs, address bar, back/forward/reload, bookmarks, history)
- Sends the target URL to the Render backend via the `proxyFetch` Base44 function
- Displays only the HTML returned by the Render backend (in a sandboxed `srcDoc` iframe)
- Intercepts in-page navigation (link clicks, form submissions) and sends them back to the Render backend
- Shows backend errors clearly with retry and "open directly" fallback

### What the frontend does NOT do
- Fetch target websites directly
- Use any AI browser API (Browserbase, Browser-Use, etc.)
- Use browser automation (Playwright, Puppeteer)
- Access residential proxy credentials
- Make requests to target domains

### What the Render backend does
- Fetches target URLs through the residential proxy
- Handles redirects, cookies, and sessions
- Rewrites HTML links, CSS, JavaScript, image, font, and asset URLs
- Processes navigation requests
- Returns rewritten, browser-safe content to the Base44 frontend
- Protects against SSRF and abuse

## Backend Contract

### Page fetch
```
POST /fetch  (called by the proxyFetch Base44 function)
Request:  { "url": "https://example.com", "method": "GET" }
Response: { "ok": true, "body": "<html>", "finalUrl": "https://example.com/", "contentType": "text/html", "status": 200 }
```

### Resource fetch
```
GET /raw?url=<encoded-target-url>  (called by the proxyFetch function for sub-resources)
Returns the proxied resource with permissive CORS and cache headers.
```

Every proxied page, link, form, stylesheet, script, image, and redirect resolves through the Render backend. Rewritten pages never escape back to the original target domain.

## Environment Variables

### Render backend (environment variables only)
| Variable | Required | Description |
|---|---|---|
| `RESIDENTIAL_PROXY` | Yes | Residential proxy URL(s), comma-separated. Format: `http://user:pass@host:port` |
| `GATEWAY_API_KEY` | Yes | API key for backend authentication. Must match the Base44 `GATEWAY_API_KEY` secret. |
| `PORT` | No | Listen port (default: 8080, Render sets this automatically) |

### Base44 secrets (Dashboard → Secrets)
| Secret | Required | Description |
|---|---|---|
| `PROXY_BACKEND_URL` | Yes* | Public URL of your Render backend (e.g., `https://your-service.onrender.com`) |
| `GATEWAY_API_KEY` | Yes | Must match the `GATEWAY_API_KEY` env var on Render |

*If `PROXY_BACKEND_URL` is not set, the system falls back to the legacy `GATEWAY_URL` secret.

### Variables that must NEVER be in the frontend
- `RESIDENTIAL_PROXY_HOST`
- `RESIDENTIAL_PROXY_PORT`
- `RESIDENTIAL_PROXY_USERNAME`
- `RESIDENTIAL_PROXY_PASSWORD`

These credentials exist only in Render environment variables.

## Diagnostic Mode

The browser shell includes a diagnostic mode (Activity icon, top-right) that displays:
- The exact backend endpoint being called
- The response status
- Whether the response came from the Render backend
- Whether an AI/browser API was called (always "No")

The diagnostic mode reports an error if any target website or browser-agent API is called directly from the frontend. Since the `proxyFetch` function only forwards to the Render backend and never fetches target sites directly, this check always passes.

## Settings Panel

The settings panel (gear icon, top-right) lets you set the **Proxy Backend URL** — the URL of your Render-hosted backend. This is stored in `localStorage` and passed to the `proxyFetch` function as `gatewayUrl`. If left empty, the function uses the `PROXY_BACKEND_URL` (or `GATEWAY_URL`) secret.

## Security

- **Residential proxy credentials** are never exposed to the frontend. They live only in the Render environment.
- **Gateway API key** is shared between the Render env var and the Base44 secret. The frontend never sees it — `proxyFetch` injects it server-side.
- **SSRF protection** — the backend rejects requests to private IP ranges, localhost, and cloud metadata endpoints.
- **Authentication** — only logged-in workspace members can use the proxy.
- **No open proxy** — the backend does not accept unauthenticated requests.

## Disclaimer

This is a managed proxy browsing architecture, not an unrestricted open proxy. The Base44 frontend is only a browser shell. Render is the sole page-fetching service. No AI browser API or frontend-side target-site request is used. Access is authenticated, the residential proxy is used only by the backend, and all credentials are isolated server-side.