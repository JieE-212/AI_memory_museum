# V17.1 浏览器与语义发布门禁

本目录使用独立 Playwright 依赖，并由 `scripts/run-gate.cjs` 启动两份隔离服务：

- **Demo 服务**：`INTERVIEW_DEMO=true`，四件固定虚构样例，所有非 `GET/HEAD` 请求在正文读取前拒绝。
- **可写服务**：使用专属临时 SQLite、图片和声音目录，验证完整的原文先存旅程；不会读取项目私人 `data/`。

## 覆盖内容

四档视口均为 Chromium：

- 桌面 1265×720
- 手机 390×844
- 小屏手机 320×700
- 触控横屏 844×390

Demo 旅程覆盖：

- 四个主视图、固定移动底栏、无横向溢出、控制台零未处理错误与 WCAG 2.2 A/AA 自动扫描。
- 信任状态条在馆藏、记录、找回、我的持续可见，显示公开只读、保存位置、AI、外发和静态加密边界。
- 代表性 mutation 返回统一 403、`bodyBytesRead: 0`，测试前后数据库/媒体/声音统计不变。
- 固定虚构展品、字段检索、讲解回执、确定性策展工作流 sample、设备镜片、多视角和恢复禁写。
- CloudBase 静态唤醒页点击前零探针，点击后最多 3 次固定 PNG 探针；成功进入 `#collection`，并提供安全体验与技术证据两条路径。

可写旅程覆盖：

- 先保存当前原文，再关联唯一图片或声音；媒体失败不丢失正文。
- 可选整理通过并发条件更新同一件展品，不创建重复项；修改原文后不会保存旧文本，整理返回途中继续编辑时旧响应也会被丢弃。
- 搜索、重开详情、刷新后仍可读取原文和媒体。
- 永久假麦克风夹具覆盖录音切页三选项、权限迟到、页面隐藏自动停止、真正 `pagehide`、放弃零资产、保留上传成功、旧声音不丢失。
- 每个 MediaStreamTrack 只停止一次并进入 `ended`。

真实语义评测只在桌面项目运行：

- 完全虚构的 100 件中文质量集，输出 Overall 与 semantic-paraphrase / literal-control slice 的 Recall@3、MRR@3、HardNegativeIntrusion@3、Forbidden@1 和 FTS 对照。
- 将同一质量查询扩展到完全虚构的 500 件语料后再次执行独立总体与切片质量门禁，并记录索引与查询性能；跨机器默认只记录性能趋势。
- 只有设置 `SEMANTIC_EVAL_RUNNER_ID=zfjj-windows-local-v1` 时，才与固定 Windows 本机性能基线执行 20% 回退硬门禁。
- 质量指标在所有 runner 上执行不超过 20% 的版本回退门禁。

## 安装

```powershell
cd tests/browser
npm.cmd ci
npm.cmd run install:browser
```

## 运行

从项目根目录：

```powershell
npm.cmd run test:browser
npm.cmd run test:semantic-eval
```

固定本机性能门禁：

```powershell
$env:SEMANTIC_EVAL_RUNNER_ID = "zfjj-windows-local-v1"
npm.cmd run test:semantic-eval
Remove-Item Env:SEMANTIC_EVAL_RUNNER_ID
```

根目录 `npm test` 不会隐式运行 Playwright；发布前必须单独执行上述两项。

## 产物与清理

默认情况下，门禁把服务数据库、媒体、声音、截图、trace 和报告放在自身拥有的系统临时根目录。无论成功或失败，都会先有限停止 Playwright、Chromium 与两个 Node 服务，再删除临时根目录；停止或删除失败会使门禁失败。

CI 可设置：

```text
BROWSER_GATE_ARTIFACT_DIR=<持久 artifact 目录>
SEMANTIC_EVAL_REPORT_PATH=<语义 JSON 报告路径>
```

这样只保留可复核的测试证据；业务临时数据库和媒体仍被清理。失败 trace、截图与语义报告不得提交进产品代码目录。
