# reviewpad

离线可用的代码评审标注器，网页版。把 diff 粘进来，逐行留批注，导出成一份能发出去的评审记录。

纯静态、无构建、无依赖。

## 目录

```
samples/diff.patch      一段真实的 unified diff
samples/comments.json   已经留过的批注（用来验证"导回来还能对上"）
```

## 批注要锚在哪儿

一条批注必须锚在 **新版本文件的某一行** 上（`newLine`），同时记下它对应的旧行号（`oldLine`，可能为空）。
文件重命名、追加、删除都要能正确对上，锚错了整份评审就没法看。

```json
{
  "file": "src/queue.js",
  "newLine": 42,
  "oldLine": 37,
  "side": "new",
  "body": "这里没有处理队列为空的场景",
  "author": "me"
}
```

## diff 格式

`samples/diff.patch` 是标准的 unified diff（`git diff` 的输出），包含：
多个文件、新增文件、删除文件、重命名、`hunk` 前有上下文行、有的 hunk 被截断（`\ No newline at end of file`）。
