import { useQuery } from "@tanstack/react-query";
import { Page } from "@/kit/primitives/Page";
import { Section } from "@/kit/primitives/Section";
import { cn, FOCUS_RING } from "@/kit/utils";
import { List } from "@/kit/primitives/List";
import { AsyncState } from "@/kit/primitives/AsyncState";
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

/** One connection row's own four-question disclosure (destination, when,
 * what, who, retention) - shared by every group below so the org's own
 * "each outbound connection... when it happens, what it carries, and who
 * receives it" requirement is answered identically regardless of which
 * heading a row sits under (issue #12's reorganization changes WHICH
 * section a row appears in, never what it says about itself). */
function ConnectionRow({ row }: { row: PrivacyConnection }) {
  return (
    <div className="flex min-w-0 flex-col gap-1 py-1">
      <span className="text-base font-medium">{row.destination}</span>
      <p className="text-base text-muted-foreground">
        <span className="text-foreground">When:</span> {row.when}
      </p>
      <p className="text-base text-muted-foreground">
        <span className="text-foreground">What it sends:</span> {row.what}
      </p>
      <p className="text-base text-muted-foreground">
        <span className="text-foreground">Who gets it:</span> {row.who}
      </p>
      <p className="text-base text-muted-foreground">
        <span className="text-foreground">How long they keep it:</span> {row.retention}
      </p>
      <p className="text-base text-muted-foreground">
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
  );
}

export function PrivacyPage() {
  // TanStack Query already guarantees only the latest request's result is
  // ever committed to `data` - the hand-rolled requestId guard a code
  // review (2026-09-05) added here for exactly that race (the retry
  // button makes a double-fire genuinely reachable, and the slower of two
  // responses winning would show a family a stale list of what leaves
  // their house) is the data layer's job now, not this page's.
  const query = useQuery<{ connections: PrivacyConnection[]; offlinePlugins: string[] }>({
    queryKey: ["privacy"],
    queryFn: () => api.privacy(),
  });

  const LockIcon = getIcon("lock");

  return (
    <Page title="Privacy">
      {/* eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- a keyboard-scrollable region, not a widget (DetailPane.tsx's own precedent). */}
      <div tabIndex={0} className={cn("flex flex-1 flex-col gap-6 overflow-y-auto p-4", FOCUS_RING)}>
        <AsyncState
          data={query.data}
          error={query.isError}
          isFetching={query.isFetching}
          onRetry={() => query.refetch()}
          errorMessage={query.error instanceof ApiError ? query.error.message : "Could not load the privacy page."}
          loadingLabel="Loading the privacy page"
        >
          {(data) => {
            // Issue #12 (Jesse's feedback: "nobody will know what it
            // means" - a flat technical connection log, organized by
            // hostname instead of what a parent actually wants to know).
            // The full per-row disclosure the org standard requires
            // (destination, when, what, who, retention) is unchanged and
            // still shown for every row via ConnectionRow above - this
            // only changes WHICH heading a row sits under. `direction`
            // (issue #12) is a real backend field, not an id string
            // guessed at here, so this can never silently misclassify a
            // row a future connection adds.
            const outbound = data.connections.filter((row) => row.direction === "outbound");
            const inbound = data.connections.filter((row) => row.direction === "inbound");
            return (
              <>
                <Section heading="Can someone outside see what we say to MaiPai?">
                  <p className="text-base">
                    No. Everything you say to MaiPai, everything it remembers, and everyone in your household stays
                    on this computer. It is never sent to us. We do not run a server your family's information
                    passes through, and nothing in MaiPai reports back to us about how you use it.
                  </p>
                </Section>

                {inbound.length > 0 ? (
                  <Section heading="Can someone reach into your house?">
                    <p className="text-base">
                      Only if an adult sets it up on purpose, for a specific app or device you choose.
                    </p>
                    <List items={inbound} getKey={(row) => row.id} label="Inbound connections" renderItem={(row) => <ConnectionRow row={row} />} />
                  </Section>
                ) : null}

                <Section heading={`What leaves your house (${outbound.length})`}>
                  <p className="text-base">
                    A few things reach the internet, because you asked them to. Every one is listed below, in full.
                    If it is not on this list, it does not happen.
                  </p>
                  <List
                    items={outbound}
                    getKey={(row) => row.id}
                    label="Outbound connections"
                    renderItem={(row) => <ConnectionRow row={row} />}
                  />
                </Section>

                {data.offlinePlugins.length > 0 ? (
                  <Section heading="Never leaves your house">
                    <div className="flex items-start gap-3 rounded-lg border border-border p-3">
                      <LockIcon className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" aria-hidden />
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
              </>
            );
          }}
        </AsyncState>
      </div>
    </Page>
  );
}
