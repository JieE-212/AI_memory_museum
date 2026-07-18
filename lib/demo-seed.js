"use strict";

const { buildExhibitionPreview } = require("./exhibition-curator");

const DEMO_EXHIBITION_ID = "demo-companionship-exhibition";
const DEMO_TIME_EVENT_ID = "demo-campus-time-event";
const DEMO_MEMORIES = Object.freeze([
  Object.freeze({
    id: "demo-campus-farewell",
    title: "操场尽头的告别",
    hall: "youth",
    sourceType: "日记",
    rawContent: "2021年6月18日毕业那天傍晚，我和阿棠在学校操场尽头站了很久。大家都说以后常联系，但真正想说的话反而没有说出口。",
    exhibitText: "毕业傍晚的操场保存了青春快结束时的重量：热闹散去以后，沉默也成了一种告别。",
    date: "2021-06-18",
    location: "学校操场",
    people: ["阿棠", "同学"],
    tags: ["毕业", "校园", "告别"],
    emotions: ["怀念", "遗憾"],
    emotionIntensity: 4,
    importance: 4,
    favorite: true
  }),
  Object.freeze({
    id: "demo-family-noodles",
    title: "凌晨到家的一碗面",
    hall: "family",
    sourceType: "日记",
    rawContent: "有次出差很晚才到家，妈妈没有多问，只把厨房里温着的面端出来。那一刻突然觉得，回家是有人替你留着一盏灯。",
    exhibitText: "一碗深夜的面，把家最具体的样子留了下来：不追问理由，只先照顾疲惫。",
    date: "2023-11-02",
    location: "家里",
    people: ["妈妈"],
    tags: ["家人", "回家", "饭桌"],
    emotions: ["温暖", "感动"],
    emotionIntensity: 5,
    importance: 4,
    favorite: true
  }),
  Object.freeze({
    id: "demo-campus-farewell-later",
    title: "后来写下的毕业傍晚",
    hall: "youth",
    sourceType: "日记",
    rawContent: "几年后整理旧日记，我又写起2021年6月19日的毕业傍晚：我和阿棠在学校操场尽头告别。可旧照片标注的是6月18日，所以我决定先保留日期的不确定。",
    exhibitText: "同一场毕业告别在几年后被重新写下；人物和地点仍然清晰，日期却出现了一天的偏差。",
    date: "2021-06-19",
    location: "学校操场",
    people: ["阿棠", "同学"],
    tags: ["毕业", "校园", "告别", "后来重写"],
    emotions: ["怀念", "释然"],
    emotionIntensity: 3,
    importance: 4,
    favorite: false
  }),
  Object.freeze({
    id: "demo-friend-call",
    title: "低谷里打来的电话",
    hall: "friends",
    sourceType: "聊天片段",
    rawContent: "最迷茫的那段时间，一个朋友突然打来电话。他没有劝我振作，只陪我把混乱的话说完。后来想起，真正的帮助有时只是没有提前挂断。",
    exhibitText: "这通电话没有解决所有问题，却留下了陪伴最可信的证据：在混乱被说完以前，对方一直都在。",
    date: "2022-09",
    location: "",
    people: ["朋友"],
    tags: ["朋友", "陪伴", "低谷"],
    emotions: ["迷茫", "温暖"],
    emotionIntensity: 4,
    importance: 4,
    favorite: true
  })
]);

function seedInterviewDemoData(options = {}) {
  if (!options.enabled) return { memories: 0, exhibitions: 0 };
  const { store, normalizeMemory, buildAgentWorkflow } = options;
  if (!store || typeof normalizeMemory !== "function" || typeof buildAgentWorkflow !== "function") {
    throw new TypeError("Demo seed requires store, normalizeMemory and buildAgentWorkflow.");
  }
  if (store.listMemories().length) return { memories: 0, exhibitions: 0 };

  const now = typeof options.now === "function" ? options.now : Date.now;
  DEMO_MEMORIES.forEach((sample, index) => {
    const memory = normalizeMemory({ ...sample, createdAt: new Date(now() - index * 3600000).toISOString() });
    if (index === 0) attachExampleAgentRun(store, memory, buildAgentWorkflow);
    store.saveMemory(memory);
    if (memory.agentRunId) store.attachAgentRunToMemory(memory.agentRunId, memory.id);
  });

  let seededEvents = 0;
  let seededTimeCalibrations = 0;
  if (typeof store.saveArchaeologyConfirmation === "function" && typeof store.getEventCalibrationWorkspace === "function") {
    const campusIds = ["demo-campus-farewell", "demo-campus-farewell-later"];
    const confirmation = store.saveArchaeologyConfirmation({
      event: {
        eventId: DEMO_TIME_EVENT_ID,
        memoryIds: campusIds,
        title: "操场告别的两种日期记录",
        summary: "两段记录共享人物与地点，但日期相差一天；Demo 只保留来源差异，不裁决哪一天是真相。",
        confirmedBy: "demo-seed"
      },
      pairDecision: {
        memoryAId: campusIds[0],
        memoryBId: campusIds[1],
        decision: "same_event",
        rationale: "公开 Demo 的虚构版本对照样例。",
        evidence: []
      },
      claimsByMemory: {}
    });
    seededEvents = 1;
    const workspace = store.getEventCalibrationWorkspace(confirmation.event.id);
    const selectedSourceKeys = workspace.candidates
      .filter((candidate) => candidate.sourceType === "memory-current" && campusIds.includes(candidate.memoryId))
      .map((candidate) => candidate.sourceKey);
    if (selectedSourceKeys.length >= 2) {
      store.saveEventTimeCalibration(confirmation.event.id, {
        resolutionKind: "alternatives",
        intervalStart: "",
        intervalEnd: "",
        selectedSourceKeys,
        sourceSetSha256: workspace.sourceSetSha256,
        note: "保留 6 月 18 日与 6 月 19 日两种文字记录，暂不判断哪一种更准确。"
      });
      seededTimeCalibrations = 1;
    }
  }

  const seededMemories = new Map(store.listMemories().map((memory) => [memory.id, memory]));
  const featuredMemories = ["demo-campus-farewell", "demo-family-noodles", "demo-friend-call"]
    .map((id) => seededMemories.get(id))
    .filter(Boolean);
  const preview = buildExhibitionPreview(featuredMemories, {
    title: "那些被陪伴接住的时刻",
    theme: "陪伴",
    opening: "三件来自校园、家庭与朋友的示例展品，帮助你体验可核对引用、胶囊封存与浏览器内加密分享。"
  });
  const draft = store.createExhibition({ ...preview, id: DEMO_EXHIBITION_ID, confirm: true });
  store.updateExhibition(draft.id, { ...draft, status: "published", confirm: true });
  return { memories: DEMO_MEMORIES.length, exhibitions: 1, events: seededEvents, timeCalibrations: seededTimeCalibrations };
}

function attachExampleAgentRun(store, memory, buildAgentWorkflow) {
  const workflow = buildAgentWorkflow(memory, memory.rawContent, "mock-seed");
  workflow.run.memoryId = memory.id;
  const savedRun = store.saveAgentRun(workflow, {
    rawContent: memory.rawContent,
    mode: "mock-seed",
    memoryId: memory.id
  });
  memory.agentRunId = savedRun.id;
}

module.exports = { DEMO_EXHIBITION_ID, DEMO_MEMORIES, DEMO_TIME_EVENT_ID, seedInterviewDemoData };
