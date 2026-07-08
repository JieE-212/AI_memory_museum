# 当前候选交付人工审查演练 Dry-run 记录模板

状态：`review-dry-run-record-template-only`

本模板用于在正式人工审查会议前，模拟走一遍候选交付人工审查链，记录命令、断点、退回项和误用风险。它不是 reviewer 输出，不是会后真实汇总，不是 receipt acceptance，不是 live submission，不是 release approval，不是 Phase 29 exit，不是 Phase 30 entry，也不启用 runtime execution 或 third-party execution。

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
- `dryRunOnly=true`
- `receiptAcceptedByMaintainer=false`
- `readyForPostReviewSummary=false`
- `readyForConversionPreflight=false`

## 二、使用位置

本模板必须按 `当前候选交付人工审查执行顺序总表.md` 和 `当前候选交付人工审查链完整性索引.md` 使用。

本模板不得替代 `当前候选交付维护者转换授权前置模板.md`，也不得跳过 `当前候选交付负向用例防误用检查.md`；dry-run 通过不能成为维护者显式转换授权。

建议位置：

1. 完成 `npm.cmd run candidate:review-chain-integrity-check`。
2. 使用本模板做一次 dry-run 记录。
3. 只有 dry-run 发现的断点都处理后，才进入正式 `阶段30人工审查会议包.md`。

## 三、Dry-run 包头字段

演练记录应在线下填写以下字段，但本仓库当前不保存真实演练记录：

- `dryRunId`
- `dryRunAt`
- `dryRunBy`
- `sourceSequenceRef`
- `sourceIntegrityRef`
- `commandsPlanned`
- `commandsExecuted`
- `commandFailures`
- `blockedStepCount`
- `returnToReviewerCount`
- `misuseRiskCount`
- `dryRunConclusion`

允许的 `dryRunConclusion`：

- `ready-for-human-review-meeting`
- `blocked-by-missing-material`
- `blocked-by-command-failure`
- `blocked-by-sequence-gap`
- `blocked-by-misuse-risk`

## 四、逐步演练记录字段

每个步骤应记录：

- `dryRunStep`
- `materialRef`
- `commandRef`
- `expectedOutput`
- `actualDryRunObservation`
- `blocked`
- `blockerReason`
- `returnTarget`
- `nextRequiredAction`

`blocked=true` 时，必须填写 `blockerReason`、`returnTarget` 和 `nextRequiredAction`。

## 五、必须演练的命令

```powershell
npm.cmd run phase30:evidence-closure-status
npm.cmd run candidate:pre-review-package-check
npm.cmd run candidate:review-execution-sequence-check
npm.cmd run candidate:review-chain-integrity-check
npm.cmd run candidate:negative-misuse-check
npm.cmd run candidate:reviewer-workbench-check
npm.cmd run candidate:reviewer-output-receipt-check
npm.cmd run candidate:reviewer-output-summary-template-check
npm.cmd run phase30:post-review-evidence-summary
npm.cmd run phase30:human-evidence-conflict-review
npm.cmd run phase30:risk-disposition-followup-ledger
npm.cmd run phase30:live-submission-conversion-preflight
npm.cmd run check
```

这些命令通过，只代表 dry-run 检查链没有结构性断点；不代表 reviewer 输出已经产生、被接收或被汇总。

## 六、必须覆盖的 evidence slots

dry-run 必须确认下列 10 个 evidence slots 仍处于缺真实 reviewer 输出状态：

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

每个 slot 仍需真实 reviewer 在正式审查中提供：

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

## 七、禁止事项

不得：

- 把 dry-run 记录当作 reviewer evidence。
- 把 dry-run 通过当作 receipt acceptance。
- 把 dry-run 通过当作 post-review summary。
- 把 dry-run 通过当作 release approval。
- 用 dry-run 代替 `当前候选交付Reviewer输出接收门禁.md`。
- 用 dry-run 代替 `当前候选交付Reviewer输出离线汇总模板索引.md`。
- 用 dry-run 代替 `当前候选交付负向用例防误用检查.md`。
- 不得创建 `data/phase30-human-evidence-submission.json`。
- 不得设置 `releaseReady=true`。
- 不得设置 `phase29ExitReady=true`。
- 不得设置 `phase30EntryReady=true`。
- 不得启用 `runtimeExecution`。
- 不得启用 `thirdPartyExecution`。

## 八、建议检查命令

```powershell
npm.cmd run candidate:review-dry-run-record-check
npm.cmd run candidate:maintainer-conversion-authorization-check
npm.cmd run candidate:review-chain-integrity-check
npm.cmd run candidate:review-execution-sequence-check
npm.cmd run candidate:negative-misuse-check
npm.cmd run phase30:evidence-closure-status
npm.cmd run check
```

这些命令只证明 dry-run 记录模板和候选审查链仍然守住红线；不证明任何 reviewer 输出已经产生、被接收或被汇总。
