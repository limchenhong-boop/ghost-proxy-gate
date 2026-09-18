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
import { Eye, Palette, X, ExternalLink, Check } from "lucide-react";
import { base44 } from "@/api/base44Client";


export default function Home() {
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [panel, setPanel] = useState(null);
  const [cloak, setCloak] = useState(loadCloak);
  const [theme, setTheme] = useState(loadTheme);
  const [gatewayUrl, setGatewayUrl] = useState("");
  const [toast, setToast] = useState(null);

  useEffect(() => { applyCloak(cloak); }, [cloak]);

  const [blurred, setBlurred] = useState(false);
  useEffect(() => {
    const onVis = () => { if (document.hidden) setBlurred(true); };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
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

  // Open the gateway proxy page as a top-level document. Scramjet needs
  // cross-origin isolation (COOP/COEP) for its WASM transport, which a
  // cross-origin iframe can't get — Chrome blocks embedded attempts with
  // ERR_BLOCKED_BY_RESPONSE. A top-level (new tab) page works fully.
  const navigate = useCallback(async (rawUrl) => {
    const url = normalizeQuery(rawUrl);
    if (!url) return;
    setLoading(true);
    setError(null);
    try {
      const gw = await ensureGateway();
      const proxyPage = `${gw}/proxy.html?url=${encodeURIComponent(url)}`;
      const win = window.open(proxyPage, "_blank", "noopener,noreferrer");
      if (!win) {
        // Popup blocked — navigate this tab instead.
        window.location.href = proxyPage;
      } else {
        setToast({ url });
        setTimeout(() => setToast(null), 4500);
      }
    } catch (e) {
      setError(e.message || "Failed to open the proxy.");
    } finally {
      setLoading(false);
    }
  }, [ensureGateway]);

  const applyTheme = (t) => { setTheme(t); saveTheme(t.id); };
  const applyCloakPreset = (c) => { setCloak(c); saveCloak(c); };

  const rootStyle = {
    "--vp-bg": theme.bg,
    "--vp-bg2": theme.bg2,
    "--vp-accent": theme.accent,
    "--vp-accent2": theme.accent2,
    background: `radial-gradient(circle at 50% 0%, ${theme.bg2}, ${theme.bg} 60%)`,
  };

  return (
    <div className="h-screen w-full flex flex-col text-white overflow-hidden" style={rootStyle}>
      <div className="fixed inset-0 vp-net-bg pointer-events-none opacity-60" aria-hidden="true" />

      <UpdatePopup />

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
        <div className="flex-1 flex flex-col items-center justify-center gap-8 px-4 sm:px-6 py-8 overflow-y-auto">
          <h1 className="ghost-word text-7xl sm:text-8xl vp-fade-up">ghost</h1>
          <div className="w-full max-w-xl vp-fade-up" style={{ animationDelay: "0.08s" }}>
            <VelocitySearch value={query} onChange={setQuery} onSubmit={() => navigate(query)} loading={loading} />
            {error && <p className="text-center text-red-300/80 text-xs mt-3">{error}</p>}
          </div>
          <div className="w-full vp-fade-up" style={{ animationDelay: "0.16s" }}>
            <QuickApps onOpen={navigate} />
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

      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[120] vp-glass vp-fade-up rounded-full px-4 py-2.5 flex items-center gap-2.5"
          style={{ background: "color-mix(in srgb, var(--vp-bg) 85%, black)", border: "1px solid rgba(255,255,255,0.1)" }}>
          <span className="w-5 h-5 rounded-full flex items-center justify-center" style={{ background: "var(--vp-accent)" }}>
            <Check className="w-3 h-3 text-white" />
          </span>
          <span className="text-sm text-white/80">Opened in a new tab</span>
          <a
            href={`${gatewayUrl}/proxy.html?url=${encodeURIComponent(toast.url)}`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-white/50 hover:text-white inline-flex items-center gap-1"
            title="Reopen"
          >
            <ExternalLink className="w-3.5 h-3.5" />
          </a>
        </div>
      )}

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