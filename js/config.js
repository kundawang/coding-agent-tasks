// 读取 samples/ 下的原始商品目录和开店初始状态。
// 素材格式归 README 管，这里只取数，不改内容。

export async function loadConfig() {
  const [goodsRes, storeRes] = await Promise.all([
    fetch("samples/goods.json", { cache: "no-store" }),
    fetch("samples/store.json", { cache: "no-store" }),
  ]);
  if (!goodsRes.ok || !storeRes.ok) {
    throw new Error(`素材读取失败（HTTP ${goodsRes.status}/${storeRes.status}）`);
  }
  const goodsJson = await goodsRes.json();
  const storeJson = await storeRes.json();
  return { catalog: goodsJson.goods, defaults: storeJson };
}
