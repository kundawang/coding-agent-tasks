# apexgrid

网页版俯视角小赛车原型。目前只有赛道、车辆参数和一段输入日志样例，物理和界面都还没写。

## 目录

```
index.html             页面入口（待实现）
js/                    前端代码
data/tracks.json       赛道中心线、宽度、检查点
data/cars.json         车辆参数
samples/ghost.json     一圈的输入日志样例（用来做最佳圈回放）
```

## 本地起服务

```bash
python -m http.server 8080
# 浏览器打开 http://localhost:8080/
```

## 环境

不装依赖、不做构建。纯逻辑（车辆物理、赛道碰撞、检查点、回放）用 Node 内置测试：

```bash
node --test
```
