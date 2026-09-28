"use client";

import { type ComponentPropsWithRef, forwardRef } from "react";
import { Slot } from "radix-ui";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@maipai/ui/src/ui/tooltip";
import { Button } from "@maipai/ui/src/ui/button";
import { cn } from "@maipai/ui/src/utils";

type TooltipIconButtonProps = ComponentPropsWithRef<typeof Button> & {
  tooltip: string;
  side?: "top" | "bottom" | "left" | "right";
};

export const HomeTooltipIconButton = forwardRef<HTMLButtonElement, TooltipIconButtonProps>(function HomeTooltipIconButton(
  { children, tooltip, side = "bottom", className, ...rest },
  ref,
) {
  return (
    <TooltipProvider delayDuration={0}>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            {...rest}
            className={cn(
              "relative size-6 p-1 before:absolute before:-inset-3 before:content-[''] active:scale-90",
              className,
            )}
            ref={ref}
          >
            <Slot.Slottable>{children}</Slot.Slottable>
            <span className="sr-only">{tooltip}</span>
          </Button>
        </TooltipTrigger>
        <TooltipContent side={side}>{tooltip}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
});

HomeTooltipIconButton.displayName = "HomeTooltipIconButton";
