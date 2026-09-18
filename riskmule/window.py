"""滑动窗口统计：按用户累计时间窗内的事件条数与金额。"""

import bisect


class SlidingWindow:
    """左闭右开的滑动窗口：`count`/`amount` 统计 [now - window, now) 内的事件。"""

    def __init__(self, window_seconds=60):
        if window_seconds <= 0:
            raise ValueError("window_seconds 必须为正数")
        self.window_seconds = window_seconds
        self._events = {}

    def add(self, key, ts, amount=0):
        """把一条事件放进窗口；同一 key 的事件按时间有序存放。"""
        bisect.insort(self._events.setdefault(key, []), (ts, amount))

    def _slice(self, key, now):
        events = self._events.get(key) or []
        stamps = [event[0] for event in events]
        start = bisect.bisect_right(stamps, now - self.window_seconds)
        end = bisect.bisect_left(stamps, now)
        return events[start:end]

    def count(self, key, now):
        """[now - window, now) 内的事件条数。"""
        return len(self._slice(key, now))

    def amount(self, key, now):
        """[now - window, now) 内的事件金额合计。"""
        total = 0.0
        for _ts, value in self._slice(key, now):
            total += float(value or 0)
        return total

    def forget(self, key):
        self._events.pop(key, None)
