# orbitkeep

网页版太空站管理原型：用有限的电和物资让船员活过规定天数。目前只有模块、船员数据和一份排班计划样例。

## 目录

```
index.html              页面入口（待实现）
js/                     前端代码
data/systems.json       模块（发电、制氧、水循环、温室、气闸）参数
data/crew.json          船员职业、消耗、技能
samples/plan.json       一份建造 + 排班计划样例
```

## 本地起服务

```bash
python -m http.server 8080
```

## 环境

不装依赖、不做构建。纯逻辑（tick 模拟、资源链、船员状态、事件、结算）用 Node 内置测试：

```bash
node --test
```
