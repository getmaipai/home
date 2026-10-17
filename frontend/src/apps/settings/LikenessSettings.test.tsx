// LIKENESS-01: the person's own page: what agreeing means, the "Likeness use" log and their dated answers.
import { afterEach, describe, expect, mock, test } from "bun:test";
import { cleanup, waitFor } from "@testing-library/react";
import { renderWithQueryClient } from "../../../tests/renderWithQueryClient";
import { LikenessSettings } from "@/apps/settings/LikenessSettings";
import { likenessApi, type LikenessMe } from "@/lib/likenessApi";

afterEach(cleanup);
const me = (over: Partial<LikenessMe> = {}): LikenessMe => ({ eligible: true, adults: true, adult_content: false, history: [], uses: [], ...over });
function mount(data: LikenessMe) {
  const original = { ...likenessApi };
  likenessApi.me = mock(async () => data);
  const view = renderWithQueryClient(<LikenessSettings />);
  return { ...view, restore: () => Object.assign(likenessApi, original) };
}

describe("Likeness use", () => {
  test("says what agreeing means in plain words, including that it can be taken back at once", async () => {
    const v = mount(me());
    await waitFor(() => expect(v.getByText("What turning this on means")).toBeTruthy());
    expect(v.getByText(/it stops right away/)).toBeTruthy();
    expect(v.getByText(/never turned into adult content/)).toBeTruthy();
    expect(v.getByText("Nobody has made anything that looks like you.")).toBeTruthy();
    v.restore();
  });
  test("lists each use with who and what kind, and the person's own dated answers", async () => {
    const v = mount(me({
      uses: [{ id: "lu-1", who: "Nadia", medium: "video", way: "photo", adult_content: false, used_at: "2026-10-17T15:20:00Z", line: "Nadia made a video from a photo of you." }],
      history: [{ id: "lc-1", option: "adults", state: "on", changed_at: "2026-10-17T14:02:00Z" }],
    }));
    await waitFor(() => expect(v.getByText("Nadia made a video from a photo of you.")).toBeTruthy());
    expect(v.getByText(/Other adults can make things that look like you: on/)).toBeTruthy();
    v.restore();
  });
  test("a child or teen sees only that it is for adults", async () => {
    const v = mount(me({ eligible: false, adults: false }));
    await waitFor(() => expect(v.getByText(/Only an adult can agree/)).toBeTruthy());
    v.restore();
  });
});
