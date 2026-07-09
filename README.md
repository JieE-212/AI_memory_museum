# AI 记忆博物馆 - 项目工程
Current version calibration: Phase 29 forty-ninth edition, 1.9.48 / phase29-release-exit-final-archive-manifest-preview. Adds a read-only release exit final archive manifest preview over the final archive integrity check, final archive index, signoff evidence reconciliation, final signoff review, governance freeze, release exit readiness dossier, final readonly exit package, blocker dossier, transition redline, entry preflight, and runtime guardrails while carried blockers, redlines, releaseReady=false, phase29ExitReady=false, phase30EntryReady=false, runtimeExecution=false, thirdPartyExecution=false, manifest persistence, integrity check persistence, archive index persistence, evidence reconciliation persistence, final signoff persistence, governance freeze persistence, release exit dossier persistence, final exit package persistence, blocker clearance, redline resolution, release approval, Phase 29 exit, Phase 30 entry, runtime enablement, third-party execution, manifest recording, integrity recording, archive recording, evidence override, and persisted runtime mutation remain disabled.

Phase 29 transition freeze: active. The current stage is now frozen for closure planning: no new Phase 29 preview artifacts should be added, and Phase 30 work is limited to planning until blocker clearance, redline resolution, release approval, Phase 29 exit, Phase 30 entry, runtime enablement, and third-party execution are explicitly approved. See `../项目文档/阶段29收口与阶段30规划.md`.

Phase 30 planning baseline: active. This is planning-only work for controlled runtime enablement readiness; `PHASE`, `APP_VERSION`, runtime execution, third-party execution, release approval, and Phase 30 entry remain unchanged. See `../项目文档/阶段30规划基线.md`.

Phase 30 entry baseline: active as a read-only `2.0.0 / phase30-entry-baseline` model. It organizes Phase 29 frozen inputs, Phase 30 scope lock, entry gates, risks, manual signoff placeholders, and the next sandbox acceptance criteria while Phase 30 entry remains inactive. See `../项目文档/阶段30入口基线.md`.

Phase 30 runtime sandbox acceptance harness: active as a read-only `2.0.1 / phase30-runtime-sandbox-acceptance-harness` model. It defines fixture scenarios, isolation boundaries, dry-run evidence, quarantine-only output, and acceptance criteria while real plugin execution and runtime sandbox execution remain inactive. See `../项目文档/阶段30运行时沙箱验收框架.md`.

Phase 30 secret boundary plan: active as a read-only `2.0.2 / phase30-secret-boundary-plan` model. It defines plugin secret, app secret, SQLite private memory, redacted export, audit metadata, and runtime state boundaries while secret access and private memory access remain blocked. See `../项目文档/阶段30密钥边界计划.md`.

Phase 30 audit persistence dry-run: active as a read-only `2.0.3 / phase30-audit-persistence-dry-run` model. It defines audit event schema, dry-run ledger, correlation rules, export summary, and rollback hints while runtime state persistence remains disabled. See `../项目文档/阶段30审计持久化演练.md`.

Phase 30 runtime go/no-go board: active as a read-only `2.0.4 / phase30-runtime-go-no-go-board` model. It summarizes blocked, hold, pass-dry-run, manual-review-required, and runtimeMutationCount signals with a default `no-go-blocked` decision while runtime approval remains blocked. See `../项目文档/阶段30运行时GoNoGo看板.md`.

Phase 30 first-round planning closure: active as a read-only `2.0.5 / phase30-first-round-planning-closure` handoff package. It closes the first Phase 30 planning loop for human review only, keeps the default `no-go-blocked` result, and does not approve release, Phase 30 entry, runtime execution, or third-party execution. See `../项目文档/阶段30第一轮规划收口.md`.

Phase 30 human review evidence pack: active as a read-only `2.0.6 / phase30-human-review-evidence-pack` handoff model. It defines evidence slots, owners, allowed dispositions, and blocking rules for human review while Human evidence remains pending and no human signoff, release approval, Phase 30 entry, runtime execution, or third-party execution is granted. See `../项目文档/阶段30人工复核证据包.md`.

Phase 30 human review execution ledger: active as a read-only `phase30.human-review-execution-ledger.v1` operational ledger. It exposes the 10 required evidence slots through `/api/version`, `/api/operations`, and `/api/operations/export`; all slots remain `pending`, `evidenceRef=missing`, and blocking for release, Phase 29 exit, Phase 30 entry, runtime execution, and third-party execution.

Phase 30 closure review package: active as a read-only `2.0.7 / phase30-closure-review-package` review package. It turns the current work into a closure-review posture for git path shape, RC boundary, human evidence execution, and guardrail verification; it is not release approval and is 不是 release approval.

Phase 30 release candidate brief: active as `2.0.8 / phase30-release-candidate-brief`. It marks the project as `rc-reviewable-but-not-releasable` until git path shape and all human evidence slots are confirmed.

Phase 30 human review evidence worksheet: active as `2.0.8 / phase30-human-review-evidence-worksheet`. It is an offline filling template and is not human signoff.

Phase 30 RC freeze checklist: active as `2.0.9 / phase30-rc-freeze-checklist`. It freezes the current candidate review input as `rc-reviewable-but-not-releasable`; it is not release approval.

Phase 30 human evidence intake plan: active as `2.0.10 / phase30-human-evidence-intake-plan`. It defines the required reviewer fields and collection order while all evidence slots remain `pending`.

Phase 30 human evidence intake register: active as `2.0.11 / phase30-human-evidence-intake-register`. It turns the intake plan into a pending register with `pendingSlots=10`, `approvedSlots=0`, and no automatic approval.

Phase 30 human evidence submission gate: active as `2.0.12 / phase30-human-evidence-submission-gate`. It validates a future `data/phase30-human-evidence-submission.json` only for format and guardrails; no live submission exists by default and it is not release approval.

Phase 30 human evidence submission template: active as `2.0.13 / phase30-human-evidence-submission-template`. It provides an offline JSON example in `项目文档/阶段30人工证据提交样例.json`; it is template-only and not a live human submission.

Phase 30 human reviewer handoff package: active as `2.0.14 / phase30-human-reviewer-handoff-package`. It splits the 10 evidence slots by reviewer role for human assignment; it is handoff-only and not a live submission.

Phase 30 human review session package: active as `2.0.15 / phase30-human-review-session-package`. It turns reviewer handoff into a meeting agenda and minutes template; it is meeting-only and not a live submission.

Phase 30 post review evidence summary package: active as `2.0.16 / phase30-post-review-evidence-summary-package`. It defines the post-meeting evidence summary flow before any live submission may be created; it is summary-only and not a live submission.

Phase 30 live submission conversion preflight: active as `2.0.17 / phase30-live-submission-conversion-preflight`. It checks whether post-review evidence is ready for explicit maintainer conversion; it is preflight-only and not a live submission.

Phase 30 human evidence conflict review: active as `2.0.18 / phase30-human-evidence-conflict-review`. It defines conflict taxonomy and human resolution requirements before live submission conversion; it is conflict-review-only and not a live submission.

Phase 30 risk disposition followup ledger: active as `2.0.19 / phase30-risk-disposition-followup-ledger`. It tracks accepted-with-risk, deferred-with-owner, and blocked followups before live submission conversion; it is followup-ledger-only and not a live submission.

Phase 30 release decision readiness envelope: active as `2.0.20 / phase30-release-decision-readiness-envelope`. It summarizes the evidence governance chain for release owner review; it is readiness-envelope-only and not release approval.

Phase 30 entry readiness redline: active as `2.0.21 / phase30-entry-readiness-redline`. It separates release approval, Phase 29 exit, Phase 30 entry, runtime go/no-go, and third-party execution into independent gates; it is entry-readiness-redline-only and does not approve or cascade any gate.

Phase 30 release approval decision packet: active as `2.0.22 / phase30-release-approval-decision-packet`. It defines the release owner decision record for future independent release approval; it is release-approval-decision-packet-only and not release approval.

Phase 29 exit decision packet: active as `2.0.23 / phase29-exit-decision-packet`. It defines the independent Phase 29 exit owner decision record; it is phase29-exit-decision-packet-only and not Phase 29 exit.

Phase 30 entry decision packet: active as `2.0.24 / phase30-entry-decision-packet`. It defines the independent Phase 30 entry owner decision record; it is phase30-entry-decision-packet-only and not Phase 30 entry.

Phase 30 runtime go/no-go decision packet: active as `2.0.25 / phase30-runtime-go-no-go-decision-packet`. It defines the independent runtime owner Go/No-Go decision record; it is runtime-go-no-go-decision-packet-only and not runtime execution approval.

Phase 30 third-party execution approval boundary: active as `2.0.26 / phase30-third-party-execution-approval-boundary`. It defines the per-plugin third-party execution approval boundary; it is third-party-execution-approval-boundary-only and not third-party execution approval.

Phase 30 candidate post-commit review handoff: active as `2.0.27 / phase30-candidate-post-commit-review-handoff`. It records commit `435b1d8` as the staged Phase 30 candidate review package and adds a post-commit diff review handoff; it is post-commit-review-handoff-only, not reviewer evidence, not live submission, and not release approval.

Previous Phase 29 closure handoff baseline: 1.9.7 / phase29-closure-handoff-package remains preserved as the read-only closure handoff package baseline.

Previous Phase 29 closure readiness baseline: 1.9.6 / phase29-governance-closure-readiness remains preserved as the read-only governance closure readiness baseline.

Previous Phase 29 decision audit baseline: 1.9.5 / phase29-decision-history-audit-chain remains preserved as the read-only decision history audit chain baseline.

Previous Phase 29 dashboard export baseline: 1.9.4 / phase29-governance-dashboard-export remains preserved as the read-only governance dashboard export baseline.

Previous Phase 29 runtime governance baseline: 1.9.3 / phase29-runtime-enable-governance-planning remains preserved as the read-only runtime enable governance planning baseline.

Previous Phase 29 release approval baseline: 1.9.2 / phase29-release-approval-state-model-planning remains preserved as the read-only release approval state model baseline.

Previous Phase 29 blocker workflow baseline: 1.9.1 / phase29-blocker-clearance-workflow-planning remains preserved as the read-only blocker clearance workflow planning baseline.

Previous Phase 29 entry baseline: 1.9.0 / phase29-release-governance-planning remains preserved as the read-only release governance planning baseline.

Previous Phase 28 closure baseline: 1.8.5 / phase28-closure-package remains preserved as the read-only clearance review closure baseline.

Previous Phase 28 clearance decision preview baseline: 1.8.4 / phase28-clearance-decision-preview remains preserved as the read-only clearance decision preview baseline.
Previous Phase 28 clearance criteria checklist baseline: 1.8.3 / phase28-clearance-criteria-checklist remains preserved as the read-only clearance criteria checklist baseline.
Previous Phase 28 reviewer disposition baseline: 1.8.2 / phase28-reviewer-disposition-model remains preserved as the read-only reviewer disposition model baseline.
Previous Phase 28 evidence intake ledger baseline: 1.8.1 / phase28-evidence-intake-ledger remains preserved as the read-only evidence intake ledger baseline.
Previous Phase 28 clearance review entry baseline: 1.8.0 / phase28-clearance-review-entry remains preserved as the read-only clearance review entry baseline.
Previous Phase 27 closure baseline: 1.7.5 / phase27-closure-package remains preserved as the read-only release blocker governance closure baseline.
Previous Phase 27 blocker resolution plan baseline: 1.7.4 / phase27-blocker-resolution-plan remains preserved as the read-only blocker resolution plan baseline.
Previous Phase 27 evidence gap matrix baseline: 1.7.3 / phase27-evidence-gap-matrix remains preserved as the read-only evidence gap matrix baseline.
Previous Phase 27 human review signoff baseline: 1.7.2 / phase27-human-review-signoff remains preserved as the read-only human review signoff baseline.
Previous Phase 27 carried blocker inventory baseline: 1.7.1 / phase27-carried-blocker-inventory remains preserved as the read-only carried blocker inventory baseline.
Previous Phase 27 entry package baseline: 1.7.0 / phase27-entry-package remains preserved as the read-only release blocker governance entry baseline.
Previous Phase 26 closure baseline: 1.6.5 / phase26-closure-package remains preserved as the read-only runtime validation and release gate simulation closure baseline.
Previous Phase 26 handoff criteria baseline: 1.6.4 / phase26-handoff-criteria remains preserved as the read-only next-stage handoff criteria baseline.
Previous Phase 26 runtime validation report baseline: 1.6.3 / phase26-runtime-validation-report remains preserved as the read-only runtime validation report baseline.
Previous Phase 26 blocker clearance simulation baseline: 1.6.2 / phase26-blocker-clearance-simulation remains preserved as the read-only blocker clearance simulation baseline.
Previous Phase 26 release gate simulation baseline: 1.6.1 / phase26-release-gate-simulation remains preserved as the read-only release gate simulation baseline.
Previous Phase 26 validation entry baseline: 1.6.0 / phase26-validation-entry remains preserved as the runtime validation entry baseline.
Previous Phase 25 package validation baseline: 1.5.6 / phase25-review-package-validation remains preserved as the read-only review package validation baseline.
Previous Phase 25 review export baseline: 1.5.5 / phase25-review-export-package remains preserved as the read-only review export package baseline.
Current Phase 27 entry baseline: Phase 27 / release-blocker-governance is now entered as a governance-only stage after Phase 26. It turns the Phase 26 closure package and carried blockers into read-only governance inventory without clearing blockers or enabling release/runtime.
Phase 27 planned version path: 1.7.0 phase27-entry-package, 1.7.1 phase27-carried-blocker-inventory, 1.7.2 phase27-human-review-signoff, 1.7.3 phase27-evidence-gap-matrix, 1.7.4 phase27-blocker-resolution-plan, 1.7.5 phase27-closure-package.
Phase 27 guardrails: runtimeExecution=false, thirdPartyExecution=false, releaseReady=false, no plugin code execution, no release blocker auto-clear, no release mutation, no runtime execution, no persisted runtime mutation.
Current Phase 28 entry baseline: Phase 28 / release-clearance-review starts from the Phase 27 closure package and turns carried open blockers into a read-only clearance review queue without clearing blockers or enabling release/runtime.
Phase 28 planned version path: 1.8.0 phase28-clearance-review-entry, 1.8.1 phase28-evidence-intake-ledger, 1.8.2 phase28-reviewer-disposition-model, 1.8.3 phase28-clearance-criteria-checklist, 1.8.4 phase28-clearance-decision-preview, 1.8.5 phase28-closure-package.
Phase 28 guardrails: runtimeExecution=false, thirdPartyExecution=false, releaseReady=false, no blocker auto-clear, no review-as-clearance mutation, no evidence-as-clearance mutation, no disposition-as-clearance mutation, no criteria-as-clearance mutation, no preview-as-clearance mutation, no preview-as-release-approval mutation, no closure-as-release-approval mutation, no closure blocker clearance, no release approval, no runtime execution, no persisted runtime mutation.
Previous Phase 25 surface state baseline: 1.5.1 / phase25-surface-state-model remains preserved as the read-only UI state model baseline.
Previous Phase 25 UI surface baseline: 1.5.0 / phase25-runtime-sandbox-ui-surface remains preserved as the read-only runtime sandbox UI surface baseline.
Previous Phase 24 closure baseline: 1.4.6 / phase24-closure-package remains preserved as the runtime sandbox UX model closure baseline.
Previous Phase 24 release clearance preview baseline: 1.4.5 / phase24-release-clearance-preview remains preserved as the read-only clearance preview baseline.
Previous Phase 24 runtime evidence export baseline: 1.4.4 / phase24-runtime-evidence-export-pack remains preserved as the guarded evidence export baseline.
Previous Phase 24 quarantine review queue baseline: 1.4.3 / phase24-quarantine-review-queue remains preserved as the quarantine review baseline.
Previous Phase 24 permission decision review baseline: 1.4.2 / phase24-permission-decision-review-flow remains preserved as the permission review baseline.
Previous Phase 24 runtime preflight baseline: 1.4.1 / phase24-runtime-preflight-workbench remains preserved as the preflight workbench baseline.
Previous Phase 24 entry baseline: 1.4.0 / phase24-runtime-sandbox-ux-entry remains preserved as the phase entry baseline.
Previous Phase 23 closure handoff baseline: 1.3.9 / phase23-closure-handoff-package remains preserved as the phase closure and next-phase entry baseline.
Previous Phase 23 runtime sandbox panel view export baseline: 1.3.8 / phase23-runtime-sandbox-panel-view-export remains preserved as the filtered panel view export baseline.
Previous Phase 23 runtime sandbox read-only panels baseline: 1.3.7 / phase23-runtime-sandbox-readonly-panels remains preserved as the read-only panel baseline.
Previous Phase 23 runtime sandbox UI plan baseline: 1.3.6 / phase23-runtime-sandbox-ui-plan remains preserved as the runtime sandbox UI planning baseline.
Previous Phase 23 next-phase guardrail dashboard baseline: 1.3.5 / phase23-next-phase-guardrail-dashboard remains preserved as the next-phase guardrail dashboard baseline.
Previous Phase 23 review action ledger baseline: 1.3.4 / phase23-review-action-ledger remains preserved as the append-only review action ledger baseline.
Previous Phase 23 blocker detail panels baseline: 1.3.3 / phase23-blocker-detail-panels remains preserved as the blocker detail panel baseline.
Previous Phase 23 decision history export baseline: 1.3.2 / phase23-decision-history-export remains preserved as the release decision history export baseline.
Previous Phase 23 clearance audit search baseline: 1.3.1 / phase23-clearance-audit-search remains preserved as the clearance audit search baseline.
Previous Phase 23 release readiness review UI baseline: 1.3.0 / phase23-release-readiness-review-ui remains preserved as the review UI model baseline.
Previous Phase 22 runtime review closure baseline: 1.2.7 / phase22-runtime-review-closure remains preserved as the phase completion and next-phase entry baseline.
Previous Phase 22 clearance audit trail baseline: 1.2.6 / phase22-clearance-audit-trail remains preserved as the append-only clearance audit trail baseline.
Previous Phase 22 release readiness decision baseline: 1.2.5 / phase22-release-readiness-decision remains preserved as the derived release readiness decision baseline.
Previous Phase 22 blocker clearance baseline: 1.2.4 / phase22-blocker-clearance-plan remains preserved as the human-owned blocker clearance plan baseline.
Previous Phase 22 blocker rules baseline: 1.2.3 / phase22-release-blocker-rules remains preserved as the explainable release blocker rules baseline.
Previous Phase 22 signoff ledger baseline: 1.2.2 / phase22-review-signoff-ledger remains preserved as the reviewer signoff ledger baseline.
Previous Phase 22 review workbench baseline: 1.2.1 / phase22-runtime-review-workbench remains preserved as the runtime review workbench baseline.
Previous Phase 22 evidence review baseline: 1.2.0 / phase22-runtime-evidence-review remains preserved as the runtime evidence review baseline.
Previous Phase 21 result quarantine baseline: 1.1.5 / phase21-runtime-result-quarantine remains preserved as the runtime result quarantine baseline.
Previous Phase 21 importer fixture baseline: 1.1.4 / phase21-importer-runtime-fixtures remains preserved as the importer runtime fixtures baseline.
Previous Phase 21 output validation baseline: 1.1.3 / phase21-output-validation-gate remains preserved as the output validation gate baseline.
Previous Phase 21 audit replay baseline: 1.1.2 / phase21-runtime-audit-replay remains preserved as the runtime audit replay baseline.
Previous Phase 21 permission baseline: 1.1.1 / phase21-permission-runtime-enforcement remains preserved as the permission runtime enforcement baseline.
Previous Phase 21 baseline: 1.1.0 / phase21-runtime-sandbox-foundation remains preserved as the runtime sandbox foundation baseline.
Previous release gate baseline: Phase 20 twenty-sixth edition, 1.0.25 / phase20-release-checklist-gate remains preserved as the plugin release checklist gate baseline.

## 当前状态

当前校准版本为 Phase 29 forty-ninth edition，`1.9.48 / phase29-release-exit-final-archive-manifest-preview`。Phase 29 已冻结，Phase 30 只允许规划和人工复核证据整理，不允许释放审批、Phase 30 入口、运行时执行或第三方插件执行。

Phase 30 human review execution ledger 已通过 `/api/version`、`/api/operations` 和 `/api/operations/export` 暴露。10 个证据槽位全部保持 `pending`、`evidenceRef=missing`，并继续阻断 release、Phase 29 exit、Phase 30 entry、runtime execution 和 third-party execution。

Phase 30 closure review package: active。当前进入收口审查姿态，重点确认 git 目录形态、RC 边界、人工证据执行清单和保护线；这不是 release approval，也不允许打开运行时或第三方插件执行。

Phase 30 release candidate brief: active。当前候选交付结论是 `rc-reviewable-but-not-releasable`，可交给人工审查，但不能作为正式 release。

Current candidate delivery acceptance guide: active。当前已新增一页式本地验收说明，覆盖启动、SQLite 示例/真实数据边界、首页维护者总览、检查命令和禁止事项；它只是验收说明，不是 release approval，也不是 live submission。见 `项目文档/当前候选交付验收说明.md`。

Current candidate delivery change index: active。当前已新增候选交付变更索引，汇总人工证据闭环、SQLite 初始化、首页维护者红线、候选总览、普通用户路径、导入路径和候选检查脚本；它只是交接索引，不是 release approval，也不是 live submission。见 `项目文档/当前候选交付变更索引.md`。

Current candidate pre-review package index: active。当前已新增审查前包索引，面向 reviewer 整理阅读顺序、演示路径、证据槽位缺口、必跑命令和禁止转换条件；它只是 pre-review package，不是 reviewer 结论，不是 release approval，也不是 live submission。见 `项目文档/当前候选交付审查前包索引.md`。

Current candidate reviewer evidence workbench: active。当前已新增 Reviewer 证据槽位工作台，按 reviewer role 映射 10 个 evidence slots、必填字段、disposition 规则、follow-up 字段和禁止事项；它只是 reviewer workbench，不是 reviewer 输出，不是 release approval，也不是 live submission。见 `项目文档/当前候选交付Reviewer证据槽位工作台.md`。

Current candidate reviewer output receipt gate: active。当前已新增 Reviewer 输出接收门禁，用于在维护者接收真实 reviewer 输出前检查缺槽、占位符、字段、冲突、风险 follow-up 和维护者接收标记；它只是 receipt-gate，不是 reviewer 输出，不是 release approval，也不是 live submission。见 `项目文档/当前候选交付Reviewer输出接收门禁.md`。

Current candidate reviewer output offline summary template index: active。当前已新增 Reviewer 输出离线汇总模板索引，用于在收件门禁通过后整理汇总包头、逐槽位字段、冲突分流和风险 follow-up 分流；它只是 summary-template，不是 reviewer 输出，不是 release approval，也不是 live submission。见 `项目文档/当前候选交付Reviewer输出离线汇总模板索引.md`。

Current candidate human review execution sequence: active。当前已新增人工审查执行顺序总表，用于把审查前包、Reviewer 工作台、输出接收门禁、离线汇总模板、会后汇总、冲突审查、风险台账和转换预检串成不可跳步序列；它只是 sequence-only，不是 reviewer 输出，不是 release approval，也不是 live submission。见 `项目文档/当前候选交付人工审查执行顺序总表.md`。

Current candidate human review chain integrity index: active。当前已新增人工审查链完整性索引，用于检查候选人工审查材料、命令、上游下游、README/审查前包/执行顺序挂载和禁止事项是否断链；它只是 integrity-index，不是 reviewer 输出，不是 release approval，也不是 live submission。见 `项目文档/当前候选交付人工审查链完整性索引.md`。

Current candidate human review dry-run record template: active。当前已新增人工审查演练 Dry-run 记录模板，用于在正式人工审查会议前模拟命令、断点、退回项和误用风险；它只是 dry-run-template，不是 reviewer 输出，不是 receipt acceptance，不是 release approval，也不是 live submission。见 `项目文档/当前候选交付人工审查演练Dry-run记录模板.md`。

Current candidate maintainer conversion authorization precondition template: active。当前已新增维护者转换授权前置模板，用于定义创建 live submission 前必须满足的字段、否决条件和显式授权边界；它只是 authorization-template，不是维护者授权本身，不是 release approval，也不是 live submission。见 `项目文档/当前候选交付维护者转换授权前置模板.md`。

Current candidate negative misuse check: active。当前已新增负向用例防误用检查，用于防止模板、dry-run、会议记录、检查命令、转换预检、准备信封或决策包被误解释为 reviewer evidence、receipt acceptance、维护者授权、live submission、release approval 或任何阶段 gate 通过；它只是 misuse-guard，不是授权或审批。见 `项目文档/当前候选交付负向用例防误用检查.md`。

Current candidate final review package lock index: active。当前已新增人工审查包最终锁定索引，用于在交付 reviewer 前锁定材料范围、必跑命令、证据槽位缺口和禁止误用边界；它只是 final package lock index，不是 reviewer 输出，不是 release approval，也不是 live submission。见 `项目文档/当前候选交付人工审查包最终锁定索引.md`。

Current candidate reviewer handoff execution checklist: active。当前已新增 Reviewer 实际交付执行清单，用于把已锁定的候选审查包交付给 reviewer 时逐项勾选、签收、退回和记录交付状态；它只是 handoff checklist，不是 reviewer 输出，不是 receipt acceptance，不是 release approval，也不是 live submission。见 `项目文档/当前候选交付Reviewer实际交付执行清单.md`。

Current candidate reviewer handoff receipt template: active。当前已新增 Reviewer 交付签收与退回回执模板，用于记录材料包层面的签收、退回、缺失材料、范围不清和补发动作；它只是 handoff receipt template，不是 Reviewer 输出接收门禁通过，不是 reviewer evidence，不是 release approval，也不是 live submission。见 `项目文档/当前候选交付Reviewer交付签收与退回回执模板.md`。

Current candidate reviewer review start confirmation template: active。当前已新增 Reviewer 审查启动确认模板，用于在材料签收后、真实 reviewer 输出前确认 reviewer 已开始审查、理解槽位、红线和输出字段；它只是 start-confirmation，不是 reviewer 输出，不是 Reviewer 输出接收门禁通过，不是 release approval，也不是 live submission。见 `项目文档/当前候选交付Reviewer审查启动确认模板.md`。

Current candidate reviewer in-review blocker clarification ledger: active。当前已新增 Reviewer 审查中阻塞与澄清问题台账，用于在审查启动确认后、Reviewer 输出接收门禁前记录阻塞、澄清、材料补发和恢复条件；它只是 ledger-only，不是 reviewer 输出，不是 Reviewer 输出接收门禁通过，不是 release approval，也不是 live submission。见 `项目文档/当前候选交付Reviewer审查中阻塞与澄清问题台账.md`。

Current candidate reviewer output return resubmission closure record: active。当前已新增 Reviewer 输出退回与补交闭环记录，用于在审查中澄清后或输出接收门禁拒收后记录退回原因、补交责任人、补交包、重新提交和再次收件条件；它只是 closure-record，不是 reviewer 输出，不是 Reviewer 输出接收门禁通过，不是 release approval，也不是 live submission。见 `项目文档/当前候选交付Reviewer输出退回与补交闭环记录.md`。

Current candidate reviewer output receipt attempt log: active。当前已新增 Reviewer 输出接收尝试记录，用于记录每次接收尝试的来源补交包、尝试编号、执行人、门禁结果引用、拒收原因和下一步；它只是 attempt-log，不是 reviewer 输出，不是 Reviewer 输出接收门禁通过，不是 release approval，也不是 live submission。见 `项目文档/当前候选交付Reviewer输出接收尝试记录.md`。

Current candidate reviewer output field gap matrix: active。当前已新增 Reviewer 输出字段缺口定位矩阵，用于在接收尝试失败后把缺口定位到 evidence slot、字段、缺口类型、阻塞等级和修复责任；它只是 field-gap-matrix，不接收 reviewer 输出，不替代接收门禁，不是 release approval，也不是 live submission。见 `项目文档/当前候选交付Reviewer输出字段缺口定位矩阵.md`。

Current candidate reviewer output field fix assignment: active。当前已新增 Reviewer 输出字段修复责任分派单，用于把字段缺口定位结果转成修复 owner、期限、修复路线、退回闭环和重试条件；它只是 field-fix-assignment，不是字段已修复证明，不是 Reviewer 输出接收门禁通过，不是 release approval，也不是 live submission。见 `项目文档/当前候选交付Reviewer输出字段修复责任分派单.md`。

Current candidate reviewer output field fix receipt retry readiness: active。当前已新增 Reviewer 输出字段修复回执与重试准备记录，用于记录字段修复回执、补交包引用、回执完整性、退回闭环与下一次接收尝试准备条件；它只是 receipt-retry-readiness，不是字段已修复证明，不是 Reviewer 输出接收门禁通过，不是 release approval，也不是 live submission。见 `项目文档/当前候选交付Reviewer输出字段修复回执与重试准备记录.md`。

Current candidate reviewer output retry batch register: active。当前已新增 Reviewer 输出重试批次登记表，用于把具备重试条件的字段修复回执归组成 retry batch，记录批次来源、目标 slots、执行命令、回滚路线和下一次接收尝试引用；它只是 retry-batch-register，不是 reviewer 输出，不是字段已修复证明，不是 Reviewer 输出接收门禁通过，不是 release approval，也不是 live submission。见 `项目文档/当前候选交付Reviewer输出重试批次登记表.md`。

Current candidate reviewer output retry batch attempt reconciliation: active。当前已新增 Reviewer 输出重试批次与接收尝试对账记录，用于核对 retry batch、receipt attempt 和 receipt gate reference 的对应关系；它只是 reconciliation，不是 reviewer 输出，不是字段已修复证明，不是 Reviewer 输出接收门禁通过，不是 release approval，也不是 live submission。见 `项目文档/当前候选交付Reviewer输出重试批次与接收尝试对账记录.md`。

Current candidate reviewer output reconciliation failure disposition: active。当前已新增 Reviewer 输出对账失败回流处置单，用于把 unmatched batch、orphan attempt、missing gate ref 和 blocked/returned 对账失败状态回流到对应登记、尝试、门禁、字段缺口、修复分派或退回补交闭环；它只是 failure disposition，不是 reviewer 输出，不是字段已修复证明，不是 Reviewer 输出接收门禁通过，不是 release approval，也不是 live submission。见 `项目文档/当前候选交付Reviewer输出对账失败回流处置单.md`。

Current candidate reviewer output reconciliation failure disposition outcome: active。当前已新增 Reviewer 输出对账失败回流结果复核记录，用于复核回流处置是否已经被 route owner 确认、是否有目标材料修正引用、是否需要重新对账或进入下一次 retry batch；它只是 outcome review，不是 reviewer 输出，不是字段已修复证明，不是 Reviewer 输出接收门禁通过，不是 release approval，也不是 live submission。见 `项目文档/当前候选交付Reviewer输出对账失败回流结果复核记录.md`。

Current candidate reviewer output reconciliation rerun readiness: active。当前已新增 Reviewer 输出对账失败回流结果再对账准备记录，用于把已复核的回流结果整理成重新对账或下一轮 retry batch 前的准备清单；它只是 rerun readiness，不是 reviewer 输出，不是字段已修复证明，不是 Reviewer 输出接收门禁通过，不是 release approval，也不是 live submission。见 `项目文档/当前候选交付Reviewer输出对账失败回流结果再对账准备记录.md`。

Current candidate reviewer output reconciliation rerun execution: active。当前已新增 Reviewer 输出再对账执行记录，用于把第34项准备状态登记为一次结构化再对账执行，记录 source readiness、rerun command、target refs、execution status 和 result route；它只是 rerun execution record，不是 reviewer 输出，不是字段已修复证明，不是 Reviewer 输出接收门禁通过，不是 release approval，也不是 live submission。见 `项目文档/当前候选交付Reviewer输出再对账执行记录.md`。

Current candidate reviewer output reconciliation rerun result intake: active。当前已新增 Reviewer 输出再对账结果接收记录，用于接收第35项执行后的结果入口，登记 result signal、matched/gate/field gap/blocker state 和下一步分流；它只是 rerun result intake，不是 reviewer 输出，不是字段已修复证明，不是 Reviewer 输出接收门禁通过，不是 release approval，也不是 live submission。见 `项目文档/当前候选交付Reviewer输出再对账结果接收记录.md`。

Current candidate reviewer output reconciliation rerun result review: active。当前已新增 Reviewer 输出再对账结果复核记录，用于复核第36项接收的 matched、mismatched、blocked、gate-ref-missing 或 needs-new-retry-batch 信号应进入哪条治理路线；它只是 rerun result review，不是 reviewer 输出，不是字段已修复证明，不是 Reviewer 输出接收门禁通过，不是 release approval，也不是 live submission。见 `项目文档/当前候选交付Reviewer输出再对账结果复核记录.md`。

Phase 30 candidate post-commit review handoff: active。当前已新增提交后审阅包与 Commit Diff 摘要，用于围绕 `435b1d8` 做人工 diff review、命令复跑和后续 reviewer 交接；它只是 post-commit-review-handoff，不是 reviewer 输出，不是 live submission，也不是 release approval。见 `项目文档/阶段30候选交付提交后审阅包.md` 和 `项目文档/阶段30候选交付CommitDiff摘要.md`。

Phase 30 human review evidence worksheet: active。该填写表只用于线下补齐 evidenceRef、reviewer、reviewedAt、decisionReason 和 residualRisk，不代表人工签核已经完成。

Phase 30 RC freeze checklist / human evidence intake plan / human evidence intake register: active。当前已经进入 RC 冻结和人工证据 intake 登记准备，但 10 个 evidence slots 仍是 `pending`，不能自动转为 release approval 或 runtime go。

Phase 30 human evidence submission gate: active。当前已经建立未来真实人工证据 JSON 的格式门禁；默认没有 live submission 文件，门禁通过也不等于 release approval。

Phase 30 human evidence submission template: active。当前已新增离线 JSON 样例，供 reviewer 填写时参考；它不位于 `data/`，不代表真实人工提交。

Phase 30 human reviewer handoff package: active。当前已把 10 个 evidence slots 拆给 release owner、runtime owner、security reviewer、data steward 和 audit reviewer；这只是人工交接，不代表签核完成。

Phase 30 human review session package: active。当前已新增人工审查会议包，用于组织 reviewer 会议议程和逐槽位会议记录；这只是 meeting-only，不代表 live submission。

Phase 30 post review evidence summary package: active。当前已新增会后证据汇总包，用于整理人工审查会议后的 reviewer 输出；这只是 summary-only，不会自动创建 live submission，也不代表 release approval。

Phase 30 live submission conversion preflight: active。当前已新增 live submission 转换预检包，用于检查会后汇总是否具备维护者显式转换条件；这只是 preflight-only，不会创建 live submission，也不代表 release approval。

Phase 30 human evidence conflict review: active。当前已新增人工证据冲突审查包，用于定义冲突类型和人工解决要求；这只是 conflict-review-only，不会创建 live submission，也不代表 release approval。

Phase 30 risk disposition followup ledger: active。当前已新增风险处置后续台账，用于跟踪 accepted-with-risk、deferred-with-owner 和 blocked 的后续动作；这只是 followup-ledger-only，不会创建 live submission，也不代表 release approval。

Phase 30 release decision readiness envelope: active。当前已新增发布决策准备信封，用于把证据治理链汇总给 release owner 审阅；这只是 readiness-envelope-only，不代表 release approval。

Phase 30 entry readiness redline: active。当前已新增入口准备红线，用于把 release approval、Phase 29 exit、Phase 30 entry、runtime go/no-go 和 third-party execution 拆成独立 gate；这只是 entry-readiness-redline-only，不代表任何 gate 已经通过。

Phase 30 release approval decision packet: active。当前已新增发布审批决策包，用于定义 release owner 后续独立发布审批记录；这只是 release-approval-decision-packet-only，不代表 release approval。

Phase 29 exit decision packet: active。当前已新增阶段29退出决策包，用于定义 Phase 29 exit owner 后续独立退出记录；这只是 phase29-exit-decision-packet-only，不代表 Phase 29 exit。

Phase 30 entry decision packet: active。当前已新增阶段30入口决策包，用于定义 Phase 30 entry owner 后续独立进入记录；这只是 phase30-entry-decision-packet-only，不代表 Phase 30 entry。

Phase 30 runtime go/no-go decision packet: active。当前已新增运行时 Go/No-Go 决策包，用于定义 runtime owner 后续独立运行时决策记录；这只是 runtime-go-no-go-decision-packet-only，不代表 runtime execution approval。

Phase 30 third-party execution approval boundary: active。当前已新增第三方执行审批边界，用于定义单插件第三方执行审批的字段、证据和反级联规则；这只是 third-party-execution-approval-boundary-only，不代表 third-party execution approval。

Git path shape decision: active。人工已确认接受当前 `项目工程` 作为仓库根的扁平化形态；索引迁移提交已完成，当前仍不制作正式 release commit。

历史功能基线仍保留：Node 后端、SQLite 持久化、混合 RAG 讲解员、Agent 状态机、运行历史、多模态附件线索、时间线、主题展、回忆报告、轻量工作流编排层、数据主权控制、部署与运维信息、专题资产、报告草稿、本地优先同步、真实多设备同步适配、长期记忆助理、外部资料导入、插件生态边界和只读运行时治理模型。

## 怎么运行

需要 Node.js 24 或更高版本。数据库使用 Node 内置 `node:sqlite`，不需要安装额外数据库依赖。

```bash
npm.cmd start
```

然后打开：

```text
http://localhost:3000
```

如果没有配置 AI Key，项目仍然能运行，后端会自动使用 Mock 回退。启动后会自动创建 SQLite 数据库：

```text
data/memory-museum.sqlite
```

也可以通过环境变量指定数据库路径。

PowerShell：

```powershell
$env:DB_PATH = "C:\path\to\memory-museum.sqlite"
npm.cmd start
```

cmd：

```cmd
set DB_PATH=C:\path\to\memory-museum.sqlite
npm.cmd start
```

如果 `3000` 端口被占用，可以临时指定其他端口。

```powershell
$env:PORT = "3001"
npm.cmd start
```

## 面试 Demo 部署

项目支持 Vercel 面试演示模式。部署到 Vercel 时设置：

```text
INTERVIEW_DEMO=true
AI_API_KEY=
```

该模式会使用 `/tmp` 下的临时 SQLite，自动注入示例展品，并禁用删除和清空接口，适合把 Live Demo 链接写到简历里。详细步骤见 `DEPLOYMENT.md`。

## 检查项

完整检查命令：

```bash
npm.cmd run check
```

当前检查覆盖 `app.js`、`server.js`、`database.js`、`src/services/operations.js`、`src/routes/health.js`、`src/routes/operations.js` 的语法检查，Phase 15 到 Phase 30 的 readiness / guardrail / evidence-pack 检查，以及会临时启动后端的 API smoke test。

只跑接口 smoke test：

```bash
npm.cmd run smoke
```

API smoke test 会验证 `/api/health`、`/api/version`、`/api/operations`、`/api/operations/export`、`/api/privacy`、`/api/workflows`、`/api/analyze`、`/api/memories`、`/api/search`、`/api/guide`、`/api/insights`、`/api/assets`、`/api/exhibitions`、`/api/report-drafts`、`/api/imports/preview` 和导出/清空等关键接口。

## AI 配置

复制 `.env.example` 到 `.env`，然后填写：

```text
AI_API_KEY=your-key
AI_BASE_URL=https://api.openai.com/v1
AI_MODEL=gpt-4o-mini
```

接口使用 OpenAI-compatible Chat Completions 格式。兼容服务只要支持 `/chat/completions` 和 JSON 输出，也可以替换 `AI_BASE_URL`。未配置或调用失败时会回退到本地 Mock Agent 工作流。

## 主要能力

- 添加文字记忆，生成标题、展厅、标签、情绪、来源、珍藏级别和展品说明。
- 展示 Agent 工作流轨迹、步骤依据、人工复核状态、确认项和重试入口。
- 优先保存到后端 SQLite；数据库不可用时保留浏览器 localStorage 本地备份。
- 支持从旧 localStorage 手动迁移到 SQLite，并保守合并本地备份。
- 支持按展厅、情绪、重点展品、关键词、人物、标签和来源筛选或搜索展品。
- 支持多模态线索：封面图、图片 OCR、语音说明、附件清单和媒体备注。
- 支持时间线、主题展候选、回忆报告摘要、专题展保存和报告草稿保存。
- 支持 `/api/workflows` 工作流蓝图，包含第十一阶段编排、质量闸门、缺口建议和第十二阶段 readiness。
- 支持 `/api/privacy` 数据主权说明，覆盖 SQLite、浏览器备份、JSON 同步包、AI 调用范围和用户控制。
- 支持完整 JSON 导出、脱敏 JSON 导出、JSON 备份恢复和确认短语清空本地数据库。
- 支持第十四阶段部署与运维面板，包含 health route、operations route、发布清单、运行手册、备份策略、风险登记、演示包摘要和模块边界。
- 支持阶段 15 专题资产计划、保存专题展、报告编辑和资产导出边界。
- 支持第十六到第十九阶段的本地优先同步、设备适配、长期记忆助理和外部资料导入。
- 支持第二十阶段插件生态边界：manifest、权限标签、审计日志、内置插件注册表、契约测试、lockfile、签名差异报告和发布前阻断模型。

## 常用 API

- `GET /api/health`：检查后端、当前阶段、Agent 角色、AI 配置状态和 operations 摘要。
- `GET /api/version`：返回版本、运行时、部署配置、关键 API、发布清单、运行手册、风险登记、发布记录、Phase 30 planning / evidence / ledger 模型。
- `GET /api/operations`：返回运维摘要、运行事件、发布历史、阶段计划和 Phase 30 人工复核执行台账。
- `GET /api/operations/export`：导出 operations 证据包和只读治理模型。
- `GET /api/options`：返回展厅、情绪、来源类型、级别标签、Agent 角色和限制信息。
- `POST /api/analyze`：输入 `{ "rawContent": "..." }`，返回结构化展品草稿和已持久化的 workflow run。
- `GET /api/agent-runs/:id`：读取某次 Agent 整理的 run、step 和 event。
- `GET /api/memories` / `GET /api/memories/:id`：读取展品列表或单件展品。
- `GET /api/memories/:id/agent-run`：读取某件展品关联的 Agent 整理历史。
- `POST /api/memories` / `PUT /api/memories/:id` / `DELETE /api/memories/:id`：创建、更新或删除展品。
- `GET /api/memories/export`：导出完整 JSON 备份。
- `GET /api/memories/export?mode=redacted`：导出脱敏 JSON 包。
- `POST /api/memories/import`：导入 JSON 备份到数据库。
- `DELETE /api/memories/purge`：输入 `{ "confirm": "DELETE" }` 后清空 SQLite 中的展品、关联字段和 Agent 整理历史。
- `GET /api/search?query=关键词&mode=hybrid`：按关键词、字段权重和本地语义线索检索候选展品。
- `POST /api/guide`：抽取问题关键词、执行 hybrid 检索并生成讲解员回答、引用和追问建议。
- `GET /api/insights`：生成时间线分组、主题展候选、回忆报告摘要和第十阶段 handoff。
- `GET /api/workflows`：生成第十一阶段工作流蓝图和第十二阶段 readiness。
- `GET /api/privacy`：生成第十二阶段隐私和数据主权策略。
- `GET /api/assets`：返回专题资产集合、报告草稿、阶段 15 readiness 和专题资产计划。
- `POST /api/exhibitions` / `GET /api/exhibitions/:id` / `DELETE /api/exhibitions/:id`：保存、读取或删除专题展。
- `POST /api/exhibitions/from-theme`：根据主题洞察生成专题展草稿。
- `POST /api/report-drafts` / `GET /api/report-drafts/:id` / `DELETE /api/report-drafts/:id`：保存、读取或删除回忆报告草稿。
- `POST /api/report-drafts/from-insights`：根据 insights 过滤条件生成报告草稿。

## 阶段说明

第十三阶段聚焦产品化、部署和运维，保留 `/api/version`、发布记录、部署模式、运行手册和部署与运维面板。第十四阶段聚焦工程模块化和服务边界重构，已拆出 health route、operations route 和 operations service，并把阶段 15 专题资产准备纳入运维视图。

当前发布治理已经推进到 Phase 29 冻结与 Phase 30 规划/人工复核准备。真实第三方插件运行时、runtime execution、release approval、Phase 29 exit 和 Phase 30 entry 仍然全部关闭，必须等待人工证据槽位完成和明确授权。

当前候选交付已补充长跑执行与深度审计记录：`项目文档/后续任务长跑执行记录.md` 和 `项目文档/阶段30候选交付深度审计记录.md`。这些记录只证明候选审查链和红线检查可追溯，不代表 reviewer 输出、live submission 或 release approval。
