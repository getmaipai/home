import { StatusCard } from "@maipai/ui/src/elements/status-card";
import { i18n } from "@lingui/core";
import { useEffect, useRef, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@maipai/ui/src/ui/dialog";
import { Button } from "@maipai/ui/src/ui/button";
import { JobProgress } from "@maipai/ui/src/elements/job-progress";
import { Alert, AlertDescription } from "@maipai/ui/src/ui/alert";
import { api } from "@/lib/api";
import { addLogLine, browserCanFlash, createBrowserSerialTransport, FLASH_BYTES, installStackChan, STALL_TIMEOUT_MESSAGE, type FlashStage, type FlashTransport } from "@/lib/stackchan/flash";
import { downloadProgress } from "@/lib/downloadProgress";
import { errorLine } from "@/lib/hubReachability";

const browserMessage = () => i18n._({ id: "Installing needs Chrome or Edge on a computer, with Home opened at its https address. Open Home there and try again.", message: "Installing needs Chrome or Edge on a computer, with Home opened at its https address. Open Home there and try again." });
const portHelp = () => i18n._({ id: "When Chrome asks which port to use, choose \"USB JTAG/serial debug unit\" (it may be listed as usbmodem). Do not choose a Bluetooth entry.", message: "When Chrome asks which port to use, choose \"USB JTAG/serial debug unit\" (it may be listed as usbmodem). Do not choose a Bluetooth entry." });
const onlineMessage = () => i18n._({ id: "The robot did not reach Home. Check it joined the same Wi-Fi as this hub, then press Retry.", message: "The robot did not reach Home. Check it joined the same Wi-Fi as this hub, then press Retry." });
const stageLabel = (stage: FlashStage): string => {
  switch (stage) {
    case "Connecting": return i18n._({ id: "Connecting", message: "Connecting" });
    case "Backing up": return i18n._({ id: "Backing up", message: "Backing up" });
    case "Writing": return i18n._({ id: "Writing", message: "Writing" });
    case "Checking": return i18n._({ id: "Checking", message: "Checking" });
    case "Restarting": return i18n._({ id: "Restarting", message: "Restarting" });
  }
};

/** With `updateOf` it updates the firmware of a robot Home already knows (no new entry, no backup, the robot keeps its
 * name, Wi-Fi and pairing); without it, it adds a new StackChan. */
export function StackChanInstallDialog({ updateOf, install = installStackChan, recordInstalled = api.recordRobotFirmwareInstalled, onInstalled, showButton = true }: { updateOf?: string; install?: typeof installStackChan; recordInstalled?: (deviceId: string) => Promise<unknown>; onInstalled?: () => void; showButton?: boolean } = {}) {
  const updating = updateOf !== undefined;
  const [updateDone, setUpdateDone] = useState(false);
  const [open, setOpen] = useState(false);
  const [stage, setStage] = useState<FlashStage | null>(null);
  const [progress, setProgress] = useState(0);
  const [working, setWorking] = useState(false);
  const [deviceId, setDeviceId] = useState<string | null>(null);
  const [installFinished, setInstallFinished] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [onlineFailed, setOnlineFailed] = useState(false);
  const [online, setOnline] = useState(false);
  const [completed, setCompleted] = useState(0);
  const transportRef = useRef<FlashTransport | null>(null);
  const [lines, setLines] = useState<string[]>([]);
  const [stalledInBackup, setStalledInBackup] = useState(false);

  useEffect(() => {
    if (!deviceId || !installFinished || online || !open || onlineFailed) return;
    let alive = true;
    const started = Date.now();
    const check = async () => {
      try {
        const devices = await api.robotDevices();
        if (!alive) return;
        if (devices.some((device) => device.id === deviceId && device.lastSeenAt !== null)) { setOnline(true); return; }
      } catch { /* A later poll can recover a temporary network failure. */ }
      if (Date.now() - started >= 180_000) setOnlineFailed(true);
    };
    void check();
    const timer = window.setInterval(() => void check(), 3000);
    return () => { alive = false; window.clearInterval(timer); };
  }, [deviceId, installFinished, online, open, onlineFailed]);

  /** Opening the dialog only checks the browser; the person then chooses how to install, with the time each takes shown. */
  function openDialog() {
    setMessage(null);
    setStalledInBackup(false);
    setOpen(true);
    if (!browserCanFlash(window, navigator)) setMessage(browserMessage());
  }

  async function startInstall(skipBackup: boolean) {
    setMessage(null);
    setStalledInBackup(false);
    if (!browserCanFlash(window, navigator)) {
      setMessage(browserMessage());
      return;
    }
    setWorking(true);
    let hostCreated = false;
    let flashComplete = false;
    try {
      const port = await (navigator as Navigator & { serial: { requestPort(): Promise<unknown> } }).serial.requestPort();
      const transport = createBrowserSerialTransport(port, (line) => setLines((previous) => addLogLine(previous, line)));
      transportRef.current = transport;
      const result = await install(transport, { onStage: (next, completed, total) => {
        setStage(next);
        setCompleted(completed ?? 0);
        setProgress(total && completed !== undefined ? Math.min(100, Math.round(completed / total * 100)) : 0);
      }, onHostCreated: (id) => { hostCreated = true; setDeviceId(id); } }, { skipBackup, existingDeviceId: updateOf });
      flashComplete = true;
      await recordInstalled(result.deviceId);
      onInstalled?.();
      if (updating) setUpdateDone(true);
      else setDeviceId(result.deviceId);
      setInstallFinished(true);
      setStage(null);
    } catch (error) {
      setStalledInBackup(error instanceof Error && error.message === STALL_TIMEOUT_MESSAGE);
      const detail = errorLine(error, i18n._({ id: "The StackChan install stopped.", message: "The StackChan install stopped." }));
      setMessage(flashComplete ? i18n._({ id: "Firmware was written, but Home could not record its version. {detail}", message: "Firmware was written, but Home could not record its version. {detail}", values: { detail } }) : hostCreated ? i18n._({ id: "{detail} Use Cancel install on the robot card before starting again.", message: "{detail} Use Cancel install on the robot card before starting again.", values: { detail } }) : i18n._({ id: "{detail} Check the USB cable and try again.", message: "{detail} Check the USB cable and try again.", values: { detail } }));
    } finally { transportRef.current = null; setWorking(false); }
  }

  /** Safe only before anything is written. A read that is stuck keeps the USB port busy, so the page reloads to free it. */
  function stopInstall() { void transportRef.current?.close?.(); window.setTimeout(() => window.location.reload(), 1500); }
  const canStop = working && (stage === "Connecting" || stage === "Backing up" || stage === null);
  const stageNote = stage === "Connecting" ? i18n._({ id: "Connecting to the StackChan. This takes up to 30 seconds.", message: "Connecting to the StackChan. This takes up to 30 seconds." })
    : stage === "Backing up" ? i18n._({ id: "{saved} of {total} MB saved. The backup takes about 6 minutes; keep the cable in and this tab open.", message: "{saved} of {total} MB saved. The backup takes about 6 minutes; keep the cable in and this tab open.", values: { saved: (completed / (1024 * 1024)).toFixed(1), total: FLASH_BYTES / (1024 * 1024) } })
    : stage === "Writing" ? i18n._({ id: "Writing the MaiPai firmware. Do not unplug the StackChan.", message: "Writing the MaiPai firmware. Do not unplug the StackChan." })
    : null;

  /** A read that stalled leaves the USB port busy, so starting over reloads the page, which frees it. */
  function startOver() { window.location.reload(); }
  const choosing = !deviceId && !working && !installFinished && !stalledInBackup && message !== browserMessage();

  function retryOnline() { setOnlineFailed(false); }

  return (
    <>
      {showButton ? <Button onClick={openDialog}>{updating ? i18n._({ id: "Update firmware", message: "Update firmware" }) : i18n._({ id: "Add a StackChan", message: "Add a StackChan" })}</Button> : null}
      <Dialog open={open} onOpenChange={(next) => { if (!working) setOpen(next); }}>
        <DialogContent scroll="viewport">
          <DialogHeader>
            <DialogTitle>{updating ? i18n._({ id: "Update firmware", message: "Update firmware" }) : i18n._({ id: "Add a StackChan", message: "Add a StackChan" })}</DialogTitle>
            <DialogDescription>
              {updateDone ? i18n._({ id: "The firmware is written. If the StackChan has not restarted within 10 seconds, unplug its USB cable and plug it back in (the reset from this page does not restart every unit). It then reconnects within a minute, with its name, Wi-Fi and pairing unchanged.", message: "The firmware is written. If the StackChan has not restarted within 10 seconds, unplug its USB cable and plug it back in (the reset from this page does not restart every unit). It then reconnects within a minute, with its name, Wi-Fi and pairing unchanged." }) : !installFinished ? i18n._({ id: "You need Chrome or Edge on a computer, Home opened at its https address, and the StackChan plugged into this computer with a USB-C data cable.", message: "You need Chrome or Edge on a computer, Home opened at its https address, and the StackChan plugged into this computer with a USB-C data cable." }) : online ? i18n._({ id: "Your StackChan is online and ready.", message: "Your StackChan is online and ready." }) : i18n._({ id: "On a phone, join the robot's Wi-Fi hotspot and choose your home Wi-Fi. Home never asks for the Wi-Fi password.", message: "On a phone, join the robot's Wi-Fi hotspot and choose your home Wi-Fi. Home never asks for the Wi-Fi password." })}
            </DialogDescription>
          </DialogHeader>
          {message ? <StatusCard kind="problem" title={i18n._({ id: "That did not work", message: "That did not work" })} line={message} /> : null}
          {stalledInBackup && !working ? <p>{i18n._({ id: "The backup did not work with this computer or cable. Press Start over, unplug and replug the StackChan, then choose Install without a backup. The firmware now on it will be replaced and cannot be restored from Home.", message: "The backup did not work with this computer or cable. Press Start over, unplug and replug the StackChan, then choose Install without a backup. The firmware now on it will be replaced and cannot be restored from Home." })}</p> : null}
          {choosing && updating ? <>
            <p>{portHelp()}</p>
            <p><strong>{i18n._({ id: "Update firmware.", message: "Update firmware." })}</strong> {i18n._({ id: "Writes the newest MaiPai firmware, about 1 to 2 minutes. The StackChan keeps its name, Wi-Fi and pairing, so you do not set up its Wi-Fi again.", message: "Writes the newest MaiPai firmware, about 1 to 2 minutes. The StackChan keeps its name, Wi-Fi and pairing, so you do not set up its Wi-Fi again." })}</p>
          </> : null}
          {choosing && !updating ? <>
            <p>{portHelp()}</p>
            <p><strong>{i18n._({ id: "Back up first, then install.", message: "Back up first, then install." })}</strong> {i18n._({ id: "Saves the StackChan's whole memory, then installs. About 6 minutes longer.", message: "Saves the StackChan's whole memory, then installs. About 6 minutes longer." })}</p>
            <p><strong>{i18n._({ id: "Install without a backup.", message: "Install without a backup." })}</strong> {i18n._({ id: "Faster, about 1 to 2 minutes. The firmware now on the StackChan is replaced and cannot be restored from Home.", message: "Faster, about 1 to 2 minutes. The firmware now on the StackChan is replaced and cannot be restored from Home." })}</p>
          </> : null}
          {working ? <><p>{stage ? stageLabel(stage) : i18n._({ id: "Preparing", message: "Preparing" })}</p><JobProgress presentation="card" {...downloadProgress({ title: i18n._({ id: "StackChan", message: "StackChan" }), state: "running", status: stage ? stageLabel(stage) : i18n._({ id: "Preparing", message: "Preparing" }), percent: progress })} variant="full" />{stageNote ? <p>{stageNote}</p> : null}</> : null}
          {installFinished && deviceId && !online && !onlineFailed ? <p>{i18n._({ id: "On a phone, join the robot's Wi-Fi hotspot and choose your home Wi-Fi. Home never asks for the Wi-Fi password.", message: "On a phone, join the robot's Wi-Fi hotspot and choose your home Wi-Fi. Home never asks for the Wi-Fi password." })}</p> : null}
          {onlineFailed ? <Alert variant="destructive"><AlertDescription>{onlineMessage()}</AlertDescription></Alert> : null}
          {online ? <p>{i18n._({ id: "The robot is online.", message: "The robot is online." })}</p> : null}
          {lines.length > 0 ? <details><summary>{i18n._({ id: "Show details", message: "Show details" })}</summary><pre className="max-h-48 overflow-auto whitespace-pre-wrap text-base">{lines.join("\n")}</pre></details> : null}
          <DialogFooter>
            {stalledInBackup && !working ? <Button onClick={startOver}>{i18n._({ id: "Start over", message: "Start over" })}</Button> : null}
            {canStop ? <Button variant="outline" onClick={stopInstall}>{i18n._({ id: "Stop", message: "Stop" })}</Button> : null}
            {onlineFailed ? <Button onClick={retryOnline}>{i18n._({ id: "Retry", message: "Retry" })}</Button> : null}
            {choosing && updating ? <Button onClick={() => void startInstall(true)}>{i18n._({ id: "Update firmware", message: "Update firmware" })}</Button> : null}
            {choosing && !updating ? <Button variant="outline" onClick={() => void startInstall(true)}>{i18n._({ id: "Install without a backup", message: "Install without a backup" })}</Button> : null}
            {choosing && !updating ? <Button onClick={() => void startInstall(false)}>{i18n._({ id: "Back up first, then install", message: "Back up first, then install" })}</Button> : null}
            {updateDone && !working ? <Button onClick={() => setOpen(false)}>{i18n._({ id: "Done", message: "Done" })}</Button> : null}
            {message === browserMessage() && !working ? <Button onClick={openDialog}>{i18n._({ id: "Try again", message: "Try again" })}</Button> : null}
            {deviceId && !working && (!installFinished || online || onlineFailed || message) ? <Button onClick={() => setOpen(false)}>{online ? i18n._({ id: "Done", message: "Done" }) : i18n._({ id: "Close", message: "Close" })}</Button> : null}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
