# subtitle-review

内部字幕校对台。目前只有样例素材，页面还没写。

## 目录

```
index.html            页面入口（待实现）
js/                   前端代码
samples/demo.srt      样例字幕（生成器吐出来的原样文件）
samples/demo.wav      样例音频，30 秒
```

## 本地起服务

ES module 用 file:// 打不开，起个静态服务就行：

```bash
python -m http.server 8080
# 浏览器打开 http://localhost:8080/
```

## 环境

不装依赖、不做构建。纯逻辑想跑测试的话，Node 20+ 用内置的：

```bash
node --test
```
