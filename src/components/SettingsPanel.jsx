import React from "react";
import TabCloakPanel from "@/components/TabCloakPanel";
import ThemePanel from "@/components/ThemePanel";

export default function SettingsPanel({ cloak, theme, onApplyCloak, onApplyTheme }) {
  return (
    <div className="space-y-6">
      <TabCloakPanel cloak={cloak} onApply={onApplyCloak} />
      <div className="border-t border-white/10" />
      <ThemePanel theme={theme} onApply={onApplyTheme} />
    </div>
  );
}