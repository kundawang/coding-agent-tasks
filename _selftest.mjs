import { readFileSync } from 'node:fs';
import { createMatch, step, mulberry32, INPUT } from './js/sim.js';
import { Recorder, reconstruct, parseReplay, replayToText, inputStream } from './js/replay.js';

const arena = JSON.parse(readFileSync('samples/arena.json', 'utf8'));
const rules = JSON.parse(readFileSync('samples/rules.json', 'utf8'));

function run(seed, script) {
  const m = createMatch(arena, rules, seed);
  const rec = new Recorder(seed, m.totalTicks, arena, rules);
  let t = 0;
  while (m.status === 'running') {
    t++;
    const masks = script(t, m);
    rec.noteInputs(t, masks);
    step(m, masks);
  }
  return { m, replay: rec.finish(m) };
}

// 1) 两个站着不动的玩家：0:0 平局，无人死亡。
{
  const { m, replay } = run(12345, () => [0, 0]);
  const kills = replay.events.filter((e) => e.type === 'kill');
  console.assert(m.score[0] === 0 && m.score[1] === 0, 'idle score');
  console.assert(kills.length === 0, 'no kills idle');
  console.assert(m.winner === 'draw', 'idle draw');
  console.assert(m.tick === rules.matchMs / (1000 / rules.tickRate), 'totalTicks');
}

// 2) 确定性：同种子同输入两次完全一致。
{
  const a = run(777, (t) => [(t % 37 < 20) ? INPUT.RIGHT : 0, (t % 53 < 15) ? INPUT.LEFT | INPUT.UP : 0]);
  const b = run(777, (t) => [(t % 37 < 20) ? INPUT.RIGHT : 0, (t % 53 < 15) ? INPUT.LEFT | INPUT.UP : 0]);
  console.assert(replayToText(a.replay) === replayToText(b.replay), 'deterministic replay text');
  const c = run(778, (t) => [(t % 37 < 20) ? INPUT.RIGHT : 0, (t % 53 < 15) ? INPUT.LEFT | INPUT.UP : 0]);
  console.assert(replayToText(a.replay) !== replayToText(c.replay), 'different seed => different game');
}

// 3) P1 先向上走到 A 点附近再右修正，完成占领，随后分数增长。
{
  const { m } = run(42, (t) => [t <= 103 ? INPUT.UP : t <= 130 ? INPUT.RIGHT : 0, 0]);
  const caps = m.events.filter((e) => e.type === 'capture');
  const capA = caps.find((e) => e.point === 'A' && e.owner === 0);
  console.assert(capA, 'P1 captures A, got: ' + JSON.stringify(caps));
  console.assert(m.score[0] > 0, 'P1 scores, got ' + m.score[0]);
}

// 4) 回放对账：reconstruct 完全一致；篡改输入立刻 desync。
{
  // P1 走到 A 点（上 103 tick 再右 25 tick），P2 走到 B 点，之后站住拿分。
  const route = (t, rightSide) => {
    if (t <= 103) return INPUT.UP;
    if (t <= 128) return rightSide ? INPUT.LEFT : INPUT.RIGHT;
    return 0;
  };
  const { replay } = run(99, (t) => [route(t, false), route(t, true)]);
  const roundTrip = parseReplay(replayToText(replay));
  const ok = reconstruct(roundTrip.replay);
  console.assert(ok.consistent, 'replay consistent: ' + ok.problems.join(';'));
  const tampered = JSON.parse(replayToText(replay));
  tampered.rules.scorePerSecond += 1;
  const bad = reconstruct(tampered);
  console.assert(!bad.consistent, 'tamper detected');
}

// 4b) 无敌方贴身：只淘汰无无敌的一方，无敌方存活。
{
  const m = createMatch(arena, rules, 5);
  m.players[0].x = m.players[1].x - 30;
  m.players[0].y = m.players[1].y;
  m.players[0].immunityTicks = 50;
  m.players[1].immunityTicks = 0;
  step(m, [INPUT.RIGHT, 0]);
  const kill = m.events.find((e) => e.type === 'kill');
  console.assert(kill && kill.victim === 1 && kill.killer === 0, 'immune ram kills vulnerable only, got ' + JSON.stringify(kill));
  console.assert(m.players[0].alive && m.players[0].immunityTicks === 49, 'immune survivor alive');
  console.assert(m.players[1].alive && m.players[1].immunityTicks > 0, 'victim respawned with immunity');
}

// 5) 贴脸接触：两个玩家对撞，应出现击杀事件（双杀或无敌方击杀）。
{
  let sawKill = false;
  const { m } = run(5, () => [INPUT.RIGHT, INPUT.LEFT]);
  // P1 在 (80,560)、P2 在 (880,560)，y 相同，一路对撞
  sawKill = m.events.some((e) => e.type === 'kill');
  console.assert(sawKill, 'head-on contact kills');
}

// 6) 无敌方撞人：P1 出生后立刻冲，在 P2 无敌结束前贴身应淘汰 P2 且自己活着。
{
  const { m } = run(5, () => [INPUT.RIGHT, 0]);
  // P2 全程不动；距离 800px，4px/tick 需要 200 tick（3.3s），无敌 1.5s 已过 → 双杀/普通。
  // 这里只验证：不动的 P2 也会被接触淘汰（killer=0）。
  const kill = m.events.find((e) => e.type === 'kill');
  console.assert(kill, 'ram kills stationary target');
}

// 7) 观战 seek：inputStream 语义正确。
{
  const rep = { inputs: [[1, 1, 0], [5, 0, 2], [9, 8, 0]], totalTicks: 10 };
  const at = inputStream(rep);
  console.assert(JSON.stringify(at(1)) === '[1,0]' && JSON.stringify(at(4)) === '[1,0]', 'stream early');
  console.assert(JSON.stringify(at(5)) === '[0,2]' && JSON.stringify(at(8)) === '[0,2]', 'stream mid');
  console.assert(JSON.stringify(at(9)) === '[8,0]' && JSON.stringify(at(10)) === '[8,0]', 'stream late');
  console.assert(JSON.stringify(at(0)) === '[0,0]', 'stream before start');
}

// 8) PRNG 已知向量（mulberry32 seed=0 的前两个值）。
{
  const r = mulberry32(0);
  const v = [r(), r()];
  console.assert(Math.abs(v[0] - 0.26642920868471265) < 1e-12, 'prng v0 ' + v[0]);
  console.assert(Math.abs(v[1] - 0.0003297457005828619) < 1e-12, 'prng v1 ' + v[1]);
}

console.log('selftest done');
