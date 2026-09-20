// Registers a real DOM (happy-dom) for `bun test` inside scripts/ -
// the same shape frontend/tests/preload.ts uses, minimal because this
// area has no React components to render, only DOM-API-only helpers
// like panelOverflow.ts that Playwright's page.evaluate() also runs
// against a real browser.
import { GlobalRegistrator } from "@happy-dom/global-registrator";

GlobalRegistrator.register();
