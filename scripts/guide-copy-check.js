"use strict";

const assert = require("node:assert/strict");
const { buildGuideCitationLine } = require("../lib/guide-copy");

assert.equal(
  buildGuideCitationLine({ title: "凌晨到家的一碗面", exhibitText: "一碗深夜的面，把家最具体的样子留了下来。" }, 0),
  "[1]《凌晨到家的一碗面》讲的是一碗深夜的面，把家最具体的样子留了下来。"
);
assert.equal(
  buildGuideCitationLine({ title: "晚风", exhibitText: "这件展品记录了操场边的晚风。。" }, 1),
  "[2]《晚风》讲的是操场边的晚风。"
);
assert.equal(
  buildGuideCitationLine({ title: "旧照片", exhibitText: "", rawContent: "记录了窗边的雨！！" }, 2),
  "[3]《旧照片》讲的是窗边的雨。"
);
assert.equal(
  buildGuideCitationLine({ title: "空展签", exhibitText: "", rawContent: "" }, 3),
  "[4]《空展签》暂时没有可引用的文字。"
);

for (const line of [
  buildGuideCitationLine({ title: "晚风", exhibitText: "这件展品记录了操场边的晚风。。" }, 0),
  buildGuideCitationLine({ title: "旧照片", rawContent: "记录了窗边的雨！！" }, 1)
]) {
  assert.doesNotMatch(line, /记录了这件展品记录了|[。！？!?；;,，]{2,}/u);
}

console.log("Guide copy checks passed.");
