// "Who does this style look like?" and "Who is in this photo?" use the server's eligible household subjects.
import { useQuery } from "@tanstack/react-query";
import { Label } from "@maipai/ui/src/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@maipai/ui/src/ui/select";
import { likenessApi } from "@/lib/likenessApi";

export const NOBODY = "nobody";

export function LooksLikePicker({ id, label, value, onChange, disabled, nobodyLabel = "Nobody (not a real person)", help }: { id: string; label: string; value: string; onChange: (value: string) => void; disabled?: boolean; nobodyLabel?: string | null; help?: string }) {
  const adults = useQuery({ queryKey: ["likeness-adults"], queryFn: likenessApi.adults, staleTime: 30_000 });
  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor={id}>{label}</Label>
      <Select value={value} onValueChange={(next) => onChange(next ?? "")} disabled={disabled}>
        <SelectTrigger id={id} aria-label={label}><SelectValue placeholder="Choose one" /></SelectTrigger>
        <SelectContent>
          {nobodyLabel ? <SelectItem value={NOBODY}>{nobodyLabel}</SelectItem> : null}
          {[...(adults.data ?? [])].sort((a, b) => Number(b.self) - Number(a.self)).map((adult) => (
            <SelectItem key={adult.id} value={adult.id}>
              {adult.self ? `${adult.name} (me)` : adult.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {help ? <p className="text-sm text-muted-foreground">{help}</p> : null}
      {adults.isError ? <p role="alert" className="text-sm text-destructive">Home could not load the list of adults. Reload this page.</p> : null}
    </div>
  );
}
