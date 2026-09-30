import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Alert, AlertAction, AlertDescription, AlertTitle } from "@maipai/ui/src/dashboard/components/ui/alert";
import { AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@maipai/ui/src/dashboard/components/ui/alert-dialog";
import { Badge } from "@maipai/ui/src/dashboard/components/ui/badge";
import { Button } from "@maipai/ui/src/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@maipai/ui/src/dashboard/components/ui/card";
import { Checkbox } from "@maipai/ui/src/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@maipai/ui/src/dashboard/components/ui/dialog";
import { Field, FieldLabel } from "@maipai/ui/src/dashboard/components/ui/field";
import { Input } from "@maipai/ui/src/ui/input";
import { Label } from "@maipai/ui/src/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@maipai/ui/src/dashboard/components/ui/select";
import { Textarea } from "@maipai/ui/src/ui/textarea";
import { getIcon } from "@maipai/ui/src/icons";
import { toast } from "sonner";
import { api, isOwnerOrAdminRole, type Roster, type StatusBoard as StatusBoardData, type StatusMaintenance } from "@/lib/api";
import { formatMaintenanceRange, relativePostedTime, STATUS_PARTS } from "@/next/pages/status/statusBoardFormat";

export const STATUS_BOARD_QUERY_KEY = ["status-board"];

const STATUS_LABELS: Record<StatusMaintenance["status"], string> = {
  scheduled: "Upcoming", in_progress: "In progress", completed: "Done", cancelled: "Cancelled",
};

export function StatusBoardNotes({ person, note }: { person: Roster; note: StatusBoardData["note"] }) {
  const admin = isOwnerOrAdminRole(person.role);
  return <div className="flex flex-col gap-4">
    {note ? <NoteAlert person={person} note={note} /> : null}
    {admin ? <div className="flex justify-end"><PostNoteControl /></div> : null}
  </div>;
}

function NoteAlert({ person, note }: { person: Roster; note: NonNullable<StatusBoardData["note"]> }) {
  const admin = isOwnerOrAdminRole(person.role);
  const client = useQueryClient();
  const clear = useMutation({ mutationFn: () => api.clearStatusNote(), onSuccess: async () => { await client.invalidateQueries({ queryKey: STATUS_BOARD_QUERY_KEY }); }, onError: (error) => toast.error(error instanceof Error ? error.message : "Could not clear the note.") });
  const InfoIcon = getIcon("info");
  return <Alert className="border-primary/40 bg-primary/10">
    <InfoIcon className="size-5 text-primary" aria-hidden="true" />
    <div className="min-w-0"><AlertTitle>{note.body}</AlertTitle><AlertDescription>Posted by {note.posted_by_name}, {relativePostedTime(note.posted_at)}</AlertDescription></div>
    {admin ? <AlertAction><Button variant="outline" onClick={() => clear.mutate()} disabled={clear.isPending}>Clear</Button></AlertAction> : null}
  </Alert>;
}

export function StatusMaintenanceCard({ person, windows }: { person: Roster; windows: StatusMaintenance[] }) {
  const admin = isOwnerOrAdminRole(person.role);
  if (windows.length === 0 && !admin) return null;
  return <Card>
    <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3"><CardTitle>Scheduled maintenance</CardTitle>{admin ? <MaintenanceDialog /> : null}</CardHeader>
    <CardContent className="flex flex-col divide-y divide-border">
      {windows.length === 0 ? <p className="py-2 text-sm text-muted-foreground">No maintenance is scheduled.</p> : windows.map((window) => <MaintenanceRow key={window.id} window={window} admin={admin} />)}
    </CardContent>
  </Card>;
}

function MaintenanceRow({ window, admin }: { window: StatusMaintenance; admin: boolean }) {
  const [confirm, setConfirm] = useState(false);
  const client = useQueryClient();
  const cancel = useMutation({ mutationFn: () => api.cancelMaintenance(window.id), onSuccess: async () => { await client.invalidateQueries({ queryKey: STATUS_BOARD_QUERY_KEY }); setConfirm(false); }, onError: (error) => toast.error(error instanceof Error ? error.message : "Could not cancel maintenance.") });
  const names = window.components.map((id) => STATUS_PARTS.find((part) => part.id === id)?.name).filter((name) => name !== undefined);
  return <div className="flex flex-col gap-2 py-4 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
    <div className="min-w-0 flex-1">
      <div className="flex flex-wrap items-center gap-2"><h3 className="font-medium">{window.title}</h3><Badge variant={window.status === "cancelled" ? "outline" : window.status === "in_progress" ? "default" : "secondary"}>{STATUS_LABELS[window.status]}</Badge></div>
      {window.description ? <p className="truncate text-sm text-muted-foreground">{window.description}</p> : null}
      <p className="text-sm text-muted-foreground">{names.join(", ")}</p>
      <p className="text-sm">{formatMaintenanceRange(window.starts_at, window.ends_at)}</p>
    </div>
    {admin && (window.status === "scheduled" || window.status === "in_progress") ? <Button variant="outline" onClick={() => setConfirm(true)}>Cancel</Button> : null}
    <AlertDialog open={confirm} onOpenChange={setConfirm}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Cancel this maintenance?</AlertDialogTitle><AlertDialogDescription>{window.title} will be marked as cancelled.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>Keep it</AlertDialogCancel><Button variant="destructive" onClick={() => cancel.mutate()} disabled={cancel.isPending}>{cancel.isPending ? "Cancelling…" : "Cancel maintenance"}</Button></AlertDialogFooter></AlertDialogContent></AlertDialog>
  </div>;
}

function MaintenanceDialog() {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [starts, setStarts] = useState("");
  const [ends, setEnds] = useState("");
  const client = useQueryClient();
  const mutation = useMutation({ mutationFn: api.createMaintenance, onSuccess: async () => { await client.invalidateQueries({ queryKey: STATUS_BOARD_QUERY_KEY }); setOpen(false); reset(); }, onError: (failure) => setError(failure instanceof Error ? failure.message : "Could not schedule maintenance.") });
  function reset() { setTitle(""); setDescription(""); setSelected([]); setStarts(""); setEnds(""); setError(""); }
  function submit(event: React.FormEvent) {
    event.preventDefault(); setError("");
    const startDate = new Date(starts); const endDate = new Date(ends);
    if (!title.trim()) return setError("Add a title.");
    if (!starts || !ends || Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) return setError("Choose a start and end time.");
    if (endDate <= startDate) return setError("The end time must be after the start time.");
    if (selected.length === 0) return setError("Choose at least one part.");
    mutation.mutate({ title: title.trim(), description: description.trim() || undefined, components: selected, starts_at: startDate.toISOString(), ends_at: endDate.toISOString() });
  }
  return <><Button onClick={() => setOpen(true)}>Schedule maintenance</Button><Dialog open={open} onOpenChange={(value) => { setOpen(value); if (!value) reset(); }}><DialogContent className="max-h-screen overflow-y-auto sm:max-w-lg"><DialogHeader><DialogTitle>Schedule maintenance</DialogTitle><DialogDescription>Everyone in the home can see this plan.</DialogDescription></DialogHeader><form onSubmit={submit} className="flex flex-col gap-4">
    <Field><FieldLabel htmlFor="maintenance-title">Title</FieldLabel><Input id="maintenance-title" value={title} onChange={(event) => setTitle(event.target.value)} maxLength={120} /></Field>
    <Field><FieldLabel htmlFor="maintenance-description">Description</FieldLabel><Textarea id="maintenance-description" value={description} onChange={(event) => setDescription(event.target.value)} maxLength={1000} rows={2} /></Field>
    <fieldset className="flex flex-col gap-1"><legend className="mb-1 text-sm font-medium">Parts affected</legend>{STATUS_PARTS.map((part) => <label key={part.id} className="flex min-h-12 items-center gap-3"><Checkbox checked={selected.includes(part.id)} onCheckedChange={(checked) => setSelected((current) => checked ? [...current, part.id] : current.filter((id) => id !== part.id))} />{part.name}</label>)}</fieldset>
    <div className="grid gap-4 sm:grid-cols-2"><Field><FieldLabel htmlFor="maintenance-start">Starts</FieldLabel><Input id="maintenance-start" type="datetime-local" value={starts} onChange={(event) => setStarts(event.target.value)} /></Field><Field><FieldLabel htmlFor="maintenance-end">Ends</FieldLabel><Input id="maintenance-end" type="datetime-local" value={ends} onChange={(event) => setEnds(event.target.value)} /></Field></div>
    {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}<DialogFooter><Button type="button" variant="outline" onClick={() => setOpen(false)}>Close</Button><Button type="submit" disabled={mutation.isPending}>{mutation.isPending ? "Saving…" : "Schedule"}</Button></DialogFooter>
  </form></DialogContent></Dialog></>;
}

export function PostNoteControl() {
  const [open, setOpen] = useState(false);
  const [body, setBody] = useState("");
  const [expiry, setExpiry] = useState("none");
  const [error, setError] = useState("");
  const client = useQueryClient();
  const mutation = useMutation({ mutationFn: api.postStatusNote, onSuccess: async () => { await client.invalidateQueries({ queryKey: STATUS_BOARD_QUERY_KEY }); setOpen(false); setBody(""); setExpiry("none"); }, onError: (failure) => setError(failure instanceof Error ? failure.message : "Could not post the note.") });
  function submit(event: React.FormEvent) {
    event.preventDefault(); setError("");
    if (!body.trim()) return setError("Write a note first.");
    const now = new Date();
    const expires = expiry === "hour" ? new Date(now.getTime() + 3_600_000) : expiry === "day" ? new Date(now.getTime() + 86_400_000) : expiry === "week" ? new Date(now.getTime() + 604_800_000) : expiry === "today" ? new Date(new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).getTime()) : undefined;
    mutation.mutate({ body: body.trim(), ...(expires ? { expires_at: expires.toISOString() } : {}) });
  }
  const expiryLabels: Record<string, string> = { none: "No expiry", hour: "1 hour", today: "Today", day: "1 day", week: "1 week" };
  return <><Button variant="outline" onClick={() => setOpen(true)}>Post a note</Button><Dialog open={open} onOpenChange={setOpen}><DialogContent><DialogHeader><DialogTitle>Post a note</DialogTitle><DialogDescription>This replaces the note everyone can see now.</DialogDescription></DialogHeader><form onSubmit={submit} className="flex flex-col gap-4"><Field><FieldLabel htmlFor="status-note">Note</FieldLabel><Textarea id="status-note" value={body} maxLength={500} rows={4} onChange={(event) => setBody(event.target.value)} /><p className="text-right text-sm text-muted-foreground">{body.length}/500</p></Field><div className="flex flex-col gap-2"><Label htmlFor="note-expiry">Expiry</Label><Select value={expiry} onValueChange={(value) => setExpiry(value ?? "none")}><SelectTrigger id="note-expiry" className="min-h-12 w-full"><SelectValue>{expiryLabels[expiry]}</SelectValue></SelectTrigger><SelectContent><SelectItem value="none">No expiry</SelectItem><SelectItem value="hour">1 hour</SelectItem><SelectItem value="today">Today</SelectItem><SelectItem value="day">1 day</SelectItem><SelectItem value="week">1 week</SelectItem></SelectContent></Select></div>{error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}<DialogFooter><Button type="button" variant="outline" onClick={() => setOpen(false)}>Close</Button><Button type="submit" disabled={mutation.isPending}>{mutation.isPending ? "Posting…" : "Post note"}</Button></DialogFooter></form></DialogContent></Dialog></>;
}
