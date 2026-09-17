import React, { useState, useEffect } from "react";
import { ArrowLeft, ArrowRight, RotateCw, Home, ExternalLink, AlertTriangle, Loader2, Lock, Globe } from "lucide-react";

export default function ProxyFrame({
  currentUrl,
  html,
  openDirectUrl,
  loading,
  error,
  diag,
  histIndex,
  histLen,
  onBack,
  onForward,
  onReload,
  onHome,
  onNavigate,
  onOpenExternal,
  onLoaded,
}) {
  const [urlInput, setUrlInput] = useState(currentUrl);

  useEffect(() => {
    setUrlInput(currentUrl);
  }, [currentUrl]);

  return (
    <div className="flex flex-col h-full w-full">
      {/* chrome bar */}
      <div
        className="flex items-center gap-1.5 px-2 py-2 border-b"
        style={{ background: "color-mix(in srgb, var(--vp-bg) 82%, black)", borderColor: "color-mix(in srgb, var(--vp-accent) 25%, transparent)" }}
      >
        <ChromeBtn onClick={onBack} disabled={histIndex <= 0} label="Back">
          <ArrowLeft className="w-4 h-4" />
        </ChromeBtn>
        <ChromeBtn onClick={onForward} disabled={histIndex >= histLen - 1} label="Forward">
          <ArrowRight className="w-4 h-4" />
        </ChromeBtn>
        <ChromeBtn onClick={onReload} label="Reload">
          <RotateCw className={loading ? "w-4 h-4 animate-spin" : "w-4 h-4"} />
        </ChromeBtn>
        <ChromeBtn onClick={onHome} label="Home">
          <Home className="w-4 h-4" />
        </ChromeBtn>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            onNavigate(urlInput);
          }}
          className="flex-1 flex items-center gap-2 px-3 py-1.5 rounded-full"
          style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.08)" }}
        >
          <Lock className="w-3.5 h-3.5 text-white/40" />
          <input
            value={urlInput}
            onChange={(e) => setUrlInput(e.target.value)}
            spellCheck={false}
            autoComplete="off"
            className="flex-1 bg-transparent outline-none border-0 text-white/90 text-sm placeholder-white/30"
            placeholder="Search or enter address"
          />
        </form>

        <ChromeBtn onClick={onOpenExternal} label="Open in new tab">
          <ExternalLink className="w-4 h-4" />
        </ChromeBtn>
      </div>

      {/* viewport */}
      <div className="relative flex-1 bg-white">
        <iframe
          srcDoc={html}
          // allow-scripts: site JS must execute (srcDoc has no CSP).
          // allow-forms: forms submit through the proxy.
          // allow-popups: window.open is intercepted to stay in-proxy.
          // allow-modals: alert/confirm from the page.
          // allow-same-origin: srcDoc inherits parent origin so it can call the
          //   proxy (same-origin) and the parent can inspect contentDocument for
          //   blank detection. (allow-scripts + allow-same-origin together is a
          //   known sandbox-escape vector; accepted here because the user is
          //   deliberately loading untrusted proxied content.)
          // allow-downloads: download links.
          sandbox="allow-scripts allow-forms allow-popups allow-modals allow-same-origin allow-downloads"
          className="w-full h-full block"
          title="Ghost Proxy"
          referrerPolicy="no-referrer"
          onLoad={onLoaded}
        />
        {loading && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3" style={{ background: "color-mix(in srgb, var(--vp-bg) 70%, transparent)" }}>
            <Loader2 className="w-8 h-8 animate-spin" style={{ color: "var(--vp-accent)" }} />
            <span className="text-white/70 text-sm font-medium">Tunneling through Ghost…</span>
          </div>
        )}
        {openDirectUrl && !loading && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-6 text-center" style={{ background: "color-mix(in srgb, var(--vp-bg) 88%, black)" }}>
            <Globe className="w-10 h-10" style={{ color: "var(--vp-accent)" }} />
            <p className="text-white font-semibold">This page can't be embedded</p>
            <p className="text-white/60 text-sm max-w-md break-all">{openDirectUrl}</p>
            <p className="text-white/40 text-xs max-w-md">
              {diag && diag.note ? diag.note : "The site served a non-HTML file or a block page that can't be rendered inside the proxy."}
            </p>
            <button
              onClick={onOpenExternal}
              className="mt-2 px-4 py-2 rounded-full text-sm font-semibold text-white inline-flex items-center gap-2"
              style={{ background: "linear-gradient(135deg, var(--vp-accent), var(--vp-accent2))" }}
            >
              <ExternalLink className="w-4 h-4" /> Open directly
            </button>
          </div>
        )}
        {error && !loading && !openDirectUrl && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-6 text-center" style={{ background: "color-mix(in srgb, var(--vp-bg) 88%, black)" }}>
            <AlertTriangle className="w-10 h-10" style={{ color: "var(--vp-accent2)" }} />
            <p className="text-white font-semibold">Proxy couldn't load this page</p>
            <p className="text-white/60 text-sm max-w-md">{error}</p>
            {diag && (
              <div className="text-white/40 text-xs max-w-md mt-1 space-y-0.5">
                {diag.url && <p className="break-all">URL: {diag.url}</p>}
                {diag.status && <p>Status: {diag.status}</p>}
                {diag.note && <p>{diag.note}</p>}
              </div>
            )}
            <p className="text-white/40 text-xs max-w-md mt-1">
              You can retry, go home, or open the original site directly as a last resort.
            </p>
            <div className="flex gap-2 mt-2">
              <button
                onClick={onReload}
                className="px-4 py-2 rounded-full text-sm font-semibold text-white"
                style={{ background: "linear-gradient(135deg, var(--vp-accent), var(--vp-accent2))" }}
              >
                Retry
              </button>
              <button
                onClick={onOpenExternal}
                className="px-4 py-2 rounded-full text-sm font-semibold text-white/80 border border-white/15 inline-flex items-center gap-2"
              >
                <ExternalLink className="w-4 h-4" /> Open directly
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function ChromeBtn({ children, onClick, disabled, label }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className="w-8 h-8 flex items-center justify-center rounded-full text-white/70 hover:text-white hover:bg-white/10 transition disabled:opacity-30 disabled:hover:bg-transparent"
    >
      {children}
    </button>
  );
}