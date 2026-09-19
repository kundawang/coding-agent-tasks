export function hashSeedToU32(seed) {
  let hash = 0x9E3779B9;
  const value = String(seed);
  for (let index = 0; index < value.length; index += 1) {
    hash = Math.imul(hash ^ value.charCodeAt(index), 0x5BD1E995);
    hash = (hash >>> 13) ^ hash;
  }
  hash = Math.imul(hash ^ value.length, 0x85EBCA6B);
  hash ^= hash >>> 16;
  hash = Math.imul(hash, 0xC2B2AE35);
  hash ^= hash >>> 13;
  return hash >>> 0;
}

export function createRng(seed) {
  let state = hashSeedToU32(seed) >>> 0;

  return {
    next() {
      state = (state + 0x6D2B79F5) >>> 0;
      let value = state;
      value = Math.imul(value ^ (value >>> 15), value | 1);
      value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
      return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
    },
  };
}
