import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/kit/utils"
import { Tabs as TabsPrimitive } from "radix-ui"

function Tabs({
  className,
  orientation = "horizontal",
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Root>) {
  return (
    <TabsPrimitive.Root
      data-slot="tabs"
      data-orientation={orientation}
      className={cn(
        // gap-4, not gap-2: a code review caught TabsTrigger's own 48px
        // touch-target hit-area extension (`before:-inset-*-3.5`, 14px)
        // reaching past the default 8px gap plus TabsList's own 3px
        // padding (11px of real clearance) into TabsContent's own top
        // edge - a tap on the first few pixels of a tab's content could
        // activate the trigger instead. Fixed at the DEFAULT rather
        // than left for every consumer to remember (a first fix only
        // widened the one real consumer's own usage, which a second
        // review pass caught as leaving the primitive itself still
        // unsafe for the next one) - 16px clears the 14px extension
        // with a real 5px margin. A caller needing tighter spacing can
        // still override via `className`, same as any other prop here.
        "group/tabs flex gap-4 data-horizontal:flex-col",
        className
      )}
      {...props}
    />
  )
}

const tabsListVariants = cva(
  "group/tabs-list inline-flex w-fit items-center justify-center rounded-lg p-[3px] text-muted-foreground group-data-horizontal/tabs:h-8 group-data-vertical/tabs:h-fit group-data-vertical/tabs:flex-col data-[variant=line]:rounded-none",
  {
    variants: {
      variant: {
        default: "bg-muted",
        line: "gap-1 bg-transparent",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

function TabsList({
  className,
  variant = "default",
  ...props
}: React.ComponentProps<typeof TabsPrimitive.List> &
  VariantProps<typeof tabsListVariants>) {
  return (
    <TabsPrimitive.List
      data-slot="tabs-list"
      data-variant={variant}
      // Deliberate touch-target-floor exception (docs/UI.md): Radix's
      // own RovingFocusGroup puts a real, roving `tabIndex` on this
      // LIST wrapper itself (@radix-ui/react-tabs, TabsList's `asChild`
      // onto RovingFocusGroup.Root), not just on each trigger - the
      // sweep's `[tabindex]:not([tabindex="-1"])` selector catches the
      // wrapper as if it were its own click target. It isn't one: its
      // two real targets are the TabsTrigger buttons inside, each
      // already cleared to 48px on its own (found live, lane 11 item 2,
      // 2026-09-13, the first real page to render this kit primitive).
      data-touch-target-exempt
      className={cn(tabsListVariants({ variant }), className)}
      {...props}
    />
  )
}

function TabsTrigger({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Trigger>) {
  return (
    <TabsPrimitive.Trigger
      data-slot="tabs-trigger"
      className={cn(
        // docs/UI.md's 48px touch-target floor ("the kit refuses to go
        // below"), the same technique button.tsx's own compact sizes
        // (xs/sm/icon-xs/icon-sm) already use: a transparent `::before`
        // extending the real tappable area past the compact painted box
        // rather than growing the tab bar itself. `before` only, not
        // `after` (already this trigger's own active-tab underline).
        // -inset-*-3.5 (14px) against this trigger's own ~31px painted
        // height clears the 48px floor with real margin (the measured
        // credit ran a few px short of the naive 2x-inset math, not
        // worth chasing exactly why - this size clears it comfortably
        // either way) - found live (scripts/screenshot.ts's touch-
        // target-floor check) the first time this kit primitive got a
        // real page to render it (lane 11 item 2, 2026-09-13, the
        // Memory app's Tabs). Only the CROSS axis, never the axis
        // adjacent triggers sit along - a code review caught the first
        // version (`-inset-3.5` on all four sides) extending 14px INTO
        // the next trigger too, and the default TabsList variant has no
        // gap between triggers (only `variant="line"` does), so the
        // two invisible hit-areas overlapped by 28px and a tap near
        // either trigger's shared edge activated whichever one is later
        // in the DOM. Horizontal tabs (today's only real consumer) sit
        // side by side, so only Y needs the credit; vertical tabs stack
        // top to bottom, so only X would. A future trigger too NARROW
        // to clear 48px on its own even with this axis's own credit
        // would still need real TabsList spacing, not a bigger inset -
        // the same live check that caught this will catch that too.
        "relative inline-flex h-[calc(100%-1px)] flex-1 items-center justify-center gap-1.5 rounded-md border border-transparent px-1.5 py-0.5 text-sm font-medium whitespace-nowrap text-foreground/60 transition-all before:absolute before:content-[''] group-data-horizontal/tabs:before:-inset-y-3.5 group-data-vertical/tabs:before:-inset-x-3.5 group-data-vertical/tabs:w-full group-data-vertical/tabs:justify-start hover:text-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-1 focus-visible:outline-ring disabled:pointer-events-none disabled:opacity-50 has-data-[icon=inline-end]:pr-1 has-data-[icon=inline-start]:pl-1 dark:text-muted-foreground dark:hover:text-foreground group-data-[variant=default]/tabs-list:data-active:shadow-sm group-data-[variant=line]/tabs-list:data-active:shadow-none [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        "group-data-[variant=line]/tabs-list:bg-transparent group-data-[variant=line]/tabs-list:data-active:bg-transparent dark:group-data-[variant=line]/tabs-list:data-active:border-transparent dark:group-data-[variant=line]/tabs-list:data-active:bg-transparent",
        "data-active:bg-background data-active:text-foreground dark:data-active:border-input dark:data-active:bg-input/30 dark:data-active:text-foreground",
        "after:absolute after:bg-foreground after:opacity-0 after:transition-opacity group-data-horizontal/tabs:after:inset-x-0 group-data-horizontal/tabs:after:bottom-[-5px] group-data-horizontal/tabs:after:h-0.5 group-data-vertical/tabs:after:inset-y-0 group-data-vertical/tabs:after:-right-1 group-data-vertical/tabs:after:w-0.5 group-data-[variant=line]/tabs-list:data-active:after:opacity-100",
        className
      )}
      {...props}
    />
  )
}

function TabsContent({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Content>) {
  return (
    <TabsPrimitive.Content
      data-slot="tabs-content"
      className={cn("flex-1 text-sm outline-none", className)}
      {...props}
    />
  )
}

export { Tabs, TabsList, TabsTrigger, TabsContent, tabsListVariants }
