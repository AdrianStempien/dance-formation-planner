import React, { useCallback, useEffect, useRef, useState } from 'react'
import type { Vec2, MovePath } from '../lib/types'
import { pointAlongPath } from '../lib/geom'
import { smoothRoutePoints } from '../lib/path'
import { FLOOR_W, FLOOR_H } from '../state/usePlanner'
import type { PlannerState } from '../state/usePlanner'

export interface ViewState {
  tx: number
  ty: number
  zoom: number // px per meter
}

export type CanvasMode = 'select' | 'route' | 'pin'

interface Props {
  state: PlannerState
  mode: CanvasMode
  view: ViewState
  setView: React.Dispatch<React.SetStateAction<ViewState>>
  onDancerDrag: (id: string, pos: Vec2) => void
  onGestureBegin: () => void
  onGestureEnd: () => void
  onCanvasClick: (pos: Vec2) => void
  onSelect: (id: string | null) => void
  animPositions: Record<string, Vec2> | null
}

const COARSE = 48

export default function CanvasStage(props: Props) {
  const { state, mode, view, setView, animPositions } = props
  const svgRef = useRef<SVGSVGElement>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ w: 800, h: 600 })
  const dragRef = useRef<{ kind: 'pan' | 'dancer'; id?: string; startX: number; startY: number; moved: boolean; orig?: Vec2 } | null>(null)
  const [panning, setPanning] = useState(false)

  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const ro = new ResizeObserver(() => {
      setSize({ w: el.clientWidth, h: el.clientHeight })
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const w2s = useCallback(
    (p: Vec2): Vec2 => ({
      x: (p.x - view.tx) * view.zoom + size.w / 2,
      y: (p.y - view.ty) * view.zoom + size.h / 2,
    }),
    [view, size]
  )

  const s2w = useCallback(
    (clientX: number, clientY: number): Vec2 => {
      const r = svgRef.current!.getBoundingClientRect()
      const sx = clientX - r.left
      const sy = clientY - r.top
      return {
        x: (sx - size.w / 2) / view.zoom + view.tx,
        y: (sy - size.h / 2) / view.zoom + view.ty,
      }
    },
    [view, size]
  )

  // wheel zoom (non-passive)
  useEffect(() => {
    const el = svgRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const rect = el.getBoundingClientRect()
      const mx = e.clientX - rect.left
      const my = e.clientY - rect.top
      setView((v) => {
        const factor = Math.exp(-e.deltaY * 0.0012)
        const zoom = Math.min(220, Math.max(8, v.zoom * factor))
        // keep world point under cursor fixed
        const wx = (mx - size.w / 2) / v.zoom + v.tx
        const wy = (my - size.h / 2) / v.zoom + v.ty
        return {
          zoom,
          tx: wx - (mx - size.w / 2) / zoom,
          ty: wy - (my - size.h / 2) / zoom,
        }
      })
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [size, setView])

  const clampToFloor = (p: Vec2): Vec2 => ({
    x: Math.max(-FLOOR_W / 2 + 0.3, Math.min(FLOOR_W / 2 - 0.3, p.x)),
    y: Math.max(-FLOOR_H / 2 + 0.3, Math.min(FLOOR_H / 2 - 0.3, p.y)),
  })

  const onSvgPointerDown = (e: React.PointerEvent) => {
    if (e.button === 2) return
    ;(e.target as Element).setPointerCapture?.(e.pointerId)
    dragRef.current = { kind: 'pan', startX: e.clientX, startY: e.clientY, moved: false }
    setPanning(true)
  }

  const onDancerPointerDown = (e: React.PointerEvent, id: string) => {
    e.stopPropagation()
    props.onSelect(id)
    if (mode !== 'select') return
    const pos = state[state.editing].positions[id]
    dragRef.current = { kind: 'dancer', id, startX: e.clientX, startY: e.clientY, moved: false, orig: pos ? { ...pos } : undefined }
    if (pos) props.onGestureBegin()
    ;(e.target as Element).setPointerCapture?.(e.pointerId)
  }

  const onPointerMove = (e: React.PointerEvent) => {
    const d = dragRef.current
    if (!d) return
    const dx = e.clientX - d.startX
    const dy = e.clientY - d.startY
    if (Math.abs(dx) + Math.abs(dy) > 3) d.moved = true
    if (d.kind === 'pan') {
      setView((v) => ({ ...v, tx: v.tx - dx / v.zoom, ty: v.ty - dy / v.zoom }))
      d.startX = e.clientX
      d.startY = e.clientY
    } else if (d.kind === 'dancer' && d.id) {
      const w = s2w(e.clientX, e.clientY)
      props.onDancerDrag(d.id, clampToFloor(w))
    }
  }

  const onPointerUp = (e: React.PointerEvent) => {
    const d = dragRef.current
    dragRef.current = null
    setPanning(false)
    if (!d) return
    if (d.kind === 'dancer') {
      props.onGestureEnd()
    } else if (!d.moved && mode !== 'select') {
      const w = s2w(e.clientX, e.clientY)
      props.onCanvasClick(clampToFloor(w))
    }
  }

  // ---------- render helpers ----------
  const active = state[state.editing]
  const other = state[state.editing === 'start' ? 'target' : 'start']
  const dancerIndex = new Map(state.dancers.map((d, i) => [d.id, i]))
  const result = state.result

  const pathD = (pts: Vec2[]) =>
    pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${w2s(p).x.toFixed(1)},${w2s(p).y.toFixed(1)}`).join(' ')

  const arrowHead = (path: MovePath): { pts: string; angle: number } | null => {
    const pts = path.points
    if (pts.length < 2) return null
    const a = w2s(pts[pts.length - 2])
    const b = w2s(pts[pts.length - 1])
    const ang = Math.atan2(b.y - a.y, b.x - a.x)
    const size = 9
    const p1 = { x: b.x - size * Math.cos(ang - 0.45), y: b.y - size * Math.sin(ang - 0.45) }
    const p2 = { x: b.x - size * Math.cos(ang + 0.45), y: b.y - size * Math.sin(ang + 0.45) }
    return { pts: `${b.x},${b.y} ${p1.x},${p1.y} ${p2.x},${p2.y}`, angle: ang }
  }

  // manual route preview for selected dancer
  const selId = state.selectedId
  const selRoute = selId ? state.routes[selId] : undefined
  const selStart = selId ? state.start.positions[selId] : undefined
  const selDest =
    selId && result
      ? result.destinations[selId]
      : selId
        ? state.target.positions[selId]
        : undefined
  const routePreview =
    selId && selRoute && selStart && selDest
      ? smoothRoutePoints(selStart, selRoute.waypoints, selDest, COARSE)
      : null

  const gridLines: React.ReactNode[] = []
  for (let x = -FLOOR_W / 2; x <= FLOOR_W / 2 + 0.01; x += 2) {
    const a = w2s({ x, y: -FLOOR_H / 2 })
    const b = w2s({ x, y: FLOOR_H / 2 })
    gridLines.push(<line key={`v${x}`} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="#ece7dc" strokeWidth={1} />)
  }
  for (let y = -FLOOR_H / 2; y <= FLOOR_H / 2 + 0.01; y += 2) {
    const a = w2s({ x: -FLOOR_W / 2, y })
    const b = w2s({ x: FLOOR_W / 2, y })
    gridLines.push(<line key={`h${y}`} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="#ece7dc" strokeWidth={1} />)
  }

  const floorA = w2s({ x: -FLOOR_W / 2, y: -FLOOR_H / 2 })
  const floorB = w2s({ x: FLOOR_W / 2, y: FLOOR_H / 2 })

  return (
    <div ref={wrapRef} className="canvas-wrap" style={{ cursor: panning ? 'grabbing' : mode !== 'select' ? 'crosshair' : 'grab' }}>
      <svg
        id="stage-svg"
        ref={svgRef}
        width={size.w}
        height={size.h}
        onPointerDown={onSvgPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onContextMenu={(e) => e.preventDefault()}
      >
        {/* floor */}
        <rect
          x={floorA.x}
          y={floorA.y}
          width={floorB.x - floorA.x}
          height={floorB.y - floorA.y}
          rx={14}
          fill="#faf8f3"
          stroke="#ddd6c7"
          strokeWidth={1.5}
        />
        {gridLines}
        {/* center mark */}
        {(() => {
          const c = w2s({ x: 0, y: 0 })
          return <circle cx={c.x} cy={c.y} r={3} fill="#d8d2c4" />
        })()}

        {/* result paths */}
        {result &&
          result.paths.map((p) => {
            if (state.hiddenPaths[p.dancerId]) return null
            const d = state.dancers.find((x) => x.id === p.dancerId)
            if (!d) return null
            const dim = state.highlightId && state.highlightId !== p.dancerId
            const baseOpacity = dim ? 0.12 : p.manual ? 0.95 : 0.75
            const wpx = (state.highlightId === p.dancerId ? 3.4 : p.manual ? (state.routes[p.dancerId]?.locked ? 3 : 2.2) : 1.8) * Math.min(view.zoom / 40, 1.6)
            const dash = p.manual ? (state.routes[p.dancerId]?.locked ? 'none' : '7 5') : 'none'
            const ah = arrowHead(p)
            return (
              <g key={`path-${p.dancerId}`} opacity={baseOpacity}>
                <path d={pathD(p.points)} fill="none" stroke={d.color} strokeWidth={wpx} strokeDasharray={dash} strokeLinejoin="round" strokeLinecap="round" />
                {ah && <polygon points={ah.pts} fill={d.color} />}
              </g>
            )
          })}

        {/* route preview while editing waypoints */}
        {routePreview && selId && selStart && selDest && (
          <g>
            <path d={pathD(routePreview)} fill="none" stroke="#0f766e" strokeWidth={2.4} strokeDasharray="4 4" opacity={0.9} />
            {selRoute!.waypoints.map((w, i) => {
              const s = w2s(w)
              return <circle key={i} cx={s.x} cy={s.y} r={5} fill="#0f766e" stroke="#fff" strokeWidth={1.5} />
            })}
          </g>
        )}

        {/* ghost positions (inactive formation) */}
        {state.dancers.map((d) => {
          const pos = other.positions[d.id]
          if (!pos) return null
          const s = w2s(pos)
          const r = Math.max(9, Math.min(20, 0.32 * view.zoom))
          const idx = dancerIndex.get(d.id) ?? 0
          return (
            <g key={`ghost-${d.id}`} opacity={0.85}>
              <circle cx={s.x} cy={s.y} r={r} fill={d.color} fillOpacity={0.14} stroke={d.color} strokeWidth={1.6} strokeDasharray="4 3" />
              <text x={s.x} y={s.y + 4} textAnchor="middle" fontSize={Math.max(9, r * 0.62)} fontWeight={600} fill={d.color} opacity={0.9}>
                {idx + 1}
              </text>
            </g>
          )
        })}

        {/* pinned destination markers */}
        {state.dancers.map((d) => {
          const p = state.pinned[d.id]
          if (!p) return null
          const s = w2s(p)
          return (
            <g key={`pin-${d.id}`}>
              <circle cx={s.x} cy={s.y - 10} r={7} fill="#b45309" stroke="#fff" strokeWidth={1.5} />
              <text x={s.x} y={s.y - 7} textAnchor="middle" fontSize={9} fontWeight={700} fill="#fff">
                P
              </text>
            </g>
          )
        })}

        {/* active formation dancers */}
        {state.dancers.map((d) => {
          const pos = active.positions[d.id]
          if (!pos) return null
          const s = w2s(pos)
          const r = Math.max(10, Math.min(22, 0.36 * view.zoom))
          const idx = dancerIndex.get(d.id) ?? 0
          const selected = state.selectedId === d.id
          return (
            <g
              key={`d-${d.id}`}
              onPointerDown={(e) => onDancerPointerDown(e, d.id)}
              style={{ cursor: mode === 'select' ? 'pointer' : 'crosshair' }}
            >
              {selected && <circle cx={s.x} cy={s.y} r={r + 5} fill="none" stroke="#1c1917" strokeWidth={2} />}
              <circle cx={s.x} cy={s.y} r={r} fill={d.color} stroke="#fff" strokeWidth={2.5} />
              <text x={s.x} y={s.y + 4.5} textAnchor="middle" fontSize={Math.max(10, r * 0.66)} fontWeight={700} fill="#fff" style={{ pointerEvents: 'none', userSelect: 'none' }}>
                {idx + 1}
              </text>
            </g>
          )
        })}

        {/* animated movers */}
        {animPositions &&
          state.dancers.map((d) => {
            const p = animPositions[d.id]
            if (!p) return null
            const s = w2s(p)
            const r = Math.max(9, Math.min(18, 0.3 * view.zoom))
            return (
              <g key={`m-${d.id}`} opacity={0.95}>
                <circle cx={s.x} cy={s.y} r={r} fill={d.color} stroke="#fff" strokeWidth={2} />
                <text x={s.x} y={s.y + 3.5} textAnchor="middle" fontSize={Math.max(9, r * 0.62)} fontWeight={700} fill="#fff" style={{ pointerEvents: 'none' }}>
                  {dancerIndex.get(d.id)! + 1}
                </text>
              </g>
            )
          })}

        {/* locked route badge at midpoint */}
        {state.dancers.map((d) => {
          const r = state.routes[d.id]
          const path = result?.paths.find((p) => p.dancerId === d.id)
          if (!r?.locked || !path) return null
          const mid = path.points[Math.floor(path.points.length / 2)]
          const s = w2s(mid)
          return (
            <g key={`lock-${d.id}`} transform={`translate(${s.x - 7},${s.y - 7})`}>
              <rect width={14} height={11} rx={2} fill="#1c1917" />
              <path d="M3 11 V8 a4 4 0 0 1 8 0 V11" fill="none" stroke="#faf8f3" strokeWidth={2} />
            </g>
          )
        })}
      </svg>
    </div>
  )
}
