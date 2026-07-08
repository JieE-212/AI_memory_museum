# 当前候选交付Reviewer输出对账失败回流结果复核记录
状态：`reviewer-output-reconciliation-failure-disposition-outcome-only`

本记录用于在 `当前候选交付Reviewer输出对账失败回流处置单.md` 之后，复核回流处置是否真的落到目标材料：route owner 是否确认、目标材料是否产生修正引用、是否需要重新对账、是否需要重新登记 retry batch 或 receipt attempt。它只是 reconciliation failure disposition outcome review，不是 reviewer 输出，不是字段已修复证明，不是 Reviewer 输出接收门禁通过，不是 evidence acceptance，不是维护者授权，不是 live submission，不是 release approval，不是 Phase 29 exit，不是 Phase 30 entry，也不启用 runtime execution 或 third-party execution。

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

- 上游处置：`当前候选交付Reviewer输出对账失败回流处置单.md`
- 下游再对账准备：`当前候选交付Reviewer输出对账失败回流结果再对账准备记录.md`
- 下游再对账执行：`当前候选交付Reviewer输出再对账执行记录.md`
- 下游结果接收：`当前候选交付Reviewer输出再对账结果接收记录.md`
- 下游结果复核：`当前候选交付Reviewer输出再对账结果复核记录.md`
- 复核来源：`当前候选交付Reviewer输出重试批次与接收尝试对账记录.md`
- 结果目标：`当前候选交付Reviewer输出重试批次登记表.md`
- 结果目标：`当前候选交付Reviewer输出接收尝试记录.md`
- 结果目标：`当前候选交付Reviewer输出接收门禁.md`
- 结果目标：`当前候选交付Reviewer输出字段缺口定位矩阵.md`
- 结果目标：`当前候选交付Reviewer输出字段修复责任分派单.md`
- 结果目标：`当前候选交付Reviewer输出退回与补交闭环记录.md`

`当前候选交付Reviewer输出对账失败回流处置单.md` 只说明失败状态应该回到哪里；本记录只复核回流目标是否已经记录了可追踪结果。任何 `route-owner-acknowledged`、`correction-recorded`、`ready-for-reconciliation-rerun` 或 `ready-for-next-retry-batch` 都不表示 reviewer 输出已被接收，也不表示字段已修复或接收门禁通过。

## 三、复核字段
真实结果复核记录应在线下保存；本仓库当前只保留字段模板：

- `failureDispositionOutcomeId`
- `sourceFailureDispositionId`
- `sourceRetryAttemptReconciliationId`
- `sourceRetryBatchId`
- `sourceReceiptAttemptId`
- `sourceReceiptGateDecisionRef`
- `sourceFailureReasonType`
- `sourceDispositionRoute`
- `routeTargetDocument`
- `routeTargetOwner`
- `routeOwnerAcknowledged`
- `routeOwnerAcknowledgedAt`
- `correctionRecordRef`
- `correctionResultType`
- `correctionResultStatus`
- `recheckRequired`
- `recheckCommand`
- `nextReconciliationRef`
- `nextRetryBatchRef`
- `nextReceiptAttemptRef`
- `receiptGateRecheckRef`
- `outcomeStatus`
- `outcomeReviewedAt`
- `outcomeReviewedBy`
- `rollbackRequiredIfFailed`
- `rollbackTarget`
- `nextAction`
- `followUpOwner`
- `recoveryCondition`
- `targetReviewDate`

允许复核的 `sourceFailureReasonType`：

- `unmatched-batch`
- `orphan-attempt`
- `missing-gate-ref`
- `blocked-by-missing-attempt`
- `blocked-by-missing-gate-ref`
- `returned-for-gap-review`

允许复核的 `sourceDispositionRoute`：

- `return-to-retry-batch-register`
- `return-to-receipt-attempt-log`
- `return-to-receipt-gate`
- `return-to-field-gap-matrix`
- `return-to-field-fix-assignment`
- `return-to-return-resubmission-closure`
- `cancelled`

允许的 `correctionResultType`：

- `batch-register-corrected`
- `receipt-attempt-corrected`
- `receipt-gate-ref-corrected`
- `field-gap-matrix-opened`
- `field-fix-assignment-opened`
- `return-closure-opened`
- `next-retry-batch-prepared`
- `cancelled`

允许的 `correctionResultStatus`：

- `not-started`
- `owner-acknowledged`
- `correction-recorded`
- `awaiting-recheck`
- `recheck-ready`
- `returned-for-additional-disposition`
- `cancelled`

允许的 `outcomeStatus`：

- `draft`
- `awaiting-route-owner`
- `route-owner-acknowledged`
- `correction-recorded`
- `pending-recheck`
- `ready-for-reconciliation-rerun`
- `ready-for-next-retry-batch`
- `returned-for-additional-disposition`
- `cancelled`

## 四、结果复核表
| 处置路线 | 必须复核的结果 | 下一步 |
| --- | --- | --- |
| `return-to-retry-batch-register` | `batch-register-corrected` 或 `next-retry-batch-prepared` | 重新登记 retry batch，再进入接收尝试和对账 |
| `return-to-receipt-attempt-log` | `receipt-attempt-corrected` | 重新核对 source batch、attempt 和 gate ref |
| `return-to-receipt-gate` | `receipt-gate-ref-corrected` | 重新跑接收门禁引用检查 |
| `return-to-field-gap-matrix` | `field-gap-matrix-opened` | 进入字段缺口定位和修复分派 |
| `return-to-field-fix-assignment` | `field-fix-assignment-opened` | 明确修复 owner、期限和补交路线 |
| `return-to-return-resubmission-closure` | `return-closure-opened` | 收口退回补交，再进入下一次接收尝试 |
| `cancelled` | `cancelled` | 写明取消原因和是否需要新增处置单 |

## 五、必须覆盖的 reviewer role

- `release owner`
- `runtime owner`
- `security reviewer`
- `data steward`
- `audit reviewer`

## 六、必须覆盖的 evidence slots

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

## 七、复核规则

- `routeOwnerAcknowledged=true` 只表示目标 owner 知道回流事项，不表示修正完成。
- `correction-recorded` 只表示目标材料出现修正引用，不表示字段已修复、门禁已通过或 evidence accepted。
- `ready-for-reconciliation-rerun` 必须重新进入 `当前候选交付Reviewer输出重试批次与接收尝试对账记录.md`，不得直接进入接收通过。
- `ready-for-next-retry-batch` 必须先回到 `当前候选交付Reviewer输出重试批次登记表.md`，再登记 `当前候选交付Reviewer输出接收尝试记录.md`。
- `receipt-gate-ref-corrected` 必须重新核对 `当前候选交付Reviewer输出接收门禁.md`，不得用本记录生成 gate pass。
- `returned-for-additional-disposition` 必须回到 `当前候选交付Reviewer输出对账失败回流处置单.md`，重新登记处置路线。
- 每次复核结果如果要求 recheck，必须写明 `recheckCommand`、`nextReconciliationRef` 或目标重试引用。
- 每条 `ready-for-reconciliation-rerun` 或 `ready-for-next-retry-batch` 必须先进入 `当前候选交付Reviewer输出对账失败回流结果再对账准备记录.md`，确认再对账或下一次 retry batch 的输入齐备。

## 八、禁止事项
不得：

- 把对账失败回流结果复核记录当作 reviewer 输出。
- 把 `route-owner-acknowledged`、`correction-recorded`、`ready-for-reconciliation-rerun` 或 `ready-for-next-retry-batch` 当作字段已修复。
- 把 `receipt-gate-ref-corrected` 当作 Reviewer 输出接收门禁通过。
- 用本记录代填 `reviewer`、`reviewedAt`、`evidenceRef`、`disposition`、`decisionReason`、`residualRisk` 或风险 follow-up 字段。
- 用本记录跳过 `当前候选交付Reviewer输出对账失败回流处置单.md`。
- 用本记录跳过 `当前候选交付Reviewer输出重试批次与接收尝试对账记录.md`。
- 用本记录跳过 `当前候选交付Reviewer输出重试批次登记表.md`。
- 用本记录跳过 `当前候选交付Reviewer输出接收尝试记录.md`。
- 用本记录跳过 `当前候选交付Reviewer输出接收门禁.md`。
- 不得创建 `data/phase30-human-evidence-submission.json`。
- 不得设置 `releaseReady=true`。
- 不得设置 `phase29ExitReady=true`。
- 不得设置 `phase30EntryReady=true`。
- 不得启用 `runtimeExecution`。
- 不得启用 `thirdPartyExecution`。

## 九、建议检查命令

```powershell
npm.cmd run candidate:reviewer-output-reconciliation-failure-disposition-outcome-check
npm.cmd run candidate:reviewer-output-reconciliation-rerun-readiness-check
npm.cmd run candidate:reviewer-output-reconciliation-rerun-execution-check
npm.cmd run candidate:reviewer-output-reconciliation-rerun-result-intake-check
npm.cmd run candidate:reviewer-output-reconciliation-failure-disposition-check
npm.cmd run candidate:reviewer-output-retry-batch-attempt-reconciliation-check
npm.cmd run candidate:reviewer-output-retry-batch-register-check
npm.cmd run candidate:reviewer-output-receipt-attempt-log-check
npm.cmd run candidate:reviewer-output-receipt-check
npm.cmd run candidate:reviewer-output-field-gap-matrix-check
npm.cmd run candidate:reviewer-output-field-fix-assignment-check
npm.cmd run candidate:reviewer-output-return-resubmission-closure-check
npm.cmd run candidate:final-review-package-lock-check
npm.cmd run candidate:negative-misuse-check
npm.cmd run candidate:review-chain-integrity-check
npm.cmd run candidate:review-execution-sequence-check
npm.cmd run candidate:pre-review-package-check
npm.cmd run phase30:evidence-closure-status
npm.cmd run candidate:reviewer-output-reconciliation-rerun-result-review-check
npm.cmd run check
```

这些命令只证明 Reviewer 输出对账失败回流结果复核记录和候选审查链仍然守住红线；不证明字段已经修复，不证明 reviewer 输出已经产生，不证明 Reviewer 输出接收门禁通过，不证明维护者授权，也不证明 live submission 或 release approval。
