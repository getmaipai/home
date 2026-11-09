// MEM-SPACE-13: the host-tune list under Settings > Performance, owner only. The same detect, apply and revert routes the setup wizard's "Tune this computer" step uses; no second way to write the markers.
import { i18n } from "@lingui/core";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@maipai/ui/src/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@maipai/ui/src/ui/card";
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
      setError(reason instanceof ApiError ? `${reason.message.replace(/\s+$/, "")} ${reason.next ?? i18n._({ id: "Try again.", message: "Try again." })}`.trim() : i18n._({ id: "Home could not change that setting. Try again.", message: "Home could not change that setting. Try again." }));
    } finally { setBusyId(null); }
  }

  return (
    <section data-testid="host-tune-settings">
      <Card surface="flat">
        <CardHeader>
          <CardTitle>{i18n._({ id: "Tune this computer", message: "Tune this computer" })}</CardTitle>
          <CardDescription>{i18n._({ id: "Changes that help the AI run well on this computer. Each one can be put back.", message: "Changes that help the AI run well on this computer. Each one can be put back." })}</CardDescription>
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
                    <ItemDescription clamp={false}>{done ? i18n._({ id: "On. {proposed}.", message: "On. {proposed}.", values: { proposed: item.proposed } }) : item.state === "unknown" ? i18n._({ id: "Home can't tell what this is set to, so it leaves it alone.", message: "Home can't tell what this is set to, so it leaves it alone." }) : i18n._({ id: "Now: {current}. After: {proposed}.", message: "Now: {current}. After: {proposed}.", values: { current: item.current, proposed: item.proposed } })}</ItemDescription>
                  </ItemContent>
                  <ItemActions>
                    {item.state === "applied" || (item.state === "ok" && item.mode === "auto")
                      ? <Button type="button" variant="outline" disabled={busyId !== null} onClick={() => void run(item, "revert")}>{busyId === item.id ? i18n._({ id: "Reverting", message: "Reverting" }) : i18n._({ id: "Revert", message: "Revert" })}</Button>
                      : item.state === "needs" ? <Button type="button" disabled={busyId !== null} onClick={() => void run(item, "apply")}>{busyId === item.id ? i18n._({ id: "Applying", message: "Applying" }) : i18n._({ id: "Apply", message: "Apply" })}</Button> : null}
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
