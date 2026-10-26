// LIKENESS-01: "Who does this style look like?" (adding a style) and "Who is in this photo?" (the picture editor). A household
// adult from the list, or Nobody. Eligibility is enforced again by the backend when a request is made.
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
          {(adults.data ?? []).map((adult) => (
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
