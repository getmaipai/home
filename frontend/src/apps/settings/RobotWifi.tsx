import { i18n } from "@lingui/core";
import { useState } from "react";
import { Button } from "@maipai/ui/src/ui/button";
import { Input } from "@maipai/ui/src/ui/input";
import { Label } from "@maipai/ui/src/dashboard/components/ui/label";
import { Section } from "@maipai/ui/src/primitives/Section";
import { DestructiveConfirm } from "@maipai/ui/src/primitives/DestructiveConfirm";
import { Alert, AlertDescription } from "@maipai/ui/src/ui/alert";
import { api } from "@/lib/api";
import { errorLine } from "@/lib/hubReachability";

export function RobotWifi({ deviceId, checkin }: {
  deviceId: string;
  checkin: { wifi_saved?: string[] | null; link_encrypted?: boolean | null } | null | undefined;
}) {
  const [ssid, setSsid] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [forgetting, setForgetting] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  async function submit(action: "add" | "forget", network: string, secret?: string): Promise<void> {
    setBusy(true); setProblem(null); setNote(null);
    try {
      await api.robotWifi(deviceId, { action, ssid: network, ...(secret === undefined ? {} : { password: secret }) });
      setNote(action === "add" ? i18n._({ id: "Wi-Fi network sent to the robot.", message: "Wi-Fi network sent to the robot." }) : i18n._({ id: "Asked the robot to forget {name}.", message: "Asked the robot to forget {name}.", values: { name: network } }));
      if (action === "add") { setSsid(""); setPassword(""); }
      setForgetting(null);
    } catch (error) {
      setProblem(errorLine(error, i18n._({ id: "Could not change the robot's Wi-Fi. Try again.", message: "Could not change the robot's Wi-Fi. Try again." })));
    } finally { setBusy(false); }
  }
  const names = checkin?.wifi_saved;
  return <Section heading={i18n._({ id: "Robot Wi-Fi", message: "Robot Wi-Fi" })}>
    <div className="flex flex-col gap-3">
      <p className="text-body text-muted-foreground">{i18n._({ id: "The robot joins the strongest saved network in range for now.", message: "The robot joins the strongest saved network in range for now." })}</p>
      {names === undefined || names === null ? <p className="text-body text-muted-foreground">{i18n._({ id: "Waiting for the robot to report its networks.", message: "Waiting for the robot to report its networks." })}</p> : names.length === 0 ? <p className="text-body text-muted-foreground">{i18n._({ id: "No saved networks reported.", message: "No saved networks reported." })}</p> : forgetting !== null ? <DestructiveConfirm message={i18n._({ id: "Forget {name} on this robot?", message: "Forget {name} on this robot?", values: { name: forgetting } })} detail={i18n._({ id: "The robot will no longer join this network.", message: "The robot will no longer join this network." })} confirmLabel={i18n._({ id: "Forget network", message: "Forget network" })} busyLabel={i18n._({ id: "Working…", message: "Working…" })} cancelLabel={i18n._({ id: "Keep network", message: "Keep network" })} busy={busy} onConfirm={() => void submit("forget", forgetting)} onCancel={() => setForgetting(null)} /> : <ul className="flex flex-col gap-2">{names.map((name) => <li key={name} className="flex items-center justify-between gap-2"><span>{name}</span><Button size="sm" variant="outline" disabled={busy} onClick={() => setForgetting(name)}>{i18n._({ id: "Forget", message: "Forget" })}</Button></li>)}</ul>}
      {checkin?.link_encrypted === true ? <div className="flex flex-col gap-2">
        <Label htmlFor={`wifi-ssid-${deviceId}`}>{i18n._({ id: "Network name", message: "Network name" })}</Label>
        <Input id={`wifi-ssid-${deviceId}`} value={ssid} maxLength={32} autoComplete="off" onChange={(event) => setSsid(event.target.value)} />
        <Label htmlFor={`wifi-password-${deviceId}`}>{i18n._({ id: "Wi-Fi password", message: "Wi-Fi password" })}</Label>
        <Input id={`wifi-password-${deviceId}`} type="password" value={password} maxLength={63} autoComplete="off" onChange={(event) => setPassword(event.target.value)} />
        <Button disabled={busy || !ssid.trim() || password.length === 0} onClick={() => void submit("add", ssid, password)}>{busy ? i18n._({ id: "Sending…", message: "Sending…" }) : i18n._({ id: "Add network", message: "Add network" })}</Button>
      </div> : <p className="text-body text-muted-foreground">{i18n._({ id: "For safety, a Wi-Fi password is not sent to the robot over your home network's plain link. Join the robot's own Wi-Fi (its screen shows the name when it cannot connect) and use its setup page, or scan a Wi-Fi QR code once the new firmware is installed.", message: "For safety, a Wi-Fi password is not sent to the robot over your home network's plain link. Join the robot's own Wi-Fi (its screen shows the name when it cannot connect) and use its setup page, or scan a Wi-Fi QR code once the new firmware is installed." })}</p>}
      {note ? <p role="status" className="text-body text-muted-foreground">{note}</p> : null}
      {problem ? <Alert variant="destructive"><AlertDescription>{problem}</AlertDescription></Alert> : null}
    </div>
  </Section>;
}
