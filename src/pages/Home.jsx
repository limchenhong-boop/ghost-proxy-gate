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
  const [html, setHtml] = useState("");
  const [openDirectUrl, setOpenDirectUrl] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const loadTimer = useRef(null);
  const blankTimer = useRef(null);
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

  const startLoad = useCallback(() => {
    setLoading(true);
    setError(null);
    setOpenDirectUrl(null);
    if (loadTimer.current) clearTimeout(loadTimer.current);
    loadTimer.current = setTimeout(() => {
      setLoading(false);
      setError("This site is taking too long or blocked the proxy.");
    }, 20000);
  }, []);

  const onLoaded = useCallback(() => {
    setLoading(false);
    if (loadTimer.current) clearTimeout(loadTimer.current);
    // After the document settles, inspect for a blank/anti-bot page and fall
    // back to open-direct. srcDoc with allow-same-origin is same-origin with
    // the parent, so contentDocument is readable here.
    if (blankTimer.current) clearTimeout(blankTimer.current);
    blankTimer.current = setTimeout(() => {
      try {
        const f = document.querySelector("iframe[title='Ghost Proxy']");
        const doc = f && f.contentDocument;
        if (doc && doc.body) {
          const text = (doc.body.innerText || "").trim();
          if (
            text.length < 10 ||
            (text.length < 200 &&
              /page not available|not available|access denied|captcha|verify you are a human|are you a robot|blocked/i.test(text))
          ) {
            setOpenDirectUrl(currentUrl || "");
          }
        }
      } catch (e) {
        /* opaque document — can't inspect, leave as-is */
      }
    }, 4000);
  }, [currentUrl]);

  const pushHistory = useCallback((url) => {
    setHistory((prev) => {
      const trimmed = prev.slice(0, histIndexRef.current + 1);
      const next = [...trimmed, url];
      histIndexRef.current = next.length - 1;
      setHistIndex(next.length - 1);
      return next;
    });
  }, []);

  const navigate = useCallback(async (rawUrl, mode = "new") => {
    const url = normalizeQuery(rawUrl);
    if (!url) return;
    startLoad();
    try {
      const res = await base44.functions.invoke("proxyFetch", { url, origin: window.location.origin });
      const data = (res && res.data) || {};
      if (data.error) throw new Error(data.error);
      if (data.blocked || data.nonHtml) {
        setOpenDirectUrl(data.finalUrl || url);
        setHtml("");
        setCurrentUrl(data.finalUrl || url);
        setView("browse");
        if (mode === "new") pushHistory(data.finalUrl || url);
        return;
      }
      if (!data.html) throw new Error("Empty response from proxy");
      setHtml(data.html);
      setCurrentUrl(data.finalUrl || url);
      setView("browse");
      if (mode === "new") pushHistory(data.finalUrl || url);
    } catch (e) {
      setError(e.message || "Failed to load site");
      setOpenDirectUrl(url);
      setCurrentUrl(url);
      setView("browse");
    } finally {
      setLoading(false);
    }
  }, [startLoad, pushHistory]);

  useEffect(() => {
    function onMsg(e) {
      if (e.data && e.data.__vp && e.data.url) {
        navigate(e.data.url, "new");
      }
    }
    window.addEventListener("message", onMsg);
    return () => window.removeEventListener("message", onMsg);
  }, [navigate]);

  const goBack = () => {
    const ni = histIndex - 1;
    if (ni >= 0) {
      setHistIndex(ni);
      navigate(history[ni], "back");
    }
  };
  const goForward = () => {
    const ni = histIndex + 1;
    if (ni < history.length) {
      setHistIndex(ni);
      navigate(history[ni], "forward");
    }
  };
  const goHome = () => {
    setView("home");
    setHtml("");
    setOpenDirectUrl(null);
    setCurrentUrl("");
    setQuery("");
    setError(null);
    setLoading(false);
    if (loadTimer.current) clearTimeout(loadTimer.current);
    if (blankTimer.current) clearTimeout(blankTimer.current);
  };
  const reload = () => {
    if (!currentUrl) return;
    navigate(currentUrl, "reload");
  };
  const openExternal = () => {
    const u = openDirectUrl || currentUrl;
    if (u) window.open(u, "_blank", "noopener");
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
              html={html}
              openDirectUrl={openDirectUrl}
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