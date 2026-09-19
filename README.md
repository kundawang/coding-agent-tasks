# verdictcell

网页版审讯推理小游戏原型。目前只有一个案件的数据和一次审讯的日志样例。

## 目录

```
index.html                 页面入口（待实现）
js/                        前端代码
data/case_01.json          案件：人物、物证、对话节点、结局
samples/playthrough.json   一次审讯的操作日志样例
```

## 本地起服务

```bash
python -m http.server 8080
```

## 环境

不装依赖、不做构建。纯逻辑（对话推进、证据解锁、剧本校验、结局判定）用 Node 内置测试：

```bash
node --test
```
