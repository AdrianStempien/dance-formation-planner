import type { Vec2 } from './types'

export const dist = (a: Vec2, b: Vec2) => Math.hypot(a.x - b.x, a.y - b.y)

export const add = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x + b.x, y: a.y + b.y })
export const sub = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x - b.x, y: a.y - b.y })
export const mul = (a: Vec2, s: number): Vec2 => ({ x: a.x * s, y: a.y * s })
export const len = (a: Vec2) => Math.hypot(a.x, a.y)
export const norm = (a: Vec2): Vec2 => {
  const l = len(a)
  return l < 1e-9 ? { x: 0, y: 0 } : { x: a.x / l, y: a.y / l }
}

/** Proper segment-segment intersection (excluding shared endpoints tolerance). */
export function segmentsIntersect(a1: Vec2, a2: Vec2, b1: Vec2, b2: Vec2): boolean {
  const d1 = cross(sub(b2, b1), sub(a1, b1))
  const d2 = cross(sub(b2, b1), sub(a2, b1))
  const d3 = cross(sub(a2, a1), sub(b1, a1))
  const d4 = cross(sub(a2, a1), sub(b2, a1))
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))
}

function cross(a: Vec2, b: Vec2) {
  return a.x * b.y - a.y * b.x
}

export function pointToSegmentDist(p: Vec2, a: Vec2, b: Vec2): number {
  const ab = sub(b, a)
  const t = Math.max(0, Math.min(1, (p.x - a.x) * ab.x + (p.y - a.y) * ab.y) / (ab.x * ab.x + ab.y * ab.y || 1))
  return dist(p, { x: a.x + ab.x * t, y: a.y + ab.y * t })
}

export function pathLength(points: Vec2[]): number {
  let L = 0
  for (let i = 1; i < points.length; i++) L += dist(points[i - 1], points[i])
  return L
}

export function pointAlongPath(points: Vec2[], t: number): Vec2 {
  if (points.length === 0) return { x: 0, y: 0 }
  if (points.length === 1) return points[0]
  const total = pathLength(points)
  if (total < 1e-9) return points[points.length - 1]
  let target = t * total
  for (let i = 1; i < points.length; i++) {
    const seg = dist(points[i - 1], points[i])
    if (target <= seg) {
      const k = seg < 1e-9 ? 0 : target / seg
      return {
        x: points[i - 1].x + (points[i].x - points[i - 1].x) * k,
        y: points[i - 1].y + (points[i].y - points[i - 1].y) * k,
      }
    }
    target -= seg
  }
  return points[points.length - 1]
}
