// Disk plan rows whose parts come with a maker's licence an admin accepts once before the first byte downloads, and the Stack
// component that installs each (the Stack's components route holds the notice and the acceptance). Detailed video (LTX-2.3) is in
// the Recommended plan on the 128 GB tier, so the wizard shows its licence and the install waits for the accept (VIDEO-LTX-03).
export const LICENSED_ROWS: Readonly<Record<string, string>> = { "video-detailed": "ltx-2-3-distilled-mlx" };
export const isLicensedRow = (rowId: string): boolean => Object.hasOwn(LICENSED_ROWS, rowId);
export interface PlanLicence { row_id: string; component: string; id: string; name: string; url: string; summary: string[]; accepted_at: string | null }
