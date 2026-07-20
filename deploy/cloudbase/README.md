# CloudBase 云托管公开 Demo

这套配置用于把时屿部署到腾讯云 CloudBase 云托管，作为面试官和朋友可直接打开的匿名公开 Demo。它不是私人云备忘录：应用固定运行在 `INTERVIEW_DEMO=true`，使用虚构播种内容和模拟 AI 回退，不连接私人馆藏，也不配置付费 AI 密钥。

公开 Demo 仍是一个共享实例。访客提交的有限临时内容在实例存活期间可能被其他访客看到，而且可能在缩容到 0、重新部署、异常迁移或重启时随时消失。不要输入真实姓名、联系方式、简历隐私、私人照片、录音、日记或任何敏感内容。

当前免费体验环境每月提供 3000 资源点，控制台“套餐用量”页会分别记录云托管 CPU、内存与外网出流量；“按量付费”必须始终保持关闭。本项目选择 0.5 核 / 1 GiB，计算消耗约为 59.5 点/实例小时，3000 点在不计流量时约覆盖 50 小时实例存活时间。服务已配置自动启停，按平台策略应在闲置后缩到 0，但实际缩零时点与随后冷启动仍待验收；少量面试访问通常应能落在免费资源点内，但这不是无限免费承诺。若平台要求升级套餐、开启超限按量或创建常驻实例，立即停止，不继续发布。

## 当前发布记录（2026-07-20）

- 环境 ID：`shiyu-memory-demo-d3di282387d5c7`。
- 国内主入口：`https://shiyu-memory-demo-d3di282387d5c7-1456049152.ap-shanghai.app.tcloudbase.com`。
- 云托管服务：`time-isle-demo`；部署：`001`；来源提交：`278f925`。
- 运行规格：`0.5` 核 / `1 GiB`，最小 `0` / 最大 `1` 个实例；SQLite 与媒体目录只写 `/tmp`，没有持久卷、云数据库或私人数据导入。
- 费用状态：按量付费关闭，只消耗免费套餐资源点；截至 2026-07-20 桌面验收时，控制台显示套餐用量为 `0.11 / 3000` 点。
- 已完成桌面公网验收：首页与 `/api/version`、`/api/health`、`/api/demo/status`、`/api/memories` 均可访问，结果为 `V14.0.0 / schema 19 / 4` 条播种记忆。
- 尚未完成用户手机 Wi-Fi 与蜂窝网络真机验收；不得把桌面浏览器结果表述为已完成移动网络验收。缩零后的冷启动与临时写入消失也应继续单独复核。

## 本方案的边界

- 复用仓库根目录的 `Dockerfile`，构建上下文为仓库根目录，容器端口为 `3000`。
- 只部署一个服务 `time-isle-demo`；最小实例数为 `0`、最大实例数为 `1`。缩零节约资源点，单实例也避免多个 SQLite 副本产生彼此不同的临时视图。
- SQLite 与媒体目录固定写入 `/tmp`，不挂载持久卷、不连接 CloudBase 数据库，也不导入本地 `data/`。
- 公网只通过 CloudBase 的 HTTPS 入口和根路由 `/` 访问，容器不自行签发证书。
- 健康检查必须使用 `TCP:3000`，不能改成 HTTP。平台内部 HTTP 探针的 Host 通常不是公开域名，会被应用的精确 Host 边界按设计拒绝。
- 不配置 `AI_API_KEY`、`OPENAI_API_KEY` 或其他模型密钥。匿名公网服务使用真实模型密钥会产生滥用和费用风险；Demo 的 `mock-fallback` 已足够展示交互。

[console-settings.json](./console-settings.json) 是供人和自动化复核的控制台配置清单，不是 CloudBase CLI 可导入文件。不要尝试把它上传为平台配置。

## 1. 先取得准确访问主机名

在 CloudBase 控制台进入已经创建的环境，找到“HTTP 访问服务”“公网访问”或“域名管理”中平台提供的 HTTPS 访问地址。控制台文案可能随版本变化；应复制浏览器地址栏中最终公开 URL 的主机名。

例如公开地址若为：

```text
https://example-123456.service.tcloudbase.com/
```

则 `ALLOWED_HOSTS` 只填写：

```text
example-123456.service.tcloudbase.com
```

不要填写 `https://`、任何路径、查询参数、通配符或 CloudBase 环境 ID。环境 ID 和公开 hostname 不是同一个值。若控制台还没有显示可访问域名，先启用环境的 HTTP 访问服务；在获得准确 hostname 前不要发布容器。

## 2. 创建云托管服务

在当前 CloudBase 环境中进入“云托管”，新建服务并按以下值配置：

| 配置项 | 值 |
| --- | --- |
| 服务名 | `time-isle-demo` |
| 构建方式 | Dockerfile |
| 构建上下文/代码根目录 | 仓库根目录 `.` |
| Dockerfile | 根目录 `Dockerfile` |
| 容器监听端口 | `3000` |
| CPU / 内存 | `0.5` 核 / `1 GiB` |
| 最小实例数 | `0` |
| 最大实例数 | `1` |
| 健康检查 | TCP，端口 `3000` |
| 公网访问 | 开启 |
| 路由 | 根路由 `/` 指向 `time-isle-demo` |

若免费体验版不允许“最小 0、最大 1”或要求开通付费常驻实例，先停止创建并核对套餐，不要直接接受付费升级。不要添加持久磁盘、云数据库或第二个服务实例。

启用云托管前先到“套餐用量”确认套餐资源点仍为 3000、当前消耗可解释，并确认“按量付费”开关关闭。云托管界面会要求知晓付费模式；这不构成允许开启超限按量。任何要求打开按量付费、充值或升级个人版的后续提示都属于停止条件。

## 3. 填写环境变量

参考 [cloudbase.env.example](./cloudbase.env.example)，在服务版本的环境变量界面逐项填写以下 8 个值：

```env
NODE_ENV=production
PUBLIC_DEPLOYMENT=true
INTERVIEW_DEMO=true
BIND_HOST=0.0.0.0
PORT=3000
ALLOWED_HOSTS=你的准确CloudBase公开hostname
DB_PATH=/tmp/ai-memory-museum-cloudbase-demo.sqlite
MEDIA_ROOT=/tmp/ai-memory-museum-cloudbase-demo-media
```

模板中的 `REPLACE_WITH_EXACT_CLOUDBASE_HOST` 必须替换；它故意包含非法 hostname 字符，使遗漏时安全地启动失败。不要用 `*` 绕过失败，也不要把 `INTERVIEW_DEMO` 改成 `false`。

若以后绑定自定义域名，可在域名证书和路由生效后，把默认域名与自定义域名以逗号分隔加入白名单，例如：

```env
ALLOWED_HOSTS=example-123456.service.tcloudbase.com,memory.example.com
```

两项仍都只能是准确 hostname。浏览器写请求必须来自同一个 HTTPS Origin，因此不能只改路由而忘记同步白名单。

## 4. 构建、发布与路由

选择仓库当前准备发布的 Git 提交创建版本。构建日志中必须看到根目录 `Dockerfile` 执行 `npm run build` 并通过永久门禁；运行时应使用 Dockerfile 的非 root `node` 用户。

发布一个版本，把 100% 流量指向该版本，并确认根路由 `/` 指向 `time-isle-demo`。不要额外开放容器端口，不要创建绕过 CloudBase HTTPS 入口的公网地址。

首次启动失败时按这个顺序排查：

1. `ALLOWED_HOSTS` 是否只是公开 URL 的 hostname。
2. `PUBLIC_DEPLOYMENT` 与 `INTERVIEW_DEMO` 是否都是 `true`。
3. 容器端口、TCP 健康检查端口是否都为 `3000`。
4. 构建上下文是否为仓库根目录，Dockerfile 路径是否为 `Dockerfile`。

不要通过删除安全变量、改用 HTTP 健康检查、放宽 Host 或启用私人数据来“修复”发布。

## 5. 发布验收

把下面的 `你的公开hostname` 替换为控制台提供的准确公开主机名（不含 `https://` 和路径）：

```bash
curl -fsS https://你的公开hostname/api/version
curl -fsS https://你的公开hostname/api/health
curl -fsS https://你的公开hostname/api/demo/status
curl -fsS https://你的公开hostname/api/memories
```

必须确认：

- 页面根路径可打开，静态资源没有 404，刷新各 hash 页面仍正常。
- `/api/version` 返回当前发布版本；V14 基线应为 `14.0.0`。该接口不作为 schema 版本的核验来源。
- `/api/health` 返回 `ok: true`、`schemaVersion: 19`，并确认 `mode: interview-demo`、`storage: ephemeral-sqlite` 与 `aiMode: mock-fallback`。
- `/api/demo/status` 显示 `interviewDemo: true`、`aiMode: mock-fallback`，并包含 4 件播种记忆、1 场播种展览、1 项时间校准。
- `/api/memories` 返回 4 条播种记忆；它与 `/api/health` 一起用于交叉核对当前数据库状态。
- 仅用无隐私的临时文本验证一次新增；不要上传真实图片或录音。确认后等待一次缩容到 0 或重新部署，冷启动应恢复播种数据且临时内容消失。
- 分别用电脑、手机 Wi-Fi 和手机蜂窝网络访问。至少验证首页、记录、馆藏、回望以及录音权限提示。

当前桌面公网首页与四个 API 已通过，因此 CloudBase 地址可以先记录在项目部署文档中；手机 Wi-Fi、蜂窝网络及缩零冷启动仍是明确待办，完成前不得声称这些真机与恢复场景已经验收。只有完成电脑、手机 Wi-Fi 和手机蜂窝网络访问，并复核缩零后的冷启动与临时内容消失，才能把它更新到简历。现有 Vercel V14 地址在此之前继续作为简历入口与全球备用入口。

## 6. 更新与回退

每次更新都从一个已通过仓库门禁的 Git 提交构建新版本，先保留旧版本，再切换流量。切换后重新检查版本、健康状态、Demo 状态、精确 Host 和临时数据边界。

若新版本异常，把 100% 流量切回最后一个已验收版本；不要把最大实例数提高到 2，也不要把 `/tmp` 改成私人持久存储。免费体验到期前应在腾讯云费用中心和 CloudBase 套餐页确认续期规则，避免自动进入付费资源。
