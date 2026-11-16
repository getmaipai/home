import type { Issue } from "@maipai/spec/gen/ts/issue.js";
import { isStackConfigured } from "@/lib/stackEngine";
import { roleHealth, type HealthRole } from "@/lib/roleHealth";
import { listSidecars } from "@/lib/sidecars";

const roles = new Set<HealthRole>(["music", "video", "image"]);

/** Returns false only when a known issue's underlying condition is gone. */
export async function issueStillTrue(issue: Issue): Promise<boolean> {
  try {
    if (issue.source === "stack" && (issue.key === "link.down" || issue.key.startsWith("offline."))) {
      // A configured local or remote Stack is checked by the current role health.
      return !isStackConfigured() || (await roleHealth("chat", { live: true, fresh: true })).availability !== "ready";
    }
    if ((issue.source === "stack" && issue.key === "stack.not-configured") || issue.key === "stack.not-configured") return !isStackConfigured();
    if (issue.source === "stack-requirement" && issue.key === "stack.not-configured") return !isStackConfigured();
    const engineRole = issue.source.endsWith("-engine") ? issue.source.slice(0, -"-engine".length) : null;
    if (engineRole && roles.has(engineRole as HealthRole) && issue.key === "died") {
      return (await roleHealth(engineRole as HealthRole, { live: true, fresh: true })).availability !== "ready";
    }
    if (issue.source.startsWith("sidecar:")) {
      const id = issue.source.slice("sidecar:".length);
      const sidecar = listSidecars().find((row) => row.id === id);
      if (!sidecar) return true;
      return issue.key === "crashed" ? sidecar.status === "crashed" || sidecar.status === "unhealthy" : issue.key === "slow_start" ? sidecar.status === "starting" : true;
    }
    if (["music", "video", "image"].includes(issue.key) && issue.title.startsWith("No engine can be started for ")) {
      return (await roleHealth(issue.key as HealthRole, { live: true, fresh: true })).availability !== "ready";
    }
    if (issue.key === "comfyui.not-built" || issue.detail.includes("ComfyUI environment is not built")) {
      return listSidecars().some((row) => row.id.toLowerCase().includes("comfy") && row.status !== "running");
    }
    return true;
  } catch {
    return true;
  }
}
