# vaultcrawl

网页版地牢探索原型：地图每次按种子生成，视野有迷雾，一步一格地摸索着找出口。目前只有生成参数、实体表和一份种子样例。

## 目录

```
index.html              页面入口（待实现）
js/                     前端代码
data/gen.json           生成参数（房间数、尺寸、走廊、连通要求）
data/entities.json      敌人、物品、门的定义
samples/seed_demo.json  一个种子 + 一串移动指令
```

## 本地起服务

```bash
python -m http.server 8080
```

## 环境

不装依赖、不做构建。纯逻辑（生成、连通性校验、视野、AI、背包）用 Node 内置测试：

```bash
node --test
```
