import React, { useState } from "react";
import { Pencil, Loader2 } from "lucide-react";

const APPS = [
  { name: "YouTube", url: "https://youtube.com", domain: "youtube.com" },
  { name: "GitHub", url: "https://github.com", domain: "github.com" },
  { name: "Discord", url: "https://discord.com", domain: "discord.com" },
  { name: "TikTok", url: "https://tiktok.com", domain: "tiktok.com" },
  { name: "Google", url: "https://google.com", domain: "google.com" },
  { name: "Twitter/X", url: "https://twitter.com", domain: "twitter.com" },
  { name: "GeForce Now", url: "https://geforcenow.com", domain: "geforcenow.com" },
  { name: "Netflix", url: "https://netflix.com", domain: "netflix.com" },
  { name: "Games", url: "https://poki.com", domain: "poki.com" },
  { name: "AI", url: "https://chatgpt.com", domain: "chatgpt.com" },
  { name: "Music", url: "https://music.youtube.com", domain: "music.youtube.com" },
  { name: "Chat", url: "https://discord.com", domain: "discord.com" },
];

export default function QuickApps({ onOpen }) {
  const [loadingApp, setLoadingApp] = useState(null);

  const handleClick = async (app) => {
    if (loadingApp) return;
    setLoadingApp(app.name);
    const guard = setTimeout(() => setLoadingApp(null), 8000);
    try {
      await onOpen(app.url);
    } finally {
      clearTimeout(guard);
      setLoadingApp(null);
    }
  };

  return (
    <div className="w-full max-w-3xl mx-auto">
      <div className="flex items-center justify-between mb-3 px-1">
        <h2 className="text-white/80 text-sm font-semibold tracking-wide">Quick apps</h2>
        <button className="flex items-center gap-1.5 text-white/50 hover:text-white text-xs font-medium transition">
          <Pencil className="w-3.5 h-3.5" /> Edit
        </button>
      </div>
      <div className="grid grid-cols-4 gap-3 sm:gap-4">
        {APPS.map((app) => {
          const isLoading = loadingApp === app.name;
          return (
            <button
              key={app.name}
              onClick={() => handleClick(app)}
              disabled={!!loadingApp}
              className="group flex flex-col items-center gap-2 p-3 rounded-xl bg-white/[0.03] hover:bg-white/[0.07] border border-white/5 hover:border-white/10 transition disabled:opacity-60"
            >
              <div className="w-12 h-12 sm:w-14 sm:h-14 rounded-xl bg-white/5 flex items-center justify-center overflow-hidden group-hover:scale-105 transition">
                {isLoading ? (
                  <Loader2 className="w-6 h-6 animate-spin" style={{ color: "var(--vp-accent)" }} />
                ) : (
                  <img
                    src={`https://www.google.com/s2/favicons?sz=64&domain_url=https://${app.domain}`}
                    alt=""
                    className="w-7 h-7"
                  />
                )}
              </div>
              <span className="text-white/60 group-hover:text-white text-xs text-center truncate w-full">
                {app.name}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}