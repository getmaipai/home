import { useState } from "react";
import { useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { Section } from "@maipai/ui/src/primitives/Section";
import { AsyncState } from "@maipai/ui/src/primitives/AsyncState";
import { Badge } from "@maipai/ui/src/ui/badge";
import { Input } from "@maipai/ui/src/ui/input";
import { Button } from "@maipai/ui/src/ui/button";
import { api, ApiError, type DeviceInfo } from "@/lib/api";
import { NO_VENDOR_LOGIN } from "./capabilityLabels";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@maipai/ui/src/ui/dialog";
import { Item, ItemContent, ItemTitle } from "@maipai/ui/src/dashboard/components/ui/item";
import { ItemGroup } from "@maipai/ui/src/dashboard/components/ui/item";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@maipai/ui/src/ui/select";

// ROBOT-DEVICE-01: "the add flow refuses to finish while the unit's
// published default SSH password stands and rotates it into the
// credentials center." Rotation still can't happen automatically the
// moment the device row appears - it needs the admin to type the
// vendor's own published default, which this hub never stores or
// guesses - but AddRobotSection now embeds this exact row, defaulted
// open, right after a fresh pairing, so the add flow doesn't consider
// itself finished until this succeeds. This standalone section (a
// household-wide list, one row per already-paired robot) is what an
// admin uses to rotate again later, or to catch a robot that was
// somehow paired without going through that flow.
export function RobotPasswordRow({
  device,
  defaultOpen = false,
  onRotated,
}: {
  device: DeviceInfo;
  defaultOpen?: boolean;
  onRotated?: () => void;
}) {
  const queryClient = useQueryClient();
  const statusQuery = useQuery({
    queryKey: ["robot-password-status", device.id],
    queryFn: () => api.robotPasswordStatus(device.id),
  });

  const [open, setOpen] = useState(defaultOpen);
  const [host, setHost] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleRotate() {
    setError(null);
    setSubmitting(true);
    try {
      await api.rotateRobotPassword(device.id, host.trim(), currentPassword.trim());
      setOpen(false);
      setHost("");
      setCurrentPassword("");
      await queryClient.invalidateQueries({ queryKey: ["robot-password-status", device.id] });
      onRotated?.();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not rotate the password.");
    } finally {
      setSubmitting(false);
    }
  }

  const rotated = statusQuery.data?.rotated ?? false;

  return (
    <div className="flex min-w-0 flex-1 flex-col gap-2 py-1">
      <div className="flex items-center gap-2">
        <span className="truncate text-base font-medium">{device.name}</span>
        {statusQuery.data ? (
          <Badge variant={rotated ? "secondary" : "destructive"}>
          {rotated ? "Set" : "Not set"}
          </Badge>
        ) : null}
      </div>

      {open ? (
        <div className="flex max-w-sm flex-col gap-2">
          <Input
            placeholder="Robot's LAN address"
            value={host}
            onChange={(e) => setHost(e.target.value)}
            disabled={submitting}
          />
          <Input
            type="password"
            // A code review (2026-09-27) found re-pairing a
            // revoked-and-rediscovered robot could never complete: its
            // rotated password was orphaned under the deleted device
            // row, so this field demanded a vendor default that no
            // longer worked. The server now tries this device's own
            // stored credential, then the most recent one rotated at
            // this same host, before ever needing what's typed here -
            // left blank on a re-pair or a plain re-rotation, only
            // required for a genuinely new or factory-reset unit.
            placeholder="Current password (leave blank to try the last one used)"
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
            disabled={submitting}
          />
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
          <div className="flex gap-2">
            <Button onClick={handleRotate} disabled={submitting || !host.trim()}>
              {submitting ? "Rotating…" : "Rotate"}
            </Button>
            <Button variant="ghost" onClick={() => setOpen(false)} disabled={submitting}>
              Cancel
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function RobotPasswordSection() {
  // Household-wide (api.robotDevices(), not api.devices()): Quick Connect
  // mints a robot's device under whichever admin approved the pairing, so
  // a different admin still needs to see it here to rotate its password.
  const devicesQuery = useQuery<DeviceInfo[]>({ queryKey: ["robot-devices"], queryFn: () => api.robotDevices() });
  // ROBOT-PAIR-02: a body that reports no_vendor_login has no published password to rotate.
  const robots = (devicesQuery.data ?? []).filter((d) => !d.capabilities.includes(NO_VENDOR_LOGIN));

  if (devicesQuery.isFetching && !devicesQuery.data) return null;
  if (robots.length === 0) return null;

  return (
    <Section heading="Robot password">
      <AsyncState
        data={robots}
        error={devicesQuery.isError}
        isFetching={false}
        onRetry={() => devicesQuery.refetch()}
        errorMessage="Could not load your robots."
        loadingLabel="Loading"
      >
        {(rows) => <PasswordDialogRow devices={rows} />}
      </AsyncState>
    </Section>
  );
}

function PasswordDialogRow({ devices }: { devices: DeviceInfo[] }) {
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState(devices[0]!.id);
  const statusQueries = useQueries({ queries: devices.map((device) => ({ queryKey: ["robot-password-status", device.id], queryFn: () => api.robotPasswordStatus(device.id) })) });
  const notSet = statusQueries.some((query) => query.data?.rotated === false);
  const ready = statusQueries.every((query) => query.data !== undefined);
  return <><ItemGroup variant="card" aria-label="Robot password"><Item size="setting"><ItemContent><ItemTitle>Robot password</ItemTitle></ItemContent><Badge variant={notSet ? "destructive" : "secondary"}>{ready ? (notSet ? "Not set" : "Set") : "Checking"}</Badge><Button size="lg" variant="outline" onClick={() => setOpen(true)}>Change</Button></Item></ItemGroup><Dialog open={open} onOpenChange={setOpen}><DialogContent><DialogHeader><DialogTitle>Change robot password</DialogTitle><DialogDescription>Use the password printed in the robot's setup guide.</DialogDescription></DialogHeader>{devices.length > 1 ? <Select value={selected} onValueChange={setSelected}><SelectTrigger aria-label="Robot"><SelectValue /></SelectTrigger><SelectContent>{devices.map((robot) => <SelectItem key={robot.id} value={robot.id}>{robot.name}</SelectItem>)}</SelectContent></Select> : null}<RobotPasswordRow key={selected} device={devices.find((robot) => robot.id === selected) ?? devices[0]!} defaultOpen /></DialogContent></Dialog></>;
}
