import React from "react";
import { THEMES } from "@/lib/settings";
import { Palette, Check } from "lucide-react";

export default function ThemePanel({ theme, onApply }) {
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 text-white/90">
        <Palette className="w-4 h-4" style={{ color: "var(--vp-accent)" }} />
        <h3 className="font-semibold">Theme</h3>
      </div>
      <p className="text-white/50 text-xs -mt-2">Pick a background and accent. Saved for next visit.</p>

      <div className="grid grid-cols-2 gap-2.5">
        {THEMES.map((t) => {
          const active = theme.id === t.id;
          return (
            <button
              key={t.id}
              onClick={() => onApply(t)}
              className="relative overflow-hidden rounded-xl border p-3 text-left transition"
              style={{
                background: `radial-gradient(circle at 30% 20%, ${t.bg2}, ${t.bg})`,
                borderColor: active ? t.accent : "rgba(255,255,255,0.1)",
                boxShadow: active ? `0 0 0 1px ${t.accent}, 0 8px 24px -8px ${t.accent}` : "none",
              }}
            >
              {active && (
                <span className="absolute top-2 right-2" style={{ color: t.accent }}>
                  <Check className="w-4 h-4" />
                </span>
              )}
              <div className="flex gap-1.5 mb-2">
                <span className="w-5 h-5 rounded-full" style={{ background: t.accent }} />
                <span className="w-5 h-5 rounded-full" style={{ background: t.accent2 }} />
              </div>
              <span className="text-white text-xs font-semibold">{t.name}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}