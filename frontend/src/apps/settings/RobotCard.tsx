import { useEffect, useRef, useState } from "react";
import { Badge } from "@maipai/ui/src/ui/badge";
import { Button } from "@maipai/ui/src/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@maipai/ui/src/dashboard/components/ui/card";
import { Progress } from "@maipai/ui/src/dashboard/components/ui/progress";
import { ErrorState } from "@maipai/ui/src/elements/error-state";
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

export function didPutDownCountIncrease(previous: number | undefined, next: number | undefined): boolean {
  return previous !== undefined && next !== undefined && next > previous;
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
  onSetMuted,
}: {
  device: DeviceInfo;
  onRemove: () => void;
  confirmingRemove: boolean;
  onConfirmRemove: () => void;
  onCancelRemove: () => void;
  busy: boolean;
  onSetMuted: (muted: boolean) => Promise<void>;
}) {
  const state = device.state ?? null;
  const lastPutDownCount = useRef<number | undefined>(state?.put_down_count);
  const [putDownChanged, setPutDownChanged] = useState(false);
  const [askedMuted, setAskedMuted] = useState<boolean | null>(null);
  const [muteError, setMuteError] = useState(false);
  useEffect(() => {
    const nextCount = state?.put_down_count;
    if (didPutDownCountIncrease(lastPutDownCount.current, nextCount)) {
      setPutDownChanged(true);
    }
    if (nextCount !== undefined) lastPutDownCount.current = nextCount;
  }, [state?.put_down_count]);
  useEffect(() => {
    if (askedMuted === null || state?.muted === askedMuted) {
      if (askedMuted !== null && state?.muted === askedMuted) setAskedMuted(null);
      return;
    }
    const timer = setTimeout(() => setAskedMuted(null), 15_000);
    return () => clearTimeout(timer);
  }, [askedMuted, state?.muted]);
  async function askMute(muted: boolean): Promise<void> {
    setMuteError(false);
    setAskedMuted(muted);
    try {
      await onSetMuted(muted);
    } catch {
      setAskedMuted(null);
      setMuteError(true);
    }
  }
  const unreachable = state !== null && !state.reachable;
  const showMuted = state !== null && !unreachable && state.muted && (state.activity === "idle" || state.activity === "listening");
  const status = state === null ? "Waiting for first report" : unreachable ? "Not responding" : showMuted ? "Muted" : ACTIVITY_LABELS[state.activity];
  const motion = state?.motion ?? null;
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
            {motion === "held" ? <p className="text-sm font-medium">Being carried</p> : null}
            {putDownChanged ? (
              <p className="text-sm text-muted-foreground">
                {device.area ? `${device.name} was moved: is it still in ${device.area}?` : `${device.name} was moved.`}
              </p>
            ) : null}
            <Row label="Battery">{batteryText(state)}</Row>
            {battery !== null && battery !== undefined ? (
              <Progress value={Math.round(battery * 100)} aria-label="Battery level" />
            ) : null}
            <Row label="MaiPai version">{state.app_version ?? "Unknown"}</Row>
            <Row label="Body software">{state.daemon_version ?? "Unknown"}</Row>
          </dl>
        )}
        {muteError && state !== null ? (
          <ErrorState
            layout="inline"
            retrying={false}
            title={`Could not send that to ${device.name}.`}
            onRetry={() => void askMute(!state.muted)}
          />
        ) : null}
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
          <>
            {state !== null ? (
              <>
                {askedMuted !== null && !muteError ? (
                  <p className="mr-auto text-sm text-muted-foreground">Asked {device.name} to {askedMuted ? "mute" : "unmute"}, waiting for it.</p>
                ) : null}
                <Button
                  variant="outline"
                  disabled={busy || unreachable || askedMuted !== null}
                  onClick={() => void askMute(!state.muted)}
                >
                  {state.muted ? "Unmute microphone" : "Mute microphone"}
                </Button>
              </>
            ) : null}
            <Button variant="ghost" aria-label={`Remove ${device.name}`} onClick={onRemove}>
              Remove
            </Button>
          </>
        )}
      </CardFooter>
    </Card>
  );
}
