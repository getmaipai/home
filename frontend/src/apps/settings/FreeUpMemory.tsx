// MEM-SPACE-04: Free up memory. Unloads only Home's own idle models; the sentence says what it would do before the button is pressed. Not the disk "Free up space" button of the AI models page.
import { i18n } from "@lingui/core";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@maipai/ui/src/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@maipai/ui/src/dashboard/components/ui/card";
import { request } from "@/lib/api";

interface Reclaim { available: boolean; models: number; bytes: number }
const KEY = ["performance-reclaim"];
const gb = (bytes: number) => (bytes / 1024 ** 3).toFixed(1);

export function FreeUpMemory() {
  const client = useQueryClient();
  const [done, setDone] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const { data } = useQuery({ queryKey: KEY, queryFn: () => request<Reclaim>("/api/performance/reclaim"), retry: false });
  if (!data?.available) return null;

  async function run() {
    setBusy(true); setError(null); setDone(null);
    try {
      const result = await request<{ unloaded: number; freed_bytes: number }>("/api/performance/reclaim", { method: "POST", body: JSON.stringify({}) });
      setDone(result.unloaded === 0 ? i18n._({ id: "Nothing was idle, so nothing changed.", message: "Nothing was idle, so nothing changed." }) : i18n._({ id: "Unloaded {count, plural, one {# idle model} other {# idle models}}, about {size} GB.", message: "Unloaded {count, plural, one {# idle model} other {# idle models}}, about {size} GB.", values: { count: result.unloaded, size: gb(result.freed_bytes) } }));
      await client.invalidateQueries({ queryKey: KEY });
    } catch { setError(i18n._({ id: "Home could not free memory just now. Try again in a moment.", message: "Home could not free memory just now. Try again in a moment." })); } finally { setBusy(false); }
  }

  return (
    <section data-testid="free-up-memory">
      <Card>
        <CardHeader>
          <CardTitle>{i18n._({ id: "Free up memory", message: "Free up memory" })}</CardTitle>
          <CardDescription>{data.models === 0 ? i18n._({ id: "Nothing idle to unload right now.", message: "Nothing idle to unload right now." }) : i18n._({ id: "Unload {count, plural, one {# idle model} other {# idle models}}, about {size} GB. Chat and anything running are left alone. Other apps could free more; see System status.", message: "Unload {count, plural, one {# idle model} other {# idle models}}, about {size} GB. Chat and anything running are left alone. Other apps could free more; see System status.", values: { count: data.models, size: gb(data.bytes) } })}</CardDescription>
        </CardHeader>
        <CardContent>
          <Button type="button" variant="outline" disabled={busy || data.models === 0} onClick={() => void run()}>{busy ? i18n._({ id: "Freeing", message: "Freeing" }) : i18n._({ id: "Free up memory", message: "Free up memory" })}</Button>
          {done ? <p role="status">{done}</p> : null}
          {error ? <p role="alert">{error}</p> : null}
        </CardContent>
      </Card>
    </section>
  );
}
