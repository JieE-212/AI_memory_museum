# 当前候选交付Reviewer输出重试批次与接收尝试对账记录
状态：`reviewer-output-retry-batch-attempt-reconciliation-only`

本记录用于在 `当前候选交付Reviewer输出重试批次登记表.md` 之后、`当前候选交付Reviewer输出接收尝试记录.md` 和 `当前候选交付Reviewer输出接收门禁.md` 之间，对 retry batch、receipt attempt 和 gate decision reference 做一轮对账：确认批次是否已经落到一次接收尝试、接收尝试是否有门禁引用、失败后是否回流到字段缺口定位、字段修复责任分派、退回补交闭环或下一次批次登记。它只是 retry batch / receipt attempt reconciliation，不是 reviewer 输出，不是字段已修复证明，不是 Reviewer 输出接收门禁通过，不是 evidence acceptance，不是维护者授权，不是 live submission，不是 release approval，不是 Phase 29 exit，不是 Phase 30 entry，也不启用 runtime execution 或 third-party execution。

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
本记录只能在以下链路位置使用：
- 上游批次：`当前候选交付Reviewer输出重试批次登记表.md`
- 上游尝试：`当前候选交付Reviewer输出接收尝试记录.md`
- 当前：`当前候选交付Reviewer输出重试批次与接收尝试对账记录.md`
- 失败处置：`当前候选交付Reviewer输出对账失败回流处置单.md`
- 失败结果复核：`当前候选交付Reviewer输出对账失败回流结果复核记录.md`
- 再对账准备：`当前候选交付Reviewer输出对账失败回流结果再对账准备记录.md`
- 再对账执行：`当前候选交付Reviewer输出再对账执行记录.md`
- 再对账结果接收：`当前候选交付Reviewer输出再对账结果接收记录.md`
- 再对账结果复核：`当前候选交付Reviewer输出再对账结果复核记录.md`
- 下游门禁：`当前候选交付Reviewer输出接收门禁.md`
- 失败后回流：`当前候选交付Reviewer输出字段缺口定位矩阵.md`
- 失败后回流：`当前候选交付Reviewer输出字段修复责任分派单.md`
- 失败后回流：`当前候选交付Reviewer输出退回与补交闭环记录.md`

重试批次登记表说明哪些修复回执被编入 retry batch；接收尝试记录说明某一次尝试是否已登记；本记录只做 batch-to-attempt-to-gate 的对账。任何 `attempt-linked` 或 `gate-ref-linked` 都不表示 reviewer 输出已经被接收；最终仍必须以 `当前候选交付Reviewer输出接收门禁.md` 的真实门禁结果为准。

## 三、对账字段

真实对账记录应在线下保存；本仓库当前只保留字段模板：

- `retryAttemptReconciliationId`
- `sourceRetryBatchId`
- `sourceRetryBatchStatus`
- `sourceFieldFixReceiptIds`
- `sourceReceiptAttemptId`
- `targetReceiptAttemptId`
- `receiptAttemptLogged`
- `receiptAttemptResult`
- `receiptGateDecisionRef`
- `receiptGateDecisionStatus`
- `batchToAttemptMatchStatus`
- `unmatchedBatchReason`
- `orphanAttemptReason`
- `affectedEvidenceSlots`
- `affectedFieldNames`
- `reviewerRoles`
- `reconciliationStatus`
- `reconciledAt`
- `reconciledBy`
- `failureRoute`
- `rollbackRequiredIfFailed`
- `rollbackTarget`
- `nextAction`
- `followUpOwner`
- `recoveryCondition`
- `targetReviewDate`

允许继承的 `sourceRetryBatchStatus`：
- `draft`
- `ready-for-receipt-attempt`
- `queued-for-receipt-attempt`
- `attempt-recorded`
- `blocked-by-open-gap`
- `blocked-by-missing-package`
- `cancelled`

允许的 `receiptAttemptResult`：
- `attempt-recorded`
- `receipt-gate-passed`
- `receipt-gate-failed`
- `returned-for-fix`
- `retry-required`
- `cancelled`

允许的 `receiptGateDecisionStatus`：
- `not-run`
- `referenced`
- `passed`
- `failed`
- `returned-for-fix`
- `cancelled`

允许的 `batchToAttemptMatchStatus`：
- `matched`
- `unmatched-batch`
- `orphan-attempt`
- `missing-gate-ref`
- `pending-attempt`
- `cancelled`

允许的 `reconciliationStatus`：
- `draft`
- `ready-for-attempt-log`
- `attempt-linked`
- `gate-ref-linked`
- `blocked-by-missing-attempt`
- `blocked-by-missing-gate-ref`
- `returned-for-gap-review`
- `cancelled`

允许的 `failureRoute`：
- `return-to-retry-batch-register`
- `return-to-receipt-attempt-log`
- `return-to-field-gap-matrix`
- `return-to-field-fix-assignment`
- `return-to-return-resubmission-closure`
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

## 六、对账规则

- `matched` 只表示 retry batch 和 receipt attempt 可以互相追溯，不表示接收门禁通过。
- `attempt-linked` 只表示 `targetReceiptAttemptId` 已登记，不表示 reviewer 输出被接收。
- `gate-ref-linked` 只表示存在 `receiptGateDecisionRef`，不表示 gate status 为 `passed`。
- `missing-gate-ref` 必须回到 `当前候选交付Reviewer输出接收尝试记录.md` 或 `当前候选交付Reviewer输出接收门禁.md` 补齐引用。
- `unmatched-batch` 必须回到 `当前候选交付Reviewer输出重试批次登记表.md` 澄清批次和目标尝试。
- `orphan-attempt` 必须回到 `当前候选交付Reviewer输出接收尝试记录.md` 澄清来源批次。
- `returned-for-gap-review` 必须回到 `当前候选交付Reviewer输出字段缺口定位矩阵.md`，再按需进入字段修复责任分派或退回补交闭环。
- `unmatched-batch`、`orphan-attempt`、`missing-gate-ref`、`blocked-by-missing-attempt`、`blocked-by-missing-gate-ref` 和 `returned-for-gap-review` 必须先登记到 `当前候选交付Reviewer输出对账失败回流处置单.md`，再回流到目标材料。
- 失败处置完成后，必须进入 `当前候选交付Reviewer输出对账失败回流结果复核记录.md` 复核 route owner、修正引用和是否需要重新对账。
- 重新执行本对账前，必须先由 `当前候选交付Reviewer输出对账失败回流结果再对账准备记录.md` 确认 `nextReconciliationRef`、`recheckCommand` 和修正引用齐备。

## 七、禁止事项
不得：
- 把重试批次与接收尝试对账记录当作 reviewer 输出。
- 把 `matched`、`attempt-linked` 或 `gate-ref-linked` 当作字段已修复。
- 把 `receiptGateDecisionStatus=referenced` 当作 Reviewer 输出接收门禁通过。
- 用本记录代填 `reviewer`、`reviewedAt`、`evidenceRef`、`disposition`、`decisionReason`、`residualRisk` 或风险 follow-up 字段。
- 用本记录跳过 `当前候选交付Reviewer输出接收尝试记录.md`。
- 用本记录跳过 `当前候选交付Reviewer输出接收门禁.md`。
- 不得创建 `data/phase30-human-evidence-submission.json`。
- 不得设置 `releaseReady=true`。
- 不得设置 `phase29ExitReady=true`。
- 不得设置 `phase30EntryReady=true`。
- 不得启用 `runtimeExecution`。
- 不得启用 `thirdPartyExecution`。

## 八、建议检查命令
```powershell
npm.cmd run candidate:reviewer-output-retry-batch-attempt-reconciliation-check
npm.cmd run candidate:reviewer-output-reconciliation-failure-disposition-check
npm.cmd run candidate:reviewer-output-reconciliation-failure-disposition-outcome-check
npm.cmd run candidate:reviewer-output-reconciliation-rerun-readiness-check
npm.cmd run candidate:reviewer-output-reconciliation-rerun-execution-check
npm.cmd run candidate:reviewer-output-reconciliation-rerun-result-intake-check
npm.cmd run candidate:reviewer-output-retry-batch-register-check
npm.cmd run candidate:reviewer-output-receipt-attempt-log-check
npm.cmd run candidate:reviewer-output-field-fix-receipt-retry-readiness-check
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

这些命令只证明 Reviewer 输出重试批次与接收尝试对账记录和候选审查链仍然守住红线；不证明字段已经修复，不证明 reviewer 输出已经产生，不证明 Reviewer 输出接收门禁通过，不证明维护者授权，也不证明 live submission 或 release approval。
