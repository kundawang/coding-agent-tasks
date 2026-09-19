# deepdive

网页版深海采集原型：一罐氧气、一盏灯、一把钻头，下去捞货再活着上来。目前只有分区、装备数据和一份下潜记录样例。

## 目录

```
index.html             页面入口（待实现）
js/                    前端代码
data/zones.json        深度分区：资源、威胁、能见度
data/gear.json         装备：氧气、下潜/上浮速度、灯、钻头、背包
samples/route.json     一次下潜的操作记录样例
```

## 本地起服务

```bash
python -m http.server 8080
```

## 环境

不装依赖、不做构建。纯逻辑（氧气预算、深度、采集、威胁、结算）用 Node 内置测试：

```bash
node --test
```
