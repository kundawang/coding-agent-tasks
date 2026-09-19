import {
  INPUT_DOWN,
  INPUT_LEFT,
  INPUT_RIGHT,
  INPUT_SHOOT,
  INPUT_UP,
  TICK_MS,
} from './engine.js';

export const REPLAY_FORMAT = 'neonbarrage-replay/v1';

export function createInputState() {
  return {
    live: 0,
    record: 0,
    events: [],
  };
}

export function keyBit(code) {
  switch (code) {
    case 'ArrowUp':
    case 'KeyW':
      return INPUT_UP;
    case 'ArrowDown':
    case 'KeyS':
      return INPUT_DOWN;
    case 'ArrowLeft':
    case 'KeyA':
      return INPUT_LEFT;
    case 'ArrowRight':
    case 'KeyD':
      return INPUT_RIGHT;
    case 'KeyZ':
    case 'Space':
      return INPUT_SHOOT;
    default:
      return 0;
  }
}

export function setLiveKey(state, bit, pressed) {
  if (!bit) return false;
  const previous = state.live;
  state.live = pressed
    ? state.live | bit
    : state.live & ~bit;
  return state.live !== previous;
}

export function clearLiveKeys(state) {
  state.live = 0;
}

export function recordTick(state, tick) {
  if (state.live === state.record) return;
  state.record = state.live;
  state.events.push([tick, state.record]);
}

export function makeReplay({ sim, events }) {
  return {
    format: REPLAY_FORMAT,
    tickRate: Math.round(1000 / TICK_MS),
    stageId: sim.stage.id,
    stageSig: stableSignature(sim.stage),
    shipSig: stableSignature(sim.ship),
    seed: sim.seed,
    durationTicks: sim.tick,
    status: sim.status,
    events,
  };
}

export function parseReplay(text, { stage, ship }) {
  const replay = JSON.parse(text);
  if (replay.format !== REPLAY_FORMAT) {
    throw new Error('不是 neonbarrage-replay/v1 记录');
  }
  if (replay.tickRate !== Math.round(1000 / TICK_MS)) {
    throw new Error(`记录帧率 ${replay.tickRate} 与当前逻辑帧率不一致`);
  }
  if (replay.stageId !== stage.id) {
    throw new Error(`记录关卡是 ${replay.stageId}，当前关卡是 ${stage.id}`);
  }

  const stageSig = stableSignature(stage);
  const shipSig = stableSignature(ship);
  const warnings = [];
  if (replay.stageSig !== stageSig) warnings.push('关卡数据与录制时不同');
  if (replay.shipSig !== shipSig) warnings.push('自机参数与录制时不同');

  if (!Array.isArray(replay.events)) throw new Error('记录缺少 events 数组');
  const events = replay.events
    .map(([tick, input]) => [Number(tick), Number(input) & 31])
    .filter(([tick]) => Number.isSafeInteger(tick) && tick >= 0)
    .sort((left, right) => left[0] - right[0]);

  return {
    seed: String(replay.seed ?? ''),
    events,
    warnings,
    status: replay.status,
    durationTicks: replay.durationTicks,
  };
}

export function createReplayPlayer(events) {
  let cursor = 0;
  let input = 0;

  return {
    reset() {
      cursor = 0;
      input = 0;
    },
    inputAtTick(tick) {
      while (cursor < events.length && events[cursor][0] <= tick) {
        input = events[cursor][1];
        cursor += 1;
      }
      return input;
    },
  };
}

export function stableSignature(value) {
  return fnv1a(canonicalize(value));
}

function canonicalize(value) {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalize).join(',')}]`;
  }
  if (value && typeof value === 'object') {
    const keys = Object.keys(value).sort();
    return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalize(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function fnv1a(value) {
  let hash = 0x811C9DC5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}
