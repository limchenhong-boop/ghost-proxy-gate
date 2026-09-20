import React, { useState, useEffect, useCallback } from "react";
import { normalizeQuery } from "@/lib/proxy";
import { loadTheme, saveTheme, loadCloak, saveCloak, applyCloak } from "@/lib/settings";
import VelocitySearch from "@/components/VelocitySearch";
import QuickApps from "@/components/QuickApps";
import AppFooter from "@/components/AppFooter";
import SettingsPanel from "@/components/SettingsPanel";
import TabCloakPanel from "@/components/TabCloakPanel";
import ThemePanel from "@/components/ThemePanel";
import UpdatePopup from "@/components/UpdatePopup";
import ProxyFrame from "@/components/ProxyFrame";
import { Eye, Palette, X, ArrowLeft, Zap } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { base44 } from "@/api/base44Client";


export default function Home() {
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [view, setView] = useState("home");
  const [currentUrl, setCurrentUrl] = useState("");
  const [gatewayPage, setGatewayPage] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [panel, setPanel] = useState(null);
  const [cloak, setCloak] = useState(loadCloak);
  const [theme, setTheme] = useState(loadTheme);
  const [sessionId, setSessionId] = useState(null);


  useEffect(() => { applyCloak(cloak); }, [cloak]);

  const [blurred, setBlurred] = useState(false);
  useEffect(() => {
    const onVis = () => { if (document.hidden) setBlurred(true); };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, []);

  const goHome = useCallback(() => {
    if (sessionId) {
      base44.functions.invoke("createBrowserSession", { action: "release", sessionId }).catch(() => {});
    }
    setSessionId(null);
    setView("home");
    setGatewayPage("");
    setCurrentUrl("");
    setError(null);
    setLoading(false);
  }, [sessionId]);

  // Launches a Browserbase cloud browser session, navigates it to the target,
  // and embeds the live view in an iframe. No Scramjet/Wisp or residential proxy.
  const loadPage = useCallback(async (rawUrl) => {
    const url = normalizeQuery(rawUrl);
    if (!url) return;
    setLoading(true);
    setError(null);
    setGatewayPage("");
    setCurrentUrl(url);
    setView("browse");
    try {
      const response = await base44.functions.invoke("createBrowserSession", { action: "create", url });
      const data = response.data;
      if (!data?.ok || !data?.debugUrl) throw new Error(data?.error || "Could not start the browser session.");
      setSessionId(data.sessionId);
      setGatewayPage(data.debugUrl);
    } catch (failure) {
      setError(failure.message || "The browser session could not be started.");
    } finally {
      setLoading(false);
    }
  }, []);

  const applyTheme = (t) => { setTheme(t); saveTheme(t.id); };
  const applyCloakPreset = (c) => { setCloak(c); saveCloak(c); };

  const rootStyle = {
    "--vp-bg": theme.bg,
    "--vp-bg2": theme.bg2,
    "--vp-accent": theme.accent,
    "--vp-accent2": theme.accent2,
    background: `radial-gradient(circle at 50% 0%, ${theme.bg2}, ${theme.bg} 60%)`,
  };

  if (view === "browse") {
    return (
      <div className="h-screen w-full text-white overflow-hidden" style={rootStyle}>
        <ProxyFrame
          currentUrl={currentUrl}
          gatewayPage={gatewayPage}
          loading={loading}
          error={error}
        />
        <button
          onClick={goHome}
          className="fixed top-3 left-3 z-20 vp-pill vp-glass"
          style={{ background: "rgba(0,0,0,0.5)", border: "1px solid rgba(255,255,255,0.1)" }}
        >
          <ArrowLeft className="w-4 h-4" />
          <span className="text-sm font-medium">Home</span>
        </button>
      </div>
    );
  }

  return (
    <div className="h-screen w-full flex flex-col text-white overflow-hidden" style={rootStyle}>
      <div className="fixed inset-0 vp-net-bg pointer-events-none opacity-60" aria-hidden="true" />

      <UpdatePopup />

      <header className="relative z-10 flex items-center justify-between px-4 sm:px-6 py-3">
        <div />
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => navigate("/proxy-tester")}
            className="vp-pill"
            style={vpIdle}
            title="Proxy Tester"
          >
            <Zap className="w-4 h-4" />
            <span className="hidden sm:inline text-sm font-medium">Test</span>
          </button>
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
        <div className="flex-1 flex flex-col items-center justify-center gap-8 px-4 sm:px-6 py-8 overflow-y-auto">
          <h1 className="ghost-word text-7xl sm:text-8xl vp-fade-up">ghost</h1>
          <div className="w-full max-w-xl vp-fade-up" style={{ animationDelay: "0.08s" }}>
            <VelocitySearch value={query} onChange={setQuery} onSubmit={() => loadPage(query)} loading={loading} />
            {error && <p className="text-center text-red-300/80 text-xs mt-3">{error}</p>}
          </div>
          <div className="w-full vp-fade-up" style={{ animationDelay: "0.16s" }}>
            <QuickApps onOpen={loadPage} />
          </div>
        </div>
      </main>

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

      <AppFooter onSettings={() => setPanel("settings")} />

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