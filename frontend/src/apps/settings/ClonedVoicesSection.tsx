import { useEffect, useState, type FormEvent } from "react";
import { api, ApiError, isOwnerOrAdminRole, type Roster, type ClonedVoiceInfo } from "@/lib/api";
import { Section } from "@/kit/primitives/Section";
import { Input } from "@/kit/components/Input";
import { Button } from "@/kit/components/Button";

interface ClonedVoicesSectionProps {
  person: Roster;
}

// Voice cloning (2026-09-04, the feature voice.hf_token was built for):
// upload a real audio sample and it becomes selectable as `tts.voice_id`
// through the same setPersonTtsVoiceUnchecked() escape hatch the
// community catalog uses (VoiceCatalogSection.tsx) - a URL, not a
// preset name, so it shows up here the same "the generic dropdown can't
// display it, so this section shows the current value itself" way that
// section's own comment explains. File upload only for v1 (no live
// browser recording - docs/dev.md's scoping note); household-wide list,
// same visibility as the catalog.
export function ClonedVoicesSection({ person }: ClonedVoicesSectionProps) {
  const [voices, setVoices] = useState<ClonedVoiceInfo[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [currentValue, setCurrentValue] = useState<string | null>(null);
  const [label, setLabel] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  async function load() {
    setLoadError(null);
    try {
      const [{ voices: list }, values] = await Promise.all([
        api.clonedVoices(),
        api.settingsValues(`person:${person.id}`),
      ]);
      setVoices(list);
      const voice = values.find((v) => v.key === "tts.voice_id");
      setCurrentValue(typeof voice?.value === "string" ? voice.value : null);
    } catch (e) {
      setLoadError(e instanceof ApiError ? e.message : "Could not load cloned voices.");
    }
  }

  useEffect(() => {
    void load();
  }, [person.id]);

  async function handleUpload(e: FormEvent) {
    e.preventDefault();
    if (!file) return;
    setUploading(true);
    setUploadError(null);
    try {
      await api.uploadClonedVoice(file, label);
      setLabel("");
      setFile(null);
      await load();
    } catch (err) {
      setUploadError(err instanceof ApiError ? err.message : "Could not upload that file.");
    } finally {
      setUploading(false);
    }
  }

  async function selectVoice(id: string) {
    setPendingId(id);
    setActionError(null);
    try {
      const updated = await api.selectClonedVoice(id);
      setCurrentValue(typeof updated.value === "string" ? updated.value : null);
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : "Could not set that voice.");
    } finally {
      setPendingId(null);
    }
  }

  async function deleteVoice(id: string) {
    setPendingId(id);
    setActionError(null);
    try {
      await api.deleteClonedVoice(id);
      await load();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : "Could not delete that voice.");
    } finally {
      setPendingId(null);
    }
  }

  const currentIsCloned = currentValue?.includes("/api/voice/cloned/") ?? false;
  const canManage = isOwnerOrAdminRole(person.role);

  return (
    <Section heading="Cloned voices">
      <p className="text-base text-[hsl(var(--muted-foreground))]">
        Upload a real audio recording of a voice - your own, or anyone in the household who's consented - and use it
        for text-to-speech. Requires a Hugging Face token above.
      </p>
      {loadError ? (
        <div className="flex flex-col items-start gap-2">
          <p className="text-base text-[hsl(var(--destructive))]">{loadError}</p>
          <Button variant="secondary" onClick={load}>
            Try again
          </Button>
        </div>
      ) : (
        <>
          {currentIsCloned ? (
            <p className="text-base text-[hsl(var(--muted-foreground))]">Currently using a cloned voice.</p>
          ) : null}
          <form onSubmit={handleUpload} className="flex max-w-sm flex-col gap-3">
            <Input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="Label (e.g. Dad's voice)"
              disabled={uploading}
              required
            />
            <Input
              type="file"
            aria-label="Choose an audio recording to clone"
              accept="audio/*"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              disabled={uploading}
              required
            />
            {uploadError ? <p className="text-base text-[hsl(var(--destructive))]">{uploadError}</p> : null}
            <Button type="submit" disabled={uploading || !file} className="w-fit">
              {uploading ? "Uploading…" : "Upload"}
            </Button>
          </form>
          {actionError ? <p className="text-base text-[hsl(var(--destructive))]">{actionError}</p> : null}
          {voices === null ? null : voices.length === 0 ? (
            <p className="text-base text-[hsl(var(--muted-foreground))]">No cloned voices yet.</p>
          ) : (
            <ul className="flex flex-col divide-y divide-[hsl(var(--border))]">
              {voices.map((voice) => (
                <li key={voice.id} className="flex items-center justify-between gap-3 py-2">
                  <div className="flex flex-col">
                    <span className="text-base">{voice.label}</span>
                    <span className="text-base text-[hsl(var(--muted-foreground))]">Uploaded by {voice.creatorName}</span>
                  </div>
                  <div className="flex gap-2">
                    <Button variant="secondary" disabled={pendingId === voice.id} onClick={() => selectVoice(voice.id)}>
                      {pendingId === voice.id ? "Setting…" : "Use this voice"}
                    </Button>
                    {canManage || voice.creatorId === person.id ? (
                      <Button variant="secondary" disabled={pendingId === voice.id} onClick={() => deleteVoice(voice.id)}>
                        Delete
                      </Button>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </Section>
  );
}
