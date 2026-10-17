import type { ReactNode } from "react";
import { getIcon } from "@maipai/ui/src/icons";
import { Card } from "@maipai/ui/src/dashboard/components/ui/card";

export type CheckGridRow = { id: string; title: string; state: "green" | "amber" | "red" | "idle"; text: string; action?: string; actionLabel?: string };

const OkIcon = getIcon("check");
const WarnIcon = getIcon("alert-triangle");
const BadIcon = getIcon("x");

// Rows that cost the person nothing to skip: the storage page already covers disks and web search is chosen on the plan page. A disk row
// that is not green is shown, with the same words the installer and the plan page use (INSTALL-DISK-01).
const HIDDEN = new Set(["model-disk", "hub-disk", "web-search"]);
const SHOWN_WHEN_NOT_GREEN = new Set(["model-disk"]);
const AI_SERVER = new Set(["engine", "memory", "graphics-driver", "engine-link", "clock", "tailnet-allow", "tailnet-peer", "tailnet-route", "tailnet-latency"]);

export const visibleCheckRows = <T extends CheckGridRow>(rows: readonly T[]): T[] => rows.filter((row) => row.state !== "idle" && (!HIDDEN.has(row.id) || (SHOWN_WHEN_NOT_GREEN.has(row.id) && row.state !== "green")));

// One tile per check: a big green check, amber warning or red cross, the name, and words only when something needs a look.
export function CheckGrid<T extends CheckGridRow>({ rows, split, renderAction }: { rows: readonly T[]; split: boolean; renderAction?: (row: T) => ReactNode }) {
  const shown = visibleCheckRows(rows);
  const tile = (row: T) => {
    const Icon = row.state === "red" ? BadIcon : row.state === "amber" ? WarnIcon : OkIcon;
    const tone = row.state === "red" ? "text-destructive" : row.state === "amber" ? "text-[color:var(--hue-amber,var(--foreground))]" : "text-[color:var(--hue-teal)]";
    return (
      <Card key={row.id} size="sm" state={row.state === "red" ? "invalid" : row.state === "green" ? "valid" : undefined} data-check-state={row.state}>
        <div className="flex flex-col items-center gap-2 px-3 text-center">
          <Icon aria-hidden className={`size-8 ${tone}`} />
          <span className="text-base font-medium md:text-lg">{row.title}</span>
          <span className="sr-only">{row.state === "green" ? "Ready" : row.state === "amber" ? "Worth a look" : "Needs fixing"}</span>
          {row.state !== "green" ? <p className="text-sm text-muted-foreground md:text-base">{row.text}</p> : null}
          {renderAction?.(row)}
        </div>
      </Card>
    );
  };
  const section = (label: string, items: T[]) => items.length ? (
    <section aria-label={label} className="flex flex-col gap-2">
      {split ? <h3 className="text-base font-medium text-muted-foreground md:text-lg">{label}</h3> : null}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3">{items.map(tile)}</div>
    </section>
  ) : null;
  const ai = shown.filter((row) => AI_SERVER.has(row.id));
  const home = shown.filter((row) => !AI_SERVER.has(row.id));
  return <div className="flex flex-col gap-5">{section("Home computer", home)}{section("AI server", ai)}</div>;
}
