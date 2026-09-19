// 战报：导出/导入自包含 JSON，从种子重放整局并逐步校验。

import {
  FORMAT_VERSION,
  createDocument,
  dispatch,
  checksumState,
  GameError
} from './engine.js';

export const RECORD_VERSION = 1;

// cards/encounter 直接嵌进战报：别人机器上的卡表就算和你的不一样，
// 这份记录照样能重放；同一份卡表才能跑出同一个结果。
export function buildRecord(doc, cards, encounter) {
  return {
    kind: 'emberdeck-record',
    recordVersion: RECORD_VERSION,
    formatVersion: FORMAT_VERSION,
    seed: doc.seed,
    exportedAt: new Date().toISOString(),
    cards,
    encounter,
    actions: doc.actions,
    checksums: doc.checksums
  };
}

export function validateRecord(record) {
  if (!record || record.kind !== 'emberdeck-record') {
    throw new GameError('不是 emberdeck 的战报');
  }
  if (record.recordVersion !== RECORD_VERSION) {
    throw new GameError(`战报版本不受支持: ${record.recordVersion}`);
  }
  if (!Array.isArray(record.actions) || !Array.isArray(record.checksums)) {
    throw new GameError('战报内容不完整');
  }
  if (record.checksums.length !== record.actions.length + 1) {
    throw new GameError('战报动作数与校验和数量对不上');
  }
}

// 从种子开始，把 actions 重新跑一遍。
// 每一步（含开局第 0 步）都比对随战报保存的校验和。
export function replay(record, { stopAt = null } = {}) {
  validateRecord(record);
  const cardDefs = {};
  for (const card of record.cards) cardDefs[card.id] = card;

  const doc = createDocument(cardDefs, record.encounter, record.seed);
  const steps = [{
    index: 0,
    action: null,
    checksum: record.checksums[0],
    actual: checksumState(doc.state),
    match: checksumState(doc.state) === record.checksums[0]
  }];

  let mismatchAt = steps[0].match ? null : 0;
  const limit = stopAt == null ? record.actions.length : Math.min(stopAt, record.actions.length);

  for (let i = 0; i < limit; i++) {
    const action = record.actions[i];
    let error = null;
    try {
      dispatch(doc, action, cardDefs);
    } catch (err) {
      error = err.message;
    }
    const actual = checksumState(doc.state);
    const match = error === null && actual === record.checksums[i + 1];
    steps.push({
      index: i + 1,
      action,
      checksum: record.checksums[i + 1],
      actual,
      match,
      error
    });
    if (!match && mismatchAt === null) mismatchAt = i + 1;
  }

  return {
    doc,
    cardDefs,
    steps,
    mismatchAt,
    ok: mismatchAt === null && limit === record.actions.length
  };
}
