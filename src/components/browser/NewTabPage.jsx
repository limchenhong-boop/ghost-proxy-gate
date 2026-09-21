import React, { useState } from "react";

export default function NewTabPage({ onNavigate }) {
  const [q, setQ] = useState("");
  const shortcuts = [
    { name: "Google", url: "https://www.google.com", color: "#4285F4" },
    { name: "YouTube", url: "https://www.youtube.com", color: "#FF0000" },
    { name: "Wikipedia", url: "https://www.wikipedia.org", color: "#333" },
    { name: "Reddit", url: "https://www.reddit.com", color: "#FF4500" },
    { name: "GitHub", url: "https://www.github.com", color: "#181717" },
    { name: "DuckDuckGo", url: "https://duckduckgo.com", color: "#DE5833" },
    { name: "Amazon", url: "https://www.amazon.com", color: "#FF9900" },
    { name: "BBC News", url: "https://www.bbc.com/news", color: "#BB1919" },
  ];
  const submit = (e) => { e.preventDefault(); if (q.trim()) onNavigate(q.trim()); };
  return (
    <div className="flex flex-col items-center justify-center gap-8 w-full max-w-2xl mx-auto h-full px-6 bg-[#0d0d0d]">
      <h1 className="text-4xl font-light text-gray-300 tracking-wide">New Tab</h1>
      <form onSubmit={submit} className="w-full">
        <input
          autoFocus
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search or enter address"
          className="w-full px-5 py-3 rounded-full bg-[#1a1a1a] border border-[#333] text-white placeholder-gray-500 text-sm outline-none focus:border-blue-500/50 transition-colors"
          spellCheck={false}
        />
      </form>
      <div className="grid grid-cols-4 gap-3 w-full">
        {shortcuts.map((s) => (
          <button key={s.name} onClick={() => onNavigate(s.url)} className="flex flex-col items-center gap-2 p-3 rounded-xl hover:bg-white/5 transition-colors">
            <div className="w-10 h-10 rounded-full flex items-center justify-center text-white text-sm font-bold" style={{ background: s.color }}>
              {s.name[0]}
            </div>
            <span className="text-xs text-gray-400">{s.name}</span>
          </button>
        ))}
      </div>
    </div>
  );
}