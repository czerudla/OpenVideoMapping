// Sdílené pomocné funkce stavových animací (`sim`). Není to animace, proto leží mimo js/animations/.
// Funkce jsou čisté a deterministické, s výstupním polem `out` nealokují.

export const SIM_FORMATS = ['r8', 'rgba8', 'rgba32f'];
export const MAX_GRID = 256;

// Deterministický generátor náhodných čísel (mulberry32), vrací funkci () => [0, 1).
export function createRandom(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Ohraničující obdélník bodů v prostoru obsahu: [x0, y0, x1, y1].
function bounds(points) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of points) {
    x0 = Math.min(x0, x); x1 = Math.max(x1, x);
    y0 = Math.min(y0, y); y1 = Math.max(y1, y);
  }
  return [x0, y0, x1, y1];
}

// Rozměry mřížky se čtvercovými buňkami přes ohraničující obdélník oblasti,
// `longSide` buněk na delší straně (nejvýše MAX_GRID).
export function gridSize(points, aspect, longSide) {
  const [x0, y0, x1, y1] = bounds(points);
  const bw = Math.max((x1 - x0) * aspect, 1e-3);
  const bh = Math.max(y1 - y0, 1e-3);
  const long = Math.max(1, Math.min(MAX_GRID, Math.round(longSide)));
  const k = long / Math.max(bw, bh);
  return {
    w: Math.max(1, Math.min(long, Math.round(bw * k))),
    h: Math.max(1, Math.min(long, Math.round(bh * k))),
  };
}

// Zapíše do `out` (Uint8Array w*h) 1 pro buňky, jejichž střed leží uvnitř polygonu (sudo-liché pravidlo), jinak 0.
// Mřížka se natahuje přes ohraničující obdélník oblasti, tedy stejně jako `vLocal` ve shaderu
// (řádek 0 odpovídá nejmenšímu y). Parametr `aspect` je jen kvůli jednotnému rozhraní s gridSize.
export function polygonMask(points, aspect, w, h, out = new Uint8Array(w * h)) {
  const [x0, y0, x1, y1] = bounds(points);
  const bw = Math.max(x1 - x0, 1e-6);
  const bh = Math.max(y1 - y0, 1e-6);
  const n = points.length;
  for (let j = 0; j < h; j++) {
    const py = y0 + ((j + 0.5) / h) * bh;
    for (let i = 0; i < w; i++) {
      const px = x0 + ((i + 0.5) / w) * bw;
      let inside = false;
      for (let a = 0, b = n - 1; a < n; b = a++) {
        const ya = points[a][1], yb = points[b][1];
        if ((ya > py) !== (yb > py)) {
          const xc = points[a][0] + ((py - ya) / (yb - ya)) * (points[b][0] - points[a][0]);
          if (px < xc) inside = !inside;
        }
      }
      out[j * w + i] = inside ? 1 : 0;
    }
  }
  return out;
}

// Označí (1) buňky uvnitř masky, které sousedí (4-okolí) s buňkou mimo masku nebo s okrajem mřížky.
export function boundaryCells(mask, w, h, out = new Uint8Array(w * h)) {
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      out[i] = mask[i] && (x === 0 || y === 0 || x === w - 1 || y === h - 1
        || !mask[i - 1] || !mask[i + 1] || !mask[i - w] || !mask[i + w]) ? 1 : 0;
    }
  }
  return out;
}
