// Changelog for the "what's new" popup.
//
// To show the popup after a new publish, bump CHANGELOG_VERSION and update
// CHANGELOG_DATE / CHANGELOG_ENTRIES. Each user only sees the popup once per
// version (the dismissed version is stored in localStorage).

export const CHANGELOG_VERSION = 1;
export const CHANGELOG_DATE = "Sep 18, 2026";
export const CHANGELOG_ENTRIES = [
  "Full SPA proxying via Scramjet gateway",
  "500-endpoint residential IP rotation",
  "Tab cloak & theme presets",
  "Minimalist monochrome interface",
];