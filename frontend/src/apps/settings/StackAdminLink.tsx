// STACK-MODELS-HOME-01: the Stack has its own admin page with the same models and more settings. Home links to it from Settings, Stack, General and
// from every Stack tab that has no page of its own yet (STACK-MENU-SYNC-01; owners and admins only). The forwarder `/api/ai/stack/admin-link` says which
// address fits this device: on the computer itself the local address; from any other computer the Stack's own tailnet address, which the Stack reports
// only while it really listens there. When there is no such address the Stack's plain reason is shown, with a one-click way to turn the setting on.
import { i18n } from "@lingui/core";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@maipai/ui/src/ui/button";
import { requestJson } from "@/lib/api";

const LOCAL_HOSTNAMES = ["localhost", "127.0.0.1", "[::1]", "::1"];
const ADMIN_LINK_KEY = ["ai-stack-admin-link"] as const;

interface AdminLink {
  local_url: string | null;
  remote_url: string | null;
  reason: string | null;
  /** "listening", "restart_pending", "no_address", "off" or "unknown" (the Stack could not be asked). */
  remote_state?: string;
  can_turn_on?: boolean;
}

export interface StackAdminLinkState {
  ready: boolean;
  href: string | null;
  reason: string | null;
  canTurnOn: boolean;
  turningOn: boolean;
  turnOn: () => void;
  /** A sentence when turning the setting on failed (the Stack's own words), otherwise null. */
  turnOnError: string | null;
}

/** Where the Stack's admin page is for this device: `href` when there is one, otherwise the Stack's plain `reason` (null while loading or when the question failed). */
export function useStackAdminLink(hostname = window.location.hostname): StackAdminLinkState {
  const client = useQueryClient();
  const link = useQuery({ queryKey: ADMIN_LINK_KEY, queryFn: () => requestJson<AdminLink>("/api/ai/stack/admin-link"), refetchInterval: 15_000 });
  const turn = useMutation({
    mutationFn: () => requestJson<AdminLink>("/api/ai/stack/admin-link/turn-on", { method: "POST", body: JSON.stringify({}), headers: { "content-type": "application/json" } }),
    onSuccess: (next) => client.setQueryData(ADMIN_LINK_KEY, next),
  });
  const idle = { canTurnOn: false, turningOn: false, turnOn: () => {}, turnOnError: null };
  if (link.isPending || link.isError) return { ready: false, href: null, reason: null, ...idle };
  // On the computer itself prefer the local address; from anywhere else only the tailnet address reaches the Stack.
  // An empty hostname (same-origin, no host part) is this computer too.
  const onThisComputer = hostname === "" || LOCAL_HOSTNAMES.includes(hostname);
  const href = (onThisComputer && link.data.local_url ? link.data.local_url : link.data.remote_url) ?? null;
  return {
    ready: true,
    href,
    reason: href ? null : link.data.reason,
    canTurnOn: !href && link.data.can_turn_on === true,
    turningOn: turn.isPending,
    turnOn: () => turn.mutate(),
    turnOnError: turn.isError ? (turn.error instanceof Error ? turn.error.message : i18n._({ id: "Home could not turn that on. Check that the Stack is running, then try again.", message: "Home could not turn that on. Check that the Stack is running, then try again." })) : null,
  };
}

/** The one button that opens the Stack admin's sign-in page in a new tab, or the same button disabled when there is no address for this device. A function, not a component: the button stays the kit Button. */
export function stackAdminButton(href: string | null, label?: string) {
  const text = label ?? i18n._({ id: "Open the Stack admin sign-in page", message: "Open the Stack admin sign-in page" });
  return href
    ? <Button asChild variant="outline" size="sm"><a href={href} target="_blank" rel="noopener noreferrer">{text}</a></Button>
    : <Button type="button" variant="outline" size="sm" disabled>{text}</Button>;
}

/** The sentence that says why there is no link and, when Home can, the button that fixes it. Nothing when there is a link or the question has not been answered. */
export function stackAdminHelp(link: StackAdminLinkState) {
  if (!link.ready || link.href) return null;
  return (
    <>
      {link.reason ? <p className="text-supporting">{link.reason}</p> : null}
      {link.turnOnError ? <p className="text-supporting" role="alert">{link.turnOnError}</p> : null}
      {link.canTurnOn
        ? <div><Button type="button" variant="outline" size="sm" disabled={link.turningOn} onClick={link.turnOn}>{i18n._({ id: "Turn on admin page over Tailscale", message: "Turn on admin page over Tailscale" })}</Button></div>
        : null}
    </>
  );
}

export function StackAdminLink({ hostname = window.location.hostname }: { hostname?: string }) {
  const link = useStackAdminLink(hostname);
  if (!link.ready) return null;
  return <div className="flex flex-col items-start gap-2">
    {stackAdminHelp(link)}
    {stackAdminButton(link.href)}
  </div>;
}
