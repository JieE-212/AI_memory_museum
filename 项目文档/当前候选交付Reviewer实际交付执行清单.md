# 当前候选交付 Reviewer 实际交付执行清单

状态：`reviewer-handoff-execution-checklist-only`

本清单用于把已经锁定的候选人工审查包实际交付给 reviewer 时逐项勾选、签收、退回和记录交付状态。它只是 reviewer handoff execution checklist，不是 reviewer 输出，不是 receipt acceptance，不是 evidence acceptance，不是维护者授权，不是 live submission，不是 release approval，不是 Phase 29 exit，不是 Phase 30 entry，也不启用 runtime execution 或 third-party execution。

材料签收和退回的回执字段由 `当前候选交付Reviewer交付签收与退回回执模板.md` 承接；该回执仍然只是材料包回执，不是 Reviewer 输出接收门禁通过。

材料包签收后，reviewer 应使用 `当前候选交付Reviewer审查启动确认模板.md` 确认已经开始审查并理解槽位、红线和输出字段；启动确认仍不是 reviewer 输出。审查启动后的阻塞、澄清或补发事项应记录到 `当前候选交付Reviewer审查中阻塞与澄清问题台账.md`，该台账仍不是 Reviewer 输出接收门禁通过。

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

## 二、交付前置条件

交付 reviewer 前必须先完成：

- `当前候选交付审查前包索引.md`
- `当前候选交付人工审查执行顺序总表.md`
- `当前候选交付人工审查链完整性索引.md`
- `当前候选交付人工审查演练Dry-run记录模板.md`
- `当前候选交付维护者转换授权前置模板.md`
- `当前候选交付负向用例防误用检查.md`
- `当前候选交付人工审查包最终锁定索引.md`
- `当前候选交付Reviewer交付签收与退回回执模板.md`
- `当前候选交付Reviewer审查启动确认模板.md`
- `当前候选交付Reviewer审查中阻塞与澄清问题台账.md`

前置检查命令：

```powershell
npm.cmd run candidate:pre-review-package-check
npm.cmd run candidate:review-execution-sequence-check
npm.cmd run candidate:review-chain-integrity-check
npm.cmd run candidate:review-dry-run-record-check
npm.cmd run candidate:maintainer-conversion-authorization-check
npm.cmd run candidate:negative-misuse-check
npm.cmd run candidate:final-review-package-lock-check
```

## 三、交付执行字段

真实交付记录应在线下保存，本仓库当前只保留字段模板：

- `handoffExecutionId`
- `handoffPreparedAt`
- `handoffPreparedBy`
- `handoffPackageRef`
- `reviewerName`
- `reviewerRole`
- `reviewerContact`
- `assignedEvidenceSlots`
- `materialsDelivered`
- `commandsDelivered`
- `redlinesAcknowledged`
- `misuseGuardAcknowledged`
- `returnChannel`
- `dueAt`
- `handoffStatus`
- `returnReason`
- `nextAction`

允许的 `handoffStatus`：

- `ready-to-send`
- `sent-to-reviewer`
- `received-by-reviewer`
- `returned-for-missing-material`
- `returned-for-unclear-scope`
- `blocked-by-reviewer-unavailability`
- `cancelled`

## 四、交付对象和槽位

交付必须覆盖以下 reviewer role 和 evidence slots：

| reviewer role | assigned evidence slots | handoff note |
| --- | --- | --- |
| release owner | `release-blocker-disposition`, `transition-redline-disposition`, `signoff-evidence-reconciliation`, `release-runtime-separation` | 只交付审查材料，不代写 disposition |
| runtime owner | `runtime-owner-go-no-go`, `rollback-strategy-review` | 只交付运行时审查输入，不启用 runtime |
| security reviewer | `sandbox-acceptance-review`, `secret-boundary-review` | 只交付安全边界输入，不授予 secret access |
| data steward | `private-memory-boundary-review` | 只交付私有记忆边界输入，不读取真实私密数据 |
| audit reviewer | `audit-dry-run-review` | 只交付审计演练输入，不生成审计签核 |

## 五、交付材料清单

每次交付必须显式包含：

- `README.md`
- `当前候选交付变更索引.md`
- `当前候选交付验收说明.md`
- `阶段30人工证据闭环状态审计.md`
- `当前候选交付审查前包索引.md`
- `当前候选交付人工审查执行顺序总表.md`
- `当前候选交付人工审查链完整性索引.md`
- `当前候选交付人工审查演练Dry-run记录模板.md`
- `阶段30人工Reviewer交接包.md`
- `当前候选交付Reviewer证据槽位工作台.md`
- `阶段30人工审查会议包.md`
- `当前候选交付Reviewer输出接收门禁.md`
- `当前候选交付Reviewer输出离线汇总模板索引.md`
- `当前候选交付负向用例防误用检查.md`
- `当前候选交付人工审查包最终锁定索引.md`

## 六、交付后仍然不允许

不得：

- 把 `sent-to-reviewer` 当作 reviewer evidence。
- 把 `received-by-reviewer` 当作 receipt acceptance。
- 把 reviewer 已收到材料当作 evidence acceptance。
- 把 `当前候选交付Reviewer交付签收与退回回执模板.md` 当作 Reviewer 输出接收门禁通过。
- 把 `当前候选交付Reviewer审查启动确认模板.md` 当作 reviewer 输出。
- 把 `当前候选交付Reviewer审查中阻塞与澄清问题台账.md` 当作 reviewer 输出或 Reviewer 输出接收门禁通过。
- 代替 reviewer 填写 `reviewer`、`reviewedAt`、`evidenceRef`、`disposition`、`decisionReason` 或 `residualRisk`。
- 不得创建 `data/phase30-human-evidence-submission.json`。
- 不得设置 `releaseReady=true`。
- 不得设置 `phase29ExitReady=true`。
- 不得设置 `phase30EntryReady=true`。
- 不得启用 `runtimeExecution`。
- 不得启用 `thirdPartyExecution`。

## 七、建议检查命令

```powershell
npm.cmd run candidate:reviewer-handoff-execution-check
npm.cmd run candidate:reviewer-handoff-receipt-check
npm.cmd run candidate:reviewer-review-start-confirmation-check
npm.cmd run candidate:reviewer-in-review-blocker-clarification-check
npm.cmd run candidate:final-review-package-lock-check
npm.cmd run candidate:negative-misuse-check
npm.cmd run candidate:review-chain-integrity-check
npm.cmd run candidate:review-execution-sequence-check
npm.cmd run phase30:evidence-closure-status
npm.cmd run check
```

这些命令只证明 reviewer 实际交付执行清单和候选审查链仍然守住红线；不证明 reviewer 已经完成审查，不证明 reviewer 输出已被接收，不证明维护者授权，也不证明 live submission 或 release approval。
