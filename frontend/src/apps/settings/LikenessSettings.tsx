// LIKENESS-01: the person's own Settings, Pictures and videos page, below the two switches (the registry card above it): what
// agreeing means in plain words, the "Likeness use" log (who made what that looks like them, and when) and the dated history
// of their own answers. Only they see it. Kit primitives only (rule 9b).
import { useQuery } from "@tanstack/react-query";
import { Alert, AlertDescription, AlertTitle } from "@maipai/ui/src/ui/alert";
import { Item, ItemContent, ItemDescription, ItemGroup, ItemTitle } from "@maipai/ui/src/dashboard/components/ui/item";
import { likenessApi } from "@/lib/likenessApi";

const when = (iso: string) => new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });

export function LikenessSettings() {
  const me = useQuery({ queryKey: ["likeness-me"], queryFn: likenessApi.me, refetchInterval: 20_000 });
  if (me.isError) return <p role="alert" className="text-sm text-destructive">Home could not load this list. Check the Home connection, then reload this page.</p>;
  if (!me.data) return <p className="text-sm text-muted-foreground">Loading…</p>;
  const data = me.data;
  if (!data.eligible) return <p className="text-sm text-muted-foreground">Only an adult can agree to pictures and videos that look like them.</p>;
  return (
    <div className="flex min-w-0 flex-col gap-8">
      <Alert>
        <AlertTitle>What turning this on means</AlertTitle>
        <AlertDescription>
          Other adults in this household can make pictures and videos that look like you, from a photo of you or from a saved style of you. You are told each time, and each time is listed below.
          Turn it off and it stops right away: anything still waiting is stopped, nobody can ask for it again, and every saved style of you is removed. Pictures and videos already made stay with the person who made them.
          A photo of you is never turned into adult content, and children and teens can never be made this way.
        </AlertDescription>
      </Alert>
      <section aria-label="Likeness use" className="flex flex-col gap-3">
        <h2 className="text-sm font-medium">Likeness use</h2>
        {data.uses.length === 0 ? <p className="text-sm text-muted-foreground">Nobody has made anything that looks like you.</p> : (
          <ItemGroup variant="card" aria-label="Pictures and videos that look like you">
            {data.uses.map((use) => (
              <Item key={use.id}><ItemContent><ItemTitle>{use.line}</ItemTitle><ItemDescription clamp={false}>{when(use.used_at)}</ItemDescription></ItemContent></Item>
            ))}
          </ItemGroup>
        )}
      </section>
      <section aria-label="Your answers" className="flex flex-col gap-3">
        <h2 className="text-sm font-medium">Your answers</h2>
        {data.history.length === 0 ? <p className="text-sm text-muted-foreground">You have not changed these yet. Both start off.</p> : (
          <ItemGroup variant="card" aria-label="Your history">
            {data.history.map((event) => (
              <Item key={event.id}><ItemContent><ItemTitle>{event.option === "adults" ? "Other adults can make things that look like you" : "Including adult content"}: {event.state}</ItemTitle><ItemDescription clamp={false}>{when(event.changed_at)}</ItemDescription></ItemContent></Item>
            ))}
          </ItemGroup>
        )}
      </section>
    </div>
  );
}
