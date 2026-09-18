# beltworks

网页版工厂流水线小游戏原型。目前只有机器/配方/关卡数据和一份蓝图样例，模拟器和界面都还没写。

## 目录

```
index.html                  页面入口（待实现）
js/                         前端代码
data/machines.json          机器定义（周期、传送带速度）
data/recipes.json           配方（输入/输出）
data/levels.json            关卡：网格尺寸、矿脉、出口、目标产量、时限
samples/blueprint_demo.json 一份蓝图样例（用于验证保存/载入）
```

## 本地起服务

```bash
python -m http.server 8080
# 浏览器打开 http://localhost:8080/
```

## 环境

不装依赖、不做构建。纯逻辑（tick 模拟、传送带推进、配方结算、产量统计）用 Node 内置测试：

```bash
node --test
```
