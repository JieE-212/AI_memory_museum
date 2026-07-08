# 当前候选交付Reviewer输出字段缺口定位矩阵

状态：`reviewer-output-field-gap-matrix-only`

本矩阵用于在 `当前候选交付Reviewer输出接收尝试记录.md` 之后、重新进入 `当前候选交付Reviewer输出接收门禁.md` 或退回 `当前候选交付Reviewer输出退回与补交闭环记录.md` 之前，定位 reviewer 输出接收失败究竟发生在哪个 evidence slot、哪个必填字段、哪类缺口以及下一步修复责任。字段缺口定位矩阵不接收 reviewer 输出，不替代接收门禁，不替代退回补交闭环，不是 evidence acceptance，不是维护者授权，不是 live submission，不是 release approval，不是 Phase 29 exit，不是 Phase 30 entry，也不启用 runtime execution 或 third-party execution。

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
- `maintainerConversionAuthorization=false`
- `readyForLiveSubmissionCreation=false`
- 不得默认创建 `data/phase30-human-evidence-submission.json`
- 不得在仓库保存真实 reviewer 输出

## 二、使用位置

本矩阵只能在以下链路位置使用：

- 上游：`当前候选交付Reviewer输出接收尝试记录.md`
- 当前：`当前候选交付Reviewer输出字段缺口定位矩阵.md`
- 下游分派：`当前候选交付Reviewer输出字段修复责任分派单.md`
- 下游回执与重试准备：`当前候选交付Reviewer输出字段修复回执与重试准备记录.md`
- 下游重试批次：`当前候选交付Reviewer输出重试批次登记表.md`
- 下游批次尝试对账：`当前候选交付Reviewer输出重试批次与接收尝试对账记录.md`
- 对账失败回流：`当前候选交付Reviewer输出对账失败回流处置单.md`
- 对账失败结果复核：`当前候选交付Reviewer输出对账失败回流结果复核记录.md`
- 再对账准备：`当前候选交付Reviewer输出对账失败回流结果再对账准备记录.md`
- 再对账执行：`当前候选交付Reviewer输出再对账执行记录.md`
- 再对账结果接收：`当前候选交付Reviewer输出再对账结果接收记录.md`
- 再对账结果复核：`当前候选交付Reviewer输出再对账结果复核记录.md`
- 下游修复：`当前候选交付Reviewer输出退回与补交闭环记录.md`
- 下游门禁：`当前候选交付Reviewer输出接收门禁.md`

接收尝试失败后，维护者可用本矩阵把缺口拆到 slot 和字段级别；字段级缺口必须先转入 `当前候选交付Reviewer输出字段修复责任分派单.md` 明确 owner、期限和修复路线，再用 `当前候选交付Reviewer输出字段修复回执与重试准备记录.md` 记录回执和重试准备，并在可重试时登记 `当前候选交付Reviewer输出重试批次登记表.md`。批次与尝试之间必须用 `当前候选交付Reviewer输出重试批次与接收尝试对账记录.md` 对齐；若对账回到 `returned-for-gap-review`，必须先登记 `当前候选交付Reviewer输出对账失败回流处置单.md`，再回到本矩阵定位，并由 `当前候选交付Reviewer输出对账失败回流结果复核记录.md` 复核定位结果。如存在 `block-receipt` 或 `return-for-fix`，必须转入 `当前候选交付Reviewer输出退回与补交闭环记录.md`。每次 receipt retry 仍必须重新经过 `当前候选交付Reviewer输出接收门禁.md`，不能由本矩阵直接宣布通过。

## 三、矩阵字段

真实字段缺口定位记录应在线下保存；本仓库当前只保留字段模板：

- `fieldGapMatrixId`
- `sourceReceiptAttemptId`
- `sourceReviewerOutputBundleRef`
- `reviewerName`
- `reviewerRole`
- `evidenceSlot`
- `fieldName`
- `fieldStatus`
- `gapType`
- `observedValue`
- `expectedRule`
- `blockingSeverity`
- `returnClosureRequired`
- `targetFixOwner`
- `targetFixDueAt`
- `nextAction`
- `followUpOwner`
- `recoveryCondition`
- `targetReviewDate`

允许的 `fieldStatus`：

- `present`
- `missing`
- `placeholder`
- `invalid-format`
- `conflicting`
- `not-applicable`

允许的 `gapType`：

- `missing-required-field`
- `placeholder-detected`
- `invalid-reviewedAt`
- `invalid-evidenceRef`
- `invalid-disposition`
- `missing-risk-followup`
- `conflicting-field`
- `wrong-reviewer-role`

允许的 `blockingSeverity`：

- `block-receipt`
- `return-for-fix`
- `needs-clarification`
- `non-blocking-note`

## 四、必须覆盖的 reviewer role

- `release owner`
- `runtime owner`
- `security reviewer`
- `data steward`
- `audit reviewer`

## 五、必须覆盖的 evidence slots

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

每个 slot 的真实 reviewer 输出仍需由接收门禁判断：

- `reviewer`
- `reviewedAt`
- `evidenceRef`
- `disposition`
- `decisionReason`
- `residualRisk`

风险类 disposition 仍需补齐：

- `followUpOwner`
- `recoveryCondition`
- `targetReviewDate`

## 六、定位规则

- `present` 只表示字段在来源输出中出现，present 不表示 evidence accepted。
- `missing` 和 `placeholder` 必须记录 `expectedRule`、`targetFixOwner` 和 `nextAction`。
- `invalid-format` 用于 `reviewedAt`、`evidenceRef` 或 `disposition` 格式不满足接收门禁规则。
- `conflicting` 必须说明冲突字段和预期人工分流位置。
- `not-applicable` 只允许用于非风险 disposition 的 follow-up 字段，不得用于必填字段。
- `block-receipt` 必须阻断本次接收门禁。
- `return-for-fix` 必须先进入 `当前候选交付Reviewer输出字段修复责任分派单.md`，再转入 `当前候选交付Reviewer输出退回与补交闭环记录.md`。
- `needs-clarification` 必须明确澄清责任人和恢复条件。
- `non-blocking-note` 不表示 release approval，也不表示 evidence slot 已通过人工审查。

## 七、禁止事项

不得：

- 把字段缺口定位矩阵当作 reviewer 输出。
- 把 `present` 当作 evidence acceptance。
- 把 `non-blocking-note` 当作 release approval。
- 用本矩阵代填 `disposition`、`decisionReason`、`residualRisk` 或风险 follow-up 字段。
- 用本矩阵跳过 `当前候选交付Reviewer输出字段修复责任分派单.md`。
- 用本矩阵跳过 `当前候选交付Reviewer输出退回与补交闭环记录.md`。
- 用本矩阵跳过 `当前候选交付Reviewer输出接收门禁.md`。
- 不得创建 `data/phase30-human-evidence-submission.json`。
- 不得设置 `releaseReady=true`。
- 不得设置 `phase29ExitReady=true`。
- 不得设置 `phase30EntryReady=true`。
- 不得启用 `runtimeExecution`。
- 不得启用 `thirdPartyExecution`。

## 八、建议检查命令

```powershell
npm.cmd run candidate:reviewer-output-field-gap-matrix-check
npm.cmd run candidate:reviewer-output-reconciliation-failure-disposition-check
npm.cmd run candidate:reviewer-output-reconciliation-failure-disposition-outcome-check
npm.cmd run candidate:reviewer-output-reconciliation-rerun-readiness-check
npm.cmd run candidate:reviewer-output-reconciliation-rerun-execution-check
npm.cmd run candidate:reviewer-output-reconciliation-rerun-result-intake-check
npm.cmd run candidate:reviewer-output-field-fix-assignment-check
npm.cmd run candidate:reviewer-output-field-fix-receipt-retry-readiness-check
npm.cmd run candidate:reviewer-output-retry-batch-register-check
npm.cmd run candidate:reviewer-output-retry-batch-attempt-reconciliation-check
npm.cmd run candidate:reviewer-output-receipt-attempt-log-check
npm.cmd run candidate:reviewer-output-return-resubmission-closure-check
npm.cmd run candidate:reviewer-output-receipt-check
npm.cmd run candidate:final-review-package-lock-check
npm.cmd run candidate:negative-misuse-check
npm.cmd run candidate:review-chain-integrity-check
npm.cmd run candidate:review-execution-sequence-check
npm.cmd run candidate:pre-review-package-check
npm.cmd run phase30:evidence-closure-status
npm.cmd run candidate:reviewer-output-reconciliation-rerun-result-review-check
npm.cmd run check
```

这些命令只证明 Reviewer 输出字段缺口定位矩阵和候选审查链仍然守住红线；不证明 reviewer 输出已经产生，不证明 Reviewer 输出接收门禁通过，不证明维护者授权，也不证明 live submission 或 release approval。
