# turfclash

网页版"涂地"对战原型（把地面刷成自己的颜色，结束时颜色多的一方赢）。目前只有场地、单位数据和一局的输入日志样例。

## 目录

```
index.html              页面入口（待实现）
js/                     前端代码
data/arena.json         场地尺寸、障碍、出生点、判定规则
data/units.json         单位参数（速度、喷漆、墨水）
samples/input_log.json  一局的输入日志样例
```

## 本地起服务

```bash
python -m http.server 8080
```

## 环境

不装依赖、不做构建。纯逻辑（固定步长模拟、网格涂色、墨水、AI、结算）用 Node 内置测试：

```bash
node --test
```
