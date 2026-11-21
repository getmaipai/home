import { i18n } from "@lingui/core";
import { useEffect, useState } from "react";
import { Section } from "@maipai/ui/src/primitives/Section";
import { RadioGroup, RadioGroupItem } from "@maipai/ui/src/dashboard/components/ui/radio-group";
import { Item, ItemActions, ItemContent, ItemDescription, ItemGroup, ItemTitle } from "@maipai/ui/src/dashboard/components/ui/item";
import { StatusCard } from "@maipai/ui/src/elements/status-card";
import { api, type VoiceEngineChoice } from "@/lib/api";
import { errorLine } from "@/lib/hubReachability";

// VOICE-VOXCPM2-01: owner and admin choose which voice engine speaks. The MaiPai Stack keeps the value; saving goes through
// /api/voice/engine, which applies it there. Voices made from recordings keep working on every choice.
const CHOICES: Array<{ value: VoiceEngineChoice; title: () => string; line: () => string }> = [
  { value: "auto", title: () => i18n._({ id: "Standard", message: "Standard" }), line: () => i18n._({ id: "The voice Home uses now. It is quick, and it can laugh and sigh.", message: "The voice Home uses now. It is quick, and it can laugh and sigh." }) },
  { value: "voxcpm2", title: () => i18n._({ id: "VoxCPM2 (natural)", message: "VoxCPM2 (natural)" }), line: () => i18n._({ id: "Sounds very natural and copies a voice from a recording well. It needs a one-time download.", message: "Sounds very natural and copies a voice from a recording well. It needs a one-time download." }) },
  { value: "voxcpm2-reduced", title: () => i18n._({ id: "VoxCPM2 (smaller)", message: "VoxCPM2 (smaller)" }), line: () => i18n._({ id: "The same voice in a smaller size, for a computer that is busy with other work. It needs a one-time download.", message: "The same voice in a smaller size, for a computer that is busy with other work. It needs a one-time download." }) },
];

export function VoiceEngineSection() {
  const [current, setCurrent] = useState<VoiceEngineChoice | null>(null);
  const [available, setAvailable] = useState(true);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    api.voiceEngine().then((view) => { if (alive) { setCurrent(view.pending ?? view.current); setAvailable(view.available); } }).catch((e) => { if (alive) setError(errorLine(e, i18n._({ id: "Could not load the voice choice.", message: "Could not load the voice choice." }))); });
    return () => { alive = false; };
  }, []);

  async function choose(next: VoiceEngineChoice) {
    setBusy(true); setError(null); setSaved(false);
    try {
      const view = await api.setVoiceEngine(next);
      setCurrent(view.pending ?? view.current);
      setSaved(true);
    } catch (e) {
      setError(errorLine(e, i18n._({ id: "Could not save that choice.", message: "Could not save that choice." })));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Section heading={i18n._({ id: "Voice engine", message: "Voice engine" })}>
      <p className="text-body text-muted-foreground">{i18n._({ id: "Pick the voice that speaks the replies. Voices you made from recordings keep working. Saving restarts the voice for a moment.", message: "Pick the voice that speaks the replies. Voices you made from recordings keep working. Saving restarts the voice for a moment." }) }</p>
      {error ? <StatusCard kind="problem" title={i18n._({ id: "That did not work", message: "That did not work" })} line={error} /> : null}
      {!available ? <p className="text-body text-muted-foreground">{i18n._({ id: "This Stack is too old to offer a choice. Update it in Settings, then Engines.", message: "This Stack is too old to offer a choice. Update it in Settings, then Engines." })}</p> : null}
      {current !== null && available ? (
        <RadioGroup value={current} onValueChange={(next) => void choose(next as VoiceEngineChoice)} disabled={busy}>
          <ItemGroup variant="card">
            {CHOICES.map((choice) => (
              <Item key={choice.value} size="setting">
                <ItemContent><ItemTitle>{choice.title()}</ItemTitle><ItemDescription clamp={false}>{choice.line()}</ItemDescription></ItemContent>
                <ItemActions><RadioGroupItem value={choice.value} aria-label={choice.title()} /></ItemActions>
              </Item>
            ))}
          </ItemGroup>
        </RadioGroup>
      ) : null}
      {saved ? <p className="text-body text-primary">{i18n._({ id: "Saved.", message: "Saved." })}</p> : null}
    </Section>
  );
}
