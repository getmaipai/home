import { afterEach, describe, expect, test } from "bun:test";
import { cleanup, render } from "@testing-library/react";
import { RobotBody } from "./RobotBody";
import type { DeviceInfo } from "@/lib/api";

afterEach(cleanup);

const device: DeviceInfo = { id: "robot-1", kind: "robot", name: "StackChan", area: null, lastSeenAt: "2026-10-20T16:00:00.000Z", createdAt: "2026-10-20T15:00:00.000Z", capabilities: [], state: null };

function card(viewerRole: "admin" | "adult", confirmingRemove: boolean) {
  const noop = async () => undefined;
  return render(
    <RobotBody device={device} viewerRole={viewerRole} busy={false} confirmingRemove={confirmingRemove} onRemove={() => {}} onConfirmRemove={() => {}} onCancelRemove={() => {}}
      onSetMuted={noop} onStartLiveView={async () => ({ view_id: "v", stream: "s" })} onStopLiveView={noop} onAnswerMotorReboot={noop} />,
  );
}

describe("RobotBody forget confirmation", () => {
  test("an admin confirms Forget only inside the Settings dialog, never with a second bar on the card", () => {
    const view = card("admin", true);
    expect(view.queryByText(/It will need to be paired again/)).toBeNull();
    expect(view.queryByRole("button", { name: "Yes, remove it" })).toBeNull();
  });

  test("a non-admin still confirms Remove on the card", () => {
    const view = card("adult", true);
    expect(view.getByText(/It will need to be paired again/)).toBeTruthy();
    expect(view.getByRole("button", { name: "Yes, remove it" })).toBeTruthy();
  });
});
