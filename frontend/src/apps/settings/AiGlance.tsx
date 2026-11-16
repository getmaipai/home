import { i18n } from "@lingui/core";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Badge } from "@maipai/ui/src/ui/badge";
import { Button } from "@maipai/ui/src/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@maipai/ui/src/ui/dialog";
import { Item, ItemActions, ItemContent, ItemDescription, ItemGroup, ItemTitle } from "@maipai/ui/src/dashboard/components/ui/item";
import { Input } from "@maipai/ui/src/ui/input";
import { getIcon } from "@maipai/ui/src/icons";
import { STATUS_TONE_BG, type StatusTone } from "@maipai/ui/src/ui/status-colors";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@maipai/ui/src/ui/sheet";
import { Switch } from "@maipai/ui/src/ui/switch";
import { RadioGroup, RadioGroupItem } from "@maipai/ui/src/dashboard/components/ui/radio-group";
import { Field, FieldContent, FieldLabel, FieldTitle } from "@maipai/ui/src/dashboard/components/ui/field";
import { api, type AiOverviewFeature, type AiOverviewHelper, type AiOverviewLevel, type AiOverviewState } from "@/lib/api";
import type { SettingsViewProps } from "@/shell/pages/settings/settingsViews";
import { sizeGb } from "../../../../shared/diskPlanMath";
import { draftOf, optionDefs, toStored, whoChoices, type SlotDrafts, type SlotWho } from "@/apps/settings/aiTierSlots";
import { sameDraft } from "@/apps/settings/aiTierSlots";
import { SettingsRenderer } from "@/shell/pages/settings/SettingsRenderer";

type Tier = AiOverviewLevel["tier"];
type State = AiOverviewState;
type Level = AiOverviewLevel;
type Feature = AiOverviewFeature;
const overviewKey = ["ai", "overview"] as const;
const SLOT: Record<string, { role: string; category: string }> = { chat: { role: "chat", category: "chat" }, pictures: { role: "image", category: "image" }, videos: { role: "video", category: "video" }, music: { role: "music", category: "music" }, voice: { role: "tts", category: "voice" } };
const FEATURE_SWITCH: Record<string, { key: string; invert?: boolean }> = { chat: { key: "chat.paused", invert: true }, videos: { key: "generation.video.enabled" }, music: { key: "generation.music.enabled" }, vision: { key: "vision.on_request.enabled" }, coding: { key: "coding.enabled" } };
const ICON: Record<string, string> = { chat: "message-square", pictures: "palette", videos: "film", music: "music", voice: "mic-vocal", vision: "eye", coding: "code" };
const ORDER = ["chat", "pictures", "videos", "music", "voice", "vision", "coding"];
const tiers: Tier[] = ["reduced", "standard", "boost", "max"];
const word = (state: State) => ({ ready: i18n._({ id: "Ready", message: "Ready" }), missing: i18n._({ id: "Missing", message: "Missing" }), problem: i18n._({ id: "Problem", message: "Problem" }), off: i18n._({ id: "Off", message: "Off" }), unset: i18n._({ id: "Not set", message: "Not set" }), waits: i18n._({ id: "Waiting", message: "Waiting" }), same: i18n._({ id: "Same as Standard", message: "Same as Standard" }) })[state];
const tierTitle = (tier: Tier) => ({ reduced: i18n._({ id: "Reduced", message: "Reduced" }), standard: i18n._({ id: "Standard", message: "Standard" }), boost: i18n._({ id: "Boost", message: "Boost" }), max: i18n._({ id: "Max", message: "Max" }) })[tier];
const tone = (state: State): StatusTone => state === "problem" ? "error" : state === "missing" ? "warning" : state === "ready" || state === "same" ? "ok" : "unknown";
const worst = (states: State[]): StatusTone => states.some((state) => state === "problem") ? "error" : states.some((state) => state === "missing") ? "warning" : states.length > 0 && states.every((state) => state === "off") ? "unknown" : "ok";
const modelName = (level: Level) => level.model_label ? (level.automatic ? i18n._({ id: "Automatic: {model}", message: "Automatic: {model}", values: { model: level.model_label } }) : level.model_label) : null;
const Dot = ({ tone: t }: { tone: StatusTone }) => <span aria-hidden="true" className={`inline-block size-2 shrink-0 rounded-full ${STATUS_TONE_BG[t]}`} />;

/** What a feature runs now, in one line: "Standard: Muse Glimmer 30B, Ready", plus any level that needs attention. */
function summaryOf(feature: Feature | undefined, helpers: AiOverviewHelper[]): string {
  if (feature) {
    const standard = feature.levels.find((level) => level.tier === "standard") ?? feature.levels[0];
    const trouble = feature.levels.filter((level) => level !== standard && (level.state === "problem" || level.state === "missing"));
    const head = standard ? i18n._({ id: "{level}: {model}, {state}", message: "{level}: {model}, {state}", values: { level: tierTitle(standard.tier), model: standard.model_label ?? standard.detail ?? word(standard.state), state: word(standard.state).toLowerCase() } }) : "";
    return trouble.length ? `${head} · ${trouble.map((level) => i18n._({ id: "{level} needs attention", message: "{level} needs attention", values: { level: tierTitle(level.tier) } })).join(", ")}` : head;
  }
  const first = helpers[0];
  return first ? i18n._({ id: "{name}: {state}", message: "{name}: {state}", values: { name: first.name, state: word(first.state).toLowerCase() } }) : "";
}

export function AiGlance(_props: SettingsViewProps) {
  const qc = useQueryClient();
  const [openId, setOpenId] = useState<string | null>(null);
  const [details, setDetails] = useState<Feature | null>(null);
  const [drafts, setDrafts] = useState<SlotDrafts | null>(null);
  const [picking, setPicking] = useState<{ feature: Feature; level: Level } | null>(null);
  const overview = useQuery({ queryKey: overviewKey, queryFn: () => api.aiFeaturesOverview() });
  const values = useQuery({ queryKey: ["settings", "household"], queryFn: () => api.settingsValues("household") });
  const refresh = () => { void qc.invalidateQueries({ queryKey: overviewKey }); void qc.invalidateQueries({ queryKey: ["ai", "choices"] }); void qc.invalidateQueries({ queryKey: ["settings", "household"] }); void qc.invalidateQueries({ queryKey: ["components"] }); };
  const put = useMutation({ mutationFn: ({ key, value }: { key: string; value: unknown }) => api.setSetting("household", key, value), onSuccess: refresh });
  const installPart = useMutation({ mutationFn: (id: string) => api.installComponent(id), onSuccess: refresh });
  const pickModel = useMutation({ mutationFn: ({ feature, tier, model }: { feature: string; tier: Tier; model: string }) => api.aiInstallLevel(feature, tier, model), onSuccess: () => { setPicking(null); refresh(); } });
  const data = overview.data;
  if (!data) return <p>{i18n._({ id: "Loading features…", message: "Loading features…" })}</p>;
  const stored = (key: string) => values.data?.find((item) => item.key === key)?.value;
  const slotKeyOf = (feature: Feature, tier: Tier) => `engines.${SLOT[feature.id]?.role}.tier.${tier}`;
  const slotOptions = (feature: Feature, tier: Tier) => (stored(slotKeyOf(feature, tier)) as { options?: unknown } | undefined)?.options ?? {};
  const setLevelModel = (feature: Feature, tier: Tier, model: string) => put.mutate({ key: slotKeyOf(feature, tier), value: { model, options: slotOptions(feature, tier) } });
  const rows = ORDER.map((id) => ({ id, feature: data.features.find((item) => item.id === id), helpers: data.helpers.filter((helper) => helper.parent === id) })).filter((row) => row.feature || row.helpers.length > 0);
  const nameOf = (id: string, feature?: Feature) => feature?.name ?? ({ vision: i18n._({ id: "Vision", message: "Vision" }), coding: i18n._({ id: "Coding", message: "Coding" }) } as Record<string, string>)[id] ?? id;
  const submitDetails = async (feature: Feature, drafts: SlotDrafts) => {
    const spec = SLOT[feature.id];
    if (!spec) return;
    const present = new Set(feature.levels.map((level) => level.tier));
    const slots = tiers.filter((tier) => present.has(tier) && !sameDraft(draftOf(values.data?.find((item) => item.key === `engines.${spec.role}.tier.${tier}`)?.value, tier), drafts[tier]));
    await Promise.all(slots.map((tier) => api.setSetting("household", `engines.${spec.role}.tier.${tier}`, toStored(drafts[tier], tier)))); refresh(); setDetails(null);
  };
  const defs = optionDefs(details ? SLOT[details.id]?.category ?? "" : "");
  const gateKeys = !details ? [] : details.id === "pictures" ? ["generation.adults", "generation.kids"] : details.id === "videos" ? ["generation.video.adult_adapters"] : details.id === "music" ? ["generation.music.enabled"] : [];
  return <section className="flex flex-col gap-4" data-testid="ai-features">
    <p className="text-supporting text-muted-foreground" data-testid="ai-right-now">{data.right_now.engine === "ready" ? i18n._({ id: "AI is ready", message: "AI is ready" }) : i18n._({ id: "AI needs attention", message: "AI needs attention" })} · {i18n._({ id: "{memory} free memory · {models} in models · {disk} free disk · {count} downloads waiting", message: "{memory} free memory · {models} in models · {disk} free disk · {count} downloads waiting", values: { memory: sizeGb(data.right_now.memory_free_bytes), models: sizeGb(data.right_now.models_bytes), disk: sizeGb(data.right_now.disk_free_bytes), count: data.right_now.waiting } })}</p>
    <div className="divide-y rounded-xl border" data-testid="ai-feature-list">{rows.map(({ id, feature, helpers }) => {
      const Icon = getIcon(ICON[id] ?? "sparkles");
      const featureSwitch = FEATURE_SWITCH[id]; const raw = featureSwitch ? stored(featureSwitch.key) : undefined; const enabled = featureSwitch ? Boolean(featureSwitch.invert ? !raw : raw ?? true) : true;
      const open = openId === id; const name = nameOf(id, feature);
      const dot = enabled ? worst([...(feature?.levels.map((level) => level.state) ?? []), ...helpers.map((helper) => helper.state === "missing" ? "ready" as State : helper.state)].filter((state) => state !== "unset")) : "unknown";
      return <div key={id} data-testid="ai-feature-card">
        <div className="flex items-center gap-3 px-4 py-3">
          <div className="min-w-0 flex-1"><Button type="button" variant="ghost" height="auto" width="full" align="start" wrap="wrap" aria-expanded={open} aria-label={name} onClick={() => setOpenId(open ? null : id)}>
            <Icon className="size-5 shrink-0 text-muted-foreground" aria-hidden="true" />
            <span className="min-w-0 flex-1"><span className="block font-medium">{name}</span><span className="block text-supporting text-muted-foreground" data-testid="ai-feature-summary">{enabled ? summaryOf(feature, helpers) : i18n._({ id: "Off", message: "Off" })}</span></span>
            <Dot tone={dot} />
          </Button></div>
          {featureSwitch ? <Switch checked={enabled} onCheckedChange={(checked) => put.mutate({ key: featureSwitch.key, value: featureSwitch.invert ? !checked : checked })} aria-label={i18n._({ id: "{name} on or off", message: "{name} on or off", values: { name } })} /> : null}
        </div>
        {open ? <div className="flex flex-col gap-4 px-4 pb-4" data-testid="ai-feature-body">
          {feature ? <ul className="flex flex-col divide-y" data-testid="ai-level-list" aria-label={i18n._({ id: "{name} levels", message: "{name} levels", values: { name } })}>{feature.levels.map((level) => <LevelRow key={level.tier} feature={feature} level={level} featureOn={enabled} busy={put.isPending || installPart.isPending} onChange={() => setPicking({ feature, level })} onInstall={() => level.model_id && installPart.mutate(level.model_id)} onSwitch={(on) => setLevelModel(feature, level.tier, on ? "recommended" : "off")} />)}</ul> : null}
          {helpers.length ? <div className="flex flex-col gap-1" data-testid="ai-helpers"><h3 className="text-supporting font-medium text-muted-foreground">{i18n._({ id: "Helpers", message: "Helpers" })}</h3><ul className="flex flex-col divide-y">{helpers.map((helper) => <li key={helper.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 py-2" data-testid="ai-helper-row"><div className="min-w-0 flex-1"><span className="block font-medium">{helper.name}</span>{helper.model_label ? <span className="block truncate text-supporting text-muted-foreground">{helper.model_label}</span> : null}</div><span className="flex items-center gap-1.5 text-supporting text-muted-foreground"><Dot tone={tone(helper.state)} />{word(helper.state)}</span>{helper.action && helper.component_id ? <Button type="button" variant="outline" size="sm" disabled={installPart.isPending} onClick={() => installPart.mutate(helper.component_id!)}>{helper.action.kind === "fix" ? i18n._({ id: "Fix", message: "Fix" }) : helper.size_bytes_missing ? i18n._({ id: "Install {size}", message: "Install {size}", values: { size: sizeGb(helper.size_bytes_missing) } }) : i18n._({ id: "Install", message: "Install" })}</Button> : null}</li>)}</ul></div> : null}
          {feature && SLOT[id] ? <div><Button type="button" variant="ghost" size="sm" onClick={() => { const spec = SLOT[feature.id]; setDrafts(Object.fromEntries(tiers.map((tier) => [tier, draftOf(stored(`engines.${spec?.role}.tier.${tier}`), tier)])) as SlotDrafts); setDetails(feature); }}>{i18n._({ id: "Who can use each level", message: "Who can use each level" })}</Button></div> : null}
        </div> : null}
      </div>;
    })}</div>
    <Dialog open={picking !== null} onOpenChange={(open) => { if (!open) setPicking(null); }}>
      {picking ? <DialogContent data-testid="ai-model-picker">
        <DialogHeader>
          <DialogTitle>{i18n._({ id: "Choose a model for {level}", message: "Choose a model for {level}", values: { level: `${picking.feature.name}, ${tierTitle(picking.level.tier)}` } })}</DialogTitle>
          <DialogDescription>{i18n._({ id: "Only models that fit this level on this computer are listed.", message: "Only models that fit this level on this computer are listed." })}</DialogDescription>
        </DialogHeader>
        <ItemGroup variant="card" aria-label={i18n._({ id: "Models for this level", message: "Models for this level" })}>
          <Item>
            <ItemContent><ItemTitle>{i18n._({ id: "Use automatic", message: "Use automatic" })}</ItemTitle><ItemDescription>{i18n._({ id: "Home uses the best model that fits this level.", message: "Home uses the best model that fits this level." })}</ItemDescription></ItemContent>
            <ItemActions>{picking.level.automatic ? <Badge variant="secondary">{i18n._({ id: "In use", message: "In use" })}</Badge> : <Button type="button" variant="outline" size="sm" disabled={put.isPending} onClick={() => { setLevelModel(picking.feature, picking.level.tier, "recommended"); setPicking(null); }}>{i18n._({ id: "Use automatic", message: "Use automatic" })}</Button>}</ItemActions>
          </Item>
          {picking.level.options.map((option) => {
            const inUse = !picking.level.automatic && picking.level.model_id === option.id;
            return <Item key={option.id} data-testid="ai-model-option">
              <ItemContent><ItemTitle>{option.label}{option.suggested ? <Badge variant="secondary">{i18n._({ id: "Suggested", message: "Suggested" })}</Badge> : null}</ItemTitle><ItemDescription>{[option.good_at, option.installed ? i18n._({ id: "Installed", message: "Installed" }) : null, option.size_bytes ? sizeGb(option.size_bytes) : null].filter(Boolean).join(" · ")}</ItemDescription></ItemContent>
              <ItemActions>{inUse ? <Badge variant="secondary">{i18n._({ id: "In use", message: "In use" })}</Badge> : <Button type="button" variant="outline" size="sm" disabled={pickModel.isPending} onClick={() => pickModel.mutate({ feature: picking.feature.id, tier: picking.level.tier, model: option.id })}>{option.installed ? i18n._({ id: "Use", message: "Use" }) : option.size_bytes ? i18n._({ id: "Install {size}", message: "Install {size}", values: { size: sizeGb(option.size_bytes) } }) : i18n._({ id: "Install", message: "Install" })}</Button>}</ItemActions>
            </Item>;
          })}
        </ItemGroup>
      </DialogContent> : null}
    </Dialog>
    <Sheet open={details !== null && drafts !== null} onOpenChange={(open) => { if (!open) setDetails(null); }}>{details && drafts ? (<SheetContent side="right"><SheetHeader><SheetTitle>{i18n._({ id: "{name} details", message: "{name} details", values: { name: details.name } })}</SheetTitle><SheetDescription>{i18n._({ id: "Choose who can use each level and its options.", message: "Choose who can use each level and its options." })}</SheetDescription></SheetHeader><div className="flex flex-col gap-5 overflow-y-auto px-4">{tiers.filter((tier) => details.levels.some((level) => level.tier === tier)).map((tier) => <section key={tier} className="flex flex-col gap-2"><h3 className="font-medium">{tierTitle(tier)}</h3><p className="text-supporting">{i18n._({ id: "Who can use it", message: "Who can use it" })}</p><RadioGroup value={drafts[tier].who} aria-label={i18n._({ id: "Who can use {tier}", message: "Who can use {tier}", values: { tier: tierTitle(tier) } })} onValueChange={(who) => setDrafts((old) => old &&  ({ ...old, [tier]: { ...old[tier], who: who as SlotWho } }))}>{whoChoices(tier).map((who) => <FieldLabel key={who}><RadioGroupItem value={who} /><Field><FieldContent><FieldTitle>{who === "everyone" ? i18n._({ id: "Everyone", message: "Everyone" }) : who === "assigned" ? i18n._({ id: "Assigned", message: "Assigned" }) : i18n._({ id: "Admins and assigned people", message: "Admins and assigned people" })}</FieldTitle></FieldContent></Field></FieldLabel>)}</RadioGroup>{defs.map((def) => <Field key={def.id} orientation="horizontal"><FieldContent><FieldLabel>{def.label}</FieldLabel></FieldContent>{def.type === "boolean" ? <Switch checked={drafts[tier].options[def.id] === true} aria-label={def.label} onCheckedChange={(value) => setDrafts((old) => old &&  ({ ...old, [tier]: { ...old[tier], options: { ...old[tier].options, [def.id]: value } } }))} /> : <Input type="number" min={def.min} max={def.max} value={String(drafts[tier].options[def.id] ?? def.default)} onChange={(event) => setDrafts((old) => old &&  ({ ...old, [tier]: { ...old[tier], options: { ...old[tier].options, [def.id]: Number(event.target.value) } } }))} />}</Field>)}</section>)}{gateKeys.length ? <section aria-label={i18n._({ id: "Adult gate", message: "Adult gate" })}><SettingsRenderer scope="household" scopeValue="household" includeKeys={gateKeys} titleOverrides={{ "household.media_pictures": i18n._({ id: "Adult gate", message: "Adult gate" }), "household.media_videos": i18n._({ id: "Adult gate", message: "Adult gate" }), "household.media_music": i18n._({ id: "Adult gate", message: "Adult gate" }) }} /></section> : null}</div><div className="flex justify-end gap-2 p-4"><Button type="button" variant="outline" onClick={() => setDetails(null)}>{i18n._({ id: "Cancel", message: "Cancel" })}</Button><Button type="button" onClick={() => submitDetails(details, drafts)}>{i18n._({ id: "Save", message: "Save" })}</Button></div></SheetContent>) : null}</Sheet>
  </section>;
}

function LevelRow({ feature, level, featureOn, busy, onChange, onInstall, onSwitch }: { feature: Feature; level: Level; featureOn: boolean; busy: boolean; onChange: () => void; onInstall: () => void; onSwitch: (on: boolean) => void }) {
  const name = modelName(level);
  const fixable = level.action && level.model_id;
  const hasSwitch = level.tier !== "standard" && level.state !== "same" && level.state !== "waits" && (level.can_choose || level.state === "off");
  return <li className={`grid grid-cols-[1fr_auto] gap-x-3 gap-y-1 py-3 sm:grid-cols-[5rem_1fr_auto_auto] sm:items-center sm:gap-x-4 ${featureOn ? "" : "opacity-50"}`} data-testid="ai-level-row">
    <span className="col-start-1 row-start-1 font-medium sm:col-start-auto sm:row-start-auto">{tierTitle(level.tier)}</span>
    <div className="col-span-2 row-start-2 min-w-0 sm:col-span-1 sm:col-start-auto sm:row-start-auto"><span className="block break-words" data-testid="ai-level-model">{name ?? (level.state === "same" ? word("same") : level.state === "off" ? word("off") : "")}</span>{level.detail ? <span className="block text-supporting text-muted-foreground" data-testid="ai-level-detail">{level.detail}</span> : null}</div>
    <span className="col-start-2 row-start-1 flex items-center gap-1.5 justify-self-end text-supporting text-muted-foreground sm:col-start-auto sm:row-start-auto"><Dot tone={tone(level.state)} />{word(level.state)}</span>
    <div className="col-span-2 row-start-3 flex items-center justify-end gap-2 sm:col-span-1 sm:col-start-auto sm:row-start-auto">
      {fixable ? <Button type="button" variant="outline" size="sm" disabled={busy} onClick={onInstall}>{level.action!.kind === "fix" ? i18n._({ id: "Fix", message: "Fix" }) : level.size_bytes_missing ? i18n._({ id: "Install {size}", message: "Install {size}", values: { size: sizeGb(level.size_bytes_missing) } }) : i18n._({ id: "Install", message: "Install" })}</Button> : null}
      {level.can_choose && level.options.length > 0 && level.state !== "same" ? <Button type="button" variant="ghost" size="sm" onClick={onChange}>{i18n._({ id: "Change", message: "Change" })}</Button> : null}
      {hasSwitch ? <Switch checked={level.state !== "off"} onCheckedChange={onSwitch} aria-label={i18n._({ id: "{feature} {level} on or off", message: "{feature} {level} on or off", values: { feature: feature.name, level: tierTitle(level.tier) } })} /> : <span className="w-11" aria-hidden="true" />}
    </div>
  </li>;
}
