# gridfall

网页版回合制战术（战棋）原型。目前只有兵种、地图和样例，页面与战斗引擎都还没写。

## 目录

```
index.html            页面入口（待实现）
js/                   前端代码
data/units.json       兵种数值
data/map_01.json      关卡地图（ASCII 网格 + 部署点）
data/orders.json      一局的操作样例（用于验证"同种子同结果"）
```

## 本地起服务

```bash
python -m http.server 8080
# 浏览器打开 http://localhost:8080/
```

## 环境

不装依赖、不做构建。纯逻辑（寻路、视线、伤害、回合队列、AI）用 Node 内置测试：

```bash
node --test
```
