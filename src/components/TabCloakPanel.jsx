import React, { useState } from "react";
import { CLOAK_PRESETS } from "@/lib/settings";
import { Eye, Check } from "lucide-react";

export default function TabCloakPanel({ cloak, onApply }) {
  const [customTitle, setCustomTitle] = useState(cloak.id === "custom" ? cloak.title : "");
  const [customIcon, setCustomIcon] = useState(cloak.id === "custom" ? cloak.icon : "");

  const select = (preset) => {
    onApply(preset);
  };

  const applyCustom = () => {
    onApply({
      id: "custom",
      name: "Custom",
      title: customTitle.trim() || "Velocity Proxy",
      icon: customIcon.trim() || "",
    });
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 text-white/90">
        <Eye className="w-4 h-4" style={{ color: "var(--vp-accent)" }} />
        <h3 className="font-semibold">Tab Cloak</h3>
      </div>
      <p className="text-white/50 text-xs -mt-2">Disguise this tab as a common school/work site.</p>

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
        {CLOAK_PRESETS.map((p) => {
          const active = cloak.id === p.id;
          return (
            <button
              key={p.id}
              onClick={() => select(p)}
              className="relative flex flex-col items-center gap-1.5 p-3 rounded-xl border text-white/80 hover:text-white transition"
              style={{
                background: active ? "color-mix(in srgb, var(--vp-accent) 18%, transparent)" : "rgba(255,255,255,0.04)",
                borderColor: active ? "var(--vp-accent)" : "rgba(255,255,255,0.08)",
              }}
            >
              {active && (
                <span className="absolute top-1.5 right-1.5" style={{ color: "var(--vp-accent)" }}>
                  <Check className="w-3.5 h-3.5" />
                </span>
              )}
              {p.icon ? (
                <img src={p.icon} alt="" className="w-6 h-6 rounded" />
              ) : (
                <span className="w-6 h-6 rounded flex items-center justify-center text-[10px] font-bold text-white" style={{ background: "linear-gradient(135deg, var(--vp-accent), var(--vp-accent2))" }}>
                  V
                </span>
              )}
              <span className="text-[11px] font-medium text-center leading-tight">{p.name}</span>
            </button>
          );
        })}
      </div>

      <div className="pt-2 border-t border-white/10 space-y-2">
        <p className="text-white/60 text-xs font-medium">Custom</p>
        <input
          value={customTitle}
          onChange={(e) => setCustomTitle(e.target.value)}
          placeholder="Tab title"
          className="w-full px-3 py-2 rounded-lg text-sm text-white bg-white/5 border border-white/10 outline-none focus:border-[var(--vp-accent)]"
        />
        <input
          value={customIcon}
          onChange={(e) => setCustomIcon(e.target.value)}
          placeholder="Icon URL (favicon)"
          className="w-full px-3 py-2 rounded-lg text-sm text-white bg-white/5 border border-white/10 outline-none focus:border-[var(--vp-accent)]"
        />
        <button
          onClick={applyCustom}
          className="w-full py-2 rounded-lg text-sm font-semibold text-white"
          style={{ background: "linear-gradient(135deg, var(--vp-accent), var(--vp-accent2))" }}
        >
          Apply Custom
        </button>
      </div>
    </div>
  );
}