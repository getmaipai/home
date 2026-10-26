// PERUSE-2026-10-25: the consent card shows the exact prompt with Consent and Decline, sends the click, and replaces the picture
// progress card while the picture is held.
import type { ComponentProps } from "react";
import { afterEach, describe, expect, mock, test } from "bun:test";
import { cleanup, fireEvent, waitFor } from "@testing-library/react";
import { renderWithQueryClient } from "../../../tests/renderWithQueryClient";
import { LikenessAskToolRender } from "@/apps/chat/chatToolUis";
import { LikenessAsks } from "@/apps/settings/PicturesLibrary";
import { likenessAsksApi, type LikenessAsk } from "@/lib/likenessAsksApi";
import { picturesApi, type PictureCard } from "@/lib/picturesApi";

afterEach(cleanup);

const PROMPT = "Iris on a beach at sunset, golden light";
const ask = (over: Partial<LikenessAsk> = {}): LikenessAsk => ({ id: "ask-1", state: "waiting", medium: "picture", count: 1, style_name: "Iris", requester_name: "Sage", subject_name: "Iris", prompt: PROMPT, expires_at: null, created_at: "2026-10-26T12:00:00.000Z", decided_at: null, as: "subject", ...over });

function stub(data: LikenessAsk) {
  const original = { ...likenessAsksApi };
  likenessAsksApi.get = mock(async () => data);
  likenessAsksApi.list = mock(async () => ({ asks: [data] }));
  likenessAsksApi.decide = mock(async () => ({ state: "approved" as const }));
  return () => Object.assign(likenessAsksApi, original);
}

const heldCard = (over: Partial<PictureCard> = {}): PictureCard => ({ id: "pic-1", state: "queued", percent: 0, label: "Waiting for the person pictured to say yes. It starts as soon as they do.", position: null, stage_label: null, eta_seconds: null, step: null, steps: null, preview_url: null, preview_step: null, elapsed_ms: 1_000, prompt: PROMPT, kind: "generate", conversation_id: "conv-1", error: null, files: [], can_vary: false, quality: "quick", switch_to: null, size: "1024x1024", stop_id: "pic-1", likeness_ask_id: "ask-1", ...over });
const toolProps = { toolCallId: "t", toolName: "likeness_ask", args: {}, argsText: "{}", result: { kind: "picture", id: "pic-1" }, isError: false, status: { type: "complete" }, addResult: () => undefined, resume: () => undefined } as unknown as ComponentProps<typeof LikenessAskToolRender>;
function LikenessAskCard(_: { askId: string }) { return <LikenessAskToolRender {...toolProps} />; }
const originalPictures = { ...picturesApi };
const holdPicture = () => { picturesApi.card = mock(async () => heldCard()); };
afterEach(() => { Object.assign(picturesApi, originalPictures); });

describe("the consent card", () => {
  test("shows who asks, the exact prompt, the count, the style and the adult-content line, with Consent and Decline", async () => {
    holdPicture();
    const restore = stub(ask());
    const v = renderWithQueryClient(<LikenessAskCard askId="ask-1" />);
    await waitFor(() => expect(v.getByText(PROMPT)).toBeTruthy());
    expect(v.getByText("Sage wants to make a picture that looks like you")).toBeTruthy();
    expect(v.getByText(/1 picture, with your saved style\. It includes adult content\./)).toBeTruthy();
    expect(v.getByRole("button", { name: "Consent" })).toBeTruthy();
    expect(v.getByRole("button", { name: "Decline" })).toBeTruthy();
    expect(v.queryByRole("button", { name: "Allow once" })).toBeNull();
    restore();
  });

  test("Consent and Decline each send one decision", async () => {
    holdPicture();
    const restore = stub(ask());
    const v = renderWithQueryClient(<LikenessAskCard askId="ask-1" />);
    await waitFor(() => v.getByRole("button", { name: "Consent" }));
    fireEvent.click(v.getByRole("button", { name: "Consent" }));
    await waitFor(() => expect(likenessAsksApi.decide).toHaveBeenCalledWith("ask-1", "consent"));
    cleanup();
    const again = renderWithQueryClient(<LikenessAskCard askId="ask-1" />);
    await waitFor(() => again.getByRole("button", { name: "Decline" }));
    fireEvent.click(again.getByRole("button", { name: "Decline" }));
    await waitFor(() => expect(likenessAsksApi.decide).toHaveBeenCalledWith("ask-1", "decline"));
    restore();
  });

  test("an ended ask shows the plain outcome, no buttons and no prompt", async () => {
    holdPicture();
    const restore = stub(ask({ state: "declined", prompt: null }));
    const v = renderWithQueryClient(<LikenessAskCard askId="ask-1" />);
    await waitFor(() => expect(v.getByText("Iris said no. Nothing was made.")).toBeTruthy());
    expect(v.queryByRole("button", { name: "Consent" })).toBeNull();
    expect(v.queryByText(PROMPT)).toBeNull();
    restore();
  });

  test("a video ask says video", async () => {
    holdPicture();
    const restore = stub(ask({ medium: "video", count: 1 }));
    const v = renderWithQueryClient(<LikenessAskCard askId="ask-1" />);
    await waitFor(() => expect(v.getByText("Sage wants to make a video that looks like you")).toBeTruthy());
    restore();
  });
});

describe("the asks list in settings", () => {
  test("an open ask about you is the same card with the same buttons; ended ones are plain lines", async () => {
    const restore = stub(ask());
    likenessAsksApi.list = mock(async () => ({ asks: [ask(), ask({ id: "ask-2", state: "declined", prompt: null })] }));
    const v = renderWithQueryClient(<LikenessAsks />);
    await waitFor(() => expect(v.getByRole("button", { name: "Consent" })).toBeTruthy());
    expect(v.getByText(PROMPT)).toBeTruthy();
    expect(v.getByText(/Sage asked for a picture that looks like you: you said no\./)).toBeTruthy();
    fireEvent.click(v.getByRole("button", { name: "Decline" }));
    await waitFor(() => expect(likenessAsksApi.decide).toHaveBeenCalledWith("ask-1", "decline"));
    restore();
  });
});
