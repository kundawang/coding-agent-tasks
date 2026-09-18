# clueforge

网页版逻辑推理（斑马题）游戏原型：题目由程序生成，并保证唯一解。目前只有配置和一份题目样例，生成器与界面都还没写。

## 目录

```
index.html                 页面入口（待实现）
js/                        前端代码
data/puzzle_config.json    类别（人物/饮品/宠物/乐器）与难度档、线索类型
samples/puzzle_demo.json   一道题的格式样例（seed + 线索）
```

## 本地起服务

```bash
python -m http.server 8080
# 浏览器打开 http://localhost:8080/
```

## 环境

不装依赖、不做构建。纯逻辑（生成、求解、唯一性/最小性校验）用 Node 内置测试：

```bash
node --test
```
