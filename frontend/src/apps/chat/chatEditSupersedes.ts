// getmaipai/home#60: the id of the turn an in-flight edit-and-resend is
// replacing, set by thread.aui.tsx's EditComposer right before its own
// "Update" click reaches assistant-ui's real send (composeEventHandlers
// runs a primitive's own onClick before the wrapped send callback), read
// once by chatModelAdapter.ts's run() via consumeSupersedes() below.
//
// A plain module-scope ref, not React state or an event (chatListenStore.ts's
// own comment on why a ref beats a second parallel channel applies here
// too): assistant-ui never threads an edit's original message id into
// ChatModelRunOptions, and the one place that DOES carry it - the
// `composer.send` event ComposerEvents documents ("`messageId` is set when
// the send came from an edit composer") - turned out to fire from a
// MESSAGE-scoped composer client, not the thread-scoped one; a listener
// registered outside that message's own subtree never receives it, even
// with `{ scope: "*" }` (confirmed live, 2026-09-13: a plain send's event
// reached such a listener, an edit's never did). Reading state directly
// inside EditComposer, which sits INSIDE that same message scope, sidesteps
// the whole event-bus question.
let pendingSupersedes: string | null = null;

export function setPendingSupersedes(turnId: string | null): void {
  pendingSupersedes = turnId;
}

export function consumeSupersedes(): string | undefined {
  const value = pendingSupersedes;
  pendingSupersedes = null;
  return value ?? undefined;
}
