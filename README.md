<div align="center">

# 💃 Formation Planner

### Choreography-grade path optimization for dance instructors

Plan formations. Press one button. Get mathematically optimized, collision-aware movement paths for every dancer.

[![Deploy to GitHub Pages](https://github.com/AdrianStempien/dance-formation-planner/actions/workflows/deploy.yml/badge.svg)](https://adrianstempien.github.io/dance-formation-planner/)
![React](https://img.shields.io/badge/React-18-61DAFB?logo=react&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?logo=typescript&logoColor=white)
![Vite](https://img.shields.io/badge/Vite-5-646CFF?logo=vite&logoColor=white)

**[→ Live Demo](https://adrianstempien.github.io/dance-formation-planner/)**

</div>

---

## ✨ What it does

Formation Planner is a professional 2D choreography assistant. Arrange your dancers freely on the dance floor, define a **start** and **target** formation, and let the built-in optimizer compute the cleanest possible transition — minimizing travel distance, path crossings, and collisions.

- 🕺 **Free-form 2D canvas** — drag dancers anywhere; no grids or presets required
- 🎯 **Dual formations** — editable Start & Target formations with ghost previews
- 🧠 **Real optimization** — Hungarian assignment + iterative Bézier path search, not just straight lines
- 🎚️ **Tunable priorities** — sliders for distance, crossings, collisions, smoothness & simplicity
- ✋ **Manual overrides** — draw custom waypoint routes, lock them, pin destinations
- 🔀 **Alternate solutions** — compare up to 3 near-optimal route sets side by side
- 🎬 **Transition preview** — scrub & play the full movement animation
- 💾 **Autosave + export** — projects persist locally; export PNG or JSON

## 🚀 Quick start

```bash
npm install
npm run dev
```

Open `http://localhost:5173` — a demo formation is waiting for you.

## 🕹️ How to use

| Step | Action |
|------|--------|
| 1 | Drag the numbered dancers into your **Start** formation |
| 2 | Flip to **Target** and arrange the ending positions |
| 3 | Hit **Calculate paths** — or just move a slider |
| 4 | Press **▶** to preview the transition |

### Pro tips

- **Waypoints:** select a dancer → *+ Waypoints* → click the floor to draw a custom route. Routes act as hard constraints — the optimizer routes everyone else around them.
- **Lock / Pin:** lock a route so it's never touched, or pin a dancer to an exact destination point.
- **Nearest mode:** let the algorithm choose *who* goes *where* to minimize total travel.
- **Turns off:** restrict dancers to near-straight paths unless conflicts force a detour.
- **Routes 1·2·3:** when multiple good solutions exist, flip between them in the top bar.

## 🧮 The algorithm

The optimizer is a modular pipeline (`src/lib/`):

```
assignDestinations()   →  Hungarian algorithm (exact or nearest-position mode)
optimizePaths()        →  time-budgeted pattern search over Bézier control points
countConflicts()       →  segment-intersection + proximity collision detection
```

Each dancer's path is a **quadratic Bézier**; manual routes become **Catmull-Rom splines** through their waypoints. Every candidate curve is scored against *all* other paths simultaneously:

```
cost = w·distance + w·crossings + w·collisions + w·smoothness + w·simplicity
```

The search runs **3 seeds per calculation** and keeps the best-scoring result plus alternates — so you always see the optimal answer *and* its rivals.

## 🛠️ Tech stack

- **React 18 + TypeScript** — UI
- **Vite** — build tooling
- **SVG** — resolution-independent rendering & easy PNG export
- **Zero runtime dependencies** for the math — Hungarian algorithm, splines, and geometry are hand-rolled in ~600 lines

## 📁 Project structure

```
src/
├── lib/
│   ├── optimizer.ts    # path optimization engine
│   ├── hungarian.ts    # optimal assignment
│   ├── path.ts         # Bézier/Catmull-Rom sampling & conflict detection
│   └── geom.ts         # computational geometry primitives
├── state/
│   └── usePlanner.ts   # formations, dancers, undo/redo, autosave
└── components/
    ├── CanvasStage.tsx # interactive SVG stage
    ├── TopBar.tsx      # toolbar, transport, route picker
    └── Panels.tsx      # dancer list & optimization controls
```

## ⚠️ Honest limitations

When formations make a perfectly clean transition mathematically impossible, the app **tells you** — remaining crossings and near-misses are counted and displayed rather than hidden. No fake perfection.

---

<div align="center">

Made for dance instructors, choreographers & floor captains 💃

</div>
