import React, { useEffect, useRef } from "react";
import { AlertCircle, RotateCw, ExternalLink, Loader2 } from "lucide-react";

// Displays proxied page content (rewritten HTML from proxyFetch) in a
// sandboxed srcDoc iframe. The client interceptor injected by proxyFetch
// posts navigation messages to the parent — this component forwards them
// via onMessage. Sub-resources load through the Render proxy backend.
//
// Perf: the message listener is bound ONCE (onMessage is read through a ref),
// and the component is memoized on the fields that actually affect output, so
// unrelated tab-state updates never reassign srcDoc — reassigning srcDoc forces
// the browser to tear down and re-parse the whole document, which is what made
// navigation feel laggy.
function ProxyViewport({ tab, onMessage }) {
  const onMessageRef = useRef(onMessage);
  onMessageRef.current = onMessage;

  useEffect(() => {
    const handler = (e) => {
      if (e.data && e.data.__vp === 1) onMessageRef.current(e.data);
    };
    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, []);

  if (tab.error) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4 px-6 text-center bg-[#0d0d0d]">
        <AlertCircle className="w-12 h-12 text-red-400/60" />
        <p className="text-lg text-gray-300 max-w-md">{tab.error}</p>
        <p className="text-sm text-gray-500 max-w-md break-all">{tab.url}</p>
        <div className="flex gap-3 mt-2">
          <button onClick={() => onMessage({ __vp: 1, url: tab.url })} className="flex items-center gap-2 px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-sm font-medium transition-colors">
            <RotateCw className="w-4 h-4" /> Retry
          </button>
          <a href={tab.url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 px-4 py-2 rounded-lg bg-white/10 hover:bg-white/20 text-sm font-medium transition-colors">
            <ExternalLink className="w-4 h-4" /> Open Directly
          </a>
        </div>
      </div>
    );
  }

  if (tab.loading && !tab.html) {
    return (
      <div className="flex items-center justify-center h-full bg-[#0d0d0d]">
        <Loader2 className="w-8 h-8 text-blue-500 animate-spin" />
      </div>
    );
  }

  return (
    <div className="relative w-full h-full bg-white">
      {tab.loading && <div className="vp-progress" />}
      <iframe
        srcDoc={tab.html || ""}
        sandbox="allow-same-origin allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox allow-modals allow-downloads"
        className="w-full h-full border-0 bg-white"
        title="Browser"
      />
    </div>
  );
}

// Only re-render (and therefore only touch srcDoc) when something visible
// actually changed. Keyed per tab id so switching tabs still swaps documents.
export default React.memo(ProxyViewport, (prev, next) =>
  prev.tab.id === next.tab.id &&
  prev.tab.html === next.tab.html &&
  prev.tab.loading === next.tab.loading &&
  prev.tab.error === next.tab.error &&
  prev.tab.url === next.tab.url
);