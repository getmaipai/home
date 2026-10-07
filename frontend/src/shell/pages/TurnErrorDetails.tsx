// Admin-only failure details, triggered from the shipped assistant action bar.
// CHAT-CALM-ERRORS-01c (design section 10): the cause in plain words, one
// next step, the raw facts and a Copy button, or no control at all. The
// words come from the hub (failureCopy.ts via the detail's `advice`); this
// file only lays out the facts it is given. Read the message's streamed
// detail first, then the stored row.
import { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Popover, PopoverContent, PopoverTrigger } from "@maipai/ui/src/ui/popover";
import { TooltipIconButton } from "@maipai/ui/src/assistant-ui/tooltip-icon-button";
import { useCopyToClipboard } from "@maipai/ui/src/elements/hooks/use-copy-to-clipboard";
import { getIcon } from "@maipai/ui/src/icons";
import { api, ApiError, type TurnErrorDetail } from "@/lib/api";

const AlertIcon = getIcon("alert-triangle");
const CopyIcon = getIcon("copy");
const CopiedIcon = getIcon("check");

type FactRow = { label: string; value: string; block?: boolean };

/** Whether a detail has anything to show. */
export function hasErrorFacts(detail: TurnErrorDetail | undefined): boolean {
  // Read defensively: an older hub or a stub may answer without the lists.
  return Boolean(detail && (detail.advice || (Array.isArray(detail.tools) && detail.tools.length > 0) || (Array.isArray(detail.generations) && detail.generations.length > 0)));
}

/** The label and value rows, in the order design section 10 lists them. */
function factRows(detail: TurnErrorDetail): FactRow[][] {
  const groups: FactRow[][] = [];
  for (const gen of Array.isArray(detail.generations) ? detail.generations : []) {
    // "Stack said" only when the Stack answered (a status or a state); otherwise it is the engine call's own error.
    const fromStack = gen.http_status !== undefined || gen.state !== undefined;
    const rows: FactRow[] = [{ label: "What failed", value: "engine" }, { label: fromStack ? "Stack said" : "Error", value: gen.error }];
    if (gen.state) rows.push({ label: "Stack state", value: gen.state });
    if (gen.offline_reason) rows.push({ label: "Stack reason", value: gen.offline_reason });
    if (gen.http_status !== undefined) rows.push({ label: "HTTP status", value: String(gen.http_status) });
    const timing = [`request sent at +${gen.request_sent_ms} ms`, gen.failed_ms !== undefined ? `failed at +${gen.failed_ms} ms` : null, gen.failed_at ?? null].filter(Boolean).join(", ");
    rows.push({ label: "Timing", value: timing });
    if (gen.model_id || gen.engine_id) rows.push({ label: "Model and engine", value: [gen.model_id, gen.engine_id].filter(Boolean).join(" on ") });
    if (gen.raw_body) rows.push({ label: "Raw body", value: gen.raw_body, block: true });
    groups.push(rows);
  }
  for (const tool of Array.isArray(detail.tools) ? detail.tools : []) {
    const rows: FactRow[] = [{ label: "What failed", value: tool.tool_id }, { label: "Failure", value: tool.error_code ? `${tool.kind} (${tool.error_code})` : tool.kind }];
    if (tool.error_text) rows.push({ label: "Error", value: tool.error_text });
    if (tool.duration_ms !== undefined) rows.push({ label: "Took", value: `${tool.duration_ms} ms` });
    if (tool.at) rows.push({ label: "At", value: tool.at });
    groups.push(rows);
  }
  return groups;
}

/** Every row as plain text, for the Copy button. */
export function detailAsText(detail: TurnErrorDetail): string {
  const lines: string[] = [];
  if (detail.advice) lines.push(`Cause: ${detail.advice.cause}`, `Next step: ${detail.advice.next_step}`);
  if (!detail.found) lines.push("Saved: no");
  for (const group of factRows(detail)) {
    lines.push("");
    for (const row of group) lines.push(`${row.label}: ${row.value}`);
  }
  return [`Turn: ${detail.turn_id}`, ...lines].join("\n");
}

function DetailBody({ detail }: { detail: TurnErrorDetail }) {
  const { isCopied, copyToClipboard } = useCopyToClipboard();
  if (!hasErrorFacts(detail)) {
    return <p className="text-muted-foreground text-xs">{detail.found ? "Nothing failed on this reply." : "No details were saved for this reply."}</p>;
  }
  return (
    <div className="flex max-h-80 flex-col gap-3 overflow-y-auto">
      {detail.advice ? (
        <div className="flex flex-col gap-1">
          <p className="text-sm">{detail.advice.cause}</p>
          <p className="text-muted-foreground text-xs">
            {detail.advice.repairs ? <Link to="/repairs" className="underline">{detail.advice.next_step}</Link> : detail.advice.next_step}
          </p>
        </div>
      ) : null}
      {factRows(detail).map((rows, index) => (
        <dl key={index} className="flex flex-col gap-1.5">
          {rows.map((row) => (
            <div key={row.label} className="flex flex-col gap-0.5">
              <dt className="text-muted-foreground text-xs">{row.label}</dt>
              <dd className={row.block ? "font-mono text-xs break-all whitespace-pre-wrap" : "font-mono text-xs break-words whitespace-pre-wrap"}>{row.value}</dd>
            </div>
          ))}
        </dl>
      ))}
      <div className="flex justify-end">
        <TooltipIconButton tooltip={isCopied ? "Copied" : "Copy details"} aria-label="Copy details" side="top" onClick={() => copyToClipboard(detailAsText(detail))}>
          {isCopied ? <CopiedIcon className="size-3.5" /> : <CopyIcon className="size-3.5" />}
        </TooltipIconButton>
      </div>
    </div>
  );
}

function StoredDetail({ turnId }: { turnId: string }) {
  const query = useQuery<TurnErrorDetail>({ queryKey: ["turn-error-detail", turnId], queryFn: () => api.turnErrorDetail(turnId) });
  if (query.data) return <DetailBody detail={query.data} />;
  if (query.isError) {
    const status = query.error instanceof ApiError && query.error.status > 0 ? String(query.error.status) : "the hub did not answer";
    return <p className="text-muted-foreground text-xs">{`The details request failed: ${status}`}</p>;
  }
  return <p className="text-muted-foreground text-xs">Reading the details…</p>;
}

/** `streamed` is the detail the turn's own error event carried (kept in
 * the message metadata, so it works before a reload and in a temporary
 * chat); without it the stored row is read when the popover opens. */
export function TurnErrorDetails({ turnId, streamed }: { turnId?: string; streamed?: TurnErrorDetail }) {
  const [open, setOpen] = useState(false);
  const live = streamed && hasErrorFacts(streamed) ? streamed : undefined;
  if (!live && !turnId) return null;
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <TooltipIconButton aria-label="Error details" tooltip="Error details" side="top" className="text-muted-foreground">
          <AlertIcon className="size-3.5" />
        </TooltipIconButton>
      </PopoverTrigger>
      <PopoverContent align="start">
        {open ? (live ? <DetailBody detail={live} /> : <StoredDetail turnId={turnId!} />) : null}
      </PopoverContent>
    </Popover>
  );
}
