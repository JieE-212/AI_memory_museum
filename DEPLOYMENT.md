# 时屿（TIME ISLE）V8.0.0 发布前与 V7.1.0 线上 Demo 说明

线上 Demo（当前仍为 V7.1.0）：

```text
https://ai-memory-museum-demo.vercel.app
```

本文保留 V7.1.0（schema 9）的线上发布配置与验收事实，并追加 V8 的发布前口径。V7.1 已于 2026-07-17 完成本地检查、双远端推送和 Vercel 部署后验收；线上 `/api/health` 已核验 `version: 7.1.0`、`schemaVersion: 9`、`mode: interview-demo`、`storage: ephemeral-sqlite` 和 `aiMode: mock-fallback`。当前公开 Demo 与 GitHub 已发布基线都仍是 V7.1，实际部署状态始终以线上 `/api/version` 与 `/api/health` 返回值为准。

本地 V8.0.0（schema 12）已于 2026-07-18 完成实现、完整检查、真实浏览器桌面/390px/320px 验收与独立审计，并已形成本地提交；真实 HTTP smoke 共 211 条断言。当前尚未推送、尚未部署，因此不能把本地结果写成线上发布事实。只有完成推送、新部署变为 `Ready`，且线上接口返回 `8.0.0 / schema 12` 后，才能更新本段状态。

V7.1 PWA 仍是公开、临时、只用于面试演示的受保护 Demo：安装到设备不会开放麦克风、媒体写入或私人内容持久化。它不接收私人图片或声音，不保存展览、回访、实体变更或时间胶囊，也不允许 `.time-isle` 归档恢复。完整媒体保存、胶囊封存和归档恢复应在具有持久磁盘的本地 Node.js 环境体验；浏览器端加密流程可以使用公开示例预览，但不要输入私人内容。

面向下一次公开 Demo 的本地 V8 代码已确定性播种 4 件示例展品、1 场可分享的已确认展览，以及由两段校园记录组成的 1 个已确认事件和 1 项“保留多种记录”时间校准，使访客无需写入即可演示三层分享隐私编辑台与不确定时间线。数据仍位于临时 SQLite；公开 Demo 只允许读取校准来源和结果，继续禁止展览、回访意愿、时间校准、胶囊和媒体持久化，并继续禁止输入任何私人数据。此变化尚未部署到当前线上 V7.1。

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

`npm run build` 会执行语法检查和各模块回归，但不会启动真实 HTTP smoke；V8 的 211 条 HTTP 断言应在推送前由 `npm.cmd run check` 完成。

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

## 当前 V7.1 Demo 安全行为

`INTERVIEW_DEMO=true` 时：

- SQLite 位于 Vercel `/tmp`，媒体根目录也位于独立的 `/tmp` 临时目录；冷启动会恢复四件示例展品，不承诺保存访客新增文本。
- Demo 在代码层始终强制 Mock，误配的 `AI_API_KEY` 不会被使用。
- 共享文本馆藏、整理运行、时光拼图与补问分别受 SQLite 事务硬上限保护；并发请求也不能越过上限，达到后返回 429。
- 所有媒体写操作返回 403，包括原图上传、展示图和缩略图写入、完成上传、图片关联、区域证据、指纹生成与图片删除。
- 所有声音上传、关联和文字稿写入返回 403；麦克风权限策略固定关闭。
- 实体别名/合并、展览保存、回访浏览状态和时间胶囊持久化均返回 403；无写入的主题展览预览与浏览器内加密仍可演示。
- `.time-isle` 归档恢复和旧 JSON 导入返回 403，避免外部文件污染共享实例；完整或脱敏导出仍只导出当前临时实例中的公开数据。
- 删除展品、解除关系、清空数据库和改写预置展品均受保护。
- 页面显示“公开面试 Demo”提示，并禁用图片选择和完整备份恢复入口。
- 不会把私人 SQLite 或本机媒体目录打包到部署产物，也不会把图片发送给 AI 服务。

访客仍可能在共享临时实例中新增普通文本，所以页面提示中的“请勿提交私人内容”也适用于文字。

## 为什么 Vercel 不承载私人图片、声音与胶囊

V7 的图片、声音与胶囊层使用本地文件系统、SHA-256 内容寻址和 SQLite 引用关系。Vercel Functions 的临时文件系统不提供这类私人数据所需的持久性，因此：

- 公开 Demo 明确关闭媒体写入，而不是假装已经持久保存。
- 不要仅把 `INTERVIEW_DEMO` 改为 `false` 就当作私人生产部署；实例重建后 SQLite 和图片都可能丢失。
- 私人或长期部署应使用 Node.js 24+ 和持久磁盘，同时持久化 `DB_PATH` 与 `MEDIA_ROOT`，并定期下载完整 `.time-isle`。
- 若未来接入云数据库或对象存储，需要额外实现身份认证、租户隔离、访问控制、密钥管理和存储驱动；这些不在 V8.0.0 范围内。

本地持久配置示例：

```powershell
$env:DB_PATH = "D:\time-isle\memory-museum.sqlite"
$env:MEDIA_ROOT = "D:\time-isle\media"
npm.cmd start
```

默认本地路径分别为 `data/memory-museum.sqlite`、`data/media/` 和 `data/media/voice/`。V8 schema 12 完整 `.time-isle` 会包含馆藏、照片、声音、确认文字稿、图片线索、实体图、主题展览、回访状态与用户明确回访意愿、时间校准、时间胶囊、时光拼图和可校验记忆修订链，但不包含 Agent 运行日志；`timeline/calibrations.json` 是 schema 12 的必需 section，缺失或声明 future schema 会整批拒绝。时间校准会同时记录保存时摘要、导出时当前摘要和最小来源快照；恢复重建的当前摘要必须匹配导出摘要，原本已待复核的旧判断则继续保留。脱敏归档会物理排除正文、媒体文件、文字稿、展览叙事、实体名称、胶囊内容、时间校准的日期、来源、备注、ID 与哈希，以及回访意愿的展品 ID、选择、日期、时区和修订快照、编辑备注、哈希、精确时间、内部 ID；时间校准只保留总数、“保留多种记录”数、“仍不确定”数和固定说明。

## 发布前检查

Windows PowerShell 使用 `npm.cmd`，可以避免 `npm.ps1` 被系统执行策略拦截；Vercel 的 Linux 构建命令继续使用 `npm`。

```powershell
npm.cmd run build
npm.cmd run smoke
npm.cmd run check
```

- `build`：语法检查和各独立回归，不运行 HTTP smoke。
- `smoke`：在系统临时目录启动本地服务，执行当前 211 条真实 HTTP 断言。
- `check`：依次执行全部语法、独立回归和 HTTP smoke；`npm.cmd test` 与它等价。

回归覆盖真实格式校验、安全展示图、精确去重、关联保护与 GC、EXIF 待确认/GPS 敏感、区域证据、声音、主题展览、实体线索、胶囊锁定、三层分享隐私编辑台、浏览器端加密、明确回访意愿、记忆修订、来源校准、馆藏体检，以及 schema 12 `.time-isle` 全量验真、损坏零写入和事务恢复。

## V7.2、V7.3 与 V8 发布前新增验收（仅本地已完成）

- 创建与真实编辑形成 SHA-256 父链；`If-Match` 或 `expectedUpdatedAt` 阻止过期写入，no-op 不更新时间也不新增修订，恢复旧版只追加新的 `head`。
- 馆藏体检只读核对数据库、修订链、图片与声音；`POST /api/archive/inspect` 只验真并返回安全摘要，不恢复正式数据。
- 完整修订 section 使用 20 MiB UTF-8 JSON 预算，旧 JSON 导入请求上限为 64 MiB；JSON 和 `.time-isle` 都拒绝 future schema。
- 脱敏修订只保留计数摘要，严格排除正文、结构化字段、编辑备注、哈希、精确时间和内部 ID。
- 启动与定时维护只清扫超过一小时且符合专用命名契约的导出、恢复、验真暂存；符号链接父目录与无关目录不会被跟随删除。
- 三层分享隐私编辑台先核对通用公开外壳，再逐项编辑和选择口令内叙事与证据，最后确认分享回执；任意修改会撤销最终确认并清空口令，未选内容、内部 ID、URL、SHA、原图和 EXIF/GPS 不进入 V2 加密载荷，V1 文件仍可阅读。
- 欢迎、延期、暂停和恢复自然回访都要求用户明确确认；不保存自由文本原因，不推断心理状态。schema 11 完整归档可映射恢复非自然意愿，脱敏归档仅保留总数与固定说明。
- 公开 Demo 模式确定性播种 1 场已发布展览供无写入分享演示，但展览、回访意愿、胶囊、媒体、恢复和导入仍必须由 `INTERVIEW_DEMO=true` 禁止持久化或返回 403。
- V8 时间校准可面向单件展品或已确认事件；用户只能明确选择一个日期、一个范围、保留多种记录或仍不确定，保存不会回写原文和展品日期，也不会自动裁决唯一真实时间。
- 候选来源限于当前展品日期、可校验修订、仍有效的原文日期锚点和非敏感 EXIF 拍摄日期；GPS 严格排除。来源使用内容稳定键和集合 SHA-256，变化后旧判断保留但进入 `needsReview`。
- 校准 PUT / DELETE 要求 `confirm: true`、ETag / `If-Match` 和当前来源摘要；公开 Demo 预置 1 个事件及 1 项“保留多种记录”校准供只读演示，校准写入与删除返回 403。
- schema 12 JSON 与 `.time-isle` 恢复时间校准并映射展品、事件 ID；JSON 缺少媒体来源时保留判断并返回需要 `.time-isle` 的边界，脱敏归档只保留五个固定摘要字段。

V8 当前关键回归计数：真实 HTTP smoke 211 条；时间校准服务端、数据库、API 与归档合同 151 条、其 UI 206 条；JSON 馆藏导入 123 条；媒体归档备份 237 条；媒体归档恢复 158 条；归档只读验真 17 条；数据库健康 26 条；馆藏体检 66 条；前端 96 项。既有分享、回访、胶囊、声音、媒体与 PWA 回归仍全部纳入 `npm.cmd run check`。

本地 V8 已形成本地发布提交并再次通过检查，尚未推送或部署；下一步才执行推送。GitHub 推送命令为：

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
https://ai-memory-museum-demo.vercel.app/manifest.webmanifest
https://ai-memory-museum-demo.vercel.app/sw.js
https://ai-memory-museum-demo.vercel.app/offline.html
```

- `manifest.webmanifest` 应声明 `/#collection` 为启动入口、`standalone` 显示模式及 192 / 512 图标。
- `sw.js` 只应预缓存离线边界页、其样式和公开品牌 SVG，不得缓存首页、API、图片、声音、归档或用户内容。
- `offline.html` 应可独立打开，并明确说明断网时不会展示私人馆藏。

当前线上 V7.1 的 `/api/version` 已返回 `"version": "7.1.0"`，健康接口已返回 `"schemaVersion": 9`，这仍是本文记录的线上事实；`/api/demo/status` 已包含：

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

V8 已完成本地实现与检查，但尚未推送或部署。待新部署变为 `Ready` 后，必须重新确认 `/api/version` 与 `/api/health` 分别返回 `8.0.0` 和 schema 12，`/api/demo/status` 返回 `seededExamples: 4`、`seededExhibitions: 1` 与 `seededTimeCalibrations: 1`；同时验证修订恢复、体检启动或取消、回访意愿写入、时间校准 PUT / DELETE、展览与胶囊持久化、媒体写入、导入和归档恢复在公开 Demo 中继续返回 403。完成这些检查前不得把线上版本标为 V8。

最后在无痕窗口完成一次人工路径：

1. 浏览四件示例展品，打开《操场尽头的告别》，进入记忆航线与时光拼图并核对原文摘录。
2. 在时光拼图展开默认折叠的来源校准台，确认两种日期来源、“保留多种记录”结果及不改写原日期的边界；时间线摘要可以重新打开该拼图，尝试保存或移除校准应被 Demo 以 403 阻止。
3. 体验 Mock AI 整理、语义线索检索、实体档案预览和讲解来源，不输入任何私人文本。
4. 体验主题展览预览、今日回访、明确回访意愿界面与声音只读提示；确认展览保存、回访状态与意愿、声音和胶囊写入均被 Demo 阻止。
5. 从播种的已确认展览打开“胶囊与分享”，确认页面明确提示公开 Demo 不保存胶囊；逐层核对公开外壳、口令内内容与固定排除项，仅使用示例内容体验浏览器内加密，不复用私人口令。
6. 确认图片/声音入口、完整归档恢复、旧 JSON 导入、删除和清空均不可用；直接写 API 或 `POST /api/archive/restore` 返回 403。
7. 在支持安装的浏览器确认“数据与项目”渐进出现安装入口；断网后只显示离线隐私边界页，重新联网可返回应用，安装前后麦克风和媒体写入均保持关闭。

完整闭环的最终验收应在本地使用可丢弃、无隐私的数据完成：连续编辑一件展品并验证冲突保护、no-op 和旧版追加式恢复；创建事件校准并确认来源变化后进入待复核、两段原日期保持不变；运行只读馆藏体检，以只读方式验真完整与脱敏 `.time-isle`，再把完整归档恢复到另一组临时 `DB_PATH` / `MEDIA_ROOT`。图片、声音、胶囊和离线口令链路仍按既有路径核对。测试后删除临时数据和下载文件，不把测试素材提交到仓库。

## 重复 Vercel 项目

同一 GitHub 仓库如果连接多个 Vercel 项目，每次推送可能重复构建。正式简历链接只保留：

```text
ai-memory-museum-demo
```

其他重复项目应删除或断开 Git 连接，避免浪费构建额度和误用域名。
