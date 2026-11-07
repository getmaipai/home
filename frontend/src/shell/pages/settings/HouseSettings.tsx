import { i18n } from "@lingui/core";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api } from "@/lib/api";
import type { SettingsViewProps } from "@/shell/pages/settings/settingsViews";
import { SettingsRenderer } from "@/shell/pages/settings/SettingsRenderer";
import { Button } from "@maipai/ui/src/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@maipai/ui/src/ui/select";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@maipai/ui/src/dashboard/components/ui/collapsible";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@maipai/ui/src/dashboard/components/ui/table";
import { useHubMutation } from "@/lib/useHubMutation";

type Level = "none" | "see" | "control";
export function HouseSettings({ person }: SettingsViewProps) {
  const queryClient = useQueryClient();
  const [testResult, setTestResult] = useState<string>("");
  const [saved, setSaved] = useState(false);
  const registry = useQuery({ queryKey: ["house-admin-registry"], queryFn: api.houseAdminRegistry, enabled: person.role === "owner" || person.role === "admin" });
  const grantQuery = useQuery({ queryKey: ["house-grants"], queryFn: () => Promise.all((registry.data?.people ?? []).map(async (p) => [p.id, await api.grants(p.id)] as const)), enabled: !!registry.data });
  const effectiveQuery = useQuery({ queryKey: ["house-effective", registry.data?.people.map((p) => p.id)], queryFn: () => Promise.all((registry.data?.people ?? []).map(async (p) => [p.id, await api.houseAdminEffective(p.id)] as const)), enabled: !!registry.data });
  const saveAction = useHubMutation({ verb: "save access", mutationFn: async (perform: () => Promise<void>) => { await perform(); return true; }, onSuccess: async () => { await Promise.all([queryClient.invalidateQueries({ queryKey: ["house-grants"] }), queryClient.invalidateQueries({ queryKey: ["house-effective"] })]); setSaved(true); } });
  const testAction = useHubMutation({ verb: "test the connection", mutationFn: api.houseTest, onSuccess: (result) => setTestResult(result.ok ? i18n._({ id: "Connected · {rooms, plural, one {# room} other {# rooms}} · {devices, plural, one {# device} other {# devices}}", message: "Connected · {rooms, plural, one {# room} other {# rooms}} · {devices, plural, one {# device} other {# devices}}", values: { rooms: result.rooms, devices: result.devices } }) : result.nextStep) });
  const grants = new Map((grantQuery.data ?? []).flatMap(([id, rows]) => rows.map((row) => [id + "|" + row.action, row] as const)));
  const effective = new Map(effectiveQuery.data ?? []);
  function save(personId: string, action: string, value: Level | boolean) {
    setSaved(false);
    return saveAction.run(async () => {
      if (typeof value === "boolean") {
        const grantAction = action.startsWith("house.confirm:") ? action : `house.confirm:${action}`;
        const found = grants.get(`${personId}|${grantAction}`);
        if (value && !found) await api.createGrant({ person: personId, action: grantAction, effect: "allow" });
        if (!value && found) await api.revokeGrant(found.id);
      } else {
        const next = value === "none" ? [] : [`house.see:${action}`, ...(value === "control" ? [`house.control:${action}`] : [])];
        for (const level of ["see", "control"] as const) {
          const grantAction = `house.${level}:${action}`; const found = grants.get(`${personId}|${grantAction}`); const should = next.includes(grantAction);
          if (should && !found) await api.createGrant({ person: personId, action: grantAction, effect: "allow" });
          if (!should && found) await api.revokeGrant(found.id);
        }
      }
    });
  }
  if (person.role !== "owner" && person.role !== "admin") return null;
  return <div className="flex flex-col gap-6">
    <section aria-label={i18n._({ id: "Connection", message: "Connection" })}><h2>{i18n._({ id: "Connection", message: "Connection" })}</h2><SettingsRenderer scope="household" scopeValue="household" includeKeys={["home.base_url", "home.access_token"]} /></section>
    <div><Button type="button" disabled={testAction.busy} onClick={() => { void testAction.run(); }}>{testAction.busy ? i18n._({ id: "Testing…", message: "Testing…" }) : i18n._({ id: "Test connection", message: "Test connection" })}</Button>{testResult ? <p role="status">{testResult}</p> : null}</div>
    <section aria-label={i18n._({ id: "Who can control what", message: "Who can control what" })}><h2>{i18n._({ id: "Who can control what", message: "Who can control what" })}</h2>{saved ? <p role="status">{i18n._({ id: "Saved", message: "Saved" })}</p> : null}{registry.isError ? <p role="alert">{i18n._({ id: "Could not load the household. Check your connection and try again.", message: "Could not load the household. Check your connection and try again." })} <Button variant="outline" onClick={() => void registry.refetch()}>{i18n._({ id: "Retry", message: "Retry" })}</Button></p> : null}{grantQuery.isError ? <p role="alert">{i18n._({ id: "Could not load access rules. Check your connection and try again.", message: "Could not load access rules. Check your connection and try again." })} <Button variant="outline" onClick={() => void grantQuery.refetch()}>{i18n._({ id: "Retry", message: "Retry" })}</Button></p> : null}{effectiveQuery.isError ? <p role="alert">{i18n._({ id: "Could not load effective access. Check your connection and try again.", message: "Could not load effective access. Check your connection and try again." })} <Button variant="outline" onClick={() => void effectiveQuery.refetch()}>{i18n._({ id: "Retry", message: "Retry" })}</Button></p> : null}{registry.isLoading || grantQuery.isLoading ? <p>{i18n._({ id: "Loading…", message: "Loading…" })}</p> : null}
      {registry.data?.rooms.map((room) => <Collapsible key={room.id} defaultOpen><CollapsibleTrigger render={<Button type="button" variant="outline" />}>{room.name}</CollapsibleTrigger><CollapsibleContent><Table><TableHeader><TableRow><TableHead>{i18n._({ id: "Item", message: "Item" })}</TableHead>{registry.data.people.map((p) => <TableHead key={p.id}>{p.name}</TableHead>)}</TableRow></TableHeader><TableBody>
        {room.id !== "other" ? <TableRow><TableCell>{room.name}</TableCell>{registry.data.people.map((p) => p.role === "owner" ? <TableCell key={p.id}>{i18n._({ id: "Always allowed", message: "Always allowed" })}</TableCell> : <TableCell key={p.id}><Select disabled={saveAction.busy} value={effective.get(p.id)?.rooms?.[room.id]?.control ? "control" : effective.get(p.id)?.rooms?.[room.id]?.see ? "see" : "none"} onValueChange={(v) => void save(p.id, `area:${room.id}`, v as Level)}><SelectTrigger aria-label={i18n._({ id: "{room} access for {person}", message: "{room} access for {person}", values: { room: room.name, person: p.name } })}><SelectValue /></SelectTrigger><SelectContent><SelectItem value="none">{i18n._({ id: "None", message: "None" })}</SelectItem><SelectItem value="see">{i18n._({ id: "See", message: "See" })}</SelectItem><SelectItem value="control">{i18n._({ id: "Control", message: "Control" })}</SelectItem></SelectContent></Select></TableCell>)}</TableRow> : null}
        {room.entities.map((item) => <TableRow key={item.id}><TableCell>{item.name}</TableCell>{registry.data.people.map((p) => p.role === "owner" ? <TableCell key={p.id}>{i18n._({ id: "Always allowed", message: "Always allowed" })}</TableCell> : item.sensitive && (p.role === "child" || (p.role === "teen" && effective.get(p.id)?.entities[item.id]?.see === false && effective.get(p.id)?.entities[item.id]?.control === false)) ? <TableCell key={p.id}>{i18n._({ id: "Locked by rule", message: "Locked by rule" })}</TableCell> : <TableCell key={p.id}><Select disabled={saveAction.busy} value={effective.get(p.id)?.entities[item.id]?.control ? "control" : effective.get(p.id)?.entities[item.id]?.see ? "see" : "none"} onValueChange={(v) => void save(p.id, `entity:${item.id}`, v as Level)}><SelectTrigger aria-label={i18n._({ id: "{item} access for {person}", message: "{item} access for {person}", values: { item: item.name, person: p.name } })}><SelectValue /></SelectTrigger><SelectContent><SelectItem value="none">{i18n._({ id: "None", message: "None" })}</SelectItem><SelectItem value="see">{i18n._({ id: "See", message: "See" })}</SelectItem><SelectItem value="control">{i18n._({ id: "Control", message: "Control" })}</SelectItem></SelectContent></Select>{item.sensitive && p.role === "adult" ? <label><input type="checkbox" disabled={saveAction.busy} checked={effective.get(p.id)?.entities[item.id]?.confirm ?? false} onChange={(e) => void save(p.id, `house.confirm:entity:${item.id}`, e.target.checked)} /> {i18n._({ id: "Confirm", message: "Confirm" })}</label> : null}</TableCell>)}</TableRow>)}
      </TableBody></Table></CollapsibleContent></Collapsible>)}
    </section>
  </div>;
}
