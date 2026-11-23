import React, { useRef } from 'react'
import type { OptimizationResult } from '../lib/types'

interface Props {
  editing: 'start' | 'target'
  onEditing: (e: 'start' | 'target') => void
  canUndo: boolean
  canRedo: boolean
  onUndo: () => void
  onRedo: () => void
  onCalculate: () => void
  calculating: boolean
  playing: boolean
  onPlayPause: () => void
  animT: number
  onScrub: (t: number) => void
  speed: number
  onSpeed: (s: number) => void
  onExportPng: () => void
  onExportJson: () => void
  onImportJson: (file: File) => void
  onResetAll: () => void
  conflicts: { intersections: number; collisions: number } | null
  hasResult: boolean
  routeIdx: number
  routeCount: number
  routes: OptimizationResult[]
  onRouteIdx: (i: number) => void
}

export default function TopBar(p: Props) {
  const fileRef = useRef<HTMLInputElement>(null)
  return (
    <header className="topbar">
      <div className="brand">
        <span className="brand-mark" />
        <span className="brand-name">Formation Planner</span>
      </div>

      <div className="segmented">
        <button className={p.editing === 'start' ? 'seg active' : 'seg'} onClick={() => p.onEditing('start')}>
          Start
        </button>
        <button className={p.editing === 'target' ? 'seg active' : 'seg'} onClick={() => p.onEditing('target')}>
          Target
        </button>
      </div>

      <div className="toolbar-group">
        <button className="tbtn" onClick={p.onUndo} disabled={!p.canUndo} title="Undo">↶</button>
        <button className="tbtn" onClick={p.onRedo} disabled={!p.canRedo} title="Redo">↷</button>
      </div>

      <button className="btn-primary" onClick={p.onCalculate} disabled={p.calculating}>
        {p.calculating ? 'Calculating…' : 'Calculate paths'}
      </button>

      <div className="toolbar-group transport">
        <button className="tbtn" onClick={p.onPlayPause} disabled={!p.hasResult} title={p.playing ? 'Pause' : 'Play transition'}>
          {p.playing ? '❚❚' : '▶'}
        </button>
        <input
          type="range"
          className="scrub"
          min={0}
          max={1}
          step={0.005}
          value={p.animT}
          onChange={(e) => p.onScrub(parseFloat(e.target.value))}
        />
        <select className="speed-select" value={p.speed} onChange={(e) => p.onSpeed(parseFloat(e.target.value))} title="Animation speed">
          <option value={0.25}>0.25×</option>
          <option value={0.5}>0.5×</option>
          <option value={1}>1×</option>
          <option value={2}>2×</option>
          <option value={4}>4×</option>
        </select>
      </div>

      {p.routeCount > 1 && (
        <div className="toolbar-group route-picker" title="Alternative optimized solutions — best first">
          <span className="route-label">Routes</span>
          {Array.from({ length: p.routeCount }, (_, i) => {
            const r = p.routes[i]
            const title = r
              ? `#${i + 1} · ${r.totalDistance.toFixed(1)}m · ${r.intersectionCount} crossings · ${r.collisionCount} near-misses${i === 0 ? ' (best)' : ''}`
              : `Route ${i + 1}`
            return (
              <button
                key={i}
                className={`tbtn route-btn ${p.routeIdx === i ? 'route-active' : ''}`}
                onClick={() => p.onRouteIdx(i)}
                title={title}
              >
                {i + 1}
              </button>
            )
          })}
        </div>
      )}

      {p.conflicts && (p.conflicts.intersections > 0 || p.conflicts.collisions > 0) && (
        <span className="conflict-badge" title="Remaining conflicts — a fully clean solution may not be possible">
          ⚠ {p.conflicts.intersections} crossings · {p.conflicts.collisions} near-misses
        </span>
      )}

      <div className="spacer" />

      <div className="toolbar-group">
        <button className="tbtn" onClick={p.onExportPng} title="Export canvas as PNG">PNG</button>
        <button className="tbtn" onClick={p.onExportJson} title="Download project JSON">Save</button>
        <button className="tbtn" onClick={() => fileRef.current?.click()} title="Load project JSON">Load</button>
        <input
          ref={fileRef}
          type="file"
          accept=".json,application/json"
          style={{ display: 'none' }}
          onChange={(e) => {
            const f = e.target.files?.[0]
            if (f) p.onImportJson(f)
            e.target.value = ''
          }}
        />
        <button className="tbtn danger-text" onClick={p.onResetAll} title="Reset entire project">Reset</button>
      </div>
    </header>
  )
}
