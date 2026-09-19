// 链接编解码。参数打包成 "w.h.rmin.rmax.rc.cw.loops.tr~seed~校验值" 再 base64url，
// 比 JSON+base64 短一半左右。校验值是对 "参数~种子" 的哈希，
// 截断、改字符、换种子都会被它挡下来。解码是纯校验函数：永不抛异常，
// 任何篡改都返回 { ok: false, error }，由 UI 显示提示。

import { hashSeed } from "./rng.js";

const FIELDS = [
  "width", "height", "roomMin", "roomMax",
  "roomCount", "corridorWidth", "extraLoops", "treasureRooms",
];

const RANGES = {
  width: [16, 128],
  height: [16, 128],
  roomMin: [2, 24],
  roomMax: [2, 32],
  roomCount: [1, 120],
  corridorWidth: [1, 5],
  extraLoops: [0, 40],
  treasureRooms: [0, 20],
};

const MAX_SEED_LEN = 64;
const MAX_CODE_LEN = 400;

function toBase64Url(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(code) {
  const b64 = code.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(b64);
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

export function encodeLink(params, seed) {
  const nums = FIELDS.map((f) => params[f]).join(".");
  const body = `${nums}~${seed}`;
  return toBase64Url(`${body}~${hashSeed(body).toString(36)}`);
}

export function decodeLink(code) {
  const fail = (error) => ({ ok: false, error });
  if (typeof code !== "string" || code.length === 0) return fail("链接里没有地图数据");
  if (code.length > MAX_CODE_LEN) return fail("链接长度异常，不是本地图工具生成的");
  if (!/^[A-Za-z0-9_-]+$/.test(code)) return fail("链接包含非法字符，可能被截断或篡改");

  let payload;
  try {
    payload = fromBase64Url(code);
  } catch {
    return fail("链接解码失败，内容已损坏");
  }

  const parts = payload.split("~");
  if (parts.length !== 3) return fail("链接格式不对（应包含参数、种子、校验值）");
  const [numPart, seed, check] = parts;
  if (seed.length === 0) return fail("链接里缺少种子");
  if (seed.length > MAX_SEED_LEN) return fail("种子超长，链接不可信");
  if (hashSeed(`${numPart}~${seed}`).toString(36) !== check)
    return fail("校验值不匹配，链接被改过或已损坏");

  const nums = numPart.split(".");
  if (nums.length !== FIELDS.length) return fail("参数个数不对，链接不完整");
  const params = {};
  for (let i = 0; i < FIELDS.length; i++) {
    const name = FIELDS[i];
    if (!/^\d+$/.test(nums[i])) return fail(`参数 ${name} 不是非负整数`);
    const v = Number(nums[i]);
    const [lo, hi] = RANGES[name];
    if (v < lo || v > hi) return fail(`参数 ${name}=${v} 超出允许范围 [${lo}, ${hi}]`);
    params[name] = v;
  }
  if (params.roomMax < params.roomMin) return fail("roomMax 小于 roomMin，参数自相矛盾");
  if (params.treasureRooms > params.roomCount) return fail("宝箱房数量超过房间总数");

  return { ok: true, params, seed };
}

export { RANGES as PARAM_RANGES };
