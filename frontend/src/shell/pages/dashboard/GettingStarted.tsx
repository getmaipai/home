import { Link } from "react-router-dom";
import { Button } from "@maipai/ui/src/dashboard/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@maipai/ui/src/dashboard/components/ui/card";
import { Item, ItemActions, ItemContent, ItemGroup, ItemTitle } from "@maipai/ui/src/dashboard/components/ui/item";
import type { Roster, SetupChecklistItem } from "@/lib/api";
import { useSetupChecklist } from "@/shell/useSetupChecklist";

/** The most open steps Home lists at once; the rest live in Settings, General. */
export const GETTING_STARTED_ROWS = 3;

export function openChecklistItems(items: SetupChecklistItem[] | undefined): SetupChecklistItem[] {
  return (Array.isArray(items) ? items : []).filter((item) => !item.done);
}

/** HOME-ALIVE-01g, first form: the owner's and admins' unfinished setup steps from the existing checklist,
 * gone when all are done. Members never reach the checklist read, so they never see this. */
export function GettingStarted({ person }: { person: Roster }) {
  const { checklist, dismiss, allowed } = useSetupChecklist(person);
  const open = openChecklistItems(checklist.data);
  if (!allowed || open.length === 0) return null;
  const rows = open.slice(0, GETTING_STARTED_ROWS);
  return (
    <section aria-label="Getting started">
      <Card size="sm">
        <CardHeader><CardTitle>Getting started</CardTitle></CardHeader>
        <CardContent>
          <ItemGroup>
            {rows.map((item) => (
              <Item key={item.id} size="sm" role="listitem">
                <ItemContent><ItemTitle>{item.title}</ItemTitle></ItemContent>
                <ItemActions>
                  <Button variant="outline" size="row" nativeButton={false} render={<Link to={item.open.href} />}>{item.open.label}<span className="sr-only"> {item.title}</span></Button>
                  <Button variant="ghost" size="row" disabled={dismiss.isPending} onClick={() => dismiss.mutate(item.id)}>Skip<span className="sr-only"> {item.title}</span></Button>
                </ItemActions>
              </Item>
            ))}
          </ItemGroup>
          {open.length > rows.length ? <Button variant="link" size="row" nativeButton={false} render={<Link to="/settings/household?tab=general" />}>{`Show ${open.length - rows.length} more`}</Button> : null}
        </CardContent>
      </Card>
    </section>
  );
}
