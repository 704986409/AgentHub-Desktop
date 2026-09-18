import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Application, Container, Graphics, Ticker, Texture } from 'pixi.js';
// PixiJS uses new Function() internally, blocked by Electron CSP — this patches it.
import 'pixi.js/unsafe-eval';
import { useStore } from '@/store/store';
import { useAgentHubStore } from '@/stores/agentHubStore';
import {
  type OfficeAgentViewModel,
  projectAgentHubOffice
} from './agentHubOfficeProjection';
import { TiledMapRenderer } from './TiledMapRenderer';
import { Camera } from './Camera';
import { Character, paintCup } from './Character';
import { DeskScreen } from './DeskScreen';
import { MessageEnvelope, type MessageAct } from './MessageEnvelope';
import { hexToNumber, DEFAULT_CHARACTER } from './cast';
import { pickSoloLine, pickExchange, type BreakSpot } from './cafeteriaLines';
import { colors } from '@/design/tokens';
import { loadTheme, resolveThemeMap, themeTilesetUrls } from './themeLoader';
import {
  installContextLossRecovery, planInitFailure, DEFAULT_MAX_INIT_RETRIES
} from './glRecovery';
import type { Tile, Facing, ErrandKind, ErrandSpot } from './themeRegistry';

// The map, tileset atlases, desk-claim order, errand spots, coffee-economy
// tiles, prop anchors, monitor gids and palette all come from the active
// ThemeConfig now (see themeRegistry.ts / themeLoader.ts). Phase 0 ships the
// existing office unchanged as `theme: 'office'`.

export interface OfficeFloorProps {
  agents?: readonly OfficeAgentViewModel[];
  selectedAgentId?: string | null;
  onSelectAgent?: (id: string | null) => void;
}

/** Pixi Office is a projection of AgentHub state. Sit/walk/cheer are visual
 *  only and must not mutate Backend Agent/Task/Assignment. Human Presence is
 *  not an Agent and is not seated through this planner. */

/** A cafeteria break in progress for one agent — set by the coffee-break
 *  director, cleared when the agent leaves or gets pulled back to work. */
interface CafeChat {
  lines: readonly string[];        // alternating beats: even = initiator, odd = partner
  partnerId: string;
  idx: number;                     // next beat to speak
  beat: number;                    // seconds until the next beat
}

interface CafeBreak {
  spotIdx: number;                 // index into cafeSpots
  phase: 'walking' | 'lingering';
  timer: number;                   // walking → elapsed watchdog; lingering → countdown
  quipTimer: number;               // until the next solo quip swap
  chat?: CafeChat;                 // set on the conversation's initiator
  chattingWith?: string;           // set on the partner: stays put & stays quiet
}

/** An idle errand in progress for one agent. */
interface ErrandRun {
  phase: 'walking' | 'doing';
  timer: number;
  idx: number; // into ERRAND_SPOTS
}

/** One leg of the coffee economy: fetch a clean mug from the sideboard, brew
 *  at the counter machine, (later) wash at the sink and rack the mug again. */
interface CoffeeRun {
  phase: 'toTray' | 'taking' | 'toMachine' | 'brewing' | 'toSink' | 'washing' | 'toTrayBack' | 'placing';
  timer: number;
}

interface Runtime {
  character: Character;
  seatIndex: number | null;
  waitTile: Tile;
  charName: string;
  prevVisualStatus?: string;
  prevStatusLabel?: string;
  prevActivityText?: string;
  brk?: CafeBreak;
  /** This desk's monitor overlay — lit while its agent is seated. */
  screen?: DeskScreen;
  /** Walking a fresh coffee from the break room home to the desk. */
  cupCarryHome?: boolean;
  err?: ErrandRun;
  run?: CoffeeRun;
  /** When the current busy stretch (working) began. */
  busySince?: number;
}

/** Only a busy stretch at least this long earns a cheer on finishing. Short
 *  turns end quietly without "celebrating" over nothing. */
const CHEER_MIN_BUSY_MS = 60_000;

/** What an avatar mutters per errand, picked at random. i18n keys into
 *  `office.errand.*`. */
const ERRAND_THOUGHTS: Record<ErrandKind, readonly string[]> = {
  water:     ['office.errand.water.0', 'office.errand.water.1', 'office.errand.water.2'],
  window:    ['office.errand.window.0', 'office.errand.window.1', 'office.errand.window.2'],
  dispenser: ['office.errand.dispenser.0', 'office.errand.dispenser.1', 'office.errand.dispenser.2'],
  fridge:    ['office.errand.fridge.0', 'office.errand.fridge.1', 'office.errand.fridge.2'],
  shelf:     ['office.errand.shelf.0', 'office.errand.shelf.1', 'office.errand.shelf.2'],
  bin:       ['office.errand.bin.0', 'office.errand.bin.1', 'office.errand.bin.2'],
  smoke:     ['office.errand.smoke.0', 'office.errand.smoke.1', 'office.errand.smoke.2', 'office.errand.smoke.3']
};

/** Lines an avatar throws over its shoulder right after finishing a task. */
const CHEER_KEYS = [
  'office.cheer.0',
  'office.cheer.1',
  'office.cheer.2',
  'office.cheer.3',
  'office.cheer.4',
  'office.cheer.5',
  'office.cheer.6'
] as const;

/** Load a texture via an <img> element. Unlike Pixi's Assets.load(), this
 *  handles extension-less data: URLs. */
function loadTexture(url: string): Promise<Texture> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const tex = Texture.from(img);
      tex.source.scaleMode = 'nearest';
      resolve(tex);
    };
    img.onerror = () => reject(new Error('failed to load ' + url.slice(0, 40)));
    img.src = url;
  });
}

export function OfficeFloor({
  agents: inputAgents,
  selectedAgentId: inputSelectedAgentId,
  onSelectAgent: inputOnSelectAgent
}: OfficeFloorProps = {}) {
  const { t, i18n } = useTranslation();
  const hostRef = useRef<HTMLDivElement | null>(null);
  const appRef = useRef<Application | null>(null);
  const mountIdRef = useRef(0);
  const [glGeneration, setGlGeneration] = useState(0);
  const initRetriesRef = useRef(0);
  const officeTheme = useStore((s) => s.officeTheme);

  const hubSnapshot = useAgentHubStore((s) => s.snapshot);
  const hubSelectedAgentId = useAgentHubStore((s) => s.selectedAgentId);
  const hubSelectAgent = useAgentHubStore((s) => s.selectAgent);

  const fallbackProjection = useMemo(
    () => projectAgentHubOffice(hubSnapshot),
    [hubSnapshot]
  );

  const effectiveAgents = inputAgents ?? fallbackProjection.visibleAgents;
  const effectiveSelectedAgentId =
    inputSelectedAgentId !== undefined ? inputSelectedAgentId : hubSelectedAgentId;
  const effectiveOnSelectAgent = inputOnSelectAgent ?? hubSelectAgent;

  const agentsRef = useRef<readonly OfficeAgentViewModel[]>(effectiveAgents);
  agentsRef.current = effectiveAgents;

  const selectedAgentIdRef = useRef<string | null>(effectiveSelectedAgentId);
  selectedAgentIdRef.current = effectiveSelectedAgentId;

  const onSelectAgentRef = useRef<(id: string | null) => void>(effectiveOnSelectAgent);
  onSelectAgentRef.current = effectiveOnSelectAgent;

  const syncAgentsRef = useRef<((agents: readonly OfficeAgentViewModel[]) => void) | null>(null);
  const handleSelectedIdRef = useRef<((id: string | null) => void) | null>(null);

  useEffect(() => {
    syncAgentsRef.current?.(effectiveAgents);
  }, [effectiveAgents]);

  useEffect(() => {
    handleSelectedIdRef.current?.(effectiveSelectedAgentId);
  }, [effectiveSelectedAgentId]);

  const fullscreenAgentId = useStore((s) => s.fullscreenAgentId);
  const ideOpen = useStore((s) => s.ideOpen);
  const [docHidden, setDocHidden] = useState(() => document.hidden);
  useEffect(() => {
    const onVis = () => setDocHidden(document.hidden);
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, []);
  const paused = !!fullscreenAgentId || ideOpen || docHidden;
  const pausedRef = useRef(paused);
  useEffect(() => {
    pausedRef.current = paused;
    const ticker = appRef.current?.ticker;
    if (!ticker) return;
    if (paused) ticker.stop(); else ticker.start();
  }, [paused]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    while (host.firstChild) host.removeChild(host.firstChild);

    const mountId = ++mountIdRef.current;
    const app = new Application();
    appRef.current = app;

    const runtimes = new Map<string, Runtime>();
    const seatClaims = new Set<number>();
    const envelopes: MessageEnvelope[] = [];
    const MAX_ENVELOPES = 16;

    const init = async () => {
      const theme = await loadTheme(officeTheme);
      await app.init({
        background: hexNum(theme.palette.background),
        antialias: false,
        roundPixels: true,
        resolution: Math.max(window.devicePixelRatio || 1, 2),
        autoDensity: true,
        width: host.clientWidth || 800,
        height: host.clientHeight || 600,
      });
      if (mountIdRef.current !== mountId) { safeDestroy(app); return; }
      while (host.firstChild) host.removeChild(host.firstChild);
      host.appendChild(app.canvas);

      (app as any).__glRecovery = installContextLossRecovery(app.canvas, {
        onRebuild: () => { if (mountIdRef.current === mountId) setGlGeneration((n) => n + 1); },
        onGiveUp: () => {
          if (mountIdRef.current !== mountId) return;
          host.appendChild(floorNote(t('office.gpuError')));
        }
      });

      const tilesetTextures = await Promise.all(
        themeTilesetUrls(theme).map(loadTexture),
      );
      if (mountIdRef.current !== mountId) { safeDestroy(app); return; }

      const world = new Container();
      app.stage.addChild(world);

      const mapRenderer = new TiledMapRenderer(resolveThemeMap(theme), tilesetTextures);
      world.addChild(mapRenderer.getContainer());
      const charLayer = mapRenderer.getCharacterContainer();

      const camera = new Camera(world);
      camera.setMapSize(mapRenderer.width * mapRenderer.tileSize, mapRenderer.height * mapRenderer.tileSize);
      camera.setViewSize(app.screen.width, app.screen.height);
      camera.fitToScreen();

      // ─── Wall calendar → TRIGGERS ──────────────────────────────────────────
      const calTs = mapRenderer.tileSize;
      const calG = new Graphics();
      calG.eventMode = 'static';
      calG.cursor = 'pointer';
      calG.position.set(theme.anchors.calendar.x * calTs + 8, theme.anchors.calendar.y * calTs + 5);
      calG.zIndex = 3 * calTs;
      calG.on('pointertap', (ev) => {
        ev.stopPropagation();
        const st = useStore.getState();
        st.requestCommandCenterTab('triggers');
      });
      calG.rect(7, -2, 2, 2).fill(0x4a3b52);
      calG.rect(0, 0, 16, 20).fill(0x4a3b52);
      calG.rect(1, 1, 14, 18).fill(0xf2ead8);
      calG.rect(1, 1, 14, 4).fill(0xc94f4f);
      calG.rect(4, 0, 1, 2).fill(0xd8d3c4);
      calG.rect(11, 0, 1, 2).fill(0xd8d3c4);
      for (let r = 0; r < 3; r++) {
        for (let c = 0; c < 5; c++) {
          calG.rect(2 + c * 3, 7 + r * 4, 2, 2).fill(0xb8ab90);
        }
      }
      calG.rect(8, 11, 2, 2).fill(0xc94f4f);
      charLayer.addChild(calG);

      const seatTiles: Tile[] = [];
      const seatSeen = new Set<string>();
      const addSeat = (t?: Tile) => {
        if (!t) return;
        const k = `${t.x},${t.y}`;
        if (seatSeen.has(k)) return;
        seatSeen.add(k);
        seatTiles.push({ x: t.x, y: t.y });
      };
      for (const name of theme.primarySeatNames) addSeat(mapRenderer.getSpawnPoint(name));
      const addZoneSeats = (zone: string) => {
        const z = mapRenderer.getZone(zone);
        if (!z) return;
        for (let y = z.y; y < z.y + z.height; y++) {
          for (let x = z.x; x < z.x + z.width; x++) {
            if (mapRenderer.isWalkable(x, y)) addSeat({ x, y });
          }
        }
      };
      addZoneSeats('boardroom');

      const entrance = mapRenderer.getSpawnPoint('entrance')
        ?? { x: Math.floor(mapRenderer.width / 2), y: mapRenderer.height - 2 };
      const waitTiles: Tile[] = [];
      const waitSeen = new Set<string>();
      for (let radius = 0; radius <= 6 && waitTiles.length < 16; radius++) {
        for (let dy = -radius; dy <= radius; dy++) {
          for (let dx = -radius; dx <= radius; dx++) {
            if (Math.max(Math.abs(dx), Math.abs(dy)) !== radius) continue;
            const x = entrance.x + dx, y = entrance.y + dy;
            const k = `${x},${y}`;
            if (waitSeen.has(k)) continue;
            if (mapRenderer.isWalkable(x, y)) { waitSeen.add(k); waitTiles.push({ x, y }); }
          }
        }
      }
      if (waitTiles.length === 0) waitTiles.push(entrance);

      const claimSeat = (_agent: OfficeAgentViewModel): number | null => {
        for (let i = 0; i < seatTiles.length; i++) {
          if (!seatClaims.has(i)) {
            seatClaims.add(i);
            return i;
          }
        }
        return null;
      };

      const facingForSeat = (t: Tile): 'up' | 'down' | 'left' | 'right' => {
        if (!mapRenderer.isWalkable(t.x, t.y - 1)) return 'up';
        if (!mapRenderer.isWalkable(t.x, t.y + 1)) return 'down';
        if (!mapRenderer.isWalkable(t.x - 1, t.y)) return 'left';
        if (!mapRenderer.isWalkable(t.x + 1, t.y)) return 'right';
        return 'up';
      };

      // ─── Cafeteria: purposeful coffee breaks ───────────────────────────────
      interface CafeSpot { tile: Tile; facing: Facing; spot: BreakSpot; seated: boolean; partner: number; }
      const cafeSpots: CafeSpot[] = [];

      const faceFurniture = (t: Tile): Facing => {
        if (!mapRenderer.isWalkable(t.x + 1, t.y)) return 'right';
        if (!mapRenderer.isWalkable(t.x - 1, t.y)) return 'left';
        if (!mapRenderer.isWalkable(t.x, t.y - 1)) return 'up';
        return 'down';
      };

      for (const name of theme.cafeSeatNames) {
        const p = mapRenderer.getSpawnPoint(name);
        if (p) cafeSpots.push({ tile: p, facing: facingForSeat(p), spot: 'table', seated: true, partner: -1 });
      }
      for (let i = 0; i < cafeSpots.length; i++) {
        for (let j = i + 1; j < cafeSpots.length; j++) {
          const a = cafeSpots[i].tile, b = cafeSpots[j].tile;
          if (a.x === b.x && Math.abs(a.y - b.y) === 2) { cafeSpots[i].partner = j; cafeSpots[j].partner = i; }
        }
      }
      for (const [name, spot] of theme.cafeStands) {
        const p = mapRenderer.getSpawnPoint(name);
        if (p) cafeSpots.push({ tile: p, facing: faceFurniture(p), spot, seated: false, partner: -1 });
      }
      const cafeTaken: (string | null)[] = new Array(cafeSpots.length).fill(null);

      // ─── Coffee economy ────────────────────────────────────────────────────
      const TRAY_TILE: Tile = theme.coffee.trayTile;
      const TRAY_STAND: Tile = theme.coffee.trayStand;
      const MACHINE_STAND: Tile = theme.coffee.machineStand;
      const SINK_TILE: Tile = theme.coffee.sinkTile;
      const SINK_STAND: Tile = theme.coffee.sinkStand;
      const MAX_CUPS = theme.coffee.maxCups;
      let cleanCups = MAX_CUPS;

      const ts0 = mapRenderer.tileSize;
      const trayG = new Graphics();
      trayG.eventMode = 'none';
      trayG.position.set(TRAY_TILE.x * ts0, TRAY_TILE.y * ts0);
      trayG.zIndex = (TRAY_TILE.y + 1) * ts0;
      charLayer.addChild(trayG);
      const drawTray = (): void => {
        trayG.clear();
        const slots: Array<[number, number]> = [[2, 10], [9, 10], [2, 15], [9, 15]];
        for (let i = 0; i < cleanCups && i < slots.length; i++) {
          paintCup(trayG, slots[i][0], slots[i][1]);
        }
      };
      drawTray();

      const sinkG = new Graphics();
      sinkG.eventMode = 'none';
      sinkG.position.set(SINK_TILE.x * ts0, SINK_TILE.y * ts0);
      sinkG.zIndex = (SINK_TILE.y + 1) * ts0;
      charLayer.addChild(sinkG);
      let sinkBusy = 0;
      const drawSink = (t: number): void => {
        sinkG.clear();
        sinkG.rect(2, 6, 12, 8).fill(0xb9c2c9);
        sinkG.rect(3, 7, 10, 6).fill(0x87939d);
        sinkG.rect(7, 9, 2, 2).fill(0x5d676f);
        sinkG.rect(7, 2, 2, 4).fill(0x6b7680);
        sinkG.rect(6, 2, 4, 1).fill(0x6b7680);
        if (sinkBusy > 0) {
          sinkG.rect(7, 6, 2, 4).fill({ color: 0x9fd6f0, alpha: 0.9 });
          for (let i = 0; i < 3; i++) {
            const ph = (t * 1.2 + i / 3) % 1;
            sinkG.circle(4 + i * 4, 7 - ph * 4, 1).fill({ color: 0xffffff, alpha: 0.7 * (1 - ph) });
          }
        }
      };
      drawSink(0);

      const machineG = new Graphics();
      machineG.eventMode = 'none';
      machineG.position.set(26 * ts0, 17 * ts0);
      machineG.zIndex = 19 * ts0;
      charLayer.addChild(machineG);
      let machineBusy = 0;
      const drawMachine = (t: number): void => {
        machineG.clear();
        if (machineBusy <= 0) return;
        for (let i = 0; i < 2; i++) {
          const ph = (t * 0.9 + i * 0.5) % 1;
          machineG.rect(6 + i * 3, 2 - Math.round(ph * 5), 1, 1)
            .fill({ color: 0xffffff, alpha: 0.6 * (1 - ph) });
        }
      };

      const finishRun = (rt: Runtime): void => {
        rt.run = undefined;
        const c = rt.character;
        if (c.isCarryingCup()) {
          rt.cupCarryHome = true;
          c.hideThought();
          c.sitAtDesk(false);
        } else {
          c.hideThought();
          c.startWandering();
        }
      };

      const startRunLeg = (rt: Runtime, phase: 'toTray' | 'toMachine' | 'toSink' | 'toTrayBack'): void => {
        rt.run = { phase, timer: 0 };
        const c = rt.character;
        const dest = phase === 'toMachine' ? MACHINE_STAND
          : phase === 'toSink' ? SINK_STAND
          : TRAY_STAND;
        c.walkToAndThen(dest, () => {
          if (!rt.run || rt.run.phase !== phase) return;
          c.faceDirection('up');
          if (phase === 'toTray') {
            if (cleanCups <= 0) {
              c.showThought(t('office.mugs.empty'));
              rt.run = { phase: 'placing', timer: -1 };
              return;
            }
            cleanCups--;
            drawTray();
            c.setCarryingCup(true);
            rt.run = { phase: 'taking', timer: 0 };
          } else if (phase === 'toMachine') {
            c.showThought(t('office.mugs.brewing'));
            machineBusy = 2.6;
            rt.run = { phase: 'brewing', timer: 0 };
          } else if (phase === 'toSink') {
            c.showThought(t('office.mugs.washing'));
            sinkBusy = 2.4;
            rt.run = { phase: 'washing', timer: 0 };
          } else {
            c.setCarryingCup(false);
            cleanCups = Math.min(MAX_CUPS, cleanCups + 1);
            drawTray();
            rt.run = { phase: 'placing', timer: 0 };
          }
        });
      };

      const releaseRun = (rt: Runtime): void => {
        if (!rt.run) return;
        rt.run = undefined;
        if (rt.character.isCarryingCup()) rt.cupCarryHome = true;
      };

      let fxClock = 0;
      const updateCoffeeRuns = (dt: number): void => {
        fxClock += dt;
        if (sinkBusy > 0) { sinkBusy -= dt; drawSink(fxClock); }
        if (machineBusy > 0) { machineBusy -= dt; drawMachine(fxClock); }
        for (const [, rt] of runtimes) {
          const run = rt.run;
          if (!run) continue;
          run.timer += dt;
          switch (run.phase) {
            case 'toTray':
            case 'toMachine':
            case 'toSink':
            case 'toTrayBack':
              if (run.timer > 20) finishRun(rt);
              break;
            case 'taking':
              if (run.timer >= 0.8) startRunLeg(rt, 'toMachine');
              break;
            case 'brewing':
              if (run.timer >= 2.6) finishRun(rt);
              break;
            case 'washing':
              if (run.timer >= 2.4) startRunLeg(rt, 'toTrayBack');
              break;
            case 'placing':
              if (run.timer >= 0.6) finishRun(rt);
              break;
          }
        }
      };

      const emitQuip = (id: string, rt: Runtime, spotIdx: number): void => {
        const spot = cafeSpots[spotIdx];
        const agent = agentsRef.current.find((a) => a.agentId === id);
        const character = agent?.character ?? DEFAULT_CHARACTER;
        const seed = Math.floor(Math.random() * 1e6);
        rt.character.showThought(pickSoloLine(character, spot.spot, seed));
      };

      const maybePairChat = (id: string, rt: Runtime, spotIdx: number): boolean => {
        const spot = cafeSpots[spotIdx];
        if (spot.partner < 0 || !rt.brk) return false;
        const partnerId = cafeTaken[spot.partner];
        if (!partnerId) return false;
        const prt = runtimes.get(partnerId);
        if (!prt?.brk || prt.brk.phase !== 'lingering') return false;
        if (rt.brk.chat || rt.brk.chattingWith || prt.brk.chat || prt.brk.chattingWith) return false;
        const agent = agentsRef.current.find((a) => a.agentId === id);
        const character = agent?.character ?? DEFAULT_CHARACTER;
        const lines = pickExchange(character, Math.floor(Math.random() * 1e6));
        rt.brk.chat = { lines, partnerId, idx: 0, beat: 0 };
        prt.brk.chattingWith = id;
        return true;
      };

      const releaseBreak = (rt: Runtime): void => {
        if (!rt.brk) return;
        if (rt.brk.chat) {
          const p = runtimes.get(rt.brk.chat.partnerId);
          if (p?.brk) p.brk.chattingWith = undefined;
        }
        if (rt.brk.chattingWith) {
          const o = runtimes.get(rt.brk.chattingWith);
          if (o?.brk) o.brk.chat = undefined;
        }
        cafeTaken[rt.brk.spotIdx] = null;
        rt.brk = undefined;
      };

      const endBreak = (id: string, rt: Runtime): void => {
        const arrived = rt.brk?.phase === 'lingering';
        releaseBreak(rt);
        rt.character.hideThought();
        const c = rt.character;
        if (!arrived) {
          if (c.isCarryingCup()) { rt.cupCarryHome = true; c.sitAtDesk(false); }
          else c.startWandering();
          return;
        }
        if (c.isCarryingCup()) {
          if (Math.random() < 0.6) startRunLeg(rt, 'toMachine');
          else startRunLeg(rt, 'toSink');
        } else if (!c.hasCupOnDesk() && Math.random() < 0.75) {
          startRunLeg(rt, 'toTray');
        } else {
          c.startWandering();
        }
      };

      const startBreak = (id: string, rt: Runtime): void => {
        const free: number[] = [];
        const social: number[] = [];
        for (let i = 0; i < cafeSpots.length; i++) {
          if (cafeTaken[i]) continue;
          free.push(i);
          const p = cafeSpots[i].partner;
          if (p >= 0 && cafeTaken[p]) social.push(i);
        }
        if (free.length === 0) return;
        const pool = (social.length && Math.random() < 0.55) ? social : free;
        const idx = pool[Math.floor(Math.random() * pool.length)];
        const spot = cafeSpots[idx];
        cafeTaken[idx] = id;
        rt.brk = { spotIdx: idx, phase: 'walking', timer: 0, quipTimer: 0 };
        const c = rt.character;
        if (c.hasCupOnDesk()) {
          c.setCupOnDesk(false);
          c.setCarryingCup(true);
        }
        c.walkToAndThen(spot.tile, () => {
          if (!rt.brk || rt.brk.spotIdx !== idx) return;
          if (spot.seated) c.sitInPlace(spot.facing);
          else { c.setIdle(); c.faceDirection(spot.facing); }
          rt.brk.phase = 'lingering';
          rt.brk.timer = 8 + Math.random() * 8;
          rt.brk.quipTimer = 4 + Math.random() * 4;
          if (!maybePairChat(id, rt, idx)) emitQuip(id, rt, idx);
        });
      };

      const breakEligible = (agent: OfficeAgentViewModel, rt: Runtime): boolean => {
        if (rt.brk || rt.err || rt.run || rt.cupCarryHome) return false;
        if (agent.visualStatus !== 'idle') return false;
        return !rt.character.isSitting();
      };

      let cafeCooldown = 5;
      const updateCafeteria = (dt: number): void => {
        for (const [id, rt] of runtimes) {
          const b = rt.brk;
          if (!b) continue;
          if (b.phase === 'walking') {
            b.timer += dt;
            if (b.timer > 20) endBreak(id, rt);
            continue;
          }
          if (b.chat) {
            b.chat.beat -= dt;
            if (b.chat.beat <= 0) {
              if (b.chat.idx < b.chat.lines.length) {
                const speaker = (b.chat.idx % 2 === 0) ? rt : runtimes.get(b.chat.partnerId);
                speaker?.character.showThought(b.chat.lines[b.chat.idx]);
                b.chat.idx++;
                b.chat.beat = 2.4;
                b.timer = Math.max(b.timer, 3.5);
                const prt = runtimes.get(b.chat.partnerId);
                if (prt?.brk) prt.brk.timer = Math.max(prt.brk.timer, 3.5);
              } else {
                const prt = runtimes.get(b.chat.partnerId);
                if (prt?.brk) prt.brk.chattingWith = undefined;
                b.chat = undefined;
              }
            }
          } else if (!b.chattingWith) {
            b.quipTimer -= dt;
            if (b.quipTimer <= 0) {
              b.quipTimer = 4 + Math.random() * 4;
              emitQuip(id, rt, b.spotIdx);
            }
            else if (Math.random() < 0.004) maybePairChat(id, rt, b.spotIdx);
          }
          b.timer -= dt;
          if (b.timer <= 0) endBreak(id, rt);
        }

        cafeCooldown -= dt;
        if (cafeCooldown > 0) return;
        cafeCooldown = 6 + Math.random() * 6;
        if (cafeTaken.filter(Boolean).length >= 4) return;
        if (Math.random() >= 0.7) return;
        const candidates: Array<[OfficeAgentViewModel, Runtime]> = [];
        for (const agent of agentsRef.current) {
          const rt = runtimes.get(agent.agentId);
          if (rt && breakEligible(agent, rt)) candidates.push([agent, rt]);
        }
        if (candidates.length === 0) return;
        const [agent, rt] = candidates[Math.floor(Math.random() * candidates.length)];
        startBreak(agent.agentId, rt);
      };

      // ─── Idle errands ──────────────────────────────────────────────────────
      const ERRAND_SPOTS: ErrandSpot[] = theme.errandSpots;
      const errandTaken: (string | null)[] = new Array(ERRAND_SPOTS.length).fill(null);
      const errandFx = new Map<number, Graphics>();

      const fxFor = (idx: number): Graphics => {
        let g = errandFx.get(idx);
        if (!g) {
          const spot = ERRAND_SPOTS[idx];
          g = new Graphics();
          g.eventMode = 'none';
          g.position.set(spot.fx.x * ts0, spot.fx.y * ts0);
          g.zIndex = (spot.fx.y + 1) * ts0;
          charLayer.addChild(g);
          errandFx.set(idx, g);
        }
        return g;
      };

      const drawErrandFx = (kind: ErrandKind, g: Graphics, t: number): void => {
        g.clear();
        if (kind === 'window' || kind === 'smoke') {
          for (let i = 0; i < 3; i++) {
            const ph = (t * 0.7 + i / 3) % 1;
            g.rect(2 + i * 9 - ph * 5, 26 + ph * 16, 7, 1)
              .fill({ color: 0xd8f1f7, alpha: 0.55 * (1 - ph) });
          }
        } else if (kind === 'dispenser') {
          const ph = (t * 1.6) % 1;
          g.rect(7, 18 + ph * 6, 1, 3).fill({ color: 0x9fd6f0, alpha: 0.9 * (1 - ph) });
          const bp = (t * 0.9) % 1;
          g.circle(8, 12 - bp * 6, 1).fill({ color: 0xffffff, alpha: 0.6 * (1 - bp) });
        } else if (kind === 'fridge') {
          const a = 0.16 + 0.05 * Math.sin(t * 5);
          g.poly([3, 12, 13, 12, 16, 30, 0, 30]).fill({ color: 0xfff2b8, alpha: a });
        } else if (kind === 'shelf') {
          const ph = (t * 0.5) % 1;
          g.rect(2 + ph * 24, 4 + (Math.floor(t * 0.5) % 3) * 9, 2, 2)
            .fill({ color: 0xfff7c8, alpha: 0.8 * Math.sin(ph * Math.PI) });
        } else if (kind === 'bin') {
          const ph = (t * 1.0) % 1;
          if (ph < 0.45) {
            const p = ph / 0.45;
            const fromX = 18, toX = 8;
            const x = fromX + (toX - fromX) * p;
            const y = 2 - Math.sin(p * Math.PI) * 9;
            g.rect(Math.round(x), Math.round(y), 2, 2).fill({ color: 0xf5f1e6, alpha: 0.95 });
          }
        }
      };

      const releaseErrand = (rt: Runtime): void => {
        if (!rt.err) return;
        errandTaken[rt.err.idx] = null;
        errandFx.get(rt.err.idx)?.clear();
        rt.err = undefined;
        rt.character.stopWatering();
        rt.character.stopSmoking();
      };

      let errCooldown = 18;
      const updateErrands = (dt: number): void => {
        for (const [, rt] of runtimes) {
          const err = rt.err;
          if (!err) continue;
          err.timer += dt;
          const spot = ERRAND_SPOTS[err.idx];
          if (err.phase === 'walking') {
            if (err.timer > 20) { releaseErrand(rt); rt.character.startWandering(); }
            continue;
          }
          drawErrandFx(spot.kind, fxFor(err.idx), err.timer);
          if (spot.kind !== 'water' && spot.kind !== 'smoke' && err.timer >= spot.duration) {
            releaseErrand(rt);
            rt.character.hideThought();
            rt.character.startWandering();
          }
        }
        errCooldown -= dt;
        if (errCooldown > 0) return;
        errCooldown = 14 + Math.random() * 18;
        if (Math.random() >= 0.65) return;
        const free = ERRAND_SPOTS.map((_, i) => i).filter((i) => !errandTaken[i] && !ERRAND_SPOTS[i].godOnly);
        if (free.length === 0) return;
        const idx = free[Math.floor(Math.random() * free.length)];
        const spot = ERRAND_SPOTS[idx];

        const candidates: Array<[OfficeAgentViewModel, Runtime]> = [];
        for (const a of agentsRef.current) {
          const r = runtimes.get(a.agentId);
          if (r && breakEligible(a, r)) candidates.push([a, r]);
        }
        if (candidates.length === 0) return;
        const [agent, rt] = candidates[Math.floor(Math.random() * candidates.length)];

        const c = rt.character;
        errandTaken[idx] = agent.agentId;
        rt.err = { phase: 'walking', timer: 0, idx };
        c.walkToAndThen(spot.stand, () => {
          if (!rt!.err || rt!.err.idx !== idx) return;
          rt!.err.phase = 'doing';
          rt!.err.timer = 0;
          c.faceDirection(spot.facing);
          const lines = ERRAND_THOUGHTS[spot.kind];
          c.showThought(t(lines[Math.floor(Math.random() * lines.length)]));
          const finish = (): void => {
            releaseErrand(rt!);
            c.hideThought();
            c.startWandering();
          };
          if (spot.kind === 'water') c.startWatering(spot.duration, finish);
          else if (spot.kind === 'smoke') c.startSmoking(spot.duration, finish);
        });
      };

      // ─── Desk life ─────────────────────────────────────────────────────────
      const updateDeskLife = (dt: number): void => {
        for (const [id, rt] of runtimes) {
          if (rt.cupCarryHome && rt.character.isSittingAtDesk()) {
            rt.cupCarryHome = false;
            rt.character.setCarryingCup(false);
            rt.character.setCupOnDesk(true);
            const agent = agentsRef.current.find((a) => a.agentId === id);
            if (agent && agent.visualStatus === 'idle') {
              rt.character.startWandering();
            }
          }
          if (rt.screen) {
            rt.screen.setOn(rt.character.isSittingAtDesk());
            rt.screen.update(dt);
          }
        }
      };

      // ─── Office task boards (visual wall display) ──────────────────────────
      const BOARD_TILE: Tile = theme.anchors.boards;
      const BOARD_CENTER_PAD = 15;
      const tsB = mapRenderer.tileSize;
      const boardG = new Graphics();
      boardG.eventMode = 'static';
      boardG.cursor = 'pointer';
      boardG.position.set(BOARD_TILE.x * tsB + BOARD_CENTER_PAD, BOARD_TILE.y * tsB);
      boardG.zIndex = (BOARD_TILE.y + 1) * tsB;
      boardG.on('pointertap', (ev) => {
        ev.stopPropagation();
        const st = useStore.getState();
        st.requestCommandCenterTab('tasks');
      });
      charLayer.addChild(boardG);

      const drawTaskBoard = (): void => {
        boardG.clear();
        boardG.rect(0, 0, 36, 26).fill(0x8a6f4d);
        boardG.rect(1, 1, 34, 24).fill(0xc8ad7f);
        boardG.rect(2, 2, 32, 4).fill(0xd96a62);
        boardG.rect(38, 0, 36, 26).fill(0x8a6f4d);
        boardG.rect(39, 1, 34, 24).fill(0xc8ad7f);
        boardG.rect(40, 2, 32, 4).fill(0xdcab3c);
        boardG.rect(76, 12, 10, 14).fill(0x6b5335);
        boardG.rect(77, 13, 8, 12).fill(0x91734a);
      };
      drawTaskBoard();

      const askG = new Graphics();
      askG.eventMode = 'static';
      askG.cursor = 'pointer';
      askG.position.set(14 * tsB + 25, 10 * tsB);
      askG.zIndex = 11 * tsB;
      askG.on('pointertap', (ev) => {
        ev.stopPropagation();
        const st = useStore.getState();
        st.requestCommandCenterTab('human');
      });
      charLayer.addChild(askG);
      const drawAskBoard = (): void => {
        askG.clear();
        askG.rect(0, 0, 18, 18).fill(0x5a4563);
        askG.rect(1, 1, 16, 16).fill(0xcbbad4);
        askG.rect(2, 2, 14, 3).fill(0x7b588a);
      };
      drawAskBoard();

      const addCharacter = async (agent: OfficeAgentViewModel) => {
        const charName = theme.cast.byName[agent.character] ? agent.character : theme.cast.defaultCharacter;
        const member = theme.cast.byName[charName];
        const seatIndex = claimSeat(agent);
        const seatTile: Tile = (seatIndex != null ? seatTiles[seatIndex] : undefined)
          ?? mapRenderer.getSpawnPoint('entrance')
          ?? { x: 2, y: 2 };
        const waitTile = waitTiles[(seatIndex ?? 0) % waitTiles.length];
        const frames = await theme.cast.getFrames(charName);
        if (mountIdRef.current !== mountId) return;
        if (!agentsRef.current.some((a) => a.agentId === agent.agentId)) {
          if (seatIndex != null) seatClaims.delete(seatIndex);
          return;
        }
        const character = new Character({
          agentId: agent.agentId,
          mapRenderer,
          frames,
          seatTile,
          seatDirection: facingForSeat(seatTile),
          spawnTile: entrance,
          glowColor: hexNum(colors.accent[agent.accent]) ?? hexToNumber(member.shirt),
          onClick: (id) => onSelectAgentRef.current?.(id),
        });
        character.show(charLayer);
        const rt: Runtime = { character, seatIndex, waitTile, charName };
        if (mapRenderer.gidAt('furniture-above', seatTile.x, seatTile.y - 2) === theme.monitor.offTopLeftGid) {
          const top = { x: seatTile.x, y: seatTile.y - 2 };
          rt.screen = new DeskScreen(mapRenderer, top, theme.monitor);
          charLayer.addChild(rt.screen.container);
          const ts2 = mapRenderer.tileSize;
          character.setCupSpot({ x: top.x * ts2 + 18, y: top.y * ts2 + 23 });
        }
        runtimes.set(agent.agentId, rt);
        applyState(agent, rt, true);
      };

      const removeCharacter = (id: string) => {
        const rt = runtimes.get(id);
        if (!rt) return;
        releaseBreak(rt);
        releaseErrand(rt);
        releaseRun(rt);
        if (rt.character.isCarryingCup() || rt.character.hasCupOnDesk()) {
          if (cleanCups >= MAX_CUPS) console.warn('[office] mug reclaim over cap — cup accounting drifted');
          cleanCups = Math.min(MAX_CUPS, cleanCups + 1);
          drawTray();
        }
        if (rt.seatIndex != null) seatClaims.delete(rt.seatIndex);
        rt.screen?.destroy();
        rt.character.hide(0);
        setTimeout(() => rt.character.destroy(), 700);
        runtimes.delete(id);
      };

      const applyState = (agent: OfficeAgentViewModel, rt: Runtime, force = false) => {
        const changed = force
          || rt.prevVisualStatus !== agent.visualStatus
          || rt.prevStatusLabel !== agent.statusLabel
          || rt.prevActivityText !== agent.activityText;
        if (!changed) return;

        const wasBusy = rt.prevVisualStatus === 'working';
        const isBusy = agent.visualStatus === 'working';
        if (isBusy && !wasBusy) rt.busySince = Date.now();
        const finishedWork = !force
          && wasBusy && agent.visualStatus === 'idle'
          && rt.busySince !== undefined && Date.now() - rt.busySince >= CHEER_MIN_BUSY_MS;
        if (!isBusy) rt.busySince = undefined;

        rt.prevVisualStatus = agent.visualStatus;
        rt.prevStatusLabel = agent.statusLabel;
        rt.prevActivityText = agent.activityText;

        const c = rt.character;
        c.setBaseAlpha(agent.visualStatus === 'ghost' ? 0.5 : 1);

        if (rt.brk) {
          if (agent.visualStatus === 'idle') {
            c.setStatusGlyph('none');
            return;
          }
          releaseBreak(rt);
        }
        if (rt.err) {
          if (agent.visualStatus === 'idle') {
            c.setStatusGlyph('none');
            return;
          }
          releaseErrand(rt);
        }
        if (rt.run) {
          if (agent.visualStatus === 'idle') {
            c.setStatusGlyph('none');
            return;
          }
          releaseRun(rt);
        }

        switch (agent.visualStatus) {
          case 'working':
            c.setStatusGlyph('none');
            c.sitAtDesk(true);
            c.showThought(agent.activityText || 'Working');
            break;
          case 'ghost':
            c.setStatusGlyph('none');
            c.hideThought();
            c.setIdle();
            break;
          case 'idle':
          default:
            c.setStatusGlyph('none');
            if (finishedWork) {
              c.startWandering();
              c.cheer();
              c.showThought(t(CHEER_KEYS[Math.floor(Math.random() * CHEER_KEYS.length)]));
            } else {
              c.startWandering();
              c.showThought(agent.activityText || 'Idle');
            }
            break;
        }
      };

      const syncAgents = (targetAgents: readonly OfficeAgentViewModel[]) => {
        const present = new Set(targetAgents.map((a) => a.agentId));
        for (const id of Array.from(runtimes.keys())) {
          if (!present.has(id)) removeCharacter(id);
        }
        for (const agent of targetAgents) {
          const rt = runtimes.get(agent.agentId);
          if (!rt) void addCharacter(agent);
          else applyState(agent, rt);
        }
      };
      syncAgentsRef.current = syncAgents;

      let lastSelected: string | null = selectedAgentIdRef.current;
      const handleSelectedIdChange = (newSelectedId: string | null) => {
        if (newSelectedId !== lastSelected) {
          lastSelected = newSelectedId;
          const rt = newSelectedId ? runtimes.get(newSelectedId) : undefined;
          if (rt) {
            const p = rt.character.getPixelPosition();
            camera.nudgeToward(p.x, p.y);
          }
        }
      };
      handleSelectedIdRef.current = handleSelectedIdChange;

      syncAgents(agentsRef.current);
      handleSelectedIdChange(selectedAgentIdRef.current);

      // ─── Envelopes (handoffs) ─────────────────────────────────────────────
      const ts = mapRenderer.tileSize;
      const humanPos = { x: entrance.x * ts + ts / 2, y: entrance.y * ts + ts };
      const posFor = (id: string): { x: number; y: number } | null => {
        if (id === 'human') return humanPos;
        const rt = runtimes.get(id);
        return rt ? rt.character.getPixelPosition() : null;
      };
      const spawnHandoff = (fromId: string, toId: string, act: MessageAct, needsHuman: boolean) => {
        if (envelopes.length >= MAX_ENVELOPES) return;
        if (toId === fromId) return;
        const from = posFor(fromId);
        const to = posFor(toId);
        if (!from || !to) return;
        const env = new MessageEnvelope(from, to, act, needsHuman);
        charLayer.addChild(env.container);
        envelopes.push(env);
      };

      const offMessage = window.cth?.onHiveMessage
        ? window.cth.onHiveMessage((e) => {
            for (const target of e.targets) spawnHandoff(e.from, target, e.act, e.needsHuman);
          })
        : () => {};

      const onDemoHandoff = (ev: Event) => {
        const d = (ev as CustomEvent<{ from: string; to: string; act: MessageAct }>).detail;
        if (d) spawnHandoff(d.from, d.to, d.act, false);
      };
      window.addEventListener('cth:demo-handoff', onDemoHandoff);
      (app as any).__offMessage = () => {
        offMessage();
        window.removeEventListener('cth:demo-handoff', onDemoHandoff);
      };

      const resolveBubbleOverlaps = () => {
        const items: Array<{ rt: Runtime; x: number; y: number; w: number; h: number }> = [];
        for (const rt of runtimes.values()) {
          const lay = rt.character.getThoughtLayout();
          if (lay) items.push({ rt, ...lay });
        }
        if (items.length < 2) {
          for (const it of items) it.rt.character.setThoughtLift(0);
          return;
        }
        items.sort((a, b) => (b.y + b.h) - (a.y + a.h) || a.x - b.x);
        const placed: Array<{ x: number; y: number; w: number; h: number }> = [];
        const pad = 2;
        for (const it of items) {
          let y = it.y;
          let moved = true, guard = 0;
          while (moved && guard++ < 12) {
            moved = false;
            for (const p of placed) {
              const overlapX = it.x < p.x + p.w + pad && it.x + it.w + pad > p.x;
              const overlapY = y < p.y + p.h + pad && y + it.h + pad > p.y;
              if (overlapX && overlapY) { y = p.y - it.h - pad; moved = true; }
            }
          }
          placed.push({ x: it.x, y, w: it.w, h: it.h });
          it.rt.character.setThoughtLift(it.y - y);
        }
      };

      const onTick = (ticker: Ticker) => {
        const dt = ticker.deltaMS / 1000;
        camera.update(dt);
        const zoom = world.scale.x;
        for (const rt of runtimes.values()) {
          rt.character.setBubbleZoom(zoom);
          rt.character.update(dt);
        }
        updateCafeteria(dt);
        updateCoffeeRuns(dt);
        updateErrands(dt);
        updateDeskLife(dt);
        resolveBubbleOverlaps();
        for (let i = envelopes.length - 1; i >= 0; i--) {
          if (envelopes[i].update(dt)) {
            envelopes[i].destroy();
            envelopes.splice(i, 1);
          }
        }
      };
      app.ticker.add(onTick);
      if (pausedRef.current) app.ticker.stop();

      const resize = new ResizeObserver((entries) => {
        for (const e of entries) {
          const { width, height } = e.contentRect;
          if (width === 0 || height === 0) continue;
          app.renderer?.resize(width, height);
          camera.setViewSize(width, height);
        }
      });
      resize.observe(host);
      (app as any).__resize = resize;
      initRetriesRef.current = 0;
    };

    init().catch((err) => {
      if (mountIdRef.current !== mountId) return;
      const plan = planInitFailure(err, initRetriesRef.current);

      if (plan.action === 'retry') {
        initRetriesRef.current = plan.attempt;
        console.warn(`[OfficeFloor] could not get a WebGL context — retrying, attempt ${plan.attempt}/${DEFAULT_MAX_INIT_RETRIES}`);
        setTimeout(() => {
          if (mountIdRef.current === mountId) setGlGeneration((n) => n + 1);
        }, plan.delayMs);
        return;
      }

      if (plan.action === 'give-up') {
        console.error(`[OfficeFloor] still no WebGL context after ${DEFAULT_MAX_INIT_RETRIES} retries:`, err);
        host.appendChild(floorNote(
          'The office floor could not get a GPU context.\n\n' +
          'The GPU may still be restarting, or too many terminals are\n' +
          'using it at once. Close a few agent terminals, or restart\n' +
          'the app, to bring the floor back.'));
        return;
      }

      console.error('[OfficeFloor] init failed:', err);
      host.appendChild(floorNote(
        'OfficeFloor failed to start:\n' + (err?.stack || err?.message || String(err))));
    });

    return () => {
      mountIdRef.current++;
      syncAgentsRef.current = null;
      handleSelectedIdRef.current = null;
      const a = appRef.current;
      if (a) {
        (a as any).__glRecovery?.();
        (a as any).__resize?.disconnect?.();
        try { (a as any).__offMessage?.(); } catch { /* noop */ }
        safeDestroy(a);
      }
      appRef.current = null;
      while (host.firstChild) host.removeChild(host.firstChild);
    };
  }, [officeTheme, glGeneration, i18n.language]);

  return (
    <div
      ref={hostRef}
      style={{
        width: '100%', height: '100%',
        boxShadow: 'var(--cth-panel-border)',
        overflow: 'hidden',
        imageRendering: 'pixelated',
        background: hex(colors.ink[900]),
      }}
    />
  );
}

function floorNote(text: string): HTMLDivElement {
  const note = document.createElement('div');
  note.style.cssText =
    'position:absolute;inset:0;display:flex;align-items:center;justify-content:center;' +
    'padding:24px;color:#ffd0b5;font-family:monospace;font-size:13px;text-align:center;white-space:pre-wrap;';
  note.textContent = text;
  return note;
}
function hexNum(n: number): number { return n; }
function hex(n: number): string { return '#' + n.toString(16).padStart(6, '0'); }
function safeDestroy(app: Application) {
  try { app.ticker?.stop(); } catch { /* noop */ }
  try { app.destroy(true, { children: true }); } catch { /* noop */ }
}
