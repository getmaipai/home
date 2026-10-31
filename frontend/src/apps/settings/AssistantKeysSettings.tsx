// OPS-KEY-01: Settings > Home > Engines and AI > "Assistant access". An owner or admin makes a short-lived key that lets an
// assistant session (Claude Code, a script) change a few named settings, or (DIAG-KEY-01) read timings and engine state to find out
// why chat is slow, without a browser. A key does one of the two and nothing else.
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
import { api, ApiError, type PersonalApiKey } from "@/lib/api";

const KEYS = ["settings-api-keys"] as const;
type Kind = "settings" | "diagnose" | "engine";
const kindOf = (key: PersonalApiKey): Kind => key.scopes.includes("engine") ? "engine" : key.scopes.includes("diagnose") ? "diagnose" : "settings";
const dateText = (date: string | null) => date ? new Date(date).toLocaleDateString() : "Never";
const messageOf = (error: unknown, fallback: string) => error instanceof ApiError ? error.message : fallback;

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
    catch (reason) { setError(messageOf(reason, "Could not make this key. Try again.")); }
  };
  const confirmRevoke = async () => {
    const target = revoke; setRevoke(null); if (!target) return;
    try { await api.revokeApiKey(target.id); await refresh(); } catch (reason) { setError(messageOf(reason, "Could not revoke this key. Try again.")); }
  };
  return (
    <>
    <Card>
      <CardHeader>
        <CardTitle>Assistant access</CardTitle>
        <CardDescription>A key an assistant, such as Claude Code, can use. A settings key changes a short list of settings for you, like how Home helps the chat remember to search. A diagnostics key only reads timings and engine status, so the assistant can find out why chat is slow; it never sees what anyone said. Neither can change people, passwords, safety or anything else. It stops after the days you choose and you can revoke it here at any time.</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex flex-col gap-3">
        <AsyncState data={query.data ? keys : undefined} error={query.isError} isFetching={query.isFetching} onRetry={() => void query.refetch()} errorMessage="Could not load assistant keys." loadingLabel="Loading keys">
          {(loadedKeys) => loadedKeys.length === 0 ? <EmptyState icon="key" text="No assistant keys" /> : (
          <ItemGroup variant="card" aria-label="Assistant keys">
            {loadedKeys.map((key) => (
              <Item key={key.id}>
                <ItemContent>
                  <ItemTitle>{key.name} <Badge variant="secondary">{key.status === "active" ? "Active" : "Paused"}</Badge></ItemTitle>
                  <ItemDescription clamp={false}>{kindOf(key) === "engine" ? "Chat engine key. " : kindOf(key) === "diagnose" ? "Diagnostics key. " : "Settings key. "}Ends {dateText(key.expires_at)}. Last used {dateText(key.last_used_at)}. Ends in …{key.hint}</ItemDescription>
                </ItemContent>
                <ItemActions><Button type="button" size="sm" variant="outline" onClick={() => setRevoke(key)}>Revoke</Button></ItemActions>
              </Item>
            ))}
          </ItemGroup>
          )}
        </AsyncState>
        {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
        <div><Button type="button" onClick={() => setCreateOpen(true)}>Make an assistant key</Button></div>
        </div>
      </CardContent>
    </Card>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Make an assistant key</DialogTitle><DialogDescription>Name it for the assistant that will use it. You see the key once.</DialogDescription></DialogHeader>
          <div className="flex flex-col gap-2"><Label htmlFor="assistant-key-name">Name</Label><Input id="assistant-key-name" value={name} onChange={(event) => setName(event.target.value)} maxLength={60} /></div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="assistant-key-kind">What it can do</Label>
            <Select value={kind} onValueChange={(value) => { setKind(value as Kind); if (value !== "settings" && days === 90) setDays(30); }}>
              <SelectTrigger id="assistant-key-kind"><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="settings">Change a few settings</SelectItem><SelectItem value="diagnose">Read diagnostics only</SelectItem><SelectItem value="engine">Switch the chat engine only</SelectItem></SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="assistant-key-days">Lasts</Label>
            <Select value={String(days)} onValueChange={(value) => setDays(Number(value) as 7 | 30 | 90)}>
              <SelectTrigger id="assistant-key-days"><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="7">7 days</SelectItem><SelectItem value="30">30 days</SelectItem>{kind === "settings" ? <SelectItem value="90">90 days</SelectItem> : null}</SelectContent>
            </Select>
          </div>
          <DialogFooter><Button type="button" variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button><Button type="button" disabled={name.trim().length === 0} onClick={() => void create()}>Make key</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={created !== null} onOpenChange={(open) => { if (!open) setCreated(null); }}>
        <DialogContent>
          <DialogHeader><DialogTitle>Copy your key now</DialogTitle><DialogDescription>Home shows it only once. Give it to the assistant. Anyone with it can do what its kind allows (change the few settings, or read diagnostics) until it ends or you revoke it.</DialogDescription></DialogHeader>
          <Input readOnly aria-label="Assistant key" value={created?.secret ?? ""} onFocus={(event) => event.currentTarget.select()} />
          <DialogFooter><Button type="button" onClick={() => setCreated(null)}>I have copied it</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={revoke !== null} onOpenChange={(open) => { if (!open) setRevoke(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader><AlertDialogTitle>Revoke this key?</AlertDialogTitle><AlertDialogDescription>The assistant using it loses that access at once.</AlertDialogDescription></AlertDialogHeader>
          <AlertDialogFooter><AlertDialogCancel>Keep it</AlertDialogCancel><AlertDialogAction onClick={() => void confirmRevoke()}>Revoke</AlertDialogAction></AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
