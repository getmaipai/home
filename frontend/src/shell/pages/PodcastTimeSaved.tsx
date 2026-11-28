import { i18n } from "@lingui/core";
import { useQuery } from "@tanstack/react-query";
import { api, type Roster } from "@/lib/api";
import { formatRelative } from "@/lib/format";
import { formatSkipDuration } from "@/shell/skip/skipPlan";
import { Card, CardContent, CardHeader, CardTitle } from "@maipai/ui/src/dashboard/components/ui/card";
import { Alert, AlertDescription } from "@maipai/ui/src/dashboard/components/ui/alert";

export function PodcastTimeSaved({ person }: { person: Roster }) {
  const query = useQuery({ queryKey: ["podcast-skip-summary"], queryFn: api.podcastSegmentsSummary, retry: false });
  if (query.isPending) return <p role="status">{i18n._({ id: "Loading time saved", message: "Loading time saved" })}</p>;
  if (query.isError) return <section><Alert variant="destructive"><AlertDescription>{i18n._({ id: "Time saved could not be loaded. Check Stack and reload to try again.", message: "Time saved could not be loaded. Check Stack and reload to try again." })}</AlertDescription></Alert></section>;
  const data = query.data;
  const canSeeShows = person.age_band === "adult";
  if (!data || data.household_seconds === 0) return <section><Card><CardHeader><CardTitle>{i18n._({ id: "Time saved", message: "Time saved" })}</CardTitle></CardHeader><CardContent><p className="text-body text-muted-foreground">{i18n._({ id: "No listening time saved yet.", message: "No listening time saved yet." })}</p></CardContent></Card></section>;
  return <section><Card><CardHeader><CardTitle>{i18n._({ id: "Time saved", message: "Time saved" })}</CardTitle></CardHeader><CardContent><div className="flex flex-col gap-3"><dl className="grid grid-cols-2 gap-3"><div><dt className="text-body text-muted-foreground">{i18n._({ id: "This week", message: "This week" })}</dt><dd className="text-title font-semibold">{formatSkipDuration(data.this_week)}</dd></div><div><dt className="text-body text-muted-foreground">{i18n._({ id: "This month", message: "This month" })}</dt><dd className="text-title font-semibold">{formatSkipDuration(data.this_month)}</dd></div><div><dt className="text-body text-muted-foreground">{i18n._({ id: "Household total", message: "Household total" })}</dt><dd className="text-title font-semibold">{formatSkipDuration(data.household_seconds)}</dd></div></dl>{canSeeShows ? <ul className="flex flex-col gap-2 border-t pt-3">{data.shows.map((show) => <li key={show.show_id} className="flex justify-between gap-3 text-body"><span>{show.show} · {i18n._({ id: "{count, plural, one {# ad skipped} other {# ads skipped}}", message: "{count, plural, one {# ad skipped} other {# ads skipped}}", values: { count: show.ads_skipped } })}</span><span>{formatSkipDuration(show.seconds_saved)}</span></li>)}</ul> : null}{data.episodes[0] ? <p className="text-caption text-muted-foreground">{i18n._({ id: "Last processed {when}", message: "Last processed {when}", values: { when: formatRelative(data.episodes.map((row) => row.updated_at).sort().at(-1)!) } })}</p> : null}</div></CardContent></Card></section>;
}
