"use strict";

const MAX_EVENTS = 500;
const MAX_MEMBERS_PER_EVENT = 50;
const MAX_CLAIMS = 5000;
const MAX_QUESTIONS = 1000;
const REDACTED_NOTE = "版本关系、原文证据和补充回答已从脱敏导出中移除。";
const REDACTED_KEYS = Object.freeze(["eventCount", "mode", "note", "questionCount"]);

function buildArchaeologyBackup(store, memories, mode) {
  const events = store.listMemoryEvents();
  if (mode === "redacted") {
    return redactArchaeologyBackup({
      eventCount: events.length,
      questionCount: store.listCuratorQuestions().length
    });
  }
  const decisions = [];
  const seenPairs = new Set();
  events.forEach((event) => {
    const ids = event.members.map((member) => member.memoryId);
    ids.forEach((leftId, index) => ids.slice(index + 1).forEach((rightId) => {
      const decision = store.getPairDecision(leftId, rightId);
      if (!decision || seenPairs.has(decision.pairKey)) return;
      seenPairs.add(decision.pairKey);
      decisions.push(decision);
    }));
  });
  return {
    mode: "full",
    events: events.map((event) => ({
      id: event.id,
      title: event.title,
      summary: event.summary,
      status: event.status,
      metadata: event.metadata,
      createdAt: event.createdAt,
      updatedAt: event.updatedAt,
      members: event.members.map((member) => ({
        memoryId: member.memoryId,
        position: member.position,
        relation: member.relation,
        confirmationNote: member.confirmationNote,
        confirmedAt: member.confirmedAt,
        metadata: member.metadata
      }))
    })),
    claims: memories.flatMap((memory) => store.getMemoryClaims(memory.id)),
    pairDecisions: decisions,
    questions: store.listCuratorQuestions()
  };
}

function redactArchaeologyBackup(backup = {}) {
  const summary = {
    mode: "redacted-summary",
    eventCount: Number.isSafeInteger(backup.eventCount) ? backup.eventCount : (Array.isArray(backup.events) ? backup.events.length : 0),
    questionCount: Number.isSafeInteger(backup.questionCount) ? backup.questionCount : (Array.isArray(backup.questions) ? backup.questions.length : 0),
    note: REDACTED_NOTE
  };
  validateArchaeologyBackup(summary, []);
  return summary;
}

function validateArchaeologyBackup(backup, sourceMemoryIds) {
  if (!backup || typeof backup !== "object" || Array.isArray(backup)) throw new Error("记忆考古备份格式无效。");
  const memoryIds = Array.isArray(sourceMemoryIds) ? sourceMemoryIds : [];
  const memorySet = new Set(memoryIds);
  if (memorySet.size !== memoryIds.length) throw new Error("带记忆考古数据的备份不能包含重复展品 ID。");
  if (backup.mode === "redacted-summary") {
    assertExactKeys(backup, REDACTED_KEYS, "脱敏记忆考古摘要");
    requireCount(backup.eventCount, MAX_EVENTS, "eventCount");
    requireCount(backup.questionCount, MAX_QUESTIONS, "questionCount");
    if (backup.note !== REDACTED_NOTE) throw new Error("脱敏记忆考古摘要说明无效。");
    return true;
  }
  const events = arrayWithin(backup.events, MAX_EVENTS, "events");
  const claims = arrayWithin(backup.claims, MAX_CLAIMS, "claims");
  const decisions = arrayWithin(backup.pairDecisions, MAX_EVENTS * 4, "pairDecisions");
  const questions = arrayWithin(backup.questions, MAX_QUESTIONS, "questions");
  const eventIds = new Set();
  const assignedMemories = new Set();
  events.forEach((event) => {
    assertObject(event, "event");
    const eventId = sanitizeId(event.id);
    if (eventId && eventIds.has(eventId)) throw new Error("备份包含重复的时光拼图 ID。");
    if (eventId) eventIds.add(eventId);
    const members = arrayWithin(event.members, MAX_MEMBERS_PER_EVENT, "event.members");
    if (members.length < 2) throw new Error("每组时光拼图至少需要两个版本。");
    members.forEach((member) => {
      assertObject(member, "event member");
      if (!memorySet.has(member.memoryId)) throw new Error("时光拼图引用了备份之外的展品。");
      if (assignedMemories.has(member.memoryId)) throw new Error("一件展品不能同时属于多组时光拼图。");
      assignedMemories.add(member.memoryId);
    });
  });
  claims.forEach((claim) => {
    assertObject(claim, "claim");
    if (!memorySet.has(claim.memoryId)) throw new Error("字段证据引用了备份之外的展品。");
  });
  decisions.forEach((decision) => {
    assertObject(decision, "pair decision");
    if (!memorySet.has(decision.memoryAId) || !memorySet.has(decision.memoryBId) || decision.memoryAId === decision.memoryBId) {
      throw new Error("版本判断包含无效的展品配对。");
    }
  });
  questions.forEach((question) => {
    assertObject(question, "curator question");
    if (!String(question.question || "").trim()) throw new Error("补充问题正文不能为空。");
    if (question.memoryId && !memorySet.has(question.memoryId)) throw new Error("补充问题引用了备份之外的展品。");
    if (question.eventId && !eventIds.has(sanitizeId(question.eventId))) throw new Error("补充问题引用了不存在的时光拼图。");
    if (!question.memoryId && !question.eventId) throw new Error("补充问题缺少归属对象。");
  });
  return true;
}

function restoreArchaeologyBackup(store, backup, memoryIdMap) {
  const source = backup && typeof backup === "object" ? backup : {};
  const sourceClaims = Array.isArray(source.claims) ? source.claims.slice(0, MAX_CLAIMS) : [];
  const sourceEvents = Array.isArray(source.events) ? source.events.slice(0, MAX_EVENTS) : [];
  const decisions = Array.isArray(source.pairDecisions) ? source.pairDecisions.slice(0, MAX_EVENTS * 4) : [];
  const claimsBySource = new Map();
  sourceClaims.forEach((claim) => {
    if (!claimsBySource.has(claim.memoryId)) claimsBySource.set(claim.memoryId, []);
    claimsBySource.get(claim.memoryId).push({ ...claim, id: "" });
  });
  const eventIdMap = new Map();
  let restoredEvents = 0;
  let restoredClaims = 0;
  let restoredDecisions = 0;
  let skipped = 0;

  for (const sourceEvent of sourceEvents) {
    const sourceMembers = Array.isArray(sourceEvent.members)
      ? sourceEvent.members.slice(0, MAX_MEMBERS_PER_EVENT)
      : [];
    const members = sourceMembers
      .map((member) => ({ ...member, memoryId: memoryIdMap.get(member.memoryId) || "" }))
      .filter((member) => member.memoryId);
    if (members.length < 2) {
      skipped += 1;
      continue;
    }
    const sourceMemberIds = sourceMembers.map((member) => member.memoryId);
    const mappedIds = members.map((member) => member.memoryId);
    const eventDecisions = decisions.filter((decision) => (
      sourceMemberIds.includes(decision.memoryAId) && sourceMemberIds.includes(decision.memoryBId)
    ));
    const mappedDecisions = eventDecisions.length
      ? eventDecisions.map((decision) => mapDecision(decision, mappedIds, memoryIdMap))
      : [mapDecision(null, mappedIds, memoryIdMap)];
    let eventClaimCount = 0;
    const claimsByMemory = Object.fromEntries(sourceMembers.map((member) => {
      const mappedId = memoryIdMap.get(member.memoryId);
      const claims = (claimsBySource.get(member.memoryId) || []).map((claim) => ({ ...claim, memoryId: mappedId }));
      eventClaimCount += claims.length;
      return [mappedId, claims];
    }).filter(([memoryId]) => memoryId));
    try {
      const requestedId = sanitizeId(sourceEvent.id);
      const eventId = requestedId && !store.getMemoryEvent(requestedId) ? requestedId : "";
      const confirmation = store.saveArchaeologyConfirmation({
        event: {
          eventId,
          memoryIds: mappedIds,
          members,
          title: limitText(sourceEvent.title, 160),
          summary: limitText(sourceEvent.summary, 1200),
          metadata: sourceEvent.metadata,
          confirmedBy: "json-restore"
        },
        pairDecisions: mappedDecisions,
        claimsByMemory
      });
      eventIdMap.set(sourceEvent.id, confirmation.event.id);
      restoredEvents += 1;
      restoredClaims += eventClaimCount;
      restoredDecisions += confirmation.decisions.length;
    } catch {
      skipped += 1;
    }
  }

  let restoredQuestions = 0;
  const questions = Array.isArray(source.questions) ? source.questions.slice(0, MAX_QUESTIONS) : [];
  for (const question of questions) {
    const memoryId = memoryIdMap.get(question.memoryId) || "";
    const eventId = eventIdMap.get(question.eventId) || "";
    if (!memoryId && !eventId) {
      skipped += 1;
      continue;
    }
    try {
      store.saveCuratorQuestion({
        memoryId,
        eventId,
        question: limitText(question.question, 1200),
        reason: limitText(question.reason, 1600),
        status: normalizeQuestionStatus(question.status),
        answer: limitText(question.answer, 4000),
        priority: clampInteger(question.priority, 0, 1000, 0),
        evidence: question.evidence,
        metadata: { ...(question.metadata || {}), restored: true },
        answeredAt: question.answeredAt
      });
      restoredQuestions += 1;
    } catch {
      skipped += 1;
    }
  }
  return {
    events: restoredEvents,
    claims: restoredClaims,
    decisions: restoredDecisions,
    questions: restoredQuestions,
    skipped
  };
}

function mapDecision(decision, fallbackIds, memoryIdMap) {
  return {
    memoryAId: memoryIdMap.get(decision?.memoryAId) || fallbackIds[0],
    memoryBId: memoryIdMap.get(decision?.memoryBId) || fallbackIds[1],
    decision: decision?.decision || "same_event",
    rationale: decision?.rationale || "从完整馆藏备份恢复的用户确认关系。",
    evidence: decision?.evidence || [],
    metadata: { ...(decision?.metadata || {}), restored: true }
  };
}

function normalizeQuestionStatus(value) {
  return ["open", "answered", "unknown", "skipped"].includes(value) ? value : "open";
}

function sanitizeId(value) {
  const id = String(value || "").trim();
  return /^[a-zA-Z0-9_-]{1,120}$/.test(id) ? id : "";
}

function limitText(value, maxLength) {
  return String(value || "").trim().slice(0, maxLength);
}

function clampInteger(value, min, max, fallback) {
  const number = Number.parseInt(value, 10);
  return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback;
}

function arrayWithin(value, max, label) {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > max) throw new Error(`${label} 数组无效或过大。`);
  return value;
}

function assertObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} 格式无效。`);
}

function assertExactKeys(value, expected, label) {
  const keys = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (keys.length !== wanted.length || keys.some((key, index) => key !== wanted[index])) {
    throw new Error(`${label}字段集合无效。`);
  }
}

function requireCount(value, maximum, label) {
  if (!Number.isSafeInteger(value) || value < 0 || value > maximum) {
    throw new Error(`${label} 计数无效。`);
  }
  return value;
}

module.exports = { buildArchaeologyBackup, redactArchaeologyBackup, restoreArchaeologyBackup, validateArchaeologyBackup };
