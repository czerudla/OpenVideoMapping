// Editor: kreslení oblastí, úpravy bodů, warp, synchronizace s výstupem.
import { Renderer } from './renderer.js';
import { ANIMATIONS, getAnimation } from './animations.js';
import { squareToQuad, invert3, applyH, isConvexQuad } from './homography.js';
import {
  CHANNEL_NAME, uid, createDefaultState, normalizeState, loadState, saveState,
} from './state.js';

const $ = (id) => document.getElementById(id);

// ---------- stav ----------
let state = loadState() ?? createDefaultState();
let tool = 'select';
let selectedId = null;
let drawing = [];            // body rozpracovaného tvaru (souřadnice obsahu 0–1)
let drag = null;             // probíhající tažení
let mouse = null;            // poslední pozice myši v px plátna
let hoverVertex = null;      // { shapeId, index }
let H = null, Hinv = null;   // obsah → obrazovka (0–1) a zpět

const undoStack = [];
const redoStack = [];

const channel = new BroadcastChannel(CHANNEL_NAME);
let outputSeen = 0;
let outputWin = null;

const PALETTE = ['#f2a93b', '#3ba7f2', '#e5484d', '#46c28e', '#b07cf2', '#f2e23b', '#f27cc0'];

// ---------- elementy ----------
const stageWrap = $('stage-wrap');
const stage = $('stage');
const overlay = $('overlay');
const octx = overlay.getContext('2d');
let renderer;
try {
  renderer = new Renderer($('gl'));
} catch (err) {
  $('hint-text').textContent = `${err.message} Použijte aktuální Chrome, Edge nebo Firefox.`;
  throw err;
}

// ---------- ukládání a synchronizace ----------
let saveTimer = null;
function commit() {
  channel.postMessage({ type: 'state', state });
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => saveState(state), 250);
}

function snapshot() {
  undoStack.push(JSON.stringify(state));
  if (undoStack.length > 100) undoStack.shift();
  redoStack.length = 0;
}

function restore(json) {
  state = normalizeState(JSON.parse(json));
  if (!state.shapes.some((s) => s.id === selectedId)) selectedId = null;
  afterStructureChange();
}

function undo() {
  if (!undoStack.length) return;
  redoStack.push(JSON.stringify(state));
  restore(undoStack.pop());
}

function redo() {
  if (!redoStack.length) return;
  undoStack.push(JSON.stringify(state));
  restore(redoStack.pop());
}

channel.onmessage = (e) => {
  const msg = e.data;
  if (!msg) return;
  if (msg.type === 'hello') commit();
  if (msg.type === 'screen') {
    outputSeen = Date.now();
    if (msg.fullscreen && (msg.w !== state.resolution.w || msg.h !== state.resolution.h)) {
      state.resolution = { w: msg.w, h: msg.h };
      layoutStage();
      updateProjectInfo();
      commit();
    }
  }
};

setInterval(() => {
  const on = Date.now() - outputSeen < 5000;
  const el = $('out-status');
  el.classList.toggle('on', on);
  el.textContent = on ? 'Výstup připojen' : 'Výstup není připojen';
}, 1000);

// ---------- geometrie ----------
function updateH() {
  H = squareToQuad(state.corners);
  Hinv = invert3(H);
}

function stageSize() {
  return { w: stage.clientWidth, h: stage.clientHeight };
}

function toScreen([x, y]) {
  const { w, h } = stageSize();
  const [sx, sy] = applyH(H, x, y);
  return [sx * w, sy * h];
}

function toContent([px, py]) {
  const { w, h } = stageSize();
  if (!Hinv) return [0, 0];
  return applyH(Hinv, px / w, py / h);
}

const clamp01 = (v) => Math.min(1, Math.max(0, v));
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);

function pointInPolygon([x, y], pts) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i], [xj, yj] = pts[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function distToSegment(p, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy;
  let t = len2 ? ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2 : 0;
  t = Math.max(0, Math.min(1, t));
  return dist(p, [a[0] + t * dx, a[1] + t * dy]);
}

const selectedShape = () => state.shapes.find((s) => s.id === selectedId) ?? null;

function hitVertex(pos) {
  const order = [...state.shapes].reverse();
  const sel = selectedShape();
  if (sel) order.unshift(sel);
  for (const s of order) {
    for (let i = 0; i < s.points.length; i++) {
      if (dist(toScreen(s.points[i]), pos) < 9) return { shapeId: s.id, index: i };
    }
  }
  return null;
}

function hitShape(pos) {
  const c = toContent(pos);
  for (let i = state.shapes.length - 1; i >= 0; i--) {
    if (pointInPolygon(c, state.shapes[i].points)) return state.shapes[i];
  }
  return null;
}

function hitCorner(pos) {
  const { w, h } = stageSize();
  for (let i = 0; i < 4; i++) {
    const [x, y] = state.corners[i];
    if (dist([x * w, y * h], pos) < 16) return i;
  }
  return -1;
}

// ---------- rozvržení plátna ----------
function layoutStage() {
  const style = getComputedStyle(stageWrap);
  const availW = stageWrap.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
  const availH = stageWrap.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom);
  const aspect = state.resolution.w / state.resolution.h;
  let w = availW, h = w / aspect;
  if (h > availH) { h = availH; w = h * aspect; }
  stage.style.width = `${Math.max(1, Math.floor(w))}px`;
  stage.style.height = `${Math.max(1, Math.floor(h))}px`;
  const dpr = window.devicePixelRatio || 1;
  overlay.width = Math.round(Math.floor(w) * dpr);
  overlay.height = Math.round(Math.floor(h) * dpr);
}
new ResizeObserver(layoutStage).observe(stageWrap);

// ---------- nástroje ----------
const HINTS = {
  select: 'Tažením posunete bod nebo celou oblast. Dvojklik na hranu přidá bod, pravé tlačítko bod odebere. Šipky posouvají, Delete maže.',
  draw: 'Klikáním přidávejte body. Tvar uzavřete kliknutím na první bod nebo klávesou Enter. Backspace vrátí bod, Esc zruší.',
  warp: 'Přetáhněte rohy tak, aby kalibrační mřížka seděla na promítanou plochu. Oblasti se deformují s ní.',
};

function setTool(t) {
  if (tool === 'draw' && t !== 'draw') drawing = [];
  tool = t;
  document.querySelectorAll('.tool').forEach((b) =>
    b.setAttribute('aria-checked', String(b.dataset.tool === t)));
  $('hint-text').textContent = HINTS[t];
  overlay.style.cursor = t === 'draw' ? 'crosshair' : 'default';
}

function finishDrawing() {
  if (drawing.length < 3) return;
  snapshot();
  const n = state.shapes.length;
  const shape = {
    id: uid(),
    name: `Oblast ${n + 1}`,
    points: drawing,
    anim: 'pulse',
    colA: PALETTE[n % PALETTE.length],
    colB: '#000000',
    speed: 1,
    bright: 1,
    visible: true,
  };
  state.shapes.push(shape);
  drawing = [];
  selectedId = shape.id;
  setTool('select');
  afterStructureChange();
}

// ---------- myš ----------
function localPos(e) {
  const r = overlay.getBoundingClientRect();
  return [e.clientX - r.left, e.clientY - r.top];
}

overlay.addEventListener('pointerdown', (e) => {
  if (e.button !== 0) return;
  overlay.focus();
  const pos = localPos(e);
  mouse = pos;

  if (tool === 'warp') {
    const i = hitCorner(pos);
    if (i >= 0) {
      snapshot();
      drag = { type: 'corner', index: i, last: [...state.corners[i]] };
      overlay.setPointerCapture(e.pointerId);
    }
    return;
  }

  if (tool === 'draw') {
    if (drawing.length >= 3 && dist(toScreen(drawing[0]), pos) < 12) {
      finishDrawing();
      return;
    }
    const [x, y] = toContent(pos);
    if (x < 0 || x > 1 || y < 0 || y > 1) return; // kreslí se jen uvnitř plochy warpu
    drawing.push([x, y]);
    return;
  }

  // výběr
  const v = hitVertex(pos);
  if (v) {
    snapshot();
    selectShape(v.shapeId);
    drag = { type: 'vertex', ...v };
    overlay.setPointerCapture(e.pointerId);
    return;
  }
  const s = hitShape(pos);
  if (s) {
    snapshot();
    selectShape(s.id);
    drag = { type: 'shape', id: s.id, start: toContent(pos), orig: s.points.map((p) => [...p]) };
    overlay.setPointerCapture(e.pointerId);
    return;
  }
  selectShape(null);
});

overlay.addEventListener('pointermove', (e) => {
  const pos = localPos(e);
  mouse = pos;

  if (!drag) {
    if (tool === 'select') {
      hoverVertex = hitVertex(pos);
      overlay.style.cursor = hoverVertex ? 'pointer' : hitShape(pos) ? 'move' : 'default';
    } else if (tool === 'warp') {
      overlay.style.cursor = hitCorner(pos) >= 0 ? 'grab' : 'default';
    }
    return;
  }

  if (drag.type === 'corner') {
    const { w, h } = stageSize();
    const next = state.corners.map((c) => [...c]);
    next[drag.index] = [pos[0] / w, pos[1] / h];
    if (isConvexQuad(next)) {        // nekonvexní warp nepustíme
      state.corners = next;
      updateH();
      commit();
    }
    return;
  }

  if (drag.type === 'vertex') {
    const s = state.shapes.find((sh) => sh.id === drag.shapeId);
    const [x, y] = toContent(pos);
    s.points[drag.index] = [clamp01(x), clamp01(y)];
    commit();
    return;
  }

  if (drag.type === 'shape') {
    const s = state.shapes.find((sh) => sh.id === drag.id);
    const c = toContent(pos);
    moveShape(s, drag.orig, c[0] - drag.start[0], c[1] - drag.start[1]);
    commit();
  }
});

function moveShape(shape, orig, dx, dy) {
  const xs = orig.map((p) => p[0]), ys = orig.map((p) => p[1]);
  dx = Math.min(1 - Math.max(...xs), Math.max(-Math.min(...xs), dx));
  dy = Math.min(1 - Math.max(...ys), Math.max(-Math.min(...ys), dy));
  shape.points = orig.map(([x, y]) => [x + dx, y + dy]);
}

function endDrag() {
  if (drag) {
    drag = null;
    saveState(state);
  }
}
overlay.addEventListener('pointerup', endDrag);
overlay.addEventListener('pointercancel', endDrag);
overlay.addEventListener('pointerleave', () => { if (!drag) mouse = null; });

overlay.addEventListener('dblclick', (e) => {
  if (tool !== 'select') return;
  const s = selectedShape();
  if (!s) return;
  const pos = localPos(e);
  const pts = s.points.map(toScreen);
  for (let i = 0; i < pts.length; i++) {
    const j = (i + 1) % pts.length;
    if (distToSegment(pos, pts[i], pts[j]) < 8) {
      snapshot();
      const [x, y] = toContent(pos);
      s.points.splice(j, 0, [clamp01(x), clamp01(y)]);
      commit();
      return;
    }
  }
});

overlay.addEventListener('contextmenu', (e) => {
  e.preventDefault();
  if (tool === 'draw') { drawing.pop(); return; }
  const v = hitVertex(localPos(e));
  if (!v) return;
  const s = state.shapes.find((sh) => sh.id === v.shapeId);
  if (s.points.length <= 3) return;
  snapshot();
  s.points.splice(v.index, 1);
  hoverVertex = null;
  commit();
});

// ---------- klávesnice ----------
document.addEventListener('keydown', (e) => {
  const inField = e.target.matches('input, select, textarea');
  const mod = e.ctrlKey || e.metaKey;

  if (mod && e.key.toLowerCase() === 'z' && !inField) {
    e.preventDefault();
    if (e.shiftKey) redo(); else undo();
    return;
  }
  if (mod && e.key.toLowerCase() === 'y' && !inField) { e.preventDefault(); redo(); return; }
  if (mod && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'd' && !inField && selectedShape()) {
    e.preventDefault();
    duplicateSelected();
    return;
  }
  if (inField || mod || e.altKey) return;

  switch (e.key) {
    case 'v': case 'V': setTool('select'); break;
    case 'd': case 'D': setTool('draw'); break;
    case 'w': case 'W': setTool('warp'); break;
    case 'b': case 'B': toggleBlackout(); break;
    case 'c': case 'C': toggleCalibration(); break;
    case 'Enter': if (tool === 'draw') finishDrawing(); break;
    case 'Escape':
      if (tool === 'draw') { drawing = []; setTool('select'); } else selectShape(null);
      break;
    case 'Backspace':
      if (tool === 'draw') { e.preventDefault(); drawing.pop(); break; }
      if (selectedShape()) { e.preventDefault(); deleteSelected(); }
      break;
    case 'Delete':
      if (selectedShape()) deleteSelected();
      break;
    case 'ArrowLeft': case 'ArrowRight': case 'ArrowUp': case 'ArrowDown': {
      const s = selectedShape();
      if (!s || tool !== 'select') break;
      e.preventDefault();
      const step = (e.shiftKey ? 10 : 1) / state.resolution.w;
      const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
      const dy = (e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0)
        * (state.resolution.w / state.resolution.h);
      snapshot();
      if (hoverVertex && hoverVertex.shapeId === s.id) {
        const p = s.points[hoverVertex.index];
        s.points[hoverVertex.index] = [clamp01(p[0] + dx), clamp01(p[1] + dy)];
      } else {
        moveShape(s, s.points.map((p) => [...p]), dx, dy);
      }
      commit();
      break;
    }
    default: break;
  }
});

// ---------- panel oblastí ----------
function selectShape(id) {
  if (selectedId === id) return;
  selectedId = id;
  renderShapeList();
  renderProps();
}

function afterStructureChange() {
  updateH();
  layoutStage();
  renderShapeList();
  renderProps();
  updateToggles();
  updateProjectInfo();
  commit();
}

function renderShapeList() {
  const list = $('shape-list');
  list.innerHTML = '';
  $('shape-empty').hidden = state.shapes.length > 0;
  // nahoře je oblast vykreslená nejpozději (leží navrchu)
  [...state.shapes].reverse().forEach((s) => {
    const li = document.createElement('li');
    li.className = 'shape-item';
    if (s.id === selectedId) li.classList.add('selected');
    if (!s.visible) li.classList.add('hidden-shape');

    const sw = document.createElement('span');
    sw.className = 'swatch';
    sw.style.background = getAnimation(s.anim).colors ? s.colA
      : 'linear-gradient(90deg,#e5484d,#f2e23b,#46c28e,#3ba7f2,#b07cf2)';
    const name = document.createElement('span');
    name.className = 'name';
    name.textContent = s.name;

    const mk = (label, title, fn) => {
      const b = document.createElement('button');
      b.className = 'icon-btn';
      b.textContent = label;
      b.title = title;
      b.setAttribute('aria-label', title);
      b.addEventListener('click', (e) => { e.stopPropagation(); fn(); });
      return b;
    };
    const idx = state.shapes.indexOf(s);
    li.append(
      sw, name,
      mk('▲', 'Posunout dopředu', () => reorder(idx, idx + 1)),
      mk('▼', 'Posunout dozadu', () => reorder(idx, idx - 1)),
      mk(s.visible ? '●' : '○', s.visible ? 'Skrýt' : 'Zobrazit', () => {
        snapshot();
        s.visible = !s.visible;
        renderShapeList();
        commit();
      }),
    );
    li.addEventListener('click', () => selectShape(s.id));
    list.append(li);
  });
}

function reorder(from, to) {
  if (to < 0 || to >= state.shapes.length) return;
  snapshot();
  const [s] = state.shapes.splice(from, 1);
  state.shapes.splice(to, 0, s);
  renderShapeList();
  commit();
}

function deleteSelected() {
  const i = state.shapes.findIndex((s) => s.id === selectedId);
  if (i < 0) return;
  snapshot();
  state.shapes.splice(i, 1);
  selectedId = null;
  hoverVertex = null;
  afterStructureChange();
}

// ---------- panel vlastností ----------
const animSelect = $('p-anim');
for (const a of ANIMATIONS) {
  const o = document.createElement('option');
  o.value = a.id;
  o.textContent = a.name;
  animSelect.append(o);
}

function renderProps() {
  const s = selectedShape();
  $('props').hidden = !s;
  if (!s) return;
  $('p-name').value = s.name;
  animSelect.value = s.anim;
  $('p-colA').value = s.colA;
  $('p-colB').value = s.colB;
  $('p-speed').value = s.speed;
  $('p-bright').value = s.bright;
  $('o-speed').textContent = `${Number(s.speed).toFixed(2)}×`;
  $('o-bright').textContent = `${Math.round(s.bright * 100)} %`;
  const colors = getAnimation(s.anim).colors;
  $('f-colA').hidden = colors < 1;
  $('f-colB').hidden = colors < 2;
}

// Jeden krok zpět pro celou úpravu jednoho pole (ne pro každý pohyb posuvníku).
function bindProp(id, key, parse = (v) => v, rerenderList = false) {
  const el = $(id);
  let snapped = false;
  el.addEventListener('focus', () => { snapped = false; });
  el.addEventListener('input', () => {
    const s = selectedShape();
    if (!s) return;
    if (!snapped) { snapshot(); snapped = true; }
    s[key] = parse(el.value);
    if (key === 'speed') $('o-speed').textContent = `${s.speed.toFixed(2)}×`;
    if (key === 'bright') $('o-bright').textContent = `${Math.round(s.bright * 100)} %`;
    if (rerenderList) renderShapeList();
    commit();
  });
  el.addEventListener('change', () => { snapped = false; });
}
bindProp('p-name', 'name', (v) => v || 'Oblast', true);
bindProp('p-colA', 'colA', String, true);
bindProp('p-colB', 'colB');
bindProp('p-speed', 'speed', Number);
bindProp('p-bright', 'bright', Number);
animSelect.addEventListener('change', () => {
  const s = selectedShape();
  if (!s) return;
  snapshot();
  s.anim = animSelect.value;
  renderProps();
  renderShapeList();
  commit();
});

function duplicateSelected() {
  const s = selectedShape();
  if (!s) return;
  snapshot();
  const copy = { ...s, id: uid(), name: `${s.name} (kopie)`, points: s.points.map((p) => [...p]) };
  moveShape(copy, copy.points, 0.02, 0.02);
  state.shapes.push(copy);
  selectedId = copy.id;
  afterStructureChange();
}
$('btn-dup').addEventListener('click', duplicateSelected);
$('btn-del').addEventListener('click', deleteSelected);
$('btn-new-shape').addEventListener('click', () => setTool('draw'));

// ---------- horní lišta ----------
document.querySelectorAll('.tool').forEach((b) =>
  b.addEventListener('click', () => setTool(b.dataset.tool)));

function updateToggles() {
  $('btn-blackout').setAttribute('aria-pressed', String(state.blackout));
  $('btn-calibration').setAttribute('aria-pressed', String(state.calibration));
}
function toggleBlackout() { state.blackout = !state.blackout; updateToggles(); commit(); }
function toggleCalibration() { state.calibration = !state.calibration; updateToggles(); commit(); }
$('btn-blackout').addEventListener('click', toggleBlackout);
$('btn-calibration').addEventListener('click', toggleCalibration);

$('btn-output').addEventListener('click', async () => {
  if (outputWin && !outputWin.closed) { outputWin.focus(); return; }
  let features = 'popup,width=960,height=540';
  // Window Management API: otevřeme okno rovnou na druhém displeji (Chrome/Edge).
  if ('getScreenDetails' in window) {
    try {
      const details = await window.getScreenDetails();
      const other = details.screens.find((s) => s !== details.currentScreen);
      if (other) {
        features = `popup,left=${other.availLeft},top=${other.availTop},`
          + `width=${other.availWidth},height=${other.availHeight}`;
      }
    } catch { /* uživatel oprávnění nepovolil – okno se otevře na hlavním displeji */ }
  }
  outputWin = window.open('output.html', 'videomapping-output', features);
  if (!outputWin) $('hint-text').textContent = 'Prohlížeč zablokoval nové okno. Povolte vyskakovací okna pro tuto stránku.';
});

// ---------- projekt ----------
function updateProjectInfo() {
  $('res').textContent = `${state.resolution.w} × ${state.resolution.h} px`;
}

$('btn-export').addEventListener('click', () => {
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'videomapping-projekt.json';
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
});
$('btn-import').addEventListener('click', () => $('file-import').click());
$('file-import').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    snapshot();
    state = normalizeState(data);
    selectedId = null;
    afterStructureChange();
  } catch {
    $('hint-text').textContent = 'Soubor není platný projekt (očekává se JSON uložený z tohoto editoru).';
  }
});
$('btn-reset-warp').addEventListener('click', () => {
  snapshot();
  state.corners = [[0, 0], [1, 0], [1, 1], [0, 1]];
  afterStructureChange();
});
$('btn-clear').addEventListener('click', () => {
  if (!confirm('Smazat všechny oblasti a warp? Krok lze vrátit přes Ctrl+Z.')) return;
  snapshot();
  const res = state.resolution;
  state = createDefaultState();
  state.resolution = res;
  selectedId = null;
  afterStructureChange();
});

// ---------- PJLink (přes lokální most server/serve.js) ----------
const pjHost = $('pj-host');
const pjPass = $('pj-pass');
pjHost.value = localStorage.getItem('videomapping.pjhost') || '';
pjHost.addEventListener('change', () => localStorage.setItem('videomapping.pjhost', pjHost.value.trim()));

async function pjlink(command, label) {
  const status = $('pj-status');
  const host = pjHost.value.trim();
  if (!host) { status.textContent = 'Zadejte IP adresu projektoru.'; return; }
  status.textContent = 'Odesílám…';
  try {
    const res = await fetch('/api/pjlink', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ host, password: pjPass.value, command }),
    });
    if (res.status === 404) throw new Error('Most PJLink neběží. Spusťte editor přes npm start.');
    const data = await res.json();
    if (!data.ok) throw new Error(data.error);
    status.textContent = data.response.endsWith('=OK')
      ? `${label}.`
      : `Projektor odpověděl: ${data.response}`;
  } catch (err) {
    status.textContent = err.message === 'Failed to fetch'
      ? 'Most PJLink neběží. Spusťte editor přes npm start.'
      : err.message;
  }
}
$('pj-close').addEventListener('click', () => pjlink('AVMT 31', 'Závěrka zavřena'));
$('pj-open').addEventListener('click', () => pjlink('AVMT 30', 'Závěrka otevřena'));

// ---------- překryvná vrstva ----------
function drawOverlay() {
  const dpr = window.devicePixelRatio || 1;
  const { w, h } = stageSize();
  octx.setTransform(dpr, 0, 0, dpr, 0, 0);
  octx.clearRect(0, 0, w, h);
  const amber = '#f2a93b';

  // obrys plochy warpu
  octx.beginPath();
  state.corners.forEach(([x, y], i) => (i ? octx.lineTo(x * w, y * h) : octx.moveTo(x * w, y * h)));
  octx.closePath();
  octx.setLineDash([6, 6]);
  octx.strokeStyle = tool === 'warp' ? 'rgba(242,169,59,0.8)' : 'rgba(255,255,255,0.18)';
  octx.lineWidth = 1;
  octx.stroke();
  octx.setLineDash([]);

  // oblasti
  for (const s of state.shapes) {
    const pts = s.points.map(toScreen);
    const sel = s.id === selectedId;
    octx.beginPath();
    pts.forEach(([x, y], i) => (i ? octx.lineTo(x, y) : octx.moveTo(x, y)));
    octx.closePath();
    octx.strokeStyle = sel ? amber : s.visible ? 'rgba(255,255,255,0.45)' : 'rgba(255,255,255,0.2)';
    octx.lineWidth = sel ? 2 : 1;
    if (!s.visible) octx.setLineDash([4, 4]);
    octx.stroke();
    octx.setLineDash([]);

    if (sel && tool === 'select') {
      pts.forEach(([x, y], i) => {
        const hot = hoverVertex && hoverVertex.shapeId === s.id && hoverVertex.index === i;
        octx.fillStyle = hot ? amber : '#000';
        octx.strokeStyle = amber;
        octx.lineWidth = 1.5;
        octx.fillRect(x - 4.5, y - 4.5, 9, 9);
        octx.strokeRect(x - 4.5, y - 4.5, 9, 9);
      });
    }
  }

  // rozpracovaný tvar
  if (tool === 'draw' && drawing.length) {
    const pts = drawing.map(toScreen);
    octx.beginPath();
    pts.forEach(([x, y], i) => (i ? octx.lineTo(x, y) : octx.moveTo(x, y)));
    if (mouse) octx.lineTo(mouse[0], mouse[1]);
    octx.strokeStyle = amber;
    octx.lineWidth = 1.5;
    octx.stroke();
    const nearFirst = mouse && drawing.length >= 3 && dist(pts[0], mouse) < 12;
    pts.forEach(([x, y], i) => {
      octx.beginPath();
      octx.arc(x, y, i === 0 ? (nearFirst ? 8 : 6) : 3.5, 0, Math.PI * 2);
      octx.fillStyle = i === 0 && nearFirst ? amber : '#000';
      octx.fill();
      octx.strokeStyle = amber;
      octx.stroke();
    });
  }

  // rohy warpu
  if (tool === 'warp') {
    const labels = ['LH', 'PH', 'PD', 'LD'];
    state.corners.forEach(([x, y], i) => {
      const px = x * w, py = y * h;
      octx.beginPath();
      octx.arc(px, py, 10, 0, Math.PI * 2);
      octx.fillStyle = drag?.type === 'corner' && drag.index === i ? amber : 'rgba(0,0,0,0.7)';
      octx.fill();
      octx.strokeStyle = amber;
      octx.lineWidth = 2;
      octx.stroke();
      octx.fillStyle = '#dde1e8';
      octx.font = '500 11px Barlow, system-ui, sans-serif';
      octx.textAlign = px < w / 2 ? 'left' : 'right';
      octx.textBaseline = py < h / 2 ? 'top' : 'bottom';
      octx.fillText(labels[i], px + (px < w / 2 ? 14 : -14), py + (py < h / 2 ? 12 : -12));
    });
  }
}

// ---------- smyčka ----------
function frame() {
  renderer.render(state);
  drawOverlay();
  requestAnimationFrame(frame);
}

updateH();
setTool('select');
afterStructureChange();
requestAnimationFrame(frame);
