# scriptduel

网页版"给机器人写指令然后自动对战"的原型。目前只有单位数值、指令集说明和一段示例程序，引擎和界面都还没写。

## 目录

```
index.html              页面入口（待实现）
js/                     前端代码
data/units.json         机器人数值
data/program_spec.json  可用指令与语义
samples/match_demo.json 一段示例程序 + 随机种子
```

## 本地起服务

```bash
python -m http.server 8080
# 浏览器打开 http://localhost:8080/
```

## 环境

不装依赖、不做构建。纯逻辑（指令解释器、模拟、重放）用 Node 内置测试：

```bash
node --test
```
