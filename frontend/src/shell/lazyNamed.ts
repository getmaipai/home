import { lazy, type ComponentType, type LazyExoticComponent } from "react";

/** React.lazy for a module that exports named components. A failed chunk fetch uses the shared stale-chunk
 * retry wired in main.tsx, so lazy routes need no reload path of their own. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function lazyNamed<M extends Record<string, unknown>, K extends keyof M & string>(loader: () => Promise<M>, name: K): LazyExoticComponent<M[K] extends ComponentType<any> ? M[K] : never> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return lazy(() => loader().then((m) => ({ default: m[name] as ComponentType<any> }))) as never;
}
