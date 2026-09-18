import React, { useState, useEffect, useRef, useCallback } from "react";
import { normalizeQuery } from "@/lib/proxy";
import { THEMES, CLOAK_PRESETS, loadTheme, saveTheme, loadCloak, saveCloak, applyCloak } from "@/lib/settings";
import VelocitySearch from "@/components/VelocitySearch";
import ProxyFrame from "@/components/ProxyFrame";
import QuickApps from "@/components/QuickApps";
import AppFooter from "@/components/AppFooter";
import SettingsPanel from "@/components/SettingsPanel";
import TabCloakPanel from "@/components/TabCloakPanel";
import ThemePanel from "@/components/ThemePanel";
import { Eye, Palette, X } from "lucide-react";
import { base44 } from "@/api/base44Client";


export default function Home() {
  const [view, setView] = useState("home");
  const [query, setQuery] = useState("");
  const [currentUrl, setCurrentUrl] = useState("");
  const [frameSrc, setFrameSrc] = useState("");
  const [frameKey, setFrameKey] = useState(0);
  const [gatewayUrl, setGatewayUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [history, setHistory] = useState([]);
  const [histIndex, setHistIndex] = useState(-1);
  const histIndexRef = useRef(-1);
  const [panel, setPanel] = useState(null);
  const [cloak, setCloak] = useState(loadCloak);
  const [theme, setTheme] = useState(loadTheme);

  useEffect(() => {
    histIndexRef.current = histIndex;
  }, [histIndex]);

  useEffect(() => {
    applyCloak(cloak);
  }, [cloak]);

  const [blurred, setBlurred] = useState(false);
  useEffect(() => {
    const onVis = () => { if (document.hidden) setBlurred(true); };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, []);

  const pushHistory = useCallback((url) => {
    setHistory((prev) => {
      const trimmed = prev.slice(0, histIndexRef.current + 1);
      const next = [...trimmed, url];
      histIndexRef.current = next.length - 1;
      setHistIndex(next.length - 1);
      return next;
    });
  }, []);

  const replaceHistory = useCallback((url) => {
    setHistory((prev) => {
      const n = [...prev];
      if (histIndexRef.current >= 0) n[histIndexRef.current] = url;
      return n;
    });
  }, []);

  // Resolve the Scramjet gateway URL once (it's a secret, so the frontend asks
  // the proxyFetch function for it via the "config" action).
  const ensureGateway = useCallback(async () => {
    if (gatewayUrl) return gatewayUrl;
    const response = await base44.functions.invoke("proxyFetch", { action: "config" });
    const url = response.data?.gatewayUrl;
    if (!url) throw new Error("The proxy gateway is not configured.");
    setGatewayUrl(url);
    return url;
  }, [gatewayUrl]);

  // Core: load a page through the Scramjet gateway iframe. The gateway page
  // (proxy.html) registers a service worker that intercepts every request the
  // proxied site makes, so full SPAs like YouTube/TikTok render correctly —
  // something the old srcDoc approach could never do.
  const loadPage = useCallback(async (rawUrl, opts = {}) => {
    const url = normalizeQuery(rawUrl);
    if (!url) return;
    setLoading(true);
    setError(null);
    setCurrentUrl(url);
    setView("browse");
    if (!opts.mode || opts.mode === "new") pushHistory(url);
    try {
      const gw = await ensureGateway();
      setFrameSrc(`${gw}/proxy.html?url=${encodeURIComponent(url)}`);
      setFrameKey((k) => k + 1);
    } catch (e) {
      setError(e.message || "Failed to load page through the proxy.");
      setLoading(false);
    }
  }, [ensureGateway, pushHistory]);

  const navigate = useCallback((rawUrl) => {
    loadPage(rawUrl, { mode: "new" });
  }, [loadPage]);

  const goBack = () => {
    const ni = histIndex - 1;
    if (ni >= 0) {
      setHistIndex(ni);
      loadPage(history[ni], { mode: "replace" });
    }
  };
  const goForward = () => {
    const ni = histIndex + 1;
    if (ni < history.length) {
      setHistIndex(ni);
      loadPage(history[ni], { mode: "replace" });
    }
  };
  const goHome = () => {
    setView("home");
    setFrameSrc("");
    setCurrentUrl("");
    setQuery("");
    setError(null);
    setLoading(false);
    setHistory([]);
    setHistIndex(-1);
    histIndexRef.current = -1;
  };
  const reload = () => {
    if (currentUrl) loadPage(currentUrl, { mode: "replace" });
  };
  const openExternal = () => {
    const u = currentUrl;
    if (u) window.open(u, "_blank", "noopener");
  };
  const onLoaded = () => {
    setLoading(false);
  };

  const applyTheme = (t) => {
    setTheme(t);
    saveTheme(t.id);
  };
  const applyCloakPreset = (c) => {
    setCloak(c);
    saveCloak(c);
  };

  const rootStyle = {
    "--vp-bg": theme.bg,
    "--vp-bg2": theme.bg2,
    "--vp-accent": theme.accent,
    "--vp-accent2": theme.accent2,
    background: `radial-gradient(circle at 50% 0%, ${theme.bg2}, ${theme.bg} 60%)`,
  };

  return (
    <div className="h-screen w-full flex flex-col text-white overflow-hidden" style={rootStyle}>
      {/* network background */}
      <div className="fixed inset-0 vp-net-bg pointer-events-none opacity-60" aria-hidden="true" />

      <header className="relative z-10 flex items-center justify-between px-4 sm:px-6 py-3">
        <div />
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => setPanel(panel === "cloak" ? null : "cloak")}
            className="vp-pill"
            style={panel === "cloak" ? vpActive : vpIdle}
          >
            <Eye className="w-4 h-4" />
            <span className="hidden sm:inline text-sm font-medium">Cloak</span>
          </button>
          <button
            onClick={() => setPanel(panel === "theme" ? null : "theme")}
            className="vp-pill"
            style={panel === "theme" ? vpActive : vpIdle}
          >
            <Palette className="w-4 h-4" />
            <span className="hidden sm:inline text-sm font-medium">Theme</span>
          </button>
        </div>
      </header>

      <main className="relative z-10 flex-1 flex flex-col min-h-0">
        {view === "home" ? (
          <div className="flex-1 flex flex-col items-center justify-center gap-8 px-4 sm:px-6 py-8 overflow-y-auto">
            <h1 className="ghost-word text-7xl sm:text-8xl vp-fade-up">ghost</h1>
            <div className="w-full max-w-xl vp-fade-up" style={{ animationDelay: "0.08s" }}>
              <VelocitySearch value={query} onChange={setQuery} onSubmit={() => navigate(query)} loading={loading} />
              <p className="text-center text-white/40 text-xs mt-3">
                Press{" "}
                <kbd className="px-1.5 py-0.5 rounded bg-white/10 text-white/60 text-[10px] font-mono mx-0.5">
                  Ctrl+Y
                </kbd>{" "}
                to open command palette
              </p>
            </div>
            <div className="w-full vp-fade-up" style={{ animationDelay: "0.16s" }}>
              <QuickApps onOpen={navigate} />
            </div>
          </div>
        ) : (
          <div className="fixed inset-0 z-10 flex flex-col">
            <ProxyFrame
              currentUrl={currentUrl}
              frameSrc={frameSrc}
              frameKey={frameKey}
              loading={loading}
              error={error}
              histIndex={histIndex}
              histLen={history.length}
              onBack={goBack}
              onForward={goForward}
              onReload={reload}
              onHome={goHome}
              onNavigate={(u) => navigate(u)}
              onOpenExternal={openExternal}
              onLoaded={onLoaded}
            />
          </div>
        )}
      </main>

      {/* settings drawer */}
      {panel && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setPanel(null)} />
          <aside
            className="fixed top-0 right-0 z-50 h-full w-[88vw] max-w-sm p-5 overflow-y-auto vp-glass vp-slide-in"
            style={{ background: "color-mix(in srgb, var(--vp-bg) 78%, black)", borderLeft: "1px solid rgba(255,255,255,0.08)" }}
          >
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-bold text-white">Settings</h2>
              <button onClick={() => setPanel(null)} className="w-8 h-8 flex items-center justify-center rounded-full text-white/60 hover:text-white hover:bg-white/10">
                <X className="w-4 h-4" />
              </button>
            </div>
            {panel === "cloak" && <TabCloakPanel cloak={cloak} onApply={applyCloakPreset} />}
            {panel === "theme" && <ThemePanel theme={theme} onApply={applyTheme} />}
            {panel === "settings" && (
              <SettingsPanel cloak={cloak} theme={theme} onApplyCloak={applyCloakPreset} onApplyTheme={applyTheme} />
            )}
          </aside>
        </>
      )}

      {view === "home" && <AppFooter onSettings={() => setPanel("settings")} />}

      {blurred && (
        <div
          onClick={() => setBlurred(false)}
          className="fixed inset-0 z-[200] flex items-center justify-center cursor-pointer select-none"
          style={{ backdropFilter: "blur(28px)", WebkitBackdropFilter: "blur(28px)", background: "rgba(0,0,0,0.55)" }}
        >
          <span className="text-white/70 text-xl font-light tracking-wide lowercase">click to focus</span>
        </div>
      )}
    </div>
  );
}

const vpIdle = { background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.08)" };
const vpActive = { background: "color-mix(in srgb, var(--vp-accent) 22%, transparent)", border: "1px solid var(--vp-accent)" };