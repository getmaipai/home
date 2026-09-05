import { Avatar as AvatarRoot, AvatarFallback } from "@/kit/ui/avatar";
import { cn } from "@/kit/utils";

interface AvatarProps {
  name: string;
  className?: string;
}

// 3.1's real avatar rendering (DiceBear SVG, PNG rasterization,
// /avatar/:userId) is deferred (home/docs/dev.md's Review queue: "no shell
// or kit work has started; revisit when the shell's profile picker is
// built"). This is that picker's first real caller, so the deferred
// fallback (initials on a flat tint) is what actually ships: not a guess
// at the real thing, the documented fallback becoming real.
//
// A pattern component on top of `kit/ui/avatar.tsx` (name-to-initial is
// product logic, not something a generic Avatar primitive knows), the
// same relationship Card and Select have to their generated bases.
export function Avatar({ name, className }: AvatarProps) {
  const initial = name.trim().charAt(0).toUpperCase() || "?";
  return (
    <AvatarRoot
      // The caller's text size (SignIn's `text-xl`, Shell's `text-sm`,
      // MessageThread's `text-sm`) sets the font-size here, on the root.
      className={cn("size-12 bg-primary text-primary-foreground font-semibold text-base after:hidden", className)}
    >
      {/* kit/ui/avatar.tsx's AvatarFallback hardcodes its own `text-sm` in
          its base classes, so it never actually inherited the root's size
          in the first place (a code review, 2026-09-05, caught every
          non-default caller's size silently doing nothing - verified live,
          the root's text-xl/text-sm made no difference until this line).
          `text-[length:inherit]` overrides that hardcoded size back to
          "whatever the root above is set to", which is the one property
          Tailwind has no bare utility for (`text-inherit` sets color, not
          size). */}
      <AvatarFallback delayMs={0} className="bg-transparent text-[length:inherit] text-primary-foreground">
        {initial}
      </AvatarFallback>
    </AvatarRoot>
  );
}
