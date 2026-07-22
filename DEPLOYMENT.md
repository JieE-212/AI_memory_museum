# 时屿（TIME ISLE）V17.0.0 发布说明

线上 Demo（当前均为 V17.0.0）：

```text
国内唤醒入口（CloudBase 静态托管）：https://shiyu-memory-demo-d3di282387d5c7-1456049152.tcloudbaseapp.com
CloudBase 应用直连（诊断备用）：https://shiyu-memory-demo-d3di282387d5c7-1456049152.ap-shanghai.app.tcloudbase.com
全球备用（Vercel）：https://ai-memory-museum-demo.vercel.app
```

腾讯云 Lighthouse 香港镜像的本地部署资产与安全交接见 [`deploy/tencent/README.md`](./deploy/tencent/README.md)。该镜像当前仍处于本地准备阶段，只有购买服务器、绑定 HTTPS 域名并完成真机与生产接口验收后，才能标记为已发布；现有 CloudBase 国内入口与 Vercel 全球备用入口不依赖该方案。

腾讯云 CloudBase 云托管的受限公开 Demo 配置见 [`deploy/cloudbase/README.md`](./deploy/cloudbase/README.md)。服务 `time-isle-demo` 的部署 `002` 于 2026-07-22 12:39:01 从 Gitee `main@38d3450` 构建并发布，状态正常并承接 100% 流量；桌面公网 UI、版本/健康/Demo/记忆、设备语义、多视角、隔离恢复禁写与静态模型资产均已验收为 V17。实例固定为 `0–1` 个、规格为 `0.5` 核 / `1 GiB`，SQLite 与媒体仅写 `/tmp`，无持久卷或 API Key 注入。独立静态应用 `time-isle-wakeup-002` 已把 4 个本地审核文件部署到静态根路径 `/`；入口点击后有限唤醒云托管，不改变实例数量、付费、路由、Host 或数据边界。V17 手机真机与临时内容消失仍待单独复核。

V17.0.0（schema 19）已于 2026-07-22 发布：本地 `npm.cmd run build`、`npm.cmd run check`、272 条真实 HTTP smoke、21/21 项 Playwright 三档门禁与桌面、390×844、320×700 真实浏览器验收均已通过；功能提交 `413f78640baad7eae6324ef14bc291f05325fbf6` 与热修复 `38d3450b9f26efdc59df4860317cdf9513e77e65` 已进入 GitHub、Gitee `main`，并完成 Vercel 与 CloudBase 生产部署。随后完成的国内入口可用性加固把三档浏览器门禁扩展为 24/24，并新增 24 项静态唤醒合同断言。

本文保留 V7.1.0（schema 9）、V10.0.0（schema 14）与 V14.0.0（schema 19）作为历史发布阶段，V17.0.0 是当前发布。V10 于 2026-07-19、V14 于 2026-07-20 分别完成当时的发布闭环；实际部署状态始终以线上 `/api/version` 与 `/api/health` 返回值为准。

V10.0.0（schema 14）历史基线已完成受限本地策展助手及其审计/恢复边界，最终代码提交为 `7107ede`；`npm.cmd run build`、`npm.cmd run check` 全绿，HTTP smoke 249 条；策展 core 131、归档 98、界面 51、数据库健康 42、馆藏体检 83、Demo 安全 19、前端 109、JSON 导入 160、归档验真 42、媒体备份 312/恢复 189 条专项断言均已通过。1265×720、390×844、320×700 的浏览器 DOM 与真实交互验收也已通过，并非仅凭截图判断。生产接口曾核验 `10.0.0 / schema 14 / interview-demo / ephemeral-sqlite`。

V17 PWA 是公开、临时、只用于面试演示的受保护 Demo：安装到设备不会开放麦克风、媒体写入或私人内容持久化。它不接收私人图片或声音，不保存展览、回访、实体变更或时间胶囊，也不允许完整 `.time-isle` 上传或一次性隔离恢复。完整媒体保存、胶囊封存和归档恢复应在具有持久磁盘的本地 Node.js 环境体验；浏览器端加密流程可以使用公开示例预览，但不要输入私人内容。

当前线上 V17 沿用 4 件示例展品、1 场可分享的已确认展览、1 个确认事件和 1 项“保留多种记录”时间校准；符合条件时可只读展示口述史问题与已有来源，并新增合成多视角对照和用户主动加载的设备内“按意思找回”。策展助手只通过 `GET /api/curator-agent/sample` 合成工作区，零持久化；设备内镜片只对合成或播种来源生成确定性只读预览。数据仍位于临时 SQLite；公开 Demo 不请求麦克风、不打开音频文件选择，并在正文前阻止共忆保存、锁馆切换、结构演练和隔离恢复上传，以及口述史、展览、回访意愿、时间校准、胶囊和媒体持久化。

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

`npm run build` 会执行语法检查和各模块回归，但不会启动真实 HTTP smoke；本轮推送前的 `npm.cmd run check` 已全绿。若提交前代码继续变化，必须重新运行完整检查。

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

## 当前 V17 Demo 安全行为

`INTERVIEW_DEMO=true` 时：

- SQLite 位于 Vercel `/tmp`，媒体根目录也位于独立的 `/tmp` 临时目录；冷启动会恢复四件示例展品，不承诺保存访客新增文本。
- Demo 在代码层始终强制 Mock，误配的 `AI_API_KEY` 不会被使用。
- 共享文本馆藏、整理运行、时光拼图与补问分别受 SQLite 事务硬上限保护；并发请求也不能越过上限，达到后返回 429。
- 所有媒体写操作返回 403，包括原图上传、展示图和缩略图写入、完成上传、图片关联、区域证据、指纹生成与图片删除。
- 所有声音上传、关联和文字稿写入返回 403；麦克风权限策略固定关闭。
- 实体别名/合并、展览保存、回访浏览状态和时间胶囊持久化均返回 403；无写入的主题展览预览与浏览器内加密仍可演示。
- `.time-isle` 归档恢复、V15 一次性隔离恢复和旧 JSON 导入返回 403，并在隔离恢复路由读取正文前返回 `ISOLATED_RECOVERY_DEMO_READ_ONLY / bodyBytesRead: 0`；完整或脱敏导出仍只导出当前临时实例中的公开数据。
- 删除展品、解除关系、清空数据库和改写预置展品均受保护。
- 页面显示“公开面试 Demo”提示，并禁用图片选择、完整备份恢复与真实隔离恢复上传入口。
- 不会把私人 SQLite 或本机媒体目录打包到部署产物，也不会把图片发送给 AI 服务。

访客仍可能在共享临时实例中新增普通文本，所以页面提示中的“请勿提交私人内容”也适用于文字。

## 为什么 Vercel 不承载私人图片、声音与胶囊

V7 的图片、声音与胶囊层使用本地文件系统、SHA-256 内容寻址和 SQLite 引用关系。Vercel Functions 的临时文件系统不提供这类私人数据所需的持久性，因此：

- 公开 Demo 明确关闭媒体写入，而不是假装已经持久保存。
- 不要仅把 `INTERVIEW_DEMO` 改为 `false` 就当作私人生产部署；实例重建后 SQLite 和图片都可能丢失。
- 私人或长期部署应使用 Node.js 24+ 和持久磁盘，同时持久化 `DB_PATH` 与 `MEDIA_ROOT`，并定期下载完整 `.time-isle`。
- 若未来接入云数据库或对象存储，需要额外实现身份认证、租户隔离、访问控制、密钥管理和存储驱动；这些不在 V17.0.0 范围内。

本地持久配置示例：

```powershell
$env:DB_PATH = "D:\time-isle\memory-museum.sqlite"
$env:MEDIA_ROOT = "D:\time-isle\media"
npm.cmd start
```

默认本地路径分别为 `data/memory-museum.sqlite`、`data/media/` 和 `data/media/voice/`。V17 schema 19 完整 `.time-isle` 延续 V14 加入的 `inbox/state.json`、`provenance/state.json`、`co-memory/responses.json`；恢复会先建立收件箱/共忆记录，再建立依赖它们的 provenance 引用，任何 ID、哈希、绑定或引用冲突都会在正式写入前整批拒绝。V16 多视角仍为只读派生 DTO，V17 embedding 仍为 Worker 会话内存，二者不增加归档 section。脱敏共忆 section 只保留响应、未验证身份、加密传输和未签名计数，物理排除问答、ID 与哈希。

锁状态与 recovery verifier 不属于普通馆藏可迁移数据：完整或脱敏 JSON、`.time-isle` 都不会携带锁状态、盐、digest 或 verifier。馆外信笺文件虽然经过浏览器端加密，但确认入馆后的问答仍以普通明文结构保存在本机 SQLite；锁馆也只阻止经应用发起的新写请求，不会加密 SQLite、图片、声音或磁盘。

## 发布前检查

Windows PowerShell 使用 `npm.cmd`，可以避免 `npm.ps1` 被系统执行策略拦截；Vercel 的 Linux 构建命令继续使用 `npm`。

```powershell
npm.cmd run build
npm.cmd run smoke
npm.cmd run check
```

- `build`：语法检查和各独立回归，不运行 HTTP smoke。
- `smoke`：在系统临时目录启动本地服务；V17 当前发布基线为 272 条，V14/V10 的 262/249 条保留为历史基线。
- `check`：依次执行全部语法、独立回归和 HTTP smoke；`npm.cmd test` 与它等价。

V14 历史发布回归除既有媒体、口述史、策展、分享、修订、来源校准和归档链路外，还覆盖共忆加密往返/确认/归档恢复、四种确定性镜片、策展简报交接、schema 19 锁状态、正文前 423 门禁、锁馆期间只读能力与结构恢复演练。V17 发布回归继续覆盖一次性真实隔离恢复、多视角只读投影、设备语义快照、真实 ONNX/WASM 推理、Worker 会话清理、第三方请求负例与浏览器持久化负例。所有测试使用临时数据库与媒体目录，不触碰私人 `data/`。

## V7.2–V10 发布验收（本地回归）

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
- V9 只为已确认、未解决、双侧均有依据且日期区间互斥的事件生成一个口述问题；问题入口收在时光拼图并默认折叠，四项主导航与移动端底栏不变。
- 用户录制单段 WebM 或选择本地 WebM/M4A 后必须人工划定开始/结束毫秒、手填文字稿并明确 `day / range / uncertain`；不自动转写、不识别说话人、不判断情绪。
- 回答使用 `draft / confirmed / superseded / withdrawn` 追加状态；只有 `confirmed + day/range` 成为事件级 `oral-history` 时间来源，uncertain 只保留证据，变更只让旧校准进入 `needsReview`。
- 口述史 PUT/DELETE 要求 `ETag / If-Match`、当前 `questionSetSha256` 与稳定 `submissionId`；声音引用计入使用量，防止显式删除或 GC 误删。
- schema 13 `.time-isle` 使用独立 `oral-history/state.json`，声音字节仍只在 `voices/assets/...`；恢复按事件映射、声音映射、口述史、时间校准依赖顺序执行。非空 JSON 返回 `requiresTimeIsle`，脱敏只保留三项计数与固定说明。
- Demo 口述史保持只读：前端不请求麦克风、不打开文件选择、不发写请求，API PUT/DELETE 返回 403；没有真实样例时不伪造可播放回答。

- V10 受限策展助手只在“讲解与回顾”既有入口中出现，四项主导航和移动底栏不变；执行器固定使用本地规则和四项只读工具，不调用外部大模型、网络、文件或任意 SQL。
- 每次运行固定最多 6 步、4 次只读工具、2 秒、262,144 字节和 6 件来源；运行可取消，进程重启时遗留 `running` 变为不可续跑的 `interrupted`。
- 助手只生成 `proposal / preview`。保存草稿、确认候选关系、发布必须分别提交 `confirm: true`、当前 `If-Match` 与 `Idempotency-Key`；分享不在助手动作白名单中，仍交给三层隐私编辑台逐项选择。
- 来源变化后旧提案只读保留并进入 `needsReview`；`evaluation` 只使用保存回执重放规则和校验哈希，不重新调用工具或执行副作用。
- Schema 14 增加 `curator_agent_runs / steps / proposals / decisions` 与 `curator-agent/state.json`。完整恢复重写全部 ID 并强制为待复核、禁止决定的历史；脱敏只保留安全计数和固定说明。
- 馆藏体检把四表/预算/状态/JSON/外键/唯一性或完整备份合同损坏标为 blocker；`interrupted / needsReview` 仅为 attention，输出不含目标、工具、提案或哈希。
- Demo 的 `/api/curator-agent/sample` 必须是合成 GET 且零持久化；POST、DELETE 以及其他非 GET/HEAD 请求应在读取请求体、ETag 或幂等字段前统一返回 403。

V9 最终关键计数为：HTTP smoke 227、前端 104、口述史 94、口述归档 18、声音采集 UI 26、口述史 UI 37、时间校准 158/UI 206、JSON 导入 141、媒体备份 266/恢复 170、PWA 79；`npm.cmd run check` 全绿。V8 的 211 条 smoke 继续只是上一阶段历史基线，不与 V9 混用。

V10 历史专项计数为：受限策展 core 131、严格归档 98、界面 51、数据库健康 42、馆藏体检 83、Demo 安全 19、前端 109、JSON 导入 160、归档验真 42、媒体备份 312/恢复 189，均已通过；完整 `npm.cmd run build`、`npm.cmd run check` 与 249 条 smoke 全绿。三档浏览器真实交互确认四导航/移动底栏、无横向溢出、移动全屏工作台、逐项保存/关系/发布、隐私编辑台默认零素材、最近记录只读打开/离线重放，以及删除前二次确认均正常。

V10 最终代码提交 `7107ede` 已于 2026-07-19 推送到 GitHub 与 Gitee，并由 GitHub `main` 触发生产部署。V14 功能提交 `2dcce402b13f1d43c54c6a196b8e2273c9483eb3` 于 2026-07-20 按同一顺序推送。V17 功能提交 `413f78640baad7eae6324ef14bc291f05325fbf6` 与静态资产披露热修复 `38d3450b9f26efdc59df4860317cdf9513e77e65` 于 2026-07-21 进入同一发布链路；GitHub、Gitee `main` 均已包含这两项代码提交，GitHub 推送触发 Vercel V17，Gitee 的 `38d3450` 代码基线用于 CloudBase 部署 `002`。后续代码变更仍应先完成整库门禁、临时数据清理和三档真实浏览器验收，再分别推送两个远端：

```powershell
git push gitee main
git push github main
```

上述顺序已用于 V14 与 V17 发布；Gitee 保存同版本镜像并为 CloudBase 提供公开仓库，GitHub `main` 负责触发 Vercel 生产构建。发布状态仍须同时核对双远端提交与两个生产入口，不能只凭一次 `git push` 判断完成。

## V12–V17 发布门禁

- 共忆信笺必须在浏览器内完成请求/回信的 PBKDF2-SHA-256 + AES-256-GCM 往返，验证请求摘要绑定、错口令/篡改拒绝、自述未验证身份、显式入馆确认、完整/脱敏归档与冲突整批回滚。馆外文件加密不能被表述为本机 SQLite 静态加密。
- 设备内镜片必须只接受 GET 查询参数中的明确展品 ID，服务端按 ID 重读当前馆藏；四种镜片保持零模型、零工具调用、零保存。2–6 件可显式交接策展简报，7–20 件必须重新选择，不得静默截断或自动运行。
- 锁馆必须先等待在途写请求和后台维护结束；锁定或状态损坏时，新的 mutation 在读取 Content-Type/正文前 fail-closed 返回 `423`，`bodyBytesRead` 保持 0。GET、导出、`POST /api/archive/inspect` 与 `POST /api/recovery-drills/structural` 保持可用。
- recovery verifier 只保存派生材料，不保存明文口令；普通 JSON、`.time-isle`、日志和公开状态不得包含锁状态、盐、digest 或 verifier。锁馆不提供 SQLite、媒体或磁盘静态加密。
- 结构演练只接受完整 `.time-isle`，以 `structural-verification` 核对 manifest、哈希和引用；`actualRestorePerformed`、`isolatedRestorePerformed`、`disasterRecoveryProven` 与 `diskEncryptionProvided` 必须全部为 `false`。页面不得显示“恢复成功”。
- `INTERVIEW_DEMO=true` 下，共忆文件输入/保存、锁馆切换与结构演练上传必须提前 403 且零写；镜片若展示，只能在合成/播种来源上做确定性只读预览。
- V15 完整恢复必须写入一次性 SQLite/图片/声音副本，独立体检并确认销毁；公开 Demo 在读取归档正文前拒绝。V16 多视角固定 GET-only、零模型、零保存；V17 语义模型与运行库同源固定 SHA，真实 512 维 embedding 只留在 Worker 会话内存。
- 2026-07-20，V14 历史发布基线通过 262 条 HTTP smoke 与 15/15 项 Playwright；2026-07-21，V17 发布基线通过 `npm.cmd run build`、`npm.cmd run check`、272 条真实 HTTP smoke、21/21 项三档 Playwright 门禁与 `git diff --check`。2026-07-22，静态唤醒入口把门禁扩展为 24/24，并通过 24 项有限重试、固定目标、零保活与三档响应式断言。后续任何代码变更或再次发布前都必须重新运行对应门禁。

## 部署后验证

CloudBase 国内唤醒入口与应用直连分别核验：

```text
https://shiyu-memory-demo-d3di282387d5c7-1456049152.tcloudbaseapp.com
https://shiyu-memory-demo-d3di282387d5c7-1456049152.ap-shanghai.app.tcloudbase.com
https://shiyu-memory-demo-d3di282387d5c7-1456049152.ap-shanghai.app.tcloudbase.com/api/version
https://shiyu-memory-demo-d3di282387d5c7-1456049152.ap-shanghai.app.tcloudbase.com/api/health
https://shiyu-memory-demo-d3di282387d5c7-1456049152.ap-shanghai.app.tcloudbase.com/api/demo/status
https://shiyu-memory-demo-d3di282387d5c7-1456049152.ap-shanghai.app.tcloudbase.com/api/memories
https://shiyu-memory-demo-d3di282387d5c7-1456049152.ap-shanghai.app.tcloudbase.com/api/semantic-recall/snapshot
https://shiyu-memory-demo-d3di282387d5c7-1456049152.ap-shanghai.app.tcloudbase.com/api/multi-perspective/memories/demo-never-read-private-store
```

Vercel 全球备用入口继续确认以下地址：

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

2026-07-22 已完成 CloudBase 部署 `002` 的 V17 桌面公网核验：`/api/version` 返回 `17.0.0`，`/api/health` 返回 `schemaVersion: 19 / interview-demo / ephemeral-sqlite / mock-fallback`，`/api/memories` 返回 4 条播种记忆。设备语义快照为 4 件、`46979724` 字节、远程模型关闭、零持久化；多视角合成投影为零外部模型、零持久化；隔离恢复探针返回 `403 / ISOLATED_RECOVERY_DEMO_READ_ONLY / bodyBytesRead: 0`，前后 stats 不变。资产清单与 Worker 返回 200，ONNX 文件返回 200 与 `24010842` 字节；`#reflect` 页面显示 `v17.0.0` 且控制台零错误。空闲后的首次 `/api/version` 曾由 CloudBase 网关返回 nginx 503，同一路径约 5 秒后恢复为 `17.0.0`，确认存在缩零冷启动窗口。静态应用 `time-isle-wakeup-002` 随后成功发布 4/4 文件，入口返回 200，桌面真实点击可用固定 192×192 PNG 探针唤醒并自动进入 `#reflect`。V17 手机真机与临时内容消失仍应单独复核。

2026-07-20 曾完成 Vercel V14 历史生产核验：`/api/version` 返回 `14.0.0`，策展 sample、锁馆与结构演练的深度探针结果如下；这些数字不冒充 V17 已重跑的同名探针。`GET /api/curator-agent/sample` 返回：

```json
{
  "synthetic": true,
  "demo": true
}
```

策展 sample 请求前后持久化运行数均为 0（`0 → 0`），确认该线上示例为合成只读工作区且没有创建运行。另以虚构 `text/plain` 正文分别探测 `POST /api/museum-lock/lock` 与 `POST /api/recovery-drills/structural`，两者均在读取正文前返回 `403`、`code: MUSEUM_LOCK_DEMO_READ_ONLY`、`bodyBytesRead: 0`；探针前后的完整 stats、公开锁状态与策展运行数保持不变。写保护、口述史只读、媒体禁写和归档禁恢复继续由本地整库回归覆盖；后续每次生产发布都应重新核验关键接口，不把未实际执行的线上检查写成已完成事实。

2026-07-21/22 已完成 Vercel V17 生产核验：版本与健康状态为 `17.0.0 / schema 19 / interview-demo / ephemeral-sqlite / mock-fallback`；设备语义快照为 4 件和 `46979724` 字节，多视角为合成只读且零模型/零保存，隔离恢复同源探针返回 `403 / ISOLATED_RECOVERY_DEMO_READ_ONLY / bodyBytesRead: 0`，前后 stats 不变；资产清单、Worker、WASM/ONNX 静态链路均可访问。

最后在无痕窗口完成一次人工路径：

1. 浏览四件示例展品，打开《操场尽头的告别》，进入记忆航线与时光拼图并核对原文摘录。
2. 在时光拼图展开默认折叠的来源校准台，确认两种日期来源、“保留多种记录”结果及不改写原日期的边界；时间线摘要可以重新打开该拼图，尝试保存或移除校准应被 Demo 以 403 阻止。
3. 在同一拼图展开默认折叠的口述史区域，只读查看问题/来源边界；确认录音、文件选择、保存与撤回均不可触发，直接 PUT/DELETE 返回 403。
4. 打开受限策展助手的 Demo sample，确认显示“只读示例/未保存提案”，不会创建本机运行；直接 POST/DELETE 返回 403，页面没有自动批准、自动发布或自动分享入口。
5. 体验 Mock AI 整理、语义线索检索、实体档案预览和讲解来源，不输入任何私人文本；区分既有文字整理 Mock 与始终使用本地规则的 V10 策展助手。
6. 体验主题展览预览、今日回访、明确回访意愿界面与声音只读提示；确认展览保存、回访状态与意愿、声音和胶囊写入均被 Demo 阻止。
7. 从播种的已确认展览打开“胶囊与分享”，确认页面明确提示公开 Demo 不保存胶囊；逐层核对公开外壳、口令内内容与固定排除项，仅使用示例内容体验浏览器内加密，不复用私人口令。
8. 确认图片/声音入口、完整归档恢复、旧 JSON 导入、删除和清空均不可用；直接写 API 或 `POST /api/archive/restore` 返回 403。
9. 在支持安装的浏览器确认“数据与项目”渐进出现安装入口；断网后只显示离线隐私边界页，重新联网可返回应用，安装前后麦克风和媒体写入均保持关闭。

本轮收尾必须在可丢弃、无隐私的数据上覆盖：口述 draft/confirmed/重答/撤回、旧校准 `needsReview`、受限策展运行/取消/逐项决定/来源变化/重放评测、schema 19 完整/脱敏恢复、共忆回信与 provenance 依赖、四种镜片、锁馆/解锁和结构演练，以及 Demo 新接口零写；图片、声音、胶囊和离线口令链路继续纳入整库回归。若提交前代码变化，应重复对应检查；测试后仍须停止临时服务并删除临时数据库、媒体和下载文件。

## 重复 Vercel 项目

同一 GitHub 仓库如果连接多个 Vercel 项目，每次推送可能重复构建。作为全球备用入口的 Vercel 项目只保留：

```text
ai-memory-museum-demo
```

其他重复项目应删除或断开 Git 连接，避免浪费构建额度和误用域名。

当前状态重申：V17.0.0 / schema 19 已于 2026-07-22 完成 GitHub、Gitee 双远端与 Vercel、CloudBase 双生产入口发布；功能提交为 `413f78640baad7eae6324ef14bc291f05325fbf6`，热修复为 `38d3450b9f26efdc59df4860317cdf9513e77e65`，CloudBase 当前生效云托管部署为 `002`，静态唤醒部署为 `time-isle-wakeup-002`。静态地址是新的国内简历入口候选，Vercel 保留为全球备用，云托管直链保留为诊断地址；V17 手机真机与临时内容消失仍是独立待观察项。V14 的 `2dcce40 / 001 / 278f925 / 262 / 15/15` 与手机结果、V10 的 `7107ede / 249` 仅保留为历史发布基线。
