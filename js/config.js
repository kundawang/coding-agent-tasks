// 全局常量。所有金额单位均为“分”（整数）。

export const SCHEMA_VERSION = 1;

export const SAVE_KEY = 'cornerstore.save';

// 离线补算最多补几个完整的游戏日
export const MAX_CATCHUP_DAYS = 7;

// 小于该幅度的时钟倒退视为 NTP/校时抖动，忽略且不记异常
export const ROLLBACK_IGNORE_MS = 2000;

// 定价吸引力曲线：priceFactor = clamp((1.8 - 售价/进价) / 0.8, 0, 1) ^ 1.8
// 售价 = 进价时吸引力为 1；售价到进价 1.8 倍时归零。
export const PRICE_ZERO_MARGIN = 1.8;
export const PRICE_FULL_MARGIN = 1.0;
export const PRICE_EXP = 1.8;

// 顾客进店后“什么都不买直接走”的基础权重
export const LEAVE_WEIGHT = 0.2;

export const HISTORY_LIMIT = 120;
export const ANOMALY_LIMIT = 50;

export const DAY_MS_DEFAULT = 240000;