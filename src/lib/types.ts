export interface Vec2 {
  x: number
  y: number
}

export interface Dancer {
  id: string
  name: string
  color: string
}

/** Positions keyed by dancer id. */
export interface Formation {
  id: string
  name: string
  positions: Record<string, Vec2>
}

export type AssignMode = 'exact' | 'nearest'

export interface Weights {
  distance: number
  intersection: number
  collision: number
  smoothness: number
  complexity: number
}

/** A manually defined route: waypoints between start and destination. */
export interface ManualRoute {
  dancerId: string
  waypoints: Vec2[]
  locked: boolean
}

/** A computed movement path stored as a dense polyline in world coords. */
export interface MovePath {
  dancerId: string
  points: Vec2[]
  /** Total geometric length. */
  length: number
  manual: boolean
}

export interface OptimizationResult {
  paths: MovePath[]
  /** dancerId -> destination position actually used */
  destinations: Record<string, Vec2>
  /** Number of pairwise path intersections found. */
  intersectionCount: number
  /** Number of close-encounter (collision) events found. */
  collisionCount: number
  totalDistance: number
  /** Weighted cost used to rank candidate solutions. */
  score: number
  /** True if the run was cut short by the time budget. */
  timedOut: boolean
}

export interface AppState {
  dancers: Dancer[]
  formations: Formation[]
  activeFormationId: string // 'start' | 'target' handled via which slot; formations array holds both
  startFormationId: string
  targetFormationId: string
  /** Which formation the canvas is editing: 'start' | 'target' */
  editing: 'start' | 'target'
  selectedDancerId: string | null
  manualRoutes: Record<string, ManualRoute>
  weights: Weights
  allowTurns: boolean
  assignMode: AssignMode
  result: OptimizationResult | null
  showPaths: Record<string, boolean> // dancerId -> visible
  animationT: number // 0..1
  animating: boolean
  animSpeed: number
}
