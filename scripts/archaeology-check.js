"use strict";

const assert = require("node:assert/strict");
const {
  buildConnections,
  buildPuzzle,
  buildCuratorQuestion,
  buildFeaturedRoute
} = require("../lib/archaeology");
const { buildArchaeologyBackup, validateArchaeologyBackup } = require("../lib/archaeology-backup");

const memories = [
  {
    id: "rainy-graduation",
    title: "毕业那天",
    rawContent: "2019年6月1日，我和阿棠在杭州湖边告别。雨很轻，我既遗憾又温暖。",
    exhibitText: "毕业季的一场雨和一次告别。",
    date: "2019-06-01",
    location: "杭州湖边",
    people: ["阿棠"],
    tags: ["毕业", "告别"],
    emotions: ["遗憾", "温暖"],
    importance: 5,
    favorite: true
  },
  {
    id: "graduation-letter",
    title: "没有寄出的信",
    rawContent: "2019年6月1日，我在杭州湖边把写给阿棠的信放回口袋，那是毕业时最后一次见面。",
    exhibitText: "一封没有寄出的毕业信。",
    date: "2019-06-01",
    location: "杭州湖边",
    people: ["阿棠"],
    tags: ["毕业", "书信"],
    emotions: ["遗憾"],
    importance: 4
  },
  {
    id: "kitchen-light",
    title: "厨房的灯",
    rawContent: "冬夜回家，厨房还亮着灯，锅里留着热汤。",
    exhibitText: "深夜里的一盏灯。",
    date: "2022-12",
    location: "家",
    people: [],
    tags: ["日常"],
    emotions: ["温暖"],
    importance: 3
  }
];

const connections = buildConnections(memories, { focusId: "rainy-graduation", limit: 3 });
assert.equal(connections.status, "ready");
assert.equal(connections.focus.id, "rainy-graduation");
assert.equal(connections.connections[0].memory.id, "graduation-letter");
assert.equal(connections.connections[0].strength, "strong", "多项共同线索应形成强关联");
assert.ok(connections.connections[0].reasons.some((reason) => reason.type === "people"));
assert.equal(connections.connections[0].sameEvent, "unassessed", "不得自动认定为同一事件");

const weakConnection = connections.connections.find((item) => item.memory.id === "kitchen-light");
assert.ok(weakConnection, "单一情绪线索仍可作为弱漫游线索");
assert.equal(weakConnection.strength, "weak");

const puzzle = buildPuzzle(
  {
    id: "left",
    title: "第一版",
    rawContent: "2019年6月1日，我和阿棠在杭州湖边散步，心里很温暖。",
    date: "2019-06-01",
    location: "杭州湖边",
    people: ["阿棠"],
    tags: ["毕业"],
    emotions: ["温暖"]
  },
  {
    id: "right",
    title: "第二版",
    rawContent: "2019年6月2日，我和阿棠在苏州河边散步，也感到温暖。",
    date: "2019-06-02",
    location: "苏州河边",
    people: ["阿棠"],
    tags: [],
    emotions: ["温暖"]
  }
);

assert.ok(puzzle.stable.some((item) => item.field === "people"));
assert.ok(puzzle.differs.some((item) => item.field === "date"));
assert.ok(puzzle.differs.some((item) => item.field === "location"));

const doubleDigitDayPuzzle = buildPuzzle(
  {
    id: "day-eighteen",
    title: "十八日版本",
    rawContent: "2021年6月18日，我们在操场告别。",
    date: "2021-06-18"
  },
  {
    id: "day-nineteen",
    title: "十九日版本",
    rawContent: "2021年6月19日，我们在操场告别。",
    date: "2021-06-19"
  }
);
const doubleDigitDateDifference = doubleDigitDayPuzzle.differs.find((item) => item.field === "date");
assert.deepEqual(doubleDigitDateDifference?.values, ["2021-06-18", "2021-06-19"], "两位数日期不能被截成同一天");

const rawById = {
  left: "2019年6月1日，我和阿棠在杭州湖边散步，心里很温暖。",
  right: "2019年6月2日，我和阿棠在苏州河边散步，也感到温暖。"
};
for (const group of [puzzle.stable, puzzle.differs, puzzle.additions, puzzle.unknowns]) {
  for (const item of group) {
    for (const source of item.sources) {
      if (!source.valid) continue;
      assert.equal(
        rawById[source.memoryId].slice(source.start, source.end),
        source.sourceQuote,
        "合法引用必须可由原文位置复核"
      );
      assert.ok(source.sourceQuote.length <= 120, "引用文本必须受长度限制");
    }
  }
}

const missingIsNotDifference = buildPuzzle(
  {
    id: "known-place",
    title: "写下地点",
    rawContent: "那天我在北京车站等了很久。",
    location: "北京车站"
  },
  {
    id: "unknown-place",
    title: "没有地点",
    rawContent: "那天我等了很久。",
    location: ""
  }
);
assert.ok(!missingIsNotDifference.differs.some((item) => item.field === "location"), "缺失不能被当作差异");
assert.ok(missingIsNotDifference.additions.some((item) => item.field === "location"));

const partialDateIsRefinement = buildPuzzle(
  { id: "year-only", rawContent: "我只记得那是在2019年。", date: "2019" },
  { id: "month-known", rawContent: "后来想起是在2019年6月。", date: "2019-06" }
);
assert.ok(!partialDateIsRefinement.differs.some((item) => item.field === "date"), "较精确的日期是补充，不是矛盾");
assert.ok(partialDateIsRefinement.additions.some((item) => item.field === "date"));

const curatorQuestion = buildCuratorQuestion(puzzle);
assert.equal(curatorQuestion.available, true);
assert.equal(typeof curatorQuestion.question, "string");
assert.ok(curatorQuestion.question.length > 0 && curatorQuestion.question.length <= 180);
assert.ok(curatorQuestion.allowUnknown);
assert.equal(curatorQuestion.actions.filter((action) => action.id === "keep_unknown").length, 1);
assert.ok(!Array.isArray(curatorQuestion.question), "每次只生成一个问题");

const emptyConnections = buildConnections([], { focusId: "missing" });
assert.equal(emptyConnections.status, "focus_not_found");
assert.deepEqual(emptyConnections.connections, []);

const emptyRoute = buildFeaturedRoute([]);
assert.equal(emptyRoute.status, "empty_collection");
assert.deepEqual(emptyRoute.items, []);
assert.deepEqual(emptyRoute.transitions, []);

const route = buildFeaturedRoute(memories);
assert.equal(route.status, "ready");
assert.ok(route.items.length >= 2 && route.items.length <= 4);
assert.equal(route.transitions.length, route.items.length - 1);
assert.ok(route.transitions.every((transition) => transition.sameEvent === "unassessed"));

assert.doesNotThrow(() => JSON.stringify({ connections, puzzle, curatorQuestion, route }));

const redactedBackup = buildArchaeologyBackup({
  listMemoryEvents: () => [{ id: "private-event" }],
  listCuratorQuestions: () => [{ id: "private-question" }]
}, [], "redacted");
assert.doesNotThrow(() => validateArchaeologyBackup(redactedBackup, []), "规范脱敏摘要可独立验真");
assert.throws(
  () => validateArchaeologyBackup({ ...redactedBackup, claims: [{ quote: "不应夹带原文" }] }, []),
  /字段集合无效/u,
  "脱敏考古摘要拒绝夹带 claims 或未知字段"
);
assert.throws(
  () => validateArchaeologyBackup({ ...redactedBackup, note: "自定义说明" }, []),
  /说明无效/u,
  "脱敏考古摘要固定说明不能被替换"
);

console.log("archaeology-check: all assertions passed");
