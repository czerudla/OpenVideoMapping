// Sdílený stav projektu mezi editorem a výstupním oknem.

export const CHANNEL_NAME = 'videomapping';
const STORAGE_KEY = 'videomapping.project.v1';

export const uid = () => Math.random().toString(36).slice(2, 10);

export function createDefaultState() {
  return {
    version: 1,
    resolution: { w: 1920, h: 1080 },
    corners: [[0, 0], [1, 0], [1, 1], [0, 1]],
    shapes: [],
    blackout: false,
    calibration: false,
    startTime: Date.now(),
  };
}

export function normalizeState(raw) {
  const base = createDefaultState();
  if (!raw || typeof raw !== 'object') return base;
  const s = { ...base, ...raw };
  if (!Array.isArray(s.corners) || s.corners.length !== 4) s.corners = base.corners;
  if (!Array.isArray(s.shapes)) s.shapes = [];
  s.shapes = s.shapes
    .filter((sh) => sh && Array.isArray(sh.points) && sh.points.length >= 3)
    .map((sh) => ({
      id: sh.id || uid(),
      name: sh.name || 'Oblast',
      points: sh.points.map((p) => [Number(p[0]) || 0, Number(p[1]) || 0]),
      anim: sh.anim || 'solid',
      colA: sh.colA || '#ffffff',
      colB: sh.colB || '#000000',
      speed: Number.isFinite(sh.speed) ? sh.speed : 1,
      bright: Number.isFinite(sh.bright) ? sh.bright : 1,
      visible: sh.visible !== false,
    }));
  return s;
}

export function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? normalizeState(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}

export function saveState(state) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (err) {
    console.warn('Projekt se nepodařilo uložit do prohlížeče:', err);
  }
}
