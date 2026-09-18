# riftraid

网页版实时遭遇战（微型 RTS）原型：一小队单位对一小队单位。目前只有单位数值、场景和一份指令日志样例，模拟器与界面都还没写。

## 目录

```
index.html                 页面入口（待实现）
js/                        前端代码
data/units.json            单位数值（造价、血量、伤害、射程、速度）
data/scenario.json         地图尺寸、障碍、矿点、双方初始单位与资源
samples/command_log.json   一局的指令日志样例（用于验证同种子同结果）
```

## 本地起服务

```bash
python -m http.server 8080
# 浏览器打开 http://localhost:8080/
```

## 环境

不装依赖、不做构建。纯逻辑（寻路、指令、战斗、采集、AI）用 Node 内置测试：

```bash
node --test
```
