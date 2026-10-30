// MEM-SPACE-04: Free up memory. Unloads only Home's own idle models; the sentence says what it would do before the button is pressed. Not the disk "Free up space" button of the AI models page.
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
      setDone(result.unloaded === 0 ? "Nothing was idle, so nothing changed." : `Unloaded ${result.unloaded} idle ${result.unloaded === 1 ? "model" : "models"}, about ${gb(result.freed_bytes)} GB.`);
      await client.invalidateQueries({ queryKey: KEY });
    } catch { setError("Home could not free memory just now. Try again in a moment."); } finally { setBusy(false); }
  }

  return (
    <section data-testid="free-up-memory">
      <Card>
        <CardHeader>
          <CardTitle>Free up memory</CardTitle>
          <CardDescription>{data.models === 0 ? "Nothing idle to unload right now." : `Unload ${data.models} idle ${data.models === 1 ? "model" : "models"}, about ${gb(data.bytes)} GB. Chat and anything running are left alone. Other apps could free more; see System status.`}</CardDescription>
        </CardHeader>
        <CardContent>
          <Button type="button" variant="outline" disabled={busy || data.models === 0} onClick={() => void run()}>{busy ? "Freeing" : "Free up memory"}</Button>
          {done ? <p role="status">{done}</p> : null}
          {error ? <p role="alert">{error}</p> : null}
        </CardContent>
      </Card>
    </section>
  );
}
