// CAST-CREATE-01: the Create page's Cast and Place pickers send comma-joined ids; they become one cast list (characters, places and props alike).
import { describe, expect, test } from "bun:test";
import { readMakeBody } from "@/lib/videos/make";

describe("readMakeBody cast", () => {
  test("comma-joined cast and place ids become one de-duplicated list, an array still works, empty stays empty", () => {
    const read = (raw: Record<string, unknown>) => readMakeBody({ prompt: "A fox at the cafe", ...raw });
    const a = read({ cast: "msub-1,msub-2", place: "msub-3" }); expect(a.ok && a.body.cast).toEqual(["msub-1", "msub-2", "msub-3"]);
    const b = read({ cast: ["msub-1"], place: "msub-1" }); expect(b.ok && b.body.cast).toEqual(["msub-1"]);
    const c = read({ cast: "", place: "" }); expect(c.ok && c.body.cast).toBeUndefined();
    const d = read({ cast: "msub-9" }); expect(d.ok && d.body.cast).toEqual(["msub-9"]);
  });
});
