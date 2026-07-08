# 当前候选交付Reviewer输出字段修复责任分派单

状态：`reviewer-output-field-fix-assignment-only`

本分派单用于在 `当前候选交付Reviewer输出字段缺口定位矩阵.md` 之后、进入 `当前候选交付Reviewer输出退回与补交闭环记录.md` 或重新执行 `当前候选交付Reviewer输出接收门禁.md` 之前，把字段缺口转换为明确的修复责任、目标期限、修复路线和重试条件。它只是 field fix assignment，不是 reviewer 输出，不是字段已修复证明，不是 Reviewer 输出接收门禁通过，不是 evidence acceptance，不是维护者授权，不是 live submission，不是 release approval，不是 Phase 29 exit，不是 Phase 30 entry，也不启用 runtime execution 或 third-party execution。

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

本分派单只能在以下链路位置使用：

- 上游：`当前候选交付Reviewer输出字段缺口定位矩阵.md`
- 当前：`当前候选交付Reviewer输出字段修复责任分派单.md`
- 下游回执与重试准备：`当前候选交付Reviewer输出字段修复回执与重试准备记录.md`
- 下游重试批次：`当前候选交付Reviewer输出重试批次登记表.md`
- 下游批次尝试对账：`当前候选交付Reviewer输出重试批次与接收尝试对账记录.md`
- 对账失败回流：`当前候选交付Reviewer输出对账失败回流处置单.md`
- 对账失败结果复核：`当前候选交付Reviewer输出对账失败回流结果复核记录.md`
- 再对账准备：`当前候选交付Reviewer输出对账失败回流结果再对账准备记录.md`
- 再对账执行：`当前候选交付Reviewer输出再对账执行记录.md`
- 再对账结果接收：`当前候选交付Reviewer输出再对账结果接收记录.md`
- 再对账结果复核：`当前候选交付Reviewer输出再对账结果复核记录.md`
- 下游闭环：`当前候选交付Reviewer输出退回与补交闭环记录.md`
- 下游门禁：`当前候选交付Reviewer输出接收门禁.md`

字段缺口定位矩阵只说明缺口在哪里；本分派单只说明由谁修、何时修、怎么修、修完进入哪条闭环。任何 `fix-submitted` 或 `ready-for-return-closure` 都不表示 reviewer 输出已经被接收。修复责任方回执和补交包引用必须先记录到 `当前候选交付Reviewer输出字段修复回执与重试准备记录.md`；具备重试条件时还必须登记到 `当前候选交付Reviewer输出重试批次登记表.md`，并用 `当前候选交付Reviewer输出重试批次与接收尝试对账记录.md` 对齐批次和接收尝试；若对账失败回流到字段修复责任，必须先登记 `当前候选交付Reviewer输出对账失败回流处置单.md`，并由 `当前候选交付Reviewer输出对账失败回流结果复核记录.md` 复核分派结果；所有补交后仍必须回到 `当前候选交付Reviewer输出接收尝试记录.md` 并重新经过 `当前候选交付Reviewer输出接收门禁.md`。

## 三、分派字段

真实修复责任分派应在线下保存；本仓库当前只保留字段模板：

- `fieldFixAssignmentId`
- `sourceFieldGapMatrixId`
- `sourceReceiptAttemptId`
- `sourceReviewerOutputBundleRef`
- `reviewerName`
- `reviewerRole`
- `evidenceSlot`
- `fieldName`
- `gapType`
- `blockingSeverity`
- `assignmentStatus`
- `assignedBy`
- `assignedAt`
- `targetFixOwner`
- `targetFixDueAt`
- `requestedFix`
- `requiredReplacementValueRule`
- `fixRoute`
- `returnClosureRequired`
- `returnClosureRef`
- `clarificationRequired`
- `resubmissionPackageRef`
- `receiptRetryRequired`
- `receiptRetryCommand`
- `nextAction`
- `followUpOwner`
- `recoveryCondition`
- `targetReviewDate`

允许继承的 `gapType`：

- `missing-required-field`
- `placeholder-detected`
- `invalid-reviewedAt`
- `invalid-evidenceRef`
- `invalid-disposition`
- `missing-risk-followup`
- `conflicting-field`
- `wrong-reviewer-role`

允许继承的 `blockingSeverity`：

- `block-receipt`
- `return-for-fix`
- `needs-clarification`
- `non-blocking-note`

允许的 `assignmentStatus`：

- `drafted`
- `assigned`
- `acknowledged`
- `in-progress`
- `fix-submitted`
- `ready-for-return-closure`
- `cancelled`

允许的 `fixRoute`：

- `return-to-reviewer`
- `maintainer-clarification`
- `evidence-ref-replacement`
- `risk-followup-completion`
- `role-correction`
- `no-fix-needed`

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

## 六、分派规则

- `drafted` 只表示分派草稿存在，不表示修复已发出。
- `assigned` 必须包含 `targetFixOwner`、`targetFixDueAt`、`requestedFix` 和 `requiredReplacementValueRule`。
- `acknowledged` 只表示责任方已确认收到，不表示 reviewer 输出已修复。
- `in-progress` 只表示修复处理中，不表示可重试接收门禁。
- `fix-submitted` 必须有 `resubmissionPackageRef`，但仍不是 Reviewer 输出接收门禁通过。
- `ready-for-return-closure` 必须先转入 `当前候选交付Reviewer输出字段修复回执与重试准备记录.md`，再进入 `当前候选交付Reviewer输出退回与补交闭环记录.md`。
- `ready-for-receipt-attempt` 必须先转入 `当前候选交付Reviewer输出重试批次登记表.md`，再登记下一次接收尝试。
- `cancelled` 必须写明取消原因和下一步是否回到字段缺口定位矩阵。
- `no-fix-needed` 只允许用于 `non-blocking-note`，不得用于 `block-receipt` 或 `return-for-fix`。

## 七、禁止事项

不得：

- 把字段修复责任分派单当作 reviewer 输出。
- 把 `assigned` 当作字段已修复。
- 把 `fix-submitted` 当作 Reviewer 输出接收门禁通过。
- 把 `ready-for-return-closure` 当作 evidence acceptance。
- 用本分派单代填 `reviewer`、`reviewedAt`、`evidenceRef`、`disposition`、`decisionReason`、`residualRisk` 或风险 follow-up 字段。
- 用本分派单跳过 `当前候选交付Reviewer输出字段修复回执与重试准备记录.md`。
- 用本分派单跳过 `当前候选交付Reviewer输出重试批次登记表.md`。
- 用本分派单跳过 `当前候选交付Reviewer输出退回与补交闭环记录.md`。
- 用本分派单跳过 `当前候选交付Reviewer输出接收尝试记录.md`。
- 用本分派单跳过 `当前候选交付Reviewer输出接收门禁.md`。
- 不得创建 `data/phase30-human-evidence-submission.json`。
- 不得设置 `releaseReady=true`。
- 不得设置 `phase29ExitReady=true`。
- 不得设置 `phase30EntryReady=true`。
- 不得启用 `runtimeExecution`。
- 不得启用 `thirdPartyExecution`。

## 八、建议检查命令

```powershell
npm.cmd run candidate:reviewer-output-field-fix-assignment-check
npm.cmd run candidate:reviewer-output-reconciliation-failure-disposition-check
npm.cmd run candidate:reviewer-output-reconciliation-failure-disposition-outcome-check
npm.cmd run candidate:reviewer-output-reconciliation-rerun-readiness-check
npm.cmd run candidate:reviewer-output-reconciliation-rerun-execution-check
npm.cmd run candidate:reviewer-output-reconciliation-rerun-result-intake-check
npm.cmd run candidate:reviewer-output-field-fix-receipt-retry-readiness-check
npm.cmd run candidate:reviewer-output-retry-batch-register-check
npm.cmd run candidate:reviewer-output-retry-batch-attempt-reconciliation-check
npm.cmd run candidate:reviewer-output-field-gap-matrix-check
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

这些命令只证明 Reviewer 输出字段修复责任分派单和候选审查链仍然守住红线；不证明字段已经修复，不证明 reviewer 输出已经产生，不证明 Reviewer 输出接收门禁通过，不证明维护者授权，也不证明 live submission 或 release approval。
