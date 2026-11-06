// TIER-PRIO-07: a held job that asks "run it lower now?" shows two buttons on its picture, video and song card, and each calls the route.
import type { ComponentProps } from "react";
import { afterEach, describe, expect, mock, test } from "bun:test";
import { cleanup, fireEvent, waitFor } from "@testing-library/react";
import { renderWithQueryClient } from "../../../tests/renderWithQueryClient";
import { PictureProgressToolRender } from "@/apps/chat/chatToolUis";
import { picturesApi, type PictureCard } from "@/lib/picturesApi";
import { fitAskApi, fitAskActions } from "@/lib/fitAsk";

afterEach(cleanup);

const base = { id: "pic-1", state: "queued", percent: 0, label: "Max is not ready right now. Pick below.", position: 1, stage_label: null, eta_seconds: null, step: null, steps: null, preview_url: null, preview_step: null, elapsed_ms: 1000, prompt: "a red fox", kind: "generate", conversation_id: "c1", error: null, files: [], can_vary: false, quality: "quick", switch_to: null, size: "1024x1024", stop_id: "pic-1", adult: null } as PictureCard;
const props = { toolCallId: "t", toolName: "picture", args: {}, argsText: "{}", result: { id: "pic-1" }, isError: false, status: { type: "complete" }, addResult: () => undefined, resume: () => undefined } as unknown as ComponentProps<typeof PictureProgressToolRender>;

function stub(data: PictureCard, answer: () => Promise<{ answered: boolean }> = async () => ({ answered: true })) {
  const original = { ...picturesApi }; const answerOriginal = fitAskApi.answer;
  picturesApi.card = mock(async () => data);
  fitAskApi.answer = mock(answer) as typeof fitAskApi.answer;
  return () => { Object.assign(picturesApi, original); fitAskApi.answer = answerOriginal; };
}

describe("the question buttons on a held job", () => {
  test("a queued picture that asks shows both buttons; each sends its answer and the card reloads", async () => {
    const restore = stub({ ...base, fit_ask: { job_id: "pic-1", picked: "Max", actual: "Standard" } });
    const v = renderWithQueryClient(<PictureProgressToolRender {...props} />);
    await waitFor(() => expect(v.getByRole("button", { name: "Make it now with Standard" })).toBeTruthy());
    expect(v.getByText(/Max is not ready right now/)).toBeTruthy();
    fireEvent.click(v.getByRole("button", { name: "Make it now with Standard" }));
    await waitFor(() => expect(fitAskApi.answer).toHaveBeenCalledWith("pic-1", "allow"));
    fireEvent.click(v.getByRole("button", { name: "Wait for Max" }));
    await waitFor(() => expect(fitAskApi.answer).toHaveBeenCalledWith("pic-1", "wait"));
    await waitFor(() => expect((picturesApi.card as ReturnType<typeof mock>).mock.calls.length).toBeGreaterThan(2));
    restore();
  });

  test("no question, no buttons: a queued picture without fit_ask and a running one show none", async () => {
    const restore = stub({ ...base, fit_ask: null });
    const v = renderWithQueryClient(<PictureProgressToolRender {...props} />);
    await waitFor(() => expect(v.container.querySelector('[data-slot="image-generation"]')).toBeTruthy());
    expect(v.queryByRole("button", { name: "Wait for Max" })).toBeNull();
    restore();
    const running = stub({ ...base, state: "running", fit_ask: { job_id: "pic-1", picked: "Max", actual: "Standard" } });
    const w = renderWithQueryClient(<PictureProgressToolRender {...props} />);
    await waitFor(() => expect(w.container.querySelectorAll('[data-slot="image-generation"]').length).toBeGreaterThan(0));
    expect(w.queryByRole("button", { name: "Wait for Max" })).toBeNull();
    running();
  });

  test("fitAskActions is undefined without a question and the labels are the two plain answers", () => {
    expect(fitAskActions(null, () => {})).toBeUndefined();
    expect(fitAskActions({ job_id: "x", picked: "Max", actual: "Standard" }, () => {})!.map((a) => a.label)).toEqual(["Make it now with Standard", "Wait for Max"]);
  });
});
