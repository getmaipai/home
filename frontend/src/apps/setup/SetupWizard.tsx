import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { Wizard, type WizardStep } from "@maipai/ui/src/primitives/Wizard";
import { Input } from "@maipai/ui/src/ui/input";
import { Button } from "@maipai/ui/src/ui/button";
import { Checkbox } from "@maipai/ui/src/ui/checkbox";
import { Progress } from "@maipai/ui/src/primitives/Progress";
import { describeHardware } from "@/apps/settings/ModelsSection";
import { api, ApiError, type HardwareInfo, type BackupInfo } from "@/lib/api";

interface SetupWizardProps {
  /** Fires once the owner account exists and the wizard is done (or the
   * person backs all the way out past step 0, though nothing here offers
   * that once an owner is created - the same "no way to undo the first
   * person" shape SignIn.tsx's old inline form already had). */
  onDone: () => void;
}

// Resume-after-reload (platform plan 6.4's Wizard pattern): which step a
// fresh household has reached, kept client-side only. `GET /api/setup/
// state`/`POST /api/setup/:step` (docs/plans/wave-2.md's F-to-E contract)
// is the real, per-household, server-side version of this - not built
// yet, so this is the mock wave-2.md's own protocol calls for ("build
// against the contract with a mock until the route lands"). Once it
// lands, this becomes a thin wrapper around it instead of localStorage.
const RESUME_KEY = "maipai:setup-wizard-step";
// Persisted alongside RESUME_KEY, not derived from it: a code review
// (2026-09-06) found that jumping back to review a completed step (real
// jump-back UX plan 6.4 asks for - "a check-answers step with Change
// links") and reloading there re-derived `completedCount` from the
// resumed index alone, silently re-locking every later step that had
// already finished (including one, hardware, that had already made a
// real `POST /api/host/models/:id/select` call).
const COMPLETED_KEY = "maipai:setup-wizard-completed";
// The one-time acknowledgment itself (getmaipai/.github/CLAUDE.md > Safety
// invariants: "never repeated") - also a placeholder, and a more
// consequential one: nothing server-side reads this key today, so
// completing this step does not yet gate unrestricted mode on anything.
// The real, spec-shaped field (on Person or a settings key) is a backend/
// spec change outside this session's frontend-only ownership - flagged in
// docs/BACKLOG.md, not silently treated as done.
const ACKNOWLEDGED_KEY = "maipai:unrestricted-acknowledged";

const STEPS: WizardStep[] = [
  { id: "household", title: "Household" },
  { id: "owner", title: "Your profile" },
  { id: "acknowledgment", title: "Before you start" },
  { id: "hardware", title: "Hardware" },
  { id: "trust", title: "Trust this hub" },
  { id: "packages", title: "Packages" },
  { id: "remote", title: "Remote access" },
  { id: "emergency_kit", title: "Emergency kit" },
  { id: "backup", title: "Backups" },
  { id: "done", title: "Done" },
];

function StepFields({ children }: { children: ReactNode }) {
  return <div className="flex max-w-md flex-col gap-4">{children}</div>;
}

function ErrorText({ error }: { error: string | null }) {
  if (!error) return null;
  return <p className="text-base text-[var(--destructive)]">{error}</p>;
}

export function SetupWizard({ onDone }: SetupWizardProps) {
  const navigate = useNavigate();
  const [stepIndex, setStepIndex] = useState(0);
  const [completedCount, setCompletedCount] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // A code review (2026-09-06) found `/setup` reachable unconditionally,
  // with no check for whether the household already has an owner - an
  // already-signed-in person (or anyone else on the LAN) navigating here
  // directly could re-run real, mutating steps (select a different
  // model, run another backup) with no gate at all. `null` while the
  // check is in flight, so the wizard renders nothing rather than
  // flashing its first step before redirecting away.
  const [gateChecked, setGateChecked] = useState(false);

  // Household (step 0) - collected for the "done" screen's own greeting;
  // not yet persisted anywhere real (no `household.name` setting key
  // exists today - core settings keys are Session F's ownership, flagged
  // in docs/BACKLOG.md rather than added here).
  const [householdName, setHouseholdName] = useState("");

  // Owner (step 1)
  const [ownerName, setOwnerName] = useState("");
  const [ownerSecret, setOwnerSecret] = useState("");

  // Acknowledgment (step 2)
  const [acknowledged, setAcknowledged] = useState(false);

  // Hardware (step 3)
  const [hardware, setHardware] = useState<HardwareInfo | null>(null);
  const [stackChat, setStackChat] = useState<{ name: string | null; state: string }>({ name: null, state: "offline" });

  // Backups (step 8)
  const [backups, setBackups] = useState<BackupInfo[] | null>(null);

  useEffect(() => {
    const savedStep = sessionStorage.getItem(RESUME_KEY);
    if (savedStep !== null) {
      // Actively resuming a wizard run already in progress in this
      // browser (even one that already created the owner account a few
      // steps back, so `api.profiles()` below would otherwise look
      // identical to "setup is long done") - never gated.
      const saved = Number(savedStep);
      if (Number.isFinite(saved) && saved > 0 && saved < STEPS.length) setStepIndex(saved);
      const savedCompleted = Number(sessionStorage.getItem(COMPLETED_KEY) ?? "0");
      if (Number.isFinite(savedCompleted)) setCompletedCount(savedCompleted);
      setAcknowledged(sessionStorage.getItem(ACKNOWLEDGED_KEY) === "true");
      setGateChecked(true);
      return;
    }
    // A fresh visit with no resume state at all: real first-run only if
    // nobody exists yet. Fail open on a network error (same posture
    // SignIn.tsx's own profiles load takes) rather than trap a genuine
    // first-run household behind a spurious redirect.
    api
      .profiles()
      .then((profiles) => {
        if (profiles.length > 0) navigate("/", { replace: true });
        else setGateChecked(true);
      })
      .catch(() => setGateChecked(true));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function goTo(index: number) {
    setStepIndex(index);
    setError(null);
    sessionStorage.setItem(RESUME_KEY, String(index));
  }

  function advance() {
    const next = Math.max(completedCount, stepIndex + 1);
    setCompletedCount(next);
    sessionStorage.setItem(COMPLETED_KEY, String(next));
    if (stepIndex === STEPS.length - 1) {
      sessionStorage.removeItem(RESUME_KEY);
      sessionStorage.removeItem(COMPLETED_KEY);
      onDone();
      navigate("/", { replace: true });
      return;
    }
    goTo(stepIndex + 1);
  }

  async function handleOwnerSubmit() {
    if (!ownerName.trim() || !ownerSecret) {
      setError("Enter a name and a PIN or password.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.setup(ownerName.trim(), ownerSecret);
      advance();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not create the owner profile.");
    } finally {
      setBusy(false);
    }
  }

  async function loadHardwareStep() {
    setBusy(true);
    setError(null);
    try {
      const [hw, selection] = await Promise.all([api.hardware(), api.modelSelection()]);
      setHardware(hw);
      setStackChat({ name: selection.name, state: selection.state });
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not detect hardware.");
    } finally {
      setBusy(false);
    }
  }

  async function loadBackupsStep() {
    setBusy(true);
    setError(null);
    try {
      setBackups(await api.backups());
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not list backups.");
    } finally {
      setBusy(false);
    }
  }

  async function runBackupNow() {
    setBusy(true);
    setError(null);
    try {
      const created = await api.runBackup();
      setBackups((prev) => [created, ...(prev ?? [])]);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Backup failed.");
    } finally {
      setBusy(false);
    }
  }

  const currentId = STEPS[stepIndex]?.id;

  useEffect(() => {
    if (currentId === "hardware" && hardware === null) void loadHardwareStep();
    if (currentId === "backup" && backups === null) void loadBackupsStep();
    // Only when the step is first reached, not on every busy/error change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentId]);

  // Every hook above must run unconditionally on every render (React's
  // rules of hooks); this is the first point it's safe to bail out -
  // rendering nothing while the "does an owner already exist" check is
  // in flight, rather than flashing the wizard's first step before a
  // redirect lands.
  if (!gateChecked) return null;

  function submitOnEnter(handler: () => void) {
    return (e: FormEvent) => {
      e.preventDefault();
      handler();
    };
  }

  let content: ReactNode;
  let onNext = advance;
  let nextDisabled = false;
  let skipLabel: string | undefined;
  let onSkip: (() => void) | undefined;

  switch (currentId) {
    case "household":
      content = (
        <form onSubmit={submitOnEnter(advance)}>
          <StepFields>
            <p className="text-base text-muted-foreground">What should we call your household? You can change this later.</p>
            <Input placeholder="e.g. The Bramble household" value={householdName} onChange={(e) => setHouseholdName(e.target.value)} />
          </StepFields>
        </form>
      );
      nextDisabled = householdName.trim() === "";
      break;

    case "owner":
      content = (
        <form onSubmit={submitOnEnter(() => void handleOwnerSubmit())}>
          <StepFields>
            <p className="text-base text-muted-foreground">
              Create your own profile. You'll be the household's owner, with full access to settings and everyone else's account.
            </p>
            <Input placeholder="Your name" value={ownerName} onChange={(e) => setOwnerName(e.target.value)} />
            <Input type="password" placeholder="Choose a PIN or password" value={ownerSecret} onChange={(e) => setOwnerSecret(e.target.value)} />
            <ErrorText error={error} />
          </StepFields>
        </form>
      );
      onNext = () => void handleOwnerSubmit();
      nextDisabled = !ownerName.trim() || !ownerSecret;
      break;

    case "acknowledgment":
      content = (
        <StepFields>
          <p className="text-base text-muted-foreground">
            MaiPai's answers come from AI models you choose to download. They can be wrong, offensive, or harmful, and are never
            medical, legal, or professional advice - you're responsible for how you and your household use them.
          </p>
          <p className="text-base text-muted-foreground">
            As the owner, you can unlock unrestricted mode for your own account later in Settings: it answers without the
            filters kid profiles always keep, and what you do with it is your own responsibility. This is a one-time notice -
            you won't see it again.
          </p>
          <div className="flex items-start gap-2 text-base">
            <Checkbox
              id="acknowledge-unrestricted"
              checked={acknowledged}
              onCheckedChange={(v) => setAcknowledged(v === true)}
              className="mt-0.5"
            />
            <label htmlFor="acknowledge-unrestricted">I understand and agree.</label>
          </div>
        </StepFields>
      );
      onNext = () => {
        sessionStorage.setItem(ACKNOWLEDGED_KEY, "true");
        advance();
      };
      nextDisabled = !acknowledged;
      break;

    case "hardware": {
      content = (
        <StepFields>
          {busy && !hardware ? (
            <Progress mode="spinner" label="Detecting hardware" />
          ) : hardware ? (
            <>
              <p className="text-base text-muted-foreground">{describeHardware(hardware)}</p>
              <p className="text-base font-medium">{stackChat.name ?? "No chat model is currently selected in the MaiPai Stack"}</p>
              <p className="text-base text-muted-foreground">Chat models are managed through the MaiPai Stack. Chat state: {stackChat.state}.</p>
            </>
          ) : null}
          <ErrorText error={error} />
        </StepFields>
      );
      nextDisabled = false;
      break;
    }

    case "trust":
      content = (
        <StepFields>
          <p className="text-base text-muted-foreground">
            MaiPai Home can secure connections on your home network with its own certificate, so other devices trust it with no
            browser warning. This step isn't built yet - you can set it up later once it's ready.
          </p>
        </StepFields>
      );
      skipLabel = "Skip - not built yet";
      onSkip = advance;
      nextDisabled = true;
      break;

    case "packages":
      content = (
        <StepFields>
          <p className="text-base text-muted-foreground">
            MaiPai comes with a default set of apps and skills. The package store isn't built yet - once it is, you'll be able
            to browse and choose what your household uses here.
          </p>
        </StepFields>
      );
      skipLabel = "Skip - set this up later";
      onSkip = advance;
      nextDisabled = true;
      break;

    case "remote":
      content = (
        <StepFields>
          <p className="text-base text-muted-foreground">
            You can optionally set up secure remote access to your hub away from home. This isn't built yet - skip it for now.
          </p>
        </StepFields>
      );
      skipLabel = "Skip - not built yet";
      onSkip = advance;
      nextDisabled = true;
      break;

    case "emergency_kit":
      content = (
        <StepFields>
          <p className="text-base text-muted-foreground">
            Once backups are set up, MaiPai will give you an emergency kit: a printable page with the key to restore your
            household's data if this hub is ever lost. That page isn't generated yet - you'll see it for real once backups are
            configured in the next step.
          </p>
        </StepFields>
      );
      break;

    case "backup":
      content = (
        <StepFields>
          {busy && backups === null ? (
            <Progress mode="spinner" label="Checking backups" />
          ) : (
            <>
              <p className="text-base text-muted-foreground">
                {backups && backups.length > 0
                  ? `${backups.length} backup${backups.length === 1 ? "" : "s"} saved on this hub.`
                  : "No backups yet. Run one now, then set a schedule later in Settings."}
              </p>
              <Button type="button" variant="outline" onClick={() => void runBackupNow()} disabled={busy} className="self-start">
                {busy ? "Backing up…" : "Run a backup now"}
              </Button>
              <ErrorText error={error} />
            </>
          )}
        </StepFields>
      );
      break;

    case "done":
      content = (
        <StepFields>
          <p className="text-base text-muted-foreground">
            {householdName.trim() ? `Welcome to ${householdName.trim()}.` : "You're all set."} Here's what to try first:
          </p>
          <ul className="list-inside list-disc text-base text-muted-foreground">
            <li>Ask MaiPai something from the Home screen</li>
            <li>Add the rest of your household under People</li>
            <li>Check Health to see everything is running well</li>
          </ul>
        </StepFields>
      );
      break;

    default:
      content = null;
  }

  return (
    <Wizard
      steps={STEPS}
      currentStepId={currentId ?? "household"}
      completedCount={completedCount}
      onJumpTo={(id) => goTo(STEPS.findIndex((s) => s.id === id))}
      onBack={stepIndex > 0 ? () => goTo(stepIndex - 1) : undefined}
      onNext={onNext}
      nextDisabled={nextDisabled}
      nextLabel={currentId === "done" ? "Go to MaiPai Home" : "Continue"}
      skipLabel={skipLabel}
      onSkip={onSkip}
      busy={busy}
    >
      {content}
    </Wizard>
  );
}
