// STACK-MENU-SYNC-01: the Monitor and Maintain tabs of Settings, Stack. Each lists the screens `spec/stack/screens.json` assigns to the tab, as stubs that
// open the Stack admin (no kit page exists for them yet). Monitor also keeps Home's Performance page (it was a tab of AI and models; it answers
// "is there enough memory"), and Maintain keeps the Hugging Face token (it was under AI and models, Advanced); the coding admin and the assistant
// keys follow Maintain from the settings page.
import type { SettingsViewProps } from "@/shell/pages/settings/settingsViews";
import { StackScreenStubs } from "@/apps/settings/stack/StackScreenStubs";
import { HuggingFaceTokenSection } from "@/apps/settings/HuggingFaceTokenSection";
import { PerformanceSettings } from "@/apps/settings/PerformanceSettings";

export function StackMonitor(props: SettingsViewProps) {
  return (
    <div className="flex min-w-0 flex-col gap-14">
      <StackScreenStubs tab="monitor" />
      <PerformanceSettings {...props} />
    </div>
  );
}

export function StackMaintain() {
  return (
    <div className="flex min-w-0 flex-col gap-14">
      <StackScreenStubs tab="maintain" />
      <HuggingFaceTokenSection />
    </div>
  );
}
