// STACK-MODELS-HOME-01: "Who can use each level", the one block of the AI and models page that is Home's alone (people live in Home). It sits in the
// shared page's `extraSections`. Which models a level uses is the Stack's and is changed on the page above; this saves only who may use the level and
// its options, to Home's `engines.<role>.tier.<tier>` setting, and the adult gate switches for made content.
import { i18n } from "@lingui/core";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Button } from "@maipai/ui/src/ui/button";
import { Input } from "@maipai/ui/src/ui/input";
import { Label } from "@maipai/ui/src/ui/label";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@maipai/ui/src/ui/sheet";
import { Switch } from "@maipai/ui/src/ui/switch";
import { Item, ItemActions, ItemContent, ItemGroup, ItemTitle } from "@maipai/ui/src/dashboard/components/ui/item";
import { RadioGroup, RadioGroupItem } from "@maipai/ui/src/dashboard/components/ui/radio-group";
import { Field, FieldContent, FieldLabel } from "@maipai/ui/src/dashboard/components/ui/field";
import type { StackClient } from "@maipai/ui/src/stack/StackClient";
import { api } from "@/lib/api";
import { SLOT_LEVELS_READ } from "../../../../shared/tierSlotOptions";
import { SettingsRenderer } from "@/shell/pages/settings/SettingsRenderer";
import { ACCESS_FEATURES, draftOf, GATE_KEYS, optionDefs, sameDraft, slotKey, toStored, whoChoices, type SlotDraft, type SlotDrafts, type SlotTier, type SlotWho } from "@/apps/settings/levelAccess";

const TIERS: SlotTier[] = ["reduced", "standard", "boost", "max"];
const tierTitle = (tier: SlotTier) => ({ reduced: i18n._({ id: "Reduced", message: "Reduced" }), standard: i18n._({ id: "Standard", message: "Standard" }), boost: i18n._({ id: "Boost", message: "Boost" }), max: i18n._({ id: "Max", message: "Max" }) })[tier];
const whoLabel = (who: SlotWho) => who === "everyone" ? i18n._({ id: "Everyone", message: "Everyone" }) : who === "assigned" ? i18n._({ id: "Assigned", message: "Assigned" }) : i18n._({ id: "Admins and assigned people", message: "Admins and assigned people" });

export function AiLevelAccess({ client }: { client: StackClient }) {
  const queryClient = useQueryClient();
  const [openId, setOpenId] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<SlotDrafts>({});
  const choices = useQuery({ queryKey: ["ai", "stack", "levels"], queryFn: () => client.readChoices(), staleTime: 10_000 });
  const values = useQuery({ queryKey: ["settings", "household"], queryFn: () => api.settingsValues("household") });
  const save = useMutation({
    mutationFn: async ({ role, changed }: { role: string; changed: Array<[SlotTier, SlotDraft]> }) => { await Promise.all(changed.map(([tier, draft]) => api.setSetting("household", slotKey(role, tier), toStored(draft, tier)))); },
    onSuccess: () => { setOpenId(null); void queryClient.invalidateQueries({ queryKey: ["settings", "household"] }); },
  });
  const storedOf = (role: string, tier: SlotTier) => values.data?.find((item) => item.key === slotKey(role, tier))?.value;
  // A tiered category lists its levels; a one-model category (Video, Music) has one Stack level, but Home still keeps who may use Boost and Max there.
  const features = ACCESS_FEATURES.flatMap((feature) => {
    const category = choices.data?.categories.find((item) => item.id === feature.id);
    // CODE-FIX-03: the Stack may not list Coding as a tiered category; Home still keeps who may use its Boost and Max, so Coding shows from its own slot levels.
    if (!category && feature.id === "coding" && choices.data) return [{ ...feature, label: i18n._({ id: "Coding", message: "Coding" }), levels: (SLOT_LEVELS_READ.coding ?? ["standard"]).map((tier) => ({ tier: tier as SlotTier, off: false })) }];
    if (!category) return [];
    const levels = category.tiered ? category.tiers.map((row) => ({ tier: row.tier as SlotTier, off: row.chosen_by === "off" })) : (SLOT_LEVELS_READ[feature.category] ?? ["standard"]).map((tier) => ({ tier: tier as SlotTier, off: false }));
    return [{ ...feature, label: category.label, levels }];
  });
  if (features.length === 0) return null;
  const open = features.find((feature) => feature.id === openId) ?? null;
  const begin = (id: string) => { const feature = features.find((item) => item.id === id)!; setDrafts(Object.fromEntries(TIERS.filter((tier) => feature.levels.some((level) => level.tier === tier)).map((tier) => [tier, draftOf(storedOf(feature.role, tier), tier)])) as SlotDrafts); setOpenId(id); };
  const defs = open ? optionDefs(open.category) : [];
  const gateKeys = open ? GATE_KEYS[open.id] ?? [] : [];
  return <>
    <ItemGroup variant="card" aria-label={i18n._({ id: "Who can use each level", message: "Who can use each level" })} data-testid="ai-level-access">
      {features.map((feature) => <Item key={feature.id} data-testid={`ai-access-feature-${feature.id}`}>
        <ItemContent><ItemTitle>{feature.label}</ItemTitle></ItemContent>
        <ItemActions><Button type="button" variant="outline" size="sm" aria-label={i18n._({ id: "Who can use each {feature} level", message: "Who can use each {feature} level", values: { feature: feature.label } })} onClick={() => begin(feature.id)}>{i18n._({ id: "Set access", message: "Set access" })}</Button></ItemActions>
      </Item>)}
    </ItemGroup>
    <Sheet open={open !== null} onOpenChange={(next) => { if (!next) setOpenId(null); }}>
      {open ? <SheetContent side="right" data-testid="ai-access-sheet">
        <SheetHeader><SheetTitle>{i18n._({ id: "{name} details", message: "{name} details", values: { name: open.label } })}</SheetTitle><SheetDescription>{i18n._({ id: "Choose who can use each level and its options.", message: "Choose who can use each level and its options." })}</SheetDescription></SheetHeader>
        <div className="flex flex-col gap-5 overflow-y-auto px-4">
          {open.levels.filter((level) => drafts[level.tier]).map((level) => <LevelAccess key={level.tier} tier={level.tier} off={level.off} draft={drafts[level.tier]!} defs={defs}
            onWho={(who) => setDrafts((old) => ({ ...old, [level.tier]: { ...old[level.tier]!, who } }))}
            onOption={(id, value) => setDrafts((old) => ({ ...old, [level.tier]: { ...old[level.tier]!, options: { ...old[level.tier]!.options, [id]: value } } }))} />)}
          {gateKeys.length ? <section aria-label={i18n._({ id: "Adult gate", message: "Adult gate" })}><SettingsRenderer scope="household" scopeValue="household" includeKeys={gateKeys} titleOverrides={{ "household.media_pictures": i18n._({ id: "Adult gate", message: "Adult gate" }), "household.media_videos": i18n._({ id: "Adult gate", message: "Adult gate" }), "household.media_music": i18n._({ id: "Adult gate", message: "Adult gate" }), "household.media_kids": i18n._({ id: "Children", message: "Children" }) }} /></section> : null}
        </div>
        <div className="flex justify-end gap-2 p-4">
          <Button type="button" variant="outline" onClick={() => setOpenId(null)}>{i18n._({ id: "Cancel", message: "Cancel" })}</Button>
          <Button type="button" disabled={save.isPending} onClick={() => save.mutate({ role: open.role, changed: (Object.entries(drafts) as Array<[SlotTier, SlotDraft]>).filter(([tier, draft]) => !sameDraft(draftOf(storedOf(open.role, tier), tier), draft)) })}>{i18n._({ id: "Save", message: "Save" })}</Button>
        </div>
      </SheetContent> : null}
    </Sheet>
  </>;
}

/** One level: compact radio rows for who may use it and the options it carries. A level switched off on the page above is one plain line. */
function LevelAccess({ tier, off, draft, defs, onWho, onOption }: { tier: SlotTier; off: boolean; draft: SlotDraft; defs: ReturnType<typeof optionDefs>; onWho: (who: SlotWho) => void; onOption: (id: string, value: boolean | number) => void }) {
  return <section className="flex flex-col gap-2" data-testid={`ai-access-${tier}`}>
    <h3 className="font-medium">{tierTitle(tier)}</h3>
    {off ? <p className="text-supporting text-muted-foreground">{i18n._({ id: "Off. Turn it on from the model list above.", message: "Off. Turn it on from the model list above." })}</p> : <>
      <p className="text-supporting">{i18n._({ id: "Who can use it", message: "Who can use it" })}</p>
      <RadioGroup value={draft.who} aria-label={i18n._({ id: "Who can use {tier}", message: "Who can use {tier}", values: { tier: tierTitle(tier) } })} onValueChange={(who) => onWho(who as SlotWho)}>
        {whoChoices(tier).map((who) => <div key={who} className="flex items-center gap-2"><RadioGroupItem value={who} id={`who-${tier}-${who}`} /><Label htmlFor={`who-${tier}-${who}`}>{whoLabel(who)}</Label></div>)}
      </RadioGroup>
      {defs.map((def) => <Field key={def.id} orientation="horizontal"><FieldContent><FieldLabel>{def.label}</FieldLabel></FieldContent>{def.type === "boolean" ? <Switch checked={draft.options[def.id] === true} aria-label={def.label} onCheckedChange={(value) => onOption(def.id, value)} /> : <Input type="number" min={def.min} max={def.max} value={String(draft.options[def.id] ?? def.default)} onChange={(event) => onOption(def.id, Number(event.target.value))} />}</Field>)}
    </>}
  </section>;
}
