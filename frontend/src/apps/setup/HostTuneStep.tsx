import { i18n } from "@lingui/core";
import { getIcon } from "@maipai/ui/src/icons";
import { useEffect, useRef, useState } from "react";
import { Button } from "@maipai/ui/src/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@maipai/ui/src/ui/alert";
import { Card, CardContent, CardHeader } from "@maipai/ui/src/dashboard/components/ui/card";
import { api, ApiError, type HostTuneItem } from "@/lib/api";

const CheckIcon = getIcon("check");
const TuneIcon = getIcon("sliders-horizontal");

const failureNext = () => i18n._({ id: "Try again, or skip this step. Home works without it.", message: "Try again, or skip this step. Home works without it." });
const tuneLoadFailed = () => i18n._({ id: "Home couldn't read this computer's tuning options. Press Try again, or skip this step. Home works without it.", message: "Home couldn't read this computer's tuning options. Press Try again, or skip this step. Home works without it." });

/** The failure as one sentence: what went wrong, then the next step. */
export function hostTuneFailure(reason: unknown): string {
  if (reason instanceof ApiError) return `${reason.message.replace(/\s+$/, "")} ${reason.next ?? failureNext()}`.trim();
  return i18n._({ id: "{_} {failureNext}", message: "{_} {failureNext}", values: { _: i18n._({ id: "Home couldn't change that setting.", message: "Home couldn't change that setting." }), failureNext: failureNext() } });
}

/** Reads whether this computer offers tuning. Anything unreadable counts as "no", so setup never waits on it. */
export function useHostTuneSupported(enabled: boolean): boolean {
  const [supported, setSupported] = useState(false);
  useEffect(() => {
    if (!enabled) return;
    let active = true;
    api.setupHostTune().then((view) => { if (active) setSupported(view.supported); }, () => { if (active) setSupported(false); });
    return () => { active = false; };
  }, [enabled]);
  return enabled && supported;
}

export function HostTuneStep({ onSkip }: {
  /** Moves on without changing anything. */
  onSkip: () => void;
}) {
  const [items, setItems] = useState<HostTuneItem[] | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const errorRef = useRef<HTMLDivElement>(null);
  // The message sits above the cards; bring it into view so a failure near the bottom is not missed.
  useEffect(() => { if (error) errorRef.current?.scrollIntoView?.({ block: "center", behavior: "smooth" }); }, [error]);

  function load() {
    setLoadFailed(false);
    setItems(null);
    api.setupHostTune().then((view) => setItems(view.supported ? view.items : []), () => setLoadFailed(true));
  }
  useEffect(load, []);

  const replace = (item: HostTuneItem) => setItems((all) => (all ?? []).map((entry) => (entry.id === item.id ? item : entry)));

  async function run(ids: string[], action: "apply" | "revert") {
    setError(null);
    setBusyId(ids.length === 1 ? ids[0]! : "auto");
    try {
      for (const id of ids) replace((await (action === "apply" ? api.setupHostTuneApply(id) : api.setupHostTuneRevert(id))).item);
    } catch (reason) {
      setError(hostTuneFailure(reason));
    } finally { setBusyId(null); }
  }

  if (loadFailed) {
    return (
      <div className="flex flex-col gap-4">
        <Alert variant="destructive"><AlertTitle>{i18n._({ id: "Home couldn't read this computer", message: "Home couldn't read this computer" })}</AlertTitle><AlertDescription>{tuneLoadFailed()}</AlertDescription></Alert>
        <div className="flex flex-wrap gap-2"><Button type="button" variant="secondary" size="lg" onClick={load}>{i18n._({ id: "Try again", message: "Try again" })}</Button><Button type="button" variant="ghost" size="lg" onClick={onSkip}>{i18n._({ id: "Skip this step", message: "Skip this step" })}</Button></div>
      </div>
    );
  }
  if (items === null) return <p role="status" className="text-base text-muted-foreground md:text-lg">{i18n._({ id: "Looking at this computer.", message: "Looking at this computer." })}</p>;
  if (items.length === 0) {
    return (
      <div className="flex flex-col gap-4">
        <p className="text-base text-muted-foreground md:text-lg">{i18n._({ id: "This computer needs no changes.", message: "This computer needs no changes." })}</p>
        <div><Button type="button" variant="ghost" size="lg" onClick={onSkip}>{i18n._({ id: "Skip this step", message: "Skip this step" })}</Button></div>
      </div>
    );
  }

  const auto = items.filter((item) => item.mode === "auto");
  const consent = items.filter((item) => item.mode === "consent");
  const advice = items.filter((item) => item.mode === "advice");
  const autoPending = auto.filter((item) => item.state === "needs");
  const busy = busyId !== null;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-4">
        <span aria-hidden className="flex size-16 shrink-0 items-center justify-center rounded-full bg-muted text-primary"><TuneIcon className="size-8" /></span>
        <p className="text-base text-muted-foreground md:text-lg">{i18n._({ id: "A few quick changes help the AI run well. All are optional.", message: "A few quick changes help the AI run well. All are optional." })}</p>
      </div>
      {error ? <div ref={errorRef}><Alert variant="destructive"><AlertTitle>{i18n._({ id: "That didn't work", message: "That didn't work" })}</AlertTitle><AlertDescription>{error}</AlertDescription></Alert></div> : null}

      {auto.length > 0 ? (
        <Card>
          <CardHeader>
            <h2 className="text-2xl font-semibold md:text-3xl">{i18n._({ id: "Recommended", message: "Recommended" })}</h2>
            <p className="text-base text-muted-foreground md:text-lg">{i18n._({ id: "Home can do these for you.", message: "Home can do these for you." })}</p>
          </CardHeader>
          <CardContent>
            <ul className="flex flex-col gap-3">
              {auto.map((item) => (
                <li key={item.id}>
                  <p className="text-base font-medium md:text-lg">{item.title}</p>
                  <p className="text-base text-muted-foreground md:text-lg">{item.why}</p>
                  <StateLine item={item} />
                </li>
              ))}
            </ul>
            {autoPending.length > 0 ? <div className="pt-3"><Button type="button" size="lg" disabled={busy} onClick={() => void run(autoPending.map((item) => item.id), "apply")}>{busyId === "auto" ? i18n._({ id: "Applying", message: "Applying" }) : i18n._({ id: "Apply recommended", message: "Apply recommended" })}</Button></div> : null}
          </CardContent>
        </Card>
      ) : null}

      {consent.map((item) => (
        <Card key={item.id}>
          <CardHeader>
            <h2 className="text-2xl font-semibold md:text-3xl">{item.title}</h2>
            <p className="text-base text-muted-foreground md:text-lg">{item.why}</p>
          </CardHeader>
          <CardContent>
            <p className="text-base md:text-lg">{item.state === "applied" ? i18n._({ id: "Changed. Now: {proposed}.", message: "Changed. Now: {proposed}.", values: { proposed: item.proposed } }) : i18n._({ id: "Now: {current}. After: {proposed}.", message: "Now: {current}. After: {proposed}.", values: { current: item.current, proposed: item.proposed } })}</p>
            <div className="flex flex-wrap gap-2 pt-3">
              {item.state === "applied"
                ? <Button type="button" variant="secondary" size="lg" disabled={busy} onClick={() => void run([item.id], "revert")}>{busyId === item.id ? i18n._({ id: "Reverting", message: "Reverting" }) : i18n._({ id: "Revert", message: "Revert" })}</Button>
                : item.state === "needs" ? <Button type="button" size="lg" disabled={busy} onClick={() => void run([item.id], "apply")}>{busyId === item.id ? i18n._({ id: "Applying", message: "Applying" }) : i18n._({ id: "Apply", message: "Apply" })}</Button> : null}
            </div>
            {item.state === "ok" ? <p role="status" className="flex items-center gap-2 pt-3 text-base font-medium text-[color:var(--hue-teal)]"><CheckIcon aria-hidden className="size-5" />{i18n._({ id: "Already set.", message: "Already set." })}</p> : null}
            {item.state === "unknown" ? <p className="pt-3 text-base text-muted-foreground md:text-lg">{i18n._({ id: "Home can't tell what this is set to, so it leaves it alone.", message: "Home can't tell what this is set to, so it leaves it alone." })}</p> : null}
          </CardContent>
        </Card>
      ))}

      {advice.length > 0 ? (
        <details className="rounded-xl border bg-card p-4 text-card-foreground">
          <summary className="cursor-pointer text-lg font-semibold md:text-xl">{i18n._({ id: "{count, plural, one {# thing to do yourself, if you like} other {# things to do yourself, if you like}}", message: "{count, plural, one {# thing to do yourself, if you like} other {# things to do yourself, if you like}}", values: { count: advice.length } })}</summary>
          <ul className="flex flex-col gap-3 pt-3">
            {advice.map((item) => (
              <li key={item.id}>
                <p className="text-base font-medium md:text-lg">{item.title}</p>
                <p className="text-base text-muted-foreground md:text-lg">{item.why} {item.proposed}</p>
              </li>
            ))}
          </ul>
        </details>
      ) : null}

      <div><Button type="button" variant="ghost" size="lg" disabled={busy} onClick={onSkip}>{i18n._({ id: "Skip this step", message: "Skip this step" })}</Button></div>
    </div>
  );
}

function StateLine({ item }: { item: HostTuneItem }) {
  if (item.state === "applied" || item.state === "ok") return <p role="status" className="flex items-center gap-2 text-base font-medium text-[color:var(--hue-teal)]"><CheckIcon aria-hidden className="size-5" />{item.state === "applied" ? i18n._({ id: "Applied.", message: "Applied." }) : i18n._({ id: "Already set.", message: "Already set." })}</p>;
  if (item.state === "unknown") return <p className="text-base text-muted-foreground md:text-lg">{i18n._({ id: "Home can't tell what this is set to, so it leaves it alone.", message: "Home can't tell what this is set to, so it leaves it alone." })}</p>;
  return <p className="text-base md:text-lg">{i18n._({ id: "Now: {current}. After: {proposed}.", message: "Now: {current}. After: {proposed}.", values: { current: item.current, proposed: item.proposed } })}</p>;
}
