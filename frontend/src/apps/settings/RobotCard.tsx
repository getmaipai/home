import { Badge } from "@maipai/ui/src/ui/badge";
import { Button } from "@maipai/ui/src/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@maipai/ui/src/dashboard/components/ui/card";
import { Progress } from "@maipai/ui/src/dashboard/components/ui/progress";
import type { DeviceInfo, RobotDeviceState } from "@/lib/api";

const ACTIVITY_LABELS: Record<RobotDeviceState["activity"], string> = {
  starting: "Starting up",
  idle: "Ready",
  listening: "Listening",
  thinking: "Thinking",
  speaking: "Speaking",
  reconnecting: "Reconnecting",
  sleeping: "Sleeping",
};

function whenText(iso: string): string {
  return new Date(iso).toLocaleString();
}

function batteryText(state: RobotDeviceState): string {
  if (state.battery_level !== null && state.battery_level !== undefined) {
    return `${Math.round(state.battery_level * 100)}%`;
  }
  if (state.on_battery === true) return "On battery, level unknown";
  if (state.on_battery === false) return "Plugged in";
  return "Level unknown";
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="min-w-0 text-right text-base">{children}</dd>
    </div>
  );
}

/** ROBOT-CARD-01: one paired robot's live state, from the `state` the hub
 * derives on `GET /api/devices` (`null` until the robot's first report).
 * Composed from the dashboard template's own Card and Progress, the same
 * shipped parts the dashboard's stat cards use. */
export function RobotCard({
  device,
  onRemove,
  confirmingRemove,
  onConfirmRemove,
  onCancelRemove,
  busy,
}: {
  device: DeviceInfo;
  onRemove: () => void;
  confirmingRemove: boolean;
  onConfirmRemove: () => void;
  onCancelRemove: () => void;
  busy: boolean;
}) {
  const state = device.state ?? null;
  const unreachable = state !== null && !state.reachable;
  const status = state === null ? "Waiting for first report" : unreachable ? "Not responding" : ACTIVITY_LABELS[state.activity];
  const battery = state?.battery_level;
  return (
    <Card data-testid="robot-card">
      <CardHeader>
        <CardTitle className="truncate">{device.name}</CardTitle>
        <CardDescription>{device.area ?? "Robot"}</CardDescription>
        <CardAction>
          <Badge variant={unreachable ? "destructive" : "secondary"}>{status}</Badge>
        </CardAction>
      </CardHeader>
      <CardContent>
        {state === null ? (
          <p className="text-base text-muted-foreground">
            {device.name} has not reported in yet. It shows up here once it is switched on and connected.
          </p>
        ) : (
          <dl className="flex flex-col gap-3">
            {unreachable ? (
              <Row label="Last heard from">{state.unreachableSince ? whenText(state.unreachableSince) : "Unknown"}</Row>
            ) : null}
            <Row label="Microphone">{state.muted ? "Muted" : "On"}</Row>
            <Row label="Tracking">{state.tracking ? "On" : "Off"}</Row>
            <Row label="Battery">{batteryText(state)}</Row>
            {battery !== null && battery !== undefined ? (
              <Progress value={Math.round(battery * 100)} aria-label="Battery level" />
            ) : null}
            <Row label="MaiPai version">{state.app_version ?? "Unknown"}</Row>
            <Row label="Body software">{state.daemon_version ?? "Unknown"}</Row>
          </dl>
        )}
      </CardContent>
      <CardFooter className="justify-end gap-2">
        {confirmingRemove ? (
          <>
            <p className="mr-auto text-base font-medium">Remove {device.name}? It will need to be paired again.</p>
            <Button variant="destructive" onClick={onConfirmRemove} disabled={busy}>
              {busy ? "Working…" : "Yes, remove it"}
            </Button>
            <Button variant="ghost" onClick={onCancelRemove}>
              Keep it
            </Button>
          </>
        ) : (
          <Button variant="ghost" aria-label={`Remove ${device.name}`} onClick={onRemove}>
            Remove
          </Button>
        )}
      </CardFooter>
    </Card>
  );
}
