import { i18n } from "@lingui/core";
import { useState } from "react";
import { Badge } from "@maipai/ui/src/ui/badge";
import { Button } from "@maipai/ui/src/ui/button";
import { AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@maipai/ui/src/ui/alert-dialog";
import { api, type HouseScheduleItem, type HouseSchedules } from "@/lib/api";
import { useHubMutation } from "@/lib/useHubMutation";

/** HOUSE-04 / SCHED-02: the signed-in adult's own scheduled device actions. The owner and admins also see a count of other people's, never names. */
export function DeviceSchedulesView({ data, onChanged }: { data: HouseSchedules | undefined; onChanged: () => void }) {
  const [pending, setPending] = useState<HouseScheduleItem | null>(null);
  const cancel = useHubMutation({ verb: "cancel the schedule", mutationFn: (id: string) => api.cancelHouseSchedule(id), onSuccess: () => { setPending(null); onChanged(); } });
  const rows = data?.schedules ?? [];
  const others = data?.others ?? 0;
  return <section className="flex min-h-0 min-w-0 flex-1 flex-col">
    <header className="border-b px-4 py-4">
      <p className="m-0 text-base tracking-wider text-muted-foreground">{i18n._({ id: "SMART LIST", message: "SMART LIST" })}</p>
      <h1 className="m-0 text-3xl font-semibold">{i18n._({ id: "Device schedules", message: "Device schedules" })}</h1>
    </header>
    <ul className="m-0 list-none overflow-y-auto p-4">
      {data && rows.length === 0 ? <li className="py-3 text-muted-foreground">{i18n._({ id: "No device schedules. Ask in chat, for example: turn on the porch light every day at 6 PM.", message: "No device schedules. Ask in chat, for example: turn on the porch light every day at 6 PM." })}</li> : null}
      {rows.map((row) => <li key={row.id} className="flex flex-col gap-3 border-b py-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <p className="m-0 break-words">{row.what}</p>
          <p className="m-0 text-sm text-muted-foreground">{row.when}</p>
          {row.note ? <p className="m-0 text-sm text-muted-foreground">{row.note}</p> : null}
        </div>
        <div className="flex items-center gap-2">
          <Badge variant={row.state === "paused" ? "outline" : "secondary"}>{row.state === "paused" ? i18n._({ id: "Paused", message: "Paused" }) : i18n._({ id: "On", message: "On" })}</Badge>
          <Button variant="outline" disabled={cancel.busy} aria-label={i18n._({ id: "Cancel schedule: {what}", message: "Cancel schedule: {what}", values: { what: row.what } })} onClick={() => setPending(row)}>{i18n._({ id: "Cancel schedule", message: "Cancel schedule" })}</Button>
        </div>
      </li>)}
    </ul>
    {others > 0 ? <p className="m-0 border-t px-4 py-3 text-sm text-muted-foreground">{i18n._({ id: "{count, plural, one {# schedule belongs to another person.} other {# schedules belong to other people.}}", message: "{count, plural, one {# schedule belongs to another person.} other {# schedules belong to other people.}}", values: { count: others } })}</p> : null}
    <AlertDialog open={pending !== null} onOpenChange={(open) => { if (!open) setPending(null); }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{i18n._({ id: "Cancel this schedule?", message: "Cancel this schedule?" })}</AlertDialogTitle>
          <AlertDialogDescription>{pending ? `${pending.what} ${pending.when}` : ""}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{i18n._({ id: "Keep it", message: "Keep it" })}</AlertDialogCancel>
          <Button type="button" variant="destructive" disabled={cancel.busy} onClick={() => pending && void cancel.run(pending.id)}>{i18n._({ id: "Cancel schedule", message: "Cancel schedule" })}</Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </section>;
}
