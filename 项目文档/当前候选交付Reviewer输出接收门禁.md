# 当前候选交付 Reviewer 输出接收门禁

状态：`reviewer-output-receipt-gate-only`

本门禁用于在维护者接收真实 reviewer 输出之前，先判断材料是否有资格进入会后汇总和 live submission conversion preflight。它不是 reviewer 输出，不是 live submission，不是 release approval，不是 Phase 29 exit，不是 Phase 30 entry，也不启用 runtime execution 或 third-party execution。

本门禁必须按 `当前候选交付人工审查执行顺序总表.md` 执行，不得跳过工作台、会议记录或收件前检查。本门禁的上游包括 `当前候选交付Reviewer审查启动确认模板.md`、`当前候选交付Reviewer审查中阻塞与澄清问题台账.md`、`当前候选交付Reviewer输出退回与补交闭环记录.md`、`当前候选交付Reviewer输出接收尝试记录.md`、`当前候选交付Reviewer输出字段缺口定位矩阵.md`、`当前候选交付Reviewer输出字段修复责任分派单.md`、`当前候选交付Reviewer输出字段修复回执与重试准备记录.md`、`当前候选交付Reviewer输出重试批次登记表.md`、`当前候选交付Reviewer输出重试批次与接收尝试对账记录.md`、`当前候选交付Reviewer输出对账失败回流处置单.md`、`当前候选交付Reviewer输出对账失败回流结果复核记录.md` 和 `当前候选交付Reviewer输出对账失败回流结果再对账准备记录.md`；审查中阻塞、澄清、退回、补交、接收尝试、字段缺口定位、修复责任分派、修复回执与重试准备、重试批次、批次尝试对账、对账失败回流处置、对账失败结果复核或再对账准备未记录时，不得把 reviewer 输出标记为可接收。

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

## 二、接收前最低条件

维护者只有在以下条件全部满足时，才可以把 reviewer 输出纳入会后汇总：

- 10 个 evidence slots 均有真实 reviewer 输出。
- 每个 slot 均包含 `reviewer`、`reviewedAt`、`evidenceRef`、`disposition`、`decisionReason` 和 `residualRisk`。
- `reviewedAt` 使用真实日期，例如 `2026-07-07`。
- `evidenceRef` 指向真实外部审查记录、会议纪要、测试报告、工单或签核单。
- `disposition` 只允许 `approved-with-evidence`、`accepted-with-risk`、`deferred-with-owner`、`rejected` 或 `blocked`。
- `accepted-with-risk`、`deferred-with-owner` 和 `blocked` 必须补齐 `followUpOwner`、`recoveryCondition` 和 `targetReviewDate`。
- reviewer 输出必须能追溯到 `当前候选交付Reviewer证据槽位工作台.md` 中的 reviewer role 和 evidence slot。
- 维护者确认材料不是模板、会议空表、dry-run 输出或自动生成占位内容。

必须覆盖的 evidence slots：

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

## 三、拒收条件

出现以下任一情况时，不得进入会后汇总，也不得进入 live submission conversion preflight：

- 任一 evidence slot 缺失。
- 任一必填字段为空或仍是 `REPLACE_WITH_...`、`YYYY-MM-DD`、`pending`、`missing`、`unassigned` 等占位符。
- `evidenceRef` 只指向本工作台、模板、README、检查脚本输出或本地 dry-run。
- reviewer 身份无法确认，或 reviewer role 与 evidence slot 不匹配。
- 多个 reviewer 输出对同一 slot 的 `disposition`、`residualRisk` 或 `decisionReason` 存在冲突。
- 风险 disposition 缺少 follow-up 字段或后续责任人。
- 维护者未明确标记 `receiptAcceptedByMaintainer=true`。
- 试图把本门禁、模板 JSON、会议记录草稿或 `npm.cmd run check` 结果当作 approval。
- 试图创建 `data/phase30-human-evidence-submission.json`。

## 四、接收登记字段

维护者接收真实 reviewer 输出时，应先在线下登记以下字段，但本仓库当前不保存真实 reviewer 输出：

- `receiptAcceptedByMaintainer`
- `receivedAt`
- `receivedBy`
- `sourceBundleRef`
- `slotCount`
- `acceptedSlotCount`
- `rejectedSlotCount`
- `conflictCount`
- `riskFollowupCount`
- `readyForPostReviewSummary`

这些字段只用于收件判断，不代表 release approval。若 `receiptAcceptedByMaintainer` 不是 `true`，则必须保持 `readyForPostReviewSummary=false`。

## 五、后续顺序

1. reviewer 按 `当前候选交付Reviewer证据槽位工作台.md` 完成真实输出。
2. 维护者使用本门禁检查输出是否可接收。
3. 若材料被拒收，先按 `当前候选交付Reviewer输出字段缺口定位矩阵.md` 定位缺口，再按 `当前候选交付Reviewer输出字段修复责任分派单.md` 分派修复责任，并按 `当前候选交付Reviewer输出字段修复回执与重试准备记录.md` 记录回执和重试准备；具备再次尝试条件时先登记 `当前候选交付Reviewer输出重试批次登记表.md`，最后退回对应 reviewer 补齐，并记录到 `当前候选交付Reviewer输出退回与补交闭环记录.md`。
4. 若存在冲突，先进入 `阶段30人工证据冲突审查包.md`。
5. 若存在 accepted-with-risk、deferred-with-owner 或 blocked，先登记 `阶段30风险处置后续台账.md`。
6. 只有收件通过后，才可按 `当前候选交付Reviewer输出离线汇总模板索引.md` 整理离线汇总字段。
7. 离线汇总字段完整后，才可运行 `npm.cmd run phase30:post-review-evidence-summary`。
8. 之后仍需运行 `npm.cmd run phase30:live-submission-conversion-preflight`。
9. 只有真实 reviewer 输出齐备且维护者显式转换授权后，才可讨论创建 live submission。

## 六、建议检查命令

```powershell
npm.cmd run candidate:reviewer-output-receipt-check
npm.cmd run candidate:reviewer-output-retry-batch-register-check
npm.cmd run candidate:reviewer-output-retry-batch-attempt-reconciliation-check
npm.cmd run candidate:reviewer-output-reconciliation-failure-disposition-check
npm.cmd run candidate:reviewer-output-reconciliation-failure-disposition-outcome-check
npm.cmd run candidate:reviewer-output-reconciliation-rerun-readiness-check
npm.cmd run candidate:reviewer-output-reconciliation-rerun-execution-check
npm.cmd run candidate:reviewer-output-reconciliation-rerun-result-intake-check
npm.cmd run candidate:reviewer-output-reconciliation-rerun-result-review-check
npm.cmd run candidate:reviewer-output-field-gap-matrix-check
npm.cmd run candidate:reviewer-output-field-fix-assignment-check
npm.cmd run candidate:reviewer-output-field-fix-receipt-retry-readiness-check
npm.cmd run candidate:reviewer-output-return-resubmission-closure-check
npm.cmd run candidate:reviewer-output-receipt-attempt-log-check
npm.cmd run candidate:reviewer-output-summary-template-check
npm.cmd run candidate:review-execution-sequence-check
npm.cmd run candidate:reviewer-workbench-check
npm.cmd run candidate:pre-review-package-check
npm.cmd run phase30:evidence-closure-status
npm.cmd run check
```

## 第35项再对账执行链接

- 再对账执行：`当前候选交付Reviewer输出再对账执行记录.md`
- 再对账结果接收：`当前候选交付Reviewer输出再对账结果接收记录.md`
- 再对账结果复核：`当前候选交付Reviewer输出再对账结果复核记录.md`
- 门禁引用重查如来自再对账准备，必须在该执行记录中保留 `targetReceiptGateRef` 和 `receipt-gate-ref-recheck` 路线。
- 再对账执行登记不得被解释为 Reviewer 输出接收门禁通过。

这些命令只证明收件门禁、工作台索引、审查前包和候选检查链仍然守住红线；不证明任何 reviewer 输出已经被接收，也不证明任何 evidence slot 已经通过人工审查。
