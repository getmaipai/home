import { forwardRef } from "react";
import type { ButtonHTMLAttributes } from "react";
import { Slot } from "@radix-ui/react-slot";
import { cn, FOCUS_RING } from "@/kit/utils";

// Hand-written to shadcn/ui's usual API (variant/size props, asChild via
// Radix Slot) rather than pulled in through the shadcn CLI generator
// tonight (docs/UI.md > the kit is "a thin layer over shadcn/ui on Radix
// and Tailwind v4"). Swapping this for the CLI-generated version later is
// a drop-in, not an API change, once that's worth doing.
export type ButtonVariant = "default" | "secondary" | "ghost" | "destructive";
export type ButtonSize = "default" | "sm" | "lg" | "icon";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  asChild?: boolean;
}

const variantClasses: Record<ButtonVariant, string> = {
  default: "bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))] hover:opacity-90",
  secondary: "bg-[hsl(var(--muted))] text-[hsl(var(--foreground))] hover:opacity-90",
  ghost: "hover:bg-[hsl(var(--muted))]",
  destructive: "bg-[hsl(var(--destructive))] text-[hsl(var(--destructive-foreground))] hover:opacity-90",
};

// 48px is the kit's hard minimum touch target (docs/UI.md); "default" and
// "lg" clear it directly, "sm" is desktop/mouse-only and never the only
// way to reach an action a touch or TV surface must also use.
const sizeClasses: Record<ButtonSize, string> = {
  default: "h-12 px-4 text-base",
  sm: "h-9 px-3 text-sm",
  lg: "h-14 px-6 text-lg",
  icon: "h-12 w-12",
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = "default", size = "default", asChild, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return (
      <Comp
        ref={ref}
        className={cn(
          "inline-flex items-center justify-center gap-2 rounded-[var(--radius)] font-medium",
          "transition-opacity disabled:pointer-events-none disabled:opacity-50",
          FOCUS_RING,
          variantClasses[variant],
          sizeClasses[size],
          className,
        )}
        {...props}
      />
    );
  },
);
Button.displayName = "Button";
