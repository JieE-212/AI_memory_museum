# 时屿（TIME ISLE）V4.0.0 Vercel 面试 Demo 部署

线上 Demo（当前仍为 V3.0.0）：

```text
https://ai-memory-museum-demo.vercel.app
```

本文对应已完成本地提交、尚未推送或部署的 V4.0.0 候选；上述 Vercel 地址目前仍运行 V3.0.0。只有 V4 推送、部署并通过本文的线上核验后，才能把该域名标记为 V4 Demo。V4 Demo 仍是公开、临时、只用于面试演示的环境：它不接收私人图片，也不允许 `.time-isle` 归档恢复；完整图片保存与恢复应在具有持久磁盘的本地 Node.js 环境体验。

## Git 连接

Vercel 项目连接：

```text
GitHub repository: JieE-212/AI_memory_museum
Production branch: main
```

本地仓库的 GitHub remote 名为 `github`，因此发布代码使用：

```powershell
git push github main
```

推送后 Vercel 会自动构建。新部署变为 `Ready` 后，原 Demo 域名自动指向新版；构建失败时仍保留上一个成功版本。

## Vercel 项目设置

从 GitHub 仓库导入项目，仓库内容本身已经是项目根目录，因此：

```text
Root Directory: 留空
Install Command: npm install
Build Command: npm run build
Output Directory: 留空
```

`npm run build` 会执行语法检查和各模块回归，但不会启动真实 HTTP smoke；104 条 HTTP 断言应在推送前由 `npm.cmd run check` 完成。

`vercel.json` 将 `/api/*` 转发到 `api/index.js`，并为 Vercel 直接提供的页面、样式、脚本和 API 统一设置与本地 Node 服务一致的 CSP、frame、referrer、MIME 嗅探和 Permissions Policy 安全头。

## 环境变量

Production 环境设置：

```text
INTERVIEW_DEMO=true
AI_MODEL=gpt-4.1-mini
ALLOWED_HOSTS=ai-memory-museum-demo.vercel.app
```

Vercel 运行时会自动把 `VERCEL_URL`、`VERCEL_BRANCH_URL` 和 `VERCEL_PROJECT_PRODUCTION_URL` 中的平台域名加入精确 Host 白名单。上面的 `ALLOWED_HOSTS` 用于锁定面试入口；如添加自定义域名，以逗号分隔继续列出精确域名（可带端口）。不支持通配符或带路径的值；部署模式在没有任何有效主机时 fail closed。本地模式会忽略 `ALLOWED_HOSTS`，严格限制为回环主机。

所有非只读请求必须带与当前 Host 同源的 `Origin`；若有 `Sec-Fetch-Site`，其值必须是 `same-origin`。项目页面的浏览器请求会自动携带这些头；用脚本直接调用写接口时也必须显式携带。

公开面试 Demo 不需要、也不应配置 `AI_API_KEY`：

- 避免消耗模型额度和公开环境滥用 Key。
- `INTERVIEW_DEMO=true` 会在代码层强制使用本地 Mock；即使误配 Key，也不会向外部模型发送请求或消耗额度。
- Mock 整理、检索、讲解与记忆考古流程仍可演示。
- EXIF、图片指纹、近似候选、区域证据、手动叠影和本机 `TextDetector` 本来也不依赖 AI Key。

如需在非 Demo 的受控本地环境验证真实模型，再添加：

```text
AI_API_KEY=your-key
AI_BASE_URL=https://api.openai.com/v1
AI_TIMEOUT_MS=20000
```

公开 Demo 通常不需要配置 `DB_PATH` 或 `MEDIA_ROOT`。代码会在任何启动删除前解析真实路径，并要求二者位于系统临时目录、使用 `ai-memory-museum-` 专用前缀，且不能相同或互相包含；否则进程 fail closed，避免误配置清理私人数据。也不要提交 `.env`、本地 SQLite、`data/media` 或 `.time-isle` 备份。

## V4 Demo 安全行为

`INTERVIEW_DEMO=true` 时：

- SQLite 位于 Vercel `/tmp`，媒体根目录也位于独立的 `/tmp` 临时目录；冷启动会恢复四件示例展品，不承诺保存访客新增文本。
- Demo 在代码层始终强制 Mock，误配的 `AI_API_KEY` 不会被使用。
- 共享文本馆藏、整理运行、时光拼图与补问分别受 SQLite 事务硬上限保护；并发请求也不能越过上限，达到后返回 429。
- 所有媒体写操作返回 403，包括原图上传、展示图和缩略图写入、完成上传、图片关联、区域证据、指纹生成与图片删除。
- `.time-isle` 归档恢复和旧 JSON 导入返回 403，避免外部文件污染共享实例；完整或脱敏导出仍只导出当前临时实例中的公开数据。
- 删除展品、解除关系、清空数据库和改写预置展品均受保护。
- 页面显示“公开面试 Demo”提示，并禁用图片选择和完整备份恢复入口。
- 不会把私人 SQLite 或本机媒体目录打包到部署产物，也不会把图片发送给 AI 服务。

访客仍可能在共享临时实例中新增普通文本，所以页面提示中的“请勿提交私人内容”也适用于文字。

## 为什么 Vercel 不承载私人图片

V4 的媒体层使用本地文件系统、SHA-256 内容寻址和 SQLite 引用关系。Vercel Functions 的临时文件系统不提供这种数据所需的持久性，因此：

- 公开 Demo 明确关闭媒体写入，而不是假装已经持久保存。
- 不要仅把 `INTERVIEW_DEMO` 改为 `false` 就当作私人生产部署；实例重建后 SQLite 和图片都可能丢失。
- 私人或长期部署应使用 Node.js 24+ 和持久磁盘，同时持久化 `DB_PATH` 与 `MEDIA_ROOT`，并定期下载完整 `.time-isle`。
- 若未来接入云数据库或对象存储，需要额外实现身份认证、租户隔离、访问控制和存储驱动；这些不在 V4.0.0 范围内。

本地持久配置示例：

```powershell
$env:DB_PATH = "D:\time-isle\memory-museum.sqlite"
$env:MEDIA_ROOT = "D:\time-isle\media"
npm.cmd start
```

默认本地路径分别为 `data/memory-museum.sqlite` 和 `data/media/`。完整 `.time-isle` 会包含馆藏、照片、图片线索和时光拼图，但不包含 Agent 运行日志；脱敏归档会物理排除图片文件。

## 发布前检查

Windows PowerShell 使用 `npm.cmd`，可以避免 `npm.ps1` 被系统执行策略拦截；Vercel 的 Linux 构建命令继续使用 `npm`。

```powershell
npm.cmd run build
npm.cmd run smoke
npm.cmd run check
```

- `build`：语法检查和各独立回归，不运行 HTTP smoke。
- `smoke`：在系统临时目录启动本地服务，执行当前 104 条真实 HTTP 断言。
- `check`：依次执行全部语法、独立回归和 HTTP smoke；`npm.cmd test` 与它等价。

媒体相关回归覆盖真实格式校验、安全展示图、精确去重、关联保护与 GC、EXIF 待确认/GPS 敏感、区域证据、只供人工复核的近似候选、本机 `TextDetector` 不可用时的手动降级、手动两点叠影，以及 `.time-isle` 全量验真、损坏零写入和事务恢复。

检查通过后：

```powershell
git push github main
```

## 部署后验证

确认以下地址均可访问：

```text
https://ai-memory-museum-demo.vercel.app
https://ai-memory-museum-demo.vercel.app/api/health
https://ai-memory-museum-demo.vercel.app/api/version
https://ai-memory-museum-demo.vercel.app/api/demo/status
https://ai-memory-museum-demo.vercel.app/api/privacy
```

`/api/version` 应返回 `"version": "4.0.0"`。`/api/demo/status` 应包含：

```json
{
  "interviewDemo": true,
  "mode": "interview-demo",
  "storage": "ephemeral-sqlite-on-tmp",
  "seededExamples": 4,
  "destructiveActionsBlocked": true,
  "aiMode": "mock-fallback"
}
```

最后在无痕窗口完成一次人工路径：

1. 浏览四件示例展品，打开《操场尽头的告别》，进入记忆航线与时光拼图并核对原文摘录。
2. 体验 Mock AI 整理、混合检索和讲解来源，不输入任何私人文本。
3. 确认“添加照片”入口处于 Demo 禁用状态；不要用真实私人照片测试公开站点。
4. 确认完整备份可以导出，但恢复入口、旧 JSON 导入、删除和清空均不可用。
5. 在浏览器网络面板确认直接尝试媒体写入或 `POST /api/archive/restore` 会得到 403，而读取页面和公开 API 保持正常。

影像闭环的最终验收应在本地使用两张可丢弃、无隐私的测试图完成：分别体验“仅保留安全展示图”和“保留原图”、可用的 EXIF 线索确认、区域圈选、近似候选、文字手动降级、手动叠影，再导出 `.time-isle` 并恢复到另一组临时 `DB_PATH` / `MEDIA_ROOT`。测试后删除这组临时数据，不把测试图片提交到仓库。

## 重复 Vercel 项目

同一 GitHub 仓库如果连接多个 Vercel 项目，每次推送可能重复构建。正式简历链接只保留：

```text
ai-memory-museum-demo
```

其他重复项目应删除或断开 Git 连接，避免浪费构建额度和误用域名。
