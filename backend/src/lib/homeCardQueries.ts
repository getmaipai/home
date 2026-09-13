// getmaipai/home#91: `ephemeral` on POST /api/turn/stream (routes/turn.ts)
// exists for exactly one caller today - the Home page's own WeatherCard
// (frontend/src/apps/home/runFixedTurn.ts), asking a fixed question
// nobody typed so it never becomes a real chat-history row. A code
// review of that fix found the flag honored for ANY text a signed-in
// person sent, which let ordinary (unflagged) content skip the
// chat-history/episode write a parent might otherwise review - real,
// even though a genuinely flagged message still notifies independently
// (turnEngine.ts's notifyOncePerTurn(), which never goes through
// logTurnSafely()). `weatherCardQuestion()` (../homeCardQuestions.ts,
// alias-free so HomePage.tsx's WeatherCard can import the identical
// function - a first draft hand-duplicated the template string here
// instead, which a second review pass caught) is the one place that
// question is built; `isFixedHomeCardQuery()` below just re-derives it
// from the same household.home_place setting the frontend itself reads
// and compares against the actual submitted text.
import { getHouseholdSettingValue } from "@/lib/settings";
import { weatherCardQuestion } from "@/homeCardQuestions";

/** True only for the exact question a Home card is allowed to ask
 * ephemerally right now (today: the weather card's two shapes, with or
 * without a configured `household.home_place`). Anything else - even
 * something that merely looks like it, or a stale place from before a
 * household changed the setting - is refused: routes/turn.ts logs the
 * turn normally instead of honoring `ephemeral` for it. A future second
 * card gets its own line here, not a broader pattern match. */
export function isFixedHomeCardQuery(text: string): boolean {
  const place = getHouseholdSettingValue("household.home_place");
  return text === weatherCardQuestion(typeof place === "string" && place.length > 0 ? place : undefined);
}
