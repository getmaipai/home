import { useMemo } from "react";
import { Badge } from "@maipai/ui/src/ui/badge";
import { Button } from "@maipai/ui/src/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@maipai/ui/src/ui/collapsible";
import { Progress } from "@maipai/ui/src/ui/progress";
import { ELEMENTS, SCENARIO_FOR_ELEMENT, type ElementItem, type Status, type Verdict } from "@/dev/elementsAdoption";

// UI-SHOWCASE: "N / total implemented" for the kit's Elements, composed from
// the kit's Progress, Badge and Collapsible. Data: dev/elements-adoption.json.
const VERDICT_ORDER: Verdict[] = ["wire now", "wire after", "later", "no fit", "unassessed"];
const STATUS_VARIANT: Record<Status, "default" | "secondary" | "outline"> = { "implemented": "default", "in progress": "secondary", "not yet": "outline", "not for us": "outline" };

// "Implemented" means live in normal chat (mounted in the shared thread and
// producible by a real turn), as the audit file says. An Element that only a
// fixture shows is "playground only", counted separately and never as done.
export function ElementsAdoptionPanel({ items = ELEMENTS, scenarioIds, liveByScenario = {}, onPlay }: { items?: ElementItem[]; scenarioIds: ReadonlySet<string>; liveByScenario?: Record<string, string>; onPlay: (scenarioId: string) => void }) {
  const done = items.filter((item) => item.status === "implemented").length;
  const playgroundOnly = (item: ElementItem) => {
    const scenario = SCENARIO_FOR_ELEMENT[item.name];
    return item.status !== "implemented" && item.status !== "not for us" && scenario !== undefined && scenarioIds.has(scenario) && liveByScenario[scenario] !== "yes";
  };
  const onlyHere = items.filter(playgroundOnly).length;
  const notYet = items.filter((item) => item.status === "not yet" || item.status === "in progress").length - onlyHere;
  const percent = items.length ? Math.round((done / items.length) * 100) : 0;
  const counts = useMemo(() => VERDICT_ORDER.map((verdict) => [verdict, items.filter((item) => item.verdict === verdict).length] as const).filter(([, n]) => n > 0), [items]);
  const groups = useMemo(() => {
    const map = new Map<string, ElementItem[]>();
    for (const item of items) map.set(item.group, [...(map.get(item.group) ?? []), item]);
    return [...map.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [items]);

  return (
    <section aria-label="Elements adoption" className="flex flex-col gap-2 px-4 pb-2">
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <p className="text-3xl font-bold tracking-tight" data-slot="elements-adoption-total">{done} / {items.length} implemented</p>
        <p className="text-sm text-muted-foreground" data-slot="elements-adoption-split">in playground only: {onlyHere} · not yet: {notYet}</p>
        <div className="flex flex-wrap gap-1.5">
          {counts.map(([verdict, n]) => <Badge key={verdict} variant="outline">{verdict}: {n}</Badge>)}
        </div>
      </div>
      <Progress value={percent} aria-label={`${done} of ${items.length} Elements implemented`} />
      <Collapsible>
        <CollapsibleTrigger asChild><Button variant="ghost" size="sm">Show every Element</Button></CollapsibleTrigger>
        <CollapsibleContent className="flex max-h-64 flex-col gap-1 overflow-y-auto">
          {groups.map(([group, members]) => (
            <Collapsible key={group}>
              <CollapsibleTrigger asChild><Button variant="ghost" size="sm" className="w-full justify-between">{group}<span>{members.length}</span></Button></CollapsibleTrigger>
              <CollapsibleContent>
                <ul className="flex flex-col">
                  {members.map((item) => {
                    const scenario = SCENARIO_FOR_ELEMENT[item.name];
                    return (
                      <li key={item.file} className="flex items-center justify-between gap-2 px-3 py-1">
                        <span className="min-w-0 truncate text-sm">{item.name}</span>
                        <span className="flex items-center gap-2">
                          <Badge variant={STATUS_VARIANT[item.status]}>{playgroundOnly(item) ? "playground only" : item.status}</Badge>
                          {scenario && scenarioIds.has(scenario) ? <Button size="sm" variant="outline" onClick={() => onPlay(scenario)} aria-label={`Play the scenario for ${item.name}`}>Play</Button> : null}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </CollapsibleContent>
            </Collapsible>
          ))}
        </CollapsibleContent>
      </Collapsible>
    </section>
  );
}
