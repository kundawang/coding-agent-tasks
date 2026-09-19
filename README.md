# cornerstore

街角小店的经营模拟，网页版。进货、上架、定价、应付顾客，关掉网页再回来生意还得接着做。

纯静态、无构建、无依赖。

## 目录

```
samples/goods.json   商品目录
samples/store.json   开店初始状态
```

## 商品格式

```json
{
  "id": "milk",
  "name": "鲜牛奶",
  "costCents": 320,
  "shelfLifeDays": 7,
  "popularity": 0.8,
  "slotSize": 1
}
```

| 字段 | 说明 |
|---|---|
| `costCents` | 进价，**单位是分**（整数） |
| `shelfLifeDays` | 保质期，过期只能丢 |
| `popularity` | 受欢迎程度，0~1，影响顾客买它的概率 |
| `slotSize` | 占几个货架位 |

价格一律**用分做整数运算**，界面上显示成元。

## 初始状态

```json
{
  "cashCents": 500000,
  "shelfSlots": 24,
  "dayLengthMs": 240000,
  "customersPerDay": 120,
  "stock": [{ "goodsId": "milk", "qty": 6, "boughtOnDay": 1 }]
}
```

`dayLengthMs` 是一天折算成多少真实毫秒（现在是 4 分钟 = 一天），这样试玩的时候不用等。
