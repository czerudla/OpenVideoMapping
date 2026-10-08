// Výstupní okno – běží na projektoru, jen vykresluje stav z editoru.
import { Renderer } from './renderer.js';
import { CHANNEL_NAME, loadState, createDefaultState } from './state.js';

const canvas = document.getElementById('out');
const hint = document.getElementById('hint');
let state = loadState() ?? createDefaultState();
let renderer;

try {
  renderer = new Renderer(canvas);
} catch (err) {
  hint.hidden = false;
  hint.innerHTML = `<div><strong>Výstup nelze spustit</strong><br>${err.message}</div>`;
  throw err;
}
renderer.prepare(state);

const channel = new BroadcastChannel(CHANNEL_NAME);
channel.onmessage = (e) => {
  if (e.data?.type !== 'state') return;
  renderer.prepare(e.data.state);
  state = e.data.state;
};

function report() {
  const dpr = window.devicePixelRatio || 1;
  channel.postMessage({
    type: 'screen',
    w: Math.round(innerWidth * dpr),
    h: Math.round(innerHeight * dpr),
    fullscreen: !!document.fullscreenElement,
  });
}
channel.postMessage({ type: 'hello' });
report();
setInterval(report, 2000);
addEventListener('resize', report);

let wakeLock = null;
async function enterFullscreen() {
  try {
    await document.documentElement.requestFullscreen({ navigationUI: 'hide' });
  } catch (err) {
    console.warn('Celou obrazovku nelze zapnout:', err);
  }
  try {
    wakeLock = await navigator.wakeLock?.request('screen');
  } catch { /* zámek obrazovky není nutný */ }
}

document.addEventListener('fullscreenchange', () => {
  hint.hidden = !!document.fullscreenElement;
  report();
});
document.addEventListener('visibilitychange', async () => {
  if (document.visibilityState === 'visible' && wakeLock?.released) {
    try { wakeLock = await navigator.wakeLock.request('screen'); } catch { /* nic */ }
  }
});
addEventListener('click', () => { if (!document.fullscreenElement) enterFullscreen(); });
addEventListener('keydown', (e) => {
  if (e.key === 'f' || e.key === 'F') {
    if (document.fullscreenElement) document.exitFullscreen();
    else enterFullscreen();
  }
});

// Kurzor zmizí po 2 s nečinnosti.
let idleTimer;
addEventListener('mousemove', () => {
  document.body.classList.remove('idle');
  clearTimeout(idleTimer);
  idleTimer = setTimeout(() => document.body.classList.add('idle'), 2000);
});

function frame() {
  renderer.render(state);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
