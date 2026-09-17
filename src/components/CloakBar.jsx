import React from "react";

export default function CloakBar() {
  return (
    <div className="flex items-center justify-between px-4 py-2 relative z-10" style={{ background: "#448aff" }}>
      <span className="text-white font-semibold text-sm tracking-wider">AZURE</span>
      <button className="px-3 py-1 rounded-md bg-white/15 hover:bg-white/25 text-white text-xs font-medium capitalize transition">
        google classroom
      </button>
      <span className="w-20" />
    </div>
  );
}