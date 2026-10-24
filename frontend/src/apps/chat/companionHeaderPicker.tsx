import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Avatar } from "@maipai/ui/src/primitives/Avatar";
import { useToast } from "@maipai/ui/src/primitives/Toast";
import { Button } from "@maipai/ui/src/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@maipai/ui/src/ui/dropdown-menu";
import { api } from "@/lib/api";

export function CompanionHeaderPicker() {
  const companionQuery = useQuery({ queryKey: ["companions"], queryFn: api.companions, retry: false });
  const toast = useToast();
  const [picked, setPicked] = useState<string | null>(null);
  const candidates = (companionQuery.data?.companions ?? []).filter((card) => card.status === "ready");
  const initialCompanion = candidates.find((card) => card.id === companionQuery.data?.default_id)?.name ?? "MaiPai";
  const orderedCompanions = [...candidates].sort((a, b) => Number(b.id === companionQuery.data?.default_id) - Number(a.id === companionQuery.data?.default_id));

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button type="button" variant="ghost" size="sm">
            <Avatar name={picked ?? initialCompanion} />
            {picked ?? initialCompanion}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" density="compact">
          {orderedCompanions.map((card) => <DropdownMenuItem key={card.id} onClick={() => {
            setPicked(card.name);
            toast.push("Coming soon: switching companions mid-chat");
          }}><Avatar name={card.name} />{card.name}</DropdownMenuItem>)}
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  );
}
