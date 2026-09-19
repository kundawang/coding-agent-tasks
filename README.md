# saltroad

网页版跑商小游戏原型。目前只有地图、货物价格表和一趟的操作日志样例。

## 目录

```
index.html             页面入口（待实现）
js/                    前端代码
data/map.json          城镇与路线（距离、路费）
data/goods.json        货物基准价、重量、波动
samples/run_log.json   一趟的操作日志样例
```

## 本地起服务

```bash
python -m http.server 8080
```

## 环境

不装依赖、不做构建。纯逻辑（图、价格波动、库存与结算）用 Node 内置测试：

```bash
node --test
```
