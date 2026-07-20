# 腾讯云 Lighthouse 香港公开 Demo

这套配置用于把时屿部署为中国网络更易访问的匿名面试 Demo。它不是私人云馆藏：容器固定启用 `INTERVIEW_DEMO=true`，启动时只播种虚构数据，但访客仍可在事务硬上限内新增临时普通文字；这些文字在容器重启前可能被同一共享实例的其他访客看到，因此绝不能输入私人或敏感内容。SQLite 与临时媒体位于 512 MiB `tmpfs`，实例或容器重启后重新播种，只有 Caddy 的 TLS 与运行配置状态持久化。

## 推荐资源

- 腾讯云轻量应用服务器 Lighthouse，中国香港地域。
- Ubuntu 24.04 LTS，建议至少 2 核 2 GiB、40 GiB SSD。
- 使用 SSH 密钥；安全组只向公网开放 TCP 80/443，可选开放 UDP 443；TCP 22 仅允许自己的出口 IP。
- 准备一个域名，例如 `memory.example.com`，将 A 记录指向服务器公网 IPv4。
- 不开放 TCP 3000；应用只存在于 Docker 内部网络，由 Caddy 终止 TLS。

香港地域通常不要求中国大陆 ICP 备案，但不代表三网质量必然一致。上线后必须分别使用手机 Wi-Fi 与蜂窝网络实测；长期正式入口仍建议完成备案后迁入大陆节点。

## 上线前准备

1. 在服务器安装 Docker Engine 与 Docker Compose v2 插件，使用 Docker 官方 Ubuntu 安装说明。
2. 克隆 GitHub 或 Gitee 仓库并进入项目根目录。
3. 复制环境模板并填写真实域名与证书通知邮箱：

```bash
cp deploy/tencent/tencent.env.example deploy/tencent/tencent.env
nano deploy/tencent/tencent.env
```

4. 确认域名 A 记录已经解析到 Lighthouse 公网 IP，且 80/443 安全组规则已生效。

`DOMAIN` 只能填写裸 ASCII/Punycode 完整域名，例如 `memory.example.com`；不得包含 `https://`、路径、端口、逗号或空格。必须替换模板中的 `example.com`，并删除仍指向其他服务器的旧 AAAA 记录，避免 ACME 从错误的 IPv6 地址验签。

环境文件只能包含：

```env
DOMAIN=你的公开域名
ACME_EMAIL=你的证书通知邮箱
```

不要加入 `AI_API_KEY`，不要把 `INTERVIEW_DEMO` 改为 `false`，也不要挂载本地 `data/`。当前项目没有账号隔离，完整私人馆藏只能保留在自己的本地环境。

## 构建与启动

先让 Compose 展开并校验配置，再启动：

```bash
docker compose --env-file deploy/tencent/tencent.env -f deploy/tencent/compose.yml config
docker compose --env-file deploy/tencent/tencent.env -f deploy/tencent/compose.yml up -d --build
docker compose --env-file deploy/tencent/tencent.env -f deploy/tencent/compose.yml ps
```

Docker 构建阶段会运行 `npm run build`。应用容器以非 root 用户、只读根文件系统、清空 Linux capabilities 和内部网络运行；Caddy 自动申请 HTTPS 证书并保留原始 `Host`，使服务端继续执行精确 Host 与同源 HTTPS Origin 校验。

首次在真实 Lighthouse 构建成功后，应记录实际拉取的 Node 与 Caddy 镜像 digest；后续正式发布固定到已验收 digest，避免浮动标签在无人复核时改变运行时。

## 发布验收

先检查容器日志和公开接口：

```bash
docker compose --env-file deploy/tencent/tencent.env -f deploy/tencent/compose.yml logs --tail=100 app caddy
curl -fsS https://你的公开域名/api/version
curl -fsS https://你的公开域名/api/health
curl -fsS https://你的公开域名/api/demo/status
```

必须确认：

- `version: 14.0.0`、`schemaVersion: 19`、`mode: interview-demo`。
- `storage: ephemeral-sqlite`、`aiMode: mock-fallback`。
- 4 件示例、1 场展览、1 项时间校准。
- 策展 sample 为 `synthetic / demo`，调用前后持久化 runs 为 0。
- 锁馆与结构演练的虚构 `text/plain` 探针均返回 403、`bodyBytesRead=0`，前后 stats 与锁状态不变。
- 手机 Wi-Fi、移动/联通/电信蜂窝网络至少完成可用性抽测。

腾讯域名通过验收后再更新简历；Vercel 地址继续作为全球备用，不要提前把尚未上线的腾讯地址写成已发布。

## 更新与回滚

更新代码后重新构建：

```bash
git pull --ff-only
docker compose --env-file deploy/tencent/tencent.env -f deploy/tencent/compose.yml up -d --build
```

每次更新都必须重新检查版本、健康、Demo 状态及零写边界。若新容器未通过健康检查，先查看日志并回到上一个 Git 提交重新构建；不要通过关闭 `INTERVIEW_DEMO` 或放宽 `ALLOWED_HOSTS` 绕过失败。
