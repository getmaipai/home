export type Tier = "standard" | "boost" | "max";
export type CellState = Tier | "reduced" | "queued" | "off";
export type Category = "chat" | "voice" | "picture" | "video" | "music" | "tools";
export interface ProfileCell { state: CellState; phase?: "before" }
export interface ProfileRow { lead: Category; tier: Tier; cells: Partial<Record<Category, ProfileCell>> }
export interface Hardware {
  budgetGb: number; marginGb: number;
  residentGb: Partial<Record<Category, Partial<Record<"reduced" | Tier, number>>>>;
  peakGb: Partial<Record<Category, Partial<Record<Tier, number>>>>;
}
export interface RowError { lead: Category; tier: Tier; message: string; needGb?: number; haveGb?: number }
const categories: Category[] = ["chat", "voice", "picture", "video", "music", "tools"];
const tiers = new Set<CellState>(["standard", "boost", "max", "reduced"]);

export function validateProfileTable(rows: readonly ProfileRow[], hw: Hardware): { ok: boolean; errors: RowError[] } {
  const errors: RowError[] = [];
  for (const row of rows) {
    const chat = row.cells.chat;
    if (!chat) errors.push({ lead: row.lead, tier: row.tier, message: "chat must be stated in every row" });
    for (const category of ["chat", "voice"] as const) {
      const cell = row.cells[category];
      if (cell?.state === "queued" || cell?.state === "off") errors.push({ lead: row.lead, tier: row.tier, message: `${category} cannot be queued or off` });
    }
    const peak = hw.peakGb[row.lead]?.[row.tier];
    if (peak === undefined) {
      errors.push({ lead: row.lead, tier: row.tier, message: `no measured figure for ${row.lead} ${row.tier}` });
      continue;
    }
    let need = peak;
    let missing: string | undefined;
    for (const category of categories) {
      if (category === row.lead) continue;
      const cell = row.cells[category];
      if (!cell || cell.phase === "before" || !tiers.has(cell.state)) continue;
      const resident = hw.residentGb[category]?.[cell.state as "reduced" | Tier];
      if (resident === undefined) { missing = `no measured figure for ${category} ${cell.state}`; break; }
      need += resident;
    }
    if (missing) errors.push({ lead: row.lead, tier: row.tier, message: missing });
    else {
      const have = hw.budgetGb - hw.marginGb;
      if (need > have) errors.push({ lead: row.lead, tier: row.tier, needGb: need, haveGb: have,
        message: `${row.lead} ${row.tier} needs about ${need} GB with chat ${chat?.state ?? "unstated"}; this machine has ${have} GB.` });
    }
  }
  return { ok: errors.length === 0, errors };
}
