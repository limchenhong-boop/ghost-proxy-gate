import React from "react";
import { Search, Loader2, ArrowRight } from "lucide-react";

export default function VelocitySearch({ value, onChange, onSubmit, loading, large = true, autoFocus = true }) {
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit();
      }}
      className="relative w-full"
    >
      <div className="vp-glow" aria-hidden="true" />
      <div className="vp-border-wrap">
        <div className="vp-border-rot" aria-hidden="true" />
        <div className="vp-input-inner">
          <Search className={large ? "w-5 h-5 md:w-6 md:h-6" : "w-4 h-4"} style={{ color: "var(--vp-accent)" }} />
          <input
            type="text"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            autoFocus={autoFocus}
            placeholder={large ? "Enter a URL or search the web…" : "Search or enter address"}
            spellCheck={false}
            autoComplete="off"
            className="flex-1 bg-transparent outline-none border-0 text-white placeholder-white/40 font-medium"
            style={{ fontSize: large ? "1.05rem" : "0.95rem" }}
          />
          <button
            type="submit"
            disabled={loading || !value.trim()}
            className="vp-go-btn"
            style={{ background: "linear-gradient(135deg, var(--vp-accent), var(--vp-accent2))" }}
          >
            {loading ? (
              <Loader2 className="w-5 h-5 animate-spin" />
            ) : large ? (
              <>
                <span className="hidden sm:inline">Launch</span>
                <ArrowRight className="w-5 h-5" />
              </>
            ) : (
              <ArrowRight className="w-4 h-4" />
            )}
          </button>
        </div>
      </div>
    </form>
  );
}