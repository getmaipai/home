import { useEffect, useMemo, useRef, useState } from "react";
import { Badge } from "@maipai/ui/src/ui/badge";
import { Button } from "@maipai/ui/src/ui/button";
import { CardAction, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@maipai/ui/src/dashboard/components/ui/card";
import { Progress } from "@maipai/ui/src/dashboard/components/ui/progress";
import { Image } from "@maipai/ui/src/elements/image";
import { ErrorState } from "@maipai/ui/src/elements/error-state";
import { ApiError, type DeviceInfo, type RobotDeviceState } from "@/lib/api";
import { NO_VENDOR_LOGIN, robotCapabilityLabel } from "@/apps/settings/capabilityLabels";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@maipai/ui/src/ui/dialog";
import { Input } from "@maipai/ui/src/ui/input";
import { FieldError } from "@maipai/ui/src/dashboard/components/ui/field";
import { Label } from "@maipai/ui/src/dashboard/components/ui/label";
import { SettingsRenderer } from "@/shell/pages/settings/SettingsRenderer";
import areasFile from "@maipai/spec/settings/areas.json";
import { api, isOwnerOrAdminRole } from "@/lib/api";
import type { Role } from "@maipai/ui/src/settings/settingsAudience";
import { robotSelfTestPartsFor, type RobotSelfTestPart } from "@maipai/home-backend/src/wire";
import type { RobotSelfTestResult } from "@maipai/home-backend/src/wire";
import { Alert, AlertDescription } from "@maipai/ui/src/ui/alert";
import { playableVoices, voiceFriendlyName } from "@/lib/voice/voiceBrowserRows";

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
  onAnswerMotorReboot,
  viewerRole = "adult",
}: {
  device: DeviceInfo;
  viewerRole?: Role;
  onRemove: () => void;
  confirmingRemove: boolean;
  onConfirmRemove: () => void;
  onCancelRemove: () => void;
  busy: boolean;
  onSetMuted: (muted: boolean) => Promise<void>;
  onStartLiveView: () => Promise<{ view_id: string; stream: string }>;
  onStopLiveView: (viewId: string) => Promise<void>;
  onAnswerMotorReboot: (answer: "yes" | "no") => Promise<void>;
}) {
  const state = device.state ?? null;
  // no_vendor_login describes the pairing gate (ROBOT-PAIR-02), not a feature, so it gets no badge.
  const featureCapabilities = device.capabilities.filter((capability) => capability !== NO_VENDOR_LOGIN);
  const admin = isOwnerOrAdminRole(viewerRole);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [robotVoices, setRobotVoices] = useState<Awaited<ReturnType<typeof api.stackVoices>>["voices"]>([]);
  useEffect(() => {
    if (!settingsOpen) return;
    let active = true;
    void api.stackVoices().then((result) => { if (active) setRobotVoices(result.voices); }).catch(() => { if (active) setRobotVoices([]); });
    return () => { active = false; };
  }, [settingsOpen]);
  const robotVoiceOptions = [{ value: "default", label: "Same as its person" }, ...playableVoices(robotVoices).map((voice) => ({ value: voice.id, label: voiceFriendlyName(voice) }))];
  const [forgetConfirming, setForgetConfirming] = useState(false);
  const [name, setName] = useState(device.name);
  const [area, setArea] = useState(device.area ?? "");
  const [saveBusy, setSaveBusy] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [selfTests, setSelfTests] = useState<Partial<Record<RobotSelfTestPart, RobotSelfTestResult | { kind: "offline" | "timeout" | "error"; message: string }>>>({});
  const [selfTestBusy, setSelfTestBusy] = useState<RobotSelfTestPart | null>(null);
  async function runSelfTest(part: RobotSelfTestPart): Promise<void> {
    setSelfTestBusy(part);
    setSelfTests((previous) => ({ ...previous, [part]: undefined }));
    try {
      const result = await api.robotSelfTest(device.id, part);
      setSelfTests((previous) => ({ ...previous, [part]: result }));
    } catch (error) {
      const apiError = error instanceof ApiError ? error : null;
      setSelfTests((previous) => ({ ...previous, [part]: apiError?.status === 409
        ? { kind: "offline", message: apiError.message }
        : apiError?.status === 504
          ? { kind: "timeout", message: apiError.message }
          : { kind: "error", message: apiError?.message ?? "Could not test that part. Reload the page and try again." } }));
    } finally { setSelfTestBusy(null); }
  }
  const cards = useMemo(() => ((areasFile as { device_cards?: Array<{ device_kind: string; group: string; scope: "device"; label: string; min_role?: string }> }).device_cards ?? []).filter((card) => card.device_kind === "robot" && card.scope === "device" && (!card.min_role || card.min_role === "admin" || card.min_role === "owner")), []);
  async function saveIdentity(): Promise<void> {
    setSaveBusy(true);
    setSaveError(null);
    try {
      await api.updateDevice(device.id, { name, area: area.trim() || null });
      window.dispatchEvent(new Event("devices-updated"));
    } catch (error) {
      setSaveError(error instanceof ApiError ? error.message : "Could not save this robot.");
    } finally { setSaveBusy(false); }
  }
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
  // MOTOR-REBOOT-CARD: the robot offers to restart a latched motor; nothing is sent until someone answers yes.
  const [rebootBusy, setRebootBusy] = useState(false);
  const [rebootError, setRebootError] = useState<string | null>(null);
  async function answerReboot(answer: "yes" | "no"): Promise<void> {
    setRebootError(null);
    setRebootBusy(true);
    try {
      await onAnswerMotorReboot(answer);
    } catch (err) {
      setRebootError(err instanceof ApiError ? err.message : `Could not send that to ${device.name}. Check that it is switched on, then try again.`);
    } finally {
      setRebootBusy(false);
    }
  }
  const unreachable = state !== null && !state.reachable;
  const rebootOffer = state !== null && !unreachable ? state.motors_reboot_offer ?? [] : [];
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
        {featureCapabilities.length > 0 ? (
          <div className="mb-4 flex flex-wrap gap-2" aria-label="Robot capabilities">
            {featureCapabilities.map((capability) => (
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
            {admin && device.ipAddress ? <Row label="IP address">{device.ipAddress}</Row> : null}
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
        {admin ? (
          <div className="mt-4" data-testid="robot-self-tests">
            <p className="text-base font-medium">Test this robot</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {robotSelfTestPartsFor(device).map((part) => {
                const label: Record<RobotSelfTestPart, string> = { speaker: "Speaker", face: "Face", head: "Head", lights: "Lights", mic: "Microphone" };
                const result = selfTests[part];
                return <div key={part}>
                  <Button variant="outline" disabled={unreachable || selfTestBusy !== null} onClick={() => void runSelfTest(part)}>{selfTestBusy === part ? "Testing…" : label[part]}</Button>
                  {result && "ok" in result ? <p className="mt-1 text-sm"><Badge variant={result.ok ? "secondary" : "destructive"}>{result.ok ? "Passed" : "Failed"}</Badge> {result.detail} ({result.took_ms} ms)</p> : null}
                  {result && "kind" in result && result.kind === "offline" ? <p className="mt-1 text-sm text-muted-foreground">{result.message}</p> : null}
                  {result && "kind" in result && (result.kind === "timeout" || result.kind === "error") ? <Alert variant="destructive"><AlertDescription>{result.message}</AlertDescription></Alert> : null}
                </div>;
              })}
            </div>
          </div>
        ) : null}
        {rebootOffer.length > 0 ? (
          <div className="mt-4 flex flex-col gap-2" data-testid="motor-reboot-offer">
            <p className="text-base font-medium">
              Restart {device.name}'s {rebootOffer.join(", ")} {rebootOffer.length === 1 ? "motor" : "motors"}?
            </p>
            <p className="text-sm text-muted-foreground">
              {rebootOffer.length === 1 ? "That motor" : "Those motors"} stopped working and the robot could not recover on its own. Restarting moves {rebootOffer.length === 1 ? "it" : "them"}, so keep hands clear of the head first.
            </p>
            <div className="flex flex-wrap gap-2">
              <Button disabled={rebootBusy} onClick={() => void answerReboot("yes")}>
                Yes, restart it
              </Button>
              <Button variant="ghost" disabled={rebootBusy} onClick={() => void answerReboot("no")}>
                No, leave it
              </Button>
            </div>
            {rebootError ? <p role="alert" className="text-base text-destructive">{rebootError}</p> : null}
          </div>
        ) : null}
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
              {admin ? <Button variant="outline" onClick={() => { setName(device.name); setArea(device.area ?? ""); setSettingsOpen(true); }}>Settings</Button> : null}
              {/* DEVICES-02: an admin forgets a robot from its Settings dialog. */}
              {admin ? null : (
                <Button variant="ghost" aria-label={`Remove ${device.name}`} onClick={onRemove}>
                  Remove
                </Button>
              )}
            </>
          )}
        </div>
      </CardFooter>
      {admin ? <Dialog open={settingsOpen} onOpenChange={setSettingsOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>{device.name} settings</DialogTitle><DialogDescription>Change this robot's name, area and settings.</DialogDescription></DialogHeader>
          <div className="flex flex-col gap-3">
            <Label htmlFor={`robot-name-${device.id}`}>Name</Label>
            <Input id={`robot-name-${device.id}`} value={name} maxLength={60} aria-invalid={saveError !== null} onChange={(event) => setName(event.target.value)} />
            <FieldError errors={saveError ? [{ message: saveError }] : []} />
            <Label htmlFor={`robot-area-${device.id}`}>Area</Label>
            <Input id={`robot-area-${device.id}`} value={area} maxLength={60} onChange={(event) => setArea(event.target.value)} />
            <Button disabled={saveBusy || !name.trim()} onClick={() => void saveIdentity()}>{saveBusy ? "Saving…" : "Save name and area"}</Button>
          </div>
          {cards.map((card) => <SettingsRenderer key={`${card.scope}:${card.group}`} scope="device" scopeValue={`device:${device.id}`} only={[card.group]} titleOverrides={{ [card.group]: card.label }} optionsFrom={{ "voices.tts": robotVoiceOptions }} />)}
          <DialogFooter>
            {forgetConfirming || confirmingRemove ? <><p className="mr-auto text-base font-medium">Forget {device.name}? It will need to be paired again. This also deletes the robot's memories and its saved firmware backup.</p><Button variant="destructive" onClick={onConfirmRemove} disabled={busy}>{busy ? "Working…" : "Yes, forget it"}</Button><Button variant="ghost" onClick={() => { setForgetConfirming(false); onCancelRemove(); }}>Keep it</Button></> : <Button variant="destructive" onClick={() => { setForgetConfirming(true); onRemove(); }}>Forget this robot</Button>}
          </DialogFooter>
        </DialogContent>
      </Dialog> : null}
    </>
  );
}
