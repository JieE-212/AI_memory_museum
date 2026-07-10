# AI 记忆博物馆

把散落的日记、聊天片段和照片故事整理成可检索、可回顾的私人展览。

- Live Demo: https://ai-memory-museum-demo.vercel.app
- GitHub: https://github.com/JieE-212/AI_memory_museum
- Demo 状态: https://ai-memory-museum-demo.vercel.app/api/demo/status

公开 Demo 只使用示例数据和临时 SQLite，删除与清空操作已关闭；未配置 AI Key 时自动使用本地 Mock，不消耗模型额度。

## 项目解决什么问题

普通笔记适合“写下来”，却不擅长在几年后回答这些问题：

- 哪些记忆和某个人、地点或情绪有关？
- 一段原始叙述可以怎样被整理，而又不覆盖原文？
- AI 的分类和回答依据了哪些内容？
- 私人数据如何在本地保存，同时提供一个安全的公开演示？

AI 记忆博物馆把这些问题收敛成一条清晰流程：

```text
记录原文 → AI 生成可编辑草稿 → 用户确认保存 → 混合检索与引用回答 → 时间线和主题回顾
```

## 核心功能

- 记忆整理：从原始文本生成标题、展厅、标签、人物、情绪和展品说明。
- 可追踪 Agent：保存档案、策展、编辑三个步骤及其输出，用户可以回看整理依据。
- SQLite 馆藏：记忆、标签、人物、情绪和 Agent run 使用本地 SQLite 持久化。
- 混合检索：综合匹配标题、正文、人物、地点、标签和情绪，并返回命中原因与置信提示。
- AI 讲解员：只基于检索到的展品回答，并回链到引用展品；证据不足时明确说明。
- 馆藏回顾：按时间聚合展品，发现共同主题，并生成简短回顾摘要。
- 数据维护：支持完整 JSON 备份、脱敏导出、JSON 恢复和明确确认后的本地清空。
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
  database.js                  # SQLite 建表、CRUD、Agent run 与检索
  server.js                    # HTTP 路由、AI 回退、洞察与 Demo 隔离
  public/
    index.html                 # 四个主视图
    styles.css                 # 响应式界面
    assets/app.js              # 前端状态、交互与 API 调用
  scripts/
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
- `POST /api/analyze`：生成展品草稿和 Agent 轨迹。
- `POST /api/memories`：确认并保存展品。
- `GET /api/search?query=关键词&mode=hybrid`：带命中依据的混合检索。
- `POST /api/guide`：基于引用展品回答问题。
- `GET /api/insights`：时间线、主题和回顾摘要。
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

当前 smoke test 覆盖：静态页面、安全响应头、健康状态、Mock 整理、Agent run 关联、展品增改删、混合检索、讲解引用、回顾、完整/脱敏导出、JSON 导入、清空确认，以及公开 Demo 的示例注入与删除保护。

## 设计边界

- AI 建议始终是草稿，用户确认后才写入馆藏。
- 原始记忆与展品说明分开保存，避免 AI 改写覆盖事实来源。
- 讲解员只能使用检索结果，不把生成文本伪装成用户记忆。
- 公开 Demo 不部署私人 SQLite，也不配置真实 AI Key。
- 当前适合个人使用和面试演示；多用户认证、云端持久数据库和文件上传不在本版范围内。

更多说明见 [产品说明](./项目文档/产品说明.md) 和 [技术设计](./项目文档/技术设计.md)。部署步骤见 [DEPLOYMENT.md](./DEPLOYMENT.md)。
