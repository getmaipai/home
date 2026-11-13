import { i18n } from "@lingui/core";
import { useState } from "react";
import { Button } from "@maipai/ui/src/ui/button";
import { Input } from "@maipai/ui/src/ui/input";
import { Switch } from "@maipai/ui/src/ui/switch";
import { Label } from "@maipai/ui/src/dashboard/components/ui/label";
import { Alert, AlertDescription } from "@maipai/ui/src/ui/alert";
import { api, type DeviceInfo } from "@/lib/api";
import { errorLine } from "@/lib/hubReachability";

/** STACKCHAN-HOME-01: the light-ring StackChan's own buttons, on the robot's page in Home settings, Devices: Dance, Test music
 * detection and a short Announce form. The robot answers started or refused on its own channel; the hub keeps no answer, so these
 * say what was asked, not what the robot did. Timers are set by voice, never from here. */
export function robotHasDance(device: DeviceInfo): boolean {
  return device.capabilities.includes("light_ring") && device.capabilities.includes("head_pan_tilt");
}

export function RobotActions({ device }: { device: DeviceInfo }) {
  const unreachable = device.state != null && !device.state.reachable;
  const [busy, setBusy] = useState<"dance" | "music_test" | "announce" | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [urgent, setUrgent] = useState(false);
  if (!robotHasDance(device)) return null;
  async function send(kind: "dance" | "music_test" | "announce"): Promise<void> {
    setBusy(kind);
    setNote(null);
    setProblem(null);
    try {
      if (kind === "announce") await api.robotAnnounce(device.id, text.trim(), urgent);
      else await api.robotCommand(device.id, kind);
      if (kind === "dance") setNote(i18n._({ id: "Asked {name} to dance.", message: "Asked {name} to dance.", values: { name: device.name } }));
      else if (kind === "music_test") setNote(i18n._({ id: "Started the music check on {name}. It nods, listens, then dances if it hears a beat.", message: "Started the music check on {name}. It nods, listens, then dances if it hears a beat.", values: { name: device.name } }));
      else { setNote(i18n._({ id: "Sent the announcement to {name}.", message: "Sent the announcement to {name}.", values: { name: device.name } })); setText(""); }
    } catch (error) {
      setProblem(errorLine(error, i18n._({ id: "Could not send that to {name}. Check that it is switched on, then try again.", message: "Could not send that to {name}. Check that it is switched on, then try again.", values: { name: device.name } })));
    } finally { setBusy(null); }
  }
  return (
    <div data-testid="robot-actions" className="flex flex-col gap-3">
      <p className="text-body font-medium">{i18n._({ id: "Fun and announcements", message: "Fun and announcements" })}</p>
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" disabled={unreachable || busy !== null} onClick={() => void send("dance")}>{i18n._({ id: "Dance", message: "Dance" })}</Button>
        <Button variant="outline" disabled={unreachable || busy !== null} onClick={() => void send("music_test")}>{i18n._({ id: "Test music detection", message: "Test music detection" })}</Button>
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor={`announce-${device.id}`}>{i18n._({ id: "Announce", message: "Announce" })}</Label>
        <Input id={`announce-${device.id}`} value={text} maxLength={400} placeholder={i18n._({ id: "Dinner is ready", message: "Dinner is ready" })} onChange={(event) => setText(event.target.value)} />
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Label htmlFor={`announce-urgent-${device.id}`}>
            <Switch id={`announce-urgent-${device.id}`} checked={urgent} onCheckedChange={setUrgent} />
            {i18n._({ id: "Urgent", message: "Urgent" })}
          </Label>
          <Button disabled={unreachable || busy !== null || text.trim() === ""} onClick={() => void send("announce")}>{busy === "announce" ? i18n._({ id: "Sending…", message: "Sending…" }) : i18n._({ id: "Announce", message: "Announce" })}</Button>
        </div>
      </div>
      {note ? <p className="text-body text-muted-foreground" role="status">{note}</p> : null}
      {problem ? <Alert variant="destructive"><AlertDescription>{problem}</AlertDescription></Alert> : null}
    </div>
  );
}
