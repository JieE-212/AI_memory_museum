# 当前候选交付Reviewer输出退回与补交闭环记录

状态：`reviewer-output-return-resubmission-closure-record-only`

本记录用于在 `当前候选交付Reviewer审查中阻塞与澄清问题台账.md` 之后、`当前候选交付Reviewer输出接收门禁.md` 之前，记录 reviewer 输出或审查材料被退回后的补交闭环：退回原因、补交责任人、补交包引用、重新提交时间、再次进入接收门禁前的恢复条件。它只是 return / resubmission closure record，不是 reviewer 输出，不是 Reviewer 输出接收门禁通过，不是 evidence acceptance，不是维护者授权，不是 live submission，不是 release approval，不是 Phase 29 exit，不是 Phase 30 entry，也不启用 runtime execution 或 third-party execution。

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

- 上游：`当前候选交付Reviewer审查中阻塞与澄清问题台账.md`
- 上游拒收来源：`当前候选交付Reviewer输出接收门禁.md`
- 上游缺口定位：`当前候选交付Reviewer输出字段缺口定位矩阵.md`
- 上游修复分派：`当前候选交付Reviewer输出字段修复责任分派单.md`
- 上游修复回执与重试准备：`当前候选交付Reviewer输出字段修复回执与重试准备记录.md`
- 下游重试批次：`当前候选交付Reviewer输出重试批次登记表.md`
- 下游批次尝试对账：`当前候选交付Reviewer输出重试批次与接收尝试对账记录.md`
- 对账失败回流：`当前候选交付Reviewer输出对账失败回流处置单.md`
- 对账失败结果复核：`当前候选交付Reviewer输出对账失败回流结果复核记录.md`
- 再对账准备：`当前候选交付Reviewer输出对账失败回流结果再对账准备记录.md`
- 再对账执行：`当前候选交付Reviewer输出再对账执行记录.md`
- 再对账结果接收：`当前候选交付Reviewer输出再对账结果接收记录.md`
- 再对账结果复核：`当前候选交付Reviewer输出再对账结果复核记录.md`
- 当前：`当前候选交付Reviewer输出退回与补交闭环记录.md`
- 下游尝试记录：`当前候选交付Reviewer输出接收尝试记录.md`
- 下游：`当前候选交付Reviewer输出接收门禁.md`

本记录允许把退回和补交事项整理成闭环；字段级缺口应先由 `当前候选交付Reviewer输出字段缺口定位矩阵.md` 定位，再由 `当前候选交付Reviewer输出字段修复责任分派单.md` 明确 owner、期限和修复路线，然后由 `当前候选交付Reviewer输出字段修复回执与重试准备记录.md` 记录回执、补交包引用和重试准备，具备重试条件时再登记到 `当前候选交付Reviewer输出重试批次登记表.md`，并由 `当前候选交付Reviewer输出重试批次与接收尝试对账记录.md` 对齐批次和尝试；若对账失败需要回到退回补交闭环，必须先登记 `当前候选交付Reviewer输出对账失败回流处置单.md`，再由 `当前候选交付Reviewer输出对账失败回流结果复核记录.md` 复核闭环结果，最后落入本记录安排补交闭环。每一次补交后必须先记录到 `当前候选交付Reviewer输出接收尝试记录.md`，再重新进入 `当前候选交付Reviewer输出接收门禁.md`。补交记录为 `resubmitted`、`ready-for-receipt-retry` 或 `closed`，都不表示 reviewer 输出已经被接收。

## 三、闭环字段

真实退回与补交记录应在线下保存；本仓库当前只保留字段模板：

- `returnClosureId`
- `sourceClarificationId`
- `sourceReceiptAttemptId`
- `reviewerName`
- `reviewerRole`
- `affectedEvidenceSlots`
- `returnReasonType`
- `returnReasonSummary`
- `returnedBy`
- `returnedAt`
- `requestedFix`
- `resubmissionOwner`
- `resubmissionDueAt`
- `resubmissionPackageRef`
- `resubmittedAt`
- `receiptRetryRequired`
- `receiptRetryCommand`
- `closureStatus`
- `closureSummary`
- `closedAt`
- `nextAction`
- `followUpOwner`
- `recoveryCondition`
- `targetReviewDate`

允许的 `returnReasonType`：

- `missing-required-field`
- `placeholder-detected`
- `missing-evidence-slot`
- `unclear-evidence-ref`
- `conflicting-disposition`
- `missing-risk-followup`
- `out-of-scope-output`
- `wrong-reviewer-role`
- `material-fix-required`

允许的 `closureStatus`：

- `returned`
- `fix-requested`
- `resubmitted`
- `ready-for-receipt-retry`
- `closed`
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

每个 slot 的真实 reviewer 输出仍需在重新接收时外部提供：

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

## 六、闭环处理规则

- `returned` 只表示已退回 reviewer 或责任人，不表示 evidence rejection。
- `fix-requested` 只表示已提出补齐要求，不表示补交完成。
- `resubmitted` 只表示 reviewer 已重新提交材料或输出，不表示接收通过。
- `ready-for-receipt-retry` 只表示可以先登记 `当前候选交付Reviewer输出重试批次登记表.md`，再登记 `当前候选交付Reviewer输出接收尝试记录.md` 并重新跑 `npm.cmd run candidate:reviewer-output-receipt-check`。
- `closed` 只表示退回与补交事项已收口，仍必须由 `当前候选交付Reviewer输出接收门禁.md` 判断是否接收。
- `cancelled` 必须写明取消原因和是否需要重新发起审查启动确认或澄清台账。

## 七、禁止事项

不得：

- 把 `resubmitted` 当作 reviewer evidence。
- 把 `ready-for-receipt-retry` 当作 Reviewer 输出接收门禁通过。
- 把 `closed` 当作 evidence acceptance。
- 把本记录当作接收尝试记录已经完成。
- 用本记录代填 `disposition`、`decisionReason` 或 `residualRisk`。
- 跳过 `当前候选交付Reviewer输出接收门禁.md`。
- 不得创建 `data/phase30-human-evidence-submission.json`。
- 不得设置 `releaseReady=true`。
- 不得设置 `phase29ExitReady=true`。
- 不得设置 `phase30EntryReady=true`。
- 不得启用 `runtimeExecution`。
- 不得启用 `thirdPartyExecution`。

## 八、建议检查命令

```powershell
npm.cmd run candidate:reviewer-output-return-resubmission-closure-check
npm.cmd run candidate:reviewer-output-reconciliation-failure-disposition-check
npm.cmd run candidate:reviewer-output-reconciliation-failure-disposition-outcome-check
npm.cmd run candidate:reviewer-output-reconciliation-rerun-readiness-check
npm.cmd run candidate:reviewer-output-reconciliation-rerun-execution-check
npm.cmd run candidate:reviewer-output-reconciliation-rerun-result-intake-check
npm.cmd run candidate:reviewer-output-field-gap-matrix-check
npm.cmd run candidate:reviewer-output-field-fix-assignment-check
npm.cmd run candidate:reviewer-output-field-fix-receipt-retry-readiness-check
npm.cmd run candidate:reviewer-output-retry-batch-register-check
npm.cmd run candidate:reviewer-output-retry-batch-attempt-reconciliation-check
npm.cmd run candidate:reviewer-output-receipt-attempt-log-check
npm.cmd run candidate:reviewer-in-review-blocker-clarification-check
npm.cmd run candidate:reviewer-review-start-confirmation-check
npm.cmd run candidate:reviewer-output-receipt-check
npm.cmd run candidate:reviewer-handoff-receipt-check
npm.cmd run candidate:reviewer-handoff-execution-check
npm.cmd run candidate:final-review-package-lock-check
npm.cmd run candidate:negative-misuse-check
npm.cmd run candidate:review-chain-integrity-check
npm.cmd run candidate:review-execution-sequence-check
npm.cmd run candidate:pre-review-package-check
npm.cmd run phase30:evidence-closure-status
npm.cmd run candidate:reviewer-output-reconciliation-rerun-result-review-check
npm.cmd run check
```

这些命令只证明 Reviewer 输出退回与补交闭环记录和候选审查链仍然守住红线；不证明 reviewer 输出已经产生，不证明 Reviewer 输出接收门禁通过，不证明维护者授权，也不证明 live submission 或 release approval。
