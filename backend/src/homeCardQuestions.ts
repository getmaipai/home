// The Home page's own fixed-card questions (frontend/src/apps/home/
// HomePage.tsx's WeatherCard, runFixedTurn.ts), kept alias-free (relative
// imports only, never "@/...") for the same reason wire.ts is: backend's
// own tsconfig "@/*" path mapping does not apply when frontend's tsc
// resolves this file through the @maipai/home-backend workspace
// dependency. `backend/src/lib/homeCardQueries.ts`'s `isFixedHomeCardQuery()`
// (getmaipai/home#91's ephemeral-flag gate) and HomePage.tsx's own
// `WeatherCard` both build the identical question from here, so a future
// wording change updates the one place both sides read from, rather than
// two copies that can quietly drift apart (a code review, 2026-09-13,
// caught exactly that risk when this was still hand-duplicated in
// HomePage.tsx).
export function weatherCardQuestion(homePlace: string | undefined): string {
  return homePlace ? `What's the weather like in ${homePlace} today?` : "What's the weather like today?";
}
