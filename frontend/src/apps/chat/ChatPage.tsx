import { useCallback, useEffect, useState } from "react";
import { Page } from "@/kit/primitives/Page";
import { MessageThread, type ThreadMessage } from "@/kit/primitives/MessageThread";
import { Form } from "@/kit/primitives/Form";
import { Progress } from "@/kit/primitives/Progress";
import { Button } from "@/kit/components/Button";
import { api, ApiError, type Roster } from "@/lib/api";
import { rowsToMessages } from "@/apps/chat/mapRows";

interface ChatPageProps {
  person: Roster;
}

// The real Chat page (spec/ui/pages/chat.json), hand-built against the
// kit primitives rather than executed by a generic UiNode interpreter
// (none exists yet, home/docs/dev.md documents that as a deferred slice).
export function ChatPage({ person }: ChatPageProps) {
  const [messages, setMessages] = useState<ThreadMessage[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [sending, setSending] = useState(false);
  const [banner, setBanner] = useState<string | null>(null);

  const loadHistory = useCallback(() => {
    setLoadError(false);
    api
      .conversations()
      .then((rows) => setMessages(rowsToMessages(rows, person.display_name)))
      .catch(() => {
        // A code review (2026-09-04) found this used to render the same
        // "Nothing here yet" empty state on a real load failure as on a
        // genuinely new household, with no way to tell the two apart or
        // retry. Keep `messages` as whatever it was (null on first load,
        // the last good list on a background refresh) and show a real
        // error state instead of pretending the history is empty.
        setLoadError(true);
      });
  }, [person.display_name]);

  useEffect(() => {
    loadHistory();
  }, [loadHistory]);

  async function handleSend(values: Record<string, string>) {
    const text = values.message;
    if (!text) return;
    setBanner(null);
    const pendingId = `pending-${crypto.randomUUID()}`;
    setMessages((prev) => [
      ...(prev ?? []),
      { id: pendingId, sender: person.display_name, text, isSelf: true },
    ]);
    setSending(true);
    try {
      const value = await api.sendTurn(text);
      setMessages((prev) => [
        ...(prev ?? []),
        { id: `${pendingId}-reply`, sender: "MaiPai", text: value.reply.text, isSelf: false },
      ]);
      // 4.3: "offer, never block" - shown alongside the reply, never in
      // place of it, and never suppressing anything else in the thread.
      if (value.crisis_resources) setBanner(value.crisis_resources);
    } catch (e) {
      // A code review (2026-09-04) found the earlier version left the
      // optimistic bubble above looking sent even when it never reached
      // the backend, so a reload silently dropped it with no explanation.
      // Mark that exact message failed instead of only banner-ing below.
      setMessages((prev) => (prev ?? []).map((m) => (m.id === pendingId ? { ...m, failed: true } : m)));
      setBanner(e instanceof ApiError ? e.message : "Could not reach the hub. Try again.");
    } finally {
      setSending(false);
    }
  }

  return (
    <Page title="Chat">
      {messages === null && loadError ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
          <p className="text-base text-[hsl(var(--destructive))]">
            Could not load your conversation. The hub might be unreachable.
          </p>
          <Button variant="secondary" size="sm" onClick={loadHistory}>
            Try again
          </Button>
        </div>
      ) : messages === null ? (
        <div className="flex flex-1 items-center justify-center">
          <Progress mode="spinner" label="Loading conversation" />
        </div>
      ) : (
        <MessageThread
          messages={messages}
          emptyState={{ icon: "message-circle", text: "Nothing here yet. Say hello." }}
        />
      )}
      {sending ? (
        <div className="px-4 pb-1">
          <Progress mode="spinner" label="MaiPai is thinking…" />
        </div>
      ) : null}
      {banner ? (
        <div className="mx-4 mb-2 rounded-[var(--radius)] bg-[hsl(var(--muted))] px-3 py-2 text-sm">{banner}</div>
      ) : null}
      <Form
        fields={[{ name: "message", selector: "text", placeholder: "Message" }]}
        submitIcon="send"
        submitLabel="Send"
        disabled={sending}
        onSubmit={handleSend}
      />
    </Page>
  );
}
