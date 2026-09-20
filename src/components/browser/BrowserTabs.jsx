import React from "react";
import { Globe, Loader2, X, Plus } from "lucide-react";

export default function BrowserTabs({ tabs, activeTabId, onSwitch, onClose, onNew }) {
  return (
    <div className="flex items-end gap-0.5 px-2 pt-1.5 bg-[#1a1a1a] overflow-x-auto scrollbar-none">
      {tabs.map((tab) => {
        const active = tab.id === activeTabId;
        return (
          <div
            key={tab.id}
            onClick={() => onSwitch(tab.id)}
            className={`group flex items-center gap-2 px-3 py-2 min-w-[120px] max-w-[200px] rounded-t-lg cursor-pointer transition-colors ${
              active ? "bg-[#2a2a2a] text-white" : "bg-[#222] text-gray-400 hover:bg-[#262626] hover:text-gray-200"
            }`}
          >
            {tab.loading ? (
              <Loader2 className="w-3.5 h-3.5 flex-shrink-0 animate-spin" />
            ) : (
              <Globe className="w-3.5 h-3.5 flex-shrink-0" />
            )}
            <span className="flex-1 truncate text-xs font-medium">
              {tab.title || "New Tab"}
            </span>
            <button
              onClick={(e) => { e.stopPropagation(); onClose(tab.id); }}
              className="flex-shrink-0 w-5 h-5 flex items-center justify-center rounded hover:bg-white/10 opacity-0 group-hover:opacity-100 transition-opacity"
            >
              <X className="w-3 h-3" />
            </button>
          </div>
        );
      })}
      <button
        onClick={onNew}
        className="flex items-center justify-center w-7 h-7 mb-1 ml-1 rounded-lg text-gray-400 hover:bg-white/10 hover:text-white transition-colors flex-shrink-0"
      >
        <Plus className="w-4 h-4" />
      </button>
    </div>
  );
}