// LIKENESS-01: the person's own side of pictures, videos and styles that look like them (`/api/likeness`). Data only.
import { ApiError } from "@/lib/api";

export interface HouseholdAdult { id: string; name: string; self: boolean }

async function get<T>(path: string): Promise<T> {
  const res = await fetch(path, { credentials: "include" });
  const body = (await res.json().catch(() => ({}))) as { error?: string; code?: string };
  if (!res.ok) throw new ApiError(body.error ?? res.statusText, res.status, body.code);
  return body as T;
}

export const likenessApi = {
  adults: () => get<{ adults: HouseholdAdult[] }>("/api/likeness/adults").then((r) => r.adults),
};
