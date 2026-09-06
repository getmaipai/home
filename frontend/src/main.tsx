import { StrictMode, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { App } from "@/App";
import { installReloadOnceOnNewServiceWorker, installStaleChunkRetry, runBootWatchdog } from "@/lib/pwaBoot";
import "@/kit/tokens.css";

installStaleChunkRetry(window, sessionStorage);
if ("serviceWorker" in navigator) {
  installReloadOnceOnNewServiceWorker(navigator.serviceWorker, window);
}

/** Fires `onConfirmed` after the first real render commits, not just after
 * the synchronous `render()` call returns - a hang during a lazy import
 * happens after that call already returned, so `runBootWatchdog` needs a
 * signal from inside the tree itself. */
function BootConfirm({ onConfirmed }: { onConfirmed: () => void }) {
  useEffect(onConfirmed, [onConfirmed]);
  return null;
}

// Same palette as public/offline.html's own pre-React error page (a code
// review found the two had drifted to separately hand-picked colors,
// with no shared template - kept in sync as plain literals rather than a
// real shared component, since one is a static HTML file the service
// worker must be able to serve with zero JS and the other only runs when
// React itself has already failed to boot).
function renderBootFailure(): void {
  const rootEl = document.getElementById("root");
  if (!rootEl) return;
  rootEl.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:center;min-height:100vh;padding:24px;font-family:system-ui,sans-serif;text-align:center;background:#0b0b0f;color:#f5f5f7;">
      <div style="max-width:28rem;">
        <h1 style="font-size:1.25rem;margin-bottom:0.5rem;">MaiPai couldn't start</h1>
        <p style="color:#a1a1aa;line-height:1.5;">Try closing and reopening this page. If it keeps happening, restart the hub.</p>
      </div>
    </div>`;
}

runBootWatchdog(
  window,
  sessionStorage,
  (confirmBooted) => {
    const rootEl = document.getElementById("root");
    if (!rootEl) throw new Error("#root element missing from index.html");
    createRoot(rootEl).render(
      <StrictMode>
        <BootConfirm onConfirmed={confirmBooted} />
        <App />
      </StrictMode>,
    );
  },
  renderBootFailure,
);
