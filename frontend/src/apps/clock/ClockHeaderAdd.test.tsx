import { afterEach, expect, test } from "bun:test";
import { cleanup, render, waitFor } from "@testing-library/react";
import { ClockHeaderAdd } from "@/apps/clock/ClockHeaderAdd";
import { setClockHeaderTab } from "@/apps/clock/clockHeader";

afterEach(cleanup);

test("the Clock header's add button follows the selected tab and says nothing but the button (the title is the shared page title)", async () => {
  const view = render(<ClockHeaderAdd />);
  expect(view.getByRole("button", { name: "Add alarm" })).toBeTruthy();
  expect(view.queryByText("Alarms")).toBeNull();
  setClockHeaderTab("timers");
  expect(await view.findByRole("button", { name: "Add quick timer" })).toBeTruthy();
  setClockHeaderTab("stopwatch");
  await waitFor(() => expect(view.queryByRole("button")).toBeNull());
});
