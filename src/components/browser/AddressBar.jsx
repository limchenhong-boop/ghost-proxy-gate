import React, { useState, useEffect, useRef } from "react";
import { Lock, Search, X } from "lucide-react";

export default function AddressBar({ url, loading, canGoBack, canGoForward, onNavigate, onBack, onForward, onReload, onStop, onHome, isBookmarked, onToggleBookmark, focusSignal }) {
  const [value, setValue] = useState(url || "");
  const [editing, setEditing] = useState(false);
  const inputRef = useRef(null);

  useEffect(() => { if (!editing) setValue(url || ""); }, [url, editing]);
  useEffect(() => { if (focusSignal) inputRef.current?.focus(); inputRef.current?.select(); }, [focusSignal]);

  const submit = (e) => {
    e?.preventDefault();
    if (value.trim()) { onNavigate(value.trim()); setEditing(false); inputRef.current?.blur(); }
  };

  const isUrl = /^https?:\/\//i.test(value);
  const showSecure = isUrl && url.startsWith("https://");

  return (
    <div className="flex items-center gap-1 px-2 py-1.5 bg-[#2a2a2a]">
      <NavBtn onClick={onBack} disabled={!canGoBack}>←</NavBtn>
      <NavBtn onClick={onForward} disabled={!canGoForward}>→</NavBtn>
      <NavBtn onClick={loading ? onStop : onReload}>{loading ? "✕" : "↻"}</NavBtn>
      <NavBtn onClick={onHome}>⌂</NavBtn>
      <form onSubmit={submit} className="flex-1 flex items-center bg-[#1a1a1a] rounded-full px-3 py-1.5 border border-transparent focus-within:border-blue-500/50 transition-colors">
        {showSecure ? <Lock className="w-3.5 h-3.5 text-green-400 flex-shrink-0 mr-2" /> : <Search className="w-3.5 h-3.5 text-gray-500 flex-shrink-0 mr-2" />}
        <input
          ref={inputRef}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onFocus={() => { setEditing(true); setTimeout(() => inputRef.current?.select(), 0); }}
          onBlur={() => setEditing(false)}
          placeholder="Search or enter address"
          className="flex-1 bg-transparent text-sm text-white placeholder-gray-500 outline-none"
          spellCheck={false}
        />
        {editing && value && (
          <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => { setValue(""); inputRef.current?.focus(); }} className="ml-2 text-gray-500 hover:text-white">
            <X className="w-3.5 h-3.5" />
          </button>
        )}
      </form>
      <NavBtn onClick={onToggleBookmark} active={isBookmarked}>{isBookmarked ? "★" : "☆"}</NavBtn>
    </div>
  );
}

function NavBtn({ children, onClick, disabled, active }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`flex items-center justify-center w-8 h-8 rounded-lg text-base transition-colors flex-shrink-0 ${
        disabled ? "text-gray-600 cursor-default" : active ? "text-yellow-400 hover:bg-white/10" : "text-gray-300 hover:bg-white/10 hover:text-white"
      }`}
    >
      {children}
    </button>
  );
}