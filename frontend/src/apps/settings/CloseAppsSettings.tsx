// MEM-SPACE-09: Close apps for big jobs. A two-way switch, an Always close list and a Never close list, each with a picker, a starter list and (Always) a Reopen when done switch per app. Every change states its effect first (auto-close-apps note section 5).
import { i18n } from "@lingui/core";
import { useState } from "react";
import { Button } from "@maipai/ui/src/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@maipai/ui/src/ui/select";
import { Switch } from "@maipai/ui/src/ui/switch";
import { RadioGroup, RadioGroupItem } from "@maipai/ui/src/dashboard/components/ui/radio-group";
import { Item, ItemActions, ItemContent, ItemDescription, ItemGroup, ItemTitle } from "@maipai/ui/src/dashboard/components/ui/item";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@maipai/ui/src/ui/card";
import { STARTER_ALWAYS, STARTER_NEVER, parseList, specKey, type StarterApp } from "@/apps/settings/performanceModel";
import { useRunningApps } from "@/apps/settings/usePerformanceSettings";
import { HelperStatusRow } from "@/apps/settings/HelperStatusRow";
import { request } from "@/lib/api";
import { useQueryClient } from "@tanstack/react-query";

type Value = (key: string) => unknown;
type Write = (changes: Record<string, unknown>) => Promise<void>;
const LIST_KEYS = { always: "resources.close_apps.always", never: "resources.close_apps.never" } as const;
const MODE = "resources.close_apps.mode";
const NO_REOPEN = "resources.close_apps.no_reopen";

function AppList({ kind, value, write, names, candidates, starter }: { kind: "always" | "never"; value: Value; write: Write; names: Map<string, string>; candidates: StarterApp[]; starter: StarterApp[] }) {
  const [effect, setEffect] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const list = parseList(value(LIST_KEYS[kind]));
  const other = parseList(value(LIST_KEYS[kind === "always" ? "never" : "always"]));
  const noReopen = parseList(value(NO_REOPEN));
  const nameOf = (id: string) => names.get(id) ?? id;
  const save = async (changes: Record<string, unknown>, sentence: string) => {
    setError(null);
    try { await write(changes); setEffect(sentence); } catch { setError(i18n._({ id: "Home could not save that change. Check your connection and try again.", message: "Home could not save that change. Check your connection and try again." })); }
  };
  const add = (id: string) => {
    const name = nameOf(id);
    return save({ [LIST_KEYS[kind]]: JSON.stringify([...list, id]) }, kind === "always" ? (value("resources.close_apps.reopen") === false ? i18n._({ id: "{name} will be closed when a big job needs room.", message: "{name} will be closed when a big job needs room.", values: { name } }) : i18n._({ id: "{name} will be closed when a big job needs room, and reopened afterwards.", message: "{name} will be closed when a big job needs room, and reopened afterwards.", values: { name } })) : i18n._({ id: "{name} will always stay open.", message: "{name} will always stay open.", values: { name } }));
  };
  const addable = candidates.filter((app) => !list.includes(app.bundleId));
  const starterToAdd = starter.filter((app) => !list.includes(app.bundleId));
  const title = kind === "always" ? i18n._({ id: "Always close", message: "Always close" }) : i18n._({ id: "Never close", message: "Never close" });
  const blurb = kind === "always" ? i18n._({ id: "Home may quit these when a big job needs room and nothing else is left to try.", message: "Home may quit these when a big job needs room and nothing else is left to try." }) : i18n._({ id: "Home never quits these, even if they are also on the Always close list.", message: "Home never quits these, even if they are also on the Always close list." });
  return (
    <section aria-label={title} data-testid={`close-apps-${kind}`}>
      <ItemGroup variant="card">
        <Item size="setting">
          <ItemContent><ItemTitle>{title}</ItemTitle><ItemDescription clamp={false}>{blurb}</ItemDescription></ItemContent>
        </Item>
        <div className="flex flex-wrap gap-2 px-4 pb-3">
            {starterToAdd.length > 0 ? <Button variant="outline" onClick={() => save({ [LIST_KEYS[kind]]: JSON.stringify([...list, ...starterToAdd.map((app) => app.bundleId)]) }, kind === "always" ? i18n._({ id: "The starter apps will be closed when a big job needs room. Review the list, then turn Automatic on.", message: "The starter apps will be closed when a big job needs room. Review the list, then turn Automatic on." }) : i18n._({ id: "The starter apps will always stay open.", message: "The starter apps will always stay open." }))}>{i18n._({ id: "Use the starter list", message: "Use the starter list" })}</Button> : null}
            {addable.length > 0 ? (
              <Select value="" onValueChange={(id) => { if (id) void add(id); }}>
                <SelectTrigger aria-label={i18n._({ id: "Add an app to {title}", message: "Add an app to {title}", values: { title } })}><SelectValue placeholder={i18n._({ id: "Add an app", message: "Add an app" })} /></SelectTrigger>
                <SelectContent>{addable.map((app) => <SelectItem key={app.bundleId} value={app.bundleId}>{app.name}</SelectItem>)}</SelectContent>
              </Select>
            ) : null}
        </div>
        {list.length === 0 ? <Item size="setting"><ItemContent><ItemDescription clamp={false}>{kind === "always" ? i18n._({ id: "No apps yet, so Home closes nothing.", message: "No apps yet, so Home closes nothing." }) : i18n._({ id: "No apps added. The built-in protected apps are never closed either way.", message: "No apps added. The built-in protected apps are never closed either way." })}</ItemDescription></ItemContent></Item> : null}
        {list.map((id) => (
          <Item key={id} size="setting">
            <ItemContent>
              <ItemTitle>{nameOf(id)}</ItemTitle>
              {kind === "always" && other.includes(id) ? <ItemDescription clamp={false}>{i18n._({ id: "This app is also on the Never close list, so it stays open.", message: "This app is also on the Never close list, so it stays open." })}</ItemDescription> : null}
            </ItemContent>
            <ItemActions>
              {kind === "always" ? <Switch aria-label={i18n._({ id: "Reopen {name} when done", message: "Reopen {name} when done", values: { name: nameOf(id) } })} checked={!noReopen.includes(id)} onCheckedChange={(on) => void save({ [NO_REOPEN]: JSON.stringify(on ? noReopen.filter((x) => x !== id) : [...noReopen, id]) }, on ? i18n._({ id: "{name} will reopen when the job is done.", message: "{name} will reopen when the job is done.", values: { name: nameOf(id) } }) : i18n._({ id: "{name} will stay closed when the job is done.", message: "{name} will stay closed when the job is done.", values: { name: nameOf(id) } }))} /> : null}
              <Button variant="outline" aria-label={i18n._({ id: "Remove {name}", message: "Remove {name}", values: { name: nameOf(id) } })} onClick={() => void save({ [LIST_KEYS[kind]]: JSON.stringify(list.filter((x) => x !== id)) }, kind === "always" ? i18n._({ id: "{name} will no longer be closed.", message: "{name} will no longer be closed.", values: { name: nameOf(id) } }) : i18n._({ id: "{name} can be closed again if it is on the Always close list.", message: "{name} can be closed again if it is on the Always close list.", values: { name: nameOf(id) } }))}>{i18n._({ id: "Remove", message: "Remove" })}</Button>
            </ItemActions>
          </Item>
        ))}
      </ItemGroup>
      {effect ? <p role="status" data-testid={`close-apps-${kind}-effect`}>{effect}</p> : null}
      {error ? <p role="alert">{error}</p> : null}
    </section>
  );
}

export function CloseAppsSettings({ value, write }: { value: Value; write: Write }) {
  const running = useRunningApps();
  const client = useQueryClient();
  const options = specKey(MODE).copy?.options ?? {};
  const mode = value(MODE) === "automatic" ? "automatic" : "off";
  const names = new Map<string, string>([...STARTER_ALWAYS, ...STARTER_NEVER, ...(running.data?.apps ?? []).map((app) => ({ bundleId: app.bundleId, name: app.name }))].map((app) => [app.bundleId, app.name]));
  // The picker offers what is running now when the helper is installed, else the starter apps by name.
  const candidates: StarterApp[] = running.data?.installed ? running.data.apps.map((app) => ({ bundleId: app.bundleId, name: app.name })) : [...STARTER_ALWAYS, ...STARTER_NEVER];
  const [error, setError] = useState<string | null>(null);
  return (
    <section aria-label={i18n._({ id: "Close apps for big jobs", message: "Close apps for big jobs" })} data-testid="close-apps-card"><Card surface="flat">
      <CardHeader>
        <CardTitle>{i18n._({ id: "Close apps for big jobs", message: "Close apps for big jobs" })}</CardTitle>
        <CardDescription>{specKey(MODE).help}</CardDescription>
      </CardHeader>
      <CardContent>
        <RadioGroup value={mode} onValueChange={(next) => { setError(null); write({ [MODE]: next }).catch(() => setError(i18n._({ id: "Home could not save that change. Check your connection and try again.", message: "Home could not save that change. Check your connection and try again." }))); }}>
          <ItemGroup variant="card">
            {(["off", "automatic"] as const).map((id) => (
              <Item key={id} size="setting">
                <ItemContent><ItemTitle>{id === "off" ? i18n._({ id: "Off", message: "Off" }) : i18n._({ id: "Automatic", message: "Automatic" })}</ItemTitle><ItemDescription clamp={false}>{options[id]}</ItemDescription></ItemContent>
                <ItemActions><RadioGroupItem value={id} aria-label={id === "off" ? i18n._({ id: "Off", message: "Off" }) : i18n._({ id: "Automatic", message: "Automatic" })} /></ItemActions>
              </Item>
            ))}
          </ItemGroup>
        </RadioGroup>
        {error ? <p role="alert">{error}</p> : null}
        {running.isSuccess && !running.data.installed ? <HelperStatusRow canInstall={running.data.can_install === true} install={() => request("/api/performance/apps/install", { method: "POST", body: "{}" })} onInstalled={() => void client.invalidateQueries({ queryKey: ["performance-apps"] })} /> : null}
        <AppList kind="always" value={value} write={write} names={names} candidates={candidates} starter={STARTER_ALWAYS} />
        <AppList kind="never" value={value} write={write} names={names} candidates={candidates} starter={STARTER_NEVER} />
      </CardContent>
    </Card></section>
  );
}
