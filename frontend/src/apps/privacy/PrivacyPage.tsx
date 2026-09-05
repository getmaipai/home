import { useCallback, useEffect, useRef, useState } from "react";
import { Page } from "@/kit/primitives/Page";
import { Section } from "@/kit/primitives/Section";
import { List } from "@/kit/primitives/List";
import { Progress } from "@/kit/primitives/Progress";
import { Button } from "@/kit/components/Button";
import { getIcon } from "@/kit/icons";
import { api, ApiError, type PrivacyConnection } from "@/lib/api";

// The privacy page every MaiPai product has to keep
// (getmaipai/.github/CLAUDE.md > Privacy architecture: "every product
// keeps a user-tier privacy page with the what-leaves-the-house table:
// each outbound connection, when it happens, what it carries, and who
// receives it. Plain dad-test language").
//
// The table is not written here. It comes from GET /api/privacy, which
// builds it from each package's own manifest plus the hub's own
// downloads, so adding a package that reaches the network adds a row
// here without anyone remembering to. A page with a hand-maintained
// copy of that list would be wrong within a release.
/** "Remember and Recall", "Remember, Recall, and Notes". A plain join
 * reads as "A and B and C" the moment a third offline package exists,
 * on a page held to the dad test (code review, 2026-09-05). */
export function joinNames(names: string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.slice(0, -1).join(", ")}, and ${names[names.length - 1]}`;
}

export function PrivacyPage() {
  const [data, setData] = useState<{ connections: PrivacyConnection[]; offlinePlugins: string[] } | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Only the newest request may write state. The retry button below
  // makes a double-fire genuinely reachable on this page, and a code
  // review (2026-09-05) pointed out the slower of two responses would
  // otherwise win - which on this page means showing a family a stale
  // list of what leaves their house.
  const requestId = useRef(0);
  const load = useCallback(() => {
    const id = ++requestId.current;
    setError(null);
    api
      .privacy()
      .then((next) => {
        if (requestId.current === id) setData(next);
      })
      .catch((e: unknown) => {
        if (requestId.current !== id) return;
        setError(e instanceof ApiError ? e.message : "Could not load the privacy page.");
      });
  }, []);

  useEffect(load, [load]);

  if (error && data === null) {
    return (
      <Page title="Privacy">
        <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
          <p className="text-base text-[hsl(var(--destructive))]">{error}</p>
          <Button variant="secondary" onClick={load}>
            Try again
          </Button>
        </div>
      </Page>
    );
  }

  if (data === null) {
    return (
      <Page title="Privacy">
        <div className="flex flex-1 items-center justify-center">
          <Progress mode="spinner" label="Loading the privacy page" />
        </div>
      </Page>
    );
  }

  const LockIcon = getIcon("lock");

  return (
    <Page title="Privacy">
      <div className="flex flex-1 flex-col gap-6 overflow-y-auto p-4">
        <div className="flex flex-col gap-2">
          <p className="text-base">
            Everything you say to MaiPai, everything it remembers, and everyone in your household stays on this
            computer. It is never sent to us. We do not run a server your family's information passes through, and
            there is nothing in MaiPai that reports back to us about how you use it.
          </p>
          <p className="text-base">
            A few things do reach the internet, because you asked them to. Every one of them is listed below, in
            full. If it is not on this list, it does not happen.
          </p>
        </div>

        <Section heading={`What leaves your house (${data.connections.length})`}>
          <List
            items={data.connections}
            getKey={(row) => row.id}
            label="Outbound connections"
            renderItem={(row) => (
              <div className="flex min-w-0 flex-col gap-1 py-1">
                <span className="text-base font-medium">{row.destination}</span>
                <p className="text-base text-[hsl(var(--muted-foreground))]">
                  <span className="text-[hsl(var(--foreground))]">When:</span> {row.when}
                </p>
                <p className="text-base text-[hsl(var(--muted-foreground))]">
                  <span className="text-[hsl(var(--foreground))]">What it sends:</span> {row.what}
                </p>
                <p className="text-base text-[hsl(var(--muted-foreground))]">
                  <span className="text-[hsl(var(--foreground))]">Who gets it:</span> {row.who}
                </p>
                <p className="text-base text-[hsl(var(--muted-foreground))]">
                  <span className="text-[hsl(var(--foreground))]">How long they keep it:</span> {row.retention}
                </p>
                <p className="text-sm text-[hsl(var(--muted-foreground))]">
                  {/* Just the name, no noun. "The Weather skill" would
                      now be wrong (a `skill` is a different package kind
                      since the 2026-09-05 rename) and "plugin" is jargon
                      on a page written for a parent. */}
                  {/* The opt-in line is only shown for packages, where a
                      manifest really declares it. The hub's own downloads
                      have no per-connection toggle to point at, and
                      labelling them "only if you turn it on" was telling
                      families about a switch that does not exist (code
                      review, 2026-09-05); their "When" line already says
                      exactly what triggers each one. */}
                  {row.sourceKind === "platform"
                    ? "MaiPai Home itself"
                    : `${row.source}${row.optIn ? " · only if you turn it on" : " · part of how the hub runs"}`}
                </p>
              </div>
            )}
          />
        </Section>

        {data.offlinePlugins.length > 0 ? (
          <Section heading="Never leaves your house">
            <div className="flex items-start gap-3 rounded-[var(--radius)] border border-[hsl(var(--border))] p-3">
              <LockIcon className="mt-0.5 h-5 w-5 shrink-0 text-[hsl(var(--muted-foreground))]" aria-hidden />
              <p className="text-base">
                {joinNames(data.offlinePlugins)} work entirely on this computer and connect to nothing at all.
                So does everything MaiPai remembers, every conversation, and every profile in your household.
              </p>
            </div>
          </Section>
        ) : null}

        <Section heading="What we never do">
          <ul className="flex list-none flex-col gap-2 p-0 text-base">
            <li>We do not collect usage information, crash reports, or statistics of any kind.</li>
            <li>Nothing your family says is used to train anything.</li>
            <li>There is no MaiPai account, and no MaiPai server between your hub and anything else.</li>
            <li>When MaiPai does reach the internet, it goes straight there from your house, not through us.</li>
          </ul>
        </Section>
      </div>
    </Page>
  );
}
