// Settings, Stack, General: the live use of the Stack's computer, read from the Stack's own status and memory ledger (`/api/ai/stack/status` and
// `/api/ai/stack/memory`, passed through unchanged; Home keeps no copy and no logic of its own). It shows the memory share the Stack may use, what is
// loaded and how much each part holds, and the jobs. Drawn from shipped kit primitives only (Item, Progress); Monitor links to the full screens.
import { i18n } from "@lingui/core";
import { useQuery } from "@tanstack/react-query";
import { Progress } from "@maipai/ui/src/ui/progress";
import { formatBytes } from "@maipai/ui/src/format";
import { Item, ItemContent, ItemDescription, ItemGroup, ItemTitle } from "@maipai/ui/src/dashboard/components/ui/item";
import { requestJson } from "@/lib/api";

export interface StackStatusView {
  busy?: { running?: number; waiting?: number };
  memory?: { total_bytes?: number; free_bytes?: number; budget_bytes?: number; pressure?: string };
  jobs?: Array<{ id: string; kind: string; state: string; percent?: number | null }>;
}
export interface StackMemoryView {
  ledger?: { reserved_bytes?: number; warm_bytes?: number; budget_bytes?: number; items?: Array<{ id: string; class?: string; live_bytes?: number | null }> };
}

export const STACK_STATUS_KEY = ["ai-stack-status"] as const;
export const STACK_MEMORY_KEY = ["ai-stack-memory"] as const;

const PART_NAMES: Record<string, string> = { chat: "Chat", embed: "Search and memory", judge: "Safety check", stt: "Voice in", tts: "Voice out", "image-pool": "Pictures", video: "Video", music: "Music", vision: "Vision" };
const partName = (id: string) => PART_NAMES[id] ?? id;
const ACTIVE_JOB = new Set(["running", "waiting", "queued", "paused"]);

export function StackUsage() {
  const status = useQuery({ queryKey: STACK_STATUS_KEY, queryFn: () => requestJson<StackStatusView>("/api/ai/stack/status"), refetchInterval: 5_000 });
  const memory = useQuery({ queryKey: STACK_MEMORY_KEY, queryFn: () => requestJson<StackMemoryView>("/api/ai/stack/memory"), refetchInterval: 5_000 });
  if (!status.data) return null;
  const budget = memory.data?.ledger?.budget_bytes ?? status.data.memory?.budget_bytes ?? 0;
  const held = (memory.data?.ledger?.reserved_bytes ?? 0) + (memory.data?.ledger?.warm_bytes ?? 0);
  const percent = budget > 0 ? Math.min(100, Math.round((held / budget) * 100)) : 0;
  const loaded = (memory.data?.ledger?.items ?? []).filter((item) => (item.live_bytes ?? 0) > 0);
  const running = status.data.busy?.running ?? 0;
  const waiting = status.data.busy?.waiting ?? 0;
  const active = (status.data.jobs ?? []).filter((job) => ACTIVE_JOB.has(job.state));
  const label = i18n._({ id: "Memory the Stack may use", message: "Memory the Stack may use" });
  return (
    <section aria-label={i18n._({ id: "Use right now", message: "Use right now" })} className="flex flex-col gap-3" data-testid="stack-usage">
      <h3 className="text-row font-semibold">{i18n._({ id: "Use right now", message: "Use right now" })}</h3>
      <ItemGroup variant="card">
        <Item size="setting">
          <ItemContent>
            <ItemTitle>{label}</ItemTitle>
            <ItemDescription clamp={false}>{i18n._({ id: "{held} of {budget} in use", message: "{held} of {budget} in use", values: { held: formatBytes(held), budget: formatBytes(budget) } })}</ItemDescription>
            <Progress value={percent} aria-label={label} />
          </ItemContent>
        </Item>
        <Item size="setting">
          <ItemContent>
            <ItemTitle>{i18n._({ id: "Loaded now", message: "Loaded now" })}</ItemTitle>
            <ItemDescription clamp={false}>
              {loaded.length === 0
                ? i18n._({ id: "Nothing is loaded.", message: "Nothing is loaded." })
                : loaded.map((item) => `${partName(item.id)} ${formatBytes(item.live_bytes ?? 0)}`).join(", ")}
            </ItemDescription>
          </ItemContent>
        </Item>
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
