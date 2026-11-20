// A quiet-machine measurement is only valid on a quiet machine. Rigs call this first: above the limit they say who is using the machine and stop with exit code 3
// (not a pass and not a fail: "busy"). The load average and the top CPU users are what the owner's other jobs look like from here.
import { loadavg } from "node:os";
export const QUIET_LOAD = 4;
export async function machineBusy(limit = QUIET_LOAD): Promise<{ busy: boolean; load1: number; top: string }> {
  const load1 = loadavg()[0]!; if (load1 <= limit) return { busy: false, load1, top: "" };
  const p = Bun.spawn(["ps", "-Ao", "pcpu,etime,args", "-r"], { stdout: "pipe" }); const out = (await new Response(p.stdout).text()).split("\n").slice(1, 5).map((l) => l.trim().slice(0, 110)).join(" | ");
  return { busy: true, load1, top: out };
}
export async function requireQuiet(what: string) { const m = await machineBusy(); if (m.busy) { console.log(`MACHINE BUSY: ${what} is not valid at load average ${m.load1.toFixed(1)} (limit ${QUIET_LOAD}). Busiest: ${m.top}`); process.exit(3); } }
