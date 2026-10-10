import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Alert, AlertAction, AlertDescription, AlertTitle } from "@maipai/ui/src/dashboard/components/ui/alert";
import { AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@maipai/ui/src/dashboard/components/ui/alert-dialog";
import { Badge } from "@maipai/ui/src/dashboard/components/ui/badge";
import { Button } from "@maipai/ui/src/ui/button";
import { Checkbox } from "@maipai/ui/src/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@maipai/ui/src/dashboard/components/ui/dialog";
import { Field, FieldLabel } from "@maipai/ui/src/dashboard/components/ui/field";
import { Calendar } from "@maipai/ui/src/dashboard/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@maipai/ui/src/dashboard/components/ui/popover";
import { Input } from "@maipai/ui/src/ui/input";
import { Label } from "@maipai/ui/src/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@maipai/ui/src/dashboard/components/ui/select";
import { Textarea } from "@maipai/ui/src/ui/textarea";
import { getIcon } from "@maipai/ui/src/icons";
import { toast } from "sonner";
import { api, isOwnerOrAdminRole, type Roster, type StatusBoard as StatusBoardData, type StatusMaintenance } from "@/lib/api";
import { formatMaintenanceRange, relativePostedTime, STATUS_PARTS } from "@/shell/pages/status/statusBoardFormat";

export const STATUS_BOARD_QUERY_KEY = ["status-board"];

const STATUS_LABELS: Record<StatusMaintenance["status"], string> = {
  scheduled: "Scheduled", in_progress: "In maintenance", completed: "Done", cancelled: "Cancelled",
};
const WEEKDAYS = [{ code: "MO", label: "Mon" }, { code: "TU", label: "Tue" }, { code: "WE", label: "Wed" }, { code: "TH", label: "Thu" }, { code: "FR", label: "Fri" }, { code: "SA", label: "Sat" }, { code: "SU", label: "Sun" }] as const;
const DAY_CODES: Record<number, string> = { 0: "SU", 1: "MO", 2: "TU", 3: "WE", 4: "TH", 5: "FR", 6: "SA" };

function dateOnly(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function StatusBoardNotes({ person, note }: { person: Roster; note: StatusBoardData["note"] }) {
  const admin = isOwnerOrAdminRole(person.role);
  const client = useQueryClient();
  const clear = useMutation({ mutationFn: () => api.clearStatusNote(), onSuccess: async () => { await client.invalidateQueries({ queryKey: STATUS_BOARD_QUERY_KEY }); }, onError: (error) => toast.error(error instanceof Error ? error.message : "Could not clear the note.") });
  const InfoIcon = getIcon("info");
  return <div className="flex flex-col gap-4">
    {note ? <Alert>
      <InfoIcon className="size-5 text-primary" aria-hidden="true" />
      <div className="min-w-0"><AlertTitle>{note.body}</AlertTitle><AlertDescription>Posted by {note.posted_by_name}, {relativePostedTime(note.posted_at)}</AlertDescription></div>
      {admin ? <AlertAction><Button variant="outline" onClick={() => clear.mutate()} disabled={clear.isPending}>Clear</Button></AlertAction> : null}
    </Alert> : null}
    {admin ? <div className="flex justify-end"><PostNoteControl /></div> : null}
  </div>;
}

/** The rows inside the page's "Scheduled maintenance" card. */
export function StatusMaintenanceBody({ admin, windows }: { admin: boolean; windows: StatusMaintenance[] }) {
  return <div className="flex flex-col divide-y divide-border">
    {windows.length === 0 ? <p className="py-2 text-sm text-muted-foreground">No maintenance is scheduled.</p> : windows.map((window) => <MaintenanceRow key={window.id} window={window} admin={admin} />)}
  </div>;
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
      {window.rrule ? <p className="text-sm text-muted-foreground">Repeats{window.until ? ` until ${window.until}` : " with no end date"}</p> : null}
    </div>
    {admin && (window.status === "scheduled" || window.status === "in_progress") ? <Button variant="outline" onClick={() => setConfirm(true)}>Cancel</Button> : null}
    <AlertDialog open={confirm} onOpenChange={setConfirm}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Cancel this maintenance?</AlertDialogTitle><AlertDialogDescription>{window.title} will be marked as cancelled.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>Keep it</AlertDialogCancel><Button variant="destructive" onClick={() => cancel.mutate()} disabled={cancel.isPending}>{cancel.isPending ? "Cancelling…" : "Cancel maintenance"}</Button></AlertDialogFooter></AlertDialogContent></AlertDialog>
  </div>;
}

export function MaintenanceDialog() {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [starts, setStarts] = useState("");
  const [ends, setEnds] = useState("");
  const [repeat, setRepeat] = useState<"none" | "daily" | "weekly" | "monthly">("none");
  const [weekdays, setWeekdays] = useState<string[]>([]);
  const [repeatEnd, setRepeatEnd] = useState<"never" | "until">("never");
  const [until, setUntil] = useState("");
  const client = useQueryClient();
  const mutation = useMutation({ mutationFn: api.createMaintenance, onSuccess: async () => { await client.invalidateQueries({ queryKey: STATUS_BOARD_QUERY_KEY }); setOpen(false); reset(); }, onError: (failure) => setError(failure instanceof Error ? failure.message : "Could not schedule maintenance.") });
  function reset() { setTitle(""); setDescription(""); setSelected([]); setStarts(""); setEnds(""); setRepeat("none"); setWeekdays([]); setRepeatEnd("never"); setUntil(""); setError(""); }
  function submit(event: React.FormEvent) {
    event.preventDefault(); setError("");
    const startDate = new Date(starts); const endDate = new Date(ends);
    if (!title.trim()) return setError("Add a title.");
    if (!starts || !ends || Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) return setError("Choose a start and end time.");
    if (endDate <= startDate) return setError("The end time must be after the start time.");
    if (selected.length === 0) return setError("Choose at least one part.");
    if (repeat === "weekly" && weekdays.length === 0) return setError("Choose at least one day for the weekly schedule.");
    if (repeatEnd === "until" && (!until || until < dateOnly(startDate))) return setError("Choose an end date on or after the first maintenance date.");
    const rrule = repeat === "none" ? undefined : repeat === "weekly"
      ? `FREQ=WEEKLY;BYDAY=${WEEKDAYS.filter((day) => weekdays.includes(day.code)).map((day) => day.code).join(",")}`
      : `FREQ=${repeat.toUpperCase()}`;
    mutation.mutate({ title: title.trim(), description: description.trim() || undefined, components: selected, starts_at: startDate.toISOString(), ends_at: endDate.toISOString(), ...(rrule ? { rrule, ...(repeatEnd === "until" ? { until } : {}) } : {}) });
  }
  return <><Button onClick={() => setOpen(true)}>Schedule maintenance</Button><Dialog open={open} onOpenChange={(value) => { setOpen(value); if (!value) reset(); }}><DialogContent className="max-h-screen overflow-y-auto sm:max-w-lg"><DialogHeader><DialogTitle>Schedule maintenance</DialogTitle><DialogDescription>Everyone in the home can see this plan.</DialogDescription></DialogHeader><form onSubmit={submit} className="flex flex-col gap-4">
    <Field><FieldLabel htmlFor="maintenance-title">Title</FieldLabel><Input id="maintenance-title" value={title} onChange={(event) => setTitle(event.target.value)} maxLength={120} /></Field>
    <Field><FieldLabel htmlFor="maintenance-description">Description</FieldLabel><Textarea id="maintenance-description" value={description} onChange={(event) => setDescription(event.target.value)} maxLength={1000} rows={2} /></Field>
    <fieldset className="flex flex-col gap-1"><legend className="mb-1 text-sm font-medium">Parts affected</legend>{STATUS_PARTS.map((part) => <label key={part.id} className="flex min-h-12 items-center gap-3"><Checkbox checked={selected.includes(part.id)} onCheckedChange={(checked) => setSelected((current) => checked ? [...current, part.id] : current.filter((id) => id !== part.id))} />{part.name}</label>)}</fieldset>
    <div className="grid gap-4 sm:grid-cols-2"><Field><FieldLabel htmlFor="maintenance-start">Starts</FieldLabel><Input id="maintenance-start" type="datetime-local" value={starts} onChange={(event) => setStarts(event.target.value)} /></Field><Field><FieldLabel htmlFor="maintenance-end">Ends</FieldLabel><Input id="maintenance-end" type="datetime-local" value={ends} onChange={(event) => setEnds(event.target.value)} /></Field></div>
    <Field><Label htmlFor="maintenance-repeat">Repeat</Label><Select value={repeat} onValueChange={(value) => { const next = (value ?? "none") as typeof repeat; setRepeat(next); if (next === "weekly" && starts) setWeekdays([DAY_CODES[new Date(starts).getDay()] ?? "MO"]); }}><SelectTrigger id="maintenance-repeat" className="min-h-12 w-full"><SelectValue>{repeat === "none" ? "Does not repeat" : repeat === "daily" ? "Daily" : repeat === "weekly" ? "Weekly" : "Monthly"}</SelectValue></SelectTrigger><SelectContent><SelectItem value="none">Does not repeat</SelectItem><SelectItem value="daily">Daily</SelectItem><SelectItem value="weekly">Weekly</SelectItem><SelectItem value="monthly">Monthly</SelectItem></SelectContent></Select></Field>
    {repeat === "weekly" ? <fieldset className="flex flex-col gap-1"><legend className="text-sm font-medium">Repeat on</legend><div className="flex flex-wrap gap-x-4">{WEEKDAYS.map((day) => <label key={day.code} className="flex min-h-10 items-center gap-2"><Checkbox checked={weekdays.includes(day.code)} onCheckedChange={(checked) => setWeekdays((current) => checked ? [...current, day.code] : current.filter((value) => value !== day.code))} />{day.label}</label>)}</div></fieldset> : null}
    {repeat !== "none" ? <><Field><Label htmlFor="maintenance-repeat-end">Repeat ends</Label><Select value={repeatEnd} onValueChange={(value) => setRepeatEnd((value ?? "never") as typeof repeatEnd)}><SelectTrigger id="maintenance-repeat-end" className="min-h-12 w-full"><SelectValue>{repeatEnd === "never" ? "Never" : "Until a date"}</SelectValue></SelectTrigger><SelectContent><SelectItem value="never">Never</SelectItem><SelectItem value="until">Until a date</SelectItem></SelectContent></Select></Field>{repeatEnd === "until" ? <Field><FieldLabel htmlFor="maintenance-repeat-until">Repeat until</FieldLabel><Popover><PopoverTrigger render={<Button id="maintenance-repeat-until" type="button" variant="outline">{until || "Choose a date"}</Button>} /><PopoverContent align="start" className="w-auto p-0"><Calendar mode="single" selected={until ? new Date(`${until}T12:00:00`) : undefined} onSelect={(date) => setUntil(date ? dateOnly(date) : "")} /></PopoverContent></Popover></Field> : null}</> : null}
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
