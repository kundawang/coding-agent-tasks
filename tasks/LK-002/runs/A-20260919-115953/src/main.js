import {
  createSimulation,
  step,
  TICK_MS,
  WORLD_HEIGHT,
  WORLD_WIDTH,
} from './engine.js';
import { createRenderer } from './renderer.js';
import {
  clearLiveKeys,
  createInputState,
  createReplayPlayer,
  keyBit,
  makeReplay,
  parseReplay,
  recordTick,
  setLiveKey,
} from './replay.js';

const DEFAULT_SEED = 'neon-1';
const MAX_FRAME_MS = 100;

const elements = {
  canvas: document.querySelector('#game'),
  seed: document.querySelector('#seed'),
  applySeed: document.querySelector('#apply-seed'),
  restart: document.querySelector('#restart'),
  fps: document.querySelector('#fps'),
  bullets: document.querySelector('#bullets'),
  score: document.querySelector('#score'),
  lives: document.querySelector('#lives'),
  time: document.querySelector('#time'),
  status: document.querySelector('#status'),
  exportRecord: document.querySelector('#export-record'),
  recordBox: document.querySelector('#record-box'),
  replayBox: document.querySelector('#replay-box'),
  loadReplay: document.querySelector('#load-replay'),
  replayPause: document.querySelector('#replay-pause'),
  replayStep: document.querySelector('#replay-step'),
  message: document.querySelector('#message'),
};

let stage;
let ship;
let sim;
let renderer;
let inputState = createInputState();
let replayData = null;
let replayPlayer = null;
let replayPaused = false;
let accumulator = 0;
let previousTime = 0;
let lastFpsTime = 0;
let frameCount = 0;

start();

async function start() {
  try {
    [stage, ship] = await Promise.all([
      fetchJson('./samples/stage.json'),
      fetchJson('./samples/ship.json'),
    ]);
    const urlSeed = new URLSearchParams(location.search).get('seed');
    elements.seed.value = urlSeed ?? DEFAULT_SEED;

    renderer = createRenderer(elements.canvas);
    elements.canvas.width = WORLD_WIDTH;
    elements.canvas.height = WORLD_HEIGHT;
    bindControls();
    resetGame(elements.seed.value, null);
    previousTime = performance.now();
    requestAnimationFrame(frame);
  } catch (error) {
    setMessage(error.message, true);
    throw error;
  }
}

async function fetchJson(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`读取 ${url} 失败：${response.status}`);
  return response.json();
}

function bindControls() {
  elements.applySeed.addEventListener('click', () => {
    resetGame(elements.seed.value || DEFAULT_SEED, null);
  });
  elements.seed.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') resetGame(elements.seed.value || DEFAULT_SEED, null);
  });
  elements.restart.addEventListener('click', () => {
    if (replayData) resetGame(replayData.seed, replayData);
    else resetGame(elements.seed.value || DEFAULT_SEED, null);
  });
  elements.exportRecord.addEventListener('click', exportCurrentRecord);
  elements.loadReplay.addEventListener('click', loadReplayFromBox);
  elements.replayPause.addEventListener('click', toggleReplayPause);
  elements.replayStep.addEventListener('click', stepReplayOnce);

  window.addEventListener('keydown', handleKeyDown);
  window.addEventListener('keyup', handleKeyUp);
  window.addEventListener('blur', () => clearLiveKeys(inputState));
}

function resetGame(seed, loadedReplay) {
  sim = createSimulation({ stage, ship, seed });
  inputState = createInputState();
  replayData = loadedReplay;
  replayPlayer = loadedReplay ? createReplayPlayer(loadedReplay.events) : null;
  replayPaused = false;
  accumulator = 0;
  setMessage(
    loadedReplay
      ? `回放已载入：${loadedReplay.seed}`
      : '',
    false,
  );
}

function handleKeyDown(event) {
  if (document.activeElement === elements.seed) return;
  const bit = keyBit(event.code);
  if (bit) event.preventDefault();
  if (replayData || !bit || event.repeat) return;
  setLiveKey(inputState, bit, true);
}

function handleKeyUp(event) {
  if (document.activeElement === elements.seed) return;
  const bit = keyBit(event.code);
  if (!bit) return;
  event.preventDefault();
  if (replayData) return;
  setLiveKey(inputState, bit, false);
}

function frame(currentTime) {
  requestAnimationFrame(frame);
  const elapsed = Math.min(MAX_FRAME_MS, currentTime - previousTime);
  previousTime = currentTime;

  if (replayData) {
    if (replayPaused) {
      accumulator = 0;
    } else {
      accumulator += elapsed;
      while (accumulator >= TICK_MS && sim.status === 'playing') {
        advanceSimulation();
        accumulator -= TICK_MS;
      }
      if (accumulator > TICK_MS) accumulator = 0;
    }
  } else {
    accumulator += elapsed;
    let guard = 0;
    while (accumulator >= TICK_MS && guard < 8) {
      advanceSimulation();
      accumulator -= TICK_MS;
      guard += 1;
    }
    if (guard === 8) accumulator = 0;
  }

  const alpha = sim.status === 'playing' ? accumulator / TICK_MS : 1;
  renderer.render(sim, Math.min(1, Math.max(0, alpha)));
  updateHud();

  frameCount += 1;
  if (currentTime - lastFpsTime >= 500) {
    elements.fps.textContent = String(
      Math.round(frameCount * 1000 / (currentTime - lastFpsTime)),
    );
    frameCount = 0;
    lastFpsTime = currentTime;
  }
}

function advanceSimulation() {
  const input = replayPlayer
    ? replayPlayer.inputAtTick(sim.tick)
    : inputState.live;
  step(sim, input);
  if (!replayPlayer) recordTick(inputState, sim.tick);
}

function stepReplayOnce() {
  if (!replayData) return;
  replayPaused = true;
  accumulator = 0;
  if (sim.status === 'playing') advanceSimulation();
}

function toggleReplayPause() {
  if (!replayData) return;
  replayPaused = !replayPaused;
  accumulator = 0;
  elements.replayPause.textContent = replayPaused ? '继续回放' : '暂停回放';
}

function exportCurrentRecord() {
  if (replayData) {
    elements.recordBox.value = elements.replayBox.value;
    return;
  }
  const replay = makeReplay({ sim, events: inputState.events });
  elements.recordBox.value = JSON.stringify(replay, null, 2);
  setMessage('记录已生成，可复制给别人贴回。', false);
}

function loadReplayFromBox() {
  try {
    const loaded = parseReplay(elements.replayBox.value, { stage, ship });
    elements.seed.value = loaded.seed;
    resetGame(loaded.seed, loaded);
    elements.replayPause.textContent = '暂停回放';
    setMessage(
      loaded.warnings.length
        ? `已载入，但${loaded.warnings.join('、')}，结果可能不同`
        : '回放已载入，可用暂停后逐帧查看。',
      false,
    );
  } catch (error) {
    setMessage(error.message, true);
  }
}

function updateHud() {
  elements.bullets.textContent = sim.bullets.count.toLocaleString('en-US');
  elements.score.textContent = String(sim.score);
  elements.lives.textContent = String(sim.lives);
  elements.time.textContent = `${Math.max(0, sim.timeMs / 1000).toFixed(1)}s`;
  elements.status.textContent = statusText();
}

function statusText() {
  if (replayData && replayPaused) return `回放暂停 / tick ${sim.tick}`;
  if (sim.status === 'playing') return replayData ? `回放中 / tick ${sim.tick}` : '进行中';
  if (sim.status === 'cleared') return '通关';
  return '坠机';
}

function setMessage(message, isError) {
  elements.message.textContent = message;
  elements.message.className = isError ? 'message error' : 'message';
}
