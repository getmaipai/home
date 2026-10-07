import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@maipai/ui/src/dashboard/components/ui/card";
import { AsyncState } from "@maipai/ui/src/primitives/AsyncState";
import { getIcon } from "@maipai/ui/src/icons";
import { api, ApiError, type PrivacyConnection } from "@/lib/api";
import { joinNames, sourceName } from "@/apps/privacy/privacyCopy";
import { useTabItem } from "@/shell/tabIdentity";

export const PrivacyIcon = getIcon("lock");

function Disclosure({ row }: { row: PrivacyConnection }) {
  const inbound = row.direction === "inbound";
  return (
    <article className="flex min-w-0 flex-col gap-1 py-4 first:pt-0 last:pb-0">
      <h2 className="text-base font-semibold">{inbound ? sourceName(row) : row.destination}</h2>
      {inbound ? <p className="text-sm text-muted-foreground"><span className="font-medium text-foreground">Scope:</span> {row.destination}</p> : null}
      <p className="text-sm text-muted-foreground"><span className="font-medium text-foreground">When:</span> {row.when}</p>
      <p className="text-sm text-muted-foreground"><span className="font-medium text-foreground">What it sends:</span> {row.what}</p>
      <p className="text-sm text-muted-foreground"><span className="font-medium text-foreground">Who gets it:</span> {row.who}</p>
      <p className="text-sm text-muted-foreground"><span className="font-medium text-foreground">How long they keep it:</span> {row.retention}</p>
      {!inbound ? <p className="text-sm text-muted-foreground">{row.sourceKind === "platform" ? sourceName(row) : `${row.source}${row.optIn ? " · only if you turn it on" : " · part of how the hub runs"}`}</p> : null}
    </article>
  );
}

function ConnectionGroup({ title, intro, rows, label }: { title: string; intro?: string; rows: PrivacyConnection[]; label: string }) {
  return (
    <Card>
      <CardHeader className="border-b border-border">
        <CardTitle>{title}</CardTitle>
        {intro ? <p className="text-sm text-muted-foreground">{intro}</p> : null}
      </CardHeader>
      <CardContent>
        {rows.length > 0 ? (
          <div role="list" aria-label={label} className="divide-y divide-border">
            {rows.map((row) => <div role="listitem" key={row.id}><Disclosure row={row} /></div>)}
          </div>
        ) : <p className="py-4 text-sm text-muted-foreground">Nothing listed.</p>}
      </CardContent>
    </Card>
  );
}

/** The public, data-driven disclosure page. Its connection rows come
 * from GET /api/privacy, generated from package manifests and hub
 * downloads so network behavior has one source of truth. */
export function PrivacyPage() {
  useTabItem("Privacy");
  const query = useQuery({ queryKey: ["privacy"], queryFn: () => api.privacy() });

  return (
    <div className="flex flex-col gap-4 pb-4">
      <CardHeader className="p-0">
        <CardTitle className="flex items-center gap-2"><PrivacyIcon size={16} className="text-muted-foreground" />Privacy</CardTitle>
      </CardHeader>
      <AsyncState
        data={query.data}
        error={query.isError}
        isFetching={query.isFetching}
        onRetry={() => void query.refetch()}
        errorMessage={query.error instanceof ApiError ? query.error.message : "Could not load the privacy page."}
        loadingLabel="Loading the privacy page"
      >
        {(data) => {
          const outbound = data.connections.filter((row) => row.direction === "outbound");
          const inbound = data.connections.filter((row) => row.direction === "inbound");
          return (
          <>
            <Card>
              <CardHeader className="border-b border-border"><CardTitle>Can someone outside see what we say to MaiPai?</CardTitle></CardHeader>
              <CardContent className="p-5">
                <p className="text-sm">No. Everything you say to MaiPai, everything it remembers, and everyone in your household stays on this computer. It is never sent to us. We do not run a server your family's information passes through, and nothing in MaiPai reports back to us about how you use it.</p>
              </CardContent>
            </Card>

            {inbound.length > 0 ? (
              <ConnectionGroup
                title="Can someone reach into your house?"
                intro="Only if an adult sets it up on purpose, for a specific app or device you choose."
                rows={inbound}
                label="Inbound connections"
              />
            ) : null}

            <ConnectionGroup
              title={`What leaves your house (${outbound.length})`}
              intro="A few things reach the internet, because you asked them to. Every one is listed below, in full. If it is not on this list, it does not happen."
              rows={outbound}
              label="Outbound connections"
            />

            {data.offlinePlugins.length > 0 ? (
              <Card>
                <CardHeader className="border-b border-border"><CardTitle className="flex items-center gap-2"><PrivacyIcon size={16} className="text-muted-foreground" />Never leaves your house</CardTitle></CardHeader>
                <CardContent className="p-5">
                  <p className="text-sm">{joinNames(data.offlinePlugins)} work entirely on this computer and connect to nothing at all. So does everything MaiPai remembers, every conversation, and every profile in your household.</p>
                </CardContent>
              </Card>
            ) : null}

            <Card>
              <CardHeader className="border-b border-border"><CardTitle>What we never do</CardTitle></CardHeader>
              <CardContent className="p-5">
                <ul className="flex list-none flex-col gap-2 p-0 text-sm">
                  <li>We do not collect usage information, crash reports, or statistics of any kind.</li>
                  <li>Nothing your family says is used to train anything.</li>
                  <li>There is no MaiPai account, and no MaiPai server between your hub and anything else.</li>
                  <li>When MaiPai does reach the internet, it goes straight there from your house, not through us.</li>
                </ul>
              </CardContent>
            </Card>
          </>
          );
        }}
      </AsyncState>
    </div>
  );
}
