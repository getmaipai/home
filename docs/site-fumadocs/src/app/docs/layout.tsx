import { source } from '@/lib/source';
import { DocsLayout } from 'fumadocs-ui/layouts/docs';
import { ThemeButton } from '@/components/theme-button';
import { baseOptions } from '@/lib/layout.shared';

export default function Layout({ children }: LayoutProps<'/docs'>) {
  return (
    <DocsLayout tree={source.getPageTree()} {...baseOptions()}>
      {children}
      <ThemeButton />
      {/* Sample of the in-app Help assistant entry point; not wired up in this spike. */}
      <div className="fab-stack">
        <button type="button" className="fab" aria-label="Help topics">?</button>
        <button type="button" className="fab" aria-label="Scroll to top">↑</button>
      </div>
      <button type="button" className="ask-help" aria-label="Ask Help">
        <span aria-hidden>💬</span> Ask Help
      </button>
    </DocsLayout>
  );
}
