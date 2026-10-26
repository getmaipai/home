// AIMODELS-PAGE-01: Settings, AI and models, Overview: the top of the page. The header numbers, the one button that sets everything
// to recommended and downloads it, "Free up space", and the failures. The job cards below it are the spec's own cards
// (AiJobCardView); progress rides the install strip and each choice's own bar (rule S6). Kit Elements only (rule 9).
import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Alert, AlertDescription, AlertTitle } from "@maipai/ui/src/ui/alert";
import { Button } from "@maipai/ui/src/ui/button";
import { Skeleton } from "@maipai/ui/src/ui/skeleton";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@maipai/ui/src/dashboard/components/ui/alert-dialog";
import { ApiError } from "@/lib/api";
import { aiChoicesApi } from "@/lib/aiChoicesApi";
import { InstallStrip } from "@/shell/InstallStrip";
import { FreeUpSpaceDialog } from "@/apps/settings/FreeUpSpaceDialog";
import { useAiChoices } from "@/apps/settings/useAiChoices";
import { sizeGb, needGb, freeGb } from "../../../../shared/diskPlanMath";

const messageOf = (error: unknown, fallback: string) => (error instanceof ApiError ? error.message : fallback);

export function AiOverview() {
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [cleanup, setCleanup] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const { query, refresh } = useAiChoices();
  const data = query.data;
  const plan = data?.recommended ?? null;
  const titleOf = (job: string) => data?.cards.find((card) => card.id === job)?.title ?? job;

  const apply = useMutation({
    mutationFn: aiChoicesApi.applyRecommended,
    onSuccess: (done) => {
      refresh();
      const waiting = done.needs_licence.length > 0 ? ` ${done.needs_licence.map((part) => part.label).join(", ")} waits for its licence.` : "";
      setNote(done.already.length > 0 && done.started.length === 0 ? `Already downloading.${waiting}` : `Set to recommended. The downloads show in the bar at the top.${waiting}`);
    },
    onError: (e) => setError(messageOf(e, "Could not set everything to recommended. Check that the engine is running, then try again.")),
  });

  const nothingToDo = plan?.nothingToDo === true;
  const cannot = plan !== null && plan.fits === "none" && plan.installRowIds.length === 0 && plan.changes.length === 0;

  return (
    <section aria-label="AI and models summary" className="flex flex-col gap-4">
      <InstallStrip detailsHref={null} />
      {query.isLoading ? <Skeleton aria-label="Loading" /> : null}
      {query.isError ? <Alert variant="destructive"><AlertTitle>The page did not load</AlertTitle><AlertDescription>{messageOf(query.error, "Check that Home is running, then reload this page.")}</AlertDescription></Alert> : null}
      {data?.stack === "unreachable" ? <Alert variant="destructive"><AlertTitle>The AI engine isn't answering</AlertTitle><AlertDescription>{data.message ?? "Check that the engine is running, then try again."}</AlertDescription></Alert> : null}
      {error ? <Alert variant="destructive"><AlertTitle>That did not work</AlertTitle><AlertDescription>{error}</AlertDescription></Alert> : null}
      {note ? <Alert><AlertTitle>Done</AlertTitle><AlertDescription>{note}</AlertDescription></Alert> : null}
      {data && data.stack === "ok" ? (
        <>
          <p className="text-sm text-muted-foreground" data-testid="ai-summary">
            Using {sizeGb(data.installed_bytes)}.{data.free_disk_bytes !== null ? ` ${freeGb(data.free_disk_bytes)} GB free.` : ""} {plan ? plan.text : ""}
            {data.unused_bytes > 0 ? ` Free up space can find about ${needGb(data.unused_bytes)} GB.` : ""}
          </p>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Button type="button" height="auto" wrap="wrap" onClick={() => setConfirm(true)} disabled={nothingToDo || cannot || apply.isPending || plan === null}>
              {nothingToDo ? "Everything is set to recommended" : "Set everything to recommended and download"}
            </Button>
            <Button type="button" variant="outline" onClick={() => setCleanup(true)}>Free up space</Button>
          </div>
        </>
      ) : null}
      <AlertDialog open={confirm} onOpenChange={setConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Set everything to recommended?</AlertDialogTitle>
            <AlertDialogDescription>
              {plan && plan.changes.length > 0 ? "These choices change first: " + plan.changes.map((change) => `${titleOf(change.job)}: ${change.from} to ${change.to}`).join(". ") + ". " : ""}
              {plan && plan.installRowIds.length > 0 ? `Then Home downloads ${needGb(plan.downloadBytes)} GB. ` : "Nothing needs to download. "}
              {plan && plan.fits !== "all" ? `${plan.text} ` : ""}
              Nothing is removed. Models you stop using stay until you choose Free up space.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Not now</AlertDialogCancel>
            <AlertDialogAction onClick={() => { setConfirm(false); setError(null); setNote(null); apply.mutate(); }}>Set to recommended and download</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <FreeUpSpaceDialog open={cleanup} onOpenChange={setCleanup} onChanged={refresh} />
    </section>
  );
}
