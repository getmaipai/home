import { useMemo } from "react";
import { Badge } from "@maipai/ui/src/ui/badge";
import { Button } from "@maipai/ui/src/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@maipai/ui/src/ui/collapsible";
import { Progress } from "@maipai/ui/src/ui/progress";
import { ELEMENTS, SCENARIO_FOR_ELEMENT, type ElementItem, type Status, type Verdict } from "@/dev/elementsAdoption";

// UI-SHOWCASE: "N / M in use in chat" for planned chat Elements, composed from
// the kit's Progress, Badge and Collapsible. Data: dev/elements-adoption.json.
const VERDICT_ORDER: Verdict[] = ["wire now", "wire after", "support", "later", "no fit", "unassessed"];
const STATUS_VARIANT: Record<Status, "default" | "secondary" | "outline"> = { "implemented": "default", "in progress": "secondary", "not yet": "outline", "not for us": "outline" };

export function ElementsAdoptionPanel({ items = ELEMENTS, scenarioIds, onPlay }: { items?: ElementItem[]; scenarioIds: ReadonlySet<string>; onPlay: (scenarioId: string) => void }) {
  const done = items.filter((item) => item.status === "implemented").length;
  const percent = items.length ? Math.round((done / items.length) * 100) : 0;
  const counts = useMemo(() => VERDICT_ORDER.map((verdict) => [verdict, items.filter((item) => item.verdict === verdict).length] as const).filter(([, n]) => n > 0), [items]);
  const groups = useMemo(() => {
    return VERDICT_ORDER.flatMap((verdict) => {
      const members = items.filter((item) => item.verdict === verdict);
      if (!members.length) return [];
      const statuses = ["implemented", "in progress", "not yet", "not for us"] as const;
      return [{ verdict, members: statuses.flatMap((status) => {
        const matching = members.filter((item) => item.status === status);
        return matching.length ? [{ status, members: matching }] : [];
      }) }];
    });
  }, [items]);

  return (
    <section aria-label="Elements adoption" className="flex flex-col gap-2 px-4 pb-2">
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <p className="text-3xl font-bold tracking-tight" data-slot="elements-adoption-total">Elements implemented: {done} / {items.length}</p>
        <div className="flex flex-wrap gap-1.5">
          {counts.map(([verdict, n]) => <Badge key={verdict} variant="outline">{verdict}: {n}</Badge>)}
        </div>
      </div>
      <p>Not planned for chat: {items.filter((item) => item.verdict === "no fit").length} no fit, {items.filter((item) => item.verdict === "later").length} later, {items.filter((item) => item.verdict === "support").length} supporting parts.</p>
      <Progress value={percent} aria-label={`${done} of ${items.length} Elements implemented`} />
      <Collapsible>
        <CollapsibleTrigger asChild><Button variant="ghost" size="sm">Show every Element</Button></CollapsibleTrigger>
        <CollapsibleContent className="flex max-h-64 flex-col gap-1 overflow-y-auto">
          {groups.map(({ verdict, members }) => (
            <Collapsible key={verdict}>
              <CollapsibleTrigger asChild><Button variant="ghost" size="sm" className="w-full justify-between">{verdict}<span>{members.reduce((sum, group) => sum + group.members.length, 0)}</span></Button></CollapsibleTrigger>
              <CollapsibleContent>
                {members.map(({ status, members: statusItems }) => <div key={status}>
                  <h4 className="px-3 pt-2 text-xs font-semibold uppercase">{status} ({statusItems.length})</h4>
                  <ul className="flex flex-col">
                    {statusItems.map((item) => {
                      const scenario = SCENARIO_FOR_ELEMENT[item.name];
                      return (
                        <li key={item.file} className="flex items-center justify-between gap-2 px-3 py-1">
                          <span className="min-w-0 truncate text-sm" title={item.verdictReason}>{item.name}</span>
                          <span className="flex items-center gap-2">
                            <Badge variant={STATUS_VARIANT[item.status]}>{item.status}</Badge>
                            {scenario && scenarioIds.has(scenario) ? <Button size="sm" variant="outline" onClick={() => onPlay(scenario)} aria-label={`Play the scenario for ${item.name}`}>Play</Button> : null}
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                </div>)}
              </CollapsibleContent>
            </Collapsible>
          ))}
        </CollapsibleContent>
      </Collapsible>
    </section>
  );
}
