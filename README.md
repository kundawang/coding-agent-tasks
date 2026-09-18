# shardwake

网页版回合制炮击对战原型（同屏双人，地形可破坏）。目前只有地形和武器数据，物理与界面都还没写。

## 目录

```
index.html                页面入口（待实现）
js/                       前端代码
data/terrain.json         地形控制点（余弦插值成地面高度）
data/weapons.json         武器（伤害、爆炸半径、初速、弹药）
samples/replay_demo.json  一局的操作样例（用于验证同种子同结果）
```

## 本地起服务

```bash
python -m http.server 8080
# 浏览器打开 http://localhost:8080/
```

## 环境

不装依赖、不做构建。纯逻辑（地形插值、弹道积分、爆炸挖地、伤害衰减、坠落）用 Node 内置测试：

```bash
node --test
```
