import type { BaseLayoutProps } from 'fumadocs-ui/layouts/shared';
import { appName } from './shared';

export function baseOptions(): BaseLayoutProps {
  return {
    themeSwitch: { enabled: false },
    nav: {
      title: (
        <>
          <img src="/brand/maipai-home-logo-light.png" alt={appName} className="h-11 w-auto dark:hidden" />
          <img src="/brand/maipai-home-logo-dark.png" alt={appName} className="hidden h-11 w-auto dark:block" />
        </>
      ),
    },
  };
}
