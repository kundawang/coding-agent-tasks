// 链接编码：
//   #<payload>.<encodedSeed>
// payload 是 8 个小端风格字节经 base64url（无填充）编码后的 11 个字符，
// 例如 "Z0BA..."; seed 用 encodeURIComponent 转义（'.' 会变成 %2E，不会和分隔符冲突）。
//
// 解码是“不可信输入”的边界：长度、字符表、版本号、取值域逐一校验，
// 任何一项不过就抛出带 code 的错误，由界面提示并退回默认预设，绝不白屏。

export const CODEC_VERSION = 0;

const ALPHABET =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
const CHAR_CODE = new Map([...ALPHABET].map((ch, i) => [ch, i]));

export class LinkError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

function encodeBase64Url(bytes) {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i];
    const b1 = i + 1 < bytes.length ? bytes[i + 1] : 0;
    const b2 = i + 2 < bytes.length ? bytes[i + 2] : 0;
    const triple = (b0 << 16) | (b1 << 8) | b2;
    out += ALPHABET[(triple >>> 18) & 63];
    out += ALPHABET[(triple >>> 12) & 63];
    if (i + 1 < bytes.length) out += ALPHABET[(triple >>> 6) & 63];
    if (i + 2 < bytes.length) out += ALPHABET[triple & 63];
  }
  return out;
}

function decodeBase64Url(text, expectedBytes) {
  // 8 字节对应 11 个无填充字符；长度不对一律拒绝（被截断/多塞字符都能发现）。
  const expectedLength = Math.ceil((expectedBytes * 4) / 3);
  if (text.length !== expectedLength) {
    throw new LinkError('BAD_LINK', '链接长度不正确');
  }
  const sixBits = new Array(text.length);
  for (let i = 0; i < text.length; i++) {
    const value = CHAR_CODE.get(text[i]);
    if (value === undefined) {
      throw new LinkError('BAD_LINK', '链接含有非法字符');
    }
    sixBits[i] = value;
  }
  const bytes = [];
  for (let i = 0; i < sixBits.length; i += 4) {
    const triple =
      (sixBits[i] << 18) |
      (sixBits[i + 1] << 12) |
      ((sixBits[i + 2] ?? 0) << 6) |
      (sixBits[i + 3] ?? 0);
    bytes.push((triple >>> 16) & 255, (triple >>> 8) & 255, triple & 255);
  }
  // 最后一组可能有 1~2 个填充位；非零说明载荷被篡改。
  const remainder = expectedBytes % 3;
  if (remainder === 1 && (bytes[bytes.length - 1] !== 0 || bytes[bytes.length - 2] !== 0)) {
    throw new LinkError('BAD_LINK', '链接尾部位被改动');
  }
  if (remainder === 2 && bytes[bytes.length - 1] !== 0) {
    throw new LinkError('BAD_LINK', '链接尾部位被改动');
  }
  return bytes.slice(0, expectedBytes);
}

export function encodeShare(params, seed) {
  const roomCount = Math.max(1, Math.min(200, params.roomCount | 0));
  const bytes = [
    CODEC_VERSION,
    params.width & 255,
    params.height & 255,
    params.roomMin & 255,
    params.roomMax & 255,
    ((params.corridorWidth & 15) << 4) | ((roomCount >>> 8) & 15),
    roomCount & 255,
    ((params.extraLoops & 15) << 4) | (params.treasureRooms & 15),
  ];
  return '#' + encodeBase64Url(bytes) + '.' + encodeURIComponent(seed);
}

function assert(condition, message) {
  if (!condition) throw new LinkError('BAD_PARAMS', message);
}

export function decodeShare(hash) {
  if (typeof hash !== 'string' || hash.length === 0) {
    throw new LinkError('BAD_LINK', '链接为空');
  }
  const raw = hash.startsWith('#') ? hash.slice(1) : hash;
  const dot = raw.indexOf('.');
  if (dot < 0) {
    throw new LinkError('BAD_LINK', '链接缺少种子部分');
  }
  const payload = raw.slice(0, dot);
  const encodedSeed = raw.slice(dot + 1);
  const bytes = decodeBase64Url(payload, 8);

  const [version, width, height, roomMin, roomMax, packedCount, roomCountLo, packedExtra] =
    bytes;

  if (version !== CODEC_VERSION) {
    throw new LinkError('BAD_VERSION', `不支持的链接版本：v${version}`);
  }
  assert(width >= 8 && width <= 255, `地图宽度越界：${width}`);
  assert(height >= 8 && height <= 255, `地图高度越界：${height}`);
  assert(roomMin >= 3 && roomMin <= 32, `房间最小边长越界：${roomMin}`);
  assert(roomMax >= 3 && roomMax <= 32, `房间最大边长越界：${roomMax}`);
  assert(roomMin <= roomMax, '房间最小边长大于最大边长');
  const corridorWidth = (packedCount >>> 4) & 15;
  assert(corridorWidth >= 1 && corridorWidth <= 7, `走廊宽度越界：${corridorWidth}`);
  const roomCount = ((packedCount & 15) << 8) | roomCountLo;
  assert(roomCount >= 1 && roomCount <= 200, `房间数量越界：${roomCount}`);
  const extraLoops = (packedExtra >>> 4) & 15;
  const treasureRooms = packedExtra & 15;

  let seed;
  try {
    seed = decodeURIComponent(encodedSeed);
  } catch {
    throw new LinkError('BAD_SEED', '种子部分不是合法的百分号编码');
  }
  if (seed.length > 200) {
    throw new LinkError('BAD_SEED', '种子过长（最多 200 字符）');
  }

  return {
    params: {
      width,
      height,
      roomMin,
      roomMax,
      roomCount,
      corridorWidth,
      extraLoops,
      treasureRooms,
    },
    seed,
  };
}
