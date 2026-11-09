/** The answer to /api/auth/me that public/first-paint.js asked for before the app's code arrived. It is taken once and only while fresh;
 * a missing, failed or old answer returns null and the caller makes its own request, so errors reach the normal handling. */
const FRESH_MS = 30_000;
export interface EarlyMeSlot { at: number; answer: Promise<unknown | null> }
declare global { interface Window { __maipaiEarlyMe?: EarlyMeSlot } }

export async function takeEarlyMe<T = unknown>(win: Window = window): Promise<T | null> {
  const slot = win.__maipaiEarlyMe;
  delete win.__maipaiEarlyMe;
  if (!slot || Date.now() - slot.at > FRESH_MS) return null;
  return (await slot.answer) as T | null;
}
