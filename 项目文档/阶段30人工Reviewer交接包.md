# 阶段30人工Reviewer交接包

更新日期：2026-07-05

Baseline: `2.0.14 / phase30-human-reviewer-handoff-package`

Phase 30 human reviewer handoff package: active

本交接包用于把 10 个 Phase 30 human evidence slots 拆给对应 reviewer 角色。它只是人工交接材料，不是 live submission，不替代 reviewer 签核，不生成证据，不批准 release，不退出 Phase 29，不进入 Phase 30 implementation，也不启用 runtime execution 或 third-party execution。

## 1. 当前状态

- `handoffOnly=true`
- `handoffStatus=ready-for-human-reviewer-assignment`
- `liveSubmission=data/phase30-human-evidence-submission.json`
- `liveSubmissionStatus=not-created`
- `pendingSlots=10`
- `approvedSlots=0`
- `releaseReady=false`
- `phase29ExitReady=false`
- `phase30EntryReady=false`
- `runtimeExecution=false`
- `thirdPartyExecution=false`
- `persistedMutations=0`

## 2. Reviewer 分组

| reviewer role | evidence slots | next action |
| --- | --- | --- |
| release owner | `release-blocker-disposition`, `transition-redline-disposition`, `signoff-evidence-reconciliation`, `release-runtime-separation` | 确认 Phase 29 exit、release blocker、redline 和 release/runtime 分离证据 |
| runtime owner | `runtime-owner-go-no-go`, `rollback-strategy-review` | 确认 runtime go/no-go 与 rollback strategy |
| security reviewer | `sandbox-acceptance-review`, `secret-boundary-review` | 确认 sandbox acceptance 与 secret boundary |
| data steward | `private-memory-boundary-review` | 确认 SQLite private memory 与 redacted export boundary |
| audit reviewer | `audit-dry-run-review` | 确认 audit dry-run、correlationId、export summary 和 rollbackHint |

## 3. 交接输入

Reviewer 应使用以下材料：

- `阶段30人工证据收集计划.md`
- `阶段30人工证据收集登记表.md`
- `阶段30人工证据提交门禁.md`
- `阶段30人工证据提交样例.json`
- `阶段30人工审查会议包.md`
- `阶段30人工复核证据包.md`
- `阶段30人工复核证据填写表.md`
- `阶段30RC冻结清单.md`
- `阶段30候选交付说明.md`

## 4. 填写要求

每个 reviewer 必须为自己负责的 evidence slots 提供：

- `reviewer`
- `reviewedAt`
- `evidenceRef`
- `disposition`
- `decisionReason`
- `residualRisk`

当 `disposition` 是 `accepted-with-risk`、`deferred-with-owner` 或 `blocked` 时，还必须补齐：

- `followUpOwner`
- `recoveryCondition`
- `targetReviewDate`

## 5. 移交方式

1. reviewer 在线下复制 `阶段30人工证据提交样例.json`。
2. reviewer 只替换自己负责槽位中的 `REPLACE_WITH_...` 与 `YYYY-MM-DD`。
3. reviewer 把外部 evidenceRef 指向会议纪要、审查记录、测试报告、工单或签核单。
4. 维护者汇总所有 reviewer 结果后，才可明确创建 `data/phase30-human-evidence-submission.json`。
5. 创建 live submission 后运行 `phase30:evidence-submission-gate`。

## 6. 禁止事项

- 不把本交接包当作 release approval。
- 不把本交接包当作 human signoff。
- 不把样例 JSON 直接当作 live submission。
- 不自动填入 reviewer、reviewedAt、evidenceRef 或 disposition。
- 不设置 `releaseReady=true`。
- 不设置 `phase29ExitReady=true`。
- 不设置 `phase30EntryReady=true`。
- 不启用 `runtimeExecution`。
- 不启用 `thirdPartyExecution`。

## 7. 完成判定

本交接包完成时，只表示 reviewer 任务已拆分。它不代表任何 evidence slot 已经通过人工审查。

下一阶段只能在真实 reviewer 提供证据后，进入 live submission 创建与门禁校验。

会前材料检查：`phase30:review-session-package`。该会议包只组织人工会议，不是 live submission。
