# embervault

网页版卡牌战斗原型。目前只有规则数据和样例，页面与引擎都还没写。

## 目录

```
index.html                页面入口（待实现）
js/                       前端代码
data/cards.json           卡牌定义 + 起始牌组
data/relics.json          遗物定义
data/enemies.json         敌人与意图脚本
samples/replay_demo.json  回放样例（seed + 操作序列）
```

## 本地起服务

ES module 用 file:// 打不开，起个静态服务：

```bash
python -m http.server 8080
# 浏览器打开 http://localhost:8080/
```

## 环境

不装依赖、不做构建。纯逻辑（随机数、伤害结算、洗牌、回放）想跑测试的话用 Node 内置的：

```bash
node --test
```
