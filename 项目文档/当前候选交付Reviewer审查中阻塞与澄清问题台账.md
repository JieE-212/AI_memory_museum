# 当前候选交付Reviewer审查中阻塞与澄清问题台账

状态：`reviewer-in-review-blocker-clarification-ledger-only`

本台账用于在 Reviewer 已按 `当前候选交付Reviewer审查启动确认模板.md` 确认开始审查之后、正式 reviewer 输出进入 `当前候选交付Reviewer输出接收门禁.md` 之前，记录审查中的阻塞、澄清问题、材料补发和恢复条件。它只是 in-review blocker / clarification ledger，不是 reviewer 输出，不是 Reviewer 输出接收门禁通过，不是 evidence acceptance，不是维护者授权，不是 live submission，不是 release approval，不是 Phase 29 exit，不是 Phase 30 entry，也不启用 runtime execution 或 third-party execution。

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

本台账只能在以下链路位置使用：

- 上游：`当前候选交付Reviewer审查启动确认模板.md`
- 当前：`当前候选交付Reviewer审查中阻塞与澄清问题台账.md`
- 下游补交闭环：`当前候选交付Reviewer输出退回与补交闭环记录.md`
- 下游：`当前候选交付Reviewer输出接收门禁.md`

本台账记录的是 reviewer 审查中的问题流转。即使某个问题状态为 `answered` 或 `resolved`，也不表示 reviewer 已完成审查，不表示 evidence slot 已通过，不表示 Reviewer 输出接收门禁已经通过。

## 三、台账字段

真实审查中的阻塞和澄清记录应在线下保存；本仓库当前只保留字段模板：

- `clarificationId`
- `sourceReviewStartConfirmationId`
- `reviewerName`
- `reviewerRole`
- `affectedEvidenceSlots`
- `issueType`
- `issueSummary`
- `question`
- `requestedFrom`
- `owner`
- `openedAt`
- `targetResponseAt`
- `status`
- `resolutionSummary`
- `resolvedAt`
- `nextAction`
- `followUpOwner`
- `recoveryCondition`
- `targetReviewDate`

允许的 `issueType`：

- `missing-material`
- `unclear-scope`
- `conflicting-instruction`
- `missing-context`
- `role-mismatch`
- `blocked-by-policy`
- `needs-maintainer-clarification`

允许的 `status`：

- `open`
- `answered`
- `returned-for-material-fix`
- `blocked`
- `resolved`
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

每个 slot 的真实 reviewer 输出仍需在审查完成后外部提供：

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

## 六、澄清处理规则

- `open` 只表示问题已提出，不能继续解释为 reviewer 输出。
- `answered` 只表示问题已收到答复，不能解释为 evidence acceptance。
- `returned-for-material-fix` 只表示材料需要补发或修正，不能解释为 slot 被拒绝或批准；补交动作应转入 `当前候选交付Reviewer输出退回与补交闭环记录.md`。
- `blocked` 必须写明 `recoveryCondition`、`followUpOwner` 和 `targetReviewDate`。
- `resolved` 只表示该澄清问题已收口，不能替代 `reviewer`、`reviewedAt`、`evidenceRef`、`disposition`、`decisionReason` 或 `residualRisk`。
- `cancelled` 必须写明取消原因和是否需要重新发起审查启动确认。

## 七、禁止事项

不得：

- 把 `answered` 或 `resolved` 澄清记录当作 reviewer evidence。
- 把本台账当作 Reviewer 输出接收门禁通过。
- 把本台账当作 evidence acceptance。
- 把本台账当作输出退回与补交闭环已经完成。
- 用本台账代填 `disposition`、`decisionReason` 或 `residualRisk`。
- 跳过 `当前候选交付Reviewer输出接收门禁.md`。
- 不得创建 `data/phase30-human-evidence-submission.json`。
- 不得设置 `releaseReady=true`。
- 不得设置 `phase29ExitReady=true`。
- 不得设置 `phase30EntryReady=true`。
- 不得启用 `runtimeExecution`。
- 不得启用 `thirdPartyExecution`。

## 八、建议检查命令

```powershell
npm.cmd run candidate:reviewer-in-review-blocker-clarification-check
npm.cmd run candidate:reviewer-output-return-resubmission-closure-check
npm.cmd run candidate:reviewer-review-start-confirmation-check
npm.cmd run candidate:reviewer-handoff-receipt-check
npm.cmd run candidate:reviewer-handoff-execution-check
npm.cmd run candidate:final-review-package-lock-check
npm.cmd run candidate:negative-misuse-check
npm.cmd run candidate:review-chain-integrity-check
npm.cmd run candidate:review-execution-sequence-check
npm.cmd run candidate:pre-review-package-check
npm.cmd run phase30:evidence-closure-status
npm.cmd run check
```

这些命令只证明审查中阻塞与澄清问题台账和候选审查链仍然守住红线；不证明 reviewer 输出已经产生，不证明 Reviewer 输出接收门禁通过，不证明维护者授权，也不证明 live submission 或 release approval。
