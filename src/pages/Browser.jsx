import React, { useState, useEffect, useRef, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { base44 } from "@/api/base44Client";
import { loadBackendUrl } from "@/lib/browserSettings";
import BrowserTabs from "@/components/browser/BrowserTabs";
import AddressBar from "@/components/browser/AddressBar";
import ProxyViewport from "@/components/browser/ProxyViewport";
import BrowserSettings from "@/components/browser/BrowserSettings";
import NewTabPage from "@/components/browser/NewTabPage";
import BrowserDiagnostics from "@/components/browser/BrowserDiagnostics";
import { Settings, ArrowLeft, Activity } from "lucide-react";

function normalizeUrl(input) {
  const t = input.trim();
  if (!t) return null;
  if (/^https?:\/\//i.test(t)) return t;
  if (/^[\w-]+(\.[\w-]+)+(\/.*)?$/.test(t)) return "https://" + t;
  return "https://duckduckgo.com/?q=" + encodeURIComponent(t);
}

function extractTitle(html) {
  if (!html) return "";
  const m = html.match(/<title[^>]*>([^<]*)<\/title>/i);
  return m ? m[1].trim() : "";
}

let tabIdCounter = 0;
function newTabId() { return "tab-" + (++tabIdCounter); }

function createTabObject(url = "") {
  return {
    id: newTabId(),
    url,
    html: "",
    title: "New Tab",
    loading: false,
    error: null,
    history: url ? [url] : [],
    historyIndex: url ? 0 : -1,
    canGoBack: false,
    canGoForward: false,
  };
}

export default function Browser() {
  const navigate = useNavigate();
  const [tabs, setTabs] = useState(() => [createTabObject()]);
  const [activeTabId, setActiveTabId] = useState(() => tabs[0].id);
  const [bookmarks, setBookmarks] = useState([]);
  const [showSettings, setShowSettings] = useState(false);
  const [focusSignal, setFocusSignal] = useState(0);
  const [backendUrl, setBackendUrl] = useState(loadBackendUrl);
  const [diagnostics, setDiagnostics] = useState(null);
  const [showDiagnostics, setShowDiagnostics] = useState(false);
  const lastHistoryRef = useRef({});
  const tabsRef = useRef(tabs);
  tabsRef.current = tabs;

  const activeTab = tabs.find((t) => t.id === activeTabId);

  useEffect(() => {
    base44.entities.Bookmark.list("-created_date", 50).then(setBookmarks).catch(() => {});
  }, []);

  const recordHistory = useCallback((url, title) => {
    if (!url) return;
    if (lastHistoryRef.current[url]) return;
    lastHistoryRef.current[url] = true;
    base44.entities.History.create({ url, title: title || "" }).catch(() => {});
  }, []);

  const updateTab = useCallback((tabId, patch) => {
    setTabs((prev) => prev.map((t) => (t.id === tabId ? { ...t, ...patch } : t)));
  }, []);

  const navigateTab = useCallback(async (tabId, rawUrl, options = {}) => {
    const { isBackForward = false } = options;
    const url = normalizeUrl(rawUrl);
    if (!url) return;

    updateTab(tabId, { loading: true, error: null, url });

    try {
      const resp = await base44.functions.invoke("proxyFetch", {
        url,
        origin: window.location.origin,
        ...(backendUrl ? { gatewayUrl: backendUrl } : {}),
      });
      const data = resp.data;
      setDiagnostics({
        endpoint: (backendUrl || "server default (secret)") + " → /fetch",
        status: data.status ?? null,
        fromRender: data.transport === "residential" || data.ok === true,
        aiApiCalled: false,
        directFetch: data.transport === "direct",
        timestamp: Date.now(),
      });
      if (!data.ok) {
        updateTab(tabId, { loading: false, error: data.error || "Failed to load page." });
        return;
      }

      const finalUrl = data.finalUrl || url;
      const title = extractTitle(data.html) || finalUrl;

      updateTab(tabId, { loading: false, html: data.html, url: finalUrl, title, error: null });

      if (!isBackForward) {
        setTabs((prev) => prev.map((t) => {
          if (t.id !== tabId) return t;
          const history = t.history.slice(0, t.historyIndex + 1);
          if (history[history.length - 1] !== finalUrl) history.push(finalUrl);
          const newIndex = history.length - 1;
          return { ...t, history, historyIndex: newIndex, canGoBack: newIndex > 0, canGoForward: false };
        }));
      }

      recordHistory(finalUrl, title);
    } catch (err) {
      updateTab(tabId, { loading: false, error: err.message || "Network error." });
    }
  }, [backendUrl, recordHistory, updateTab]);

  const submitForm = useCallback(async (tabId, formSubmit) => {
    const { url, method, data: formData } = formSubmit;
    updateTab(tabId, { loading: true, error: null, url });

    try {
      const body = method === "GET"
        ? undefined
        : formData.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join("&");

      const resp = await base44.functions.invoke("proxyFetch", {
        url,
        method,
        origin: window.location.origin,
        ...(body ? { body, contentType: "application/x-www-form-urlencoded" } : {}),
        ...(backendUrl ? { gatewayUrl: backendUrl } : {}),
      });
      const result = resp.data;
      if (!result.ok) {
        updateTab(tabId, { loading: false, error: result.error || "Form submission failed." });
        return;
      }

      const finalUrl = result.finalUrl || url;
      const title = extractTitle(result.html) || finalUrl;
      updateTab(tabId, { loading: false, html: result.html, url: finalUrl, title, error: null });

      setTabs((prev) => prev.map((t) => {
        if (t.id !== tabId) return t;
        const history = t.history.slice(0, t.historyIndex + 1);
        history.push(finalUrl);
        return { ...t, history, historyIndex: history.length - 1, canGoBack: true, canGoForward: false };
      }));

      recordHistory(finalUrl, title);
    } catch (err) {
      updateTab(tabId, { loading: false, error: err.message });
    }
  }, [backendUrl, recordHistory, updateTab]);

  const handleIframeMessage = useCallback((msg) => {
    if (!msg || msg.__vp !== 1) return;

    if (msg.newTab && msg.url) {
      const newTab = createTabObject(msg.url);
      setTabs((prev) => [...prev, newTab]);
      setActiveTabId(newTab.id);
      navigateTab(newTab.id, msg.url);
      return;
    }

    if (msg.formSubmit) {
      submitForm(activeTabId, msg.formSubmit);
      return;
    }

    if (msg.url) {
      if (msg.soft) {
        updateTab(activeTabId, { url: msg.url });
        setTabs((prev) => prev.map((t) => {
          if (t.id !== activeTabId) return t;
          const history = t.history.slice(0, t.historyIndex + 1);
          history.push(msg.url);
          return { ...t, history, historyIndex: history.length - 1, canGoBack: true, canGoForward: false };
        }));
      } else {
        navigateTab(activeTabId, msg.url);
      }
    }
  }, [activeTabId, navigateTab, submitForm, updateTab]);

  const goBack = useCallback(() => {
    const tab = tabsRef.current.find((t) => t.id === activeTabId);
    if (!tab || tab.historyIndex <= 0) return;
    const newIndex = tab.historyIndex - 1;
    const url = tab.history[newIndex];
    setTabs((prev) => prev.map((t) =>
      t.id === activeTabId
        ? { ...t, historyIndex: newIndex, canGoBack: newIndex > 0, canGoForward: true, url }
        : t
    ));
    navigateTab(activeTabId, url, { isBackForward: true });
  }, [activeTabId, navigateTab]);

  const goForward = useCallback(() => {
    const tab = tabsRef.current.find((t) => t.id === activeTabId);
    if (!tab || tab.historyIndex >= tab.history.length - 1) return;
    const newIndex = tab.historyIndex + 1;
    const url = tab.history[newIndex];
    setTabs((prev) => prev.map((t) =>
      t.id === activeTabId
        ? { ...t, historyIndex: newIndex, canGoBack: true, canGoForward: newIndex < tab.history.length - 1, url }
        : t
    ));
    navigateTab(activeTabId, url, { isBackForward: true });
  }, [activeTabId, navigateTab]);

  const reload = useCallback(() => {
    const tab = tabsRef.current.find((t) => t.id === activeTabId);
    if (tab?.url) navigateTab(activeTabId, tab.url, { isBackForward: true });
  }, [activeTabId, navigateTab]);

  const goHome = useCallback(() => {
    updateTab(activeTabId, { url: "", html: "", title: "New Tab", error: null, loading: false });
  }, [activeTabId, updateTab]);

  const createNewTab = useCallback(() => {
    const newTab = createTabObject();
    setTabs((prev) => [...prev, newTab]);
    setActiveTabId(newTab.id);
  }, []);

  const closeTab = useCallback((tabId) => {
    setTabs((prev) => {
      const idx = prev.findIndex((t) => t.id === tabId);
      const filtered = prev.filter((t) => t.id !== tabId);
      if (filtered.length === 0) {
        const fresh = createTabObject();
        setActiveTabId(fresh.id);
        return [fresh];
      }
      if (tabId === activeTabId) {
        const newActive = filtered[Math.min(idx, filtered.length - 1)];
        setActiveTabId(newActive.id);
      }
      return filtered;
    });
  }, [activeTabId]);

  const toggleBookmark = useCallback(async () => {
    if (!activeTab?.url) return;
    const existing = bookmarks.find((b) => b.url === activeTab.url);
    if (existing) {
      await base44.entities.Bookmark.delete(existing.id);
      setBookmarks((prev) => prev.filter((b) => b.id !== existing.id));
    } else {
      const bm = await base44.entities.Bookmark.create({ url: activeTab.url, title: activeTab.title, name: activeTab.title });
      setBookmarks((prev) => [...prev, bm]);
    }
  }, [activeTab, bookmarks]);

  const onShortcut = useCallback((action) => {
    if (action === "focus-address") setFocusSignal((s) => s + 1);
    else if (action === "new-tab") createNewTab();
    else if (action === "close-tab" && activeTabId) closeTab(activeTabId);
  }, [createNewTab, closeTab, activeTabId]);

  const isBookmarked = activeTab?.url ? bookmarks.some((b) => b.url === activeTab.url) : false;
  const showNewTab = !activeTab?.url && !activeTab?.loading && !activeTab?.error;

  return (
    <div className="h-screen w-full flex flex-col bg-[#1a1a1a] text-white overflow-hidden">
      <BrowserTabs
        tabs={tabs}
        activeTabId={activeTabId}
        onSwitch={setActiveTabId}
        onClose={closeTab}
        onNew={createNewTab}
      />
      {activeTab && (
        <AddressBar
          url={activeTab.url}
          loading={activeTab.loading}
          canGoBack={activeTab.canGoBack}
          canGoForward={activeTab.canGoForward}
          onNavigate={(input) => navigateTab(activeTabId, input)}
          onBack={goBack}
          onForward={goForward}
          onReload={reload}
          onStop={() => updateTab(activeTabId, { loading: false })}
          onHome={goHome}
          isBookmarked={isBookmarked}
          onToggleBookmark={toggleBookmark}
          focusSignal={focusSignal}
        />
      )}
      <div className="flex-1 relative overflow-hidden">
        {showNewTab ? (
          <NewTabPage onNavigate={(input) => navigateTab(activeTabId, input)} />
        ) : (
          <ProxyViewport tab={activeTab} onMessage={handleIframeMessage} />
        )}
      </div>
      <button
        onClick={() => setShowDiagnostics((s) => !s)}
        className="fixed top-2 right-28 z-50 w-8 h-8 flex items-center justify-center rounded-lg bg-black/50 text-gray-400 hover:text-white backdrop-blur-sm border border-white/10 transition-colors"
        title="Diagnostics"
      >
        <Activity className="w-4 h-4" />
      </button>
      <button
        onClick={() => setShowSettings(true)}
        className="fixed top-2 right-16 z-50 w-8 h-8 flex items-center justify-center rounded-lg bg-black/50 text-gray-400 hover:text-white backdrop-blur-sm border border-white/10 transition-colors"
        title="Settings"
      >
        <Settings className="w-4 h-4" />
      </button>
      <button
        onClick={() => navigate("/")}
        className="fixed top-2 right-2 z-50 px-3 py-1.5 rounded-lg bg-black/50 text-xs text-gray-400 hover:text-white backdrop-blur-sm border border-white/10 transition-colors"
      >
        Exit
      </button>
      {showDiagnostics && (
        <BrowserDiagnostics diagnostics={diagnostics} onClose={() => setShowDiagnostics(false)} />
      )}
      {showSettings && (
        <BrowserSettings
          backendUrl={backendUrl}
          onSaveBackendUrl={(url) => { setBackendUrl(url); setShowSettings(false); }}
          onClose={() => setShowSettings(false)}
        />
      )}
    </div>
  );
}