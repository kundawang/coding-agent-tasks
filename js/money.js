// 钱一律按"分"做整数运算。本模块只负责整数分 <-> 显示用元字符串，
// 解析走字符串，绝不经过 Number("0.1") 之类的浮点路径。

const CENTS_PER_YUAN = 100n;

// 整数分（number / bigint 都可）-> "1,234.56"
export function formatYuan(cents) {
  const c = BigInt(cents);
  const neg = c < 0n;
  const abs = neg ? -c : c;
  const yuan = abs / CENTS_PER_YUAN;
  const frac = abs % CENTS_PER_YUAN;
  const yuanStr = groupThousands(yuan.toString());
  const fracStr = frac.toString().padStart(2, "0");
  return `${neg ? "-" : ""}${yuanStr}.${fracStr}`;
}

// "12.34" / "12" / "12.3" -> 整数分。
// 返回 null 表示非法（多于两位小数、非数字等）。
export function parseYuanToCents(text) {
  if (typeof text !== "string") return null;
  let s = text.trim();
  if (s === "") return null;
  const neg = s.startsWith("-");
  if (neg) s = s.slice(1);
  if (!/^\d+(\.\d*)?$/.test(s)) return null;

  let intPart;
  let fracPart;
  const dot = s.indexOf(".");
  if (dot === -1) {
    intPart = s;
    fracPart = "";
  } else {
    intPart = s.slice(0, dot) || "0";
    fracPart = s.slice(dot + 1);
  }
  if (fracPart.length > 2) return null;
  fracPart = fracPart.padEnd(2, "0");

  let cents = BigInt(intPart) * CENTS_PER_YUAN + BigInt(fracPart || "0");
  if (neg) cents = -cents;
  return cents;
}

function groupThousands(intDigits) {
  const out = [];
  const len = intDigits.length;
  for (let i = 0; i < len; i++) {
    if (i > 0 && (len - i) % 3 === 0) out.push(",");
    out.push(intDigits[i]);
  }
  return out.join("");
}
