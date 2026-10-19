import { StrictMode, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { App } from "@/App";
import { installHiddenReloadOnNewServiceWorker, installStaleChunkRetry, runBootWatchdog } from "@/lib/pwaBoot";
import "@/shell/tokens.css";
import { applyFirstPaintPalette } from "@/shell/firstPaintPalette";

window.__setupPreview = __SETUP_PREVIEW__;
if (!__SETUP_PREVIEW__) installStaleChunkRetry(window, sessionStorage);
if (!__SETUP_PREVIEW__ && "serviceWorker" in navigator) {
  installHiddenReloadOnNewServiceWorker(navigator.serviceWorker, document, window);
}

/** Fires `onConfirmed` after the first real render commits, not just after
 * the synchronous `render()` call returns - a hang during a lazy import
 * happens after that call already returned, so `runBootWatchdog` needs a
 * signal from inside the tree itself. */
function BootConfirm({ onConfirmed }: { onConfirmed: () => void }) {
  useEffect(onConfirmed, [onConfirmed]);
  return null;
}

// The boot failure screen follows the active CSS theme even if React fails.
function renderBootFailure(): void {
  const rootEl = document.getElementById("root");
  if (!rootEl) return;
  rootEl.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:center;min-height:100vh;padding:24px;font-family:system-ui,sans-serif;text-align:center;background:var(--background);color:var(--foreground);">
      <div style="max-width:28rem;">
        <h1 style="font-size:1.25rem;margin-bottom:0.5rem;">MaiPai couldn't start</h1>
        <p style="color:var(--muted-foreground);line-height:1.5">Try closing and reopening this page. If it keeps happening, restart the hub.</p>
      </div>
    </div>`;
}

const bootStorage = __SETUP_PREVIEW__ ? new Proxy({} as Storage, { get: () => () => null, set: () => true }) : sessionStorage;
runBootWatchdog(
  window,
  bootStorage,
  (confirmBooted) => {
    const rootEl = document.getElementById("root");
    if (!rootEl) throw new Error("#root element missing from index.html");
    applyFirstPaintPalette();
    createRoot(rootEl).render(
      <StrictMode>
        <BootConfirm onConfirmed={confirmBooted} />
        <App />
      </StrictMode>,
    );
  },
  renderBootFailure,
);
