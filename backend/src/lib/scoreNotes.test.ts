import { expect, test } from "bun:test";
import { scoreNotesOf } from "@/lib/scoreJobs";

const note = { start: 0, end: 0.5, pitch: 60, velocity: 80 };
test("the Stack's bare note list is read as the notes", () => { expect(scoreNotesOf([note])).toEqual([note]); });
test("a wrapped note list and junk both still give a list", () => { expect(scoreNotesOf({ notes: [note] })).toEqual([note]); expect(scoreNotesOf(null)).toEqual([]); });
