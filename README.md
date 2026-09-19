# formforge

Schema 驱动的配置编辑器，网页版。配置怎么长、能填什么，全由一份 schema 决定；改完能对比、能导出。

纯静态、无构建、无依赖。

## 目录

```
samples/schema.json   配置的 schema（我们内部用的简化版）
samples/config.json   一份真实配置
samples/config-v2.json 改过一版的配置（用来对比）
```

## schema 支持的写法

```json
{
  "type": "object",
  "fields": {
    "name": { "type": "string", "required": true, "maxLength": 40 },
    "port": { "type": "int", "min": 1, "max": 65535, "default": 8080 },
    "mode": { "type": "enum", "options": ["fast", "safe"], "default": "safe" },
    "timeout": { "type": "float", "min": 0.1, "max": 60 },
    "tags": { "type": "array", "items": { "type": "string" }, "maxItems": 8 },
    "limits": {
      "type": "object",
      "fields": {
        "qps": { "type": "int", "min": 0 },
        "burst": { "type": "int", "min": 0 }
      },
      "required": true
    },
    "enabled": { "type": "bool", "default": true }
  }
}
```

要支持的类型：`string` / `int` / `float` / `bool` / `enum` / `array` / `object`。
`object` 可以嵌套。`required` 可以写在字段上，也可以写在对象上（对象上是"这个对象的必填子字段列表"）。
