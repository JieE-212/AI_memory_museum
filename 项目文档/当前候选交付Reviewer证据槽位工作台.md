# 当前候选交付 Reviewer 证据槽位工作台

状态：`reviewer-workbench-only`

本工作台用于把 10 个 Phase 30 human evidence slots 分配给 reviewer 角色，帮助人工审查时逐槽位填写真实证据。它不是 reviewer 输出，不是 live submission，不是 release approval，不是 Phase 29 exit，不是 Phase 30 entry，也不启用 runtime execution 或 third-party execution。

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

## 二、Reviewer 工作台矩阵

| reviewer role | evidence slot | 当前状态 | 主要审查输入 | 必填输出 | 默认阻断 |
| --- | --- | --- | --- | --- | --- |
| release owner | `release-blocker-disposition` | missing | release blocker dossier、transition redline、候选交付变更索引 | reviewer / reviewedAt / evidenceRef / disposition / decisionReason / residualRisk | release、Phase 29 exit、Phase 30 entry |
| release owner | `transition-redline-disposition` | missing | transition redline、entry readiness redline、handoff index | reviewer / reviewedAt / evidenceRef / disposition / decisionReason / residualRisk | release、Phase 29 exit、Phase 30 entry |
| release owner | `signoff-evidence-reconciliation` | missing | signoff reconciliation、final signoff review、closure review | reviewer / reviewedAt / evidenceRef / disposition / decisionReason / residualRisk | release、Phase 29 exit、Phase 30 entry |
| release owner | `release-runtime-separation` | missing | release approval packet、runtime go/no-go packet、third-party boundary | reviewer / reviewedAt / evidenceRef / disposition / decisionReason / residualRisk | release、runtime、third-party execution |
| runtime owner | `runtime-owner-go-no-go` | missing | runtime go/no-go board、runtime decision packet、sandbox acceptance harness | reviewer / reviewedAt / evidenceRef / disposition / decisionReason / residualRisk | runtime、release |
| runtime owner | `rollback-strategy-review` | missing | audit dry-run、rollback hints、runtime validation notes | reviewer / reviewedAt / evidenceRef / disposition / decisionReason / residualRisk | runtime、release |
| security reviewer | `sandbox-acceptance-review` | missing | sandbox acceptance harness、permission boundary、quarantine model | reviewer / reviewedAt / evidenceRef / disposition / decisionReason / residualRisk | runtime、third-party execution、release |
| security reviewer | `secret-boundary-review` | missing | secret boundary plan、private memory boundary、redacted export notes | reviewer / reviewedAt / evidenceRef / disposition / decisionReason / residualRisk | runtime、third-party execution、release |
| data steward | `private-memory-boundary-review` | missing | SQLite private memory boundary、redacted export、数据主权说明 | reviewer / reviewedAt / evidenceRef / disposition / decisionReason / residualRisk | release、Phase 30 entry、runtime |
| audit reviewer | `audit-dry-run-review` | missing | audit persistence dry-run、closure status audit、command output | reviewer / reviewedAt / evidenceRef / disposition / decisionReason / residualRisk | release、Phase 30 entry、runtime |

## 三、必填字段

每个 evidence slot 必须由真实 reviewer 提供：

- `reviewer`
- `reviewedAt`
- `evidenceRef`
- `disposition`
- `decisionReason`
- `residualRisk`

`reviewedAt` 必须是日期格式，例如 `2026-07-07`。`evidenceRef` 必须指向真实外部审查记录、会议纪要、测试报告、工单或签核单，不能使用模板占位符。

## 四、Disposition 规则

允许的 disposition：

- `approved-with-evidence`
- `accepted-with-risk`
- `deferred-with-owner`
- `rejected`
- `blocked`

以下 disposition 需要额外 follow-up 字段：

- `accepted-with-risk`
- `deferred-with-owner`
- `blocked`

额外字段：

- `followUpOwner`
- `recoveryCondition`
- `targetReviewDate`

`rejected` 和 `blocked` 均保持阻断。`deferred-with-owner` 也保持阻断，直到后续审查重新给出可接受结论。

## 五、Reviewer 输入材料

Reviewer 不应只看本工作台，应至少结合以下材料：

- `项目文档/当前候选交付审查前包索引.md`
- `项目文档/当前候选交付变更索引.md`
- `项目文档/当前候选交付验收说明.md`
- `项目文档/阶段30人工Reviewer交接包.md`
- `项目文档/阶段30人工复核证据包.md`
- `项目文档/阶段30人工证据闭环状态审计.md`
- `项目文档/阶段30人工审查会议包.md`
- `项目文档/阶段30会后证据汇总包.md`
- `项目文档/阶段30LiveSubmission转换预检包.md`

## 六、工作台使用顺序

1. reviewer 按角色领取对应 evidence slots。
2. reviewer 阅读对应输入材料和本地演示路径。
3. reviewer 在线下记录真实审查结果。
4. 维护者先按 `项目文档/当前候选交付Reviewer输出接收门禁.md` 检查 reviewer 输出是否可以接收。
5. 维护者汇总 reviewer 输出，但不得自动创建 live submission。
6. 维护者先运行 `npm.cmd run phase30:post-review-evidence-summary`。
7. 若存在冲突或风险后续项，先运行冲突审查和风险后续流程。
8. 只有真实 reviewer 输出齐备且维护者显式授权后，才可进入 live submission conversion preflight。

## 七、禁止事项

不得：

- 用本工作台替代 reviewer 签核。
- 自动填写 reviewer、reviewedAt、evidenceRef、disposition、decisionReason 或 residualRisk。
- 把模板 JSON 当成 live submission。
- 把 `npm.cmd run check` 通过解释为 approval。
- 不得创建 `data/phase30-human-evidence-submission.json`，除非已有真实 reviewer 输出和维护者显式转换授权。
- 不得设置 `releaseReady=true`。
- 不得设置 `phase29ExitReady=true`。
- 不得设置 `phase30EntryReady=true`。
- 不得启用 `runtimeExecution`。
- 不得启用 `thirdPartyExecution`。

## 八、建议检查命令

```powershell
npm.cmd run candidate:reviewer-workbench-check
npm.cmd run candidate:reviewer-output-receipt-check
npm.cmd run candidate:pre-review-package-check
npm.cmd run phase30:evidence-closure-status
npm.cmd run check
```

这些命令只证明工作台索引、审查前包和候选检查链仍然守住红线；不证明任何 evidence slot 已经通过人工审查。
