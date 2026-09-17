# Upstream Munder Difflin Baseline

This document establishes the exact provenance and upstream baseline for the **AgentHub-Desktop** fork in accordance with the `V0.8.0` baseline audit specification.

---

## 1. Fork Provenance

| Parameter | Value |
|---|---|
| **Upstream Repository URL** | `https://github.com/chaitanyagiri/munder-difflin.git` |
| **Upstream Default Branch** | `main` |
| **Upstream Commit SHA** | `77d0ec83416bd21c8dd499c2de2715da32b73892` |
| **Upstream Commit Date** | `2026-09-17T16:12:08Z` |
| **Upstream Commit Message** | `Merge pull request #554 from chaitanyagiri/docs/releases-link-follows-the-listing` |
| **Upstream Package Version** | `0.4.6` |
| **Fork Creation Date** | `2026-09-18` |
| **Fork Target Repository** | `704986409/AgentHub-Desktop` (`https://github.com/704986409/AgentHub-Desktop.git`) |
| **Local Desktop Workspace** | `g:\Code\AgentHub-Desktop` |

---

## 2. Technology Stack & Runtime Dependencies

| Tier | Technologies / Libraries |
|---|---|
| **Runtime & Shell** | Electron `^32.2.0`, Node.js (tested `v22.22.0`), `electron-vite` `^2.3.0` |
| **Frontend Framework** | React `^18.3.1`, TypeScript `^5.6.3`, Vite `^5.4.8` |
| **State Management** | Zustand `^4.5.5` |
| **Office Visualization** | Pixi.js `^8.5.1` (2D Canvas / WebGL rendering of the office floor) |
| **Terminal & PTY** | `@xterm/xterm` `^5.5.0`, `node-pty` `^1.0.0` |
| **Embedded Editor** | Monaco Editor `^0.52.2`, CodeMirror 6 |
| **Local Persistence** | `better-sqlite3` `^11.10.0` |
| **Packaging** | `electron-builder` `^25.1.8` |

---

## 3. Package Scripts & Build Entrypoints

* **`npm run dev`**: `electron-vite dev` — Launches Vite dev server for Main, Preload, and Renderer.
* **`npm run build`**: `electron-vite build && npm run copy:main-assets` — Compiles TypeScript into `out/main`, `out/preload`, `out/renderer`, and copies runtime CJS helpers (`slack-trigger.cjs`, `kg-core.cjs`).
* **`npm run typecheck`**: Runs `typecheck:node` (`tsc --noEmit -p tsconfig.node.json`) and `typecheck:web` (`tsc --noEmit -p tsconfig.web.json`).
* **`npm run test:focused`**: Runs node test runner on `test/*.test.cjs`.
* **`npm run postinstall`**: `electron-rebuild -f && node tools/ensure-pty-perms.cjs && node tools/patch-node-pty-conpty.cjs`.
* **`npm run dist:win`**: `npm run build && electron-builder --win` — Packages Windows installer/portable distribution into `dist/`.

---

## 4. Licensing and Attribution Summary

* **Code License**: MIT License, Copyright (c) 2026 Chaitanya Giri (`LICENSE`).
* **Tile Assets**: Modern Interiors - RPG Tileset [16X16] by [LimeZu](https://limezu.itch.io/), licensed under the LimeZu Complete Version license (`LICENSE-ASSETS`). Credit is required and must be maintained.
* **Cast Sprites**: Procedurally drawn in `src/renderer/src/scene/office/portraitArt.ts` under MIT.
* **Tiled Maps**: Maps `maps/office.tmj` and `maps/brooklyn99.tmj` vendored from `shahar061/the-office` (ISC license).
