// MEM-SPACE-09: Close apps for big jobs. A two-way switch, an Always close list and a Never close list, each with a picker, a starter list and (Always) a Reopen when done switch per app. Every change states its effect first (auto-close-apps note section 5).
import { useState } from "react";
import { Button } from "@maipai/ui/src/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@maipai/ui/src/ui/select";
import { Switch } from "@maipai/ui/src/ui/switch";
import { RadioGroup, RadioGroupItem } from "@maipai/ui/src/dashboard/components/ui/radio-group";
import { Item, ItemActions, ItemContent, ItemDescription, ItemGroup, ItemTitle } from "@maipai/ui/src/dashboard/components/ui/item";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@maipai/ui/src/dashboard/components/ui/card";
import { STARTER_ALWAYS, STARTER_NEVER, parseList, specKey, type StarterApp } from "@/apps/settings/performanceModel";
import { useRunningApps } from "@/apps/settings/usePerformanceSettings";

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
    try { await write(changes); setEffect(sentence); } catch { setError("Home could not save that change. Check your connection and try again."); }
  };
  const add = (id: string) => {
    const name = nameOf(id);
    return save({ [LIST_KEYS[kind]]: JSON.stringify([...list, id]) }, kind === "always" ? `${name} will be closed when a big job needs room${value("resources.close_apps.reopen") === false ? "." : ", and reopened afterwards."}` : `${name} will always stay open.`);
  };
  const addable = candidates.filter((app) => !list.includes(app.bundleId));
  const starterToAdd = starter.filter((app) => !list.includes(app.bundleId));
  const title = kind === "always" ? "Always close" : "Never close";
  const blurb = kind === "always" ? "Home may quit these when a big job needs room and nothing else is left to try." : "Home never quits these, even if they are also on the Always close list.";
  return (
    <section aria-label={title} data-testid={`close-apps-${kind}`}>
      <ItemGroup variant="card">
        <Item size="setting">
          <ItemContent><ItemTitle>{title}</ItemTitle><ItemDescription clamp={false}>{blurb}</ItemDescription></ItemContent>
          <ItemActions>
            {starterToAdd.length > 0 ? <Button variant="outline" onClick={() => save({ [LIST_KEYS[kind]]: JSON.stringify([...list, ...starterToAdd.map((app) => app.bundleId)]) }, kind === "always" ? "The starter apps will be closed when a big job needs room. Review the list, then turn Automatic on." : "The starter apps will always stay open.")}>Use the starter list</Button> : null}
            {addable.length > 0 ? (
              <Select value="" onValueChange={(id) => { if (id) void add(id); }}>
                <SelectTrigger aria-label={`Add an app to ${title}`}><SelectValue placeholder="Add an app" /></SelectTrigger>
                <SelectContent>{addable.map((app) => <SelectItem key={app.bundleId} value={app.bundleId}>{app.name}</SelectItem>)}</SelectContent>
              </Select>
            ) : null}
          </ItemActions>
        </Item>
        {list.length === 0 ? <Item size="setting"><ItemContent><ItemDescription clamp={false}>{kind === "always" ? "No apps yet, so Home closes nothing." : "No apps added. The built-in protected apps are never closed either way."}</ItemDescription></ItemContent></Item> : null}
        {list.map((id) => (
          <Item key={id} size="setting">
            <ItemContent>
              <ItemTitle>{nameOf(id)}</ItemTitle>
              {kind === "always" && other.includes(id) ? <ItemDescription clamp={false}>This app is also on the Never close list, so it stays open.</ItemDescription> : null}
            </ItemContent>
            <ItemActions>
              {kind === "always" ? <Switch aria-label={`Reopen ${nameOf(id)} when done`} checked={!noReopen.includes(id)} onCheckedChange={(on) => void save({ [NO_REOPEN]: JSON.stringify(on ? noReopen.filter((x) => x !== id) : [...noReopen, id]) }, on ? `${nameOf(id)} will reopen when the job is done.` : `${nameOf(id)} will stay closed when the job is done.`)} /> : null}
              <Button variant="outline" aria-label={`Remove ${nameOf(id)}`} onClick={() => void save({ [LIST_KEYS[kind]]: JSON.stringify(list.filter((x) => x !== id)) }, kind === "always" ? `${nameOf(id)} will no longer be closed.` : `${nameOf(id)} can be closed again if it is on the Always close list.`)}>Remove</Button>
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
  const options = specKey(MODE).copy?.options ?? {};
  const mode = value(MODE) === "automatic" ? "automatic" : "off";
  const names = new Map<string, string>([...STARTER_ALWAYS, ...STARTER_NEVER, ...(running.data?.apps ?? []).map((app) => ({ bundleId: app.bundleId, name: app.name }))].map((app) => [app.bundleId, app.name]));
  // The picker offers what is running now when the helper is installed, else the starter apps by name.
  const candidates: StarterApp[] = running.data?.installed ? running.data.apps.map((app) => ({ bundleId: app.bundleId, name: app.name })) : [...STARTER_ALWAYS, ...STARTER_NEVER];
  const [error, setError] = useState<string | null>(null);
  return (
    <section aria-label="Close apps for big jobs" data-testid="close-apps-card"><Card>
      <CardHeader>
        <CardTitle>Close apps for big jobs</CardTitle>
        <CardDescription>{specKey(MODE).help}</CardDescription>
      </CardHeader>
      <CardContent>
        <RadioGroup value={mode} onValueChange={(next) => { setError(null); write({ [MODE]: next }).catch(() => setError("Home could not save that change. Check your connection and try again.")); }}>
          <ItemGroup variant="card">
            {(["off", "automatic"] as const).map((id) => (
              <Item key={id} size="setting">
                <ItemContent><ItemTitle>{id === "off" ? "Off" : "Automatic"}</ItemTitle><ItemDescription clamp={false}>{options[id]}</ItemDescription></ItemContent>
                <ItemActions><RadioGroupItem value={id} aria-label={id === "off" ? "Off" : "Automatic"} /></ItemActions>
              </Item>
            ))}
          </ItemGroup>
        </RadioGroup>
        {error ? <p role="alert">{error}</p> : null}
        <AppList kind="always" value={value} write={write} names={names} candidates={candidates} starter={STARTER_ALWAYS} />
        <AppList kind="never" value={value} write={write} names={names} candidates={candidates} starter={STARTER_NEVER} />
      </CardContent>
    </Card></section>
  );
}
