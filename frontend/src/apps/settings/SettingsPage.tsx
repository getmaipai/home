import { Page } from "@/kit/primitives/Page";
import { SettingsRenderer } from "@/kit/settings/SettingsRenderer";

// Household settings only tonight (Rule 2's Profile-scope settings -
// identity, appearance, notifications - need a profile picker/editor
// that doesn't exist yet). Person- and device-scope rendering work the
// same way through SettingsRenderer; only the scope prop changes once
// there's a UI surface to open them from.
export function SettingsPage() {
  return (
    <Page title="Settings">
      <SettingsRenderer scope="household" scopeValue="household" />
    </Page>
  );
}
