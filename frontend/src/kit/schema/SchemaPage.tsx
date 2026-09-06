import type { ReactNode } from "react";
import { Page } from "@/kit/primitives/Page";
import { NodeRenderer } from "@/kit/schema/NodeRenderer";
import { PageNodeSchema } from "@/kit/schema/types";
import { cn, FOCUS_RING } from "@/kit/utils";

/** Renders a `spec/ui/pages/*.json` document (imported as a plain JSON
 * module - Vite resolves `.json` imports at build time, no fetch, no
 * runtime file I/O). Parsing through PageNodeSchema (not just trusting
 * the import's TS shape) is deliberate: it's the same page.json that
 * ajv already validated in spec/tests/ts/ui-schema.test.ts, but that
 * suite runs at `spec`'s own `check.sh` time - a frontend build has no
 * guarantee it ran, or ran against the same file, so this is the
 * frontend's own independent proof the page it's about to render is
 * shaped the way NodeRenderer.tsx expects.
 *
 * `beforeBody` is an escape hatch for exactly one real need (Memory's
 * "Showing N / Show all" banner, MemoryPage.tsx): a page-instance
 * concern (a URL query param) that isn't part of the page's own
 * declarative structure, rendered inside the same scrollable body a
 * sibling of `<SchemaPage>` couldn't reach. */
export function SchemaPage({ page, beforeBody }: { page: unknown; beforeBody?: ReactNode }) {
  const parsed = PageNodeSchema.parse(page);
  return (
    <Page title={parsed.title}>
      {/* eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- a keyboard-scrollable region, not a widget (DetailPane.tsx's own precedent). */}
      <div tabIndex={0} className={cn("flex min-w-0 flex-1 flex-col gap-6 overflow-y-auto p-4", FOCUS_RING)}>
        {beforeBody}
        <NodeRenderer node={parsed} />
      </div>
    </Page>
  );
}
