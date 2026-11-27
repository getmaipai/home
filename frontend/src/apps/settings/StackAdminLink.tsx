// STACK-MODELS-HOME-01: the Stack has its own admin page with the same models and more settings. Home links to it from Settings, Stack, General and
// from every Stack tab that has no page of its own yet (STACK-MENU-SYNC-01; owners and admins only). The forwarder `/api/ai/stack/admin-link` says which address fits this device: on the computer itself the local address,
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

/** Where the Stack's admin page is for this device: `href` when there is one, otherwise the Stack's plain `reason` (null while loading or when the question failed). */
export function useStackAdminLink(hostname = window.location.hostname): { ready: boolean; href: string | null; reason: string | null } {
  const link = useQuery({ queryKey: ["ai-stack-admin-link"], queryFn: () => requestJson<AdminLink>("/api/ai/stack/admin-link") });
  if (link.isPending || link.isError) return { ready: false, href: null, reason: null };
  // On the computer itself prefer the local address; from anywhere else only the remote address reaches the Stack.
  // An empty hostname (same-origin, no host part) is this computer too.
  const onThisComputer = hostname === "" || LOCAL_HOSTNAMES.includes(hostname);
  return { ready: true, href: (onThisComputer && link.data.local_url ? link.data.local_url : link.data.remote_url) ?? null, reason: link.data.reason };
}

/** The one button that opens the Stack admin in a new tab, or the same button disabled when there is no address for this device. A function, not a component: the button stays the kit Button. */
export function stackAdminButton(href: string | null, label?: string) {
  const text = label ?? i18n._({ id: "Open Stack admin", message: "Open Stack admin" });
  return href
    ? <Button asChild variant="outline" size="sm"><a href={href} target="_blank" rel="noopener noreferrer">{text}</a></Button>
    : <Button type="button" variant="outline" size="sm" disabled>{text}</Button>;
}

export function StackAdminLink({ hostname = window.location.hostname }: { hostname?: string }) {
  const link = useStackAdminLink(hostname);
  if (!link.ready) return null;
  return <div className="flex flex-wrap items-center gap-2">
    {link.href ? stackAdminButton(link.href) : <>{link.reason ? <p className="text-supporting">{link.reason}</p> : null}{stackAdminButton(null)}</>}
  </div>;
}
