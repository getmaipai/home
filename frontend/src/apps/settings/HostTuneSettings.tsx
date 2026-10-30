// MEM-SPACE-13: the host-tune list under Settings > Performance, owner only. The same detect, apply and revert routes the setup wizard's "Tune this computer" step uses; no second way to write the markers.
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@maipai/ui/src/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@maipai/ui/src/dashboard/components/ui/card";
import { Item, ItemActions, ItemContent, ItemDescription, ItemGroup, ItemTitle } from "@maipai/ui/src/dashboard/components/ui/item";
import { api, ApiError, type HostTuneItem } from "@/lib/api";

const KEY = ["host-tune"];

export function HostTuneSettings() {
  const queryClient = useQueryClient();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { data } = useQuery({ queryKey: KEY, queryFn: () => api.setupHostTune(), retry: false });
  const items = data?.supported ? data.items.filter((item) => item.mode !== "advice") : [];
  if (items.length === 0) return null;

  async function run(item: HostTuneItem, verb: "apply" | "revert") {
    setError(null);
    setBusyId(item.id);
    try {
      const { item: next } = await (verb === "apply" ? api.setupHostTuneApply(item.id) : api.setupHostTuneRevert(item.id));
      queryClient.setQueryData(KEY, { ...data!, items: data!.items.map((entry) => (entry.id === next.id ? next : entry)) });
    } catch (reason) {
      setError(reason instanceof ApiError ? `${reason.message.replace(/\s+$/, "")} ${reason.next ?? "Try again."}`.trim() : "Home could not change that setting. Try again.");
    } finally { setBusyId(null); }
  }

  return (
    <section data-testid="host-tune-settings">
      <Card>
        <CardHeader>
          <CardTitle>Tune this computer</CardTitle>
          <CardDescription>Changes that help the AI run well on this computer. Each one can be put back.</CardDescription>
        </CardHeader>
        <CardContent>
          {error ? <p role="alert">{error}</p> : null}
          <ItemGroup variant="card">
            {items.map((item) => {
              const done = item.state === "ok" || item.state === "applied";
              return (
                <Item key={item.id} size="setting" data-testid="host-tune-item">
                  <ItemContent>
                    <ItemTitle>{item.title}</ItemTitle>
                    <ItemDescription clamp={false}>{done ? `On. ${item.proposed}.` : item.state === "unknown" ? "Home can't tell what this is set to, so it leaves it alone." : `Now: ${item.current}. After: ${item.proposed}.`}</ItemDescription>
                  </ItemContent>
                  <ItemActions>
                    {item.state === "applied" || (item.state === "ok" && item.mode === "auto")
                      ? <Button type="button" variant="outline" disabled={busyId !== null} onClick={() => void run(item, "revert")}>{busyId === item.id ? "Reverting" : "Revert"}</Button>
                      : item.state === "needs" ? <Button type="button" disabled={busyId !== null} onClick={() => void run(item, "apply")}>{busyId === item.id ? "Applying" : "Apply"}</Button> : null}
                  </ItemActions>
                </Item>
              );
            })}
          </ItemGroup>
        </CardContent>
      </Card>
    </section>
  );
}
