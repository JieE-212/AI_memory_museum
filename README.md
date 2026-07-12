# 时屿（TIME ISLE）

> AI 私人记忆策展工具

把散落的日记、聊天片段和照片文字描述，整理成一座可检索、可回顾，也能保留不同记忆版本的私人记忆岛屿。

- Live Demo: https://ai-memory-museum-demo.vercel.app
- GitHub: https://github.com/JieE-212/AI_memory_museum
- Demo 状态: https://ai-memory-museum-demo.vercel.app/api/demo/status

公开 Demo 只使用示例数据和临时 SQLite，预置展品、导入、删除与清空已保护；访客新增内容可能在同一临时实例中被其他访客看到，请勿提交私人信息。未配置 AI Key 时自动使用本地 Mock，不消耗模型额度。

## 项目解决什么问题

普通笔记适合“写下来”，却不擅长在几年后回答这些问题：

- 哪些记忆和某个人、地点或情绪有关？
- 一段原始叙述可以怎样被整理，而又不覆盖原文？
- 同一往事被多次写下时，哪些线索稳定、哪些只是后来补充？
- AI 的分类和回答依据了哪些内容？
- 私人数据如何在本地保存，同时提供一个安全的公开演示？

时屿把这些问题收敛成一条清晰流程：

```text
记录原文 → AI 生成可编辑草稿 → 用户确认保存 → 检索与引用回答
→ 沿记忆航线发现关联 → 对照原文拼合多个版本 → 用户决定是否关联
```

## 核心功能

- 记忆整理：从原始文本生成标题、展厅、标签、人物、情绪和展品说明。
- 可追踪整理流程：将一次模型调用（无 Key 时为本地规则）组织为档案提取、策展标注和草稿生成三个阶段，保存 run、step 与 event 处理快照。
- SQLite 馆藏：记忆、标签、人物、情绪和 Agent run 使用本地 SQLite 持久化。
- 混合检索：综合匹配标题、正文、人物、地点、标签和情绪，并返回命中原因与置信提示。
- 引用式讲解：将 Top-K 检索展品作为回答上下文，并展示同批来源、命中字段与规则强度，方便用户核对；当前不声称完成真实模型输出的逐句引用校验。
- 记忆航线：基于人物、地点、日期、标签、情绪和原文关键词发现少量关联，并解释为什么相连。
- 时光拼图：比较同一往事的多个候选版本，区分稳定锚点、描述差异、单侧补充和未知项；每条有效证据都可回到原文位置。
- 补一块拼图：一次只提出一个最值得补充的问题，允许回答、跳过或明确保留不确定。
- 馆藏回顾：按时间聚合展品，发现共同主题，并生成简短回顾摘要。
- 数据维护：支持馆藏与记忆考古 JSON 备份、脱敏导出、恢复和明确确认后的本地清空；Agent 运行日志当前不在备份内。
- 面试 Demo：示例数据、临时数据库、破坏性操作保护和 Mock AI 回退。

## 技术栈

- 前端：Vanilla JavaScript、HTML、CSS
- 后端：Node.js 原生 HTTP Server
- 数据库：Node.js 内置 `node:sqlite`
- 部署：Vercel Functions + 静态资源
- AI：OpenAI-compatible Chat Completions；无 Key 时使用本地规则回退

项目刻意不引入前端框架、ORM 和额外运行依赖，让核心数据流更容易阅读和讲解。

## 项目结构

```text
项目工程/
  api/index.js                 # Vercel API 入口
  database.js                  # SQLite、事件版本、证据锚点与用户决定
  lib/archaeology.js           # 可解释关联、时光拼图与单问题算法
  lib/archaeology-backup.js    # 拼图、Claims 与补问的备份/恢复
  server.js                    # HTTP 路由、AI 回退、洞察与 Demo 隔离
  public/
    index.html                 # 四个主视图
    styles.css                 # 响应式界面
    archaeology.css            # 记忆航线与拼图的渐进披露样式
    assets/app.js              # 前端状态、交互与 API 调用
  scripts/
    archaeology-check.js       # 引用合法性与考古规则回归
    api-smoke.js               # 核心用户路径与 Demo 安全回归
    frontend-check.js          # 页面结构和复杂度边界检查
  项目文档/
    产品说明.md
    技术设计.md
```

## 本地运行

要求 Node.js 24 或更高版本。

```powershell
npm.cmd start
```

打开：

```text
http://127.0.0.1:3000
```

数据库默认创建在：

```text
data/memory-museum.sqlite
```

指定其他端口或数据库：

```powershell
$env:PORT = "3001"
$env:DB_PATH = "C:\path\to\memory-museum.sqlite"
npm.cmd start
```

## AI 配置

复制 `.env.example` 为 `.env`：

```text
AI_BASE_URL=https://api.openai.com/v1
AI_MODEL=gpt-4.1-mini
AI_API_KEY=your-key
AI_TIMEOUT_MS=20000
```

`AI_API_KEY` 留空时，记录整理和讲解员仍可工作，只是由本地规则生成结果。这样可以离线开发，也能避免公开 Demo 消耗额度。

## 常用接口

- `GET /api/health`：运行模式、AI 状态和馆藏统计。
- `GET /api/demo/status`：公开 Demo 的存储与安全限制。
- `GET /api/memories`：读取馆藏。
- `POST /api/analyze`：生成展品草稿和三阶段处理轨迹。
- `POST /api/memories`：确认并保存展品。
- `GET /api/search?query=关键词&mode=hybrid`：带命中依据的混合检索。
- `POST /api/guide`：基于引用展品回答问题。
- `GET /api/insights`：时间线、主题和回顾摘要。
- `GET /api/archaeology/routes?focus=展品ID`：生成焦点航线或今日航线。
- `GET /api/archaeology/puzzle?memoryId=A&relatedId=B`：返回带原文锚点的版本比较。
- `POST /api/archaeology/events`：用户确认后保存同一往事的版本组。
- `DELETE /api/archaeology/events/:id`：本地模式解除版本组，原文继续保留。
- `POST /api/archaeology/questions`：保存补充回答、跳过或“保留不确定”。
- `GET /api/memories/export?mode=redacted`：脱敏导出。
- `POST /api/memories/import`：恢复 JSON 记忆。

## 检查

```powershell
npm.cmd run build
npm.cmd run smoke
```

完整检查：

```powershell
npm.cmd run check
```

当前自动检查覆盖 53 条本地真实 HTTP smoke 断言，并另有记忆考古规则检查：包括静态页面、安全响应头、Mock 整理、工作流记录、展品 CRUD、混合检索、讲解来源、航线解释、原文区间校验、版本组确认/解除、保留不确定、馆藏与考古备份恢复、损坏备份拒绝，以及公开 Demo 的临时数据和预置展品保护。

## 设计边界

- AI 建议始终是草稿，用户确认后才写入馆藏。
- 原始记忆与展品说明分开保存，避免 AI 改写覆盖事实来源。
- 讲解员只接收检索结果作为上下文，并把同批来源交给用户核对；真实模型回答尚未做逐句引用一致性评测。
- 航线永远只是关联建议；系统不会自动宣称两段记录属于同一事件。
- 缺失信息不等于矛盾，只有两侧都有可校验原文时才展示“描述不同”。
- 同一往事的多个版本分别保存，确认关联也不会覆盖任何原文。
- 编辑原文时会重新校验已保存的字段证据；失效摘录不会继续标记为已核验。
- 公开 Demo 不部署私人 SQLite，也不配置真实 AI Key。
- 当前适合个人使用和面试演示；多用户认证、云端持久数据库和文件上传不在本版范围内。

更多说明见 [产品说明](./项目文档/产品说明.md) 和 [技术设计](./项目文档/技术设计.md)。部署步骤见 [DEPLOYMENT.md](./DEPLOYMENT.md)。
