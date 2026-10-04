// THIN-1E (rule 6): the admin's quiet error indicator. Composed from the
// kit's shipped parts as they ship: TooltipIconButton as the trigger,
// Popover for the details. The ToolTimeline Element has no per-step detail
// slot (a named gap for the design record), so this sits beside it.
// The detail is read only once the popover opens, and only an admin ever
// renders this (the route also 403s anyone else).
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Popover, PopoverContent, PopoverTrigger } from "@maipai/ui/src/ui/popover";
import { TooltipIconButton } from "@maipai/ui/src/assistant-ui/tooltip-icon-button";
import { getIcon } from "@maipai/ui/src/icons";
import { api, type TurnErrorDetail } from "@/lib/api";

const InfoIcon = getIcon("info");

function Row({ label, children }: { label: string; children: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-muted-foreground text-xs">{label}</dt>
      <dd className="font-mono text-xs break-words whitespace-pre-wrap">{children}</dd>
    </div>
  );
}

function DetailBody({ detail }: { detail: TurnErrorDetail }) {
  return (
    <div className="flex max-h-80 flex-col gap-3 overflow-y-auto">
      {detail.tools.map((tool) => (
        <dl key={tool.call_id} className="flex flex-col gap-1.5">
          <Row label="Tool">{tool.tool_id}</Row>
          <Row label="Failure">{tool.error_code ? `${tool.kind} (${tool.error_code})` : tool.kind}</Row>
          {tool.error_text ? <Row label="Error">{tool.error_text}</Row> : null}
          {tool.duration_ms !== undefined ? <Row label="Took">{`${tool.duration_ms} ms`}</Row> : null}
          {tool.at ? <Row label="At">{tool.at}</Row> : null}
        </dl>
      ))}
      {detail.generations.map((gen, index) => (
        <dl key={index} className="flex flex-col gap-1.5">
          <Row label="Generation">{gen.reason}</Row>
          <Row label="Error">{gen.error}</Row>
          {gen.offline_reason ? <Row label="Stack said">{gen.offline_reason}</Row> : null}
        </dl>
      ))}
    </div>
  );
}

export function TurnErrorDetails({ turnId }: { turnId: string }) {
  const [open, setOpen] = useState(false);
  const query = useQuery<TurnErrorDetail>({ queryKey: ["turn-error-detail", turnId], queryFn: () => api.turnErrorDetail(turnId), enabled: open });
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <TooltipIconButton tooltip="Error details" side="top" className="text-foreground/45 hover:text-foreground/80">
          <InfoIcon className="size-3.5" />
        </TooltipIconButton>
      </PopoverTrigger>
      <PopoverContent align="start">
        {query.data ? <DetailBody detail={query.data} /> : <p className="text-muted-foreground text-xs">{query.isError ? "The details could not be read." : "Reading the details…"}</p>}
      </PopoverContent>
    </Popover>
  );
}
