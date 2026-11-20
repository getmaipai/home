// Rigs and restarts never run while a real page is connected to the lab (they share one chat slot and one GPU).
export async function waitForNoLivePage(secret: string, host = "127.0.0.1:9931", maxMs = 600_000): Promise<boolean> {
  const t0 = performance.now(); let announced = false;
  while (performance.now() - t0 < maxMs) {
    try { const r = await fetch(`http://${host}/api/live`, { headers: { "x-lab-secret": secret } }); const j = (await r.json().catch(() => ({}))) as { live?: number }; if (typeof j.live !== "number") { console.log("lab has no /api/live yet (old server); proceeding"); return true; } if (r.ok && j.live === 0) return true; if (r.ok && !announced) { console.log(`a real page is connected (${j.live}); waiting for it to leave`); announced = true; } if (!r.ok && !announced) { console.log("lab does not answer /api/live (old server?); proceeding"); return true; } } catch { return false; }
    await Bun.sleep(5000);
  }
  return false;
}
