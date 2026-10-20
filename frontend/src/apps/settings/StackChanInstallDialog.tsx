import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@maipai/ui/src/ui/dialog";
import { Button } from "@maipai/ui/src/ui/button";
import { Progress } from "@maipai/ui/src/ui/progress";
import { Alert, AlertDescription } from "@maipai/ui/src/ui/alert";
import { api, ApiError } from "@/lib/api";
import { browserCanFlash, createBrowserSerialTransport, installStackChan, type FlashStage } from "@/lib/stackchan/flash";

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

  async function startInstall() {
    setMessage(null);
    if (!browserCanFlash(window, navigator)) {
      setMessage(BROWSER_MESSAGE);
      setOpen(true);
      return;
    }
    setOpen(true);
    setWorking(true);
    let hostCreated = false;
    try {
      const port = await (navigator as Navigator & { serial: { requestPort(): Promise<unknown> } }).serial.requestPort();
      const transport = createBrowserSerialTransport(port);
      const result = await installStackChan(transport, { onStage: (next, completed, total) => {
        setStage(next);
        setProgress(total && completed !== undefined ? Math.min(100, Math.round(completed / total * 100)) : 0);
      }, onHostCreated: (id) => { hostCreated = true; setDeviceId(id); } });
      setDeviceId(result.deviceId);
      setInstallFinished(true);
      setStage(null);
    } catch (error) {
      const detail = error instanceof ApiError ? error.message : error instanceof Error ? error.message : "The StackChan install stopped.";
      setMessage(hostCreated ? `${detail} Use Cancel install on the robot card before starting again.` : `${detail} Check the USB cable and try again.`);
    } finally { setWorking(false); }
  }

  function retryOnline() { setOnlineFailed(false); }

  return (
    <>
      <Button onClick={() => void startInstall()}>Add a StackChan</Button>
      <Dialog open={open} onOpenChange={(next) => { if (!working) setOpen(next); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add a StackChan</DialogTitle>
            <DialogDescription>
              {!installFinished ? "Plug the StackChan into this computer with a USB-C data cable, then choose its serial port." : online ? "Your StackChan is online and ready." : "On a phone, join the robot's Wi-Fi hotspot and choose your home Wi-Fi. Home never asks for the Wi-Fi password."}
            </DialogDescription>
          </DialogHeader>
          {message ? <Alert variant="destructive"><AlertDescription>{message}</AlertDescription></Alert> : null}
          {working ? <><p>{stage ?? "Preparing"}</p><Progress value={progress} /></> : null}
          {installFinished && deviceId && !online && !onlineFailed ? <p>On a phone, join the robot's Wi-Fi hotspot and choose your home Wi-Fi. Home never asks for the Wi-Fi password.</p> : null}
          {onlineFailed ? <Alert variant="destructive"><AlertDescription>{ONLINE_MESSAGE}</AlertDescription></Alert> : null}
          {online ? <p>The robot is online.</p> : null}
          <DialogFooter>
            {onlineFailed ? <Button onClick={retryOnline}>Retry</Button> : null}
            {!deviceId && !working ? <Button onClick={() => void startInstall()}>{message === BROWSER_MESSAGE ? "Try again" : "Choose USB port"}</Button> : null}
            {deviceId && !working && (!installFinished || online || onlineFailed || message) ? <Button onClick={() => setOpen(false)}>{online ? "Done" : "Close"}</Button> : null}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
