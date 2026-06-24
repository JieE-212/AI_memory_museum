# AI 记忆博物馆 - 项目工程

当前是项目第十九阶段第九版：Node 后端 + AI 结构化生成 + SQLite 数据库持久化 + 混合 RAG 讲解员 + Agent 状态机 + Agent 运行历史 + 多模态附件线索 + 时间线、主题展、回忆报告 + 轻量工作流编排层 + 数据主权控制 + 产品化运维信息 + 可保存专题展 + 回忆报告草稿 + 第十六阶段本地优先同步闭环 + 第十七阶段真实多设备同步适配层 + 第十八阶段长期记忆助理 + 第十九阶段外部资料导入。第十九阶段第九版补上复核状态流转、模板字段别名规则、导入报告视图和批次审计检索，让外部资料导入从“可复核、可审计、可持续整理”推进到“可解释、可检索、可追踪状态”的资料整理入口。

## 怎么运行

需要 Node.js 24 或更高版本。数据库使用 Node 内置 `node:sqlite`，不需要安装额外数据库依赖。

```bash
npm.cmd start
```

然后打开：

```text
http://localhost:3000
```

如果没有配置 AI Key，项目仍然能运行，后端会自动使用 Mock 回退。

启动后会自动创建 SQLite 数据库：

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

如果 `3000` 端口被占用，可以临时指定其他端口：

PowerShell：

```powershell
$env:PORT = "3001"
npm.cmd start
```

cmd：

```cmd
set PORT=3001
npm.cmd start
```

## 检查项目

进入下一阶段前运行：

```bash
npm.cmd run check
```

当前检查包含 `app.js`、`server.js`、`database.js`、`src/services/operations.js`、`src/routes/health.js`、`src/routes/operations.js` 语法检查、第十五阶段 readiness 检查，以及会临时启动后端的 API smoke test。readiness 检查会覆盖专题资产表、报告草稿表、资产 API、导出字段、前端阶段期望、CSS 变量、README、白皮书和项目规划状态；API smoke test 会验证 `/api/health`、`/api/version`、`/api/operations`、`/api/assets`、`/api/exhibitions`、`/api/report-drafts`、`/api/privacy`、`/api/workflows`、`/api/analyze`、`/api/memories/purge`、`/api/search?mode=keyword|semantic|hybrid`、`/api/guide`、`/api/insights` 和展品整理历史关联接口。

只跑接口 smoke test：

```bash
npm.cmd run smoke
```

## 配置真实 AI

复制 `.env.example` 为 `.env`，然后填写：

```text
AI_BASE_URL=https://api.openai.com/v1
AI_MODEL=gpt-4.1-mini
AI_API_KEY=你的 API Key
AI_TIMEOUT_MS=20000
```

接口使用 OpenAI-compatible Chat Completions 格式。兼容服务只要支持 `/chat/completions` 和 JSON 输出，也可以替换 `AI_BASE_URL`。

## 当前功能

- 添加一段文字记忆
- 后端用档案员、策展人、编辑、讲解员四步 Agent 状态机生成标题、展厅、标签、情绪、情绪强度、来源、珍藏级别和展品说明
- 未配置或调用失败时自动回退 Mock Agent 工作流
- 前端会展示每次整理的 Agent 工作流轨迹
- Agent 步骤支持 `queued`、`running`、`needs_review`、`approved`、`failed`、`done`、`ready` 等状态
- 待确认步骤支持人工确认和重试整理
- 复核项可点击定位到字段；补完后需要点击“确认复核完成”，确认后才会显示可以保存
- 保存前会检查 Agent 复核状态，未确认复核时不会直接保存
- Agent 步骤会展示依据字段，方便观察每一步参考了哪些结构化线索
- AI 请求有超时控制，异常响应会回退到本地可用结果
- AI 返回内容会做 JSON 容错解析和字段规范化
- 使用随机示例快速体验添加流程
- 原始记忆输入有字数反馈
- 优先保存到后端 SQLite 数据库
- 数据库不可用时自动保留浏览器 localStorage 本地备份
- 支持把旧 localStorage 展品手动迁移到 SQLite
- 当 SQLite 和本地备份不一致时，页面会保守合并显示，避免旧展品被静默覆盖
- 如果数据库为空但本地有展品，直接保存新展品前会先自动迁移本地备份
- 按展厅查看展品
- 按情绪或重点展品筛选
- 搜索标题、内容、人物、标签、情绪和来源
- 一键清空展厅、搜索、排序和情绪筛选
- 按时间、标题、珍藏级别或情绪强度排序
- 查看展品详情
- 查看展品关联的 Agent 整理历史、步骤摘要和依据字段
- 编辑已有展品
- 记录封面图线索、图片/OCR/语音说明和附件清单
- 删除展品
- 导出和导入带 schema 信息的 JSON 备份
- 添加记忆时查看右侧实时展品草稿预览
- 查看时间线、主题展候选和回忆报告摘要
- 时间线和主题展候选可以联动筛选展品墙
- 回忆报告会展示时间范围、覆盖度和叙事章节
- 洞察面板支持全馆、当前展厅和当前筛选结果三种范围
- 主题展候选会生成主题说明和代表展品，报告会列出引用展品来源
- 查看第十一阶段工作流编排面板，了解展品整理、回忆报告和讲解检索三个模板
- 工作流编排会显示人工复核、重试/驳回、运行回放、引用依据和范围洞察的接入状态
- 工作流编排会显示复核覆盖率、回放覆盖率、导览覆盖率、质量闸门、当前缺口和建议动作
- 工作流编排会优先读取后端 `/api/workflows` 蓝图，失败时回退到前端本地蓝图
- 工作流模板支持点击查看节点依据、暂停点、风险信号和下一步动作
- 编排面板展示第十二阶段“账号、多端同步、隐私和数据主权”的准备度
- 查看第十二阶段数据主权面板，管理本地馆主名称、设备备注、同步偏好和 AI 调用同意状态
- `/api/privacy` 会说明 SQLite、浏览器本地备份、JSON 同步包、AI 调用范围和用户控制能力
- 导出包包含 `phase12Sovereignty` 和 `privacyPolicy`
- 支持通过确认短语清空 SQLite 中的展品和 Agent 整理历史
- 隐私策略会汇总人物、地点、联系方式、低谷情绪和附件元数据等敏感线索
- 如果后端已配置 AI，首次 Agent 整理前会要求确认原始记忆发送范围
- 导出 JSON 前会根据敏感风险提示保存建议
- 支持导出脱敏 JSON 包，用于演示、排查和跨设备预览
- 数据主权面板展示第十三阶段产品化 readiness
- 查看第十四阶段部署与运维面板，展示运行环境、部署模式、检查命令、发布清单、运行手册、备份策略、风险登记、最近运行事件、发布记录、运维日志、演示包、阶段 14 readiness、模块边界和后续工程任务
- `/api/version` 会返回版本、运行时、部署配置、关键 API、检查命令、运维摘要、发布清单、运行手册、备份策略、部署模式、风险登记、发布记录、日志归档、演示包摘要、阶段 14 readiness 和模块边界计划
- `/api/operations`、`/api/operations/export` 和 `/api/health` 的 operations 摘要已由 `src/services/operations.js` 生成
- `/api/version`、`/api/operations`、`/api/operations/export` 的路由分发已由 `src/routes/operations.js` 接管
- `/api/health` 的路由分发已由 `src/routes/health.js` 接管
- 部署与运维面板新增阶段 15 准备和专题资产计划，用于进入第十五阶段前确认可保存专题展、报告草稿和导出边界
- `/api/assets` 会返回已保存专题展、报告草稿、阶段 15 readiness 和专题资产计划
- 洞察面板新增“保存为专题展”和“生成报告草稿”动作，并在“专题资产”卡片展示已保存资产集合
- 专题资产卡片支持打开详情、刷新资产库和删除专题资产；删除专题资产不会删除原始展品
- 专题展可在详情弹窗中编辑标题、状态、标签、专题说明和导览词；报告草稿可编辑标题、状态和章节结构
- 专题展可编辑封面展品和展品排序；报告草稿可编辑引用展品；单个专题资产可查看并导出 JSON 预览
- 专题展编辑可从已保存展品下拉插入并上移/下移排序；报告草稿可从已保存展品下拉插入引用；资产面板可预览完整导出包数量
- `/api/exhibitions` 支持专题展保存、读取和删除
- `/api/report-drafts` 支持回忆报告草稿保存、读取和删除
- `/api/exhibitions/from-theme` 支持根据主题洞察生成专题展草稿
- `/api/report-drafts/from-insights` 支持根据 insights 生成回忆报告草稿
- `/api/memories/export` 已包含 `savedExhibitions` 和 `reportDrafts`
- 简单的 AI 讲解员预览
- AI 讲解员支持自由提问，会先抽取中文关键词并检索 SQLite 中的候选展品，再基于候选展品回答
- 未配置 AI Key 时，讲解员会使用本地 RAG 回退回答
- 查看单件展品的结构化 JSON 样例

## 接口

- `GET /api/health`：检查后端、当前阶段、Agent 角色和 AI 配置状态
- `GET /api/version`：返回第十四阶段版本、运行环境、部署模式、检查命令、关键 API、发布清单、运行手册、备份策略、风险登记、发布记录、阶段 14 readiness、模块边界计划和后续工程任务
- `GET /api/operations`：返回运行摘要、最近运行事件、发布记录、发布清单、运行手册、备份策略和风险登记
- `GET /api/operations/export`：导出运维包，包含最近运行事件、日志归档、演示包摘要和运维控制台信息
- `GET /api/options`：返回展厅、情绪、来源类型、级别标签、Agent 角色和限制信息
- `POST /api/analyze`：输入 `{ "rawContent": "..." }`，返回结构化展品草稿、`workflow.summary`、`workflow.steps`、`workflow.stateMachine` 和已持久化的 `workflow.run`
- `GET /api/agent-runs/:id`：读取某次 Agent 整理的 run、step 和 event
- `GET /api/memories`：读取数据库中的所有展品
- `GET /api/memories/:id`：读取单件展品
- `GET /api/memories/:id/agent-run`：读取某件展品关联的 Agent 整理历史
- `GET /api/search?query=关键词&mode=hybrid`：从数据库中按关键词、字段权重和本地语义线索检索候选展品；也支持 `mode=keyword|semantic|hybrid`；响应会返回 `results`、分数、命中字段、语义命中、匹配理由和可信度层级
- `POST /api/guide`：输入 `{ "question": "..." }`，抽取问题关键词、执行 hybrid 检索并生成讲解员回答；响应会返回 `query`、`citations` 和 `followUps`，前端会展示引用原因、可信度和可继续追问方向，未找到强匹配时会说明证据边界
- `GET /api/insights`：生成第十阶段洞察，包含时间线分组、主题展候选、回忆报告摘要和 `phase10Handoff`；支持 `hall`、`year`、`theme` 筛选参数
- `GET /api/workflows`：生成第十一阶段工作流蓝图，包含轻量编排引擎说明、能力声明、handoff 状态、质量闸门、数据来源、缺口建议、工作流模板和 `phase12Readiness`
- `GET /api/privacy`：生成第十二阶段隐私和数据主权策略，包含数据位置、AI 调用范围、用户控制和同步包说明
- `GET /api/assets`：返回第十五阶段专题资产集合、报告草稿和资产 readiness
- `POST /api/exhibitions`：保存专题展草稿，字段包含 `title`、`intro`、`memoryIds`、`coverMemoryId`、`guideText`、`tags` 和 `status`
- `POST /api/exhibitions/from-theme`：根据 `theme`、`year`、`hall` 生成专题展草稿
- `POST /api/report-drafts`：保存回忆报告草稿，字段包含 `title`、`scope`、`sections`、`references`、`sourceInsights` 和 `status`
- `POST /api/report-drafts/from-insights`：根据 insights 过滤条件生成报告草稿
- `GET /api/memories/export?mode=redacted`：导出脱敏 JSON 包，遮盖原文、展品说明、人物、地点和附件备注
- `DELETE /api/memories/purge`：输入 `{ "confirm": "DELETE" }` 后清空 SQLite 中的展品、关联字段和 Agent 整理历史
- `POST /api/memories`：创建展品；如果请求体包含 `agentWorkflow`，会同步保存当前工作流快照并写入 `memory_saved` 创建事件
- `PUT /api/memories/:id`：更新展品；如果请求体包含 `agentWorkflow`，会同步保存当前工作流快照并写入 `memory_saved` 更新事件
- `DELETE /api/memories/:id`：删除展品
- `POST /api/memories/import`：导入 JSON 备份到数据库
- `GET /api/memories/export`：从数据库导出 JSON 备份

## 后续计划

第十八阶段长期记忆助理已经作为基础保留，完整导出包、脱敏包和手动同步包继续携带 `phase16Sync`、`phase17SyncAdapter` 和 `phase18LongTermAgent`。第十九阶段第九版新增外部资料导入清洗、批次回看、质量评分、失败恢复、映射模板、自定义模板持久化、导入冲突决策、冲突复核台、导入后整理队列、批次审计导出、复核状态流转、模板字段别名规则、导入报告视图和批次审计检索，可把文本、Markdown、CSV、JSON 和聊天记录先拆成展品草稿，再按日记、聊天、相册、旅行或用户自定义模板预处理；自定义模板可以保存默认人物、日期规则和字段别名。用户可以命名导入批次、预判疑似重复展品，并选择跳过、作为新展品或保留待复核。最近导入批次可展开查看质量详情、失败项、补全任务状态、质量趋势、重复处理摘要、整理队列、导入报告和筛选后的跨批次对比，并支持复核项标记为已解决、忽略或加入整理队列，也支持整批撤销、单项撤销、审计检索或导出批次审计包。第十七阶段同步适配层仍不会自动传输私人数据。

第十七阶段继续保留第十六阶段的逐项冲突决策、导入前风险确认、恢复演练、专题资产合并预览和同步审计；新增适配层只负责把设备、队列和通道边界建清楚，不会绕过本地优先同步闭环。

后续阶段已经扩展到第 20 阶段：

- 阶段 14：工程模块化和服务边界重构
- 阶段 15：专题资产、报告编辑和可保存展览
- 阶段 16：真实多端同步和冲突处理
- 阶段 17：真实多设备同步适配层
- 阶段 18：Agent 能力进阶和长期记忆助理
- 阶段 19：个人知识生态和外部导入
- 阶段 20：可扩展产品平台和插件生态

近期继续推进阶段 18。第十二版已经完成关系图谱与专题展/报告的双向跳转；下一步优先做长期助理摘要和每日/每周复盘入口。
