// STACK-MENU-SYNC-01: Settings, Stack, General. The one tab with no twin in the Stack's own menu: which Stack Home is connected to, whether it
// answers, its version, and the Manage buttons. Everything shown is read from the Stack on each visit (`/api/ai/stack/general`, which reads the
// Stack's /healthz and /stack/v1/health); Home keeps no copy. A Stack that does not answer is the shared status card with the Stack's own sentence.
import { i18n } from "@lingui/core";
import { type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { StatusCard } from "@maipai/ui/src/elements/status-card";
import { Button } from "@maipai/ui/src/ui/button";
import { Item, ItemContent, ItemDescription, ItemGroup, ItemTitle } from "@maipai/ui/src/dashboard/components/ui/item";
import { stackAdminButton, useStackAdminLink } from "@/apps/settings/StackAdminLink";
import { readStackGeneral, STACK_GENERAL_KEY, stackDownProps } from "@/apps/settings/stack/StackDown";
import type { SettingsViewProps } from "@/shell/pages/settings/settingsViews";

const NOT_ADULT = "Only an adult admin can manage the Stack.";

export function StackGeneral({ person }: SettingsViewProps) {
  const allowed = person.role === "owner" || person.role === "admin";
  const general = useQuery({ queryKey: STACK_GENERAL_KEY, queryFn: readStackGeneral, enabled: allowed, refetchInterval: 15_000 });
  const link = useStackAdminLink();
  const checkNow = () => void general.refetch();
  const wrap = (children: ReactNode) => <div className="flex min-w-0 flex-col gap-4" data-testid="stack-general">{children}</div>;
  if (!allowed) return wrap(<StatusCard kind="info" title={i18n._({ id: NOT_ADULT, message: NOT_ADULT })} />);
  if (general.isError) return wrap(<StatusCard {...stackDownProps({ reason: null, error: general.error, onCheck: checkNow })} />);
  if (!general.data) return null;
  const data = general.data;
  const where = data.where === "this_computer"
    ? i18n._({ id: "This computer", message: "This computer" })
    : i18n._({ id: "Another computer, over your home network or tailnet", message: "Another computer, over your home network or tailnet" });
  return wrap(
    <>
      {!data.reachable
        ? <StatusCard {...stackDownProps({ reason: data.reason, onCheck: checkNow })} />
        : data.problems
          ? <StatusCard kind="attention" title={i18n._({ id: "The Stack is running and lists {count} to look at", message: "The Stack is running and lists {count} to look at", values: { count: data.problems } })} line={i18n._({ id: "Open the Stack admin to see them.", message: "Open the Stack admin to see them." })} />
          : <StatusCard kind="done" title={i18n._({ id: "The Stack is running", message: "The Stack is running" })} />}
      <ItemGroup variant="card">
        <Item size="setting">
          <ItemContent>
            <ItemTitle>{i18n._({ id: "Where it runs", message: "Where it runs" })}</ItemTitle>
            <ItemDescription clamp={false}>{where}</ItemDescription>
          </ItemContent>
        </Item>
        <Item size="setting">
          <ItemContent>
            <ItemTitle>{i18n._({ id: "Stack version", message: "Stack version" })}</ItemTitle>
            <ItemDescription clamp={false}>{data.version ?? i18n._({ id: "Not known while it is not answering", message: "Not known while it is not answering" })}</ItemDescription>
          </ItemContent>
        </Item>
      </ItemGroup>
      <section aria-label={i18n._({ id: "Manage", message: "Manage" })} className="flex flex-col gap-2">
        {link.ready && !link.href && link.reason ? <p className="text-supporting">{link.reason}</p> : null}
        <div className="flex flex-wrap items-center gap-2">
          {stackAdminButton(link.href)}
          <Button type="button" variant="outline" size="sm" disabled={general.isFetching} onClick={checkNow}>{i18n._({ id: "Check now", message: "Check now" })}</Button>
        </div>
      </section>
    </>,
  );
}
