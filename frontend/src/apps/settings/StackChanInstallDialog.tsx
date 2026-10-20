import { useEffect, useRef, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@maipai/ui/src/ui/dialog";
import { Button } from "@maipai/ui/src/ui/button";
import { Progress } from "@maipai/ui/src/ui/progress";
import { Alert, AlertDescription } from "@maipai/ui/src/ui/alert";
import { api, ApiError } from "@/lib/api";
import { browserCanFlash, createBrowserSerialTransport, FLASH_BYTES, installStackChan, STALL_TIMEOUT_MESSAGE, type FlashStage, type FlashTransport } from "@/lib/stackchan/flash";

const BROWSER_MESSAGE = "Installing needs Chrome or Edge on a computer, with Home opened at its https address. Open Home there and try again.";
const ONLINE_MESSAGE = "The robot did not reach Home. Check it joined the same Wi-Fi as this hub, then press Retry.";

export function StackChanInstallDialog() {
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
    if (!browserCanFlash(window, navigator)) setMessage(BROWSER_MESSAGE);
  }

  async function startInstall(skipBackup: boolean) {
    setMessage(null);
    setStalledInBackup(false);
    if (!browserCanFlash(window, navigator)) {
      setMessage(BROWSER_MESSAGE);
      return;
    }
    setWorking(true);
    let hostCreated = false;
    try {
      const port = await (navigator as Navigator & { serial: { requestPort(): Promise<unknown> } }).serial.requestPort();
      const transport = createBrowserSerialTransport(port, (line) => setLines((previous) => [...previous.slice(-200), line.trim()].filter(Boolean)));
      transportRef.current = transport;
      const result = await installStackChan(transport, { onStage: (next, completed, total) => {
        setStage(next);
        setCompleted(completed ?? 0);
        setProgress(total && completed !== undefined ? Math.min(100, Math.round(completed / total * 100)) : 0);
      }, onHostCreated: (id) => { hostCreated = true; setDeviceId(id); } }, { skipBackup });
      setDeviceId(result.deviceId);
      setInstallFinished(true);
      setStage(null);
    } catch (error) {
      setStalledInBackup(error instanceof Error && error.message === STALL_TIMEOUT_MESSAGE);
      const detail = error instanceof ApiError ? error.message : error instanceof Error ? error.message : "The StackChan install stopped.";
      setMessage(hostCreated ? `${detail} Use Cancel install on the robot card before starting again.` : `${detail} Check the USB cable and try again.`);
    } finally { transportRef.current = null; setWorking(false); }
  }

  /** Safe only before anything is written. A read that is stuck keeps the USB port busy, so the page reloads to free it. */
  function stopInstall() { void transportRef.current?.close?.(); window.setTimeout(() => window.location.reload(), 1500); }
  const canStop = working && (stage === "Connecting" || stage === "Backing up" || stage === null);
  const stageNote = stage === "Connecting" ? "Connecting to the StackChan. This takes up to 30 seconds."
    : stage === "Backing up" ? `${(completed / (1024 * 1024)).toFixed(1)} of ${FLASH_BYTES / (1024 * 1024)} MB saved. The backup takes about 6 minutes; keep the cable in and this tab open.`
    : stage === "Writing" ? "Writing the MaiPai firmware. Do not unplug the StackChan."
    : null;

  /** A read that stalled leaves the USB port busy, so starting over reloads the page, which frees it. */
  function startOver() { window.location.reload(); }
  const choosing = !deviceId && !working && !installFinished && !stalledInBackup && message !== BROWSER_MESSAGE;

  function retryOnline() { setOnlineFailed(false); }

  return (
    <>
      <Button onClick={openDialog}>Add a StackChan</Button>
      <Dialog open={open} onOpenChange={(next) => { if (!working) setOpen(next); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add a StackChan</DialogTitle>
            <DialogDescription>
              {!installFinished ? "You need Chrome or Edge on a computer, Home opened at its https address, and the StackChan plugged into this computer with a USB-C data cable." : online ? "Your StackChan is online and ready." : "On a phone, join the robot's Wi-Fi hotspot and choose your home Wi-Fi. Home never asks for the Wi-Fi password."}
            </DialogDescription>
          </DialogHeader>
          {message ? <Alert variant="destructive"><AlertDescription>{message}</AlertDescription></Alert> : null}
          {stalledInBackup && !working ? <p>The backup did not work with this computer or cable. Press Start over, unplug and replug the StackChan, then choose Install without a backup. The firmware now on it will be replaced and cannot be restored from Home.</p> : null}
          {choosing ? <>
            <p><strong>Back up first, then install.</strong> Saves the StackChan's whole memory, then installs. About 6 minutes longer.</p>
            <p><strong>Install without a backup.</strong> Faster, about 1 to 2 minutes. The firmware now on the StackChan is replaced and cannot be restored from Home.</p>
          </> : null}
          {working ? <><p>{stage ?? "Preparing"}</p><Progress value={progress} />{stageNote ? <p>{stageNote}</p> : null}</> : null}
          {installFinished && deviceId && !online && !onlineFailed ? <p>On a phone, join the robot's Wi-Fi hotspot and choose your home Wi-Fi. Home never asks for the Wi-Fi password.</p> : null}
          {onlineFailed ? <Alert variant="destructive"><AlertDescription>{ONLINE_MESSAGE}</AlertDescription></Alert> : null}
          {online ? <p>The robot is online.</p> : null}
          {lines.length > 0 ? <details><summary>Show details</summary><pre>{lines.join("\n")}</pre></details> : null}
          <DialogFooter>
            {stalledInBackup && !working ? <Button onClick={startOver}>Start over</Button> : null}
            {canStop ? <Button variant="outline" onClick={stopInstall}>Stop</Button> : null}
            {onlineFailed ? <Button onClick={retryOnline}>Retry</Button> : null}
            {choosing ? <Button variant="outline" onClick={() => void startInstall(true)}>Install without a backup</Button> : null}
            {choosing ? <Button onClick={() => void startInstall(false)}>Back up first, then install</Button> : null}
            {message === BROWSER_MESSAGE && !working ? <Button onClick={openDialog}>Try again</Button> : null}
            {deviceId && !working && (!installFinished || online || onlineFailed || message) ? <Button onClick={() => setOpen(false)}>{online ? "Done" : "Close"}</Button> : null}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
