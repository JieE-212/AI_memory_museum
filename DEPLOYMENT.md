# 时屿部署、核验与回滚手册

本手册描述可重复执行的发布流程。版本历史见 [`CHANGELOG.md`](./CHANGELOG.md)。

> 发布流程分成两个提交：运行时发布提交 **A** 与证据文档收尾提交 **B**。在生产探针完成前，合同保持 `candidate-local-only`；任何本地测试结果都不能提前改写为 `released`。

## 1. 部署边界

公开部署只用于匿名、只读、完全虚构的面试体验：

- `INTERVIEW_DEMO=true` 时，所有非 `GET/HEAD` 请求必须在读取正文前统一返回 `403`。
- 公开实例只展示四件固定虚构展品；访客不能新增、修改或删除任何内容。
- 公开实例不配置真实 AI Key，不接收私人图片、声音、备份、口令或馆藏。
- CloudBase/Vercel 的临时 SQLite 和媒体路径只用于固定样例，不是私人持久化、账号隔离或云同步。
- PWA 是响应式 Web 的可安装外壳，不是原生 App，也不提供离线私人馆藏。
- SQLite、图片、声音和备份仍是明文静态存储；V18 加密门禁保持 **NO-GO**。

私人完整能力只在用户自己的 Node.js 24+ 环境与持久磁盘中使用：

```powershell
$env:DB_PATH = "D:\time-isle\memory-museum.sqlite"
$env:MEDIA_ROOT = "D:\time-isle\media"
npm.cmd start
```

默认本地路径为 `data/memory-museum.sqlite`、`data/media/` 与 `data/media/voice/`。不得提交 `.env`、本地 SQLite、媒体或 `.time-isle` 备份。

## 2. 当前公开入口

- 国内静态唤醒入口：<https://shiyu-memory-demo-d3di282387d5c7-1456049152.tcloudbaseapp.com>
- CloudBase 应用直连（诊断备用）：<https://shiyu-memory-demo-d3di282387d5c7-1456049152.ap-shanghai.app.tcloudbase.com>
- Vercel 全球备用：<https://ai-memory-museum-demo.vercel.app>

这些地址在发布前仍运行已核验的 V17.0.0。V17.1.2 的运行时 Tag 固定在提交 A；完成双远端、CI 与生产探针后，才用纯文档提交 B 更新发布合同。

## 3. 发布前门禁

Windows PowerShell 使用 `npm.cmd`：

```powershell
npm.cmd run build
npm.cmd run smoke
npm.cmd test
npm.cmd run test:browser
npm.cmd run test:semantic-eval
npm.cmd run release:verify
git diff --check
```

其中：

- `build`：语法与全部独立回归，不运行 HTTP smoke。
- `smoke`：在系统临时目录启动真实 HTTP 服务。
- `test`：根级全部独立检查与 HTTP smoke。
- `test:browser`：隔离 Demo 和可写服务的四档 Playwright 旅程与 WCAG AA 自动检查。
- `test:semantic-eval`：真实 q8 ONNX/WASM 中文语义质量与性能记录。
- `release:verify`：核对版本、schema、信任合同、模型哈希、候选发布合同和唤醒入口。

发布前还必须人工确认：

1. `git status --short` 只有本次计划内文件，无临时 SQLite、媒体、Playwright 报告或语义报告。
2. 桌面 1265×720、手机 390×844、手机 320×700、触控横屏 844×390 均完成真实浏览器目视验收。
3. `release/v17.1.2.json` 仍为 `candidate-local-only`，V18 为 `NO-GO`，静态加密为 `false`。
4. 没有把本地可写、设备语义、PWA 安装或一次性恢复扩大成私人云同步、原生 App、事实判断或灾备证明。

根 `npm test` 不隐式运行 Playwright，因此浏览器门禁不可省略。

## 4. Git、Tag 与双远端

本地远端名称：

```text
gitee  → Gitee 镜像与 CloudBase 构建源
github → GitHub 与 Vercel 构建源
```

发布时先创建唯一运行时提交 A，并在 CI 通过后创建不可变 Annotated Tag。生产部署必须明确使用提交 A（或该 Tag）；完成生产核验后才允许创建只改文档/发布证据的提交 B：

```powershell
git commit -m "release: V17.1.2 runtime"
git push gitee main
git push github main
# 停在这里：确认两个远端的 main 都是 A，且 main CI 的五个门禁全部成功
git tag -a v17.1.2 -m "时屿 V17.1.2：移动体验、数据可靠性与性能收束版"
git push gitee v17.1.2
git push github v17.1.2
# 再停在这里：确认两个远端的 Tag 都是 Annotated、peeled=A，且 tag CI/evidence 成功
# 生产核验通过后：只改文档与 release/v17.1.2.json，再提交 B
git commit -m "docs: record V17.1.2 production evidence"
git push gitee main
git push github main
# B 推送后只生成 post-B evidence manifest；生产别名仍保持部署 A
```

最终远端语义是：GitHub/Gitee 的 `main` 指向文档提交 B，`v17.1.2` Annotated Tag 的 peeled commit 指向运行时提交 A。A 与 B 不得混称；一次 `git push` 成功不等于双远端、Tag 或生产发布完成。

## 5. Vercel

Vercel 项目连接 GitHub 仓库 `JieE-212/AI_memory_museum` 的 `main`：

```text
Root Directory: 留空
Install Command: npm install
Build Command: npm run build
Output Directory: 留空
```

生产环境至少设置：

```text
INTERVIEW_DEMO=true
AI_MODEL=gpt-4.1-mini
ALLOWED_HOSTS=ai-memory-museum-demo.vercel.app
DEPLOYMENT_PLATFORM=vercel
```

不要设置 `AI_API_KEY`。Vercel 注入的官方域名和 `ALLOWED_HOSTS` 中的精确 hostname 组成 Host 白名单；不支持通配符、路径或协议前缀。所有浏览器 mutation 还必须通过同源 Origin 与 Fetch Metadata 校验，但 Demo 会更早地在正文读取前统一拒绝。

生产部署必须从运行时提交 A 或 `v17.1.2` Tag 创建并记录 deployment ID。提交 B 只改文档和证据：若项目的 Git 集成会因 B 自动生成新生产部署，应先暂停该次生产提升或将生产别名保持在 A；不得把 B 误记为运行时部署来源。

## 6. CloudBase

详细控制台参数见 [`deploy/cloudbase/README.md`](./deploy/cloudbase/README.md)。核心约束：

- CloudBase 服务 `time-isle-demo`，0.5 核 / 1 GiB，最小 0、最大 1 个实例。
- 健康检查使用 `TCP:3000`，公网 HTTPS 根路由指向服务。
- 不开启按量付费、付费升级、常驻实例、持久卷、云数据库或第二个实例。
- 环境变量使用模板 [`deploy/cloudbase/cloudbase.env.example`](./deploy/cloudbase/cloudbase.env.example) 的 9 项精确值。
- 静态唤醒页只在用户点击后执行最多 3 次固定图片探针；成功后进入 `#collection`，不自动下载约 47 MB 语义模型。
- 唤醒页提供“进入只读安全体验”和“查看项目技术证据”两条明确路径，不承诺与三分钟面试路线冲突的固定体验时长。

CloudBase 会缩容到 0。有限冷启动可出现短暂 503；只做有限次数测试，不为演示开启付费或常驻实例。

云托管构建源固定为运行时提交 A（或其 Annotated Tag），而不是随后只改文档的 B；记录服务版本 ID 与实际 source commit。静态唤醒入口同样只上传 A 构建产物，并单独记录静态版本 ID。

## 7. 部署后机器核验

对 CloudBase 应用直连与 Vercel 分别检查：

```text
/api/version
/api/health
/api/runtime/trust
/api/demo/status
/api/memories
/api/semantic-recall/snapshot
/manifest.webmanifest
/sw.js
/offline.html
```

发布 V17.1.2 时必须满足：

- `/api/version`：`version = 17.1.2`；commit 以 Vercel/CloudBase 构建 metadata 记录，不从该接口臆测。
- `/api/health`：`ok = true`、`schemaVersion = 19`、`mode = interview-demo`。
- `/api/runtime/trust`：`audience = public-demo`；存储为临时公开样例；`visitorWritesAllowed = false`；`blockedBeforeBodyRead = true`；外部 AI 不允许；`encryptionAtRest.enabled = false`。
- `/api/memories`：固定四件虚构展品。
- 设备语义快照只包含四件虚构展品，远程模型关闭，向量不持久化。
- 页面信任状态条在馆藏、记录、找回、我的四个视图持续可见。
- 首页、hash 深链和静态资源无 404；浏览器控制台无未处理错误。

### Demo 零写探针

对同源 mutation 使用一段无隐私的合成正文，核对：

1. 请求返回统一 `403` 与 Demo 只读错误码。
2. 响应证明 `bodyBytesRead = 0`。
3. 请求前后的数据库 stats、四件展品、媒体与声音资产计数完全不变。
4. POST、PUT、PATCH、DELETE 至少各覆盖一个代表路由。

不要通过“新增一条再等待消失”验收公开 Demo；V17.1 的正确结果是从未读取、从未写入。

### 有限冷启动

- 静置到缩零后，最多执行预先约定的有限样本。
- 记录首次状态、恢复时间与最终版本，不无限刷新或保活。
- 不把一次可达扩大为 SLA、持续在线或全部移动功能验收。

## 8. 人工验收

无痕窗口按唯一三分钟路线复核：

1. 从唤醒页选择“进入只读安全体验”，进入馆藏首页。
2. 查看信任状态条与阿棠两段虚构记录、照片和时光拼图。
3. 展示字段检索；设备语义仅在明确点击后加载；讲解员回答包含引用与真实执行标签。
4. 到“我的 → 项目幕后”查看数据位置、备份、静态加密边界与技术证据。
5. 在桌面 1265×720、390×844、320×700、844×390 分别确认无横向溢出、底栏可达、文案可读。

公开 Demo 不进行录音、文件选择、备份上传或任何真实写入。

## 9. Evidence manifest

当前合同为 [`release/v17.1.2.json`](./release/v17.1.2.json)。运行时提交 A 的 CI evidence 与生产探针应绑定。提交 B 自身不能预先写入自己的 SHA，因此 B 与双远端 `main` 的实际 SHA 只在 B 创建并推送后写入最终 evidence manifest（CI artifact 或脱敏外部附件），不反向改写合同：

- 版本、schema、运行时提交 A、文档提交 B 与期望 Tag；A 必须是 B 的祖先，A→B 只允许文档和 release JSON。
- 模型 ID、ONNX SHA-256、评测集 SHA-256。
- Windows/Linux 根门禁、Demo/可写浏览器旅程、语义质量和 Docker 构建结果。
- GitHub/Gitee `main=B`、Annotated Tag peeled `A`，分别记录两种 SHA；这两项由 B 之后生成的 manifest 记录，`release/v17.1.2.json` 不自引用 B。
- CloudBase/Vercel 的脱敏 `/api/version`、`/api/health`、`/api/runtime/trust` 观察结果。
- 桌面、390px、320px、844×390 与手机入口分别记录的验收范围。

合同中的 `productionVerification.manifestPath/manifestSha256` 标记为 `manifestKind=pre-release-production-probe`，只绑定 B 创建前、运行时 A 部署后的脱敏生产探针；包含 B 与双远端 SHA 的拓扑 manifest 必须在 B 之后另行生成。

运行时 A 的 CI、部署、生产探针和 pre-release probe manifest 全部通过后，才可创建提交 B 并把合同状态从 `candidate-local-only` 更新为 `released`。B 创建后已经能得到自身 SHA；随后推送 B、核对双远端 `main=B`，再生成严格 post-B manifest 记录实际 B/远端 SHA。合同只绑定运行时 A，B 本身不能被写入运行时 A 字段，也不能把 Tag 改指向 B；post-B manifest 未通过前不得对外宣称发布收尾完成。

post-B manifest 生成时应在干净的 B 工作树执行，并把真实远端值注入环境变量后启用严格门禁：

```powershell
$env:EVIDENCE_GITHUB_MAIN_COMMIT = "<github-main-B>"
$env:EVIDENCE_GITHUB_TAG_COMMIT = "<tag-peeled-A>"
$env:EVIDENCE_GITHUB_TAG_ANNOTATED = "true"
$env:EVIDENCE_GITEE_MAIN_COMMIT = "<gitee-main-B>"
$env:EVIDENCE_GITEE_TAG_COMMIT = "<tag-peeled-A>"
$env:EVIDENCE_GITEE_TAG_ANNOTATED = "true"
node scripts/release-evidence-check.js --write artifacts/release-evidence-v17.1.2.json --require-complete-evidence
```

该 artifact 才是记录 B、双远端 SHA、部署 ID 与生产探针的最终证据；候选阶段自动生成的 manifest 不能冒充 released 证据。

## 10. 回滚

1. 保留最后已验收部署，不删除旧版本。
2. 新版本异常时，将 CloudBase 100% 流量或 Vercel生产别名切回上一已验收提交/部署。
3. 核对 `/api/version`、`/api/health` 与 `/api/runtime/trust` 已恢复到该版本事实。
4. 不通过关闭 `INTERVIEW_DEMO`、放宽 Host、增加实例、挂载私人数据或开启付费来绕过失败。
5. 记录回滚 commit、部署 ID、时间与原因，再修复并重新走完整门禁。

## 11. 已核验的历史生产事实

V17.0.0 于 2026-07-22 发布，功能提交为 `413f78640baad7eae6324ef14bc291f05325fbf6`，热修复为 `38d3450b9f26efdc59df4860317cdf9513e77e65`。GitHub/Gitee `main`、Vercel 与 CloudBase 服务部署 `002` 完成当时的生产核验；CloudBase 静态应用 `time-isle-wakeup-002` 完成桌面及手机 Wi-Fi/蜂窝入口链路验收。CloudBase 曾观察到缩零后首次请求短暂 503、约 5 秒后恢复。

这些记录只证明 V17.0 当时实际执行的项目；它们不证明 V17.1 已发布，也不证明私人写入、云同步、全部手机功能、商业 SLA 或静态加密。
