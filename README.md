# 时屿（TIME ISLE）V7.3.0

> 本地优先的 AI 私人记忆策展工具

把散落的日记、聊天片段、照片与声音整理成一座可检索、可回顾的私人记忆岛屿；再把用户确认过的展览封存到未来，或生成口令加密、断网可读的单文件。

- Live Demo（V7.1.0）: https://ai-memory-museum-demo.vercel.app
- GitHub: https://github.com/JieE-212/AI_memory_museum
- Demo 状态: https://ai-memory-museum-demo.vercel.app/api/demo/status
- 面试展示: [60 秒路线、90 秒讲解稿与架构图](./项目文档/面试展示手册.md)

> 本地版本状态（2026-07-18）：V7.3.0（schema 11）已完成实现、完整检查与本地提交，真实 HTTP smoke 共 202 条断言；尚未推送、尚未部署，不得视为已发布版本。
>
> 线上发布状态：公开 Demo 仍为 V7.1.0（schema 9）；该版本已于 2026-07-17 完成完整检查、迁移副本核对、本地验收、双远端推送与 Vercel 部署后验收。实际版本以线上 `/api/version` 与 `/api/health` 为准。

当前线上 V7.1 公开 Demo 只使用示例数据和临时 SQLite。它禁止私人图片或声音上传、媒体修改、展览与胶囊持久化、归档恢复、导入、删除与清空；访客新增的文本可能在同一临时实例中被其他访客看到，因此也请勿提交私人信息。Demo 在代码层强制使用本地 Mock，即使环境误配 `AI_API_KEY` 也不会调用外部模型；共享文本、整理运行、时光拼图与补问分别受 SQLite 事务内的固定硬上限保护。

本地 V7.3 的公开 Demo 配置已播种 4 件示例展品和 1 场可分享的已确认展览，便于部署后直接演示三层分享隐私编辑台；这只是公开示例的临时播种，不开放展览、回访意愿、胶囊或媒体持久化，也不改变“禁止输入私人数据”的边界。

## 60 秒看懂

1. 在公开 Demo 的展品库搜索“阿棠”，查看两条毕业记忆及其命中字段、确认实体与短词回退依据。
2. 打开《操场尽头的告别》，沿这段记忆漫游到《后来写下的毕业傍晚》；进入时光拼图，对照双侧原文锚点和一天的日期差异。
3. 在本地 V7.3 的今日回访中，为一件展品明确选择“欢迎主动出现、指定日期以后、暂停主动出现”或恢复自然回访；这些选择只调整主动回访，不推断心理状态。
4. 从已确认展览进入“胶囊与分享”，逐层核对公开外壳、口令内叙事与固定排除项，再生成浏览器端口令加密文件。

公开 Demo 负责稳定展示检索、引用、回访和记忆考古；完整图片、声音、胶囊、离线加密文件与 `.time-isle` 恢复使用虚构数据在本地演示。完整操作和讲解词见 [面试展示手册](./项目文档/面试展示手册.md)。

## 项目解决什么问题

普通笔记适合“写下来”，却不擅长在几年后回答这些问题：

- 哪些记忆和某个人、地点、情绪或画面有关？
- 一段原始叙述可以怎样被整理，而又不覆盖原文？
- 同一往事被多次写下时，哪些线索稳定、哪些只是后来补充？
- 照片里的时间、局部画面和文字怎样成为可核对的线索，而不是自动结论？
- AI 的分类和回答依据了哪些内容？
- 私人文本、图片与声音如何在本地保存、完整迁移，同时提供安全的公开演示？
- 怎样把一段已经核对过的记忆留给未来，或安全地交给一个不登录时屿的人离线阅读？

时屿把这些问题收敛成一条清晰流程：

```text
记录原文、照片与声音 → 浏览器生成安全展示图 → AI 生成可编辑草稿 → 用户确认保存
→ 检索与引用回答 → 主题策展与记忆回访 → 对照原文与多模态证据
→ 用户确认展览 → 封存时间胶囊或生成口令加密的离线单文件
```

<details>
<summary>展开查看 V7.3 架构</summary>

```mermaid
flowchart TB
  U["用户确认"] --> B["响应式浏览器层<br/>四主视图 + 渐进模块"]
  B --> S["Host / Origin / Fetch Metadata"]
  S --> H["同一 Node request handler"]
  H --> D["记忆 · 修订 · 媒体 · 策展 · 胶囊 · 归档"]
  D --> DB[("SQLite")]
  D --> FS[("内容寻址媒体目录")]
  D --> G["明确回访意愿 · 三层分享核对"]
  G --> C["浏览器 Web Crypto"]
  C --> O["口令加密、断网可读 HTML"]
  H -. "INTERVIEW_DEMO" .-> X["临时示例 · 强制 Mock · 写保护"]
```

</details>

页面始终只有“展品库、记录记忆、讲解与回顾、数据与项目”四项顶层导航。主题展览、回访、线索检索、人物档案、语音、胶囊、记忆年轮和馆藏体检均放在已有任务流内，通过折叠层、对话层或独立阅读层渐进呈现。

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

- 完整 `.time-isle` 归档包含馆藏、照片与声音二进制、媒体关联、图片线索、时光拼图、主题展览、回访状态与明确回访意愿、人物档案、时间胶囊和记忆修订；Agent 运行日志当前不在归档内。
- 脱敏 `.time-isle` 会物理排除照片、声音与修订快照，并隐藏原始正文、人物、地点、媒体备注、胶囊私密字段和修订哈希，不只是把前端入口藏起来。
- manifest 会枚举每个数据和图片条目，并记录路径、字节数、MIME 和 SHA-256。恢复时先在隔离暂存区检查 gzip/ustar 结构、路径穿越、链接、重复与大小写碰撞、展开上限、manifest、哈希、真实图片格式、尺寸和所有引用关系。
- 默认导出与恢复共用 500 件展品、2000 个条目、单项 25 MiB、总展开 500 MiB 等硬上限；自定义参数只能收紧，不能生成默认无法恢复的归档。六图上限与 EXIF/GPS 隐私语义同样由 API、数据库、归档和恢复共同执行；EXIF source 只接受拍摄时间、方向和 GPS 三种严格 value 结构，未知类型或额外键会整项拒绝。
- 归档通过全量验真前不会写入正式数据库或媒体目录；损坏归档整批拒绝、零写入。验真通过后，数据库使用单次事务，文件阶段失败会清理已移动目录；同哈希图片只有在隐私策略、全部变体描述和本地文件哈希都一致时才复用。
- 旧 JSON 导入导出继续作为兼容工具，但不携带图片二进制；需要完整迁移影像时应使用 `.time-isle`。

## V7.0.0：时间胶囊与浏览器端加密分享

V7 不增加第五项导航。“胶囊与分享”位于“讲解与回顾”的馆藏回顾区域，只允许从已经发布且无需复核的主题展览开始。

### 封存到未来

- 时间胶囊只快照用户已经确认的展览内容，并把外壳、内容快照和图片关联分开保存；后续修改来源展览不会静默改写已经封存的内容。
- 开启日前，列表和详情只读取标题、寄语、日期、时区等外壳字段。`GET /api/capsules/:id/content` 返回 `423`、错误码和同一份公开外壳，不读取或下发正文、图片、成员列表与内部引用。
- 日期是本地仪式门槛，不是无法绕过的密码学时间锁。到期后可以在本机打开胶囊；若要把内容交给别人，仍应另外生成口令加密文件。

### 单文件、口令加密、断网可读

- 已核验的原文引用随确认展览进入加密内容；安全展示图和已确认文字稿则必须由用户逐项勾选。素材读取完成后才出现口令输入区，此后加密与文件生成不再发起网络请求。
- 浏览器使用 Web Crypto：PBKDF2-SHA-256（310,000 次）派生 256 位密钥，再以 AES-256-GCM 加密；每个文件使用随机 16-byte salt、12-byte IV，并把公开外壳作为 AAD 完整性保护的一部分。
- 口令只存在于当前页面内存，不上传服务端、不持久化，也不写入下载文件。生成的 `.html` 是自包含阅读页，到期后输入正确口令即可在断网环境打开。
- 分享包在生成结构上物理排除原图、EXIF/GPS、草稿文字稿、Agent 整理日志、数据库内部 ID 和所有未勾选内容；图片只允许隐私处理后的 display WebP。首版可以携带已确认声音文字稿，但不携带原始音频二进制。
- 文件没有账号、云端撤回或口令找回能力。发送者应通过另一条安全渠道告知收件人口令，并像对待私人相册一样保管导出文件。

## V7.1：可安装但不缓存私人馆藏

- “数据与项目”中的安装入口默认隐藏，仅在浏览器提供安装能力时渐进显示；iPhone 与 iPad 则显示“添加到主屏幕”指引，页面仍保持四项主导航。
- Service Worker 只缓存离线隐私边界页、该页样式和公开品牌 SVG。断网时明确说明无法读取馆藏，不用空页面伪装数据仍可用。
- 首页、API、图片、声音、归档和任何用户内容均不进入离线缓存；安装应用不会改变公开 Demo 的写入保护，也不会扩大私人数据范围。

## V7.2：记忆年轮与馆藏体检

- 每次创建和真实编辑都会保存规范化快照，以 SHA-256 锚定内容并用父哈希连接成可校验年轮；恢复旧版不会覆盖历史，而是把所选快照追加为新的 `head`。
- 编辑和恢复必须携带 `If-Match`，兼容客户端也可提交 `expectedUpdatedAt`。过期版本返回 `412`，完全相同的保存保持 no-op，不更新时间、不新增修订。
- “数据与项目”新增只读馆藏体检，核对 SQLite、外键、schema、FTS、修订链、图片和声音完整性，并把策展待复核与存储损坏分开呈现；首版只诊断，不自动修复。
- `.time-isle` 可先做只读归档验真，只返回是否可恢复、格式、schema、模式、条目字节数和安全计数，不把内容写入正式馆藏。JSON 与归档都会拒绝高于当前应用的 future schema。
- 完整修订 section 设有 20 MiB UTF-8 JSON 预算，旧 JSON 导入请求上限为 64 MiB；脱敏修订只保留计数摘要，正文、结构化字段、编辑备注、哈希、精确时间和内部 ID 会被物理移除。
- 导出、恢复或验真若因崩溃留下暂存目录，启动与定时维护只清理超过一小时且符合专用命名契约的目录；符号链接父目录和无关文件保持拒绝或跳过。

## V7.3：三层分享隐私编辑台与明确回访意愿

### 分享前先形成一次性的隐私副本

- 安全素材读取完成后，浏览器先形成不会回写来源展览的临时分享副本；章节、展品、已确认引用、已确认声音文字稿和安全 display WebP 默认均不选中，必须逐项选择，未选内容不会进入加密载荷。
- 第一层核对无需口令即可看到的公开外壳：标题、说明和文件名使用通用默认值，固定为立即开启，不自动复制来源展览标题、胶囊标题或导出时间。
- 第二层核对口令内的受众、用途、叙事副本、章节、展品与证据；叙事可为本次分享单独修改，至少保留 1 个章节、1 件展品，以及 1 条已确认引用或文字稿，媒体只保留仍有归属的安全展示图。
- 第三层汇总公开外壳、解密后内容和固定排除边界。用户完成最终勾选后才进入口令步骤；任何再次编辑都会撤销确认并清空已有口令。加密载荷内保存精确计数的分享回执，并明确“下载后无法撤回；知道口令的人仍可以复制、转发或截图”。
- V2 离线载荷严格连续重编号章节、展品和媒体，物理排除内部 ID、URL、SHA、原图、EXIF/GPS、草稿与所有未选内容；既有 V1 加密文件仍可解密阅读。

### 回访只听从用户明确选择

- 每件展品可明确设置“自然回访、欢迎主动出现、指定日期以后、暂停主动出现”。欢迎只在原有回访硬条件内提高顺序；延期在所选本地日期与 IANA 时区到达前排除；暂停会持续排除，直到用户亲自恢复。
- 意愿设置不保存自由文本原因，也不据此推断心情、关系或重要程度；它只影响主动回访，不隐藏、删除或降低馆藏搜索能力。公开 Demo 可展示设置方式，但所有意愿写入继续返回 403。
- schema 11 将非自然回访意愿纳入完整 JSON 与 `.time-isle` 归档，并在恢复时按展品 ID 映射原子迁移；脱敏归档只保留意愿总数与固定说明，物理排除展品 ID、选择、日期和时区。

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
- 主题展览：从用户选择的展品生成带章节、引用和安全媒体的预览，确认后才保存为正式展览。
- 记忆回访：一次呈现一件“往年今日、很久没见或随机漫游”的记忆，并允许用户明确设置欢迎、延期、暂停或恢复自然回访；不用浏览状态或意愿推断用户心理。
- 语义线索检索与人物档案：在原搜索入口解释命中字段和召回原因；未接入 embedding 时不冒充向量检索。
- 语音记忆：保存本地录音、音频文件与人工确认文字稿；公开 Demo 禁止麦克风和音频写入。
- 时间胶囊与离线分享：从已确认展览封存安全快照，或通过三层隐私编辑台生成带加密分享回执的自包含 HTML。
- 面试 Demo：示例数据、临时数据库、破坏性操作保护、媒体写入保护、代码层强制 Mock 和固定资源上限。

## 技术栈

- 前端：Vanilla JavaScript、HTML、CSS、Canvas、Web Crypto；可选浏览器原生 `TextDetector`
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
  database.js                     # SQLite、Agent 轨迹、考古证据、媒体与修订编排
  server.js                       # HTTP 路由、AI 回退、Demo 隔离与归档编排
  lib/
    migrations.js                 # schema 迁移账本与顺序门禁
    archaeology.js                # 可解释关联、时光拼图与单问题算法
    archaeology-backup.js         # 拼图、Claims 与补问的备份/恢复
    demo-safety.js                # Demo 临时路径、清理边界与误配置防护
    request-security.js            # Host、Origin 与 Fetch Metadata 请求边界
    revision-*.js                 # SHA-256 父链、并发条件、历史恢复与备份
    revisit-intent-database.js    # schema 11 明确回访意愿与归档合同
    collection-health*.js         # 只读数据库、图片、声音与待复核体检
    archive-inspection-api.js     # 不恢复数据的 .time-isle 全量验真
    archive-staging.js            # 崩溃遗留归档暂存的边界化清扫
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
    capsule-service.js            # 胶囊安全快照、到期判定与隐私约束
    capsule-database.js           # 胶囊外壳、内容与媒体关联的分表持久化
    capsule-api.js                # 胶囊外壳、创建、开启和 Demo 保护接口
    offline-exhibit-api.js        # 候选素材和加密前材料读取接口
    demo-seed.js                  # 四件公开示例与一场已确认展览的确定性播种
  public/
    index.html                    # 四个主视图与渐进披露入口
    styles.css                    # 全局响应式界面
    revisions.css                 # 记忆年轮对话层
    collection-health.css         # 馆藏体检与归档验真面板
    archaeology.css              # 记忆航线与拼图样式
    capsules.css                  # 胶囊书架、素材选择与口令步骤样式
    share-privacy.css             # 三层分享隐私编辑台样式
    revisit-intents.css           # 明确回访意愿与管理区样式
    media*.css                    # 图片、证据、叠影、OCR 与线索实验室样式
    assets/
      app.js                      # 前端状态、交互与核心 API 调用
      revisions.js                # 历史版本查看、比较与恢复
      collection-health.js        # 体检进度、结果和只读归档验真
      media.js                    # 图片选择、派生图、上传和详情图库
      media-intelligence.js       # EXIF 呈现与浏览器指纹采样
      media-evidence.js           # 图片区域圈选与证据列表
      media-compare.js            # 手动两点叠影
      media-ocr.js                # 本机 TextDetector / 手动文字摘录
      media-lab.js                # 近似候选与文字摘录入口
      portability.js              # .time-isle 导出与恢复
      capsules.js                 # 胶囊、素材选择、匿名载荷组装与离线文件交互
      capsule-crypto.js           # 浏览器端 PBKDF2 + AES-GCM 与自包含阅读页
      share-privacy.js            # 一次性分享副本、最小投影与分享回执
      revisit-intents.js          # 用户明确回访意愿交互与长期设置管理
  scripts/
    check-all.js                  # 统一编排语法、规则与 HTTP 回归
    api-smoke.js                  # 本地真实 HTTP 端到端断言
    demo-safety-check.js          # Demo 删除路径的 fail-closed 回归
    request-security-check.js      # DNS rebinding 与同源写入回归
    media-api-check.js            # 隔离恢复、墓碑清理与事务补偿回归
    archaeology-check.js          # 引用合法性与考古规则回归
    media-*-check.js              # 媒体格式、存储、证据、智能与恢复回归
    archive-check.js              # 严格归档攻击面回归
    capsule-*-check.js            # 胶囊服务、数据库、API 与前端回归
    offline-exhibit-check.js      # 真实安全快照、隐私投影、加密与离线阅读页回归
    revisit-intent*-check.js      # 明确回访意愿的服务端与浏览器回归
  项目文档/
    产品说明.md
    技术设计.md
    V5-V7扩展路线.md
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
- `POST /api/memories`、`PUT /api/memories/:id`、`DELETE /api/memories/:id`：保存、编辑和删除展品；编辑必须携带 `If-Match` 或 `expectedUpdatedAt`。
- `GET /api/revisions`、`GET /api/memories/:id/revisions`：读取最近修订或单件展品的记忆年轮；单版详情与追加式恢复使用 `/:revisionId` 及其 `/restore` 子路径。
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

展览、胶囊与离线分享：

- `GET /api/exhibitions?status=published`：列出已经确认、可以作为胶囊或分享来源的主题展览。
- `GET|POST /api/capsules`、`GET|DELETE /api/capsules/:id`：读取公开外壳，或从已确认展览创建和删除本地胶囊；公开 Demo 不持久化胶囊。
- `GET /api/capsules/:id/content`：仅在本地开启日到达后返回安全快照；未到期固定返回 `423` 和公开外壳。
- `GET /api/offline-exhibits/candidates?exhibitionId=...`：只列出来源展览内可选的 display WebP 与已确认文字稿。
- `POST /api/offline-exhibits/material`：读取用户明确选择的安全材料，供浏览器随后离线加密；请求体不包含口令。

记忆考古与迁移：

- `GET /api/archaeology/routes?focus=展品ID`：生成焦点航线或今日航线。
- `GET /api/archaeology/puzzle?memoryId=A&relatedId=B`：返回原文锚点、图片区域证据和可手动叠影的两侧图片。
- `POST /api/archaeology/events`、`DELETE /api/archaeology/events/:id`：用户确认关联或解除版本组，原文继续保留。
- `POST /api/archaeology/questions`：保存补充回答、跳过或“保留不确定”。
- `GET /api/archive/export`：下载完整 `.time-isle`；`?mode=redacted` 下载物理排除私人媒体与胶囊私密字段的脱敏归档。
- `POST /api/archive/inspect`：只读验真 `.time-isle` 并返回安全摘要，不恢复正式数据。
- `POST /api/archive/restore`：上传 `.time-isle`，全量验真后原子恢复；公开 Demo 返回 403。
- `POST /api/collection-health/scans`、`GET|DELETE /api/collection-health/scans/:id`：启动、读取或取消一次本地只读馆藏体检。
- `GET /api/memories/export`、`POST /api/memories/import`：不含图片二进制的旧 JSON 兼容工具；导入请求上限为 64 MiB。

## 检查

```powershell
npm.cmd run build   # 语法与模块回归，不启动 HTTP smoke
npm.cmd run smoke   # 202 条本地真实 HTTP 端到端断言
npm.cmd run check   # 上述全部检查
```

`npm.cmd test` 等价于 `npm.cmd run check`。检查数据使用系统临时目录，并在结束时清理，不会写入正式馆藏。

V7.3 当前关键回归计数：

- 真实 HTTP smoke：202 条。
- 明确回访意愿：服务端 80 条，浏览器 UI 40 条。
- 离线展览与三层隐私分享：174 条；胶囊 UI：142 条。
- JSON 馆藏导入：109 条；媒体归档备份：191 条；媒体归档恢复：118 条。
- 前端结构与可访问性：96 项；PWA 隐私边界：79 条。

真实 HTTP smoke 覆盖静态页面与安全头、DNS rebinding Host 拒绝、同源写入、Mock 整理、展品 CRUD、修订父链与并发冲突、检索与讲解、图片和语音链路、主题展览、回访及明确意愿、语义线索、胶囊锁定、馆藏体检、只读归档验真、future schema 拒绝、`.time-isle` 完整恢复与损坏零写入，以及公开 Demo 的强制 Mock、1 场已确认展览播种、容量上限和禁写边界。完整回归还覆盖格式与存储事务、迁移、严格脱敏、20 MiB 修订预算、64 MiB JSON 导入、崩溃暂存清扫、前端结构、三层分享隐私投影、浏览器端加密信封和自包含阅读页。

## 设计边界

- 本地 HTTP 服务只接受 `127.0.0.1`、`localhost` 和 `[::1]`（可带 1–65535 端口）；部署模式只接受平台注入域名和 `ALLOWED_HOSTS` 中的精确主机。`POST / PUT / PATCH / DELETE` 还必须带与 Host 精确同源的 `Origin`；浏览器提供 `Sec-Fetch-Site` 时只接受 `same-origin`。
- AI 建议先形成草稿；EXIF 只保存为 `suggested` 线索；OCR 摘录必须由用户核对确认；近似图片只返回候选且不触发合并或删除。四类结果不会混成“系统已确认”的事实。
- 原始记忆与展品说明分开保存，避免 AI 改写覆盖事实来源。
- 讲解员只接收检索结果作为上下文，并把同批来源交给用户核对；真实模型回答尚未做逐句引用一致性评测。
- 航线、近似照片和手动叠影永远只是核对辅助；系统不会自动宣称两段记录或两张照片属于同一事件。
- 缺失信息不等于矛盾，只有两侧都有可校验来源时才展示“描述不同”。
- 同一往事的多个版本分别保存，确认关联也不会覆盖任何原文。
- 编辑原文时会重新校验已保存的字段证据；失效摘录不会继续标记为已核验。
- 记忆年轮用于发现本机历史被意外改写，并不等同于外部时间戳、公证账本或多用户审计；旧版恢复始终追加新 head，不倒退或删除已有链条。
- 馆藏体检与归档验真首版只给出可核对诊断，不自动修复、删除或恢复数据。
- 本地媒体能力使用文件系统，不是云对象存储。公开 Vercel Demo 明确禁止媒体写入和归档恢复，也不部署私人 SQLite 或真实 AI Key。
- 时间胶囊的本地日期只控制产品仪式；真正的分享保密来自浏览器端加密。离线文件一旦交付，当前没有账号撤回、口令找回或远程失效能力。
- 当前适合个人本地使用和面试演示；多用户认证、跨设备同步、云端持久数据库与云媒体存储不在 V7.3.0 范围内。

更多说明见 [产品说明](./项目文档/产品说明.md) 和 [技术设计](./项目文档/技术设计.md)。部署步骤见 [DEPLOYMENT.md](./DEPLOYMENT.md)。
