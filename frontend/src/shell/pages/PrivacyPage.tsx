import { i18n } from "@lingui/core";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@maipai/ui/src/dashboard/components/ui/card";
import { AsyncState } from "@maipai/ui/src/primitives/AsyncState";
import { getIcon } from "@maipai/ui/src/icons";
import { api, type PrivacyConnection } from "@/lib/api";
import { joinNames, sourceName } from "@/apps/privacy/privacyCopy";
import { useTabItem } from "@/shell/tabIdentity";
import { errorLine } from "@/lib/hubReachability";

export const PrivacyIcon = getIcon("lock");

function Disclosure({ row }: { row: PrivacyConnection }) {
  const inbound = row.direction === "inbound";
  return (
    <article className="flex min-w-0 flex-col gap-2 py-4 first:pt-0 last:pb-0">
      <h2 className="text-row font-semibold">{inbound ? sourceName(row) : row.destination}</h2>
      <dl className="flex flex-col gap-2">
        {([
          ...(inbound ? [[i18n._({ id: "Scope:", message: "Scope:" }), row.destination] as const] : []),
          [i18n._({ id: "When:", message: "When:" }), row.when],
          [i18n._({ id: "What it sends:", message: "What it sends:" }), row.what],
          [i18n._({ id: "Who gets it:", message: "Who gets it:" }), row.who],
          [i18n._({ id: "How long they keep it:", message: "How long they keep it:" }), row.retention],
        ] as const).map(([label, value]) => <div key={label} className="flex min-w-0 flex-col"><dt className="text-badge font-medium text-foreground">{label}</dt><dd className="text-supporting text-muted-foreground">{value}</dd></div>)}
      </dl>
      {!inbound ? <p className="text-supporting text-muted-foreground">{row.sourceKind === "platform" ? sourceName(row) : (row.optIn ? i18n._({ id: "{source} · only if you turn it on", message: "{source} · only if you turn it on", values: { source: row.source } }) : i18n._({ id: "{source} · part of how the hub runs", message: "{source} · part of how the hub runs", values: { source: row.source } }))}</p> : null}
    </article>
  );
}

/** The disclosure rows inside a group's card; the page owns the Card. */
function ConnectionRows({ rows, label }: { rows: PrivacyConnection[]; label: string }) {
  return rows.length > 0 ? (
    <div role="list" aria-label={label} className="divide-y divide-border">
      {rows.map((row) => <div role="listitem" key={row.id}><Disclosure row={row} /></div>)}
    </div>
  ) : <p className="py-4 text-supporting text-muted-foreground">{i18n._({ id: "Nothing listed.", message: "Nothing listed." })}</p>;
}

/** The public, data-driven disclosure page. Its connection rows come
 * from GET /api/privacy, generated from package manifests and hub
 * downloads so network behavior has one source of truth. */
export function PrivacyPage() {
  useTabItem(i18n._({ id: "Privacy", message: "Privacy" }));
  const query = useQuery({ queryKey: ["privacy"], queryFn: () => api.privacy() });

  return (
    <div className="flex flex-col gap-4 pb-4">
      <AsyncState
        data={query.data}
        error={query.isError}
        isFetching={query.isFetching}
        onRetry={() => void query.refetch()}
        errorMessage={errorLine(query.error, i18n._({ id: "Could not load the privacy page.", message: "Could not load the privacy page." }))}
        loadingLabel={i18n._({ id: "Loading the privacy page", message: "Loading the privacy page" })}
      >
        {(data) => {
          const outbound = data.connections.filter((row) => row.direction === "outbound");
          const inbound = data.connections.filter((row) => row.direction === "inbound");
          return (
          <>
            <Card>
              <CardHeader><CardTitle className="text-row">{i18n._({ id: "Can someone outside see what we say to MaiPai?", message: "Can someone outside see what we say to MaiPai?" })}</CardTitle></CardHeader>
              <CardContent>
                <p className="text-supporting">{i18n._({ id: "No. Everything you say to MaiPai, everything it remembers, and everyone in your household stays on this computer. It is never sent to us. We do not run a server your family's information passes through, and nothing in MaiPai reports back to us about how you use it.", message: "No. Everything you say to MaiPai, everything it remembers, and everyone in your household stays on this computer. It is never sent to us. We do not run a server your family's information passes through, and nothing in MaiPai reports back to us about how you use it." })}</p>
              </CardContent>
            </Card>

            {inbound.length > 0 ? (
              <Card>
                <CardHeader>
                  <CardTitle className="text-row">{i18n._({ id: "Can someone reach into your house?", message: "Can someone reach into your house?" })}</CardTitle>
                  <p className="text-supporting text-muted-foreground">{i18n._({ id: "Only if an adult sets it up on purpose, for a specific app or device you choose.", message: "Only if an adult sets it up on purpose, for a specific app or device you choose." })}</p>
                </CardHeader>
                <CardContent><ConnectionRows rows={inbound} label={i18n._({ id: "Inbound connections", message: "Inbound connections" })} /></CardContent>
              </Card>
            ) : null}

            <Card>
              <CardHeader>
                <CardTitle className="text-row">{i18n._({ id: "What leaves your house ({count})", message: "What leaves your house ({count})", values: { count: outbound.length } })}</CardTitle>
                <p className="text-supporting text-muted-foreground">{i18n._({ id: "A few things reach the internet, because you asked them to. Every one is listed below, in full. If it is not on this list, it does not happen.", message: "A few things reach the internet, because you asked them to. Every one is listed below, in full. If it is not on this list, it does not happen." })}</p>
              </CardHeader>
              <CardContent><ConnectionRows rows={outbound} label={i18n._({ id: "Outbound connections", message: "Outbound connections" })} /></CardContent>
            </Card>

            {data.offlinePlugins.length > 0 ? (
              <Card>
                <CardHeader><CardTitle className="text-row"><PrivacyIcon size={16} className="mr-2 inline text-muted-foreground" />{i18n._({ id: "Never leaves your house", message: "Never leaves your house" })}</CardTitle></CardHeader>
                <CardContent>
                  <p className="text-supporting">{i18n._({ id: "{joinNames} work entirely on this computer and connect to nothing at all. So does everything MaiPai remembers, every conversation, and every profile in your household.", message: "{joinNames} work entirely on this computer and connect to nothing at all. So does everything MaiPai remembers, every conversation, and every profile in your household.", values: { joinNames: joinNames(data.offlinePlugins) } })}</p>
                </CardContent>
              </Card>
            ) : null}

            <Card>
              <CardHeader><CardTitle className="text-row">{i18n._({ id: "What we never do", message: "What we never do" })}</CardTitle></CardHeader>
              <CardContent>
                <ul className="flex list-none flex-col gap-2 p-0 text-supporting">
                  <li>{i18n._({ id: "We do not collect usage information, crash reports, or statistics of any kind.", message: "We do not collect usage information, crash reports, or statistics of any kind." })}</li>
                  <li>{i18n._({ id: "Nothing your family says is used to train anything.", message: "Nothing your family says is used to train anything." })}</li>
                  <li>{i18n._({ id: "There is no MaiPai account, and no MaiPai server between your hub and anything else.", message: "There is no MaiPai account, and no MaiPai server between your hub and anything else." })}</li>
                  <li>{i18n._({ id: "When MaiPai does reach the internet, it goes straight there from your house, not through us.", message: "When MaiPai does reach the internet, it goes straight there from your house, not through us." })}</li>
                </ul>
              </CardContent>
            </Card>

            <Card>
              <CardHeader><CardTitle className="text-row">{i18n._({ id: "When someone is removed", message: "When someone is removed" })}</CardTitle></CardHeader>
              <CardContent>
                <p className="mb-3 text-supporting">{i18n._({ id: "Their memories, conversations, settings and private files are deleted right away.", message: "Their memories, conversations, settings and private files are deleted right away." })}</p>
                <ul className="flex list-none flex-col gap-2 p-0 text-supporting">
                  <li>{i18n._({ id: "Older backups can keep their data for up to three months. Restoring a whole older backup brings them back.", message: "Older backups can keep their data for up to three months. Restoring a whole older backup brings them back." })}</li>
                  <li>{i18n._({ id: "The hub's logs still mention them, without anything they said, for 7 days.", message: "The hub's logs still mention them, without anything they said, for 7 days." })}</li>
                  <li>{i18n._({ id: "Label exports are made only when an operator runs the export tool. Names are replaced, and exports stay until someone deletes them.", message: "Label exports are made only when an operator runs the export tool. Names are replaced, and exports stay until someone deletes them." })}</li>
                  <li>{i18n._({ id: "App folders keep whatever an installed app saved until that app is removed.", message: "App folders keep whatever an installed app saved until that app is removed." })}</li>
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
