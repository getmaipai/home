import { useEffect, useState } from "react";
import { handlersFor, scenarioForPage } from "./handlers";

type PreviewWorker = import("msw/browser").SetupWorker;
declare global { interface Window { __setupPreviewWorker?: PreviewWorker } }

export function PreviewRuntime({ children }: { children: React.ReactNode }) {
  const [started, setStarted] = useState(false);
  useEffect(() => {
    async function start() {
      const { setupWorker } = await import("msw/browser");
      const worker = setupWorker(...handlersFor(scenarioForPage()));
      await worker.start({ onUnhandledRequest: (request) => {
        if (new URL(request.url).pathname.startsWith("/api/")) throw new Error(`Unhandled preview API request: ${request.method} ${new URL(request.url).pathname}`);
      }, serviceWorker: { url: "/mockServiceWorker.js", options: { scope: "/" } } });
      window.__setupPreviewWorker = worker;
      setStarted(true);
    }
    void start();
    document.title = `Preview — ${document.title}`;
  }, []);
  return started ? <>{children}</> : null;
}
