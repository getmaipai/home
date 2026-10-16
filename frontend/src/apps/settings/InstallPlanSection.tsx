import { useState } from "react";
import { PlanStep } from "@/apps/setup/PlanStep";
import { InstallStrip } from "@/shell/InstallStrip";
import { api } from "@/lib/api";

/** Home settings, AI: the same plan the setup wizard shows, re-read from
 * this computer now, with the install progress under it. Run it again
 * after adding memory or a graphics card, or to finish a stopped install. */
export function InstallPlanSection() {
  const [started, setStarted] = useState(false);
  return (
    <section aria-labelledby="install-plan-heading" className="flex flex-col gap-3">
      <h2 id="install-plan-heading" className="text-lg font-semibold">Install the AI for this computer</h2>
      <InstallStrip detailsHref={null} />
      {started ? <p role="status">Downloading started. You can keep using Home while it finishes.</p> : null}
      <PlanStep readPlan={api.installPlan} start={api.installStart} actionLabel="Download what's missing" onInstalled={() => setStarted(true)} />
    </section>
  );
}
