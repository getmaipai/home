// The content of a feature's Change sheet (the page renders the kit Sheet around it, rule 9): only models the Stack says can serve it (plus those the household already runs), in the order the Stack
// would try them, each with the Stack's one-line description. "Move to the top" writes the household's order (`engines.<category>.order`,
// empty by default so the Stack's priority applies). Kit parts as shipped (rule 9); no model name lives here.
import { i18n } from "@lingui/core";
import { Button } from "@maipai/ui/src/ui/button";
import { Badge } from "@maipai/ui/src/ui/badge";
import { SheetDescription, SheetHeader, SheetTitle } from "@maipai/ui/src/ui/sheet";
import { Item, ItemContent, ItemDescription, ItemFooter, ItemGroup, ItemTitle } from "@maipai/ui/src/dashboard/components/ui/item";
import type { AiFeatureModel } from "@/lib/api";
import { Dot, priorityTag } from "@/apps/settings/FeatureModelLine";
import { sizeGb } from "../../../../shared/diskPlanMath";

export interface FeatureModelChooserProps {
  title: string;
  models: AiFeatureModel[];
  order: string[];
  busy: boolean;
  onMoveToTop: (id: string) => void;
  onResetOrder: () => void;
  onInstall: (id: string) => void;
}

export function FeatureModelChooser({ title, models, order, busy, onMoveToTop, onResetOrder, onInstall }: FeatureModelChooserProps) {
  return <>
      <SheetHeader>
        <SheetTitle>{i18n._({ id: "Models for {feature}", message: "Models for {feature}", values: { feature: title } })}</SheetTitle>
        <SheetDescription>{i18n._({ id: "Listed in the order Home tries them. Move one to the top to try it first.", message: "Listed in the order Home tries them. Move one to the top to try it first." })}</SheetDescription>
      </SheetHeader>
      <div className="flex flex-col gap-3 overflow-y-auto px-4 pb-4">
        <ItemGroup variant="card" aria-label={i18n._({ id: "Models for {feature}", message: "Models for {feature}", values: { feature: title } })}>
          {models.map((model) => {
            const tag = priorityTag(model.rank);
            const bytes = model.download_bytes || model.size_bytes;
            return <Item key={model.id} data-testid="ai-chooser-option" data-state={model.state}>
              <ItemContent>
                <ItemTitle>{model.state === "ready" ? <Dot tone="ok" /> : null}{model.label}{tag ? <Badge variant="secondary">{tag}</Badge> : null}</ItemTitle>
                {model.description ? <ItemDescription clamp={false}>{model.description}</ItemDescription> : null}
              </ItemContent>
              <ItemFooter>
                {model.state === "missing" || model.state === "failed" ? <Button type="button" variant="outline" size="sm" disabled={busy || model.install_block !== null} onClick={() => onInstall(model.id)}>{model.state === "failed" ? i18n._({ id: "Try again", message: "Try again" }) : bytes > 0 ? i18n._({ id: "Install {size}", message: "Install {size}", values: { size: sizeGb(bytes) } }) : i18n._({ id: "Install", message: "Install" })}</Button> : null}
                {model.rank !== 1 ? <Button type="button" variant="quiet-link" size="sm" disabled={busy} aria-label={i18n._({ id: "Move {name} to the top", message: "Move {name} to the top", values: { name: model.label } })} onClick={() => onMoveToTop(model.id)}>{i18n._({ id: "Move to top", message: "Move to top" })}</Button> : null}
              </ItemFooter>
            </Item>;
          })}
        </ItemGroup>
        {order.length > 0 ? <div><Button type="button" variant="quiet-link" size="sm" disabled={busy} onClick={onResetOrder}>{i18n._({ id: "Use the default order", message: "Use the default order" })}</Button></div> : null}
      </div>
  </>;
}
