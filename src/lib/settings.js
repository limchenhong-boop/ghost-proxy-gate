export const THEMES = [
  { id: "violet", name: "Midnight Violet", bg: "#0B0314", bg2: "#1f0a3d", accent: "#a855f7", accent2: "#ec4899" },
  { id: "ocean", name: "Deep Ocean", bg: "#020617", bg2: "#0c1f3d", accent: "#06b6d4", accent2: "#3b82f6" },
  { id: "abyss", name: "Pure Abyss", bg: "#000000", bg2: "#111111", accent: "#6366f1", accent2: "#8b5cf6" },
  { id: "ember", name: "Dark Ember", bg: "#140606", bg2: "#2a0a0a", accent: "#f43f5e", accent2: "#fb923c" },
  { id: "forest", name: "Night Forest", bg: "#04120a", bg2: "#0a2417", accent: "#10b981", accent2: "#34d399" },
  { id: "royal", name: "Royal Indigo", bg: "#080a1f", bg2: "#14163a", accent: "#818cf8", accent2: "#c084fc" },
];

export const CLOAK_PRESETS = [
  { id: "none", name: "None (Velocity)", title: "Velocity Proxy", icon: "" },
  {
    id: "classroom",
    name: "Google Classroom",
    title: "Classes",
    icon: "https://www.google.com/s2/favicons?sz=128&domain_url=https://classroom.google.com",
  },
  {
    id: "drive",
    name: "Google Drive",
    title: "My Drive - Google Drive",
    icon: "https://www.google.com/s2/favicons?sz=128&domain_url=https://drive.google.com",
  },
  {
    id: "docs",
    name: "Google Docs",
    title: "Google Docs",
    icon: "https://www.google.com/s2/favicons?sz=128&domain_url=https://docs.google.com",
  },
  {
    id: "gmail",
    name: "Gmail",
    title: "Inbox - Gmail",
    icon: "https://www.google.com/s2/favicons?sz=128&domain_url=https://mail.google.com",
  },
  {
    id: "canvas",
    name: "Canvas LMS",
    title: "Dashboard",
    icon: "https://www.google.com/s2/favicons?sz=128&domain_url=https://canvas.instructure.com",
  },
];

const THEME_KEY = "vp_theme";
const CLOAK_KEY = "vp_cloak";

export function loadTheme() {
  try {
    const id = localStorage.getItem(THEME_KEY);
    return THEMES.find((t) => t.id === id) || THEMES[0];
  } catch {
    return THEMES[0];
  }
}

export function saveTheme(id) {
  try {
    localStorage.setItem(THEME_KEY, id);
  } catch {}
}

export function loadCloak() {
  try {
    const raw = localStorage.getItem(CLOAK_KEY);
    if (!raw) return CLOAK_PRESETS[0];
    return JSON.parse(raw);
  } catch {
    return CLOAK_PRESETS[0];
  }
}

export function saveCloak(cloak) {
  try {
    localStorage.setItem(CLOAK_KEY, JSON.stringify(cloak));
  } catch {}
}

export function applyCloak(cloak) {
  if (!cloak) return;
  if (cloak.title) document.title = cloak.title;
  let link = document.querySelector("link[rel='icon']");
  if (!cloak.icon) {
    if (link) link.remove();
    return;
  }
  if (!link) {
    link = document.createElement("link");
    link.rel = "icon";
    document.head.appendChild(link);
  }
  link.href = cloak.icon;
}