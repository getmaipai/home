import { forwardRef } from "react";
import type { InputHTMLAttributes } from "react";
import { cn, FOCUS_RING_INSET } from "@/kit/utils";

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...props }, ref) => (
    <input
      ref={ref}
      className={cn(
        "h-12 w-full rounded-[var(--radius)] border border-[hsl(var(--border))] bg-[hsl(var(--card))]",
        "px-3 text-base text-[hsl(var(--foreground))] placeholder:text-[hsl(var(--muted-foreground))]",
        FOCUS_RING_INSET,
        "disabled:pointer-events-none disabled:opacity-50",
        className,
      )}
      {...props}
    />
  ),
);
Input.displayName = "Input";
