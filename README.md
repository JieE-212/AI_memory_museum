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

Phase 30 human review evidence worksheet: active。该填写表只用于线下补齐 evidenceRef、reviewer、reviewedAt、decisionReason 和 residualRisk，不代表人工签核已经完成。

Phase 30 RC freeze checklist / human evidence intake plan / human evidence intake register: active。当前已经进入 RC 冻结和人工证据 intake 登记准备，但 10 个 evidence slots 仍是 `pending`，不能自动转为 release approval 或 runtime go。

Phase 30 human evidence submission gate: active。当前已经建立未来真实人工证据 JSON 的格式门禁；默认没有 live submission 文件，门禁通过也不等于 release approval。

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
