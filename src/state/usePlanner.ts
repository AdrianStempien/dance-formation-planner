import { useCallback, useEffect, useRef, useState } from 'react'
import type {
  Dancer,
  Formation,
  ManualRoute,
  OptimizationResult,
  Vec2,
  Weights,
  AssignMode,
} from '../lib/types'

export interface PlannerState {
  dancers: Dancer[]
  start: Formation
  target: Formation
  editing: 'start' | 'target'
  selectedId: string | null
  routes: Record<string, ManualRoute>
  pinned: Record<string, Vec2>
  weights: Weights
  allowTurns: boolean
  assignMode: AssignMode
  result: OptimizationResult | null
  /** Runner-up solutions from the last calculation, sorted by score. */
  altResults: OptimizationResult[]
  /** 0 = best result, 1..n = index into altResults. */
  routeIdx: number
  hiddenPaths: Record<string, boolean>
  highlightId: string | null
}

export const PALETTE = [
  '#6366f1', '#ec4899', '#f59e0b', '#10b981', '#06b6d4',
  '#8b5cf6', '#ef4444', '#14b8a6', '#f97316', '#84cc16',
  '#a855f7', '#0ea5e9', '#e11d48', '#65a30d', '#d946ef', '#0891b2',
]

const FLOOR = { w: 24, h: 16 } // meters, centered at origin
export const FLOOR_W = FLOOR.w
export const FLOOR_H = FLOOR.h

let idCounter = 0
export const uid = (prefix = 'id') => `${prefix}-${Date.now().toString(36)}-${(idCounter++).toString(36)}`

export function defaultWeights(): Weights {
  return { distance: 1, intersection: 1, collision: 1, smoothness: 0.6, complexity: 0.5 }
}

function emptyFormation(id: string, name: string): Formation {
  return { id, name, positions: {} }
}

/** Grid slot position for dancer index, centered on floor. */
export function gridSlot(i: number, count: number): Vec2 {
  const cols = Math.ceil(Math.sqrt(count))
  const rows = Math.ceil(count / cols)
  const col = i % cols
  const row = Math.floor(i / cols)
  const sx = cols > 1 ? (col / (cols - 1) - 0.5) * (FLOOR.w * 0.7) : 0
  const sy = rows > 1 ? (row / (rows - 1) - 0.5) * (FLOOR.h * 0.7) : 0
  return { x: sx, y: sy }
}

export function initialState(): PlannerState {
  const dancers: Dancer[] = []
  for (let i = 0; i < 8; i++) {
    dancers.push({
      id: uid('d'),
      name: `Dancer ${i + 1}`,
      color: PALETTE[i % PALETTE.length],
    })
  }
  const start = emptyFormation('start', 'Start Formation')
  const target = emptyFormation('target', 'Target Formation')
  dancers.forEach((d, i) => {
    const p = gridSlot(i, dancers.length)
    start.positions[d.id] = { ...p }
    target.positions[d.id] = { x: -p.x, y: -p.y }
  })
  return {
    dancers,
    start,
    target,
    editing: 'start',
    selectedId: null,
    routes: {},
    pinned: {},
    weights: defaultWeights(),
    allowTurns: true,
    assignMode: 'exact',
    result: null,
    altResults: [],
    routeIdx: 0,
    hiddenPaths: {},
    highlightId: null,
  }
}

interface Snapshot {
  dancers: Dancer[]
  start: Formation
  target: Formation
  editing: 'start' | 'target'
  selectedId: string | null
  routes: Record<string, ManualRoute>
  pinned: Record<string, Vec2>
}

const snap = (s: PlannerState): Snapshot => ({
  dancers: s.dancers,
  start: s.start,
  target: s.target,
  editing: s.editing,
  selectedId: s.selectedId,
  routes: s.routes,
  pinned: s.pinned,
})

const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v))

const STORAGE_KEY = 'dance-formation-planner:v1'

export function loadState(): PlannerState | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const s = JSON.parse(raw) as PlannerState
    if (!s.dancers || !s.start || !s.target) return null
    return { ...initialState(), ...s }
  } catch {
    return null
  }
}

export function usePlanner() {
  const [state, setState] = useState<PlannerState>(() => loadState() ?? initialState())
  const stateRef = useRef(state)
  stateRef.current = state
  const histRef = useRef<{ past: Snapshot[]; future: Snapshot[] }>({ past: [], future: [] })
  const [, forceRender] = useState(0)
  const dragSnapshot = useRef<Snapshot | null>(null)
  const past = histRef.current.past
  const future = histRef.current.future

  // autosave
  useEffect(() => {
    const t = setTimeout(() => {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
      } catch {
        /* ignore */
      }
    }, 400)
    return () => clearTimeout(t)
  }, [state])

  const pushHistory = useCallback((snapshot: Snapshot) => {
    const h = histRef.current
    h.past.push(snapshot)
    if (h.past.length > 50) h.past.shift()
    h.future = []
  }, [])

  const commit = useCallback(
    (fn: (s: PlannerState) => PlannerState) => {
      pushHistory(snap(stateRef.current))
      const next = fn(stateRef.current)
      stateRef.current = next
      setState(next)
    },
    [pushHistory]
  )

  /** Mutate without pushing history (live drag updates). */
  const mutate = useCallback((fn: (s: PlannerState) => PlannerState) => {
    const next = fn(stateRef.current)
    stateRef.current = next
    setState(next)
  }, [])

  const beginGesture = useCallback(() => {
    dragSnapshot.current = snap(stateRef.current)
  }, [])

  const endGesture = useCallback(() => {
    const snap0 = dragSnapshot.current
    dragSnapshot.current = null
    if (!snap0) return
    pushHistory(snap0)
    forceRender((n) => n + 1)
  }, [pushHistory])

  const undo = useCallback(() => {
    const h = histRef.current
    const last = h.past.pop()
    if (!last) return
    h.future.unshift(snap(stateRef.current))
    const next = { ...stateRef.current, ...clone(last) }
    stateRef.current = next
    setState(next)
    forceRender((n) => n + 1)
  }, [])

  const redo = useCallback(() => {
    const h = histRef.current
    const first = h.future.shift()
    if (!first) return
    h.past.push(snap(stateRef.current))
    const next = { ...stateRef.current, ...clone(first) }
    stateRef.current = next
    setState(next)
    forceRender((n) => n + 1)
  }, [])

  // ---- actions ----
  const addDancer = useCallback(() => {
    commit((s) => {
      const i = s.dancers.length
      const d: Dancer = {
        id: uid('d'),
        name: `Dancer ${i + 1}`,
        color: PALETTE[i % PALETTE.length],
      }
      const p = gridSlot(i, i + 1)
      const jitter = { x: (Math.random() - 0.5) * 0.6, y: (Math.random() - 0.5) * 0.6 }
      const pos = { x: p.x + jitter.x, y: p.y + jitter.y }
      const start = clone(s.start)
      const target = clone(s.target)
      start.positions[d.id] = pos
      target.positions[d.id] = { x: -pos.x + jitter.x, y: -pos.y + jitter.y }
      return { ...s, dancers: [...s.dancers, d], start, target, selectedId: d.id, result: null }
    })
  }, [commit])

  const removeDancer = useCallback(
    (id: string) => {
      commit((s) => {
        const start = clone(s.start)
        const target = clone(s.target)
        delete start.positions[id]
        delete target.positions[id]
        const routes = { ...s.routes }
        delete routes[id]
        const pinned = { ...s.pinned }
        delete pinned[id]
        const hiddenPaths = { ...s.hiddenPaths }
        delete hiddenPaths[id]
        return {
          ...s,
          dancers: s.dancers.filter((d) => d.id !== id),
          start,
          target,
          routes,
          pinned,
          hiddenPaths,
          selectedId: s.selectedId === id ? null : s.selectedId,
          result: null,
        }
      })
    },
    [commit]
  )

  const renameDancer = useCallback(
    (id: string, name: string) => {
      commit((s) => ({
        ...s,
        dancers: s.dancers.map((d) => (d.id === id ? { ...d, name } : d)),
      }))
    },
    [commit]
  )

  const setFormationName = useCallback(
    (which: 'start' | 'target', name: string) => {
      commit((s) => ({ ...s, [which]: { ...s[which], name } }))
    },
    [commit]
  )

  const setEditing = useCallback((editing: 'start' | 'target') => {
    setState((s) => ({ ...s, editing, selectedId: null }))
  }, [])

  const setSelected = useCallback((selectedId: string | null) => {
    setState((s) => ({ ...s, selectedId }))
  }, [])

  const moveDancer = useCallback(
    (id: string, pos: Vec2) => {
      mutate((s) => {
        const f = clone(s[s.editing])
        f.positions[id] = pos
        return { ...s, [s.editing]: f, result: null }
      })
    },
    [mutate]
  )

  const copyFormation = useCallback(
    (from: 'start' | 'target', to: 'start' | 'target') => {
      commit((s) => {
        const src = s[from]
        const dst = clone(s[to])
        dst.positions = clone(src.positions)
        return { ...s, [to]: dst, result: null }
      })
    },
    [commit]
  )

  const resetFormation = useCallback(
    (which: 'start' | 'target') => {
      commit((s) => {
        const f = clone(s[which])
        s.dancers.forEach((d, i) => {
          f.positions[d.id] = gridSlot(i, s.dancers.length)
        })
        return { ...s, [which]: f, result: null }
      })
    },
    [commit]
  )

  // ---- manual routes ----
  const addWaypoint = useCallback(
    (dancerId: string, pos: Vec2) => {
      commit((s) => {
        const r = s.routes[dancerId]
        const routes = { ...s.routes }
        if (r) {
          routes[dancerId] = { ...r, waypoints: [...r.waypoints, pos] }
        } else {
          routes[dancerId] = { dancerId, waypoints: [pos], locked: false }
        }
        return { ...s, routes, result: null }
      })
    },
    [commit]
  )

  const undoWaypoint = useCallback(
    (dancerId: string) => {
      commit((s) => {
        const r = s.routes[dancerId]
        if (!r) return s
        const routes = { ...s.routes }
        const wps = r.waypoints.slice(0, -1)
        if (wps.length === 0) delete routes[dancerId]
        else routes[dancerId] = { ...r, waypoints: wps }
        return { ...s, routes, result: null }
      })
    },
    [commit]
  )

  const clearRoute = useCallback(
    (dancerId: string) => {
      commit((s) => {
        const routes = { ...s.routes }
        delete routes[dancerId]
        return { ...s, routes, result: null }
      })
    },
    [commit]
  )

  const toggleLock = useCallback(
    (dancerId: string) => {
      commit((s) => {
        const r = s.routes[dancerId]
        if (!r) return s
        return { ...s, routes: { ...s.routes, [dancerId]: { ...r, locked: !r.locked } } }
      })
    },
    [commit]
  )

  const setPinned = useCallback(
    (dancerId: string | null, pos?: Vec2) => {
      commit((s) => {
        const pinned = { ...s.pinned }
        if (dancerId === null) return s
        if (pos) pinned[dancerId] = pos
        else delete pinned[dancerId]
        return { ...s, pinned, result: null }
      })
    },
    [commit]
  )

  const togglePin = useCallback(
    (dancerId: string) => {
      commit((s) => {
        const pinned = { ...s.pinned }
        if (pinned[dancerId]) delete pinned[dancerId]
        else pinned[dancerId] = s.target.positions[dancerId] ?? s.start.positions[dancerId] ?? { x: 0, y: 0 }
        return { ...s, pinned, result: null }
      })
    },
    [commit]
  )

  // ---- params (not part of undo history) ----
  const setWeights = useCallback((weights: Weights) => {
    setState((s) => ({ ...s, weights, result: null }))
  }, [])

  const setAllowTurns = useCallback((allowTurns: boolean) => {
    setState((s) => ({ ...s, allowTurns, result: null }))
  }, [])

  const setAssignMode = useCallback((assignMode: AssignMode) => {
    setState((s) => ({ ...s, assignMode, result: null }))
  }, [])

  const setResult = useCallback((result: OptimizationResult | null) => {
    setState((s) => ({ ...s, result }))
  }, [])

  const setCalcOutcome = useCallback(
    (result: OptimizationResult | null, alts: OptimizationResult[]) => {
      const next = { ...stateRef.current, result, altResults: alts, routeIdx: 0 }
      stateRef.current = next
      setState(next)
    },
    []
  )

  const setRouteIdx = useCallback((routeIdx: number) => {
    setState((s) => ({ ...s, routeIdx }))
  }, [])

  const togglePathVisibility = useCallback((id: string) => {
    setState((s) => ({ ...s, hiddenPaths: { ...s.hiddenPaths, [id]: !s.hiddenPaths[id] } }))
  }, [])

  const setHighlight = useCallback((highlightId: string | null) => {
    setState((s) => ({ ...s, highlightId }))
  }, [])

  const resetAll = useCallback(() => {
    commit(() => {
      const fresh = initialState()
      return { ...fresh, weights: state.weights, allowTurns: state.allowTurns, assignMode: state.assignMode }
    })
  }, [commit, state.weights, state.allowTurns, state.assignMode])

  const exportJSON = useCallback(() => {
    return JSON.stringify(state, null, 2)
  }, [state])

  const importJSON = useCallback(
    (json: string) => {
      try {
        const s = JSON.parse(json) as PlannerState
        if (!s.dancers || !s.start || !s.target) throw new Error('bad')
        commit(() => ({ ...initialState(), ...s }))
      } catch {
        alert('Invalid project file.')
      }
    },
    [commit]
  )

  const activeFormation = state[state.editing]

  return {
    state,
    activeFormation,
    past,
    future,
    actions: {
      addDancer,
      removeDancer,
      renameDancer,
      setFormationName,
      setEditing,
      setSelected,
      moveDancer,
      beginGesture,
      endGesture,
      copyFormation,
      resetFormation,
      addWaypoint,
      undoWaypoint,
      clearRoute,
      toggleLock,
      togglePin,
      setPinned,
      setWeights,
      setAllowTurns,
      setAssignMode,
      setResult,
      setCalcOutcome,
      setRouteIdx,
      togglePathVisibility,
      setHighlight,
      resetAll,
      exportJSON,
      importJSON,
      undo,
      redo,
    },
  }
}
