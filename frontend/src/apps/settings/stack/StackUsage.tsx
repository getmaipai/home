// Settings, Stack, General: the live use of the Stack's computer. The colored memory breakdown is the one shared kit component the Stack's own admin page
// draws (`StackMemoryNow`), fed the Stack's own readings through Home's forwarder (`/api/ai/stack/resources/summary`, `/resources/engines`, `/components`,
// `/choices` for the feature order, all passed through unchanged); Home keeps no copy and no logic of its own. The jobs line reads the Stack's status.
import { i18n } from "@lingui/core";
import { useQuery } from "@tanstack/react-query";
import { StackMemoryNow } from "@maipai/ui/src/stack/StackMemoryNow";
import type { StackMemoryEngine, StackMemoryReading } from "@maipai/ui/src/stack/stackMemory";
import { Item, ItemContent, ItemDescription, ItemGroup, ItemTitle } from "@maipai/ui/src/dashboard/components/ui/item";
import { requestJson } from "@/lib/api";

export interface StackStatusView {
  busy?: { running?: number; waiting?: number };
  jobs?: Array<{ id: string; kind: string; state: string; percent?: number | null }>;
}
interface ResourcesSummary { current: (StackMemoryReading & Record<string, unknown>) | null }
interface ResourcesEngines { budget?: { cap_bytes?: number }; engines: Array<StackMemoryEngine & Record<string, unknown>> }
interface ComponentsView { components: Array<{ id: string; label: string; kind: string }> }
interface ChoicesView { categories: Array<{ role: string | null }> }

export const STACK_STATUS_KEY = ["ai-stack-status"] as const;
export const STACK_RESOURCES_KEY = ["ai-stack-resources-summary"] as const;
export const STACK_ENGINES_KEY = ["ai-stack-resources-engines"] as const;
const ACTIVE_JOB = new Set(["running", "waiting", "queued", "paused"]);

export function StackUsage() {
  const status = useQuery({ queryKey: STACK_STATUS_KEY, queryFn: () => requestJson<StackStatusView>("/api/ai/stack/status"), refetchInterval: 5_000 });
  const summary = useQuery({ queryKey: STACK_RESOURCES_KEY, queryFn: () => requestJson<ResourcesSummary>("/api/ai/stack/resources/summary"), refetchInterval: 5_000 });
  const engines = useQuery({ queryKey: STACK_ENGINES_KEY, queryFn: () => requestJson<ResourcesEngines>("/api/ai/stack/resources/engines"), refetchInterval: 5_000 });
  const parts = useQuery({ queryKey: ["ai-stack-components"], queryFn: () => requestJson<ComponentsView>("/api/ai/stack/components"), staleTime: 5 * 60_000 });
  const order = useQuery({ queryKey: ["ai-stack-feature-order"], queryFn: () => requestJson<ChoicesView>("/api/ai/stack/choices"), staleTime: 5 * 60_000 });
  const names = new Map((parts.data?.components ?? []).filter((part) => part.kind === "model").map((part) => [part.id, part.label]));
  const modelName = (id: string | null) => (id ? names.get(id) ?? null : null);
  if (!status.data || !summary.data) return null;
  const running = status.data.busy?.running ?? 0;
  const waiting = status.data.busy?.waiting ?? 0;
  const active = (status.data.jobs ?? []).filter((job) => ACTIVE_JOB.has(job.state));
  const featureOrder = (order.data?.categories ?? []).flatMap((category) => (category.role ? [category.role] : []));
  return (
    <section aria-label={i18n._({ id: "Use right now", message: "Use right now" })} className="flex flex-col gap-3" data-testid="stack-usage">
      <h3 className="text-row font-semibold">{i18n._({ id: "Use right now", message: "Use right now" })}</h3>
      <StackMemoryNow current={summary.data.current} engines={engines.data?.engines ?? null} budgetBytes={engines.data?.budget?.cap_bytes ?? null} modelName={modelName} featureOrder={featureOrder} />
      <ItemGroup variant="card">
        <Item size="setting">
          <ItemContent>
            <ItemTitle>{i18n._({ id: "Jobs", message: "Jobs" })}</ItemTitle>
            <ItemDescription clamp={false}>
              {running + waiting === 0 && active.length === 0
                ? i18n._({ id: "Nothing is running or waiting.", message: "Nothing is running or waiting." })
                : i18n._({ id: "{running} running, {waiting} waiting", message: "{running} running, {waiting} waiting", values: { running, waiting } })}
            </ItemDescription>
          </ItemContent>
        </Item>
      </ItemGroup>
    </section>
  );
}
