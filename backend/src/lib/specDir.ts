import { dirname } from "node:path";

/** The installed @maipai/spec package's real directory, resolved through
 * node_modules - never a relative path escaping to the sibling
 * getmaipai/shared checkout, which a deployed build won't have
 * (spec-v0.1.0 moved spec/ out of this repo; see docs/dev.md, "Home
 * pins @maipai/spec"). Every reader of a raw spec/ file (a schema,
 * a vocab list, an llm/ corpus) at runtime or test time should join
 * off this, not hand-roll its own relative depth. */
export const SPEC_DIR = dirname(Bun.resolveSync("@maipai/spec/package.json", import.meta.dir));
