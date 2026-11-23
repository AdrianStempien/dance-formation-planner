import React from 'react'
import type { PlannerState } from '../state/usePlanner'
import type { CanvasMode } from './CanvasStage'
import type { Weights } from '../lib/types'

interface LeftProps {
  state: PlannerState
  onAdd: () => void
  onRemove: (id: string) => void
  onRename: (id: string, name: string) => void
  onSelect: (id: string | null) => void
  onTogglePath: (id: string) => void
  onFormationName: (which: 'start' | 'target', name: string) => void
  onCopy: (from: 'start' | 'target', to: 'start' | 'target') => void
  onReset: (which: 'start' | 'target') => void
}

export function LeftPanel(p: LeftProps) {
  const { state } = p
  return (
    <div className="panel">
      <section className="panel-section">
        <h3>Formations</h3>
        {(['start', 'target'] as const).map((which) => {
          const f = state[which]
          const other = which === 'start' ? 'target' : 'start'
          return (
            <div className="formation-row" key={which}>
              <div className="formation-head">
                <span className={`dot dot-${which}`} />
                <input
                  className="formation-name"
                  value={f.name}
                  onChange={(e) => p.onFormationName(which, e.target.value)}
                />
              </div>
              <div className="formation-actions">
                <button title={`Copy ${state[other].name} here`} onClick={() => p.onCopy(other, which)}>
                  ⤓ copy
                </button>
                <button title="Reset to grid" onClick={() => p.onReset(which)}>
                  ⟲ reset
                </button>
              </div>
            </div>
          )
        })}
      </section>

      <section className="panel-section grow">
        <div className="section-head">
          <h3>Dancers</h3>
          <button className="btn-primary btn-small" onClick={p.onAdd}>
            + Add
          </button>
        </div>
        <div className="dancer-list">
          {state.dancers.map((d, i) => {
            const hasRoute = !!state.routes[d.id]
            const hasResult = !!state.result?.paths.find((pp) => pp.dancerId === d.id)
            const hidden = !!state.hiddenPaths[d.id]
            return (
              <div
                key={d.id}
                className={`dancer-row ${state.selectedId === d.id ? 'selected' : ''}`}
                onClick={() => p.onSelect(state.selectedId === d.id ? null : d.id)}
              >
                <span className="dancer-swatch" style={{ background: d.color }} />
                <span className="dancer-num">{i + 1}</span>
                <input
                  className="dancer-name"
                  value={d.name}
                  onClick={(e) => e.stopPropagation()}
                  onChange={(e) => p.onRename(d.id, e.target.value)}
                />
                <span className="dancer-flags">
                  {hasRoute && <span className="flag" title="Manual route">route</span>}
                  {state.routes[d.id]?.locked && <span className="flag flag-lock" title="Locked">lock</span>}
                  {state.pinned[d.id] && <span className="flag flag-pin" title="Pinned destination">pin</span>}
                </span>
                {hasResult && (
                  <button
                    className="icon-btn"
                    title={hidden ? 'Show path' : 'Hide path'}
                    onClick={(e) => {
                      e.stopPropagation()
                      p.onTogglePath(d.id)
                    }}
                  >
                    {hidden ? '○' : '●'}
                  </button>
                )}
                <button
                  className="icon-btn danger"
                  title="Remove dancer"
                  onClick={(e) => {
                    e.stopPropagation()
                    p.onRemove(d.id)
                  }}
                >
                  ×
                </button>
              </div>
            )
          })}
          {state.dancers.length === 0 && <p className="muted">No dancers yet. Add one to begin.</p>}
        </div>
      </section>
    </div>
  )
}

interface RightProps {
  state: PlannerState
  mode: CanvasMode
  setMode: (m: CanvasMode) => void
  onWeights: (w: Weights) => void
  onAllowTurns: (v: boolean) => void
  onAssignMode: (m: 'exact' | 'nearest') => void
  onRouteAction: {
    addWaypointUndo: () => void
    clearRoute: () => void
    toggleLock: () => void
    togglePin: () => void
  }
}

const WEIGHT_LABELS: { key: keyof Weights; label: string; hint: string }[] = [
  { key: 'distance', label: 'Distance', hint: 'Shorter paths' },
  { key: 'intersection', label: 'Path crossings', hint: 'Avoid intersecting routes' },
  { key: 'collision', label: 'Collisions', hint: 'Keep dancers apart' },
  { key: 'smoothness', label: 'Smoothness', hint: 'Natural, fluid curves' },
  { key: 'complexity', label: 'Simplicity', hint: 'Fewer turns & detours' },
]

export function RightPanel(p: RightProps) {
  const { state, mode, setMode } = p
  const sel = state.selectedId ? state.dancers.find((d) => d.id === state.selectedId) : null
  const selRoute = sel ? state.routes[sel.id] : undefined
  const selPinned = sel ? !!state.pinned[sel.id] : false

  return (
    <div className="panel">
      {sel && (
        <section className="panel-section">
          <h3>
            Dancer {state.dancers.indexOf(sel) + 1} — {sel.name}
          </h3>
          <div className="route-controls">
            <button
              className={mode === 'route' ? 'btn-primary btn-small' : 'btn-ghost btn-small'}
              onClick={() => setMode(mode === 'route' ? 'select' : 'route')}
            >
              {mode === 'route' ? '✓ Click canvas to add points' : '+ Waypoints'}
            </button>
            <button className="btn-ghost btn-small" onClick={p.onRouteAction.addWaypointUndo} disabled={!selRoute}>
              ↩ Undo pt
            </button>
            <button className="btn-ghost btn-small" onClick={p.onRouteAction.toggleLock} disabled={!selRoute}>
              {selRoute?.locked ? 'Unlock' : 'Lock'}
            </button>
            <button className="btn-ghost btn-small" onClick={p.onRouteAction.togglePin}>
              {selPinned ? 'Unpin dest' : 'Pin dest'}
            </button>
            <button
              className={mode === 'pin' ? 'btn-primary btn-small' : 'btn-ghost btn-small'}
              onClick={() => setMode(mode === 'pin' ? 'select' : 'pin')}
              title="Click anywhere on the canvas to place the pinned destination"
            >
              {mode === 'pin' ? '✓ Click canvas to place' : 'Pick on canvas'}
            </button>
            <button
              className="btn-ghost btn-small danger-text"
              onClick={p.onRouteAction.clearRoute}
              disabled={!selRoute}
            >
              Clear route
            </button>
          </div>
          {selRoute && (
            <p className="muted small">
              {selRoute.waypoints.length} waypoint{selRoute.waypoints.length === 1 ? '' : 's'}
              {selRoute.locked ? ' · locked (fixed during optimization)' : ' · treated as constraint'}
            </p>
          )}
          {!selRoute && <p className="muted small">No manual route — path is auto-optimized.</p>}
        </section>
      )}

      <section className="panel-section">
        <h3>Optimization</h3>
        <div className="assign-row">
          <label className="radio">
            <input
              type="radio"
              checked={state.assignMode === 'exact'}
              onChange={() => p.onAssignMode('exact')}
            />
            Exact positions
          </label>
          <label className="radio">
            <input
              type="radio"
              checked={state.assignMode === 'nearest'}
              onChange={() => p.onAssignMode('nearest')}
            />
            Nearest available
          </label>
        </div>
        <label className="check-row">
          <input type="checkbox" checked={state.allowTurns} onChange={(e) => p.onAllowTurns(e.target.checked)} />
          Allow direction changes / turns
        </label>
        {WEIGHT_LABELS.map((w) => (
          <div className="slider-row" key={w.key} title={w.hint}>
            <div className="slider-head">
              <span>{w.label}</span>
              <span className="slider-val">{state.weights[w.key].toFixed(2)}</span>
            </div>
            <input
              type="range"
              min={0}
              max={2}
              step={0.05}
              value={state.weights[w.key]}
              onChange={(e) => p.onWeights({ ...state.weights, [w.key]: parseFloat(e.target.value) })}
            />
          </div>
        ))}
      </section>
    </div>
  )
}
