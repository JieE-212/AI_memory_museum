# 阶段30 Live Submission 转换预检包

更新日期：2026-07-05

Baseline: `2.0.17 / phase30-live-submission-conversion-preflight`

Phase 30 live submission conversion preflight: active

本预检包用于判断会后证据汇总是否具备转换为 `data/phase30-human-evidence-submission.json` 的最低条件。它只是 preflight-only package，不是 live submission，不读取或生成真实 reviewer 结论，不批准 release，不退出 Phase 29，不进入 Phase 30 implementation，也不启用 runtime execution 或 third-party execution。

## 1. 当前状态

- `preflightOnly=true`
- `preflightStatus=ready-for-conversion-readiness-check`
- `liveSubmission=data/phase30-human-evidence-submission.json`
- `liveSubmissionStatus=not-created`
- `conversionStatus=blocked-until-human-evidence-and-maintainer-approval`
- `conversionOutput=not-created`
- `pendingSlots=10`
- `approvedSlots=0`
- `noAutomaticApproval=true`
- `releaseReady=false`
- `phase29ExitReady=false`
- `phase30EntryReady=false`
- `runtimeExecution=false`
- `thirdPartyExecution=false`
- `persistedMutations=0`

This package is not live submission.

## 2. 预检输入

转换预检只能读取和确认以下材料是否齐备：

- `阶段30会后证据汇总包.md`
- `阶段30人工证据冲突审查包.md`
- `阶段30人工证据提交门禁.md`
- `阶段30人工证据提交样例.json`
- `阶段30人工Reviewer交接包.md`
- `阶段30人工审查会议包.md`
- 外部真实 reviewer 证据引用清单

如果没有外部真实 reviewer 证据引用清单，预检结论必须保持 `conversion-blocked`。

## 3. 转换准入条件

只有同时满足以下条件，维护者才可以继续讨论创建 live submission：

1. 10 个 evidence slots 全部具备真实 `reviewer`、`reviewedAt`、`evidenceRef`、`disposition`、`decisionReason` 和 `residualRisk`。
2. 所有 `accepted-with-risk`、`deferred-with-owner` 或 `blocked` 槽位都具备 `followUpOwner`、`recoveryCondition` 和 `targetReviewDate`。
3. 没有 `REPLACE_WITH_...`、`YYYY-MM-DD`、`pending`、`missing`、`unassigned` 或空字符串进入待转换材料。
4. 维护者明确确认 `maintainerConversionApproval=granted`。
5. 转换后仍运行 `phase30:evidence-submission-gate`，且格式通过仍不代表 release approval。
6. 转换前必须运行 `phase30:human-evidence-conflict-review`，确认没有 unresolved conflict。

## 4. 槽位预检表

| evidenceId | owner | required fields ready? | placeholders removed? | conversion readiness |
| --- | --- | --- | --- | --- |
| `release-blocker-disposition` | release owner | pending | pending | blocked |
| `transition-redline-disposition` | release owner | pending | pending | blocked |
| `signoff-evidence-reconciliation` | release owner | pending | pending | blocked |
| `release-runtime-separation` | release owner | pending | pending | blocked |
| `runtime-owner-go-no-go` | runtime owner | pending | pending | blocked |
| `rollback-strategy-review` | runtime owner | pending | pending | blocked |
| `sandbox-acceptance-review` | security reviewer | pending | pending | blocked |
| `secret-boundary-review` | security reviewer | pending | pending | blocked |
| `private-memory-boundary-review` | data steward | pending | pending | blocked |
| `audit-dry-run-review` | audit reviewer | pending | pending | blocked |

## 5. 预检结论

当前结论：`conversion-blocked`

阻断原因：

- 当前没有 live human evidence submission 文件。
- 当前没有外部真实 reviewer 证据引用清单。
- 当前 10 个 evidence slots 仍保持 `pending`。
- 当前没有 `maintainerConversionApproval=granted`。
- 当前没有人工冲突解决记录。

允许的预检结论只有：

- `conversion-blocked`
- `conversion-ready-for-maintainer-action`
- `conversion-invalid`

预检结论即使变成 `conversion-ready-for-maintainer-action`，也只表示维护者可以创建 live submission 文件，不表示 release approval。

## 6. 禁止事项

- 不自动创建 `data/phase30-human-evidence-submission.json`。
- 不把 `conversion-ready-for-maintainer-action` 当作 release approval。
- 不把格式预检通过当作 Phase 29 exit 或 Phase 30 entry。
- 不伪造 reviewer、reviewedAt、evidenceRef、disposition、decisionReason 或 residualRisk。
- 不设置 `releaseReady=true`。
- 不设置 `phase29ExitReady=true`。
- 不设置 `phase30EntryReady=true`。
- 不启用 `runtimeExecution`。
- 不启用 `thirdPartyExecution`。

## 7. 完成判定

本预检包完成时，只表示项目已经具备 live submission 转换前的只读预检流程。它不代表 live submission 已经创建，也不代表任何 evidence slot 已经通过人工审查。
