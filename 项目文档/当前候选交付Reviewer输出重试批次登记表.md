# 当前候选交付Reviewer输出重试批次登记表
状态：`reviewer-output-retry-batch-register-only`

本登记表用于在 `当前候选交付Reviewer输出字段修复回执与重试准备记录.md` 之后、重新登记 `当前候选交付Reviewer输出接收尝试记录.md` 和执行 `当前候选交付Reviewer输出接收门禁.md` 之前，把一个或多个已经具备 `ready-for-receipt-attempt` 条件的字段修复回执归组为一次可追踪的 reviewer output retry batch。它只是 retry batch register，不是 reviewer 输出，不是字段已修复证明，不是 Reviewer 输出接收门禁通过，不是 evidence acceptance，不是维护者授权，不是 live submission，不是 release approval，不是 Phase 29 exit，不是 Phase 30 entry，也不启用 runtime execution 或 third-party execution。

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
本登记表只能在以下链路位置使用：
- 上游：`当前候选交付Reviewer输出字段修复回执与重试准备记录.md`
- 当前：`当前候选交付Reviewer输出重试批次登记表.md`
- 下游尝试：`当前候选交付Reviewer输出接收尝试记录.md`
- 下游对账：`当前候选交付Reviewer输出重试批次与接收尝试对账记录.md`
- 对账失败回流：`当前候选交付Reviewer输出对账失败回流处置单.md`
- 对账失败结果复核：`当前候选交付Reviewer输出对账失败回流结果复核记录.md`
- 再对账准备：`当前候选交付Reviewer输出对账失败回流结果再对账准备记录.md`
- 再对账执行：`当前候选交付Reviewer输出再对账执行记录.md`
- 再对账结果接收：`当前候选交付Reviewer输出再对账结果接收记录.md`
- 再对账结果复核：`当前候选交付Reviewer输出再对账结果复核记录.md`
- 下游门禁：`当前候选交付Reviewer输出接收门禁.md`
- 失败后回流：`当前候选交付Reviewer输出字段缺口定位矩阵.md`

字段修复回执与重试准备记录说明某条修复回执是否具备再次尝试条件；本登记表只把这些 ready 条目编入一个 retry batch，方便维护者追踪批次来源、批次 owner、目标 slots、执行命令、失败回滚和下一步登记。任何 `retry-batch-ready` 都不表示 reviewer 输出已经被接收；每个 batch 仍必须产生新的 `当前候选交付Reviewer输出接收尝试记录.md`，再用 `当前候选交付Reviewer输出重试批次与接收尝试对账记录.md` 对齐 batch、attempt 和 gate ref，并重新经过 `当前候选交付Reviewer输出接收门禁.md`。

## 三、重试批次字段

真实 retry batch 登记应在线下保存；本仓库当前只保留字段模板：

- `retryBatchId`
- `sourceFieldFixReceiptIds`
- `sourceRetryReadinessStatus`
- `sourceReceiptAttemptIds`
- `sourceReviewerOutputBundleRefs`
- `reviewerNames`
- `reviewerRoles`
- `affectedEvidenceSlots`
- `affectedFieldNames`
- `gapTypes`
- `blockingSeverities`
- `resubmissionPackageRefs`
- `batchOwner`
- `batchCreatedAt`
- `batchCreatedBy`
- `batchStatus`
- `batchPrecheckStatus`
- `receiptAttemptCommand`
- `targetReceiptAttemptId`
- `targetReceiptGateRef`
- `retryWindow`
- `rollbackRequiredIfFailed`
- `rollbackTarget`
- `failureRoute`
- `nextAction`
- `followUpOwner`
- `recoveryCondition`
- `targetReviewDate`

允许继承的 `sourceRetryReadinessStatus`：
- `ready-for-receipt-attempt`
- `ready-for-return-closure`
- `blocked-by-open-gap`
- `blocked-by-missing-package`
- `cancelled`

允许的 `batchStatus`：
- `draft`
- `ready-for-receipt-attempt`
- `queued-for-receipt-attempt`
- `attempt-recorded`
- `blocked-by-open-gap`
- `blocked-by-missing-package`
- `cancelled`

允许的 `batchPrecheckStatus`：
- `not-run`
- `ready-to-run`
- `blocked-by-missing-receipt-readiness`
- `blocked-by-open-return`
- `blocked-by-open-clarification`
- `blocked-by-missing-resubmission`
- `cancelled`

允许的 `failureRoute`：
- `return-to-field-gap-matrix`
- `return-to-field-fix-assignment`
- `return-to-return-resubmission-closure`
- `return-to-receipt-attempt-log`
- `cancelled`

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

## 六、批次登记规则

- 只有上游记录为 `ready-for-receipt-attempt` 的条目，才可以进入 `ready-for-receipt-attempt` 或 `queued-for-receipt-attempt` 批次。
- `draft` 只表示批次正在整理，不得触发接收尝试。
- `ready-for-receipt-attempt` 只表示批次具备登记下一次接收尝试的条件，不表示接收门禁通过。
- `queued-for-receipt-attempt` 必须写明 `receiptAttemptCommand` 和 `targetReceiptAttemptId`。
- `attempt-recorded` 必须能追溯到真实的 `当前候选交付Reviewer输出接收尝试记录.md` 条目。
- `attempt-recorded` 后必须进入 `当前候选交付Reviewer输出重试批次与接收尝试对账记录.md` 做 batch-to-attempt 对账。
- 若对账出现 `unmatched-batch` 或 `blocked-by-missing-attempt`，必须先进入 `当前候选交付Reviewer输出对账失败回流处置单.md` 再回到本登记表修正。
- 本登记表的修正结果必须被 `当前候选交付Reviewer输出对账失败回流结果复核记录.md` 复核，不能直接解释为字段已修复或接收门禁通过。
- 下一次 retry batch 重新登记前，必须由 `当前候选交付Reviewer输出对账失败回流结果再对账准备记录.md` 确认 `nextRetryBatchRef` 和修正引用齐备。
- `blocked-by-open-gap` 和 `blocked-by-missing-package` 必须写明 `failureRoute`、`nextAction`、`followUpOwner` 和 `recoveryCondition`。
- 批次失败后必须回流到字段缺口定位、字段修复责任分派、退回补交闭环或接收尝试记录，不能直接宣布通过。

## 七、禁止事项
不得：
- 把重试批次登记表当作 reviewer 输出。
- 把 `ready-for-receipt-attempt` 或 `queued-for-receipt-attempt` 当作字段已修复。
- 把 `attempt-recorded` 当作 Reviewer 输出接收门禁通过。
- 用本登记表代填 `reviewer`、`reviewedAt`、`evidenceRef`、`disposition`、`decisionReason`、`residualRisk` 或风险 follow-up 字段。
- 用本登记表跳过 `当前候选交付Reviewer输出接收尝试记录.md`。
- 用本登记表跳过 `当前候选交付Reviewer输出重试批次与接收尝试对账记录.md`。
- 用本登记表跳过 `当前候选交付Reviewer输出接收门禁.md`。
- 不得创建 `data/phase30-human-evidence-submission.json`。
- 不得设置 `releaseReady=true`。
- 不得设置 `phase29ExitReady=true`。
- 不得设置 `phase30EntryReady=true`。
- 不得启用 `runtimeExecution`。
- 不得启用 `thirdPartyExecution`。

## 八、建议检查命令
```powershell
npm.cmd run candidate:reviewer-output-retry-batch-register-check
npm.cmd run candidate:reviewer-output-retry-batch-attempt-reconciliation-check
npm.cmd run candidate:reviewer-output-reconciliation-failure-disposition-check
npm.cmd run candidate:reviewer-output-reconciliation-failure-disposition-outcome-check
npm.cmd run candidate:reviewer-output-reconciliation-rerun-readiness-check
npm.cmd run candidate:reviewer-output-reconciliation-rerun-execution-check
npm.cmd run candidate:reviewer-output-reconciliation-rerun-result-intake-check
npm.cmd run candidate:reviewer-output-field-fix-receipt-retry-readiness-check
npm.cmd run candidate:reviewer-output-receipt-attempt-log-check
npm.cmd run candidate:reviewer-output-field-gap-matrix-check
npm.cmd run candidate:reviewer-output-field-fix-assignment-check
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

这些命令只证明 Reviewer 输出重试批次登记表和候选审查链仍然守住红线；不证明字段已经修复，不证明 reviewer 输出已经产生，不证明 Reviewer 输出接收门禁通过，不证明维护者授权，也不证明 live submission 或 release approval。
