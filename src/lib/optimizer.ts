import type { Vec2, Weights, ManualRoute, OptimizationResult, MovePath, AssignMode } from './types'
import { dist } from './geom'
import { hungarian } from './hungarian'
import {
  COARSE_SAMPLES,
  FINE_SAMPLES,
  coarsePathFor,
  smoothRoutePoints,
  singlePathCost,
  toMovePath,
  countConflicts,
  pathMetrics,
} from './path'

export interface OptimizeInput {
  dancerIds: string[]
  starts: Record<string, Vec2>
  /** Candidate destination positions (target formation slots). */
  targets: Vec2[]
  /** In exact mode: dancerId -> fixed destination. */
  exactDestinations: Record<string, Vec2>
  /** Manually pinned destinations (override assignment). */
  pinned?: Record<string, Vec2>
  assignMode: AssignMode
  manualRoutes: Record<string, ManualRoute>
  weights: Weights
  allowTurns: boolean
  timeBudgetMs?: number
  /** RNG seed for reproducibility-ish behavior. */
  seed?: number
}

interface Tunable {
  id: string
  start: Vec2
  dest: Vec2
  ctrl: Vec2 | null // null => straight line
}

function mulberry32(seed: number) {
  let a = seed >>> 0
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Decide each dancer's destination based on assignment mode. */
export function assignDestinations(input: OptimizeInput): Record<string, Vec2> {
  const { dancerIds, starts, targets, exactDestinations, assignMode } = input
  const pinned = input.pinned ?? {}
  const out: Record<string, Vec2> = {}

  if (assignMode === 'exact') {
    for (const id of dancerIds) {
      out[id] = pinned[id] ?? exactDestinations[id] ?? targets[0] ?? starts[id] ?? { x: 0, y: 0 }
    }
    return out
  }

  // Pinned dancers keep their destination; the rest are assigned by Hungarian
  // over the remaining target slots.
  const pinnedIds = dancerIds.filter((id) => pinned[id])
  const freeIds = dancerIds.filter((id) => !pinned[id])
  for (const id of pinnedIds) out[id] = pinned[id]

  // nearest mode: Hungarian over free dancer -> remaining target positions
  const rows = freeIds
  const cols = targetsForRows(targets, pinned)
  if (cols.length === 0) {
    for (const id of rows) out[id] = starts[id] ?? { x: 0, y: 0 }
    return out
  }
  const cost: number[][] = rows.map((id) =>
    cols.map((t) => {
      const s = starts[id] ?? { x: 0, y: 0 }
      let c = dist(s, t)
      const exact = exactDestinations[id]
      if (exact) {
        const dExact = dist(t, exact)
        c += dExact * dExact * 0.02
      }
      return c
    })
  )
  const assign = hungarian(cost)
  rows.forEach((id, i) => {
    const j = assign[i]
    out[id] = j >= 0 ? cols[j] : cols[0]
  })
  return out
}

function targetsForRows(targets: Vec2[], pinned: Record<string, Vec2>): Vec2[] {
  const pinnedVals = Object.values(pinned)
  const free = targets.filter(
    (t) => !pinnedVals.some((p) => Math.hypot(p.x - t.x, p.y - t.y) < 1e-6)
  )
  return free.length > 0 ? free : targets
}

export function optimizePaths(input: OptimizeInput): OptimizationResult {
  const budget = input.timeBudgetMs ?? 160
  const deadline = performance.now() + budget
  const rand = mulberry32(input.seed ?? 12345)
  const { dancerIds, starts, manualRoutes, weights, allowTurns } = input

  const destinations = assignDestinations(input)
  const center = { x: 0, y: 0 }
  let sceneScale = 1
  for (const id of dancerIds) {
    const s = starts[id] ?? center
    const d = destinations[id] ?? center
    sceneScale = Math.max(sceneScale, dist(s, d))
  }
  // include spread of all points
  const allPts = [...Object.values(starts), ...Object.values(destinations)]
  if (allPts.length > 1) {
    let minx = Infinity, maxx = -Infinity, miny = Infinity, maxy = -Infinity
    for (const p of allPts) {
      minx = Math.min(minx, p.x); maxx = Math.max(maxx, p.x)
      miny = Math.min(miny, p.y); maxy = Math.max(maxy, p.y)
    }
    sceneScale = Math.max(sceneScale, Math.hypot(maxx - minx, maxy - miny))
  }
  sceneScale = Math.max(sceneScale, 100)

  // Split dancers into fixed (manual) and tunable
  const fixedPaths = new Map<string, Vec2[]>()
  const tunable: Tunable[] = []

  for (const id of dancerIds) {
    const start = starts[id] ?? center
    const dest = destinations[id] ?? center
    const route = manualRoutes[id]
    if (route) {
      const pts = smoothRoutePoints(start, route.waypoints, dest, COARSE_SAMPLES)
      fixedPaths.set(id, pts)
    } else {
      tunable.push({ id, start, dest, ctrl: null })
    }
  }

  // coarse point arrays for all dancers, mutated during optimization
  const coarse = new Map<string, Vec2[]>()
  for (const id of dancerIds) {
    const start = starts[id] ?? center
    const dest = destinations[id] ?? center
    if (fixedPaths.has(id)) {
      coarse.set(id, fixedPaths.get(id)!)
    } else {
      coarse.set(id, coarsePathFor(start, dest, null, COARSE_SAMPLES))
    }
  }

  const othersOf = (id: string): Vec2[][] => {
    const arr: Vec2[][] = []
    for (const [oid, pts] of coarse) if (oid !== id) arr.push(pts)
    return arr
  }

  const evalDancer = (t: Tunable, ctrl: Vec2 | null): number => {
    const pts = coarsePathFor(t.start, t.dest, ctrl, COARSE_SAMPLES)
    return singlePathCost(pts, t.start, t.dest, othersOf(t.id), weights, allowTurns)
  }

  // Initial control points: gentle perpendicular bow for turn-allowed mode
  for (const t of tunable) {
    if (allowTurns) {
      const mx = (t.start.x + t.dest.x) / 2
      const my = (t.start.y + t.dest.y) / 2
      const dx = t.dest.x - t.start.x
      const dy = t.dest.y - t.start.y
      const L = Math.hypot(dx, dy) || 1
      const side = rand() > 0.5 ? 1 : -1
      const bow = L * 0.08 * side
      t.ctrl = { x: mx + (-dy / L) * bow, y: my + (dx / L) * bow }
      coarse.set(t.id, coarsePathFor(t.start, t.dest, t.ctrl, COARSE_SAMPLES))
    }
  }

  // Pattern-search hill climbing over control points
  const steps = [0.22, 0.1, 0.045, 0.02].map((s) => s * sceneScale)
  const DIRS = 8
  let improved = true
  let rounds = 0
  while (improved && performance.now() < deadline && rounds < 60) {
    improved = false
    rounds++
    // shuffle order each round
    const order = [...tunable]
    for (let i = order.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1))
      ;[order[i], order[j]] = [order[j], order[i]]
    }
    for (const t of order) {
      if (performance.now() > deadline) break
      let currentCost = evalDancer(t, t.ctrl)
      for (const step of steps) {
        let stepImproved = true
        let guard = 0
        while (stepImproved && guard++ < 6 && performance.now() < deadline) {
          stepImproved = false
          for (let d = 0; d < DIRS; d++) {
            const ang = (d / DIRS) * Math.PI * 2
            const base = t.ctrl ?? { x: (t.start.x + t.dest.x) / 2, y: (t.start.y + t.dest.y) / 2 }
            const cand: Vec2 = { x: base.x + Math.cos(ang) * step, y: base.y + Math.sin(ang) * step }
            const c = evalDancer(t, cand)
            if (c < currentCost - 1e-6) {
              currentCost = c
              t.ctrl = cand
              coarse.set(t.id, coarsePathFor(t.start, t.dest, cand, COARSE_SAMPLES))
              stepImproved = true
              improved = true
              break
            }
          }
        }
      }
      // try collapsing to straight line (preferred on ties)
      const straightCost = evalDancer(t, null)
      if (straightCost <= currentCost - 1e-6 || straightCost === currentCost) {
        t.ctrl = null
        coarse.set(t.id, coarsePathFor(t.start, t.dest, null, COARSE_SAMPLES))
      }
    }
  }

  // Build fine-resolution result paths
  const paths: MovePath[] = []
  for (const id of dancerIds) {
    const start = starts[id] ?? center
    const dest = destinations[id] ?? center
    const route = manualRoutes[id]
    let pts: Vec2[]
    if (route) {
      pts = smoothRoutePoints(start, route.waypoints, dest, FINE_SAMPLES)
    } else {
      const t = tunable.find((x) => x.id === id)!
      pts = coarsePathFor(start, dest, t.ctrl, FINE_SAMPLES)
    }
    paths.push(toMovePath(id, pts, !!route))
  }

  const conflicts = countConflicts(paths)
  const totalDistance = paths.reduce((s, p) => s + p.length, 0)
  const score =
    totalDistance * Math.max(weights.distance, 0.25) +
    conflicts.intersections * 60 * weights.intersection +
    conflicts.collisions * 8 * weights.collision

  return {
    paths,
    destinations,
    intersectionCount: conflicts.intersections,
    collisionCount: conflicts.collisions,
    totalDistance,
    score,
    timedOut: performance.now() >= deadline,
  }
}

export function pathMetricsFor(path: MovePath, start: Vec2, dest: Vec2) {
  return pathMetrics(path.points, start, dest)
}
