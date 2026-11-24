import type { Vec2, Weights, MovePath, ManualRoute } from './types'
import { dist, segmentsIntersect, pathLength } from './geom'

export const COARSE_SAMPLES = 36
export const FINE_SAMPLES = 120

/** Quadratic Bézier sampled into `n` points. */
export function sampleQuadBezier(p0: Vec2, c: Vec2, p1: Vec2, n: number): Vec2[] {
  const pts: Vec2[] = new Array(n)
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1)
    const u = 1 - t
    pts[i] = {
      x: u * u * p0.x + 2 * u * t * c.x + t * t * p1.x,
      y: u * u * p0.y + 2 * u * t * c.y + t * t * p1.y,
    }
  }
  return pts
}

/** Catmull-Rom spline through control points, sampled into `n` points. */
export function sampleCatmullRom(controls: Vec2[], n: number): Vec2[] {
  if (controls.length === 0) return []
  if (controls.length === 1) return Array.from({ length: n }, () => controls[0])
  if (controls.length === 2) return sampleQuadLine(controls[0], controls[1], n)

  // duplicate endpoints for boundary tangents
  const pts = [controls[0], ...controls, controls[controls.length - 1]]
  const out: Vec2[] = []
  const segs = controls.length - 1
  const per = Math.max(2, Math.floor(n / segs))
  for (let s = 0; s < segs; s++) {
    const p0 = pts[s]
    const p1 = pts[s + 1]
    const p2 = pts[s + 2]
    const p3 = pts[s + 3]
    for (let i = 0; i < per; i++) {
      const t = i / per
      const t2 = t * t
      const t3 = t2 * t
      out.push({
        x:
          0.5 *
          (2 * p1.x +
            (-p0.x + p2.x) * t +
            (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 +
            (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3),
        y:
          0.5 *
          (2 * p1.y +
            (-p0.y + p2.y) * t +
            (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 +
            (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3),
      })
    }
  }
  out.push(controls[controls.length - 1])
  return out
}

function sampleQuadLine(a: Vec2, b: Vec2, n: number): Vec2[] {
  const pts: Vec2[] = new Array(n)
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1)
    pts[i] = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }
  }
  return pts
}

/** Build a coarse path used during optimization. */
export function coarsePathFor(start: Vec2, dest: Vec2, ctrl: Vec2 | null, samples: number): Vec2[] {
  if (ctrl) return sampleQuadBezier(start, ctrl, dest, samples)
  return sampleQuadLine(start, dest, samples)
}

/** Smooth path through waypoints (manual route) at display resolution. */
export function smoothRoutePoints(start: Vec2, waypoints: Vec2[], dest: Vec2, n: number): Vec2[] {
  return sampleCatmullRom([start, ...waypoints, dest], n)
}

export interface PathMetrics {
  length: number
  /** Sum of absolute turn angles along the path (radians). */
  turnAngle: number
  /** Max deviation from the straight start->dest line, normalized by distance. */
  deviation: number
}

export function pathMetrics(points: Vec2[], start: Vec2, dest: Vec2): PathMetrics {
  let length = 0
  let turnAngle = 0
  let maxDev = 0
  const sd = dist(start, dest)
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]
    const b = points[i]
    length += dist(a, b)
    if (i >= 2) {
      const v1 = { x: a.x - points[i - 2].x, y: a.y - points[i - 2].y }
      const v2 = { x: b.x - a.x, y: b.y - a.y }
      const l1 = Math.hypot(v1.x, v1.y)
      const l2 = Math.hypot(v2.x, v2.y)
      if (l1 > 1e-9 && l2 > 1e-9) {
        const cos = Math.max(-1, Math.min(1, (v1.x * v2.x + v1.y * v2.y) / (l1 * l2)))
        turnAngle += Math.acos(cos)
      }
    }
    if (sd > 1e-9) {
      // distance from point to line start->dest
      const dx = dest.x - start.x
      const dy = dest.y - start.y
      const d = Math.abs(dy * (points[i].x - start.x) - dx * (points[i].y - start.y)) / sd
      if (d > maxDev) maxDev = d
    }
  }
  return { length, turnAngle, deviation: sd > 1e-9 ? maxDev / sd : 0 }
}

export interface ConflictInfo {
  intersections: number
  collisions: number
  /** Per-path-pair detail for reporting. */
  pairs: { a: string; b: string; kind: 'cross' | 'near' }[]
}

const COLLISION_RADIUS = 2.0 // meters; dancers closer than this at same progress = conflict

/**
 * Count path intersections (proper crossings) and collisions
 * (two dancers within COLLISION_RADIUS at similar path progress).
 */
export function countConflicts(paths: MovePath[]): ConflictInfo {
  let intersections = 0
  let collisions = 0
  const pairs: ConflictInfo['pairs'] = []
  const coarse = paths.map((p) => ({ id: p.dancerId, pts: p.points }))

  for (let i = 0; i < coarse.length; i++) {
    for (let j = i + 1; j < coarse.length; j++) {
      const A = coarse[i].pts
      const B = coarse[j].pts
      let crossed = false
      let near = false
      // bbox quick reject
      let aminx = Infinity, amaxx = -Infinity, aminy = Infinity, amaxy = -Infinity
      for (const p of A) {
        if (p.x < aminx) aminx = p.x
        if (p.x > amaxx) amaxx = p.x
        if (p.y < aminy) aminy = p.y
        if (p.y > amaxy) amaxy = p.y
      }
      let bminx = Infinity, bmaxx = -Infinity, bminy = Infinity, bmaxy = -Infinity
      for (const p of B) {
        if (p.x < bminx) bminx = p.x
        if (p.x > bmaxx) bmaxx = p.x
        if (p.y < bminy) bminy = p.y
        if (p.y > bmaxy) bmaxy = p.y
      }
      if (amaxx < bminx || bmaxx < aminx || amaxy < bminy || bmaxy < aminy) continue

      // stride sampling for collision check to keep it O(n)
      const step = Math.max(1, Math.floor(Math.min(A.length, B.length) / 60))
      for (let k = 1; k < A.length - 1 && !crossed; k++) {
        const a1 = A[k - 1]
        const a2 = A[k]
        // segment vs B: check nearby window of B via full scan w/ bbox reject per segment
        for (let l = 1; l < B.length; l++) {
          const b1 = B[l - 1]
          const b2 = B[l]
          if (
            Math.max(a1.x, a2.x) < Math.min(b1.x, b2.x) ||
            Math.max(b1.x, b2.x) < Math.min(a1.x, a2.x) ||
            Math.max(a1.y, a2.y) < Math.min(b1.y, b2.y) ||
            Math.max(b1.y, b2.y) < Math.min(a1.y, a2.y)
          )
            continue
          if (segmentsIntersect(a1, a2, b1, b2)) {
            crossed = true
            break
          }
        }
      }
      if (crossed) {
        intersections++
        pairs.push({ a: coarse[i].id, b: coarse[j].id, kind: 'cross' })
      }
      // collision: same progress index proximity
      const n = Math.min(A.length, B.length)
      for (let k = 0; k < n; k += step) {
        const d = dist(A[Math.floor((k / n) * (A.length - 1))], B[Math.floor((k / n) * (B.length - 1))])
        if (d < COLLISION_RADIUS) {
          near = true
          break
        }
      }
      if (near && !crossed) {
        collisions++
        pairs.push({ a: coarse[i].id, b: coarse[j].id, kind: 'near' })
      } else if (near && crossed) {
        collisions++
      }
    }
  }
  return { intersections, collisions, pairs }
}

/** Cost of a single candidate path given fixed others (for delta evaluation). */
export function singlePathCost(
  pts: Vec2[],
  start: Vec2,
  dest: Vec2,
  others: Vec2[][],
  w: Weights,
  allowTurns: boolean
): number {
  const m = pathMetrics(pts, start, dest)
  const straight = dist(start, dest)
  let cost = m.length * w.distance

  // smoothness: penalize deviation from straight line & turn angle
  cost += m.deviation * straight * w.smoothness * 0.5
  if (!allowTurns) {
    // heavily penalize any curvature when turns are disallowed
    cost += m.deviation * straight * 8
    cost += m.turnAngle * w.complexity * 4
  } else {
    cost += m.turnAngle * w.complexity * 2
  }

  // intersections & near-misses with other paths
  let inter = 0
  let near = 0
  const n = pts.length
  // bbox of candidate path, computed once
  let pminx = Infinity, pmaxx = -Infinity, pminy = Infinity, pmaxy = -Infinity
  for (const p of pts) {
    if (p.x < pminx) pminx = p.x
    if (p.x > pmaxx) pmaxx = p.x
    if (p.y < pminy) pminy = p.y
    if (p.y > pmaxy) pmaxy = p.y
  }
  for (const O of others) {
    if (!O || O.length === 0) continue
    // bbox reject
    let ominx = Infinity, omaxx = -Infinity, ominy = Infinity, omaxy = -Infinity
    for (const p of O) {
      if (p.x < ominx) ominx = p.x
      if (p.x > omaxx) omaxx = p.x
      if (p.y < ominy) ominy = p.y
      if (p.y > omaxy) omaxy = p.y
    }
    if (pmaxx < ominx || omaxx < pminx || pmaxy < ominy || omaxy < pminy) continue

    for (let i = 1; i < n; i++) {
      const a1 = pts[i - 1]
      const a2 = pts[i]
      for (let j = 1; j < O.length; j++) {
        const b1 = O[j - 1]
        const b2 = O[j]
        if (
          Math.max(a1.x, a2.x) < Math.min(b1.x, b2.x) ||
          Math.max(b1.x, b2.x) < Math.min(a1.x, a2.x) ||
          Math.max(a1.y, a2.y) < Math.min(b1.y, b2.y) ||
          Math.max(b1.y, b2.y) < Math.min(a1.y, a2.y)
        )
          continue
        if (segmentsIntersect(a1, a2, b1, b2)) {
          inter++
          break
        }
      }
    }
    // near collision along progress — count close samples (capped) so the
    // optimizer gets a gradient, not just a binary flag
    const step = Math.max(1, Math.floor(Math.min(n, O.length) / 40))
    for (let k = 0; k < n && near < 12; k += step) {
      const oi = Math.floor((k / n) * (O.length - 1))
      if (dist(pts[k], O[oi]) < COLLISION_RADIUS) {
        near++
      }
    }
  }
  cost += inter * 60 * w.intersection
  cost += near * 8 * w.collision
  return cost
}

export function toMovePath(dancerId: string, pts: Vec2[], manual: boolean): MovePath {
  return { dancerId, points: pts, length: pathLength(pts), manual }
}

export function routeToCoarse(start: Vec2, route: ManualRoute, dest: Vec2, n: number): Vec2[] {
  return smoothRoutePoints(start, route.waypoints, dest, n)
}
