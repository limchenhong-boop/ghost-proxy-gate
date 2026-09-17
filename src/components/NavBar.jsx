import React from "react";
import { Home as HomeIcon, Film, Gamepad2, Search } from "lucide-react";

export default function NavBar({ onHome, onNavigate }) {
  return (
    <div
      className="flex items-center justify-between px-4 py-2.5 relative z-10"
      style={{ background: "#1a1a1a", borderBottom: "1px solid rgba(255,255,255,0.06)" }}
    >
      <span className="text-white/70 text-sm font-mono lowercase">ghost-oiud</span>
      <div className="flex items-center gap-5">
        <button onClick={onHome} className="flex items-center gap-1.5 text-white/70 hover:text-white text-sm transition">
          <HomeIcon className="w-4 h-4" /> <span className="hidden sm:inline">Home</span>
        </button>
        <button
          onClick={() => onNavigate("https://youtube.com/movies")}
          className="flex items-center gap-1.5 text-white/70 hover:text-white text-sm transition"
        >
          <Film className="w-4 h-4" /> <span className="hidden sm:inline">movies</span>
        </button>
        <button
          onClick={() => onNavigate("https://poki.com")}
          className="flex items-center gap-1.5 text-white/70 hover:text-white text-sm transition"
        >
          <Gamepad2 className="w-4 h-4" /> <span className="hidden sm:inline">games</span>
        </button>
        <button onClick={onHome} className="text-white/70 hover:text-white transition">
          <Search className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}