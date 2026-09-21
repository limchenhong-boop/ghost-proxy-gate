import React, { useState } from "react";
import { X, Save, Server, Shield } from "lucide-react";
import { saveBackendUrl } from "@/lib/browserSettings";

export default function BrowserSettings({ backendUrl, onSaveBackendUrl, onClose }) {
  const [url, setUrl] = useState(backendUrl || "");

  const save = () => {
    const trimmed = url.trim().replace(/\/$/, "");
    saveBackendUrl(trimmed);
    onSaveBackendUrl(trimmed);
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div className="w-full max-w-md bg-[#1a1a1a] border border-white/10 rounded-2xl p-6 m-4" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-lg font-semibold text-white">Browser Settings</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-white transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="space-y-4">
          <div>
            <label className="flex items-center gap-2 text-xs text-gray-400 mb-1.5 uppercase tracking-wide">
              <Server className="w-3.5 h-3.5" /> Proxy Backend URL
            </label>
            <input
              type="text"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://your-render-gateway.onrender.com"
              className="w-full px-3 py-2 rounded-lg bg-[#0d0d0d] border border-white/10 text-white text-sm outline-none focus:border-blue-500/50 transition-colors"
              spellCheck={false}
            />
            <p className="text-xs text-gray-500 mt-1.5 leading-relaxed">
              The URL of your Render-hosted proxy backend. Leave empty to use the server default.
              The backend handles all page fetching through a residential proxy — credentials are never exposed to the frontend.
            </p>
          </div>
          <button onClick={save} className="flex items-center gap-2 px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-sm font-medium w-full justify-center transition-colors">
            <Save className="w-4 h-4" /> Save Settings
          </button>
        </div>
        <div className="mt-6 pt-4 border-t border-white/10">
          <div className="flex items-start gap-2">
            <Shield className="w-4 h-4 text-gray-500 flex-shrink-0 mt-0.5" />
            <p className="text-xs text-gray-500 leading-relaxed">
              This is a managed proxy browsing architecture, not an unrestricted open proxy.
              The frontend is a browser shell only — all page retrieval is isolated in the backend service.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}