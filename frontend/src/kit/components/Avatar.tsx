import * as RadixAvatar from "@radix-ui/react-avatar";
import { cn } from "@/kit/utils";

interface AvatarProps {
  name: string;
  className?: string;
}

// 3.1's real avatar rendering (DiceBear SVG, PNG rasterization,
// /avatar/:userId) is deferred (home/docs/dev.md's Review queue: "no shell
// or kit work has started; revisit when the shell's profile picker is
// built"). This is that picker's first real caller, so the deferred
// fallback (initials on a flat tint) is what actually ships tonight: not
// a guess at the real thing, the documented fallback becoming real.
export function Avatar({ name, className }: AvatarProps) {
  const initial = name.trim().charAt(0).toUpperCase() || "?";
  return (
    <RadixAvatar.Root
      className={cn(
        "inline-flex h-12 w-12 shrink-0 select-none items-center justify-center overflow-hidden rounded-full",
        "bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))] font-semibold",
        className,
      )}
    >
      <RadixAvatar.Fallback delayMs={0}>{initial}</RadixAvatar.Fallback>
    </RadixAvatar.Root>
  );
}
