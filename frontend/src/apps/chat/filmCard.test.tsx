import { afterEach, describe, expect, mock, test } from "bun:test";
import type { ComponentProps } from "react";
import { cleanup, fireEvent, waitFor } from "@testing-library/react";
import { renderWithQueryClient } from "../../../tests/renderWithQueryClient";
import { FilmPlayerToolRender, FilmToolRender } from "@/apps/chat/chatToolUis";
import { filmsApi, type FilmProgress } from "@/lib/filmsApi";
import { toolCallPart } from "@/apps/chat/chatToolCallPart";
import { rowsToBranchableMessages } from "@/apps/chat/chatHistoryAdapter";

afterEach(cleanup);
const plan = { title: "Moon Boat", summary: "A small boat sails to the moon.", shots: [{ id: "s1", still: "A blue boat under the stars", framing: "wide", motion: "sails", seconds: 4 }, { id: "s2", still: "The boat reaches the moon", framing: "close", motion: "lands", seconds: 4 }] };
const progress = (over: Partial<FilmProgress> = {}): FilmProgress => ({ id: "film-1", state: "running", stage: "Clips", done_steps: 3, total_steps: 10, plan, film_file_id: null, note: null, error_line: null, production_id: "p1", ...over });
const props = { toolCallId: "t", toolName: "film", args: {}, argsText: "{}", result: { id: "film-1" }, isError: false, status: { type: "complete" }, addResult: () => undefined, resume: () => undefined } as unknown as ComponentProps<typeof FilmToolRender>;

describe("film chat part", () => {
  test("the turn value is shaped as a film tool part", () => {
    expect(toolCallPart("turn-film", "film", { id: "film-1" })).toMatchObject({ type: "tool-call", toolName: "film", result: { id: "film-1" } });
  });

  test("history rows with film data rebuild the same tool part", () => {
    const row = { id: "turn-1", personId: "p1", surface: "chat", userText: "make a film", replyText: "Here it is.", source: "model", pluginId: null, commandId: null, safetyFlagged: false, safetyAction: "allow", minorSpeaker: false, createdAt: "2026-11-06T00:00:00.000Z", supersedes: null, judgeStatus: null, memory_ids: [], film: { id: "film-1" } };
    const turn = rowsToBranchableMessages([row as never], "Sage", "conv-1");
    expect(turn[0]!.reply.message.content).toContainEqual(expect.objectContaining({ type: "tool-call", toolName: "film", result: { id: "film-1" } }));
    expect(turn[0]!.reply.message.content).toContainEqual(expect.objectContaining({ type: "tool-call", toolName: "film-player", result: { id: "film-1" } }));
  });

  test("running shows the active stage and Cancel calls its route", async () => {
    const old = { ...filmsApi };
    filmsApi.get = mock(async () => progress());
    filmsApi.cancel = mock(async () => progress({ state: "cancelled" }));
    const view = renderWithQueryClient(<FilmToolRender {...props} />);
    await waitFor(() => expect(view.container.textContent).toContain("Clips"));
    fireEvent.click(view.getByRole("button", { name: /Cancel/ }));
    await waitFor(() => expect(filmsApi.cancel).toHaveBeenCalledWith("film-1"));
    Object.assign(filmsApi, old);
  });

  test("a plan waits for Go, which calls the go route", async () => {
    const old = { ...filmsApi };
    filmsApi.get = mock(async () => progress({ state: "waiting_for_go", stage: null }));
    filmsApi.go = mock(async () => progress());
    const view = renderWithQueryClient(<FilmToolRender {...props} />);
    await waitFor(() => expect(view.getByText("A small boat sails to the moon.")).toBeTruthy());
    fireEvent.click(view.getByRole("button", { name: "Go" }));
    await waitFor(() => expect(filmsApi.go).toHaveBeenCalledWith("film-1"));
    Object.assign(filmsApi, old);
  });

  test("a failure shows its line and Resume calls resume", async () => {
    const old = { ...filmsApi };
    filmsApi.get = mock(async () => progress({ state: "failed", error_line: "The music step stopped." }));
    filmsApi.resume = mock(async () => progress());
    const view = renderWithQueryClient(<FilmToolRender {...props} />);
    await waitFor(() => expect(view.getByText("The music step stopped.")).toBeTruthy());
    fireEvent.click(view.getByRole("button", { name: "Resume" }));
    await waitFor(() => expect(filmsApi.resume).toHaveBeenCalledWith("film-1"));
    Object.assign(filmsApi, old);
  });

  test("done plays the saved file and exposes redo and music actions", async () => {
    const old = { ...filmsApi };
    filmsApi.get = mock(async () => progress({ state: "done", stage: null, film_file_id: "file-1" }));
    filmsApi.redoShot = mock(async () => progress({ state: "running" }));
    filmsApi.music = mock(async () => progress({ state: "running" }));
    const view = renderWithQueryClient(<FilmPlayerToolRender {...props} />);
    await waitFor(() => expect(view.container.querySelector("video")?.getAttribute("src")).toBe("/api/files/file-1/content"));
    fireEvent.click(view.getByRole("button", { name: "Redo a shot 1" }));
    await waitFor(() => expect(filmsApi.redoShot).toHaveBeenCalledWith("film-1", "s1"));
    fireEvent.click(view.getByRole("button", { name: "Change the music" }));
    await waitFor(() => expect(filmsApi.music).toHaveBeenCalledWith("film-1"));
    Object.assign(filmsApi, old);
  });

  test("done progress part is null and unknown run uses JobProgress", async () => {
    const old = { ...filmsApi };
    filmsApi.get = mock(async () => progress({ state: "done", film_file_id: "file-1" }));
    const done = renderWithQueryClient(<FilmToolRender {...props} />);
    await waitFor(() => expect(done.container.querySelector("[data-slot='job-progress']")).toBeNull(), { timeout: 5000 });
    done.unmount();
    filmsApi.get = mock(async () => { throw new Error("404"); });
    const view = renderWithQueryClient(<FilmToolRender {...props} />);
    await waitFor(() => expect(view.container.textContent).toContain("I couldn't find this film."), { timeout: 5000 });
    Object.assign(filmsApi, old);
  });
});
