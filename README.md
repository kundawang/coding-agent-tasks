# branchscript

文字冒险的剧本引擎，网页版。剧本用 JSON 写，引擎负责跑剧情、记状态、存档、回放。

纯静态、无构建、无依赖。

## 目录

```
samples/story.json   一小段剧本（三个场景，含条件分支）
```

## 剧本格式

```json
{
  "id": "chapter-01",
  "version": 1,
  "start": "gate",
  "vars": { "hasKey": false, "trust": 0 },
  "scenes": {
    "gate": {
      "text": "铁门锁着。你摸了摸口袋。",
      "choices": [
        { "text": "掏出钥匙", "if": { "var": "hasKey", "eq": true }, "go": "open", "set": { "trust": 1 } },
        { "text": "敲门", "go": "knock" },
        { "text": "原路返回", "go": "leave", "end": true }
      ]
    }
  }
}
```

| 字段 | 说明 |
|---|---|
| `start` | 起始场景 id |
| `vars` | 初始变量表 |
| `scenes[id].text` | 正文，显示给玩家 |
| `choices[].if` | 显示条件，`{ "var": "名字", "eq" / "gte" / "lte": 值 }` |
| `choices[].set` | 选了之后给变量赋的值 |
| `choices[].go` | 跳到哪个场景 |
| `choices[].end` | 为 true 表示这个结局直接结束 |
