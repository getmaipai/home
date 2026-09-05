import * as React from "react"
import { SURFACE_MIN_WIDTH_PX } from "@/kit/responsive"

// Generated at 768px; repointed to the kit's own tablet breakpoint
// (docs/UI.md: "Four surfaces, one set of breakpoints owned by the kit")
// so the Sidebar's internal mobile/Sheet cutover lines up with the same
// 640px line every other kit primitive uses, rather than a second,
// disagreeing definition of "phone."
const MOBILE_BREAKPOINT = SURFACE_MIN_WIDTH_PX.tablet

export function useIsMobile() {
  const [isMobile, setIsMobile] = React.useState<boolean | undefined>(undefined)

  React.useEffect(() => {
    const mql = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`)
    const onChange = () => {
      setIsMobile(window.innerWidth < MOBILE_BREAKPOINT)
    }
    mql.addEventListener("change", onChange)
    setIsMobile(window.innerWidth < MOBILE_BREAKPOINT)
    return () => mql.removeEventListener("change", onChange)
  }, [])

  return !!isMobile
}
