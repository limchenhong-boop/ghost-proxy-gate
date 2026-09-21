import React from "react";
import { X, CheckCircle, AlertCircle, Server, Activity } from "lucide-react";

export default function BrowserDiagnostics({ diagnostics, onClose }) {
  if (!diagnostics) {
    return (
      <div className="fixed bottom-0 left-0 right-0 z-50 bg-[#0d0d0d] border-t border-white/10 p-4">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-white">Diagnostics</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-white transition-colors"><X className="w-4 h-4" /></button>
        </div>
        <p className="text-xs text-gray-500 mt-2">No requests yet. Navigate to a page to see diagnostics.</p>
      </div>
    );
  }

  const hasError = diagnostics.directFetch || diagnostics.aiApiCalled;

  return (
    <div className="fixed bottom-0 left-0 right-0 z-50 bg-[#0d0d0d] border-t border-white/10 p-4 max-h-[50vh] overflow-y-auto">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Activity className="w-4 h-4 text-blue-400" />
          <h3 className="text-sm font-semibold text-white">Diagnostics</h3>
        </div>
        <button onClick={onClose} className="text-gray-400 hover:text-white transition-colors">
          <X className="w-4 h-4" />
        </button>
      </div>
      <div className="grid grid-cols-2 gap-3 text-xs">
        <div className="p-2 rounded-lg bg-white/5">
          <div className="flex items-center gap-1.5 text-gray-500 mb-1">
            <Server className="w-3 h-3" /> Backend endpoint
          </div>
          <p className="text-white font-mono break-all">{diagnostics.endpoint || "—"}</p>
        </div>
        <div className="p-2 rounded-lg bg-white/5">
          <div className="text-gray-500 mb-1">Response status</div>
          <p className="text-white font-mono">{diagnostics.status ?? "—"}</p>
        </div>
        <div className="p-2 rounded-lg bg-white/5">
          <div className="text-gray-500 mb-1">From Render backend</div>
          <div className="flex items-center gap-1.5">
            {diagnostics.fromRender ? (
              <><CheckCircle className="w-3.5 h-3.5 text-green-400" /><span className="text-green-400">Yes</span></>
            ) : (
              <><AlertCircle className="w-3.5 h-3.5 text-red-400" /><span className="text-red-400">No</span></>
            )}
          </div>
        </div>
        <div className="p-2 rounded-lg bg-white/5">
          <div className="text-gray-500 mb-1">AI / browser API called</div>
          <div className="flex items-center gap-1.5">
            {diagnostics.aiApiCalled ? (
              <><AlertCircle className="w-3.5 h-3.5 text-red-400" /><span className="text-red-400">Yes — ERROR</span></>
            ) : (
              <><CheckCircle className="w-3.5 h-3.5 text-green-400" /><span className="text-green-400">No</span></>
            )}
          </div>
        </div>
      </div>
      {hasError && (
        <div className="mt-3 p-3 rounded-lg bg-red-500/10 border border-red-500/20">
          <div className="flex items-start gap-2">
            <AlertCircle className="w-4 h-4 text-red-400 flex-shrink-0 mt-0.5" />
            <p className="text-red-300 text-xs leading-relaxed">
              {diagnostics.directFetch
                ? "ERROR: A direct target-site request was detected. All fetching must go through the Render proxy backend."
                : "ERROR: An AI browser API or browser automation endpoint was called. This is not allowed."}
            </p>
          </div>
        </div>
      )}
      <div className="mt-2 text-xs text-gray-600">
        Last request: {diagnostics.timestamp ? new Date(diagnostics.timestamp).toLocaleTimeString() : "—"}
      </div>
    </div>
  );
}