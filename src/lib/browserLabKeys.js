// Windows Virtual Key codes for CDP Input.dispatchKeyEvent. Chromium expects
// windowsVirtualKeyCode even on other platforms.
const VK_MAP = {
  Enter: 13, Backspace: 8, Tab: 9, Escape: 27,
  ArrowUp: 38, ArrowDown: 40, ArrowLeft: 37, ArrowRight: 39,
  " ": 32, Delete: 46, Home: 36, End: 35, PageUp: 33, PageDown: 34,
  Shift: 16, Control: 17, Alt: 18, Meta: 91, CapsLock: 20, Insert: 45,
  F1: 112, F2: 113, F3: 114, F4: 115, F5: 116, F6: 117,
  F7: 118, F8: 119, F9: 120, F10: 121, F11: 122, F12: 123,
};

export function getVKCode(key) {
  if (VK_MAP[key] !== undefined) return VK_MAP[key];
  if (key && key.length === 1) return key.toUpperCase().charCodeAt(0);
  return 0;
}

// CDP modifier bitmask: Alt=1, Control=2, Meta=4, Shift=8
export function getModifiers(e) {
  return (e.altKey ? 1 : 0) | (e.ctrlKey ? 2 : 0) | (e.metaKey ? 4 : 0) | (e.shiftKey ? 8 : 0);
}

// Keys that produce text vs. keys that are purely control input.
export function isTextKey(key) {
  return !!key && key.length === 1;
}