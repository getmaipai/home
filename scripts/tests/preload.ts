// Registers a real DOM (happy-dom) for `bun test` inside scripts/ -
// the same shape frontend/tests/preload.ts uses, minimal because this
// area has no React components to render, only DOM-API-only helpers
// like panelOverflow.ts that Playwright's page.evaluate() also runs
// against a real browser.
import "../runTemp";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// HOST-GUARD-09: the scripts under test read the Mac's memory pressure and the host guard's dev-shed flag before heavy work
// (scripts/lib/hostmem.sh). A test sees a calm Mac and an empty guard folder unless it sets its own values.
process.env.MAIPAI_HOSTMEM_PRESSURE ??= "1";
process.env.MAIPAI_HOST_GUARD_STATE_DIR ??= mkdtempSync(join(tmpdir(), "hostguard-none-"));
import { GlobalRegistrator } from "@happy-dom/global-registrator";

GlobalRegistrator.register();
