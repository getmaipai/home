import { i18n } from "@lingui/core";
import { useState } from "react";
import { Button } from "@maipai/ui/src/ui/button";
import { Input } from "@maipai/ui/src/ui/input";
import { Checkbox } from "@maipai/ui/src/ui/checkbox";
import { Label } from "@maipai/ui/src/dashboard/components/ui/label";
import { Section } from "@maipai/ui/src/primitives/Section";
import { DestructiveConfirm } from "@maipai/ui/src/primitives/DestructiveConfirm";
import { Alert, AlertDescription } from "@maipai/ui/src/ui/alert";
import { api } from "@/lib/api";
import { errorLine } from "@/lib/hubReachability";

export function RobotWifi({ deviceId, checkin }: {
  deviceId: string;
  checkin: { wifi_saved?: string[] | null; link_encrypted?: boolean | null; link_path?: "home" | "away" | "other" | null } | null | undefined;
}) {
  const [ssid, setSsid] = useState("");
  const [password, setPassword] = useState("");
  const encrypted = checkin?.link_encrypted === true;
  const [showPassword, setShowPassword] = useState(false);
  const [confirmLan, setConfirmLan] = useState(false);
  const [busy, setBusy] = useState(false);
  const [forgetting, setForgetting] = useState<string | null>(null);
  const [gone, setGone] = useState<string[]>([]);
  const [problem, setProblem] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  async function submit(action: "add" | "forget" | "use", network: string, secret?: string): Promise<void> {
    setBusy(true); setProblem(null); setNote(null);
    try {
      await api.robotWifi(deviceId, { action, ssid: network, ...(secret === undefined ? {} : { password: secret }), ...(action === "add" && !encrypted ? { confirm_lan: true } : {}) });
      setNote(action === "use" ? i18n._({ id: "Asked the robot to join {name} now. If it cannot reach the hub within 3 minutes it goes back by itself.", message: "Asked the robot to join {name} now. If it cannot reach the hub within 3 minutes it goes back by itself.", values: { name: network } }) : action === "add" ? i18n._({ id: "Wi-Fi network sent to the robot.", message: "Wi-Fi network sent to the robot." }) : i18n._({ id: "Asked the robot to forget {name}.", message: "Asked the robot to forget {name}.", values: { name: network } }));
      if (action === "forget") {
        setGone((list) => [...list, network]);
        setNote(i18n._({ id: "Asked the robot to forget {name}. It drops it within a minute if it is online.", message: "Asked the robot to forget {name}. It drops it within a minute if it is online.", values: { name: network } }));
      }
      if (action === "add") { setSsid(""); setPassword(""); setConfirmLan(false); }
      setForgetting(null);
    } catch (error) {
      setProblem(errorLine(error, i18n._({ id: "Could not change the robot's Wi-Fi. Try again.", message: "Could not change the robot's Wi-Fi. Try again." })));
    } finally { setBusy(false); }
  }
  async function testTailnet(): Promise<void> {
    setBusy(true); setProblem(null); setNote(null);
    try {
      await api.preferRobotTailnet(deviceId, 10);
      setNote(i18n._({ id: "Asked the robot to reach the hub over the tailnet for 10 minutes.", message: "Asked the robot to reach the hub over the tailnet for 10 minutes." }));
    } catch (error) {
      setProblem(errorLine(error, i18n._({ id: "Could not start the tailnet test. Try again.", message: "Could not start the tailnet test. Try again." })));
    } finally { setBusy(false); }
  }
  const names = checkin?.wifi_saved?.filter((n) => !gone.includes(n));
  const canOfferForm = encrypted || checkin?.link_path === "home" || checkin?.link_path === "away";
  return <Section heading={i18n._({ id: "Robot Wi-Fi", message: "Robot Wi-Fi" })}>
    <div className="flex flex-col gap-3">
      <p className="text-body text-muted-foreground">{i18n._({ id: "The robot joins the strongest saved network in range for now.", message: "The robot joins the strongest saved network in range for now." })}</p>
      {names === undefined || names === null ? <p className="text-body text-muted-foreground">{i18n._({ id: "Waiting for the robot to report its networks.", message: "Waiting for the robot to report its networks." })}</p> : names.length === 0 ? <p className="text-body text-muted-foreground">{i18n._({ id: "No saved networks reported.", message: "No saved networks reported." })}</p> : forgetting !== null ? <DestructiveConfirm message={i18n._({ id: "Forget {name} on this robot?", message: "Forget {name} on this robot?", values: { name: forgetting } })} detail={i18n._({ id: "The robot will no longer join this network.", message: "The robot will no longer join this network." })} confirmLabel={i18n._({ id: "Forget network", message: "Forget network" })} busyLabel={i18n._({ id: "Working…", message: "Working…" })} cancelLabel={i18n._({ id: "Keep network", message: "Keep network" })} busy={busy} onConfirm={() => void submit("forget", forgetting)} onCancel={() => setForgetting(null)} /> : <ul className="flex flex-col gap-2">{names.map((name) => <li key={name} className="flex items-center justify-between gap-2"><span>{name}</span><span className="flex gap-2"><Button size="sm" variant="outline" disabled={busy} onClick={() => void submit("use", name)}>{i18n._({ id: "Use this network now", message: "Use this network now" })}</Button><Button size="sm" variant="outline" disabled={busy} onClick={() => setForgetting(name)}>{i18n._({ id: "Forget", message: "Forget" })}</Button></span></li>)}</ul>}
      <Button variant="outline" disabled={busy} onClick={() => void testTailnet()}>{i18n._({ id: "Test the tailnet path for 10 minutes", message: "Test the tailnet path for 10 minutes" })}</Button>
      {(names?.length ?? 0) >= 10 ? <p className="text-body text-muted-foreground pt-3">{i18n._({ id: "This robot already holds 10 Wi-Fi networks. Forget one to add another.", message: "This robot already holds 10 Wi-Fi networks. Forget one to add another." })}</p> : canOfferForm ? <div className="flex flex-col gap-2 pt-3">
        {!encrypted ? <p className="text-body text-muted-foreground">{i18n._({ id: "This sends the password across your home network to the robot. OK on your own home network. Use the tailnet for networks away from home.", message: "This sends the password across your home network to the robot. OK on your own home network. Use the tailnet for networks away from home." })}</p> : null}
        <Label htmlFor={`wifi-ssid-${deviceId}`}>{i18n._({ id: "Network name", message: "Network name" })}</Label>
        <Input id={`wifi-ssid-${deviceId}`} value={ssid} maxLength={32} autoComplete="off" onChange={(event) => setSsid(event.target.value)} />
        <Label htmlFor={`wifi-password-${deviceId}`}>{i18n._({ id: "Wi-Fi password", message: "Wi-Fi password" })}</Label>
        <Input id={`wifi-password-${deviceId}`} type={showPassword ? "text" : "password"} value={password} maxLength={63} autoComplete="off" onChange={(event) => setPassword(event.target.value)} />
        <div className="flex items-center gap-2"><Checkbox id={`wifi-show-${deviceId}`} checked={showPassword} onCheckedChange={(value) => setShowPassword(value === true)} /><Label htmlFor={`wifi-show-${deviceId}`}>{i18n._({ id: "Show password", message: "Show password" })}</Label></div>
        {!encrypted ? <div className="flex items-center gap-2"><Checkbox id={`wifi-confirm-${deviceId}`} checked={confirmLan} onCheckedChange={(value) => setConfirmLan(value === true)} /><Label htmlFor={`wifi-confirm-${deviceId}`}>{i18n._({ id: "This is my own home network", message: "This is my own home network" })}</Label></div> : null}
        <Button disabled={busy || !ssid.trim() || password.length === 0 || (!encrypted && !confirmLan)} onClick={() => void submit("add", ssid, password)}>{busy ? i18n._({ id: "Sending…", message: "Sending…" }) : i18n._({ id: "Add network", message: "Add network" })}</Button>
      </div> : <p className="text-body text-muted-foreground">{i18n._({ id: "This password would cross a network that is not your home network or your tailnet, so the form is off. Add networks while the robot is at home or connected through your tailnet.", message: "This password would cross a network that is not your home network or your tailnet, so the form is off. Add networks while the robot is at home or connected through your tailnet." })}</p>}
      {note ? <p role="status" className="text-body text-muted-foreground">{note}</p> : null}
      {problem ? <Alert variant="destructive"><AlertDescription>{problem}</AlertDescription></Alert> : null}
    </div>
  </Section>;
}
