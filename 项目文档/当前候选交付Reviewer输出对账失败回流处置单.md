# 当前候选交付Reviewer输出对账失败回流处置单
状态：`reviewer-output-reconciliation-failure-disposition-only`

本处置单用于在 `当前候选交付Reviewer输出重试批次与接收尝试对账记录.md` 发现失败或缺口后，把失败状态明确回流到 retry batch、receipt attempt、receipt gate、字段缺口定位、字段修复责任分派或退回补交闭环。它只是 reconciliation failure disposition，不是 reviewer 输出，不是字段已修复证明，不是 Reviewer 输出接收门禁通过，不是 evidence acceptance，不是维护者授权，不是 live submission，不是 release approval，不是 Phase 29 exit，不是 Phase 30 entry，也不启用 runtime execution 或 third-party execution。

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
本处置单只能在以下链路位置使用：

- 上游对账：`当前候选交付Reviewer输出重试批次与接收尝试对账记录.md`
- 下游结果复核：`当前候选交付Reviewer输出对账失败回流结果复核记录.md`
- 下游再对账准备：`当前候选交付Reviewer输出对账失败回流结果再对账准备记录.md`
- 下游再对账执行：`当前候选交付Reviewer输出再对账执行记录.md`
- 下游结果接收：`当前候选交付Reviewer输出再对账结果接收记录.md`
- 下游结果复核：`当前候选交付Reviewer输出再对账结果复核记录.md`
- 回流目标：`当前候选交付Reviewer输出重试批次登记表.md`
- 回流目标：`当前候选交付Reviewer输出接收尝试记录.md`
- 回流目标：`当前候选交付Reviewer输出接收门禁.md`
- 回流目标：`当前候选交付Reviewer输出字段缺口定位矩阵.md`
- 回流目标：`当前候选交付Reviewer输出字段修复责任分派单.md`
- 回流目标：`当前候选交付Reviewer输出退回与补交闭环记录.md`

`当前候选交付Reviewer输出重试批次与接收尝试对账记录.md` 只说明 batch、attempt 和 gate ref 是否可追溯；本处置单只说明失败后回到哪里修正。任何 `failure-disposition-routed`、`returned-to-owner` 或 `ready-for-next-retry-batch` 都不表示 reviewer 输出已被接收，也不表示字段已修复或接收门禁通过。

## 三、处置字段
真实失败处置记录应在线下保存；本仓库当前只保留字段模板：

- `failureDispositionId`
- `sourceRetryAttemptReconciliationId`
- `sourceRetryBatchId`
- `sourceReceiptAttemptId`
- `sourceReceiptGateDecisionRef`
- `failedReconciliationStatus`
- `failedBatchToAttemptMatchStatus`
- `failureReasonType`
- `failureReasonSummary`
- `affectedEvidenceSlots`
- `affectedFieldNames`
- `reviewerRoles`
- `dispositionRoute`
- `routeTargetDocument`
- `routeTargetOwner`
- `routeTargetDueAt`
- `requiredCorrection`
- `rollbackRequiredIfFailed`
- `rollbackTarget`
- `returnClosureRef`
- `fieldGapMatrixRef`
- `fieldFixAssignmentRef`
- `nextRetryBatchRef`
- `nextReceiptAttemptRef`
- `receiptGateRecheckRequired`
- `dispositionStatus`
- `disposedAt`
- `disposedBy`
- `nextAction`
- `followUpOwner`
- `recoveryCondition`
- `targetReviewDate`

允许处置的 `failedReconciliationStatus`：

- `blocked-by-missing-attempt`
- `blocked-by-missing-gate-ref`
- `returned-for-gap-review`

允许处置的 `failedBatchToAttemptMatchStatus`：

- `unmatched-batch`
- `orphan-attempt`
- `missing-gate-ref`

允许的 `failureReasonType`：

- `unmatched-batch`
- `orphan-attempt`
- `missing-gate-ref`
- `blocked-by-missing-attempt`
- `blocked-by-missing-gate-ref`
- `returned-for-gap-review`

允许的 `dispositionRoute`：

- `return-to-retry-batch-register`
- `return-to-receipt-attempt-log`
- `return-to-receipt-gate`
- `return-to-field-gap-matrix`
- `return-to-field-fix-assignment`
- `return-to-return-resubmission-closure`
- `cancelled`

允许的 `dispositionStatus`：

- `draft`
- `needs-owner-triage`
- `routed`
- `returned-to-owner`
- `ready-for-field-gap-review`
- `ready-for-field-fix-assignment`
- `ready-for-return-closure`
- `ready-for-next-retry-batch`
- `cancelled`

## 四、失败状态回流表
| 失败状态 | 必须回流到 | 不得解释为 |
| --- | --- | --- |
| `unmatched-batch` | `当前候选交付Reviewer输出重试批次登记表.md` | retry batch 已可接收 |
| `orphan-attempt` | `当前候选交付Reviewer输出接收尝试记录.md` | 接收尝试可绕过批次来源 |
| `missing-gate-ref` | `当前候选交付Reviewer输出接收尝试记录.md` 和 `当前候选交付Reviewer输出接收门禁.md` | 接收门禁已通过 |
| `blocked-by-missing-attempt` | `当前候选交付Reviewer输出重试批次登记表.md` 和 `当前候选交付Reviewer输出接收尝试记录.md` | retry batch 已执行 |
| `blocked-by-missing-gate-ref` | `当前候选交付Reviewer输出接收尝试记录.md` 和 `当前候选交付Reviewer输出接收门禁.md` | gate ref 已有效 |
| `returned-for-gap-review` | `当前候选交付Reviewer输出字段缺口定位矩阵.md`、`当前候选交付Reviewer输出字段修复责任分派单.md` 和 `当前候选交付Reviewer输出退回与补交闭环记录.md` | 字段已修复或 evidence accepted |

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

## 七、处置规则

- `unmatched-batch` 必须先回到 `当前候选交付Reviewer输出重试批次登记表.md` 澄清 batch、target attempt 和失败回滚。
- `orphan-attempt` 必须先回到 `当前候选交付Reviewer输出接收尝试记录.md` 补齐来源 retry batch 或取消原因。
- `missing-gate-ref` 必须同时核对 `当前候选交付Reviewer输出接收尝试记录.md` 与 `当前候选交付Reviewer输出接收门禁.md`，不得用本处置单生成 gate pass。
- `blocked-by-missing-attempt` 必须回到 retry batch register 和 receipt attempt log，补齐 `targetReceiptAttemptId` 后再重新对账。
- `blocked-by-missing-gate-ref` 必须回到 receipt attempt log 和 receipt gate，补齐 `receiptGateDecisionRef` 后再重新对账。
- `returned-for-gap-review` 必须回到 `当前候选交付Reviewer输出字段缺口定位矩阵.md`，再按阻塞等级进入 `当前候选交付Reviewer输出字段修复责任分派单.md` 或 `当前候选交付Reviewer输出退回与补交闭环记录.md`。
- 进入下一次重试前，仍必须重新登记 `当前候选交付Reviewer输出重试批次登记表.md`、`当前候选交付Reviewer输出接收尝试记录.md`，并再次经过 `当前候选交付Reviewer输出接收门禁.md`。
- 每条 `routed`、`returned-to-owner` 或 `ready-for-next-retry-batch` 都必须进入 `当前候选交付Reviewer输出对账失败回流结果复核记录.md`，确认目标材料是否已有可追踪结果。

## 八、禁止事项
不得：

- 把对账失败回流处置单当作 reviewer 输出。
- 把 `routed`、`returned-to-owner` 或 `ready-for-next-retry-batch` 当作字段已修复。
- 把 `return-to-receipt-gate` 当作 Reviewer 输出接收门禁通过。
- 用本处置单代填 `reviewer`、`reviewedAt`、`evidenceRef`、`disposition`、`decisionReason`、`residualRisk` 或风险 follow-up 字段。
- 用本处置单跳过 `当前候选交付Reviewer输出字段缺口定位矩阵.md`。
- 用本处置单跳过 `当前候选交付Reviewer输出字段修复责任分派单.md`。
- 用本处置单跳过 `当前候选交付Reviewer输出退回与补交闭环记录.md`。
- 用本处置单跳过 `当前候选交付Reviewer输出接收尝试记录.md`。
- 用本处置单跳过 `当前候选交付Reviewer输出接收门禁.md`。
- 不得创建 `data/phase30-human-evidence-submission.json`。
- 不得设置 `releaseReady=true`。
- 不得设置 `phase29ExitReady=true`。
- 不得设置 `phase30EntryReady=true`。
- 不得启用 `runtimeExecution`。
- 不得启用 `thirdPartyExecution`。

## 九、建议检查命令

```powershell
npm.cmd run candidate:reviewer-output-reconciliation-failure-disposition-check
npm.cmd run candidate:reviewer-output-reconciliation-failure-disposition-outcome-check
npm.cmd run candidate:reviewer-output-reconciliation-rerun-readiness-check
npm.cmd run candidate:reviewer-output-reconciliation-rerun-execution-check
npm.cmd run candidate:reviewer-output-reconciliation-rerun-result-intake-check
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

这些命令只证明 Reviewer 输出对账失败回流处置单和候选审查链仍然守住红线；不证明字段已经修复，不证明 reviewer 输出已经产生，不证明 Reviewer 输出接收门禁通过，不证明维护者授权，也不证明 live submission 或 release approval。
