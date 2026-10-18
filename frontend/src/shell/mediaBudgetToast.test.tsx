import { afterEach, expect, test } from "bun:test";
import { useEffect } from "react";
import { cleanup, render, waitFor } from "@testing-library/react";
import { ToastProvider, useToast } from "@maipai/ui/src/primitives/Toast";
import { guardMediaBudget } from "./mediaBudgetGuard";

afterEach(() => cleanup());

const LINE = "Screen time is done for today. Ask a grown-up for more.";

/** The guard's words reach the screen through the shell's one toast (the kit ToastProvider App.tsx mounts), as mediaHost wires it. */
function Guarded({ el }: { el: HTMLMediaElement }) {
  const { push } = useToast();
  useEffect(() => guardMediaBudget(el, {
    fetchBudget: async () => ({ limit_min: 1, used_min: 1, left_min: 0, exhausted: true, line: LINE }),
    notify: push,
    every: () => () => {},
  }), [el, push]);
  return null;
}

test("when time is already up, the kid line shows as a toast", async () => {
  const el = document.createElement("video");
  const { getByText } = render(<ToastProvider><Guarded el={el} /></ToastProvider>);
  await waitFor(() => expect(getByText(LINE)).toBeTruthy());
});
