import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useToast } from "@maipai/ui/src/primitives/Toast";
import { Select } from "@maipai/ui/src/primitives/Select";
import { api } from "@/lib/api";

export function CompanionHeaderPicker() {
  const companionQuery = useQuery({ queryKey: ["companions"], queryFn: api.companions, retry: false });
  const toast = useToast();
  const [picked, setPicked] = useState<string | null>(null);
  const candidates = (companionQuery.data?.companions ?? []).filter((card) => card.status === "ready");
  const initialCompanion = candidates.find((card) => card.id === companionQuery.data?.default_id)?.id ?? candidates[0]?.id ?? "";
  const orderedCompanions = [...candidates].sort((a, b) => Number(b.id === companionQuery.data?.default_id) - Number(a.id === companionQuery.data?.default_id));

  return (
    <Select aria-label="Companion" value={picked ?? initialCompanion} options={orderedCompanions.map((card) => card.id)} getLabel={(id) => candidates.find((card) => card.id === id)?.name ?? "MaiPai"} onValueChange={(id) => {
      const card = candidates.find((candidate) => candidate.id === id);
      if (card) { setPicked(card.id); toast.push("Coming soon: switching companions mid-chat"); }
    }} />
  );
}
