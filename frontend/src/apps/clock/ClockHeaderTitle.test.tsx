import { afterEach, expect, test } from "bun:test";
import { cleanup, render } from "@testing-library/react";
import { ClockHeaderTitle } from "@/apps/clock/ClockHeaderTitle";
import { setClockHeaderTab } from "@/apps/clock/clockHeader";

afterEach(cleanup);

test("the shell clock header follows the selected tab title in its single title slot", async () => {
  const view = render(<ClockHeaderTitle />);
  expect(view.getByText("Alarms")).toBeTruthy();
  setClockHeaderTab("timers");
  expect(await view.findByText("Timers")).toBeTruthy();
});
