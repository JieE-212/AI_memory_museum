# 当前候选交付 Reviewer 审查启动确认模板

状态：`reviewer-review-start-confirmation-template-only`

本模板用于 reviewer 在材料包签收后、正式产出 reviewer 输出前，确认自己已经开始审查、理解负责槽位、理解红线、理解输出字段和退回路径。它只是 reviewer review start confirmation template，不是 reviewer 输出，不是 Reviewer 输出接收门禁通过，不是 evidence acceptance，不是维护者授权，不是 live submission，不是 release approval，不是 Phase 29 exit，不是 Phase 30 entry，也不启用 runtime execution 或 third-party execution。

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

本模板只能在以下条件满足后使用：

- `当前候选交付Reviewer实际交付执行清单.md` 已标记材料已发送。
- `当前候选交付Reviewer交付签收与退回回执模板.md` 已确认材料包收到，或已完成退回补发后再次收到。
- reviewer 已确认负责的 evidence slots 和输出字段。

本模板必须早于 `当前候选交付Reviewer审查中阻塞与澄清问题台账.md` 和 `当前候选交付Reviewer输出接收门禁.md` 使用。审查启动确认不表示 reviewer 已完成审查，也不表示 reviewer 输出已经可接收。审查启动后若出现阻塞、澄清或补发事项，应先记录到 `当前候选交付Reviewer审查中阻塞与澄清问题台账.md`。

## 三、启动确认字段

真实启动确认应在线下保存，本仓库当前只保留字段模板：

- `reviewStartConfirmationId`
- `sourceHandoffReceiptId`
- `handoffPackageRef`
- `reviewerName`
- `reviewerRole`
- `reviewStartedAt`
- `assignedEvidenceSlots`
- `scopeUnderstood`
- `redlinesUnderstood`
- `requiredFieldsUnderstood`
- `outputChannelConfirmed`
- `returnChannelConfirmed`
- `cannotApproveByStartConfirmation`
- `cannotCreateLiveSubmission`
- `reviewStartStatus`
- `blockerReason`
- `nextAction`

允许的 `reviewStartStatus`：

- `review-started`
- `blocked-by-missing-material`
- `blocked-by-unclear-scope`
- `blocked-by-role-mismatch`
- `blocked-by-reviewer-unavailability`
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

每个 slot 的真实 reviewer 输出仍需在审查完成后提供：

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

## 六、启动确认后仍然不允许

不得：

- 把 `review-started` 当作 reviewer evidence。
- 把启动确认当作 Reviewer 输出接收门禁通过。
- 把启动确认当作 evidence acceptance。
- 把启动确认当作审查中阻塞与澄清问题台账已收口。
- 代替 reviewer 填写 `disposition`、`decisionReason` 或 `residualRisk`。
- 不得创建 `data/phase30-human-evidence-submission.json`。
- 不得设置 `releaseReady=true`。
- 不得设置 `phase29ExitReady=true`。
- 不得设置 `phase30EntryReady=true`。
- 不得启用 `runtimeExecution`。
- 不得启用 `thirdPartyExecution`。

## 七、建议检查命令

```powershell
npm.cmd run candidate:reviewer-review-start-confirmation-check
npm.cmd run candidate:reviewer-in-review-blocker-clarification-check
npm.cmd run candidate:reviewer-handoff-receipt-check
npm.cmd run candidate:reviewer-handoff-execution-check
npm.cmd run candidate:final-review-package-lock-check
npm.cmd run candidate:negative-misuse-check
npm.cmd run candidate:review-chain-integrity-check
npm.cmd run candidate:review-execution-sequence-check
npm.cmd run phase30:evidence-closure-status
npm.cmd run check
```

这些命令只证明 reviewer 审查启动确认模板和候选审查链仍然守住红线；不证明 reviewer 输出已经产生，不证明 Reviewer 输出接收门禁通过，不证明维护者授权，也不证明 live submission 或 release approval。
