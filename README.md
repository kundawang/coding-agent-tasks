# idleforge

网页版放置/增量游戏原型：关掉页面也在涨资源，回来一次性结算。目前只有建筑表、升级表和一份存档样例。

## 目录

```
index.html             页面入口（待实现）
js/                    前端代码
data/buildings.json    建筑（成本、产出、解锁条件）
data/upgrades.json     升级（倍率、前置）
samples/save_demo.json 存档样例（含离线结算用的时间戳）
```

## 本地起服务

```bash
python -m http.server 8080
```

## 环境

不装依赖、不做构建。纯逻辑（产出积分、离线结算、大数、存档迁移）用 Node 内置测试：

```bash
node --test
```
