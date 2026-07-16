# 时屿（TIME ISLE）V4.0.0

> 本地优先的 AI 私人记忆策展工具

把散落的日记、聊天片段和照片整理成一座可检索、可回顾，也能保留不同记忆版本与证据来源的私人记忆岛屿。

- Live Demo（V4.0.0）: https://ai-memory-museum-demo.vercel.app
- GitHub: https://github.com/JieE-212/AI_memory_museum
- Demo 状态: https://ai-memory-museum-demo.vercel.app/api/demo/status

> 发布状态（2026-07-13）：V4.0.0（schema 4）已同步至 GitHub 与 Gitee，并部署到上方 Vercel 公开 Demo；`/api/health` 已核验 `version: 4.0.0`、`schemaVersion: 4`、`mode: interview-demo`、`storage: ephemeral-sqlite` 和 `aiMode: mock-fallback`。

V4 公开 Demo 只使用示例数据和临时 SQLite。它禁止私人图片上传、媒体修改、归档恢复、导入、删除与清空；访客新增的文本可能在同一临时实例中被其他访客看到，因此也请勿提交私人信息。Demo 在代码层强制使用本地 Mock，即使环境误配 `AI_API_KEY` 也不会调用外部模型；共享文本、整理运行、时光拼图与补问分别受 SQLite 事务内的固定硬上限保护。

## 项目解决什么问题

普通笔记适合“写下来”，却不擅长在几年后回答这些问题：

- 哪些记忆和某个人、地点、情绪或画面有关？
- 一段原始叙述可以怎样被整理，而又不覆盖原文？
- 同一往事被多次写下时，哪些线索稳定、哪些只是后来补充？
- 照片里的时间、局部画面和文字怎样成为可核对的线索，而不是自动结论？
- AI 的分类和回答依据了哪些内容？
- 私人文本与图片如何在本地保存、完整迁移，同时提供安全的公开演示？

时屿把这些问题收敛成一条清晰流程：

```text
记录原文与照片 → 浏览器生成安全展示图 → AI 生成可编辑草稿 → 用户确认保存
→ 检索与引用回答 → 沿记忆航线发现关联 → 对照原文与图片证据
→ 用户决定是否关联、补充或继续保留不确定
```

## V4.0.0：影像记忆

### 本地图片归档

- 在现有“记录记忆”流程内添加 JPEG、PNG 或 WebP；每段记忆最多 6 张，单张原图默认上限 20 MB、4000 万像素。
- 浏览器通过 Canvas 生成最长边 1600 px 的静态 WebP 展示图和最长边 480 px 的缩略图，服务端再核对真实魔数、容器、尺寸、像素量与声明 MIME，不信任文件扩展名。
- 默认“仅保留安全展示图”：上传暂存原图只用于校验和提取允许的线索，完成后删除，只保存展示图与缩略图。
- 可显式选择“保留原图”：本机同时保存原图、展示图和缩略图；原图接口使用 `private, no-store`。
- 照片可设置封面、排序、说明、独立无障碍文字、拍摄时间和“照片背面”；无障碍文字留空时才以照片说明后备，卡片与详情始终使用安全展示版本。

### 内容寻址、复用与回收

- 图片资产以 SHA-256 内容哈希识别；保留原图时锚定原图，仅保留安全展示图时锚定规范展示图。
- 精确重复内容只有在既有全部变体重新通过磁盘大小与 SHA-256 校验后才会复用，而不是盲目丢弃新的健康上传；校验、刷新关联宽限期和丢弃上传处于同一媒体独占操作内。图片和展品使用多对多关联，同一张图片可被不同记忆引用。
- 仍被展品引用的图片不能直接删除；解除最后一个引用会立即隔离回收，删除展品和启动清理只处理已超过 24 小时宽限期的无引用 ready 资产，避免并发删除刚上传但尚未保存展品的图片。清空馆藏采用“先隔离文件、再提交数据库、最后物理删除”，失败可回滚；完整 purge、归档读写、上传完成、stale-stage 清理、隔离协调与 GC 共享同一进程内 FIFO，维护任务也采用 single-flight。启动时立即、运行中每 5 分钟协调 `.trash`，并扫描回收没有数据库记录的正式 `assets` 目录。

### 克制的图片线索

- EXIF 仅作为待确认线索。目前严格读取 JPEG APP1/Exif 中的拍摄时间、时区偏移、方向和 GPS；没有时区的时间保持本地 floating 值，不会擅自追加 `Z` 或覆盖记忆日期。
- GPS 始终标记为敏感信息，不联网反查地点，也不会自动写入展品地点；“仅保留安全展示图”不会保留敏感 EXIF 观察值。
- 用户可在照片上圈选区域，保存规范化 `x / y / width / height`、简短说明和来源图片 SHA-256。几何完整性与用户对语义的确认分开记录，时光拼图可以回到这块图片区域。
- 浏览器从规范展示图生成确定性的 9×8 采样，服务端计算 dHash、宽高比、颜色和低方差门槛。结果只叫“可能相似 · 需人工核对”，绝不自动合并、删除或认定为同一事件。
- 照片文字摘录优先使用浏览器本机 `TextDetector`，只处理用户圈选区域，不上传第三方；该能力不可用或识别失败时明确切换为手动摘录。任何结果都只是可编辑草稿，必须由用户核对确认后才保存为区域证据，不会自动改写展品正文。
- “时光叠影”由用户在左右图片各标两个对应点，浏览器本地计算缩放、旋转和平移并提供透明度调节、撤销与重置。它是手动两点对齐，不是自动识别，也不输出事件结论。

### 可验证的完整迁移

- 完整 `.time-isle` 归档包含馆藏、照片二进制、图片关联、图片线索与时光拼图；Agent 运行日志当前不在归档内。
- 脱敏 `.time-isle` 会物理排除照片文件，并隐藏原始正文、人物、地点和媒体备注，不只是把前端入口藏起来。
- manifest 会枚举每个数据和图片条目，并记录路径、字节数、MIME 和 SHA-256。恢复时先在隔离暂存区检查 gzip/ustar 结构、路径穿越、链接、重复与大小写碰撞、展开上限、manifest、哈希、真实图片格式、尺寸和所有引用关系。
- 默认导出与恢复共用 500 件展品、2000 个条目、单项 25 MiB、总展开 500 MiB 等硬上限；自定义参数只能收紧，不能生成默认无法恢复的归档。六图上限与 EXIF/GPS 隐私语义同样由 API、数据库、归档和恢复共同执行；EXIF source 只接受拍摄时间、方向和 GPS 三种严格 value 结构，未知类型或额外键会整项拒绝。
- 归档通过全量验真前不会写入正式数据库或媒体目录；损坏归档整批拒绝、零写入。验真通过后，数据库使用单次事务，文件阶段失败会清理已移动目录；同哈希图片只有在隐私策略、全部变体描述和本地文件哈希都一致时才复用。
- 旧 JSON 导入导出继续作为兼容工具，但不携带图片二进制；需要完整迁移影像时应使用 `.time-isle`。

## 其他核心功能

- 记忆整理：从原始文本生成标题、展厅、标签、人物、情绪和展品说明。
- 可追踪整理流程：将一次模型调用（无 Key 时为本地规则）组织为档案提取、策展标注和草稿生成三个阶段，保存 run、step 与 event 处理快照。
- SQLite 馆藏：记忆、标签、人物、情绪、Agent run、媒体资产、媒体关联与图片观察均在本地持久化。
- 混合检索：综合匹配标题、正文、人物、地点、标签和情绪，并返回命中原因、置信提示及对应展品的照片摘要。
- 引用式讲解：将 Top-K 检索展品作为回答上下文，并展示同批来源、命中字段与规则强度；当前不声称完成真实模型输出的逐句引用校验。
- 记忆航线：基于人物、地点、日期、标签、情绪和原文关键词发现少量关联，并解释为什么相连。
- 时光拼图：比较同一往事的多个候选版本，区分稳定锚点、描述差异、单侧补充和未知项；文字与图片证据都可回到来源。
- 补一块拼图：一次只提出一个最值得补充的问题，允许回答、跳过或明确保留不确定。
- 馆藏回顾：按时间聚合展品，发现共同主题，并生成简短回顾摘要。
- 面试 Demo：示例数据、临时数据库、破坏性操作保护、媒体写入保护、代码层强制 Mock 和固定资源上限。

## 技术栈

- 前端：Vanilla JavaScript、HTML、CSS、Canvas；可选浏览器原生 `TextDetector`
- 后端：Node.js 原生 HTTP Server
- 数据库：Node.js 内置 `node:sqlite`
- 图片存储：本地文件系统、SHA-256 内容寻址、JPEG / PNG / WebP 严格校验
- 归档：无额外依赖的 gzip + POSIX ustar `.time-isle`
- 部署：Vercel Functions + 静态资源（仅公开、临时、禁媒体写入的 Demo）
- AI：OpenAI-compatible Chat Completions；无 Key 时使用本地规则回退

项目刻意不引入前端框架、ORM 和额外运行依赖，让数据流、隐私边界与恢复事务更容易阅读和讲解。

## 项目结构

```text
项目工程/
  api/index.js                    # Vercel API 入口
  database.js                     # SQLite、Agent 轨迹、考古证据与媒体表
  server.js                       # HTTP 路由、AI 回退、Demo 隔离与归档编排
  lib/
    archaeology.js                # 可解释关联、时光拼图与单问题算法
    archaeology-backup.js         # 拼图、Claims 与补问的备份/恢复
    demo-safety.js                # Demo 临时路径、清理边界与误配置防护
    request-security.js            # Host、Origin 与 Fetch Metadata 请求边界
    media-format.js               # 图片魔数、容器、尺寸与像素边界校验
    media-storage.js              # 暂存、内容寻址变体、隔离删除与清理
    media-database.js             # 资产、变体、关联与观察的数据访问层
    media-api.js                  # 上传、展示、关联、区域、指纹和 GC 接口
    media-evidence.js             # 规范化图片区域证据与来源哈希锚点
    exif-hints.js                 # 严格 EXIF 待确认线索解析
    media-similarity.js           # 确定性 dHash 与近似候选分类
    time-isle-archive.js          # 严格 gzip/ustar 创建和解包
    media-backup.js               # .time-isle manifest、导出与全量验真
    media-restore.js              # ID 映射、事务恢复与文件补偿
  public/
    index.html                    # 四个主视图与渐进披露入口
    styles.css                    # 全局响应式界面
    archaeology.css              # 记忆航线与拼图样式
    media*.css                    # 图片、证据、叠影、OCR 与线索实验室样式
    assets/
      app.js                      # 前端状态、交互与核心 API 调用
      media.js                    # 图片选择、派生图、上传和详情图库
      media-intelligence.js       # EXIF 呈现与浏览器指纹采样
      media-evidence.js           # 图片区域圈选与证据列表
      media-compare.js            # 手动两点叠影
      media-ocr.js                # 本机 TextDetector / 手动文字摘录
      media-lab.js                # 近似候选与文字摘录入口
      portability.js              # .time-isle 导出与恢复
  scripts/
    check-all.js                  # 统一编排语法、规则与 HTTP 回归
    api-smoke.js                  # 104 条真实 HTTP 断言
    demo-safety-check.js          # Demo 删除路径的 fail-closed 回归
    request-security-check.js      # DNS rebinding 与同源写入回归
    media-api-check.js            # 隔离恢复、墓碑清理与事务补偿回归
    archaeology-check.js          # 引用合法性与考古规则回归
    media-*-check.js              # 媒体格式、存储、证据、智能与恢复回归
    archive-check.js              # 严格归档攻击面回归
  项目文档/
    产品说明.md
    技术设计.md
```

## 本地运行

要求 Node.js 24 或更高版本。

```powershell
npm.cmd start
```

打开 `http://127.0.0.1:3000`。默认数据位置：

```text
data/memory-museum.sqlite
data/media/
```

指定其他端口、数据库或媒体目录：

```powershell
$env:PORT = "3001"
$env:DB_PATH = "C:\path\to\memory-museum.sqlite"
$env:MEDIA_ROOT = "C:\path\to\memory-media"
npm.cmd start
```

本文在 Windows PowerShell 中使用 `npm.cmd`，可避开系统将 `npm` 解析为受执行策略限制的 `npm.ps1`；macOS、Linux 或 Vercel 构建命令直接使用 `npm` 即可。

## AI 配置

复制 `.env.example` 为 `.env`：

```text
AI_BASE_URL=https://api.openai.com/v1
AI_MODEL=gpt-4.1-mini
AI_API_KEY=your-key
AI_TIMEOUT_MS=20000
```

`AI_API_KEY` 留空时，记录整理和讲解员仍可工作，只是由本地规则生成结果。图片格式校验、EXIF、指纹、相似候选、区域证据、手动叠影和本机文字摘录都不依赖该 Key。

`INTERVIEW_DEMO=true` 时始终强制使用 Mock，配置的 `AI_API_KEY` 会被忽略；真实模型只允许在非 Demo 的受控本地环境使用。公开 Demo 对共享文本馆藏、整理运行、时光拼图和补问分别设置事务硬上限；检查与写入在同一 SQLite 事务内，达到上限后返回 429，避免并发匿名请求突破边界。

## 常用接口

馆藏与策展：

- `GET /api/health`、`GET /api/version`：版本、模式、AI 状态和馆藏统计。
- `GET /api/demo/status`、`GET /api/privacy`：Demo 限制和数据位置说明。
- `GET /api/options`：展厅选项、文本限制与当前媒体策略。
- `GET /api/memories`、`GET /api/memories/:id`：读取带照片摘要或完整照片列表的馆藏。
- `POST /api/analyze`：生成展品草稿和三阶段处理轨迹。
- `POST /api/memories`、`PUT /api/memories/:id`、`DELETE /api/memories/:id`：保存、编辑和删除展品。
- `GET /api/search?query=关键词&mode=hybrid`：带命中依据的混合检索。
- `POST /api/guide`：基于引用展品回答问题。
- `GET /api/insights`：时间线、主题和回顾摘要。

图片与线索：

- `POST /api/media/uploads` → `PUT /api/media/uploads/:uploadId/display|thumb` → `POST /api/media/uploads/:uploadId/complete`：原图校验、派生图写入和内容寻址完成流程。
- `GET|HEAD /api/media/:assetId/thumb|display|original`：按图片保留策略读取已有变体。
- `GET|POST|PUT /api/memories/:memoryId/media`：列出、关联或整体更新展品图片；单项编辑与解除关联使用 `PUT|DELETE /api/memories/:memoryId/media/:assetId`。
- `GET|POST /api/memories/:memoryId/media/:assetId/annotations`：读取或创建图片区域证据；单项更新、删除使用其 `/:annotationId` 子路径上的 `PUT|DELETE`。
- `GET|POST /api/media/assets/:assetId/fingerprint`：读取或生成规范展示图指纹。
- `GET /api/media/assets/:assetId/similar?limit=8`：返回只供人工复核的可能相似候选。
- `GET /api/media/usage`：统计被馆藏引用的媒体与变体用量。

记忆考古与迁移：

- `GET /api/archaeology/routes?focus=展品ID`：生成焦点航线或今日航线。
- `GET /api/archaeology/puzzle?memoryId=A&relatedId=B`：返回原文锚点、图片区域证据和可手动叠影的两侧图片。
- `POST /api/archaeology/events`、`DELETE /api/archaeology/events/:id`：用户确认关联或解除版本组，原文继续保留。
- `POST /api/archaeology/questions`：保存补充回答、跳过或“保留不确定”。
- `GET /api/archive/export`：下载完整 `.time-isle`；`?mode=redacted` 下载物理排除照片的脱敏归档。
- `POST /api/archive/restore`：上传 `.time-isle`，全量验真后原子恢复；公开 Demo 返回 403。
- `GET /api/memories/export`、`POST /api/memories/import`：不含图片二进制的旧 JSON 兼容工具。

## 检查

```powershell
npm.cmd run build   # 语法与模块回归，不启动 HTTP smoke
npm.cmd run smoke   # 104 条本地真实 HTTP 断言
npm.cmd run check   # 上述全部检查
```

`npm.cmd test` 等价于 `npm.cmd run check`。检查数据使用系统临时目录，并在结束时清理，不会写入正式馆藏。

当前 104 条 HTTP 断言覆盖静态页面与安全头、DNS rebinding Host 拒绝、同源写入、Mock 整理、Agent 工作流、展品 CRUD、混合检索、讲解来源、记忆航线、原文证据、时光拼图、图片上传与真实格式拒绝、未关联媒体宽限期、派生图、精确去重、前端真实 `position` 批量关联契约、无效关联零写入与 GC、区域证据、dHash 近似候选、`.time-isle` 完整恢复与损坏零写入，以及公开 Demo 的强制 Mock、容量上限、媒体写入和归档恢复保护。除此之外，独立脚本继续覆盖 Demo 删除路径、Host / Origin / Fetch Metadata 边界、归档攻击面、JPEG EOI 尾随载荷、图片容器边界、隔离恢复与存储事务补偿、无效 EXIF、相似度数学、手动叠影、OCR 降级和前端可访问结构。

## 设计边界

- 本地 HTTP 服务只接受 `127.0.0.1`、`localhost` 和 `[::1]`（可带 1–65535 端口）；部署模式只接受平台注入域名和 `ALLOWED_HOSTS` 中的精确主机。`POST / PUT / PATCH / DELETE` 还必须带与 Host 精确同源的 `Origin`；浏览器提供 `Sec-Fetch-Site` 时只接受 `same-origin`。
- AI 建议先形成草稿；EXIF 只保存为 `suggested` 线索；OCR 摘录必须由用户核对确认；近似图片只返回候选且不触发合并或删除。四类结果不会混成“系统已确认”的事实。
- 原始记忆与展品说明分开保存，避免 AI 改写覆盖事实来源。
- 讲解员只接收检索结果作为上下文，并把同批来源交给用户核对；真实模型回答尚未做逐句引用一致性评测。
- 航线、近似照片和手动叠影永远只是核对辅助；系统不会自动宣称两段记录或两张照片属于同一事件。
- 缺失信息不等于矛盾，只有两侧都有可校验来源时才展示“描述不同”。
- 同一往事的多个版本分别保存，确认关联也不会覆盖任何原文。
- 编辑原文时会重新校验已保存的字段证据；失效摘录不会继续标记为已核验。
- 本地媒体能力使用文件系统，不是云对象存储。公开 Vercel Demo 明确禁止媒体写入和归档恢复，也不部署私人 SQLite 或真实 AI Key。
- 当前适合个人本地使用和面试演示；多用户认证、跨设备同步、云端持久数据库与云媒体存储不在 V4.0.0 范围内。

更多说明见 [产品说明](./项目文档/产品说明.md) 和 [技术设计](./项目文档/技术设计.md)。部署步骤见 [DEPLOYMENT.md](./DEPLOYMENT.md)。
