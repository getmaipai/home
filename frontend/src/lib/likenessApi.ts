// LIKENESS-01: the person's own side of pictures, videos and styles that look like them (`/api/likeness`). Data only.
import { ApiError } from "@/lib/api";

export interface LikenessUse { id: string; who: string; medium: "picture" | "video"; way: "style" | "photo"; adult_content: boolean; used_at: string; line: string }
export interface LikenessMe {
  eligible: boolean;
  adults: boolean;
  adult_content: boolean;
  history: Array<{ id: string; option: "adults" | "adult_content"; state: "on" | "off"; changed_at: string }>;
  uses: LikenessUse[];
}
export interface HouseholdAdult { id: string; name: string; self: boolean; agreed: boolean }

async function get<T>(path: string): Promise<T> {
  const res = await fetch(path, { credentials: "include" });
  const body = (await res.json().catch(() => ({}))) as { error?: string; code?: string };
  if (!res.ok) throw new ApiError(body.error ?? res.statusText, res.status, body.code);
  return body as T;
}

export const likenessApi = {
  me: () => get<LikenessMe>("/api/likeness/me"),
  adults: () => get<{ adults: HouseholdAdult[] }>("/api/likeness/adults").then((r) => r.adults),
};
