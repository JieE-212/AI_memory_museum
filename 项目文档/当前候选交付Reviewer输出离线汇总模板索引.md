# 当前候选交付 Reviewer 输出离线汇总模板索引

状态：`reviewer-output-summary-template-only`

本索引用于在 Reviewer 输出接收门禁通过之后，指导维护者在线下整理 reviewer 输出汇总字段，并把冲突、风险 follow-up 和转换预检条件分流到对应材料。它不是 reviewer 输出，不是会后真实汇总，不是 live submission，不是 release approval，不是 Phase 29 exit，不是 Phase 30 entry，也不启用 runtime execution 或 third-party execution。

本索引必须按 `当前候选交付人工审查执行顺序总表.md` 执行，只能在收件门禁通过后使用。

## 一、当前红线

- `APP_VERSION=1.9.48`
- `PHASE=29`
- `rc-reviewable-but-not-releasable`
- `releaseReady=false`
- `phase29ExitReady=false`
- `phase30EntryReady=false`
- `runtimeExecution=false`
- `thirdPartyExecution=false`
- `liveSubmissionExists=false`
- `approvedSlots=0`
- `missingSlots=10`
- 不得默认创建 `data/phase30-human-evidence-submission.json`
- 不得在仓库保存真实 reviewer 输出

## 二、使用位置

本索引只能在以下条件之后使用：

- reviewer 已按 `当前候选交付Reviewer证据槽位工作台.md` 产出真实输出。
- 维护者已按 `当前候选交付Reviewer输出接收门禁.md` 完成收件判断。
- `receiptAcceptedByMaintainer=true` 已由维护者在线下确认。
- 材料不是模板、会议空表、dry-run 输出、检查脚本输出或自动生成占位内容。

本索引的下游材料：

- `阶段30会后证据汇总包.md`
- `阶段30人工证据冲突审查包.md`
- `阶段30风险处置后续台账.md`
- `阶段30LiveSubmission转换预检包.md`

## 三、汇总包头字段

离线汇总包头应包含以下字段：

- `summaryBundleRef`
- `summarizedAt`
- `summarizedBy`
- `sourceBundleRef`
- `receiptAcceptedByMaintainer`
- `slotCount`
- `acceptedSlotCount`
- `rejectedSlotCount`
- `conflictCount`
- `riskFollowupCount`
- `readyForPostReviewSummary`
- `readyForConversionPreflight`

若 `receiptAcceptedByMaintainer` 不是 `true`，则必须保持 `readyForPostReviewSummary=false` 和 `readyForConversionPreflight=false`。

## 四、逐槽位汇总字段

每个 evidence slot 的离线汇总行应包含：

- `evidenceId`
- `reviewerRole`
- `reviewer`
- `reviewedAt`
- `evidenceRef`
- `disposition`
- `decisionReason`
- `residualRisk`
- `receiptStatus`
- `summaryStatus`
- `conflictStatus`
- `riskFollowupStatus`

允许的 `summaryStatus`：

- `accepted-for-summary`
- `rejected-for-summary`
- `needs-conflict-review`
- `needs-risk-followup`
- `blocked`

## 五、逐槽位覆盖范围

离线汇总必须覆盖全部 10 个 evidence slots：

- `release-blocker-disposition`
- `transition-redline-disposition`
- `signoff-evidence-reconciliation`
- `release-runtime-separation`
- `runtime-owner-go-no-go`
- `rollback-strategy-review`
- `sandbox-acceptance-review`
- `secret-boundary-review`
- `private-memory-boundary-review`
- `audit-dry-run-review`

允许的 `disposition`：

- `approved-with-evidence`
- `accepted-with-risk`
- `deferred-with-owner`
- `rejected`
- `blocked`

## 六、分流规则

- `approved-with-evidence` 可以进入普通会后汇总，但仍不代表 release approval。
- `accepted-with-risk` 必须进入 `阶段30风险处置后续台账.md`，并补齐 `followUpOwner`、`recoveryCondition` 和 `targetReviewDate`。
- `deferred-with-owner` 必须进入 `阶段30风险处置后续台账.md`，并保持阻断。
- `blocked` 必须进入 `阶段30风险处置后续台账.md`，并保持阻断。
- `rejected` 必须记录拒绝原因和 residual risk，不能进入 conversion-ready 判断。
- 任何 reviewer 身份、evidenceRef、disposition、decisionReason 或 residualRisk 冲突，都必须进入 `阶段30人工证据冲突审查包.md`。

## 七、禁止带入汇总的内容

不得把以下内容带入离线汇总：

- `REPLACE_WITH_...`
- `YYYY-MM-DD`
- `pending`
- `missing`
- `unassigned`
- 空 reviewer、空 evidenceRef 或空 decisionReason
- 仅指向 README、检查脚本、本工作台、模板 JSON、会议空表或本地 dry-run 的 evidenceRef
- 未通过 `当前候选交付Reviewer输出接收门禁.md` 的材料
- 维护者代填的 reviewer 结论

## 八、转换前保持阻断

即使离线汇总模板填写完整，也必须继续保持：

- `releaseReady=false`
- `phase29ExitReady=false`
- `phase30EntryReady=false`
- `runtimeExecution=false`
- `thirdPartyExecution=false`
- `readyForConversionPreflight=false`，直到冲突审查、风险台账和维护者显式转换授权均满足。

只有真实 reviewer 输出齐备、接收门禁通过、冲突和风险后续项处理完毕、维护者显式转换授权后，才可讨论创建 `data/phase30-human-evidence-submission.json`。

## 九、建议检查命令

```powershell
npm.cmd run candidate:reviewer-output-summary-template-check
npm.cmd run candidate:review-execution-sequence-check
npm.cmd run candidate:reviewer-output-receipt-check
npm.cmd run candidate:reviewer-workbench-check
npm.cmd run candidate:pre-review-package-check
npm.cmd run phase30:evidence-closure-status
npm.cmd run check
```

这些命令只证明离线汇总模板索引、收件门禁、工作台索引、审查前包和候选检查链仍然守住红线；不证明任何 reviewer 输出已经被汇总，也不证明任何 evidence slot 已经通过人工审查。
