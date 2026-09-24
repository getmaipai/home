import * as Popover from "@radix-ui/react-popover";
import { createContext, useContext, useState } from "react";
import { useAuiState } from "@assistant-ui/react";
import type { TurnStats } from "@maipai/home-backend/src/wire";
import { Button } from "@maipai/ui/src/ui/button";

export const ChatTurnStatsVisibleContext = createContext(false);

function number(value: number | null, suffix = ""): string | null {
  return value === null || !Number.isFinite(value) ? null : `${Number.isInteger(value) ? value : value.toFixed(1)}${suffix}`;
}

function summary(stats: TurnStats): string {
  const parts = [
    stats.prompt_tokens !== null ? `${number(stats.prompt_tokens)} prompt` : null,
    stats.predicted_tokens !== null ? `${number(stats.predicted_tokens)} generated` : null,
    stats.tokens_per_second !== null ? `${number(stats.tokens_per_second, " tok/s")}` : null,
    stats.time_to_first_token_ms !== null ? `${number(stats.time_to_first_token_ms, " ms")} first token` : null,
    stats.total_time_ms !== null ? `${number(stats.total_time_ms, " ms")} total` : null,
  ];
  return parts.filter((part): part is string => part !== null).join(" · ");
}

function DetailRow({ label, value }: { label: string; value: string | number | null }) {
  return <div className="flex items-baseline justify-between gap-6"><dt>{label}</dt><dd className="text-right font-medium">{value ?? "Not reported"}</dd></div>;
}

export function ChatTurnStats() {
  const visible = useContext(ChatTurnStatsVisibleContext);
  const stats = useAuiState((s) => (s.message.metadata?.custom as { stats?: TurnStats } | undefined)?.stats);
  const [open, setOpen] = useState(false);
  if (!visible || !stats) return null;
  const line = summary(stats);
  if (!line) return null;
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <Button type="button" variant="ghost" size="sm" className="mt-1 h-auto min-h-8 px-0 text-base text-muted-foreground hover:bg-transparent hover:text-foreground" aria-label="View reply stats">
          {line}
        </Button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content side="top" align="start" sideOffset={8} className="z-50 w-80 max-w-[calc(100vw-2rem)] rounded-xl border bg-popover p-4 text-popover-foreground shadow-lg">
          <h3 className="mb-3 text-base font-semibold">Reply details</h3>
          <dl className="flex flex-col gap-2 text-base">
            <DetailRow label="Prompt tokens" value={number(stats.prompt_tokens)} />
            <DetailRow label="Generated tokens" value={number(stats.predicted_tokens)} />
            <DetailRow label="Speed" value={number(stats.tokens_per_second, " tokens/s")} />
            <DetailRow label="First token" value={number(stats.time_to_first_token_ms, " ms")} />
            <DetailRow label="Total time" value={number(stats.total_time_ms, " ms")} />
            <DetailRow label="Context tokens" value={number(stats.context_tokens)} />
            <DetailRow label="Cache reused" value={number(stats.cache_reuse_tokens)} />
            <DetailRow label="Cache reuse" value={number(stats.cache_reuse_percent, "%")} />
            <DetailRow label="Engine" value={stats.engine} />
            <DetailRow label="Stop reason" value={stats.stop_reason} />
          </dl>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
