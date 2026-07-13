const assert = require("assert/strict");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const root = path.resolve(__dirname, "..");
const source = fs.readFileSync(path.join(root, "public/assets/media-compare.js"), "utf8");
const css = fs.readFileSync(path.join(root, "public/media-compare.css"), "utf8");
const context = vm.createContext({});
vm.runInContext(source, context, { filename: "media-compare.js" });
const api = context.TimeIsleMediaCompare;
let assertions = 0;

check("前端模块导出稳定接口", () => {
  assert.equal(typeof api, "object");
  assert.equal(typeof api.renderComparison, "function");
  assert.equal(typeof api.hydrate, "function");
  assert.equal(typeof api.createController, "function");
  assert.equal(typeof api.computeSimilarityTransform, "function");
  assert.equal(typeof api.applySimilarityTransform, "function");
  assert.equal(typeof api.normalizePoint, "function");
});

check("两点相似变换支持恒等映射", () => {
  const transform = api.computeSimilarityTransform(
    { x: 0, y: 0 },
    { x: 1, y: 0 },
    { x: 0, y: 0 },
    { x: 1, y: 0 }
  );
  near(transform.scale, 1);
  near(transform.rotationRadians, 0);
  near(transform.e, 0);
  near(transform.f, 0);
  const mapped = api.applySimilarityTransform(transform, { x: 0.25, y: 0.75 });
  near(mapped.x, 0.25);
  near(mapped.y, 0.75);
});

check("两点相似变换正确组合缩放旋转和平移", () => {
  const sourceA = { x: 1, y: 1 };
  const sourceB = { x: 3, y: 1 };
  const targetA = { x: 4, y: 5 };
  const targetB = { x: 4, y: 9 };
  const transform = api.computeSimilarityTransform(sourceA, sourceB, targetA, targetB);
  near(transform.scale, 2);
  near(transform.rotationDegrees, 90);
  near(transform.translation.x, 6);
  near(transform.translation.y, 3);
  assertPointNear(api.applySimilarityTransform(transform, sourceA), targetA);
  assertPointNear(api.applySimilarityTransform(transform, sourceB), targetB);
  assertPointNear(api.applySimilarityTransform(transform, { x: 2, y: 2 }), { x: 2, y: 7 });
});

check("相似变换允许任意方向并保持有限矩阵", () => {
  const transform = api.computeSimilarityTransform(
    { x: 12, y: -4 },
    { x: -2, y: 7 },
    { x: 0.2, y: 0.8 },
    { x: 0.9, y: 0.1 }
  );
  for (const key of ["a", "b", "c", "d", "e", "f", "scale", "rotationRadians"]) {
    assert.equal(Number.isFinite(transform[key]), true);
  }
  assertPointNear(api.applySimilarityTransform(transform, { x: 12, y: -4 }), { x: 0.2, y: 0.8 });
  assertPointNear(api.applySimilarityTransform(transform, { x: -2, y: 7 }), { x: 0.9, y: 0.1 });
});

check("重合点不能伪造对齐参数", () => {
  assert.throws(
    () => api.computeSimilarityTransform(
      { x: 0, y: 0 },
      { x: 0, y: 0 },
      { x: 0, y: 0 },
      { x: 1, y: 1 }
    ),
    (error) => error?.name === "RangeError" && error.code === "DEGENERATE_POINTS"
  );
  assert.throws(
    () => api.computeSimilarityTransform(
      { x: 0, y: 0 },
      { x: 1, y: 1 },
      { x: 0.5, y: 0.5 },
      { x: 0.5, y: 0.5 }
    ),
    (error) => error?.name === "RangeError" && error.code === "DEGENERATE_POINTS"
  );
});

check("规范化坐标被限制在零到一且拒绝无效值", () => {
  assert.deepEqual(plain(api.normalizePoint({ x: -0.25, y: 1.6 })), { x: 0, y: 1 });
  assert.deepEqual(plain(api.normalizePoint({ x: "0.125", y: "0.875" })), { x: 0.125, y: 0.875 });
  assert.equal(api.normalizePoint({ x: "", y: 0.5 }), null);
  assert.equal(api.normalizePoint({ x: "   ", y: 0.5 }), null);
  assert.equal(api.normalizePoint({ x: true, y: 0.5 }), null);
  assert.equal(api.normalizePoint({ x: Number.NaN, y: 0.5 }), null);
  assert.equal(api.normalizePoint(null), null);
});

const markup = api.renderComparison({
  title: "旧站台与新站台",
  description: "只比较可见线索，不替用户下结论。",
  left: [
    {
      assetId: "left-a",
      urls: { display: "/api/media/left-a/display", original: "/api/media/left-a/original" },
      caption: "1998 年的站台",
      altText: "雨后站台旁站着两个人",
      width: 1200,
      height: 800
    },
    {
      assetId: "left-b",
      urls: { display: "/api/media/left-b/display" },
      caption: "另一张旧照片"
    }
  ],
  right: {
    media: [{
      assetId: "right-a",
      urls: { display: "/api/media/right-a/display", original: "/api/media/right-a/original" },
      caption: "今天的站台",
      altText: "同一视角下的站台建筑",
      width: 1600,
      height: 900
    }]
  }
}, escapeHtml);

check("默认界面是清爽的两图并排且可以选图", () => {
  assert.match(markup, /class="media-compare-pair"/);
  assert.equal(count(markup, /data-compare-side="(?:left|right)"/g), 2);
  assert.equal(count(markup, /data-compare-figure="(?:left|right)"/g), 2);
  assert.equal(count(markup, /data-compare-select="(?:left|right)"/g), 2);
  assert.match(markup, /1998 年的站台/);
  assert.match(markup, /今天的站台/);
  assert.match(markup, /查看原图/);
  assert.doesNotMatch(markup.match(/<details[^>]*>/)?.[0] || "", /\sopen(?:\s|>|=)/);
});

check("叠影作为用户显式展开的增强视图", () => {
  assert.match(markup, /<details class="media-compare-overlay"/);
  assert.match(markup, /手动叠影/);
  assert.match(markup, /可选增强视图/);
  assert.match(markup, /type="range"[^>]*data-compare-opacity/);
  assert.match(markup, /<canvas[^>]*data-compare-canvas/);
  assert.match(markup, /手动对齐，不是自动识别/);
  assert.match(markup, /不会判断两张照片是否来自同一地点或事件/);
  assert.doesNotMatch(markup, /AI 已识别|自动匹配成功|自动对齐完成|相似度\s*\d+%/);
});

check("鼠标标点和键盘坐标输入拥有同等完整结构", () => {
  assert.equal(count(markup, /data-compare-point-choice="(?:left|right)[12]"/g), 4);
  assert.equal(count(markup, /data-compare-marker="(?:left|right)[12]"/g), 4);
  assert.equal(count(markup, /data-compare-point="(?:left|right)[12]"/g), 8);
  assert.equal(count(markup, /data-compare-coordinate="[xy]"/g), 8);
  assert.equal(count(markup, /min="0" max="1" step="0\.001"/g), 8);
  assert.match(markup, /键盘坐标后备/);
  assert.match(markup, /0 到 1 的规范化坐标/);
});

check("模块提供撤销重置和非 Canvas 信息通道", () => {
  assert.match(markup, /data-compare-action="undo"/);
  assert.match(markup, /data-compare-action="reset"/);
  assert.match(markup, /aria-live="polite"/);
  assert.match(markup, /原图、替代文字与照片说明仍保留在上方/);
  assert.match(markup, /Canvas 不是理解这些照片的唯一入口/);
  assert.match(source, /state\.history/);
  assert.match(source, /MAX_HISTORY/);
});

check("异步图片加载隔离并给出跨域失败占位", () => {
  assert.match(source, /run !== state\.overlayRun/);
  assert.match(source, /image\.dataset\.compareLoadRun/);
  assert.match(source, /crossOrigin = "anonymous"/);
  assert.match(source, /跨域图片需允许匿名读取/);
  assert.match(source, /原图与说明仍可在上方查看/);
  assert.match(source, /invalidateOverlay/);
});

check("渲染会转义文字并拒绝脚本图片地址", () => {
  const hostile = api.renderComparison({
    title: "<img src=x onerror=alert(1)>",
    left: [{ caption: "<script>alert(1)</script>", urls: { display: "javascript:alert(1)" } }],
    right: [{ caption: "safe", urls: { display: "/safe.webp" } }]
  }, escapeHtml);
  assert.doesNotMatch(hostile, /<script>alert/);
  assert.doesNotMatch(hostile, /<img src=x onerror/);
  assert.doesNotMatch(hostile, /javascript:/);
  assert.match(hostile, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
});

check("空图片列表保持可读占位而不崩溃", () => {
  const empty = api.renderComparison({ left: [], right: [] }, escapeHtml);
  assert.equal(count(empty, /该侧暂无可用于对照的图片/g), 2);
  assert.equal(count(empty, /data-empty="true"/g), 2);
  assert.equal(count(empty, /data-compare-select="(?:left|right)" disabled/g), 2);
});

check("样式保持简洁、响应式并覆盖键盘焦点", () => {
  assert.match(css, /\.media-compare-pair/);
  assert.match(css, /grid-template-columns:\s*repeat\(2/);
  assert.match(css, /\.media-compare-canvas-frame/);
  assert.match(css, /:focus-visible/);
  assert.match(css, /@media \(max-width: 560px\)/);
  assert.match(css, /@media \(forced-colors: active\)/);
  assert.doesNotMatch(css, /gradient\s*\(/i);
  assert.doesNotMatch(css, /animation\s*:/i);
});

check("实现规模受控且没有测试钩子混入正式模块", () => {
  assert.ok(source.split(/\r?\n/).length < 900);
  assert.ok(css.split(/\r?\n/).length < 500);
  assert.doesNotMatch(source, /__test|TEST_ONLY|fixture/i);
});

console.log(`Media compare checks passed: ${assertions} assertions.`);

function check(name, callback) {
  try {
    const before = assertions;
    callback();
    if (assertions === before) assertions += 1;
    console.log(`ok - ${name}`);
  } catch (error) {
    console.error(`not ok - ${name}`);
    throw error;
  }
}

function near(actual, expected, epsilon = 1e-9) {
  assertions += 1;
  assert.ok(Math.abs(actual - expected) <= epsilon, `expected ${actual} to be near ${expected}`);
}

function assertPointNear(actual, expected) {
  near(actual.x, expected.x);
  near(actual.y, expected.y);
}

function count(value, expression) {
  return (value.match(expression) || []).length;
}

function plain(value) {
  return value === null ? null : JSON.parse(JSON.stringify(value));
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
