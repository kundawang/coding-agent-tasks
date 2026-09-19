# curlbash

网页版冰壶式对战原型（双方轮流推石头，谁离圆心近谁得分）。目前只有场地、物理参数和一份投掷记录样例。

## 目录

```
index.html             页面入口（待实现）
js/                    前端代码
data/rink.json         冰面尺寸、圆心、每局石头数
data/physics.json      摩擦、碰撞、初速等参数
samples/shots.json     一局的投掷记录样例
```

## 本地起服务

```bash
python -m http.server 8080
```

## 环境

不装依赖、不做构建。纯逻辑（物理积分、碰撞、出界、计分、AI）用 Node 内置测试：

```bash
node --test
```
