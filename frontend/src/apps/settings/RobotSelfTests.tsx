import { i18n } from "@lingui/core";
import { useState } from "react";
import { Badge } from "@maipai/ui/src/ui/badge";
import { Button } from "@maipai/ui/src/ui/button";
import { Alert, AlertDescription } from "@maipai/ui/src/ui/alert";
import { api, ApiError, type DeviceInfo } from "@/lib/api";
import { robotSelfTestPartsFor, type RobotSelfTestPart, type RobotSelfTestResult } from "@maipai/home-backend/src/wire";

const labels = (): Record<RobotSelfTestPart, string> => ({ speaker: i18n._({ id: "Speaker", message: "Speaker" }), face: i18n._({ id: "Face", message: "Face" }), head: i18n._({ id: "Head", message: "Head" }), lights: i18n._({ id: "Lights", message: "Lights" }), mic: i18n._({ id: "Microphone", message: "Microphone" }) });

/** ROBOT-ADMIN-PLACE-01: "Test this robot" is an admin action, so it lives in the robot's detail view in Home settings,
 * Devices, not on the Family card. Only the parts the robot reports are offered. */
export function RobotSelfTests({ device }: { device: DeviceInfo }) {
  const unreachable = device.state != null && !device.state.reachable;
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
          : { kind: "error", message: apiError?.message ?? i18n._({ id: "Could not test that part. Reload the page and try again.", message: "Could not test that part. Reload the page and try again." }) } }));
    } finally { setSelfTestBusy(null); }
  }
  return (
    <div data-testid="robot-self-tests">
      <p className="text-base font-medium">{i18n._({ id: "Test this robot", message: "Test this robot" })}</p>
      <div className="mt-2 flex flex-wrap gap-2">
        {robotSelfTestPartsFor(device).map((part) => {
          const result = selfTests[part];
          return <div key={part}>
            <Button variant="outline" disabled={unreachable || selfTestBusy !== null} onClick={() => void runSelfTest(part)}>{selfTestBusy === part ? i18n._({ id: "Testing…", message: "Testing…" }) : labels()[part]}</Button>
            {result && "ok" in result ? <p className="mt-1 text-sm"><Badge variant={result.ok ? "secondary" : "destructive"}>{result.ok ? i18n._({ id: "Passed", message: "Passed" }) : i18n._({ id: "Failed", message: "Failed" })}</Badge>{" "}{i18n._({ id: "{detail} ({took_ms} ms)", message: "{detail} ({took_ms} ms)", values: { detail: result.detail, took_ms: result.took_ms } })}</p> : null}
            {result && "kind" in result && result.kind === "offline" ? <p className="mt-1 text-sm text-muted-foreground">{result.message}</p> : null}
            {result && "kind" in result && (result.kind === "timeout" || result.kind === "error") ? <Alert variant="destructive"><AlertDescription>{result.message}</AlertDescription></Alert> : null}
          </div>;
        })}
      </div>
    </div>
  );
}
