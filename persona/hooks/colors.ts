/** Small colour helpers: parsing, WCAG contrast, and nudging a colour until it reads. */

type RGB = [number, number, number]

const NAMED: Record<string, string> = {
  black: '#000000', white: '#ffffff', red: '#ef4444', orange: '#f97316', amber: '#f59e0b', yellow: '#eab308',
  lime: '#84cc16', green: '#22c55e', teal: '#14b8a6', cyan: '#06b6d4', sky: '#0ea5e9', blue: '#3b82f6',
  indigo: '#6366f1', violet: '#8b5cf6', purple: '#a855f7', pink: '#ec4899', rose: '#f43f5e', gray: '#6b7280', grey: '#6b7280',
}

/** `#abc`, `#aabbcc`, `aabbcc` or a basic colour name → `#aabbcc`, else undefined. */
export function parseHex(input: string): string | undefined {
  const s = input.trim().toLowerCase()
  if (NAMED[s]) return NAMED[s]
  const m = s.match(/^#?([0-9a-f]{3}|[0-9a-f]{6})$/)
  if (!m) return undefined
  const h = m[1]!
  return '#' + (h.length === 3 ? h.split('').map(c => c + c).join('') : h)
}

function toRgb(hex: string): RGB {
  const n = parseInt(hex.slice(1), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

function toHex([r, g, b]: RGB): string {
  return '#' + [r, g, b].map(v => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, '0')).join('')
}

export function luminance(hex: string): number {
  const [r, g, b] = toRgb(hex).map(v => {
    const c = v / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  }) as RGB
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number]
  return (hi + 0.05) / (lo + 0.05)
}

export const isDark = (hex: string): boolean => luminance(hex) < 0.18

/** Blends `a` toward `b` by `t` (0 = a, 1 = b). */
export function mix(a: string, b: string, t: number): string {
  const x = toRgb(a)
  const y = toRgb(b)
  return toHex([x[0] + (y[0] - x[0]) * t, x[1] + (y[1] - x[1]) * t, x[2] + (y[2] - x[2]) * t])
}

/** Moves `color` toward white (on a dark bg) or black (on a light bg) until it reaches `min` contrast. */
export function ensureContrast(color: string, bg: string, min: number): string {
  if (contrast(color, bg) >= min) return color
  const target = isDark(bg) ? '#ffffff' : '#000000'
  for (let t = 0.05; t <= 1; t += 0.05) {
    const c = mix(color, target, t)
    if (contrast(c, bg) >= min) return c
  }
  return target
}

/** Rotates a colour's hue by `deg`, keeping saturation and lightness. */
export function rotateHue(hex: string, deg: number): string {
  const [r, g, b] = toRgb(hex).map(v => v / 255) as RGB
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const l = (max + min) / 2
  const d = max - min
  let h = 0
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1))
  if (d !== 0) {
    if (max === r) h = ((g - b) / d) % 6
    else if (max === g) h = (b - r) / d + 2
    else h = (r - g) / d + 4
  }
  h = (h * 60 + deg + 360) % 360
  const c = (1 - Math.abs(2 * l - 1)) * s
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1))
  const m = l - c / 2
  const [r1, g1, b1] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x]
  return toHex([(r1 + m) * 255, (g1 + m) * 255, (b1 + m) * 255])
}

/** Hue in degrees (0-360) and saturation (0-1) of a colour. */
export function hueSat(hex: string): { h: number; s: number } {
  const [r, g, b] = toRgb(hex).map(v => v / 255) as RGB
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const d = max - min
  const l = (max + min) / 2
  if (d === 0) return { h: 0, s: 0 }
  let h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4
  h = (h * 60 + 360) % 360
  return { h, s: d / (1 - Math.abs(2 * l - 1)) }
}
