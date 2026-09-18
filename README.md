# depgraph

内部构建系统要用的**离线依赖解析模块**。目前只有骨架，代码还没写。

## 目录约定

```
depgraph/          模块代码放这里（入口 python -m depgraph ...）
tests/             自测用例
samples/           样例输入（包索引 + 根需求）
```

## 样例输入

```
samples/index.json              包索引
samples/requirements.txt        根需求
samples/conflict_index.json     会冲突的包索引
samples/conflict_requirements.txt
```

包索引的结构：

```json
{
  "packages": {
    "corelib": {
      "1.2.0": {"deps": {"utils": "^1.0.0"}},
      "2.0.0": {"deps": {}, "yanked": true}
    }
  }
}
```

根需求是每行一个 `<包名> <约束>`，`#` 开头是注释。

## 环境

只用标准库，Python 3.11+。自测：

```bash
python -m unittest discover -s tests
```
