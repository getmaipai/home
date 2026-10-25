import { monitorEventLoopDelay } from "node:perf_hooks";
import { createMiddleware } from "hono/factory";
import type { Context } from "hono";

const SLOW_MS = 700;
const WINDOW_MS = 5_000;
const slowLines: string[] = [];
const busySince = new Map<string, { since: number; count: number }>();
let lag = { max_ms: 0, p99_ms: 0, over_s: 5 };
let monitor: ReturnType<typeof monitorEventLoopDelay> | null = null;

export function markBusy(name: string): void {
  const current = busySince.get(name);
  if (current) current.count++;
  else busySince.set(name, { since: Date.now(), count: 1 });
}
export function markIdle(name: string): void {
  const current = busySince.get(name);
  if (!current) return;
  if (current.count <= 1) busySince.delete(name);
  else current.count--;
}
export function getPerfSnapshot() {
  const currentMax = monitor ? monitor.max / 1e6 : lag.max_ms;
  const currentP99 = monitor ? monitor.percentile(99) / 1e6 : lag.p99_ms;
  return {
    lag: { max_ms: Math.round(currentMax), p99_ms: Math.round(currentP99), over_s: lag.over_s },
    slow_requests: [...slowLines],
  };
}

function routePattern(c: Context): string {
  const route = c.req.routePath;
  if (route && route !== "/*") return route;
  return c.req.path.replace(/\/[^/]+/g, "/:param") || "/";
}

export const slowRequestMiddleware = createMiddleware(async (c, next) => {
  const started = performance.now();
  await next();
  const elapsed = performance.now() - started;
  if (elapsed <= SLOW_MS) return;
  const line = `[perf] slow request: ${c.req.method} ${routePattern(c)} ${Math.round(elapsed)} ms status ${c.res.status}`;
  slowLines.push(line);
  if (slowLines.length > 50) slowLines.shift();
  console.warn(line);
});

export function startPerfWatch(): void {
  if (monitor) return;
  monitor = monitorEventLoopDelay({ resolution: 20 });
  monitor.enable();
  const timer = setInterval(() => {
    if (!monitor) return;
    const max = monitor.max / 1e6;
    const p99 = monitor.percentile(99) / 1e6;
    lag = { max_ms: Math.round(max), p99_ms: Math.round(p99), over_s: WINDOW_MS / 1000 };
    if (p99 > 200 || max > 1_000) {
      const running = [...busySince.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([name, task]) => `${name}(${Math.max(0, Math.floor((Date.now() - task.since) / 1000))}s)`);
      console.warn(`[perf] event loop: max ${Math.round(max)} p99 ${Math.round(p99)} over ${WINDOW_MS / 1000}s; running: ${running.join(", ") || "none"}`);
    }
    monitor.reset();
  }, WINDOW_MS);
  timer.unref();
}

export function __resetPerfWatchForTests(): void {
  slowLines.length = 0;
  busySince.clear();
  lag = { max_ms: 0, p99_ms: 0, over_s: 5 };
}
