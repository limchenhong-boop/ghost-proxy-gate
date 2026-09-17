import React from "react";
import { Sparkles, MessageCircle, Info } from "lucide-react";

export default function AppFooter({ onSettings }) {
  return (
    <>
      <div className="fixed bottom-4 left-4 z-20">
        <button className="w-8 h-8 rounded-full border border-white/15 text-white/50 hover:text-white hover:border-white/30 flex items-center justify-center transition">
          <Info className="w-4 h-4" />
        </button>
      </div>
      <div className="fixed bottom-4 right-4 z-20 flex items-center gap-4 text-white/50 text-xs">
        <button className="flex items-center gap-1 hover:text-white transition">
          <Sparkles className="w-3.5 h-3.5" /> AI
        </button>
        <button className="flex items-center gap-1 hover:text-white transition">
          <MessageCircle className="w-3.5 h-3.5" /> Discord
        </button>
        <button onClick={onSettings} className="hover:text-white transition">Settings</button>
        <button className="hover:text-white transition">Terms</button>
        <button className="hover:text-white transition">Privacy</button>
        <button className="hover:text-white transition">Credits</button>
      </div>
    </>
  );
}