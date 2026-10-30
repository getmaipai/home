// IMGGEN-UI-01: the picture card in the thread: the kit ImageGeneration with elapsed time and Stop while a picture is
// made, the kit gallery with the Edit button when it is done, the kit ErrorState with Try again when it failed.
import type { ComponentProps } from "react";
import { afterEach, describe, expect, mock, test } from "bun:test";
import { cleanup, fireEvent, waitFor } from "@testing-library/react";
import { renderWithQueryClient } from "../../../tests/renderWithQueryClient";
import { ImageEditContext } from "@maipai/ui/src/elements/attachment.aui";
import { PictureProgressToolRender, PictureToolRender } from "@/apps/chat/chatToolUis";
import { picturesApi, type PictureCard } from "@/lib/picturesApi";

afterEach(cleanup);

const card = (over: Partial<PictureCard> = {}): PictureCard => ({ id: "pic-1", state: "running", percent: 40, label: "Drawing", position: null, stage_label: null, eta_seconds: null, step: null, steps: null, preview_url: null, preview_step: null, elapsed_ms: 3_000, prompt: "a red fox", kind: "generate", conversation_id: "conv-1", error: null, files: [], can_vary: false, quality: "quick", switch_to: null, size: "1024x1024", stop_id: "pic-1", ...over });
const FILE = { id: "file-1", url: "https://example.test/api/image-edit/pictures/file-1?conversation_id=conv-1", width: 1024, height: 1024, seed: 7, model: "flux2-klein-4b", steps: 4, ms: 3900, alt: "a red fox" };
const props = { toolCallId: "t", toolName: "picture", args: {}, argsText: "{}", result: { id: "pic-1" }, isError: false, status: { type: "complete" }, addResult: () => undefined, resume: () => undefined } as unknown as ComponentProps<typeof PictureToolRender>;

function stub(data: PictureCard) {
  const original = { ...picturesApi };
  picturesApi.card = mock(async () => data);
  picturesApi.stop = mock(async () => card({ state: "cancelled" }));
  picturesApi.again = mock(async () => card());
  return () => Object.assign(picturesApi, original);
}

describe("the picture card", () => {
  test("while a picture is made it shows the progress card with the engine's line, elapsed seconds and a Stop that stops what is running", async () => {
    const restore = stub(card({ stop_id: "pic-2" }));
    const v = renderWithQueryClient(<PictureProgressToolRender {...props} />);
    await waitFor(() => expect(v.container.querySelector('[data-slot="image-generation"]')).toBeTruthy());
    expect(v.container.querySelector('[data-slot="job-progress"]')).toBeNull();
    expect(v.getByText("Drawing")).toBeTruthy();
    expect(v.getByText("1024 × 1024")).toBeTruthy();
    expect(v.getByRole("progressbar")).toBeTruthy();
    expect(v.getByText(/\ds$/)).toBeTruthy();
    fireEvent.click(v.getByRole("button", { name: "Stop" }));
    await waitFor(() => expect(picturesApi.stop).toHaveBeenCalledWith("pic-2"));
    restore();
  });

  test("GENPREVIEW-01: the card shows the engine's step in words and the time left, and the latest preview in the kit card, blurred by the step", async () => {
    const realImage = globalThis.Image;
    (globalThis as { Image: unknown }).Image = class { onload: (() => void) | null = null; onerror: (() => void) | null = null; set src(_v: string) { queueMicrotask(() => this.onload?.()); } };
    const restore = stub(card({ label: "Drawing, step 2 of 4", stage_label: "Drawing, step 2 of 4", eta_seconds: 3, step: 1, steps: 4, preview_url: "/api/pictures/jobs/pic-1/preview?v=1", preview_step: 1 }));
    try {
      const v = renderWithQueryClient(<PictureProgressToolRender {...props} />);
      await waitFor(() => expect(v.container.querySelector("img[data-slot=generation-preview]")).not.toBeNull());
      const img = v.container.querySelector("img[data-slot=generation-preview]") as HTMLImageElement;
      expect(img.getAttribute("src")).toBe("/api/pictures/jobs/pic-1/preview?v=1");
      expect(img.getAttribute("data-blur")).toBe("8");
      expect(v.getByText("Drawing, step 2 of 4")).toBeTruthy();
      expect(v.getByText("almost done")).toBeTruthy();
    } finally {
      restore();
      (globalThis as { Image: unknown }).Image = realImage;
    }
  });

  test("a finished picture has an always-visible Edit button that opens the editor", async () => {
    const restore = stub(card({ state: "done", percent: 100, files: [FILE] }));
    const onEdit = mock((_target: { id: string; name: string; src: string }) => undefined);
    const v = renderWithQueryClient(
      <ImageEditContext.Provider value={{ onEdit, label: "Edit picture", canEdit: () => true }}><PictureToolRender {...props} /></ImageEditContext.Provider>,
    );
    await waitFor(() => expect(v.getByRole("button", { name: "Edit" })).toBeTruthy());
    fireEvent.click(v.getByRole("button", { name: "Edit" }));
    expect(onEdit).toHaveBeenCalledWith({ id: "file-1", name: "a red fox", src: FILE.url });
    restore();
  });

  test("a picture the person may not edit has no Edit button", async () => {
    const restore = stub(card({ state: "done", percent: 100, files: [FILE] }));
    const v = renderWithQueryClient(<ImageEditContext.Provider value={{ onEdit: () => undefined, label: "Edit picture", canEdit: () => false }}><PictureToolRender {...props} /></ImageEditContext.Provider>);
    await waitFor(() => expect(v.container.querySelector('[data-slot="image-gallery"]')).toBeTruthy());
    expect(v.queryByRole("button", { name: "Edit" })).toBeNull();
    expect(v.queryByRole("button", { name: "Edit picture" })).toBeNull();
    restore();
  });

  test("IMGGEN-QUALITY-01: a Quick picture offers 'Make it Boost' with a plain hint; pressing it asks for the Detailed version; a Detailed picture offers Quick; a styled one offers nothing", async () => {
    const restore = stub(card({ state: "done", percent: 100, files: [FILE], can_vary: true, quality: "quick", switch_to: "detailed" }));
    const v = renderWithQueryClient(<PictureToolRender {...props} />);
    await waitFor(() => expect(v.getByRole("button", { name: "Make it Boost" })).toBeTruthy());
    expect(v.getByText("More detail, a little slower")).toBeTruthy();
    expect(v.container.textContent).not.toMatch(/z-image|klein/i);
    fireEvent.click(v.getByRole("button", { name: "Make it Boost" }));
    await waitFor(() => expect(picturesApi.again).toHaveBeenCalledWith("pic-1", "detailed"));
    restore();
    cleanup();
    const restoreQuick = stub(card({ state: "done", percent: 100, files: [FILE], can_vary: true, quality: "detailed", switch_to: "quick" }));
    const d = renderWithQueryClient(<PictureToolRender {...props} />);
    await waitFor(() => expect(d.getByRole("button", { name: "Make it Standard" })).toBeTruthy());
    restoreQuick();
    cleanup();
    const restoreStyled = stub(card({ state: "done", percent: 100, files: [FILE], can_vary: true, quality: "quick", switch_to: null }));
    const none = renderWithQueryClient(<PictureToolRender {...props} />);
    await waitFor(() => expect(none.container.querySelector('[data-slot="image-gallery"]')).toBeTruthy());
    expect(none.queryByRole("button", { name: /Make it/ })).toBeNull();
    restoreStyled();
  });

  test("the progress part draws nothing once the picture is done, and the picture part draws nothing while it is made", async () => {
    const restoreDone = stub(card({ state: "done", percent: 100, files: [FILE] }));
    const progress = renderWithQueryClient(<PictureProgressToolRender {...props} />);
    await waitFor(() => expect(picturesApi.card).toHaveBeenCalled());
    expect(progress.container.querySelector('[data-slot="image-generation"]')).toBeNull();
    cleanup();
    restoreDone();
    const restoreRunning = stub(card());
    const picture = renderWithQueryClient(<PictureToolRender {...props} />);
    await waitFor(() => expect(picturesApi.card).toHaveBeenCalled());
    expect(picture.container.querySelector('[data-slot="image-gallery"]')).toBeNull();
    restoreRunning();
  });

  test("a failed picture says what happened in the engine's words and offers Try again", async () => {
    const restore = stub(card({ state: "failed", error: "I couldn't make that picture. The picture model ran out of memory. Try again or change the request." }));
    const v = renderWithQueryClient(<PictureToolRender {...props} />);
    await waitFor(() => expect(v.getByText(/ran out of memory/)).toBeTruthy());
    fireEvent.click(v.getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(picturesApi.again).toHaveBeenCalledWith("pic-1"));
    restore();
  });

});
