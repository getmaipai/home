// Disk plan rows whose parts come with a maker's licence an admin accepts once before the first byte downloads, and the Stack
// component that installs each (the Stack's components route holds the notice and the acceptance). Boost video (LTX-2.5, row video-ltx25) is optional in
// the 128 GB plan, so the wizard shows its licence and the install waits for the accept (VIDEO-LTX-03).
export const LICENSED_ROWS: Readonly<Record<string, string>> = { "video-ltx25": "ltx-2-5-q8-distilled-mlx" };
export const isLicensedRow = (rowId: string): boolean => Object.hasOwn(LICENSED_ROWS, rowId);
export interface PlanLicence { row_id: string; component: string; id: string; name: string; url: string; summary: string[]; accepted_at: string | null; covered?: boolean }
