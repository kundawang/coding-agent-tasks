# edgejournal

现场巡检盒子的本地采集缓存。盒子上跑两个进程：

| 进程 | 干什么 |
|---|---|
| `collector` | 定时从传感器读值，往本地缓存里追加记录 |
| `uploader` | 定期把"还没上报过"的记录捞出来发到云端，发成功后标记为已上报 |

盒子在户外，网络时断时续，也经常被直接拔电。

## 数据模型

一条记录是一个对象：

```json
{
  "ts": 1789700123,
  "device": "box-01",
  "metric": "temp_c",
  "value": 23.5,
  "dedupKey": "box-01/temp_c/1789700123"
}
```

| 字段 | 说明 |
|---|---|
| `ts` | 采集时刻，整数秒（Unix 时间戳） |
| `device` | 盒子编号 |
| `metric` | 指标名 |
| `value` | 读数，number |
| `dedupKey` | 采集端生成的重试去重键，全局唯一；同一个 key 只应该存一条 |

## 交付物

```
bin/edgejournal.js    命令行入口
src/                  实现
FORMAT.md             存储格式说明
test/                 测试
```

命令一律这样调用（不装依赖、不走 npm 脚本）：

```bash
node bin/edgejournal.js <子命令> [参数]
```

## 预期的命令

```bash
node bin/edgejournal.js append var/store --input samples/records.jsonl
node bin/edgejournal.js scan   var/store --from 1789700000 --to 1789700200
node bin/edgejournal.js stats  var/store
node bin/edgejournal.js verify var/store
node --test
```

## 目录

```
samples/records.jsonl      一批样例记录（采集端导出的原始 JSONL）
samples/incident-notes.md  现场出过的事故记录，部署前请读一遍
```
