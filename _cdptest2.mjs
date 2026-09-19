// Frame-rate independence check: run the same accumulator loop with
// 60Hz / 165Hz / 30Hz frame intervals and compare resulting tick/score.

const base = 'http://127.0.0.1:9333';
const pageUrl = 'http://127.0.0.1:8147/index.html';
const target = await (await fetch(`${base}/json/new?${encodeURIComponent(pageUrl)}`, { method: 'PUT' })).json();
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));

let id = 0;
const pending = new Map();
ws.onmessage = (e) => {
  const msg = JSON.parse(e.data);
  if (msg.id && pending.has(msg.id)) {
    pending.get(msg.id)(msg);
    pending.delete(msg.id);
  }
};
function send(method, params = {}) {
  const mid = ++id;
  ws.send(JSON.stringify({ id: mid, method, params }));
  return new Promise((r) => pending.set(mid, r));
}
async function evalJs(expression) {
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (r.result.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails.exception));
  return r.result.result.value;
}

await send('Page.enable');
await new Promise((r) => setTimeout(r, 800));

const res = await evalJs(`(async () => {
  const { arena, rules } = await (await import('/js/config.js')).loadConfig();
  const sim = await import('/js/sim.js');
  const stepMs = 1000 / rules.tickRate;

  function simulateFrames(frameMsList, inputMask) {
    const m = sim.createMatch(arena, rules, 4242);
    let acc = 0;
    for (const frameMs of frameMsList) {
      acc += frameMs;
      let guard = 0;
      while (acc + 1e-9 >= stepMs && guard < 10) {
        sim.step(m, inputMask(m.tick + 1));
        acc -= stepMs;
        if (Math.abs(acc) < 1e-9) acc = 0;
        guard++;
      }
    }
    return {
      tick: m.tick,
      score: m.score.map(x => Math.round(x * 1000) / 1000),
      captures: m.events.filter(e => e.type === 'capture').length,
    };
  }

  const input = (t) => [t <= 103 ? 1 : t <= 128 ? 8 : 0, t <= 103 ? 1 : t <= 128 ? 4 : 0];

  const frames60 = Array(300).fill(1000 / 60);
  const frames165 = Array(825).fill(1000 / 165);
  const frames30 = Array(150).fill(1000 / 30);
  const framesStutter = [1000 / 60, 100, ...Array(288).fill(1000 / 60)];

  return {
    at60: simulateFrames(frames60, input),
    at165: simulateFrames(frames165, input),
    at30: simulateFrames(frames30, input),
    stutter: simulateFrames(framesStutter, input),
  };
})()`);

console.log(JSON.stringify(res, null, 2));
const same =
  JSON.stringify(res.at60) === JSON.stringify(res.at165) &&
  JSON.stringify(res.at60) === JSON.stringify(res.at30);
console.log(same ? `PASS 60/165/30Hz identical (tick=${res.at60.tick})` : 'FAIL frame rate changed logic');
console.log(`stutter tick=${res.stutter.tick} (fewer ticks expected, step cap 10 active)`);

ws.close();
process.exit(same ? 0 : 1);
