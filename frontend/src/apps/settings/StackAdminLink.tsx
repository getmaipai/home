// STACK-MODELS-HOME-01: the Stack has its own admin page with the same models and more settings. Home links to it from Settings, AI and models
// (owners and admins only). The forwarder `/api/ai/stack/admin-link` says which address fits this device: on the computer itself the local address,
// elsewhere the remote one when remote access is on, otherwise no link at all and the Stack's plain reason why.
import { i18n } from "@lingui/core";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@maipai/ui/src/ui/button";
import { requestJson } from "@/lib/api";

const LOCAL_HOSTNAMES = ["localhost", "127.0.0.1", "[::1]", "::1"];

interface AdminLink {
  local_url: string | null;
  remote_url: string | null;
  reason: string | null;
}

export function StackAdminLink({ hostname = window.location.hostname }: { hostname?: string }) {
  const link = useQuery({ queryKey: ["ai-stack-admin-link"], queryFn: () => requestJson<AdminLink>("/api/ai/stack/admin-link") });
  const LABEL = i18n._({ id: "Open Stack admin", message: "Open Stack admin" });
  if (link.isPending || link.isError) return null;
  // On the computer itself prefer the local address; from anywhere else only the remote address reaches the Stack.
  // An empty hostname (same-origin, no host part) is this computer too.
  const onThisComputer = hostname === "" || LOCAL_HOSTNAMES.includes(hostname);
  const href = onThisComputer && link.data.local_url ? link.data.local_url : link.data.remote_url;
  return <div className="flex flex-wrap items-center gap-2">
    {href
      ? <Button asChild variant="outline" size="sm"><a href={href} target="_blank" rel="noopener noreferrer">{LABEL}</a></Button>
      : <>{link.data.reason ? <p className="text-supporting">{link.data.reason}</p> : null}<Button type="button" variant="outline" size="sm" disabled>{LABEL}</Button></>}
  </div>;
}
