import { useState, useEffect } from "react";
import { X, Sparkles } from "lucide-react";
import { CHANGELOG_VERSION, CHANGELOG_DATE, CHANGELOG_ENTRIES } from "@/lib/changelog";

const STORAGE_KEY = "ghost-changelog-seen";

export default function UpdatePopup() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    try {
      const seen = parseInt(localStorage.getItem(STORAGE_KEY) || "0", 10);
      if (seen < CHANGELOG_VERSION) setOpen(true);
    } catch {
      setOpen(true);
    }
  }, []);

  const dismiss = () => {
    try { localStorage.setItem(STORAGE_KEY, String(CHANGELOG_VERSION)); } catch {}
    setOpen(false);
  };

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[150] flex items-center justify-center p-4"
      style={{ background: "rgba(0,0,0,0.6)", backdropFilter: "blur(8px)", WebkitBackdropFilter: "blur(8px)" }}
      onClick={dismiss}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="vp-glass vp-fade-up rounded-2xl p-6 w-full max-w-sm relative"
        style={{ background: "color-mix(in srgb, var(--vp-bg) 85%, black)", border: "1px solid rgba(255,255,255,0.1)" }}
      >
        <button
          onClick={dismiss}
          className="absolute top-3 right-3 w-7 h-7 flex items-center justify-center rounded-full text-white/50 hover:text-white hover:bg-white/10"
          aria-label="Dismiss"
        >
          <X className="w-3.5 h-3.5" />
        </button>

        <div className="flex items-center gap-2 mb-1">
          <Sparkles className="w-4 h-4" style={{ color: "var(--vp-accent)" }} />
          <span className="text-xs text-white/50 font-mono">v{CHANGELOG_VERSION} · {CHANGELOG_DATE}</span>
        </div>

        <h2 className="ghost-word text-4xl mb-5">what's new</h2>

        <ul className="space-y-2.5 mb-6">
          {CHANGELOG_ENTRIES.map((entry, i) => (
            <li key={i} className="flex items-start gap-2.5 text-sm text-white/75">
              <span className="mt-1.5 w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: "var(--vp-accent)" }} />
              {entry}
            </li>
          ))}
        </ul>

        <button
          onClick={dismiss}
          className="w-full py-2.5 rounded-full text-sm font-semibold text-white transition hover:opacity-90"
          style={{ background: "linear-gradient(135deg, var(--vp-accent), var(--vp-accent2))" }}
        >
          Got it
        </button>
      </div>
    </div>
  );
}