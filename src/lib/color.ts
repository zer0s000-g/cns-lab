/**
 * Helpers for colours that come from CSS design tokens. Nothing here defines
 * a colour: it only parses token values (hsl()/rgb()/#rgb) that were read from
 * globals.css at runtime, and re-emits them with a different alpha or in the
 * comma syntax that three.js understands.
 */

export interface Rgba {
  r: number
  g: number
  b: number
  a: number
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const hh = (((h % 360) + 360) % 360) / 360
  if (s === 0) return [l, l, l]
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s
  const p = 2 * l - q
  const f = (t: number) => {
    let x = t
    if (x < 0) x += 1
    if (x > 1) x -= 1
    if (x < 1 / 6) return p + (q - p) * 6 * x
    if (x < 1 / 2) return q
    if (x < 2 / 3) return p + (q - p) * (2 / 3 - x) * 6
    return p
  }
  return [f(hh + 1 / 3), f(hh), f(hh - 1 / 3)]
}

/** Parse a CSS colour string of the forms used by the tokens. Returns null if unknown. */
export function parseColor(input: string): Rgba | null {
  const s = input.trim()
  const fn = /^(hsla?|rgba?)\((.*)\)$/i.exec(s)
  if (fn) {
    const kind = fn[1].toLowerCase()
    const parts = fn[2]
      .replace(/\//g, ' ')
      .replace(/,/g, ' ')
      .split(/\s+/)
      .filter(Boolean)
    const num = (v: string | undefined, pctScale = 1) => {
      if (v === undefined) return undefined
      return v.endsWith('%') ? (parseFloat(v) / 100) * pctScale : parseFloat(v)
    }
    const aRaw = parts[3]
    const a = aRaw === undefined ? 1 : aRaw.endsWith('%') ? parseFloat(aRaw) / 100 : parseFloat(aRaw)
    if (kind.startsWith('hsl')) {
      const h = parseFloat(parts[0])
      const sat = num(parts[1]) ?? 0
      const lig = num(parts[2]) ?? 0
      const [r, g, b] = hslToRgb(h, sat, lig)
      return { r: r * 255, g: g * 255, b: b * 255, a }
    }
    const r = num(parts[0], 255) ?? 0
    const g = num(parts[1], 255) ?? 0
    const b = num(parts[2], 255) ?? 0
    return { r, g, b, a }
  }
  const hex = /^#([0-9a-f]{3,8})$/i.exec(s)
  if (hex) {
    let h = hex[1]
    if (h.length === 3 || h.length === 4) h = h.split('').map((c) => c + c).join('')
    const n = parseInt(h.slice(0, 6), 16)
    const a = h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255, a }
  }
  return null
}

/** Re-emit a token colour with a new alpha (multiplied with any alpha it already has). */
export function withAlpha(color: string, alpha: number): string {
  const c = parseColor(color)
  if (!c) return color
  const a = Math.max(0, Math.min(1, c.a * alpha))
  return `rgba(${Math.round(c.r)}, ${Math.round(c.g)}, ${Math.round(c.b)}, ${a.toFixed(3)})`
}

/** Mix two token colours, t = 0 gives a, t = 1 gives b. */
export function mix(a: string, b: string, t: number): string {
  const ca = parseColor(a)
  const cb = parseColor(b)
  if (!ca || !cb) return a
  const m = (x: number, y: number) => x + (y - x) * t
  return `rgba(${Math.round(m(ca.r, cb.r))}, ${Math.round(m(ca.g, cb.g))}, ${Math.round(m(ca.b, cb.b))}, ${m(ca.a, cb.a).toFixed(3)})`
}

/** Comma-syntax rgb() string that three.js Color.setStyle accepts (alpha dropped). */
export function toThreeStyle(color: string): string {
  const c = parseColor(color)
  if (!c) return 'rgb(128, 128, 128)'
  return `rgb(${Math.round(c.r)}, ${Math.round(c.g)}, ${Math.round(c.b)})`
}

/** Alpha component of a token colour (for three.js material opacity). */
export function alphaOf(color: string): number {
  return parseColor(color)?.a ?? 1
}
