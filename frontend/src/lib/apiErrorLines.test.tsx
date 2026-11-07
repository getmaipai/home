import { toastError, spyOnToast } from "../../tests/toastSpy";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { cleanup, fireEvent, waitFor } from "@testing-library/react";
import { API_ERROR_LINES, apiError, type ApiErrorLine } from "@maipai/home-backend/src/lib/apiErrorCopy";
import { activateLocale } from "@/i18n";
import { messages as messagesEnUS } from "@/locales/en-US/messages.po";
import { api, ApiError } from "@/lib/api";
import { errorLine } from "@/lib/hubReachability";
import { localizedApiMessage, localizedApiNext } from "@/lib/apiErrorLines";
import { useHubMutation } from "@/lib/useHubMutation";
import { renderWithQueryClient } from "../../tests/renderWithQueryClient";

spyOnToast();
const originalFetch = globalThis.fetch;
beforeEach(() => toastError.mockClear());
afterEach(async () => { cleanup(); globalThis.fetch = originalFetch; await activateLocale("en-US"); });

const lines = API_ERROR_LINES as Record<string, ApiErrorLine>;

/** Make the real client request fail with the body a real backend route builds. */
function failWith(status: number, body: object): void {
  globalThis.fetch = (async () => Response.json(body, { status })) as unknown as typeof fetch;
}
async function caught(run: () => Promise<unknown>): Promise<ApiError> {
  try { await run(); } catch (error) { return error as ApiError; }
  throw new Error("expected the request to fail");
}

describe("API error codes on the client (I18N-B2)", () => {
  test("every line in the server table has its message id in the catalog", () => {
    const catalog = messagesEnUS as Record<string, unknown>;
    const missing = Object.values(lines).flatMap((line) => [line.error, line.next]).filter((part) => part && !(part.id in catalog)).map((part) => part!.id);
    expect(missing).toEqual([]);
  });

  test("English shows the server's own words, and an unknown code or changed text falls back to them", async () => {
    expect(localizedApiMessage(new ApiError("That code didn't match.", 401, "totp_code_mismatch"))).toBe("That code didn't match.");
    await activateLocale("es");
    expect(localizedApiMessage(new ApiError("A brand new sentence.", 400, "a_code_from_a_newer_backend"))).toBe("A brand new sentence.");
    expect(localizedApiMessage(new ApiError("Some other route's text.", 400, "invalid_input"))).toBe("Some other route's text.");
    expect(localizedApiMessage(new ApiError("No code at all.", 400))).toBe("No code at all.");
    expect(localizedApiNext(new ApiError("x", 400, "invalid_input", "A next line an old backend sent."))).toBe("A next line an old backend sent.");
    expect(localizedApiNext(new ApiError("x", 400, "invalid_input"))).toBeUndefined();
  });

  test("a Spanish person sees the Spanish line for three real routes, through the real client", async () => {
    await activateLocale("es");
    const cases: Array<{ status: number; body: object; run: () => Promise<unknown> }> = [
      { status: 401, body: apiError("totp_code_mismatch"), run: () => api.totpChallenge("pending", "000000") },
      { status: 404, body: apiError("no_such_session"), run: () => api.revokeSession("gone") },
      { status: 404, body: apiError("profile_not_found"), run: () => api.profiles() },
    ];
    for (const { status, body, run } of cases) {
      failWith(status, body);
      const error = await caught(run);
      const english = (body as { error: string }).error;
      expect(error.message).toBe(english);
      const shown = errorLine(error);
      expect(shown).not.toBe(english);
      expect(shown.length).toBeGreaterThan(3);
    }
  });

  test("the validation hook's next line is translated when the code and English match", async () => {
    await activateLocale("es");
    const error = new ApiError("name: Required", 400, "invalid_input", "Check the fields named and send it again.");
    expect(localizedApiNext(error)).not.toBe("Check the fields named and send it again.");
    expect(localizedApiMessage(error)).toBe("name: Required");
  });

  test("a failed save toasts the Spanish server line and the Spanish verb fallback", async () => {
    await activateLocale("es");
    function Probe({ error }: { error: unknown }) {
      const mutation = useHubMutation({ verb: "save the alarm", mutationFn: () => Promise.reject(error) });
      return <button onClick={() => void mutation.run()}>Go</button>;
    }
    const coded = renderWithQueryClient(<Probe error={new ApiError(apiError("no_such_session").error, 404, "no_such_session")} />);
    fireEvent.click(coded.getByRole("button", { name: "Go" }));
    await waitFor(() => expect(toastError).toHaveBeenCalledTimes(1));
    const first = String(toastError.mock.calls[0]?.[0]);
    expect(first).not.toContain("No such session");
    expect(first).not.toContain("Check your connection");
    coded.unmount();
    toastError.mockClear();
    const plain = renderWithQueryClient(<Probe error={new Error("boom")} />);
    fireEvent.click(plain.getByRole("button", { name: "Go" }));
    await waitFor(() => expect(toastError).toHaveBeenCalledTimes(1));
    const second = String(toastError.mock.calls[0]?.[0]);
    expect(second).not.toContain("Could not save the alarm");
    expect(second.length).toBeGreaterThan(10);
    plain.unmount();
  });
});
