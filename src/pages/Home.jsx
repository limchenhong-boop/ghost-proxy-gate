import React, { useState, useEffect, useRef, useCallback } from "react";
import { base44 } from "@/api/base44Client";
import { normalizeQuery } from "@/lib/proxy";
import { THEMES, CLOAK_PRESETS, loadTheme, saveTheme, loadCloak, saveCloak, applyCloak } from "@/lib/settings";
import VelocitySearch from "@/components/VelocitySearch";
import ProxyFrame from "@/components/ProxyFrame";
import TabCloakPanel from "@/components/TabCloakPanel";
import ThemePanel from "@/components/ThemePanel";
import { Eye, Palette, X, Sparkles, Zap } from "lucide-react";

export default function Home() {
  const [view, setView] = useState("home");
  const [query, setQuery] = useState("");
  const [currentUrl, setCurrentUrl] = useState("");
  const [html, setHtml] = useState("");
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

  const navigate = useCallback(async (rawUrl, mode = "new") => {
    const url = normalizeQuery(rawUrl);
    if (!url) return;
    setLoading(true);
    setError(null);
    try {
      const res = await base44.functions.invoke("proxyFetch", { url });
      const data = res.data;
      if (data.error) throw new Error(data.error);
      if (data.nonHtml || !data.html) {
        window.open(data.finalUrl || url, "_blank", "noopener");
        setLoading(false);
        return;
      }
      setHtml(data.html);
      setCurrentUrl(data.finalUrl || url);
      setView("browse");
      if (mode === "new") {
        const finalUrl = data.finalUrl || url;
        setHistory((prev) => {
          const trimmed = prev.slice(0, histIndexRef.current + 1);
          const next = [...trimmed, finalUrl];
          histIndexRef.current = next.length - 1;
          setHistIndex(next.length - 1);
          return next;
        });
      }
    } catch (e) {
      setError(e.message || "Failed to load site");
    } finally {
      setLoading(false);
    }
  }, []);

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
    setCurrentUrl("");
    setQuery("");
    setError(null);
  };
  const reload = () => {
    if (currentUrl) navigate(currentUrl, "reload");
  };
  const openExternal = () => {
    if (currentUrl) window.open(currentUrl, "_blank", "noopener");
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
    <div className="min-h-screen w-full flex flex-col text-white" style={rootStyle}>
      {/* top brand bar */}
      <header className="flex items-center justify-between px-4 sm:px-6 py-3">
        <button onClick={goHome} className="flex items-center gap-2 group">
          <span
            className="w-8 h-8 rounded-lg flex items-center justify-center"
            style={{ background: "linear-gradient(135deg, var(--vp-accent), var(--vp-accent2))", boxShadow: "0 4px 16px -4px var(--vp-accent)" }}
          >
            <Zap className="w-4 h-4 text-white" fill="white" />
          </span>
          <span className="font-extrabold text-lg tracking-tight vp-gradient-text">Velocity</span>
        </button>
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

      <main className="flex-1 flex flex-col px-4 sm:px-6 pb-4 min-h-0">
        {view === "home" ? (
          <div className="flex-1 flex flex-col items-center justify-center gap-8 py-10">
            <div className="text-center space-y-3 max-w-2xl vp-fade-up">
              <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-medium text-white/70" style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.08)" }}>
                <Sparkles className="w-3.5 h-3.5" style={{ color: "var(--vp-accent)" }} />
                Faster than Fern. Embeddable anywhere.
              </div>
              <h1 className="text-4xl sm:text-6xl font-black tracking-tight leading-[1.05]">
                Browse <span className="vp-gradient-text">anything.</span>
                <br />
                Leave no trace.
              </h1>
              <p className="text-white/50 text-sm sm:text-base">
                Type a URL or search — the site loads right here, wrapped in light.
              </p>
            </div>

            <div className="w-full max-w-xl vp-fade-up" style={{ animationDelay: "0.08s" }}>
              <VelocitySearch value={query} onChange={setQuery} onSubmit={() => navigate(query)} loading={loading} />
            </div>

            <div className="flex flex-wrap items-center justify-center gap-2 vp-fade-up" style={{ animationDelay: "0.16s" }}>
              {["wikipedia.org", "reddit.com", "github.com", "duckduckgo.com"].map((s) => (
                <button
                  key={s}
                  onClick={() => navigate(s)}
                  className="px-3 py-1.5 rounded-full text-xs font-medium text-white/60 hover:text-white transition"
                  style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="flex-1 min-h-0 rounded-2xl overflow-hidden border" style={{ borderColor: "color-mix(in srgb, var(--vp-accent) 25%, transparent)" }}>
            <ProxyFrame
              currentUrl={currentUrl}
              html={html}
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
          </aside>
        </>
      )}
    </div>
  );
}

const vpIdle = { background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.08)" };
const vpActive = { background: "color-mix(in srgb, var(--vp-accent) 22%, transparent)", border: "1px solid var(--vp-accent)" };