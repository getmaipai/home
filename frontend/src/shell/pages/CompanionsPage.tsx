import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useParams } from "react-router-dom";
import { AsyncState } from "@maipai/ui/src/primitives/AsyncState";
import { EmptyState } from "@maipai/ui/src/primitives/EmptyState";
import { Section } from "@maipai/ui/src/primitives/Section";
import { Avatar } from "@maipai/ui/src/primitives/Avatar";
import { Card, CardContent } from "@maipai/ui/src/dashboard/components/ui/card";
import { Badge } from "@maipai/ui/src/dashboard/components/ui/badge";
import { Alert, AlertDescription } from "@maipai/ui/src/ui/alert";
import { Button } from "@maipai/ui/src/ui/button";
import { Select } from "@maipai/ui/src/primitives/Select";
import { GRID_COLUMNS } from "@maipai/ui/src/responsive";
import { companionVoiceKey } from "@/lib/companionVoice";
import { api, ApiError, type CompanionCard, type CompanionDetail, type CompanionList } from "@/lib/api";
import { playableVoices, previewIdFor, voiceChoices } from "@/lib/voice/voiceBrowserRows";
import { voicePreviewPlayer, type VoicePreviewState } from "@/lib/voice/voicePreviewPlayer";
import { useTabItem } from "@/shell/tabIdentity";

const listKey = ["companions"] as const;
const ROBOT_SETTINGS = "/settings/home/robot";

/** The inside of one card in the gallery: the kit's Avatar, name, one line, the type and who it is for. */
function CompanionBody({ card }: { card: CompanionCard }) {
  return (
    <div className="flex flex-col items-center gap-3 text-center">
      <Avatar name={card.name} className="size-16 text-xl" />
      <div className="flex flex-col gap-1">
        <h2 className="text-base font-semibold">{card.name}</h2>
        <p className="text-sm text-muted-foreground">{card.tagline}</p>
        <p className="text-sm text-muted-foreground">{card.who_can_use}</p>
      </div>
      <div className="flex flex-wrap justify-center gap-2">
        <Badge>{card.type_label}</Badge>
        {card.is_household ? <Badge>Made at home</Badge> : null}
        {card.status === "draft" ? <Badge>Draft</Badge> : null}
        {card.is_default ? <Badge>Your default</Badge> : null}
      </div>
      <ul className="flex list-none flex-col gap-1 p-0 text-sm text-muted-foreground">
        {card.dials.map((dial) => <li key={dial.label}>{dial.value}</li>)}
      </ul>
    </div>
  );
}

/** /companions: the companions this person may use, as a card grid. An owner or admin also sees which companion each robot has. */
export function CompanionsPage() {
  useTabItem("Companions");
  const query = useQuery<CompanionList>({ queryKey: listKey, queryFn: api.companions, retry: false });
  return (
    <div className="flex flex-col gap-6" data-testid="companions">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Companions</h1>
        <p className="text-sm text-muted-foreground">A companion is how your assistant sounds. Pick one, read about it, and make it your default.</p>
      </div>
      <AsyncState
        data={query.isError ? null : query.data}
        error={query.isError}
        isFetching={query.isFetching}
        onRetry={() => query.refetch()}
        errorMessage={query.error instanceof ApiError ? query.error.message : "Could not load the companions. Check your connection and try again."}
        loadingLabel="Loading companions"
      >
        {(data: CompanionList) => (
          <>
            {data.can_create ? <div><Link to="/companions/new"><Button>New companion</Button></Link></div> : null}
            {!data.allowed ? (
              <EmptyState icon="user" text="Companions are turned off for you. Ask an owner or admin to turn them on." />
            ) : data.companions.length === 0 ? (
              <EmptyState icon="user" text="No companions are installed yet." />
            ) : (
              <ul aria-label="Companions" className={`grid list-none gap-4 p-0 ${GRID_COLUMNS.default}`}>
                {data.companions.map((card) => (
                  <li key={card.id} className="min-w-0">
                    <Link to={`/companions/${encodeURIComponent(card.id)}`} aria-label={card.name} className="block rounded-xl transition-shadow hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                      <Card><CardContent><CompanionBody card={card} /></CardContent></Card>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
            {data.robots ? <RobotAssignments robots={data.robots} /> : null}
          </>
        )}
      </AsyncState>
    </div>
  );
}

function RobotAssignments({ robots }: { robots: NonNullable<CompanionList["robots"]> }) {
  return (
    <Section heading="Robots">
      {robots.length === 0 ? (
        <p className="text-sm text-muted-foreground">No robots are set up yet.</p>
      ) : (
        <ul aria-label="Robots" className="flex list-none flex-col gap-2 p-0">
          {robots.map((robot) => (
            <li key={robot.id} className="flex flex-wrap items-center justify-between gap-2">
              <span>{robot.name}: {robot.companion_name ?? "No companion yet"} <span className="text-sm text-muted-foreground">({robot.controls} controls)</span></span>
              <Link to={ROBOT_SETTINGS} className="text-sm underline">Companion settings</Link>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

/** /companions/:id: one companion in full, a voice preview, and Set as my default. */
export function CompanionDetailPage() {
  const { id = "" } = useParams();
  const query = useQuery<CompanionDetail>({ queryKey: [...listKey, id], queryFn: () => api.companion(id), retry: false });
  useTabItem(query.data?.name ?? "Companion");
  return (
    <div className="flex flex-col gap-6" data-testid="companion-detail">
      <Link to="/companions" className="text-sm underline">All companions</Link>
      <AsyncState
        data={query.isError ? null : query.data}
        error={query.isError}
        isFetching={query.isFetching}
        onRetry={() => query.refetch()}
        errorMessage={query.error instanceof ApiError && query.error.status === 404 ? "That companion is not on your list. Go back and pick one from the gallery." : "Could not load this companion. Check your connection and try again."}
        loadingLabel="Loading companion"
      >
        {(companion: CompanionDetail) => <DetailBody companion={companion} />}
      </AsyncState>
    </div>
  );
}

function DetailBody({ companion }: { companion: CompanionDetail }) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const copy = useMutation({ mutationFn: () => api.copyCompanion(companion.id), onSuccess: (result) => { void queryClient.invalidateQueries({ queryKey: listKey }); navigate(`/companions/${encodeURIComponent(result.id)}/edit`); } });
  const save = useMutation({
    mutationFn: () => api.setDefaultCompanion(companion.id),
    onSuccess: () => { void queryClient.invalidateQueries({ queryKey: listKey }); },
  });
  const saved = save.isSuccess || companion.is_default;
  return (
    <>
      <div className="flex flex-col items-start gap-4 sm:flex-row sm:items-center">
        <Avatar name={companion.name} className="size-20 text-2xl" />
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">{companion.name}</h1>
          <p className="text-muted-foreground">{companion.tagline}</p>
          <div className="flex flex-wrap gap-2"><Badge>{companion.type_label}</Badge>{saved ? <Badge>Your default</Badge> : null}</div>
        </div>
        {companion.can_edit ? <Link to={`/companions/${encodeURIComponent(companion.id)}/edit`}><Button type="button" variant="outline">Edit</Button></Link> : null}
        {companion.can_copy ? <Button type="button" variant="outline" disabled={copy.isPending} onClick={() => copy.mutate()}>{companion.is_household ? "Make a copy" : "Edit a copy"}</Button> : null}
        <Button type="button" disabled={saved || save.isPending} onClick={() => save.mutate()}>{saved ? "Your default" : "Set as my default"}</Button>
      </div>
      {save.isError ? <Alert variant="destructive"><AlertDescription>{save.error instanceof ApiError ? save.error.message : "Could not save this. Check your connection and try again."}</AlertDescription></Alert> : null}
      {copy.isError ? <Alert variant="destructive"><AlertDescription>{copy.error instanceof ApiError ? copy.error.message : "Could not reach Home. Check your connection and try again."}</AlertDescription></Alert> : null}
      {!companion.is_household && companion.can_copy ? <p>This companion comes with Home, so it can't be changed. Make a copy and edit that.</p> : null}
      <Section heading="About">
        <p>{companion.about}</p>
        {companion.pronouns ? <p className="text-sm text-muted-foreground">Pronouns: {companion.pronouns}</p> : null}
        {companion.interests.length > 0 ? <p className="text-sm text-muted-foreground">Likes: {companion.interests.join(", ")}.</p> : null}
        <p className="text-sm text-muted-foreground">{companion.who_can_use}</p>
      </Section>
      <Section heading="How it talks">
        <dl className="grid gap-3 sm:grid-cols-2">
          {companion.dials.map((dial) => (
            <div key={dial.label}><dt className="text-sm font-medium">{dial.label}</dt><dd className="text-muted-foreground">{dial.value}</dd></div>
          ))}
        </dl>
      </Section>
      <Section heading="Things it might say">
        <ul className="flex list-none flex-col gap-2 p-0">
          {companion.examples.map((line) => <li key={line}>&ldquo;{line}&rdquo;</li>)}
        </ul>
      </Section>
      <Section heading="Voice"><VoiceRow companion={companion} /></Section>
      {companion.used_by ? (
        <Section heading="Who uses it">
          <p>People: {companion.used_by.people.length ? companion.used_by.people.map((person) => person.name).join(", ") : "nobody yet"}.</p>
          <p>Robots: {companion.used_by.robots.length ? companion.used_by.robots.map((robot) => robot.name).join(", ") : "none yet"}. <Link to={ROBOT_SETTINGS} className="underline">Companion settings</Link></p>
        </Section>
      ) : null}
    </>
  );
}

/** The voice this companion speaks in, with a Test button that plays the same preview Settings uses. */
function VoiceRow({ companion }: { companion: CompanionDetail }) {
  const voices = useQuery({ queryKey: ["stack-voices"], queryFn: api.stackVoices, retry: false });
  const [preview, setPreview] = useState<VoicePreviewState>(voicePreviewPlayer.getState());
  useEffect(() => {
    const unsubscribe = voicePreviewPlayer.subscribe(setPreview);
    return () => { unsubscribe(); voicePreviewPlayer.stop(); };
  }, []);
  const queryClient = useQueryClient();
  const saveVoice = useMutation({
    mutationFn: (voiceId: string) => api.setSetting("household", companionVoiceKey(companion.id), voiceId),
    onSuccess: () => { void queryClient.invalidateQueries({ queryKey: listKey }); },
  });
  const list = voices.data?.voices ?? [];
  const picker = companion.voice_setting !== null && list.length ? voiceChoices(playableVoices(list), companion.voice_setting, []) : null;
  const choice = list.length ? voiceChoices(list, companion.voice_value, [companion.voice_value]).selected : null;
  const previewId = choice ? previewIdFor(choice, list) : null;
  const testing = previewId !== null && preview.voiceId === previewId;
  const busy = testing && preview.busy;
  return (
    <div className="flex flex-col gap-2">
      <p>{companion.voice_is_own ? "Its own voice" : "The voice you chose in Settings"}{choice ? `: ${choice.label}` : "."}</p>
      <div>
        <Button type="button" variant="outline" disabled={previewId === null || busy} onClick={() => (testing ? voicePreviewPlayer.stop() : previewId && void voicePreviewPlayer.start(previewId))}>
          {testing && !busy ? "Stop" : "Play a sample"}
        </Button>
      </div>
      {picker ? (
        <div className="flex flex-col gap-1">
          <Select
            aria-label="Voice for this companion"
            value={picker.selected.value}
            options={picker.options.map((option) => option.value)}
            getLabel={(value) => picker.options.find((option) => option.value === value)?.label ?? value}
            disabled={saveVoice.isPending}
            onValueChange={(value) => saveVoice.mutate(value)}
          />
          <p className="text-sm text-muted-foreground">Only owners and admins choose this. Everyone hears the companion in this voice, except a child or teen never gets a voice made from a clip.</p>
          {saveVoice.isError ? <p role="alert">{saveVoice.error instanceof ApiError ? saveVoice.error.message : "Could not save this voice. Check your connection and try again."}</p> : null}
        </div>
      ) : null}
      {voices.isError ? <p role="alert">Home can't reach its voice service. Check Repairs, then come back.</p> : null}
      {preview.error ? <p role="alert">{preview.error}</p> : null}
    </div>
  );
}
