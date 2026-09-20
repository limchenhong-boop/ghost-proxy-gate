import React, { useState, useEffect, useRef, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { base44 } from "@/api/base44Client";
import { BrowserSession, createBrowserLabSession, deleteBrowserLabSession } from "@/lib/browserLabClient";
import BrowserTabs from "@/components/browser/BrowserTabs";
import AddressBar from "@/components/browser/AddressBar";
import BrowserViewport from "@/components/browser/BrowserViewport";
import { ArrowLeft, AlertCircle, RotateCw } from "lucide-react";

function normalizeUrl(input) {
  const t = input.trim();
  if (!t) return null;
  if (/^https?:\/\//i.test(t)) return t;
  if (/^[\w-]+(\.[\w-]+)+(\/.*)?$/.test(t)) return "https://" + t;
  return "https://duckduckgo.com/?q=" + encodeURIComponent(t);
}

export default function Browser() {
  const navigate = useNavigate();
  const [tabs, setTabs] = useState([]);
  const [activeTabId, setActiveTabId] = useState(null);
  const [error, setError] = useState(null);
  const [bookmarks, setBookmarks] = useState([]);
  const [focusSignal, setFocusSignal] = useState(0);
  const lastHistoryRef = useRef({});
  const tabsRef = useRef(tabs);
  tabsRef.current = tabs;

  const activeTab = tabs.find((t) => t.id === activeTabId);

  // Load bookmarks
  useEffect(() => {
    base44.entities.Bookmark.list("-created_date", 50).then(setBookmarks).catch(() => {});
  }, []);

  // Create initial tab on mount
  useEffect(() => {
    createTab();
    return () => {
      tabsRef.current.forEach((t) => {
        t.session?.disconnect();
        deleteBrowserLabSession(t.session?.sessionId).catch(() => {});
      });
    };
  }, []);

  const recordHistory = useCallback((url, title) => {
    if (!url || url === "about:blank") return;
    if (lastHistoryRef.current[url]) return;
    lastHistoryRef.current[url] = true;
    base44.entities.History.create({ url, title: title || "" }).catch(() => {});
  }, []);

  const updateTab = useCallback((tabId, state) => {
    setTabs((prev) => prev.map((t) =>
      t.id === tabId
        ? { ...t, url: state.url !== undefined ? state.url : t.url, title: state.title || t.title, loading: !!state.loading, canGoBack: state.canGoBack ?? t.canGoBack, canGoForward: state.canGoForward ?? t.canGoForward }
        : t
    ));
    if (state.url && state.url !== "about:blank") recordHistory(state.url, state.title);
  }, [recordHistory]);

  const createTab = useCallback(async (url) => {
    setError(null);
    try {
      const data = await createBrowserLabSession(30);
      if (!data.ok) throw new Error(data.error);
      const tabId = crypto.randomUUID();
      const session = new BrowserSession({
        sessionId: data.sessionId,
        cdpUrl: data.cdpUrl,
        whipUrl: data.whipUrl,
        onStateChange: (state) => updateTab(tabId, state),
      });
      setTabs((prev) => [...prev, { id: tabId, session, url: "", title: "New Tab", loading: true, canGoBack: false, canGoForward: false }]);
      setActiveTabId(tabId);
      await session.connect(url ? normalizeUrl(url) : null);
    } catch (err) {
      setError(err.message || "Could not start the browser session.");
    }
  }, [updateTab]);

  const closeTab = useCallback(async (tabId) => {
    const tab = tabsRef.current.find((t) => t.id === tabId);
    if (tab) {
      await tab.session?.disconnect();
      deleteBrowserLabSession(tab.session?.sessionId).catch(() => {});
    }
    setTabs((prev) => {
      const filtered = prev.filter((t) => t.id !== tabId);
      if (activeTabId === tabId) {
        setActiveTabId(filtered.length > 0 ? filtered[filtered.length - 1].id : null);
      }
      return filtered;
    });
  }, [activeTabId]);

  const navigateActive = useCallback((input) => {
    const url = normalizeUrl(input);
    if (url && activeTab?.session) activeTab.session.navigate(url);
  }, [activeTab]);

  const goBack = useCallback(() => activeTab?.session?.goBack(), [activeTab]);
  const goForward = useCallback(() => activeTab?.session?.goForward(), [activeTab]);
  const reload = useCallback(() => activeTab?.session?.reload(), [activeTab]);
  const stop = useCallback(() => activeTab?.session?.stop(), [activeTab]);
  const goHome = useCallback(() => { if (activeTab?.session) activeTab.session.navigate("about:blank"); }, [activeTab]);

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
    else if (action === "new-tab") createTab();
    else if (action === "close-tab" && activeTabId) closeTab(activeTabId);
  }, [createTab, closeTab, activeTabId]);

  const isBookmarked = activeTab?.url ? bookmarks.some((b) => b.url === activeTab.url) : false;

  return (
    <div className="h-screen w-full flex flex-col bg-[#0d0d0d] text-white overflow-hidden">
      <BrowserTabs
        tabs={tabs}
        activeTabId={activeTabId}
        onSwitch={setActiveTabId}
        onClose={closeTab}
        onNew={() => createTab()}
      />
      {activeTab && (
        <AddressBar
          url={activeTab.url}
          loading={activeTab.loading}
          canGoBack={activeTab.canGoBack}
          canGoForward={activeTab.canGoForward}
          onNavigate={navigateActive}
          onBack={goBack}
          onForward={goForward}
          onReload={reload}
          onStop={stop}
          onHome={goHome}
          isBookmarked={isBookmarked}
          onToggleBookmark={toggleBookmark}
          focusSignal={focusSignal}
        />
      )}
      {error ? (
        <div className="flex-1 flex flex-col items-center justify-center gap-4 px-6 text-center">
          <AlertCircle className="w-12 h-12 text-red-400/60" />
          <p className="text-lg text-gray-300 max-w-md">{error}</p>
          <p className="text-sm text-gray-500 max-w-md">
            Make sure your Browser-Lab server is deployed and the <code className="text-gray-400">BROWSER_LAB_URL</code> secret is set.
          </p>
          <button onClick={() => createTab()} className="flex items-center gap-2 px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-sm font-medium transition-colors">
            <RotateCw className="w-4 h-4" /> Retry
          </button>
        </div>
      ) : (
        <BrowserViewport
          session={activeTab?.session}
          onShortcut={onShortcut}
          onNavigate={navigateActive}
        />
      )}
      <button
        onClick={() => navigate("/")}
        className="fixed top-2 right-2 z-50 px-3 py-1.5 rounded-lg bg-black/50 text-xs text-gray-400 hover:text-white backdrop-blur-sm border border-white/10"
      >
        Exit Browser
      </button>
    </div>
  );
}