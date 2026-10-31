// Artwork colour extraction (album covers, video thumbnails, channel banners) for the
// "UltraBlur" backdrop, blended heroes, and the visualizers.
// Downsamples the art to a tiny canvas, buckets pixels into a coarse histogram, and
// picks a small palette biased toward vibrant colours (covers are mostly dark/neutral,
// so a naive "most common" pick yields mud). Art MUST be served same-origin through our
// image proxies (proxyImg/proxyImgAuto/ytImageProxy) - a cross-origin URL taints the
// canvas and silently yields defaultPalette().

import { useEffect, useState } from 'react'

export interface Palette {
  /** Most prominent colour overall. */
  dominant: string
  /** Most saturated prominent colour - the accent for bars/glow. */
  vibrant: string
  /** A darker companion, for gradient depth. */
  dark: string
  /** A light companion, for text-safe highlights. */
  light: string
  /** Four hue-diverse prominent colours for the UltraBlur corner gradients. */
  corners: [string, string, string, string]
  /** True when the cover is essentially monochrome (palette collapses to tints). */
  muted: boolean
}

/** One dark-theme color (a CSS variable such as `--primary`) as `#rrggbb`: the browser resolves it on a 1px canvas, so any CSS color syntax works. */
function themeHex(variable: string): string {
  try {
    // The dark theme's tokens: the visualizers draw light colors on a dark stage whichever theme the person uses.
    const probe = document.createElement('div')
    probe.className = 'dark'
    probe.hidden = true
    document.body.appendChild(probe)
    const value = getComputedStyle(probe).getPropertyValue(variable).trim()
    probe.remove()
    const ctx = document.createElement('canvas').getContext('2d', { willReadFrequently: true })
    if (!ctx || !value) return hex(128, 128, 128)
    ctx.fillStyle = value
    ctx.fillRect(0, 0, 1, 1)
    const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data
    return hex(r!, g!, b!)
  } catch { return hex(128, 128, 128) }
}

/** The palette when there is no art (or it cannot be read): the person's own theme colors, never a fixed color. */
export function defaultPalette(): Palette {
  const primary = themeHex('--primary'), background = themeHex('--background'), foreground = themeHex('--foreground')
  // `dark` is the primary pulled halfway to the background, so the base of a bar reads on a dark or light bar rather than vanishing into it.
  const dark = hex(...mixRgb(hexToRgb(primary), hexToRgb(background), 0.5))
  const vibrant = hex(...mixRgb(hexToRgb(primary), hexToRgb(foreground), 0.3))
  return { dominant: primary, vibrant, dark, light: foreground, corners: [primary, vibrant, dark, foreground], muted: true }
}

const cache = new Map<string, Palette>()

// Extraction is pure per URL, so persist results across reloads: the Map is seeded from
// localStorage at module load and written back (debounced, newest-300) after each new
// extraction. Before this, every navigation/reload re-decoded and re-histogrammed the
// same covers; now only art never seen on this device pays the canvas pass.
const LS_KEY = 'artPalette.cache.v1'
const LS_MAX = 300
try {
  const raw = localStorage.getItem(LS_KEY)
  if (raw) for (const [k, v] of JSON.parse(raw) as [string, Palette][]) cache.set(k, v)
} catch { /* corrupt/unavailable storage, start empty */ }

let persistTimer: ReturnType<typeof setTimeout> | null = null
function schedulePersist(): void {
  if (persistTimer) return
  persistTimer = setTimeout(() => {
    persistTimer = null
    try {
      const entries = [...cache.entries()].slice(-LS_MAX)
      localStorage.setItem(LS_KEY, JSON.stringify(entries))
    } catch { /* quota/unavailable, in-memory cache still works */ }
  }, 2000)
}

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  r /= 255; g /= 255; b /= 255
  const max = Math.max(r, g, b), min = Math.min(r, g, b)
  const l = (max + min) / 2
  if (max === min) return [0, 0, l]
  const d = max - min
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
  let h = 0
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6
  else if (max === g) h = ((b - r) / d + 2) / 6
  else h = ((r - g) / d + 4) / 6
  return [h, s, l]
}
const hex = (r: number, g: number, b: number) =>
  '#' + [r, g, b].map(x => Math.max(0, Math.min(255, Math.round(x))).toString(16).padStart(2, '0')).join('')

function extract(img: HTMLImageElement): Palette {
  const N = 40
  const cv = document.createElement('canvas')
  cv.width = N; cv.height = N
  const ctx = cv.getContext('2d', { willReadFrequently: true })
  if (!ctx) return defaultPalette()
  ctx.drawImage(img, 0, 0, N, N)
  let data: Uint8ClampedArray
  try { data = ctx.getImageData(0, 0, N, N).data } catch { return defaultPalette() }

  // Coarse 4-bit-per-channel histogram; track a saturation-weighted score per bucket so
  // vibrant regions outrank a large flat dark background.
  const buckets = new Map<number, { r: number; g: number; b: number; n: number; score: number }>()
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i]!, g = data[i + 1]!, b = data[i + 2]!, a = data[i + 3]!
    if (a < 128) continue
    const [, s, l] = rgbToHsl(r, g, b)
    const key = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4)
    const cur = buckets.get(key) ?? { r: 0, g: 0, b: 0, n: 0, score: 0 }
    cur.r += r; cur.g += g; cur.b += b; cur.n += 1
    // Prefer mid-luminance, saturated pixels; discount near-black/near-white and grey.
    cur.score += (0.25 + s) * (1 - Math.abs(l - 0.5) * 1.2)
    buckets.set(key, cur)
  }
  const list = [...buckets.values()].filter(b => b.n > 1)
  if (!list.length) return defaultPalette()

  const avg = (b: { r: number; g: number; b: number; n: number }) => [b.r / b.n, b.g / b.n, b.b / b.n] as const
  const byCount = [...list].sort((a, b) => b.n - a.n)
  const byScore = [...list].sort((a, b) => b.score - a.score)
  const byDark = [...list].sort((a, b) => {
    const [ar, ag, ab] = avg(a), [br, bg, bb] = avg(b)
    return (ar + ag + ab) - (br + bg + bb)
  })
  const byLight = [...byDark].reverse()

  const [dr, dg, db] = avg(byCount[0]!)
  const [vr, vg, vb] = avg(byScore[0]!)
  const [kr, kg, kb] = avg(byDark[0]!)
  const [lr, lg, lb] = avg(byLight[0]!)
  const [, vibrSat] = rgbToHsl(vr, vg, vb)

  // UltraBlur corners: walk the score ranking and greedily keep colours that differ enough
  // in hue OR luminance from the ones already kept, so the four corner washes read as a
  // gradient field instead of one flat tint. Pad with darkened repeats when a cover is
  // genuinely monochrome.
  const picked: Array<readonly [number, number, number]> = []
  for (const b of byScore) {
    const c = avg(b)
    const [h1, s1, l1] = rgbToHsl(c[0], c[1], c[2])
    const distinct = picked.every(p => {
      const [h2, , l2] = rgbToHsl(p[0], p[1], p[2])
      const dh = Math.min(Math.abs(h1 - h2), 1 - Math.abs(h1 - h2))
      return dh > 0.08 || Math.abs(l1 - l2) > 0.22
    })
    if (distinct && s1 > 0.04) picked.push(c)
    if (picked.length === 4) break
  }
  while (picked.length < 4) {
    const base = picked[0] ?? ([dr, dg, db] as const)
    const f = 0.55 + picked.length * 0.12
    picked.push([base[0] * f, base[1] * f, base[2] * f] as const)
  }
  // Darken for text safety: Plexamp's backdrops always stay dark enough for white chrome,
  // so clamp each corner's luminance rather than relying on a heavy scrim alone.
  const corners = picked.map(c => {
    const [, , l] = rgbToHsl(c[0], c[1], c[2])
    const f = l > 0.38 ? 0.38 / l : 1
    return hex(c[0] * f, c[1] * f, c[2] * f)
  }) as [string, string, string, string]

  return {
    dominant: hex(dr, dg, db),
    vibrant: hex(vr, vg, vb),
    dark: hex(kr * 0.7, kg * 0.7, kb * 0.7),
    light: hex(lr, lg, lb),
    corners,
    muted: vibrSat < 0.2,
  }
}

/** The palette accent for controls: the vibrant swatch, unless the cover is essentially
 *  monochrome or its "vibrant" is too pale/washed-out to read as a colour on the filled
 *  play button - then fall back to the theme's primary so chrome never goes grey-on-grey. */
export function accentOf(palette: Palette): string {
  const GOLD = themeHex('--primary')
  if (palette.muted) return GOLD
  const m = /^#?([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i.exec(palette.vibrant)
  if (!m) return GOLD
  const [, s, l] = rgbToHsl(parseInt(m[1]!, 16), parseInt(m[2]!, 16), parseInt(m[3]!, 16))
  return s < 0.28 || l > 0.8 || l < 0.12 ? GOLD : palette.vibrant
}
export function useArtPalette(url: string | null | undefined): Palette {
  const [palette, setPalette] = useState<Palette>(() => (url && cache.get(url)) || defaultPalette())
  useEffect(() => {
    if (!url) { setPalette(defaultPalette()); return }
    const cached = cache.get(url)
    if (cached) { setPalette(cached); return }
    let alive = true
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => {
      const p = extract(img)
      cache.set(url, p)
      schedulePersist()
      if (alive) setPalette(p)
    }
    img.onerror = () => { if (alive) setPalette(defaultPalette()) }
    img.src = url
    return () => { alive = false }
  }, [url])
  return palette
}

// ── Shared color math for the canvas visualizers ─────────────────────────────
// (canvas fillStyle can't consume CSS vars, so visualizers work in parsed RGB)

export type Rgb = [number, number, number]
export function hexToRgb(h: string): Rgb {
  const m = /^#?([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i.exec(h)
  return m ? [parseInt(m[1]!, 16), parseInt(m[2]!, 16), parseInt(m[3]!, 16)] : [176, 107, 255]
}
export const mixRgb = (a: Rgb, b: Rgb, t: number): Rgb =>
  [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]
export const rgba = (c: Rgb, a: number) => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`

/** Build a Palette from one or two plain colors, for surfaces without album art
 *  (live radio's amber, the YouTube audio player's cyan, the Studio default). */
