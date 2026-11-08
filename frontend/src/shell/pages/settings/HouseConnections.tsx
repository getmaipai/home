// HOUSE-02: Settings, House. The Home Assistant connections (one row per instance: name, address, Test, on/off, Remove, Add)
// and, under each, the exposure list: which areas and devices Home may see. Owners and admins only.
// Tokens are write-only: a row shows whether one is saved, never the token. Outages and results reuse the same status lines
// as the rest of Settings; there is no new status surface.
import { i18n } from "@lingui/core";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { api, type HouseExposureEditor, type HouseInstance } from "@/lib/api";
import { useHubMutation } from "@/lib/useHubMutation";
import { errorLine } from "@/lib/hubReachability";
import { Alert, AlertDescription } from "@maipai/ui/src/ui/alert";
import { Button } from "@maipai/ui/src/ui/button";
import { Input } from "@maipai/ui/src/ui/input";
import { Checkbox } from "@maipai/ui/src/ui/checkbox";
import { Field, FieldLabel } from "@maipai/ui/src/dashboard/components/ui/field";
import { Item, ItemActions, ItemContent, ItemDescription, ItemGroup, ItemTitle } from "@maipai/ui/src/dashboard/components/ui/item";
import { Switch } from "@maipai/ui/src/dashboard/components/ui/switch";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@maipai/ui/src/dashboard/components/ui/collapsible";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@maipai/ui/src/dashboard/components/ui/alert-dialog";

const KEY = ["house-instances"];
const t = (message: string, values?: Record<string, string | number>) => i18n._({ id: message, message, ...(values ? { values } : {}) });

function InstanceForm({ initial, onDone, onCancel }: { initial?: HouseInstance; onDone: () => void; onCancel: () => void }) {
  const queryClient = useQueryClient();
  const [label, setLabel] = useState(initial?.label ?? "");
  const [address, setAddress] = useState(initial?.address ?? "");
  const [token, setToken] = useState("");
  const [error, setError] = useState<string | null>(null);
  const save = useHubMutation({
    verb: "save this connection",
    mutationFn: async () => {
      if (initial) return api.houseUpdateInstance(initial.instance, { label, address, ...(token.trim() ? { token } : {}) });
      return api.houseAddInstance({ label, address, token });
    },
    onSuccess: async () => { setError(null); await queryClient.invalidateQueries({ queryKey: KEY }); onDone(); },
  });
  async function submit() {
    setError(null);
    try { await save.mutateAsync(); }
    catch (reason) { setError(errorLine(reason, t("Home could not save this connection."))); }
  }
  return (
    <form className="flex flex-col gap-4" aria-label={initial ? t("Edit {name}", { name: initial.label }) : t("Add a Home Assistant connection")} onSubmit={(event) => { event.preventDefault(); void submit(); }}>
      <Field>
        <FieldLabel htmlFor={`ha-label-${initial?.instance ?? "new"}`}>{t("Name")}</FieldLabel>
        <Input id={`ha-label-${initial?.instance ?? "new"}`} autoComplete="off" placeholder={t("Cabin")} value={label} onChange={(event) => setLabel(event.target.value)} />
      </Field>
      <Field>
        <FieldLabel htmlFor={`ha-address-${initial?.instance ?? "new"}`}>{t("Address")}</FieldLabel>
        <Input id={`ha-address-${initial?.instance ?? "new"}`} type="url" inputMode="url" autoComplete="off" placeholder={t("http://192.168.1.20:8123")} value={address} onChange={(event) => setAddress(event.target.value)} />
      </Field>
      <Field>
        <FieldLabel htmlFor={`ha-token-${initial?.instance ?? "new"}`}>{initial?.hasToken ? t("New token (leave empty to keep the saved one)") : t("Access token")}</FieldLabel>
        <Input id={`ha-token-${initial?.instance ?? "new"}`} type="password" autoComplete="off" value={token} onChange={(event) => setToken(event.target.value)} />
      </Field>
      {error ? <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert> : null}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" size="lg" disabled={save.busy || label.trim() === "" || address.trim() === "" || (!initial && token.trim() === "")}>{initial ? t("Save") : t("Add connection")}</Button>
        <Button type="button" variant="secondary" size="lg" onClick={onCancel}>{t("Cancel")}</Button>
      </div>
    </form>
  );
}

function Exposure({ instance }: { instance: HouseInstance }) {
  const queryClient = useQueryClient();
  const editor = useQuery({ queryKey: ["house-exposure", instance.instance], queryFn: () => api.houseExposure(instance.instance), enabled: false, retry: false });
  const [open, setOpen] = useState(false);
  const [areas, setAreas] = useState<Set<string>>(new Set());
  const [entities, setEntities] = useState<Set<string>>(new Set());
  const [saved, setSaved] = useState(false);
  const data: HouseExposureEditor | undefined = editor.data;
  useEffect(() => {
    if (!data) return;
    setAreas(new Set(data.exposedAreas)); setEntities(new Set(data.exposedEntities));
  }, [data]);
  const save = useHubMutation({
    verb: "save what Home can see",
    mutationFn: () => api.houseSaveExposure(instance.instance, { areas: [...areas], entities: [...entities] }),
    onSuccess: async () => { setSaved(true); await queryClient.invalidateQueries({ queryKey: ["house-registry"] }); await queryClient.invalidateQueries({ queryKey: ["house-admin-registry"] }); },
  });
  const toggle = (set: Set<string>, setter: (next: Set<string>) => void, id: string, on: boolean) => { const next = new Set(set); if (on) next.add(id); else next.delete(id); setter(next); setSaved(false); };
  const unconfigured = data && !data.configured && areas.size === 0 && entities.size === 0;
  const grouped = data ? [
    ...data.areas.map((area) => ({ id: area.id, name: area.name, entities: data.entities.filter((entity) => entity.area === area.id) })),
    { id: "", name: t("Not in a room"), entities: data.entities.filter((entity) => entity.area === null || !data.areas.some((area) => area.id === entity.area)) },
  ].filter((group) => group.entities.length > 0 || group.id !== "") : [];
  return (
    <div>
    <Collapsible open={open} onOpenChange={(next) => { setOpen(next); if (next && !data) void editor.refetch(); }}>
      <CollapsibleTrigger render={<Button type="button" variant="outline" size="lg" aria-label={t("What Home can see in {name}", { name: instance.label })} />}>{t("What Home can see")}</CollapsibleTrigger>
      <CollapsibleContent>
        <div className="flex flex-col gap-4 pt-4">
          {editor.isFetching ? <p role="status">{t("Loading…")}</p> : null}
          {editor.isError ? <Alert variant="destructive"><AlertDescription>{errorLine(editor.error, t("Home could not read this Home Assistant."))} {t("Press Test on this connection, fix what it says, then open this list again.")}</AlertDescription></Alert> : null}
          {data ? <>
            <p className="text-base text-muted-foreground">{unconfigured ? t("Nothing is chosen yet, so Home can see everything the people's access allows. Tick rooms or devices to limit it to only those.") : t("Home sees only what is ticked here. A room ticked here includes every device in it.")}</p>
            {grouped.map((group) => (
              <fieldset key={group.id || "none"} className="flex flex-col gap-2">
                <legend className="text-base font-semibold text-foreground">{group.name}</legend>
                {group.id !== "" ? <label className="flex items-center gap-3"><Checkbox aria-label={t("Whole room {room}", { room: group.name })} checked={areas.has(group.id)} onCheckedChange={(on) => toggle(areas, setAreas, group.id, on === true)} /><span>{t("The whole room")}</span></label> : null}
                {group.entities.map((entity) => (
                  <label key={entity.id} className="flex items-center gap-3">
                    <Checkbox aria-label={entity.name} checked={entities.has(entity.id) || (group.id !== "" && areas.has(group.id))} disabled={group.id !== "" && areas.has(group.id)} onCheckedChange={(on) => toggle(entities, setEntities, entity.id, on === true)} />
                    <span>{entity.name}{entity.sensitive ? <> · <span className="text-muted-foreground">{t("needs its own permission for each person")}</span></> : null}</span>
                  </label>
                ))}
              </fieldset>
            ))}
            {saved ? <p role="status">{t("Saved")}</p> : null}
            <div><Button type="button" size="lg" disabled={save.busy} onClick={() => { void save.run(); }}>{save.busy ? t("Saving…") : t("Save what Home can see")}</Button></div>
          </> : null}
        </div>
      </CollapsibleContent>
    </Collapsible>
    </div>
  );
}

function Row({ instance, several }: { instance: HouseInstance; several: boolean }) {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  const test = useHubMutation({
    verb: "test this connection",
    mutationFn: () => api.houseTestInstance(instance.instance),
    onSuccess: (r) => setResult(r.ok ? { ok: true, text: t("Connected · {rooms, plural, one {# room} other {# rooms}} · {devices, plural, one {# device} other {# devices}}", { rooms: r.rooms, devices: r.devices }) } : { ok: false, text: r.nextStep }),
  });
  const toggle = useHubMutation({ verb: "change this connection", mutationFn: (enabled: boolean) => api.houseUpdateInstance(instance.instance, { enabled }), onSuccess: () => queryClient.invalidateQueries({ queryKey: KEY }) });
  const remove = useHubMutation({ verb: "remove this connection", mutationFn: () => api.houseRemoveInstance(instance.instance), onSuccess: () => queryClient.invalidateQueries({ queryKey: KEY }) });
  if (editing) return <><Item size="setting"><ItemContent><InstanceForm initial={instance} onDone={() => { setResult(null); setEditing(false); }} onCancel={() => setEditing(false)} /></ItemContent></Item></>;
  const details = [instance.address || t("No address yet"), instance.hasToken ? t("Token saved") : t("No token yet")].join(" · ");
  return (
    <>
    <Item size="setting">
      <ItemContent>
        <ItemTitle>{instance.label}</ItemTitle>
        <ItemDescription>{details}</ItemDescription>
        {result ? <Alert variant={result.ok ? "default" : "destructive"} role="status"><AlertDescription>{result.text}</AlertDescription></Alert> : null}
        <div className="flex flex-wrap gap-2 pt-2">
          <Button type="button" variant="secondary" size="lg" disabled={test.busy} aria-label={t("Test {name}", { name: instance.label })} onClick={() => { setResult(null); void test.run(); }}>{test.busy ? t("Testing…") : t("Test")}</Button>
          <Button type="button" variant="secondary" size="lg" aria-label={t("Edit {name}", { name: instance.label })} onClick={() => setEditing(true)}>{t("Edit")}</Button>
          <Button type="button" variant="secondary" size="lg" aria-label={t("Remove {name}", { name: instance.label })} onClick={() => setConfirmRemove(true)}>{t("Remove")}</Button>
        </div>
        <div className="pt-2"><Exposure instance={instance} /></div>
      </ItemContent>
      <ItemActions>
        <Switch size="md" aria-label={several ? t("Use {name}", { name: instance.label }) : t("Use this connection")} checked={instance.enabled} disabled={toggle.busy} onCheckedChange={(on) => { void toggle.run(on); }} />
      </ItemActions>
    </Item>
      <AlertDialog open={confirmRemove} onOpenChange={setConfirmRemove}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("Remove {name}?", { name: instance.label })}</AlertDialogTitle>
            <AlertDialogDescription>{t("Home stops using this Home Assistant and forgets its token and its list of what Home can see. The devices in Home Assistant are not touched. You can add it again later.")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("Keep it")}</AlertDialogCancel>
            <AlertDialogAction onClick={() => { void remove.run(); }}>{t("Remove")}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

export function HouseConnections() {
  const query = useQuery({ queryKey: KEY, queryFn: api.houseInstances });
  const [adding, setAdding] = useState(false);
  const instances = query.data?.instances ?? [];
  return (
    <section aria-label={t("Connections")} className="flex flex-col gap-4">
      <h2 className="text-lg font-semibold text-foreground">{t("Connections")}</h2>
      <p className="text-base text-muted-foreground">{t("Each row is one Home Assistant on your home network. Add a second one for a cabin or a garage.")}</p>
      {query.isError ? <Alert variant="destructive"><AlertDescription>{t("Could not load your connections. Check your connection and try again.")} <Button type="button" variant="outline" onClick={() => void query.refetch()}>{t("Retry")}</Button></AlertDescription></Alert> : null}
      {query.isLoading ? <p>{t("Loading…")}</p> : null}
      {instances.length > 0 ? <ItemGroup variant="card" aria-label={t("Home Assistant connections")}>{instances.map((instance) => <Row key={instance.instance} instance={instance} several={instances.length > 1} />)}</ItemGroup> : null}
      {query.data && instances.length === 0 && !adding ? <p className="text-base text-muted-foreground">{t("No Home Assistant is connected yet.")}</p> : null}
      {adding ? <InstanceForm onDone={() => setAdding(false)} onCancel={() => setAdding(false)} /> : <div><Button type="button" size="lg" disabled={instances.length >= 8} onClick={() => setAdding(true)}>{t("Add a connection")}</Button></div>}
    </section>
  );
}
