import type { ReactNode } from "react";

interface PageProps {
  title: string;
  children: ReactNode;
}

// docs/UI.md: "pages are data... a page has id/title/body[]." The shell
// owns the chrome around this (Shell.tsx); Page is just the body
// container every app's page renders into, one column on phone/tablet
// today (the kit's density budget - 1/2/3 columns phone/tablet/desktop -
// has nothing to split into yet with exactly one page in the whole app).
export function Page({ title, children }: PageProps) {
  return (
    <div className="flex h-full flex-col">
      <h1 className="sr-only">{title}</h1>
      <div className="flex min-h-0 flex-1 flex-col">{children}</div>
    </div>
  );
}
