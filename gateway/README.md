# Ghost Proxy gateway — Wisp CONNECT transport

## Verification status

**Code reworked; NOT deployed or end-to-end verified by this change. No passing live Wisp, residential egress, or browser-render test is claimed.**

The prior example.com / YouTube HTML fetch tests exercised proxyFetch, not Scramjet/Wisp, and were not evidence of working dynamic content.

## What was broken (source evidence)

1. `src/pages/Home.jsx` called proxyFetch for HTML and injected srcDoc. The current browser flow did not use Scramjet, its cookie store, service worker, BareMux, libcurl, or Wisp at all.
2. `gateway/server.js` called `wisp.routeRequest(req, socket, head)` without a TCPSocket option. Wisp 0.4.1's default NodeTCPSocket creates a direct net.Socket. The residential ProxyAgent in residential.js only served /fetch and /raw.
3. The gateway exempted proxy.html from COOP/COEP, preventing the isolated context needed by libcurl. Cross-origin iframe embedding could not repair that.
4. proxy.js did not await Scramjet initialization or service-worker activation and concealed loading after a timer rather than a frame event.
5. There were two server entrypoints; src/gateway had no corresponding public assets and no residential route registration.

## Inspected API — not a guessed proxy option

The project declared `@mercuryworkshop/wisp-js: ^0.4.1`. Neither its node_modules nor a gateway lockfile was available here; the exact Render-installed version could NOT be inspected.

The published **0.4.1** source was inspected at:
- https://unpkg.com/@mercuryworkshop/wisp-js@0.4.1/src/server/http.mjs
- https://unpkg.com/@mercuryworkshop/wisp-js@0.4.1/src/server/connection.mjs
- https://unpkg.com/@mercuryworkshop/wisp-js@0.4.1/src/server/net.mjs
- https://unpkg.com/@mercuryworkshop/wisp-js@0.4.1/src/server/options.mjs

`routeRequest(request, socket, head, conn_options)` forwards its fourth argument to ServerConnection, whose TCPSocket option defaults to NodeTCPSocket. ServerStream calls connect/recv/send/close/pause/resume. No HTTP-upstream URL option exists in options.mjs. The dependency is now pinned to 0.4.1 and startup checks the actual installed version.

Scramjet v1.1.0 controller/worker/fetch source and libcurl-transport 1.5.2 documentation were also inspected. Cookie handling, header rewriting, redirects and MIME-specific rewriting remain with those libraries, not a new HTML fetcher.

## New production path

Base44 launcher -> top-level HTTPS gateway/proxy.html -> Scramjet rewriting and service worker -> BareMux/libcurl -> /wisp/ WebSocket -> Wisp ServerStream -> custom TCPSocket -> HTTP(S) CONNECT to selected residential endpoint -> validated destination IP.

There is **no direct Wisp fallback**. Missing/invalid residential configuration fails startup. CONNECT rejection fails the Wisp stream instead of silently bypassing the proxy. Binary bytes, compressed payloads, TLS, and streaming content are passed unmodified through the tunnel. TLS remains between libcurl and the destination; the proxy credentials authenticate only the server-to-upstream CONNECT request.

The pool uses the existing RESIDENTIAL_PROXY variable and existing URL/provider-list formats. A new gateway browsing session selects the next endpoint round-robin; a signed HttpOnly cookie preserves that selection on reconnects. Every stream in one Wisp connection uses that endpoint. Provider-side automatic IP rotation can STILL change egress per CONNECT: the provider must supply a sticky-session endpoint/account if a stable exit IP is required.

The legacy authenticated /fetch and /raw routes remain for compatibility but are no longer used for browsing. They are NOT transport evidence.

## Deployment requirements

- Render root directory: `gateway` (the canonical server and dependency tree).
- Build: `npm install`; start: `node server.js`; Node 20 or later.
- Retain GATEWAY_API_KEY and RESIDENTIAL_PROXY in Render's environment. Secrets configured only in Base44 do not automatically configure Render.
- WISP_DIAGNOSTICS defaults to enabled for this investigation; set `0` afterward to disable detailed transport telemetry.
- GATEWAY_URL in Base44 must point at this reachable HTTPS gateway.
- The launcher requires health build `scramjet-v6-wisp-connect` and Wisp `0.4.1` before launching. A not-yet-deployed gateway produces an in-app error instead of running the old architecture.
- Render must allow the public /wisp/ WebSocket upgrade. The production handler retains Wisp pings and has no post-CONNECT inactivity deadline.
- A network-filtered gateway domain cannot be repaired with JavaScript. Use an approved reachable gateway/custom domain; this code does not guarantee that network or browser policies will permit it.
- Embedded Base44/Google Sites previews open the gateway in its own tab; libcurl requires a top-level isolated document. The home launcher styling/controls and gateway Home control are retained.

## Developer-only diagnostics

Open the gateway's `/diagnostics` over HTTPS. HTTP Basic authentication uses username `admin` and the existing GATEWAY_API_KEY as the password; never share this secret with end users. Residential usernames/passwords are not sent to the browser. Authentication also guards the run endpoint and diagnostic script; no wildcard static route bypasses it.

**Run Wisp / TLS tests** creates a real Wisp client and opens a local WebSocket through the same production upgrade handler and TCPSocket adapter. Its two fixed destinations are example.com and api.ipify.org. Node TLS is layered on Wisp streams, with certificate verification enabled, and HTTP cannot open a separate destination socket. The response includes:
- Backend: endpoint reached.
- Wisp: actual protocol handshake completed.
- Outbound transport: both streams selected http-connect and the same upstream ID.
- Upstream proxy: both selected upstreams returned CONNECT 200.
- Destination request: verified TLS and successful HTTP responses.
- Response received: complete nonempty HTTP responses returned through Wisp.
- Evidence: per-stream stage, DNS completion, upstream ID, CONNECT status, transmitted/received tunnel bytes; destination status/MIME/body byte counts; IP echo if successful.

**Test public WebSocket round trip** separately uses the developer's actual browser -> public /wisp/ -> production adapter -> example.com:80 -> Wisp response. It proves an external upgrade and returned HTTP headers, NOT page rendering or TLS by itself. The server test covers TLS. Neither test invokes /fetch or /raw.

Health configuration is not proof of egress. Only actual successful diagnostic results are evidence. Every diagnostic run has deadlines, fixed destinations and bounded responses. No pre-populated PASS results are shown before running.

## Logging and limitations

Server logs include `[WISP REQUEST]`, `[WISP CONNECT]`, `[WISP RESPONSE]`, `[WISP ERROR]` with connection/session identifiers, host, port, upstream ordinal, CONNECT stage/status and byte counts. Errors use sanitized codes rather than credential-bearing messages.

Wisp cannot read HTTP methods, status or MIME inside end-to-end TLS. It explicitly labels those fields opaque rather than inventing them or intercepting TLS. Scramjet request/handleResponse events report method/status/MIME and streamed body byte counts separately, labelled `source: scramjet-client-report`. These are client reports, not server-verified plaintext observations; streaming counts are emitted at completion and are absent if a stream is canceled. Requests that escape rewriting are blocked rather than sent directly by the service worker. Cookies, authorization headers, full URLs, query strings and bodies are excluded from our telemetry.

Scramjet's own debug output is outside the custom redacted logger. Do not publish raw third-party console dumps without redaction.

## Required browser acceptance tests — all pending

Use the Testing Agent (test-tube side panel) after deploying the gateway. Goal:

“Open the existing Ghost home UI, launch example.com, a JavaScript test site, a CSS/image test site, and YouTube through the gateway. Verify gateway crossOriginIsolated, service-worker control, /wisp/ upgrade, JavaScript execution, CSS, images, API/JSON responses and visible dynamic content. On YouTube require real thumbnails and titles, not grey skeletons. Record any failed request, its HTTP status, sanitized host and matching transport log. Confirm destination requests do not leave directly, and exercise redirects, cookies across reloads, navigation and media streaming.”

Also exercise `/diagnostics` with developer credentials, verify unauthenticated diagnostics return 401, and retain returned evidence. Do not paste credentials/cookies/tokens into test reports.

## Files changed

Modified:
- gateway/server.js — real TCPSocket hook, strict version check, isolation, routes and build identity.
- gateway/package.json — Wisp pin and Node requirement.
- gateway/public/proxy.js — ordered/awaited bootstrap, top-level gate, real frame loading, Home return.
- gateway/public/proxy.html — retain Home action on the gateway.
- gateway/public/sw.js — configuration/WASM initialization, activation, metadata integration and no external direct fallback.
- gateway/public/config.js — nonsecret runtime defaults (server route supplies live flag).
- gateway/README.md — this change and verification report.
- src/gateway/server.js — delegate duplicate server entrypoint to canonical gateway.
- src/gateway/package.json — matching Wisp pin/Node requirement; deployment still uses gateway dependencies.
- src/pages/Home.jsx — replace srcDoc request flow with build-gated real gateway launch, same home UI.
- src/components/ProxyFrame.jsx — loading/error/embedded-launch state, no srcDoc or destination iframe.

Added:
- gateway/upstream-pool.js — shared-format pool, per-session selection and signed session cookie.
- gateway/connect-tunnel.js — DNS validation, CONNECT authentication and untouched binary tunnel.
- gateway/wisp-socket.js — supported Wisp socket adapter and redacted server diagnostics.
- gateway/diagnostic-request.js — verified TLS/HTTP over a real Wisp stream.
- gateway/diagnostics.js — developer authentication and real Wisp diagnostic runner.
- gateway/transport-logs.js — bounded, explicitly client-reported HTTP telemetry.
- gateway/public/transport-diagnostics.js — Scramjet metadata observation without logging headers/cookies/bodies.
- gateway/public/diagnostics.html — developer results page.
- gateway/public/diagnostics.js — live result rendering and browser public-Wisp round trip.

Unchanged: residential.js, legacy proxyFetch backend, Scramjet package/version, libcurl, BareMux, app theme and cloak controls.

## Final status

Static source trace: complete for the referenced request paths. Deployed installation: unavailable. Actual proxy egress evidence: not collected. Diagnostic tests: not run. Browser tests: not run. YouTube dynamic rendering: unverified. This is a repair candidate awaiting external deployment and browser acceptance, NOT a verified fix or a promise that every website works.