import { resolve } from "node:path";

// `data/` lives at the repo root (gitignored there, see .gitignore), the
// same place the legacy hub kept it. `MAIPAI_DATA_DIR` overrides it, used by
// tests to point at a throwaway directory instead of the real one.
export const dataDir =
  process.env.MAIPAI_DATA_DIR ?? resolve(process.cwd(), "../data");
