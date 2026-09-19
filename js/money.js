// 钱一律是整数分。这里只做“分 <-> 元”的展示换算，
// 用字符串处理，避免 0.1 + 0.2 之类的浮点问题。

export function toYuan(cents) {
  const c = Math.trunc(cents);
  const sign = c < 0 ? '-' : '';
  const abs = Math.abs(c);
  const yuan = Math.floor(abs / 100);
  const fen = abs % 100;
  return `${sign}${yuan}.${String(fen).padStart(2, '0')}`;
}

export function yuanLabel(cents) {
  return `¥${toYuan(cents)}`;
}

// “¥12.34 / ¥12.3” -> 整数分。无法解析返回 null。
export function parseYuan(text) {
  if (text == null) return null;
  const m = String(text).trim().replace(/[¥￥,\s]/g, '').match(/^(-?)(\d+)(?:\.(\d{1,2}))?$/);
  if (!m) return null;
  const sign = m[1] === '-' ? -1 : 1;
  const yuanPart = Number(m[2]);
  const frac = (m[3] || '').padEnd(2, '0');
  const cents = yuanPart * 100 + Number(frac);
  if (!Number.isSafeInteger(cents)) return null;
  return sign * cents;
}