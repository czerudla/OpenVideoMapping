// WebGL2 renderer sdílený editorem (náhled) i výstupním oknem (projektor).
// Oblast se maskuje stencil bufferem: polygon se vykreslí jako trojúhelníkový
// vějíř s operací INVERT (sudo-lichá výplň, funguje i pro konkávní tvary),
// pak se animace kreslí jen tam, kde je stencil = 1. Mimo oblasti zůstává RGB 0,0,0.

import { VERTEX_SHADER, CALIBRATION_GLSL, buildFragment } from './shaders.js';
import { ANIMATIONS } from './animations/index.js';
import { squareToQuad, mul3, toColumnMajor } from './homography.js';

// Normalizované souřadnice obrazovky (0–1, y dolů) → clip space WebGL.
const TO_CLIP = [2, 0, -1, 0, -2, 1, 0, 0, 1];

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
    this.buffer = gl.createBuffer();
    this.vao = gl.createVertexArray();
    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    this.vs = this.compile(gl.VERTEX_SHADER, VERTEX_SHADER);
    for (const a of ANIMATIONS) this.program(a.id);
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
    const body = id === '__calibration'
      ? CALIBRATION_GLSL
      : (ANIMATIONS.find((a) => a.id === id) ?? ANIMATIONS[0]).glsl;
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
      for (const name of ['uH', 'uBBox', 'uTime', 'uBright', 'uAspect', 'uColA', 'uColB'])
        u[name] = gl.getUniformLocation(p, name);
      entry = { p, u };
    } catch (err) {
      console.error(`Shader „${id}“ se nepodařilo zkompilovat:`, err);
      entry = id === 'solid' ? null : this.program('solid');
    }
    this.programs.set(id, entry);
    return entry;
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
