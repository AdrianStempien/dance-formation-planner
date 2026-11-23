import React, { useCallback, useEffect, useRef, useState } from 'react'
import CanvasStage, { type ViewState, type CanvasMode } from './components/CanvasStage'
import TopBar from './components/TopBar'
import { LeftPanel, RightPanel } from './components/Panels'
import { usePlanner, gridSlot } from './state/usePlanner'
import { optimizePaths } from './lib/optimizer'
import { pointAlongPath } from './lib/geom'
import type { Vec2 } from './lib/types'

export default function App() {
  const planner = usePlanner()
  const { state, actions } = planner

  // The currently displayed solution: best (routeIdx 0) or an alternate.
  const displayResult =
    state.result == null
      ? null
      : state.routeIdx === 0
        ? state.result
        : state.altResults[state.routeIdx - 1] ?? state.result

  const [view, setView] = useState<ViewState>({ tx: 0, ty: 0, zoom: 42 })
  const [mode, setMode] = useState<CanvasMode>('select')
  const [playing, setPlaying] = useState(false)
  const [animT, setAnimT] = useState(0)
  const [animPos, setAnimPos] = useState<Record<string, Vec2> | null>(null)
  const [speed, setSpeed] = useState(1)
  const [calculating, setCalculating] = useState(false)
  const animTRef = useRef(0)
  const speedRef = useRef(1)
  speedRef.current = speed

  const runCalc = useCallback(
    (showFlag = false) => {
      const doCalc = () => {
        const s = planner.state
        if (s.dancers.length === 0) {
          actions.setCalcOutcome(null, [])
          setPlaying(false)
          setAnimPos(null)
          animTRef.current = 0
          setAnimT(0)
          return
        }
        const starts: Record<string, Vec2> = {}
        s.dancers.forEach((d, i) => {
          starts[d.id] = s.start.positions[d.id] ?? gridSlot(i, s.dancers.length)
        })
        const targets = Object.values(s.target.positions)
        const routes = Object.fromEntries(
          Object.entries(s.routes).filter(([, r]) => r.waypoints.length > 0)
        )
        const baseSeed = Date.now() % 100000
        const runs = [0, 1, 2].map((k) =>
          optimizePaths({
            dancerIds: s.dancers.map((d) => d.id),
            starts,
            targets,
            exactDestinations: s.target.positions,
            pinned: s.pinned,
            assignMode: s.assignMode,
            manualRoutes: routes,
            weights: s.weights,
            allowTurns: s.allowTurns,
            timeBudgetMs: 140,
            seed: baseSeed + k * 7919,
          })
        )
        runs.sort((a, b) => a.score - b.score)
        actions.setCalcOutcome(runs[0], runs.slice(1))
        // reset animation
        animTRef.current = 0
        setAnimT(0)
        setAnimPos(null)
        setPlaying(false)
      }
      if (showFlag) {
        setCalculating(true)
        setTimeout(() => {
          doCalc()
          setCalculating(false)
        }, 30)
      } else {
        doCalc()
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [planner.state, actions]
  )

  // auto-recalc (debounced) when inputs change
  const calcDeps =
    state.weights.distance + state.weights.intersection + state.weights.collision +
    state.weights.smoothness + state.weights.complexity +
    (state.allowTurns ? 1 : 0) + (state.assignMode === 'exact' ? 1 : 0) +
    JSON.stringify(state.routes) + JSON.stringify(state.pinned) +
    JSON.stringify(state.start.positions) + JSON.stringify(state.target.positions) +
    state.dancers.length
  const firstRun = useRef(true)
  useEffect(() => {
    if (firstRun.current) {
      firstRun.current = false
      const t = setTimeout(() => runCalc(), 300)
      return () => clearTimeout(t)
    }
    const t = setTimeout(() => runCalc(), 350)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [calcDeps])

  // animation loop
  useEffect(() => {
    if (!playing || !displayResult) return
    let raf = 0
    let last = performance.now()
    const tick = (now: number) => {
      const dt = now - last
      last = now
      let t = animTRef.current + (dt / 3200) * speedRef.current
      if (t >= 1) {
        t = 1
        animTRef.current = 1
        setAnimT(1)
        setPlaying(false)
      } else {
        animTRef.current = t
        setAnimT(t)
      }
      const pos: Record<string, Vec2> = {}
      for (const p of displayResult.paths) pos[p.dancerId] = pointAlongPath(p.points, t)
      setAnimPos(pos)
      if (t < 1) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [playing, displayResult])

  const togglePlay = () => {
    if (!displayResult) return
    if (animTRef.current >= 1) {
      animTRef.current = 0
      setAnimT(0)
    }
    setPlaying((p) => !p)
  }

  const scrub = (t: number) => {
    setPlaying(false)
    animTRef.current = t
    setAnimT(t)
    if (displayResult) {
      const pos: Record<string, Vec2> = {}
      for (const p of displayResult.paths) pos[p.dancerId] = pointAlongPath(p.points, t)
      setAnimPos(t > 0 ? pos : null)
    }
  }

  // ---------- canvas interactions ----------
  const onCanvasClick = (pos: Vec2) => {
    if (mode === 'route' && state.selectedId) {
      actions.addWaypoint(state.selectedId, pos)
    } else if (mode === 'pin' && state.selectedId) {
      actions.setPinned(state.selectedId, pos)
      setMode('select')
    }
  }

  // ---------- export ----------
  const download = (blob: Blob, name: string) => {
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = name
    a.click()
    setTimeout(() => URL.revokeObjectURL(a.href), 5000)
  }

  const exportPng = () => {
    const svg = document.getElementById('stage-svg') as SVGSVGElement | null
    if (!svg) return
    const xml = new XMLSerializer().serializeToString(svg)
    const blob = new Blob([xml], { type: 'image/svg+xml;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const img = new Image()
    img.onload = () => {
      const scale = 2
      const canvas = document.createElement('canvas')
      canvas.width = svg.clientWidth * scale
      canvas.height = svg.clientHeight * scale
      const ctx = canvas.getContext('2d')!
      ctx.fillStyle = '#f4f1ea'
      ctx.fillRect(0, 0, canvas.width, canvas.height)
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
      canvas.toBlob((b) => {
        if (b) download(b, 'formation-paths.png')
        URL.revokeObjectURL(url)
      })
    }
    img.src = url
  }

  const exportJson = () => {
    download(new Blob([actions.exportJSON()], { type: 'application/json' }), 'formation-project.json')
  }

  const importJson = (file: File) => {
    file.text().then((t) => actions.importJSON(t))
  }

  const conflicts = displayResult
    ? { intersections: displayResult.intersectionCount, collisions: displayResult.collisionCount }
    : null

  return (
    <div className="app">
      <TopBar
        editing={state.editing}
        onEditing={actions.setEditing}
        canUndo={planner.past.length > 0}
        canRedo={planner.future.length > 0}
        onUndo={actions.undo}
        onRedo={actions.redo}
        onCalculate={() => runCalc(true)}
        calculating={calculating}
        playing={playing}
        onPlayPause={togglePlay}
        animT={animT}
        onScrub={scrub}
        speed={speed}
        onSpeed={setSpeed}
        onExportPng={exportPng}
        onExportJson={exportJson}
        onImportJson={importJson}
        onResetAll={actions.resetAll}
        conflicts={conflicts}
        hasResult={!!displayResult}
        routeIdx={state.routeIdx}
        routeCount={state.altResults.length + 1}
        routes={state.result ? [state.result, ...state.altResults] : []}
        onRouteIdx={actions.setRouteIdx}
      />
      <div className="main">
        <LeftPanel
          state={state}
          onAdd={actions.addDancer}
          onRemove={actions.removeDancer}
          onRename={actions.renameDancer}
          onSelect={actions.setSelected}
          onTogglePath={actions.togglePathVisibility}
          onFormationName={actions.setFormationName}
          onCopy={actions.copyFormation}
          onReset={actions.resetFormation}
        />
        <div className="stage-area">
          <CanvasStage
            state={{ ...state, result: displayResult }}
            mode={mode}
            view={view}
            setView={setView}
            onDancerDrag={actions.moveDancer}
            onGestureBegin={actions.beginGesture}
            onGestureEnd={actions.endGesture}
            onCanvasClick={onCanvasClick}
            onSelect={(id) => {
              actions.setSelected(id)
              if (!id) setMode('select')
            }}
            animPositions={animPos}
          />
          <div className="canvas-hint">
            Scroll to zoom · drag to pan · drag dancers to move
            {mode === 'route' && ' · click to place waypoints'}
            {mode === 'pin' && ' · click to place pinned destination'}
          </div>
        </div>
        <RightPanel
          state={state}
          mode={mode}
          setMode={setMode}
          onWeights={actions.setWeights}
          onAllowTurns={actions.setAllowTurns}
          onAssignMode={actions.setAssignMode}
          onRouteAction={{
            addWaypointUndo: () => state.selectedId && actions.undoWaypoint(state.selectedId),
            clearRoute: () => state.selectedId && actions.clearRoute(state.selectedId),
            toggleLock: () => state.selectedId && actions.toggleLock(state.selectedId),
            togglePin: () => state.selectedId && actions.togglePin(state.selectedId),
          }}
        />
      </div>
    </div>
  )
}
