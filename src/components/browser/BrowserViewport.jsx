import React, { useEffect, useRef } from "react";
import { getVKCode, getModifiers } from "@/lib/browserLabClient";

// Displays the remote Chromium viewport (WebRTC JPEG frames on canvas) and
// forwards mouse / keyboard / scroll input to the real browser via CDP.
// Coordinate mapping: canvas display size → 1280×720 browser viewport.
export default function BrowserViewport({ session, onShortcut, onNavigate }) {
  const canvasRef = useRef(null);
  const containerRef = useRef(null);

  // Bind the active session's frame callback to this canvas.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !session) return;
    const ctx = canvas.getContext("2d");
    session._frameCallback = (img) => {
      ctx.drawImage(img, 0, 0, session.browserWidth, session.browserHeight);
    };
    if (session.lastFrame) ctx.drawImage(session.lastFrame, 0, 0, session.browserWidth, session.browserHeight);
    return () => { if (session) session._frameCallback = null; };
  }, [session]);

  const toBrowserCoords = (e) => {
    const rect = canvasRef.current.getBoundingClientRect();
    return {
      x: (e.clientX - rect.left) / rect.width * session.browserWidth,
      y: (e.clientY - rect.top) / rect.height * session.browserHeight,
    };
  };

  const onMouseDown = (e) => {
    if (!session) return;
    containerRef.current.focus();
    const { x, y } = toBrowserCoords(e);
    const btn = e.button === 2 ? "right" : e.button === 1 ? "middle" : "left";
    session.mouseDown(x, y, btn);
  };
  const onMouseUp = (e) => {
    if (!session) return;
    const { x, y } = toBrowserCoords(e);
    const btn = e.button === 2 ? "right" : e.button === 1 ? "middle" : "left";
    session.mouseUp(x, y, btn);
  };
  const onMouseMove = (e) => {
    if (!session) return;
    const { x, y } = toBrowserCoords(e);
    session.mouseMove(x, y);
  };
  const onWheel = (e) => {
    if (!session) return;
    e.preventDefault();
    const { x, y } = toBrowserCoords(e);
    const dY = e.deltaMode === 1 ? e.deltaY * 40 : e.deltaY;
    const dX = e.deltaMode === 1 ? e.deltaX * 40 : e.deltaX;
    session.scroll(x, y, dX, dY);
  };
  const onKeyDown = (e) => {
    if (!session) return;
    const mod = getModifiers(e);
    if (e.ctrlKey || e.metaKey) {
      if (e.key === "l") { e.preventDefault(); onShortcut("focus-address"); return; }
      if (e.key === "r") { e.preventDefault(); session.reload(); return; }
      if (e.key === "t") { e.preventDefault(); onShortcut("new-tab"); return; }
      if (e.key === "w") { e.preventDefault(); onShortcut("close-tab"); return; }
    }
    e.preventDefault();
    const vk = getVKCode(e.key);
    const isChar = e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey;
    if (isChar) session.sendKey("keyDown", { key: e.key, code: e.code, windowsVirtualKeyCode: vk, text: e.key, modifiers: mod });
    else session.sendKey("rawKeyDown", { key: e.key, code: e.code, windowsVirtualKeyCode: vk, modifiers: mod });
  };
  const onKeyUp = (e) => {
    if (!session) return;
    e.preventDefault();
    session.sendKey("keyUp", { key: e.key, code: e.code, windowsVirtualKeyCode: getVKCode(e.key), modifiers: getModifiers(e) });
  };

  const showNewTab = !session?.state?.url || session.state.url === "about:blank";

  return (
    <div className="relative flex-1 bg-[#0d0d0d] overflow-hidden">
      <div
        ref={containerRef}
        tabIndex={0}
        onMouseDown={onMouseDown}
        onMouseUp={onMouseUp}
        onMouseMove={onMouseMove}
        onWheel={onWheel}
        onKeyDown={onKeyDown}
        onKeyUp={onKeyUp}
        onContextMenu={(e) => e.preventDefault()}
        className="absolute inset-0 flex items-center justify-center outline-none"
      >
        {session && !showNewTab && (
          <canvas
            ref={canvasRef}
            width={1280}
            height={720}
            className="max-w-full max-h-full object-contain"
            style={{ cursor: "default" }}
          />
        )}
        {session && showNewTab && (
          <NewTabPage onNavigate={onNavigate} />
        )}
      </div>
    </div>
  );
}

function NewTabPage({ onNavigate }) {
  const [q, setQ] = React.useState("");
  const shortcuts = [
    { name: "Google", url: "https://www.google.com", color: "#4285F4" },
    { name: "YouTube", url: "https://www.youtube.com", color: "#FF0000" },
    { name: "Wikipedia", url: "https://www.wikipedia.org", color: "#000" },
    { name: "Reddit", url: "https://www.reddit.com", color: "#FF4500" },
    { name: "GitHub", url: "https://www.github.com", color: "#181717" },
    { name: "DuckDuckGo", url: "https://duckduckgo.com", color: "#DE5833" },
    { name: "Amazon", url: "https://www.amazon.com", color: "#FF9900" },
    { name: "BBC News", url: "https://www.bbc.com/news", color: "#BB1919" },
  ];
  const submit = (e) => { e.preventDefault(); if (q.trim()) onNavigate(q.trim()); };
  return (
    <div className="flex flex-col items-center justify-center gap-8 w-full max-w-2xl px-6">
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