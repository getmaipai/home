import { DevicesSection } from "@/apps/settings/DevicesSection";

// Session E step 6: "sessions and devices with revoke," a personal
// Profile page (own devices/sessions, not household-admin) - nested
// under SettingsPage's own route (App.tsx) the same way Voices/Commands
// are, since a device/session list with revoke is a real management
// surface, not a settings toggle.
export function DevicesPage() {
  return <DevicesSection />;
}
