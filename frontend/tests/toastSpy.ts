import { afterEach, beforeEach, mock, spyOn } from "bun:test";
import { toast } from "sonner";

/** `toast.error` calls, recorded by a spy that is on only while a test runs. Call `spyOnToast()` once at the top level
 * of a test file that asserts a toast. A spy (not mock.module) keeps the real module for every other file in the
 * process (FLAKY-NOTIFBELL-01). */
export const toastError = mock((..._args: unknown[]): string => "toast");
export function spyOnToast() {
  let spy: { mockRestore: () => void } | null = null;
  beforeEach(() => { toastError.mockClear(); spy = spyOn(toast, "error").mockImplementation(toastError as never); });
  afterEach(() => { spy?.mockRestore(); spy = null; });
}
