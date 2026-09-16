import { useQuery } from "@tanstack/react-query";
import { createContext, useContext, type ReactNode } from "react";
import { useAuiState } from "@assistant-ui/react";
import type { TurnArtifact } from "@maipai/spec/gen/ts/turn-artifact.js";
import { api } from "@/lib/api";
import { AsyncState } from "@/kit/primitives/AsyncState";
import { Card } from "@/kit/primitives/Card";
import { DetailPane } from "@/kit/primitives/DetailPane";
import { List } from "@/kit/primitives/List";
import { Section } from "@/kit/primitives/Section";
import { Badge } from "@/kit/ui/badge";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/kit/ui/sheet";
import { Button } from "@/kit/ui/button";
import { getIcon } from "@/kit/icons";
import { useIsMobile } from "@/kit/hooks/use-mobile";

type OpenDocument = (turnId: string) => void;

type DocumentCardSection =
  | { type: "card"; kind: "film"; name: string; year: number | null; director: string | null; genres: string[]; source_id: string }
  | { type: "card"; kind: "person"; name: string; occupation: string | null; known_for: string[]; source_id: string }
  | { type: "card"; kind: "place"; name: string; region: string | null; country: string | null; source_id: string };
type DocumentSection =
  | { type: "lookup"; query: string; results: Array<{ title: string; line: string; source_id: string }> }
  | DocumentCardSection
  | { type: "procedure"; title: string; steps: Array<{ position: number; instruction: string; quantities: Array<{ amount: number | string; unit: string; item: string }> }> }
  | { type: "comparison"; title: string; subjects: Array<{ id: string; name: string }>; rows: Array<{ attribute: string; values: Array<{ subject_id: string; value: string }> }> };
type ChatDocument = Omit<TurnArtifact, "section"> & { section: DocumentSection };

export const ChatDocumentOpenContext = createContext<OpenDocument>(() => {});

interface DocumentHandleProps {
  turnId?: string;
  available?: boolean;
}

/** The reply affordance is deliberately separate from the pane. This keeps
 * the handle in the message's own action area while the shell owns the pane
 * real estate through ChatPage. */
export function DocumentHandle({ turnId, available }: DocumentHandleProps) {
  const openDocument = useContext(ChatDocumentOpenContext);
  const InfoIcon = getIcon("info");
  if (!available || !turnId) return null;
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      className="relative min-h-12 gap-1.5 px-2 text-muted-foreground before:absolute before:-inset-y-1 before:-inset-x-1"
      aria-label="View details"
      data-slot="chat-document-handle"
      onClick={() => openDocument(turnId)}
    >
      <InfoIcon className="size-4" aria-hidden />
      Details
    </Button>
  );
}

/** Reads the flag carried by both the live and reloaded assistant message. */
export function ChatDocumentHandle() {
  const turnId = useAuiState((s) => {
    const custom = s.message.metadata?.custom as { turnId?: unknown; turn_id?: unknown } | undefined;
    return typeof custom?.turnId === "string" ? custom.turnId : typeof custom?.turn_id === "string" ? custom.turn_id : undefined;
  });
  const available = useAuiState((s) => {
    const custom = s.message.metadata?.custom as { documentAvailable?: unknown; document_available?: unknown } | undefined;
    return custom?.documentAvailable === true || custom?.document_available === true;
  });
  return <DocumentHandle turnId={turnId} available={available} />;
}

function SourceList({ document }: { document: ChatDocument }) {
  if (document.sources.length === 0) return null;
  return (
    <Section heading="Sources">
      <List
        items={document.sources}
        getKey={(source) => source.id}
        label="Document sources"
        renderItem={(source) => (
          <a
            href={source.url}
            target="_blank"
            rel="noopener noreferrer"
            referrerPolicy="no-referrer"
            className="min-w-0 truncate text-base text-primary underline underline-offset-2 hover:text-primary/80 focus-visible:text-primary/80"
          >
            {source.title}<span className="text-muted-foreground"> · {source.site}</span>
          </a>
        )}
      />
    </Section>
  );
}

function CardSection({ section }: { section: DocumentCardSection }) {
  const fields = section.kind === "film"
    ? [
        section.year !== null ? `Year: ${section.year}` : null,
        section.director ? `Director: ${section.director}` : null,
        section.genres.length > 0 ? `Genres: ${section.genres.join(", ")}` : null,
      ].filter((value): value is string => Boolean(value))
    : section.kind === "person"
      ? [
          section.occupation ? `Occupation: ${section.occupation}` : null,
          section.known_for.length > 0 ? `Known for: ${section.known_for.join(", ")}` : null,
        ].filter((value): value is string => Boolean(value))
      : [
          section.region ? `Region: ${section.region}` : null,
          section.country ? `Country: ${section.country}` : null,
        ].filter((value): value is string => Boolean(value));

  return (
    <Section heading={section.name}>
      <Card label={`${section.kind} details`}>
        <div className="flex flex-col gap-2 p-4 text-base">
          <Badge variant="secondary" className="self-start">{section.kind}</Badge>
          {fields.length > 0 ? <List items={fields} getKey={(field) => field} renderItem={(field) => <span>{field}</span>} label={`${section.name} facts`} /> : null}
        </div>
      </Card>
    </Section>
  );
}

function ProcedureSection({ section }: { section: Extract<DocumentSection, { type: "procedure" }> }) {
  return (
    <Section heading={section.title}>
      <List
        items={section.steps}
        getKey={(step) => String(step.position)}
        label="Procedure steps"
        renderItem={(step) => (
          <div className="flex min-w-0 flex-col gap-2 py-1">
            <div className="flex gap-2 text-base"><Badge variant="secondary">{step.position}</Badge><span>{step.instruction}</span></div>
            {step.quantities.length > 0 ? (
              <div className="flex flex-wrap gap-1.5" aria-label={`Quantities for step ${step.position}`}>
                {step.quantities.map((quantity) => <Badge key={`${quantity.item}-${quantity.unit}`} variant="outline">{quantity.amount} {quantity.unit} {quantity.item}</Badge>)}
              </div>
            ) : null}
          </div>
        )}
      />
    </Section>
  );
}

function ComparisonSection({ section }: { section: Extract<DocumentSection, { type: "comparison" }> }) {
  const subjectName = new Map(section.subjects.map((subject) => [subject.id, subject.name]));
  return (
    <Section heading={section.title}>
      <List
        items={section.rows}
        getKey={(row) => row.attribute}
        label="Comparison rows"
        renderItem={(row) => (
          <div className="flex min-w-0 flex-col gap-1 py-1 text-base">
            <span className="font-semibold">{row.attribute}</span>
            <div className="grid gap-1 sm:grid-cols-2">
              {row.values.map((value) => <span key={value.subject_id}><span className="text-muted-foreground">{subjectName.get(value.subject_id) ?? value.subject_id}:</span> {value.value}</span>)}
            </div>
          </div>
        )}
      />
    </Section>
  );
}

function LookupSection({ section }: { section: Extract<DocumentSection, { type: "lookup" }> }) {
  return (
    <Section heading={`Results for ${section.query}`}>
      <List
        items={section.results}
        getKey={(result) => `${result.title}-${result.source_id}`}
        label="Lookup results"
        renderItem={(result) => <div className="flex min-w-0 flex-col gap-1 py-1 text-base"><span className="font-semibold">{result.title}</span><span>{result.line}</span></div>}
      />
    </Section>
  );
}

function DocumentContent({ document }: { document: ChatDocument }) {
  const section = document.section;
  let sectionView: ReactNode;
  if (section.type === "card") sectionView = <CardSection section={section} />;
  else if (section.type === "procedure") sectionView = <ProcedureSection section={section} />;
  else if (section.type === "comparison") sectionView = <ComparisonSection section={section} />;
  else sectionView = <LookupSection section={section} />;
  return <div className="flex flex-col gap-4">{sectionView}<SourceList document={document} /></div>;
}

function DocumentBody({ turnId }: { turnId: string }) {
  const query = useQuery({
    queryKey: ["chat-document", turnId],
    queryFn: () => api.conversationTurnDocument(turnId),
    staleTime: 5 * 60 * 1000,
  });
  return (
    <AsyncState
      data={query.data}
      error={query.isError}
      isFetching={query.isFetching}
      onRetry={() => void query.refetch()}
      errorMessage="The details are not available right now."
      emptyIcon="info"
      emptyText="No details were saved for this reply."
      loadingLabel="Loading details"
    >
      {(document) => <DocumentContent document={document as ChatDocument} />}
    </AsyncState>
  );
}

interface ChatDocumentPaneProps {
  turnId: string | null;
  onClose: () => void;
}

export function ChatDocumentPane({ turnId, onClose }: ChatDocumentPaneProps) {
  const open = turnId !== null;
  const isMobile = useIsMobile();
  if (isMobile) {
    return (
      <Sheet open={open} onOpenChange={(nextOpen) => { if (!nextOpen) onClose(); }}>
        <SheetContent side="bottom" className="max-h-[85vh] overflow-y-auto">
          <SheetHeader><SheetTitle>Reply details</SheetTitle></SheetHeader>
          {turnId ? <DocumentBody turnId={turnId} /> : null}
        </SheetContent>
      </Sheet>
    );
  }
  return (
    <aside className="min-h-0 w-96 shrink-0 border-s border-border/60 bg-background" aria-label="Reply details">
      {open ? <DetailPane title="Reply details" subtitle="Saved details from this reply" onClose={onClose} closeLabel="Close details"><DocumentBody turnId={turnId} /></DetailPane> : null}
    </aside>
  );
}
