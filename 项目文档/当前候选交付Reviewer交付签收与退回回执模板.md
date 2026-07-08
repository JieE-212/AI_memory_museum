# 当前候选交付 Reviewer 交付签收与退回回执模板

状态：`reviewer-handoff-receipt-template-only`

本模板用于在候选审查包交付 reviewer 后，记录 reviewer 对材料包的签收、退回、缺失材料、范围不清和下一步补发动作。它只是 reviewer handoff receipt template，不是 reviewer 输出，不是 Reviewer 输出接收门禁通过，不是 evidence acceptance，不是维护者授权，不是 live submission，不是 release approval，不是 Phase 29 exit，不是 Phase 30 entry，也不启用 runtime execution 或 third-party execution。

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

本模板只能在 `当前候选交付Reviewer实际交付执行清单.md` 之后使用，用于记录材料包层面的签收或退回：

- `sent-to-reviewer` 后，可以生成材料签收回执。
- `received-by-reviewer` 只表示 reviewer 收到材料，不表示 reviewer 已完成审查。
- `returned-for-missing-material` 或 `returned-for-unclear-scope` 只表示材料包需补发或澄清，不表示 evidence slot 被拒绝。
- 材料签收后，应使用 `当前候选交付Reviewer审查启动确认模板.md` 记录 reviewer 已开始审查，但启动确认仍不是 reviewer 输出。
- 审查启动后出现阻塞、澄清或补发事项时，应使用 `当前候选交付Reviewer审查中阻塞与澄清问题台账.md` 记录；该台账仍不是 reviewer 输出。
- 本模板不得替代 `当前候选交付Reviewer输出接收门禁.md`。

## 三、回执字段

真实回执应在线下保存，本仓库当前只保留字段模板：

- `handoffReceiptId`
- `sourceHandoffExecutionId`
- `handoffPackageRef`
- `reviewerName`
- `reviewerRole`
- `reviewerContact`
- `receivedAt`
- `receiptStatus`
- `materialsReceived`
- `missingMaterials`
- `unclearScopeItems`
- `returnedAt`
- `returnReason`
- `requestedFix`
- `resubmissionOwner`
- `resubmissionDueAt`
- `redlinesAcknowledged`
- `misuseGuardAcknowledged`
- `nextAction`

允许的 `receiptStatus`：

- `package-received`
- `returned-for-missing-material`
- `returned-for-unclear-scope`
- `returned-for-wrong-reviewer`
- `blocked-by-reviewer-unavailability`
- `cancelled`

## 四、回执必须覆盖的 reviewer role

- `release owner`
- `runtime owner`
- `security reviewer`
- `data steward`
- `audit reviewer`

## 五、回执仍不得替代的 evidence slots

以下 10 个 evidence slots 仍缺真实 reviewer 输出：

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

每个 slot 仍需真实 reviewer 在审查后提供：

- `reviewer`
- `reviewedAt`
- `evidenceRef`
- `disposition`
- `decisionReason`
- `residualRisk`

## 六、回执后仍然不允许

不得：

- 把 `package-received` 当作 reviewer evidence。
- 把材料签收回执当作 Reviewer 输出接收门禁通过。
- 把 `当前候选交付Reviewer审查启动确认模板.md` 当作 reviewer 输出。
- 把 `当前候选交付Reviewer审查中阻塞与澄清问题台账.md` 当作 reviewer 输出或 Reviewer 输出接收门禁通过。
- 把 `returned-for-missing-material` 当作 evidence rejection。
- 把 `returned-for-unclear-scope` 当作 evidence rejection。
- 代替 reviewer 填写 `disposition`、`decisionReason` 或 `residualRisk`。
- 不得创建 `data/phase30-human-evidence-submission.json`。
- 不得设置 `releaseReady=true`。
- 不得设置 `phase29ExitReady=true`。
- 不得设置 `phase30EntryReady=true`。
- 不得启用 `runtimeExecution`。
- 不得启用 `thirdPartyExecution`。

## 七、建议检查命令

```powershell
npm.cmd run candidate:reviewer-handoff-receipt-check
npm.cmd run candidate:reviewer-review-start-confirmation-check
npm.cmd run candidate:reviewer-in-review-blocker-clarification-check
npm.cmd run candidate:reviewer-handoff-execution-check
npm.cmd run candidate:final-review-package-lock-check
npm.cmd run candidate:negative-misuse-check
npm.cmd run candidate:review-chain-integrity-check
npm.cmd run candidate:review-execution-sequence-check
npm.cmd run phase30:evidence-closure-status
npm.cmd run check
```

这些命令只证明 reviewer 材料交付回执模板和候选审查链仍然守住红线；不证明 reviewer 输出已经产生，不证明 Reviewer 输出接收门禁通过，不证明维护者授权，也不证明 live submission 或 release approval。
