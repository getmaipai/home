// A quiet-machine measurement is only valid on a quiet machine. Rigs call this first: above the limit they say who is using the machine and stop with exit code 3
// (not a pass and not a fail: "busy"). The load average and the top CPU users are what the owner's other jobs look like from here.
import { loadavg } from "node:os";
export const QUIET_LOAD = 4;
export async function machineBusy(limit = QUIET_LOAD): Promise<{ busy: boolean; load1: number; top: string }> {
  const load1 = loadavg()[0]!; if (load1 <= limit) return { busy: false, load1, top: "" };
  const p = Bun.spawn(["ps", "-Ao", "pcpu,etime,args", "-r"], { stdout: "pipe" }); const out = (await new Response(p.stdout).text()).split("\n").slice(1, 5).map((l) => l.trim().slice(0, 110)).join(" | ");
  return { busy: true, load1, top: out };
}
/** A busy machine is the normal condition here, so it never blocks a measurement; it is only recorded next to the result. */
export async function noteLoad(what: string) { const m = await machineBusy(); console.log(`${what}: load average ${m.load1.toFixed(1)}${m.busy ? "; busiest: " + m.top : ""}`); }
/** Priority of the lab's own processes: nice value and state. Anything niced (a zsh background job lowers priority by 5) starves as soon as other work runs. */
export async function labPriorities(): Promise<Array<{ name: string; pid: number; nice: number; stat: string }>> {
  const out: Array<{ name: string; pid: number; nice: number; stat: string }> = [];
  for (const [name, port] of [["voice server", 9923], ["chat model", 9921], ["lab page", 9931]] as const) {
    const p = Bun.spawn(["lsof", "-nP", `-iTCP:${port}`, "-sTCP:LISTEN", "-t"], { stdout: "pipe" }); const pid = Number((await new Response(p.stdout).text()).trim().split("\n")[0]); if (!pid) { out.push({ name, pid: 0, nice: 99, stat: "missing" }); continue; }
    const q = Bun.spawn(["ps", "-o", "nice=,stat=", "-p", String(pid)], { stdout: "pipe" }); const [nice, stat] = (await new Response(q.stdout).text()).trim().split(/\s+/); out.push({ name, pid, nice: Number(nice), stat: stat ?? "" });
  }
  return out;
}
