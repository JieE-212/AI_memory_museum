"use strict";

const assert = require("node:assert/strict");
const {
  DHASH_ALGORITHM,
  computeDHash64,
  hammingDistance,
  classifySimilarity
} = require("../lib/media-similarity");

let assertions = 0;

function check(value, message) {
  assert.ok(value, message);
  assertions += 1;
}

function equal(actual, expected, message) {
  assert.equal(actual, expected, message);
  assertions += 1;
}

function deepEqual(actual, expected, message) {
  assert.deepEqual(actual, expected, message);
  assertions += 1;
}

function throws(action, message) {
  assert.throws(action, message);
  assertions += 1;
}

const black = computeDHash64({ pixels: solid(9, 8, 0, 0, 0), width: 9, height: 8 });
equal(black.algorithm, DHASH_ALGORITHM, "指纹应声明可迁移的算法版本");
equal(black.hash, "0000000000000000", "纯黑图的所有水平比较都应相等");
deepEqual(black.averageRgb, { r: 0, g: 0, b: 0 }, "应计算源图平均色");
equal(black.luminanceVariance, 0, "纯色图亮度方差应为零");
equal(black.aspectRatio, 9 / 8, "应保留源图宽高比");
check(Object.isFrozen(black) && Object.isFrozen(black.averageRgb), "指纹快照应不可变");

const white = computeDHash64({ pixels: solid(1, 1, 255, 255, 255), width: 1, height: 1 });
equal(white.hash, "0000000000000000", "最近邻放大纯白像素仍应全部相等");
deepEqual(white.averageRgb, { r: 255, g: 255, b: 255 }, "纯白图平均色应为白色");
equal(white.aspectRatio, 1, "方形图片宽高比应为 1");

const ascending = computeDHash64({
  pixels: rgba(9, 8, (x) => [x * 28, x * 28, x * 28, 255]),
  width: 9,
  height: 8
});
equal(ascending.hash, "0000000000000000", "从左到右变亮时 left > right 应全部为 0");

const descending = computeDHash64({
  pixels: rgba(9, 8, (x) => [255 - (x * 28), 255 - (x * 28), 255 - (x * 28), 255]),
  width: 9,
  height: 8
});
equal(descending.hash, "ffffffffffffffff", "从左到右变暗时 64 个比较位应全部为 1");

const firstBit = computeDHash64({
  pixels: rgba(9, 8, (x, y) => (x === 0 && y === 0 ? [255, 255, 255, 255] : [0, 0, 0, 255])),
  width: 9,
  height: 8
});
equal(firstBit.hash, "8000000000000000", "首个比较应写入最高位");

const lastBit = computeDHash64({
  pixels: rgba(9, 8, (x, y) => (x === 7 && y === 7 ? [255, 255, 255, 255] : [0, 0, 0, 255])),
  width: 9,
  height: 8
});
equal(lastBit.hash, "0000000000000001", "最后一个比较应写入最低位");

const areaReduced = computeDHash64({
  pixels: rgba(18, 16, (x) => {
    const value = 255 - (Math.floor(x / 2) * 28);
    return [value, value, value, 255];
  }),
  width: 18,
  height: 16
});
equal(areaReduced.hash, descending.hash, "2x2 分块图经整数面积缩小后应保持 dHash");

const nearestExpanded = computeDHash64({
  pixels: rgba(3, 2, (x) => {
    const value = [255, 128, 0][x];
    return [value, value, value, 255];
  }),
  width: 3,
  height: 2
});
equal(nearestExpanded.hash, "2424242424242424", "放大轴应使用像素中心最近邻且规则固定");

const mixedAxes = computeDHash64({
  pixels: rgba(18, 2, (x) => {
    const value = 255 - (Math.floor(x / 2) * 28);
    return [value, value, value, 255];
  }),
  width: 18,
  height: 2
});
equal(mixedAxes.hash, descending.hash, "一轴缩小、一轴放大时应分别应用面积与最近邻规则");

const transparentRed = computeDHash64({ pixels: solid(4, 4, 255, 0, 0, 0), width: 4, height: 4 });
const transparentBlue = computeDHash64({ pixels: solid(4, 4, 0, 0, 255, 0), width: 4, height: 4 });
equal(transparentRed.hash, transparentBlue.hash, "全透明像素的隐藏 RGB 不应影响哈希");
deepEqual(transparentRed.averageRgb, { r: 255, g: 255, b: 255 }, "全透明像素应确定性合成到白底");

const halfTransparentRed = computeDHash64({ pixels: solid(1, 1, 255, 0, 0, 128), width: 1, height: 1 });
deepEqual(halfTransparentRed.averageRgb, { r: 255, g: 127, b: 127 }, "半透明合成应采用固定整数舍入");

const blackAndWhite = computeDHash64({
  pixels: rgba(2, 1, (x) => (x === 0 ? [0, 0, 0, 255] : [255, 255, 255, 255])),
  width: 2,
  height: 1
});
deepEqual(blackAndWhite.averageRgb, { r: 128, g: 128, b: 128 }, "平均色应执行正数 half-up 舍入");
equal(blackAndWhite.luminanceVariance, 16256, "亮度方差应是整数亮度的四舍五入总体方差");

equal(hammingDistance("0000000000000000", "0000000000000000"), 0, "相同哈希距离应为零");
equal(hammingDistance("0000000000000000", "ffffffffffffffff"), 64, "完全相反的 64 位哈希距离应为 64");
equal(hammingDistance("8000000000000000", "0000000000000000"), 1, "单个位变化距离应为一");
equal(hammingDistance("ABCDEF0123456789", "abcdef0123456789"), 0, "十六进制大小写不应改变距离");
throws(() => hammingDistance("0", "0000000000000000"), "应拒绝长度错误的哈希");
throws(() => hammingDistance("gggggggggggggggg", "0000000000000000"), "应拒绝非十六进制哈希");
throws(() => hammingDistance(null, "0000000000000000"), "应拒绝非字符串哈希");

const policy = Object.freeze({
  maxHammingDistance: 8,
  maxAspectRatioDifference: 0.1,
  lowVarianceThreshold: 25,
  maxAverageRgbDistance: 40
});
const baseFingerprint = fingerprint("0000000000000000", { r: 100, g: 100, b: 100 }, 100, 1);
const exactSha = "a".repeat(64);
const otherSha = "b".repeat(64);

const exact = classifySimilarity({ sha256: exactSha }, { contentSha256: exactSha.toUpperCase() });
equal(exact.classification, "exact", "只有相同 SHA-256 才应直接判为 exact");
equal(exact.reason, "sha256_match", "精确匹配应说明证据来源");
equal(exact.isCandidate, false, "精确匹配不应降格为感知候选");
equal(exact.requiresReview, false, "相同内容哈希不需要近似候选复核");
check(Object.isFrozen(exact), "分类结果应为不可变快照");

const sameDHashDifferentSha = classifySimilarity(
  { ...baseFingerprint, sha256: exactSha },
  { ...baseFingerprint, sha256: otherSha },
  policy
);
equal(sameDHashDifferentSha.classification, "similar_candidate", "dHash 相同但 SHA 不同只能是近似候选");
equal(sameDHashDifferentSha.isExact, false, "感知哈希不得冒充字节级相同");
equal(sameDHashDifferentSha.requiresReview, true, "近似候选必须交由后续复核");
equal(sameDHashDifferentSha.metrics.hammingDistance, 0, "分类应公开汉明距离");

const atHammingBoundary = classifySimilarity(
  baseFingerprint,
  fingerprint("00000000000000ff", { r: 100, g: 100, b: 100 }, 100, 1),
  policy
);
equal(atHammingBoundary.isCandidate, true, "汉明距离等于调用方阈值时应保留候选");
equal(atHammingBoundary.metrics.hammingDistance, 8, "应正确报告边界汉明距离");

const beyondHammingBoundary = classifySimilarity(
  baseFingerprint,
  fingerprint("00000000000001ff", { r: 100, g: 100, b: 100 }, 100, 1),
  policy
);
equal(beyondHammingBoundary.classification, "not_candidate", "超过调用方汉明阈值时不应进入候选集");
equal(beyondHammingBoundary.checks.hammingDistance, false, "应公开未通过的哈希检查");

const aspectDelta = Math.abs(1 - 1.1) / 1.1;
const aspectAtBoundary = classifySimilarity(
  baseFingerprint,
  fingerprint("0000000000000000", { r: 100, g: 100, b: 100 }, 100, 1.1),
  { ...policy, maxAspectRatioDifference: aspectDelta }
);
equal(aspectAtBoundary.isCandidate, true, "宽高比相对差等于阈值时应保留候选");
equal(aspectAtBoundary.metrics.aspectRatioDifference, aspectDelta, "应公开相对宽高比差");

const aspectOutsideBoundary = classifySimilarity(
  baseFingerprint,
  fingerprint("0000000000000000", { r: 100, g: 100, b: 100 }, 100, 1.1),
  { ...policy, maxAspectRatioDifference: aspectDelta - Number.EPSILON }
);
equal(aspectOutsideBoundary.isCandidate, false, "宽高比差超过阈值时不应进入候选集");
equal(aspectOutsideBoundary.checks.aspectRatio, false, "应公开未通过的宽高比检查");

const lowVarianceColourBoundary = classifySimilarity(
  fingerprint("0000000000000000", { r: 0, g: 0, b: 0 }, 25, 1),
  fingerprint("0000000000000000", { r: 40, g: 0, b: 0 }, 100, 1),
  policy
);
equal(lowVarianceColourBoundary.isCandidate, true, "低方差图平均色距离等于阈值时可作为候选");
equal(lowVarianceColourBoundary.metrics.hasLowVariance, true, "任一图片低方差就应启用颜色约束");
equal(lowVarianceColourBoundary.metrics.averageRgbDistance, 40, "应公开平均色欧氏距离");

const flatButDifferentColour = classifySimilarity(
  fingerprint("0000000000000000", { r: 0, g: 0, b: 0 }, 0, 1),
  fingerprint("0000000000000000", { r: 41, g: 0, b: 0 }, 0, 1),
  policy
);
equal(flatButDifferentColour.classification, "not_candidate", "纯色图不能仅因 dHash 相同就成为近似候选");
equal(flatButDifferentColour.checks.lowVarianceColour, false, "应公开低方差颜色约束失败");

const texturedColourDifference = classifySimilarity(
  fingerprint("0000000000000000", { r: 0, g: 0, b: 0 }, 26, 1),
  fingerprint("0000000000000000", { r: 255, g: 255, b: 255 }, 26, 1),
  policy
);
equal(texturedColourDifference.isCandidate, true, "双方均高于低方差阈值时颜色不是额外门槛");
equal(texturedColourDifference.metrics.hasLowVariance, false, "高方差图片不应触发纯色保护");

const noShaCandidate = classifySimilarity(baseFingerprint, baseFingerprint, policy);
equal(noShaCandidate.isExact, false, "缺少 SHA-256 时不得判定精确相同");
equal(noShaCandidate.classification, "similar_candidate", "缺少 SHA 时仍可产生待复核近似候选");
deepEqual(noShaCandidate.thresholds, policy, "结果应记录调用方使用的阈值策略");

throws(() => classifySimilarity(baseFingerprint, baseFingerprint), "非精确比较必须显式提供阈值");
throws(
  () => classifySimilarity(baseFingerprint, baseFingerprint, { ...policy, maxHammingDistance: 65 }),
  "汉明阈值必须位于 0 到 64"
);
throws(
  () => classifySimilarity(baseFingerprint, baseFingerprint, { ...policy, maxAspectRatioDifference: -0.1 }),
  "宽高比阈值不能为负数"
);
throws(
  () => classifySimilarity(baseFingerprint, baseFingerprint, { ...policy, lowVarianceThreshold: NaN }),
  "方差阈值必须是有限数"
);
throws(
  () => classifySimilarity(baseFingerprint, baseFingerprint, { ...policy, maxAverageRgbDistance: 500 }),
  "平均色阈值不能超过 RGB 空间最大距离"
);
throws(
  () => classifySimilarity({ ...baseFingerprint, algorithm: "unknown-v1" }, baseFingerprint, policy),
  "不能比较算法版本不明的感知哈希"
);
throws(
  () => classifySimilarity({ ...baseFingerprint, sha256: "not-a-sha" }, baseFingerprint, policy),
  "提供的 SHA-256 必须合法而不能被静默忽略"
);
throws(
  () => classifySimilarity(
    { ...baseFingerprint, sha256: exactSha, contentSha256: otherSha },
    baseFingerprint,
    policy
  ),
  "同一输入中互相冲突的 SHA-256 字段应被拒绝"
);

throws(() => computeDHash64({ pixels: [], width: 1, height: 1 }), "应拒绝普通数组而非规范化字节视图");
throws(() => computeDHash64({ pixels: new Uint8Array(4), width: 0, height: 1 }), "应拒绝零宽图片");
throws(() => computeDHash64({ pixels: new Uint8Array(3), width: 1, height: 1 }), "应拒绝 RGBA 长度不一致");
throws(() => computeDHash64(null), "应拒绝空输入");

check(assertions >= 30, "回归测试至少应包含 30 条断言");
console.log(`Media similarity checks passed: ${assertions} assertions.`);

function fingerprint(hash, averageRgb, luminanceVariance, aspectRatio) {
  return {
    algorithm: DHASH_ALGORITHM,
    hash,
    averageRgb,
    luminanceVariance,
    aspectRatio
  };
}

function solid(width, height, red, green, blue, alpha = 255) {
  return rgba(width, height, () => [red, green, blue, alpha]);
}

function rgba(width, height, pixelAt) {
  const output = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const channels = pixelAt(x, y);
      const offset = ((y * width) + x) * 4;
      output[offset] = channels[0];
      output[offset + 1] = channels[1];
      output[offset + 2] = channels[2];
      output[offset + 3] = channels[3];
    }
  }
  return output;
}
