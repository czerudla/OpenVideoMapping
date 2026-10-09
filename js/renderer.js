// WebGL2 renderer sdílený editorem (náhled) i výstupním oknem (projektor).
// Oblast se maskuje stencil bufferem: polygon se vykreslí jako trojúhelníkový
// vějíř s operací INVERT (sudo-lichá výplň, funguje i pro konkávní tvary),
// pak se animace kreslí jen tam, kde je stencil = 1. Mimo oblasti zůstává RGB 0,0,0.

import { VERTEX_SHADER, CALIBRATION_GLSL, MAX_DATA, buildFragment } from './shaders.js';
import { ANIMATIONS } from './animations/index.js';
import { squareToQuad, mul3, toColumnMajor } from './homography.js';

// Normalizované souřadnice obrazovky (0–1, y dolů) → clip space WebGL.
const TO_CLIP = [2, 0, -1, 0, -2, 1, 0, 0, 1];

// Musí odpovídat MAX_POLY v FRAGMENT_HEADER.
const MAX_POLY = 64;

// Omezení stavové simulace (`sim`): největší mřížka a čas na simulaci všech oblastí za snímek.
const MAX_SIM_SIZE = 256;
const SIM_BUDGET_MS = 4;

// Otisk textu (FNV-1a), z něj se odvozuje seed simulace.
function hashString(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 0x01000193);
  return h >>> 0;
}

function hexToRgb(hex) {
  const n = parseInt(String(hex).replace('#', ''), 16) || 0;
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    const gl = canvas.getContext('webgl2', {
      antialias: true, stencil: true, alpha: false, depth: false,
      powerPreference: 'high-performance',
    });
    if (!gl) throw new Error('Prohlížeč nepodporuje WebGL2.');
    this.gl = gl;
    this.programs = new Map();
    this.polyCache = new WeakMap();
    this.polyWarned = false;
    this.precomputed = new Map(); // shape.id → { key, data, count }
    this.sims = new Map(); // shape.id → stav simulace oblasti (viz prepareSim)
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    this.dummyTex = this.createStateTexture(1, 1);
    this.buffer = gl.createBuffer();
    this.vao = gl.createVertexArray();
    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    this.vs = this.compile(gl.VERTEX_SHADER, VERTEX_SHADER);
    this.program('solid');
    this.program('__calibration');
  }

  compile(type, src) {
    const gl = this.gl;
    const sh = gl.createShader(type);
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
      const log = gl.getShaderInfoLog(sh);
      gl.deleteShader(sh);
      throw new Error(log);
    }
    return sh;
  }

  program(id) {
    if (this.programs.has(id)) return this.programs.get(id);
    const gl = this.gl;
    const anim = id === '__calibration' ? null : ANIMATIONS.find((a) => a.id === id);
    if (id !== '__calibration' && !anim) {
      console.error(`Animace „${id}“ neexistuje, použije se plná barva.`);
      const fallback = id === 'solid' ? null : this.program('solid');
      this.programs.set(id, fallback);
      return fallback;
    }
    const body = anim ? anim.glsl : CALIBRATION_GLSL;
    let entry = null;
    try {
      const fs = this.compile(gl.FRAGMENT_SHADER, buildFragment(body));
      const p = gl.createProgram();
      gl.attachShader(p, this.vs);
      gl.attachShader(p, fs);
      gl.bindAttribLocation(p, 0, 'aPos');
      gl.linkProgram(p);
      if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
      const u = {};
      for (const name of ['uH', 'uBBox', 'uTime', 'uBright', 'uAspect', 'uColA', 'uColB', 'uPoly', 'uPolyCount', 'uDataCount', 'uStateSize', 'uStateFrac'])
        u[name] = gl.getUniformLocation(p, name);
      u.uData = gl.getUniformLocation(p, 'uData');
      u.uState = gl.getUniformLocation(p, 'uState');
      entry = { p, u };
    } catch (err) {
      console.error(`Shader „${id}“ se nepodařilo zkompilovat:`, err);
      entry = id === 'solid' ? null : this.program('solid');
    }
    this.programs.set(id, entry);
    return entry;
  }

  // Předkompiluje programy animací použitých v projektu; volat mimo render().
  prepare(state) {
    const aspect = state.resolution.w / state.resolution.h;
    const alive = new Set();
    for (const shape of state.shapes) {
      this.program(shape.anim);
      this.polyData(shape);
      alive.add(shape.id);
      this.precompute(shape, aspect);
      this.prepareSim(shape, aspect);
    }
    for (const id of this.precomputed.keys()) if (!alive.has(id)) this.precomputed.delete(id);
    for (const id of [...this.sims.keys()]) if (!alive.has(id)) this.dropSim(id);
  }

  createStateTexture(w, h) {
    const gl = this.gl;
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texStorage2D(gl.TEXTURE_2D, 1, gl.R8, w, h);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return tex;
  }

  dropSim(id) {
    const st = this.sims.get(id);
    if (st?.tex) this.gl.deleteTexture(st.tex);
    this.sims.delete(id);
  }

  // Připraví stav volitelné simulace animace (`sim`): mřížku, dvě pole a texturu.
  // Vše se alokuje tady (při změně bodů, animace nebo poměru stran), nikdy v render().
  prepareSim(shape, aspect) {
    const sim = ANIMATIONS.find((a) => a.id === shape.anim)?.sim;
    if (!sim) {
      this.dropSim(shape.id);
      return;
    }
    const key = `${shape.anim}|${aspect}|${shape.points.join(';')}`;
    if (this.sims.get(shape.id)?.key === key) return;
    this.dropSim(shape.id);
    const st = { key, sim, failed: true, w: 0, h: 0, a: null, b: null, tex: null, step: 0, cycle: -1, frac: 0, points: null, seedBase: hashString(key), aspect };
    this.sims.set(shape.id, st);
    try {
      const points = shape.points.map((p) => [p[0], p[1]]);
      const size = sim.size(points, aspect);
      const w = size?.w, h = size?.h;
      if (!Number.isInteger(w) || !Number.isInteger(h) || w < 1 || h < 1 || w > MAX_SIM_SIZE || h > MAX_SIM_SIZE) {
        throw new Error(`size() musí vrátit celá čísla w a h v rozsahu 1–${MAX_SIM_SIZE}`);
      }
      st.w = w;
      st.h = h;
      st.a = new Uint8Array(w * h);
      st.b = new Uint8Array(w * h);
      st.tex = this.createStateTexture(w, h);
      st.points = points;
      st.failed = false;
    } catch (err) {
      console.error(`Simulace animace „${shape.anim}“ se nepodařila připravit, oblast se vykreslí bez ní:`, err);
    }
  }

  // Dopočítá stav simulace oblasti na krok odpovídající času t (v sekundách, včetně rychlosti)
  // a nahraje ho do textury. Krokuje jen do `deadline` (performance.now()), zbytek se dohoní
  // v dalších snímcích. Vrací true, pokud je simulace použitelná.
  advanceSim(shape, st, t, deadline) {
    if (st.failed) return false;
    const { sim } = st;
    const pos = Math.max(0, t * sim.stepsPerSecond);
    if (!Number.isFinite(pos)) return true;
    const target = Math.floor(pos);
    const cycle = Math.floor(target / sim.stepsPerCycle);
    const cycleStart = cycle * sim.stepsPerCycle;
    let dirty = false;
    try {
      if (st.cycle !== cycle || st.step < cycleStart || st.step > target) {
        const seed = (st.seedBase ^ Math.imul(cycle + 1, 0x9e3779b1)) >>> 0;
        st.a.fill(0);
        sim.init(st.a, st.w, st.h, seed, st.points, st.aspect);
        st.cycle = cycle;
        st.step = cycleStart;
        dirty = true;
      }
      while (st.step < target && performance.now() < deadline) {
        sim.step(st.a, st.b, st.w, st.h, st.step - cycleStart);
        const tmp = st.a; st.a = st.b; st.b = tmp;
        st.step++;
        dirty = true;
      }
    } catch (err) {
      st.failed = true;
      console.error(`Simulace animace „${shape.anim}“ selhala a byla pro oblast vypnuta:`, err);
      return false;
    }
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, st.tex);
    if (dirty) gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, st.w, st.h, gl.RED, gl.UNSIGNED_BYTE, st.a);
    st.frac = st.step === target ? pos - target : 0;
    return true;
  }

  // Vrcholy oblasti pro uniformu uPoly. Pole se vytváří jednou pro oblast,
  // dál se jen přepisuje (render() nealokuje). Nad MAX_POLY bodů se bere každý k-tý.
  polyData(shape) {
    let entry = this.polyCache.get(shape);
    if (!entry) {
      entry = { arr: new Float32Array(MAX_POLY * 2), count: 0 };
      this.polyCache.set(shape, entry);
    }
    const pts = shape.points;
    const step = Math.max(1, Math.ceil(pts.length / MAX_POLY));
    if (step > 1 && !this.polyWarned) {
      this.polyWarned = true;
      console.info(`Oblast má ${pts.length} bodů, shaderu se kvůli limitu ${MAX_POLY} pošle zjednodušený tvar (každý ${step}. bod). Maska zůstává přesná.`);
    }
    let c = 0;
    for (let i = 0; i < pts.length; i += step, c++) {
      entry.arr[c * 2] = pts[i][0];
      entry.arr[c * 2 + 1] = pts[i][1];
    }
    entry.count = c;
    return entry;
  }

  // Zavolá volitelný hook animace `precompute(points, aspect)`; výsledek cachuje podle
  // otisku bodů, animace a poměru stran. Chyba nebo neplatný výsledek = žádná data.
  precompute(shape, aspect) {
    const anim = ANIMATIONS.find((a) => a.id === shape.anim);
    if (typeof anim?.precompute !== 'function') {
      this.precomputed.delete(shape.id);
      return;
    }
    const key = `${shape.anim}|${aspect}|${shape.points.join(';')}`;
    if (this.precomputed.get(shape.id)?.key === key) return;
    const entry = { key, data: new Float32Array(MAX_DATA * 4), count: 0 };
    try {
      const out = anim.precompute(shape.points.map((p) => [p[0], p[1]]), aspect);
      if (!(out instanceof Float32Array) || out.length % 4 !== 0 || out.length > MAX_DATA * 4) {
        throw new Error(`musí vrátit Float32Array o délce násobku 4, nejvýše ${MAX_DATA * 4}`);
      }
      if (out.some((v) => !Number.isFinite(v))) throw new Error('výsledek obsahuje neplatné číslo');
      entry.data.set(out);
      entry.count = out.length / 4;
    } catch (err) {
      console.error(`Předvýpočet animace „${shape.anim}“ selhal, data se nepoužijí:`, err);
    }
    this.precomputed.set(shape.id, entry);
  }

  resize() {
    const dpr = window.devicePixelRatio || 1;
    const w = Math.max(1, Math.round(this.canvas.clientWidth * dpr));
    const h = Math.max(1, Math.round(this.canvas.clientHeight * dpr));
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
  }

  use(prog, H, aspect) {
    const gl = this.gl;
    gl.useProgram(prog.p);
    gl.uniformMatrix3fv(prog.u.uH, false, H);
    gl.uniform1f(prog.u.uAspect, aspect);
  }

  render(state, nowMs = Date.now()) {
    const gl = this.gl;
    this.resize();
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.clearColor(0, 0, 0, 1);
    gl.clearStencil(0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.STENCIL_BUFFER_BIT);
    if (state.blackout) return;

    const H = toColumnMajor(mul3(TO_CLIP, squareToQuad(state.corners)));
    const aspect = state.resolution.w / state.resolution.h;
    const time = (nowMs - state.startTime) / 1000;
    const simDeadline = performance.now() + SIM_BUDGET_MS;
    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);

    if (state.calibration) {
      const cal = this.program('__calibration');
      gl.disable(gl.STENCIL_TEST);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]), gl.DYNAMIC_DRAW);
      this.use(cal, H, aspect);
      gl.uniform4f(cal.u.uBBox, 0, 0, 1, 1);
      gl.uniform1f(cal.u.uTime, time);
      gl.uniform1f(cal.u.uBright, 1);
      gl.drawArrays(gl.TRIANGLE_FAN, 0, 4);
    }

    const solid = this.program('solid');
    for (const shape of state.shapes) {
      if (!shape.visible || shape.points.length < 3) continue;
      const n = shape.points.length;
      const simState = this.sims.get(shape.id);
      const simOk = simState ? this.advanceSim(shape, simState, time * shape.speed, simDeadline) : false;
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      const data = new Float32Array(n * 2 + 8);
      shape.points.forEach(([x, y], i) => {
        data[i * 2] = x; data[i * 2 + 1] = y;
        if (x < minX) minX = x; if (x > maxX) maxX = x;
        if (y < minY) minY = y; if (y > maxY) maxY = y;
      });
      data.set([minX, minY, maxX, minY, maxX, maxY, minX, maxY], n * 2);
      gl.bufferData(gl.ARRAY_BUFFER, data, gl.DYNAMIC_DRAW);

      // 1) maska do stencilu
      gl.enable(gl.STENCIL_TEST);
      gl.colorMask(false, false, false, false);
      gl.stencilMask(1);
      gl.stencilFunc(gl.ALWAYS, 0, 1);
      gl.stencilOp(gl.KEEP, gl.KEEP, gl.INVERT);
      this.use(solid, H, aspect);
      gl.uniform4f(solid.u.uBBox, minX, minY, maxX - minX, maxY - minY);
      gl.drawArrays(gl.TRIANGLE_FAN, 0, n);

      // 2) animace jen uvnitř masky; stencil se zároveň vynuluje pro další oblast
      gl.colorMask(true, true, true, true);
      gl.stencilFunc(gl.EQUAL, 1, 1);
      gl.stencilOp(gl.ZERO, gl.ZERO, gl.ZERO);
      const prog = this.program(shape.anim);
      this.use(prog, H, aspect);
      gl.uniform4f(prog.u.uBBox, minX, minY, maxX - minX, maxY - minY);
      gl.uniform1f(prog.u.uTime, time * shape.speed);
      gl.uniform1f(prog.u.uBright, shape.bright);
      gl.uniform3fv(prog.u.uColA, hexToRgb(shape.colA));
      gl.uniform3fv(prog.u.uColB, hexToRgb(shape.colB));
      const poly = this.polyData(shape);
      gl.uniform2fv(prog.u.uPoly, poly.arr);
      gl.uniform1i(prog.u.uPolyCount, poly.count);
      const pre = this.precomputed.get(shape.id);
      gl.uniform1i(prog.u.uDataCount, pre ? pre.count : 0);
      if (pre && pre.count > 0) gl.uniform4fv(prog.u.uData, pre.data);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, simOk ? simState.tex : this.dummyTex);
      if (prog.u.uState) gl.uniform1i(prog.u.uState, 0);
      if (prog.u.uStateSize) gl.uniform2f(prog.u.uStateSize, simOk ? simState.w : 0, simOk ? simState.h : 0);
      if (prog.u.uStateFrac) gl.uniform1f(prog.u.uStateFrac, simOk ? simState.frac : 0);
      gl.drawArrays(gl.TRIANGLE_FAN, n, 4);

      if (state.calibration) {
        gl.disable(gl.STENCIL_TEST);
        this.use(solid, H, aspect);
        gl.uniform1f(solid.u.uBright, 1);
        gl.uniform3fv(solid.u.uColA, [1, 1, 1]);
        gl.drawArrays(gl.LINE_LOOP, 0, n);
      }
    }
    gl.disable(gl.STENCIL_TEST);
  }
}
