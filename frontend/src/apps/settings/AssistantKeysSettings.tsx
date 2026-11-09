// OPS-KEY-01: Settings > Home > Engines and AI > "Assistant access". An owner or admin makes a short-lived key that lets an
// assistant session (Claude Code, a script) change a few named settings, or (DIAG-KEY-01) read timings and engine state to find out
// why chat is slow, without a browser. A key does one of the two and nothing else.
import { i18n } from "@lingui/core";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Badge } from "@maipai/ui/src/ui/badge";
import { AsyncState } from "@maipai/ui/src/primitives/AsyncState";
import { EmptyState } from "@maipai/ui/src/primitives/EmptyState";
import { Button } from "@maipai/ui/src/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@maipai/ui/src/ui/dialog";
import { Input } from "@maipai/ui/src/ui/input";
import { Label } from "@maipai/ui/src/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@maipai/ui/src/ui/select";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@maipai/ui/src/ui/alert-dialog";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@maipai/ui/src/dashboard/components/ui/card";
import { Item, ItemActions, ItemContent, ItemDescription, ItemGroup, ItemTitle } from "@maipai/ui/src/dashboard/components/ui/item";
import { api, type PersonalApiKey } from "@/lib/api";
import { errorLine } from "@/lib/hubReachability";
import { formatDate } from "@/lib/format";
import { StatusCard } from "@maipai/ui/src/elements/status-card";

const KEYS = ["settings-api-keys"] as const;
type Kind = "settings" | "diagnose" | "engine";
const kindOf = (key: PersonalApiKey): Kind => key.scopes.includes("engine") ? "engine" : key.scopes.includes("diagnose") ? "diagnose" : "settings";
const dateText = (date: string | null) => date ? formatDate(date) : i18n._({ id: "Never", message: "Never" });
const messageOf = (error: unknown, fallback: string) => errorLine(error, fallback);

export function AssistantKeysSettings() {
  const client = useQueryClient();
  const query = useQuery({ queryKey: KEYS, queryFn: () => api.apiKeys() });
  const keys = (query.data?.keys ?? []).filter((key) => (key.scopes.includes("settings") || key.scopes.includes("diagnose") || key.scopes.includes("engine")) && key.status !== "revoked" && key.status !== "expired");
  const [createOpen, setCreateOpen] = useState(false);
  const [name, setName] = useState("");
  const [kind, setKind] = useState<Kind>("settings");
  const [days, setDays] = useState<7 | 30 | 90>(30);
  const [created, setCreated] = useState<{ key: PersonalApiKey; secret: string } | null>(null);
  const [revoke, setRevoke] = useState<PersonalApiKey | null>(null);
  const [error, setError] = useState<string | null>(null);
  const refresh = () => client.invalidateQueries({ queryKey: KEYS });
  const create = async () => {
    setError(null);
    try { setCreated(await api.createApiKey({ name: name.trim(), scopes: [kind], expires_in_days: kind !== "settings" && days === 90 ? 30 : days })); setName(""); setCreateOpen(false); await refresh(); }
    catch (reason) { setError(messageOf(reason, i18n._({ id: "Could not make this key. Try again.", message: "Could not make this key. Try again." }))); }
  };
  const confirmRevoke = async () => {
    const target = revoke; setRevoke(null); if (!target) return;
    try { await api.revokeApiKey(target.id); await refresh(); } catch (reason) { setError(messageOf(reason, i18n._({ id: "Could not revoke this key. Try again.", message: "Could not revoke this key. Try again." }))); }
  };
  return (
    <>
    <Card>
      <CardHeader>
        <CardTitle>{i18n._({ id: "Assistant access", message: "Assistant access" })}</CardTitle>
        <CardDescription>{i18n._({ id: "A key an assistant, such as Claude Code, can use. A settings key changes a short list of settings for you, like how Home helps the chat remember to search. A diagnostics key only reads timings and engine status, so the assistant can find out why chat is slow; it never sees what anyone said. Neither can change people, passwords, safety or anything else. It stops after the days you choose and you can revoke it here at any time.", message: "A key an assistant, such as Claude Code, can use. A settings key changes a short list of settings for you, like how Home helps the chat remember to search. A diagnostics key only reads timings and engine status, so the assistant can find out why chat is slow; it never sees what anyone said. Neither can change people, passwords, safety or anything else. It stops after the days you choose and you can revoke it here at any time." })}</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex flex-col gap-3">
        <AsyncState data={query.data ? keys : undefined} error={query.isError} isFetching={query.isFetching} onRetry={() => void query.refetch()} errorMessage={i18n._({ id: "Could not load assistant keys.", message: "Could not load assistant keys." })} loadingLabel={i18n._({ id: "Loading keys", message: "Loading keys" })}>
          {(loadedKeys) => loadedKeys.length === 0 ? <EmptyState icon="key" text={i18n._({ id: "No assistant keys", message: "No assistant keys" })} /> : (
          <ItemGroup variant="card" aria-label={i18n._({ id: "Assistant keys", message: "Assistant keys" })}>
            {loadedKeys.map((key) => (
              <Item key={key.id}>
                <ItemContent>
                  <ItemTitle>{key.name} <Badge variant="secondary">{key.status === "active" ? i18n._({ id: "Active", message: "Active" }) : i18n._({ id: "Paused", message: "Paused" })}</Badge></ItemTitle>
                  <ItemDescription clamp={false}>{i18n._({ id: "{value}Ends {dateText}. Last used {dateText2}. Ends in …{hint}", message: "{value}Ends {dateText}. Last used {dateText2}. Ends in …{hint}", values: { value: kindOf(key) === "engine" ? i18n._({ id: "Chat engine key. ", message: "Chat engine key. " }) : kindOf(key) === "diagnose" ? i18n._({ id: "Diagnostics key. ", message: "Diagnostics key. " }) : i18n._({ id: "Settings key. ", message: "Settings key. " }), dateText: dateText(key.expires_at), dateText2: dateText(key.last_used_at), hint: key.hint } })}</ItemDescription>
                </ItemContent>
                <ItemActions><Button type="button" size="sm" variant="outline" onClick={() => setRevoke(key)}>{i18n._({ id: "Revoke", message: "Revoke" })}</Button></ItemActions>
              </Item>
            ))}
          </ItemGroup>
          )}
        </AsyncState>
        {error ? <StatusCard kind="problem" title={i18n._({ id: "That did not work", message: "That did not work" })} line={error} /> : null}
        <div><Button type="button" onClick={() => setCreateOpen(true)}>{i18n._({ id: "Make an assistant key", message: "Make an assistant key" })}</Button></div>
        </div>
      </CardContent>
    </Card>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>{i18n._({ id: "Make an assistant key", message: "Make an assistant key" })}</DialogTitle><DialogDescription>{i18n._({ id: "Name it for the assistant that will use it. You see the key once.", message: "Name it for the assistant that will use it. You see the key once." })}</DialogDescription></DialogHeader>
          <div className="flex flex-col gap-2"><Label htmlFor="assistant-key-name">{i18n._({ id: "Name", message: "Name" })}</Label><Input id="assistant-key-name" value={name} onChange={(event) => setName(event.target.value)} maxLength={60} /></div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="assistant-key-kind">{i18n._({ id: "What it can do", message: "What it can do" })}</Label>
            <Select value={kind} onValueChange={(value) => { setKind(value as Kind); if (value !== "settings" && days === 90) setDays(30); }}>
              <SelectTrigger id="assistant-key-kind"><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="settings">{i18n._({ id: "Change a few settings", message: "Change a few settings" })}</SelectItem><SelectItem value="diagnose">{i18n._({ id: "Read diagnostics only", message: "Read diagnostics only" })}</SelectItem><SelectItem value="engine">{i18n._({ id: "Switch the chat engine only", message: "Switch the chat engine only" })}</SelectItem></SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="assistant-key-days">{i18n._({ id: "Lasts", message: "Lasts" })}</Label>
            <Select value={String(days)} onValueChange={(value) => setDays(Number(value) as 7 | 30 | 90)}>
              <SelectTrigger id="assistant-key-days"><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="7">{i18n._({ id: "7 days", message: "7 days" })}</SelectItem><SelectItem value="30">{i18n._({ id: "30 days", message: "30 days" })}</SelectItem>{kind === "settings" ? <SelectItem value="90">{i18n._({ id: "90 days", message: "90 days" })}</SelectItem> : null}</SelectContent>
            </Select>
          </div>
          <DialogFooter><Button type="button" variant="outline" onClick={() => setCreateOpen(false)}>{i18n._({ id: "Cancel", message: "Cancel" })}</Button><Button type="button" disabled={name.trim().length === 0} onClick={() => void create()}>{i18n._({ id: "Make key", message: "Make key" })}</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={created !== null} onOpenChange={(open) => { if (!open) setCreated(null); }}>
        <DialogContent>
          <DialogHeader><DialogTitle>{i18n._({ id: "Copy your key now", message: "Copy your key now" })}</DialogTitle><DialogDescription>{i18n._({ id: "Home shows it only once. Give it to the assistant. Anyone with it can do what its kind allows (change the few settings, or read diagnostics) until it ends or you revoke it.", message: "Home shows it only once. Give it to the assistant. Anyone with it can do what its kind allows (change the few settings, or read diagnostics) until it ends or you revoke it." })}</DialogDescription></DialogHeader>
          <Input readOnly aria-label={i18n._({ id: "Assistant key", message: "Assistant key" })} value={created?.secret ?? ""} onFocus={(event) => event.currentTarget.select()} />
          <DialogFooter><Button type="button" onClick={() => setCreated(null)}>{i18n._({ id: "I have copied it", message: "I have copied it" })}</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={revoke !== null} onOpenChange={(open) => { if (!open) setRevoke(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader><AlertDialogTitle>{i18n._({ id: "Revoke this key?", message: "Revoke this key?" })}</AlertDialogTitle><AlertDialogDescription>{i18n._({ id: "The assistant using it loses that access at once.", message: "The assistant using it loses that access at once." })}</AlertDialogDescription></AlertDialogHeader>
          <AlertDialogFooter><AlertDialogCancel>{i18n._({ id: "Keep it", message: "Keep it" })}</AlertDialogCancel><AlertDialogAction onClick={() => void confirmRevoke()}>{i18n._({ id: "Revoke", message: "Revoke" })}</AlertDialogAction></AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
