// 全局可调参数。判定窗口与计分公式改动后请同步 README。
export const LANES = 4;

// 物理按键 -> 轨道（从左到右）
export const KEYS = ['KeyD', 'KeyF', 'KeyJ', 'KeyK'];
export const KEY_LABELS = ['D', 'F', 'J', 'K'];

// 判定半窗口（毫秒，含边界）
// |delta| <= 30 Perfect；<= 60 Great；<= 100 Good；再往外 Miss
export const WINDOWS = { perfect: 30, great: 60, good: 100 };

// 音符越过判定线多少毫秒后自动判 Miss
export const MISS_AFTER_MS = 100;

// 音符从屏幕顶部走到判定线的时间（只影响视觉，不参与判定）
export const APPROACH_MS = 1400;

// 计分：基础分 + 连击加成（combo * step，上限 cap）
export const SCORE = {
  perfect: 1000,
  great: 600,
  good: 300,
  miss: 0,
  comboStep: 2,
  comboCap: 100,
};

// 准确率权重（与连击无关，只看判定档位）
export const WEIGHTS = { perfect: 1, great: 0.6, good: 0.3, miss: 0 };

// 开场倒计时拍数（拍点 = 谱面 offsetMs 之前的 LEAD_IN_BEATS 拍）
export const LEAD_IN_BEATS = 4;

// 最后一个音符后保留多少毫秒再结算
export const END_HOLD_MS = 1800;

// WebAudio 前瞻调度参数
export const SCHED = { intervalMs: 25, lookaheadMs: 120 };

export const LANE_COLORS = ['#4fc3f7', '#66bb6a', '#ffb300', '#ef5350'];
