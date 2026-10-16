import { useEffect, useRef, useState } from "react";
import { Badge } from "@maipai/ui/src/ui/badge";
import { Button } from "@maipai/ui/src/ui/button";
import { CardAction, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@maipai/ui/src/dashboard/components/ui/card";
import { Progress } from "@maipai/ui/src/dashboard/components/ui/progress";
import { Image } from "@maipai/ui/src/elements/image";
import { ErrorState } from "@maipai/ui/src/elements/error-state";
import { ApiError, type DeviceInfo, type RobotDeviceState } from "@/lib/api";
import { robotCapabilityLabel } from "@/apps/settings/capabilityLabels";

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

/** Plain-words body health (spec-v0.1.147): null when the robot reports nothing wrong or nothing at all. */
export function bodyHealthText(state: RobotDeviceState): string | null {
  const parts: string[] = [];
  const latched = state.motors_latched ?? [];
  if (latched.length > 0) parts.push(`${latched.join(", ")} switched off after a failed recovery`);
  else if (state.motors_stuck === true) parts.push("Working on a stuck motor");
  switch (state.thermal?.level) {
    case "vision_slowed": parts.push("Warm: watching less often"); break;
    case "gestures_suspended": parts.push("Hot: gestures paused"); break;
    case "idle_still": parts.push("Very hot: resting until it cools"); break;
    default: break;
  }
  return parts.length > 0 ? parts.join(". ") : null;
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

/** ROBOT-CARD-01: the body of one paired robot card's live state, from the `state` the hub
 * derives on `GET /api/devices` (`null` until the robot's first report).
 * The caller renders the Card around it (data-testid="robot-card"); this
 * holds the shipped header, content and footer parts. */
export function RobotBody({
  device,
  onRemove,
  confirmingRemove,
  onConfirmRemove,
  onCancelRemove,
  busy,
  onSetMuted,
  onStartLiveView,
  onStopLiveView,
}: {
  device: DeviceInfo;
  onRemove: () => void;
  confirmingRemove: boolean;
  onConfirmRemove: () => void;
  onCancelRemove: () => void;
  busy: boolean;
  onSetMuted: (muted: boolean) => Promise<void>;
  onStartLiveView: () => Promise<{ view_id: string; stream: string }>;
  onStopLiveView: (viewId: string) => Promise<void>;
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
  // LIVE-VIEW-01: the hub refuses (live view off, not an adult, not on the list) with a plain
  // message, shown as it came. The hub stops a view at 10 minutes; so does this card.
  const [liveView, setLiveView] = useState<{ viewId: string; stream: string } | null>(null);
  const [liveStarting, setLiveStarting] = useState(false);
  const [liveError, setLiveError] = useState<string | null>(null);
  const liveViewId = liveView?.viewId ?? null;
  const stopRef = useRef(onStopLiveView);
  stopRef.current = onStopLiveView;
  async function startLive(): Promise<void> {
    setLiveError(null);
    setLiveStarting(true);
    try {
      const started = await onStartLiveView();
      setLiveView({ viewId: started.view_id, stream: started.stream });
    } catch (err) {
      setLiveView(null);
      setLiveError(err instanceof ApiError ? err.message : `Could not open the live view of ${device.name}. Check that it is switched on, then try again.`);
    } finally {
      setLiveStarting(false);
    }
  }
  function stopLive(): void {
    const id = liveViewId;
    setLiveView(null);
    if (id) void stopRef.current(id).catch(() => undefined);
  }
  useEffect(() => {
    if (!liveViewId) return;
    const timer = setTimeout(() => {
      setLiveView(null);
      void stopRef.current(liveViewId).catch(() => undefined);
    }, 10 * 60_000);
    return () => clearTimeout(timer);
  }, [liveViewId]);
  const openViewRef = useRef<string | null>(null);
  openViewRef.current = liveViewId;
  useEffect(() => () => { if (openViewRef.current) void stopRef.current(openViewRef.current).catch(() => undefined); }, []);
  const unreachable = state !== null && !state.reachable;
  const showMuted = state !== null && !unreachable && state.muted && (state.activity === "idle" || state.activity === "listening");
  const status = state === null ? "Waiting for first report" : unreachable ? "Not responding" : showMuted ? "Muted" : ACTIVITY_LABELS[state.activity];
  const motion = state?.motion ?? null;
  const battery = state?.battery_level;
  return (
    <>
      <CardHeader>
        <CardTitle className="truncate">{device.name}</CardTitle>
        <CardDescription>{device.area ?? "Robot"}</CardDescription>
        <CardAction>
          <Badge variant={unreachable ? "destructive" : "secondary"}>{status}</Badge>
          <Badge variant="secondary">Paired</Badge>
        </CardAction>
      </CardHeader>
      <CardContent>
        {device.capabilities.length > 0 ? (
          <div className="mb-4 flex flex-wrap gap-2" aria-label="Robot capabilities">
            {device.capabilities.map((capability) => (
              <Badge key={capability} variant="outline">
                {robotCapabilityLabel(capability)}
              </Badge>
            ))}
          </div>
        ) : null}
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
            {bodyHealthText(state) ? <Row label="Body health">{bodyHealthText(state)}</Row> : null}
            <Row label="MaiPai version">{state.app_version ?? "Unknown"}</Row>
            <Row label="Body software">{state.daemon_version ?? "Unknown"}</Row>
          </dl>
        )}
        {liveView && liveView.stream ? (
          <div className="mt-4" data-testid="robot-live-view">
            <Image.Root size="full">
              <Image.Preview src={liveView.stream} alt={`Live view from ${device.name}'s camera`} />
            </Image.Root>
            <p className="mt-2 text-sm text-muted-foreground">Live view stops by itself after 10 minutes. Nothing is recorded.</p>
          </div>
        ) : null}
        {liveError ? <p role="alert" className="mt-4 text-base text-destructive">{liveError}</p> : null}
        {muteError && state !== null ? (
          <ErrorState
            layout="inline"
            retrying={false}
            title={`Could not send that to ${device.name}.`}
            onRetry={() => void askMute(!state.muted)}
          />
        ) : null}
      </CardContent>
      <CardFooter>
        <div className="flex w-full flex-wrap items-center justify-end gap-2">
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
                  {liveView ? (
                    <Button variant="outline" onClick={stopLive}>
                      Stop live view
                    </Button>
                  ) : (
                    <Button variant="outline" disabled={busy || unreachable || liveStarting} onClick={() => void startLive()}>
                      {liveStarting ? "Opening…" : "Live view"}
                    </Button>
                  )}
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
        </div>
      </CardFooter>
    </>
  );
}
