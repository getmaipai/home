/** Monte Carlo validation of the exact statistics used by routeStats.ts. */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { comparePaired, clusterRate, type RouteRow } from "./routeStats";

type SimOptions = { datasets?: number; bootstrapDraws?: number; seed?: number; rhoR?: number; rhoFs?: number[]; rates?: number[]; differences?: number[] };
export interface SimCell { rate: number; rhoF: number; rhoR: number; difference: number; coverage: number; belowBoundRate: number; barPassProbability: number; signTypeIError: number; signPower: number; pairedCoverage: number; datasets: number; }

function familySizesFromDataset(): number[] {
  const dataset = JSON.parse(readFileSync(join(import.meta.dir, "datasets/chat-ab-01.json"), "utf8")) as { fresh: { items: { id: string; family?: string }[] } };
  const families = new Map<string, number>();
  for (const item of dataset.fresh.items) { const f = item.family || item.id; families.set(f, (families.get(f) ?? 0) + 1); }
  return [...families.values()];
}
function rng(seed: number) { let state = seed >>> 0; return () => { state = (1664525 * state + 1013904223) >>> 0; return (state + 0.5) / 0x1_0000_0000; }; }
function gamma(shape: number, random: () => number): number {
  if (shape < 1) return gamma(shape + 1, random) * Math.pow(random(), 1 / shape);
  const d = shape - 1/3, c = 1 / Math.sqrt(9*d);
  for (;;) { let x = 0, v = 0; do { const u1 = random(), u2 = random(); x = Math.sqrt(-2*Math.log(u1))*Math.cos(2*Math.PI*u2); v = 1+c*x; } while (v <= 0); v = v*v*v; const u = random(); if (u < 1-0.0331*x**4 || Math.log(u) < 0.5*x*x+d*(1-v+Math.log(v))) return d*v; }
}
function beta(mean: number, rho: number, random: () => number): number {
  if (rho <= 0 || mean <= 0 || mean >= 1) return Math.min(1, Math.max(0, mean));
  const concentration = (1-rho)/rho, a = mean*concentration, b = (1-mean)*concentration;
  const x=gamma(a,random), y=gamma(b,random); return x/(x+y);
}
function bernoulli(p: number, random: () => number) { return random() < p; }

function oneDataset(rate: number, difference: number, rhoF: number, rhoR: number, sizes: number[], random: () => number, repeats = 3) {
  const a: RouteRow[] = [], b: RouteRow[] = [];
  sizes.forEach((size, familyIndex) => {
    const family = `sim-family-${familyIndex}`;
    const familyP = beta(rate, rhoF, random);
    for (let itemIndex = 0; itemIndex < size; itemIndex++) {
      const id = `${family}-${itemIndex}`;
      const itemP = beta(familyP, rhoR, random);
      const itemPB = Math.max(0, Math.min(1, itemP + difference));
      for (let rep=1;rep<=repeats;rep++) {
        a.push({ id, family, rep, evidence: bernoulli(itemP,random) });
        b.push({ id, family, rep, evidence: bernoulli(itemPB,random) });
      }
    }
  });
  return { a,b };
}

export function simulateRouteStats(options: SimOptions = {}): SimCell[] {
  const datasets=options.datasets??200, bootstrapDraws=options.bootstrapDraws??300, rhoR=options.rhoR??0.1;
  const rhoFs=options.rhoFs??[0,0.1,0.2,0.3], rates=options.rates??[0.85,0.9,0.92,0.95], differences=options.differences??[0,0.045];
  const sizes=familySizesFromDataset(), cells: SimCell[]=[]; let cellSeed=options.seed??0xe057;
  for (const rate of rates) for (const rhoF of rhoFs) for (const difference of differences) {
    let coverage=0, below=0, pass=0, typeI=0, power=0, pairedCoverage=0;
    for (let i=0;i<datasets;i++) {
      const random=rng(cellSeed++), {a,b}=oneDataset(rate,difference,rhoF,rhoR,sizes,random);
      const single=clusterRate(a,bootstrapDraws,cellSeed);
      if (single.low <= rate && rate <= single.high) coverage++;
      if (rate < single.low) below++;
      if (single.estimate >= 0.9 && single.low >= 0.85) pass++;
      const paired=comparePaired(a,b,bootstrapDraws,cellSeed);
      if (paired.interval.low <= difference && difference <= paired.interval.high) pairedCoverage++;
      if (difference===0 && paired.signP<0.05) typeI++;
      if (difference>0 && paired.signP<0.05) power++;
    }
    cells.push({ rate,rhoF,rhoR,difference,coverage:coverage/datasets,belowBoundRate:below/datasets,barPassProbability:pass/datasets,signTypeIError:difference===0?typeI/datasets:0,signPower:difference>0?power/datasets:0,pairedCoverage:pairedCoverage/datasets,datasets });
  }
  return cells;
}

if (import.meta.main) {
  const full=process.argv.includes("--full");
  const valueAfter = (flag: string, fallback: number) => { const at=process.argv.indexOf(flag); return at>=0 ? Number(process.argv[at+1]) : fallback; };
  const rhoR=valueAfter("--rho-r",0.1), measuredRhoF=valueAfter("--rho-f-measured",0.1);
  const rhoFs=[...new Set([0,0.1,0.2,0.3,measuredRhoF])].sort((a,b)=>a-b);
  const cells=simulateRouteStats({ datasets: full?2000:200, bootstrapDraws: full?2000:300, rhoR, rhoFs });
  console.log("# Route statistics simulation");
  console.log(`Datasets/cell: ${full?2000:200}; bootstrap draws: ${full?2000:300}; family sizes loaded from chat-ab-01.json.`);
  console.log("rho_f,rho_r,rate,difference,rate_coverage,below_lower,bar_pass,paired_coverage,sign_type_i,sign_power");
  for (const c of cells) console.log(`${c.rhoF},${c.rhoR},${c.rate},${c.difference},${c.coverage.toFixed(4)},${c.belowBoundRate.toFixed(4)},${c.barPassProbability.toFixed(4)},${c.pairedCoverage.toFixed(4)},${c.signTypeIError.toFixed(4)},${c.signPower.toFixed(4)}`);
}
