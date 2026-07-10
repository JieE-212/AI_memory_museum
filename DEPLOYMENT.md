# Vercel 面试 Demo 部署

生产 Demo：

```text
https://ai-memory-museum-demo.vercel.app
```

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

`vercel.json` 只将 `/api/*` 转发到 `api/index.js`，`public/` 下的页面和静态资源由 Vercel 提供。

## 环境变量

Production 环境设置：

```text
INTERVIEW_DEMO=true
AI_MODEL=gpt-4.1-mini
```

公开面试 Demo 建议不要配置 `AI_API_KEY`：

- 避免消耗模型额度。
- 避免公开环境滥用 Key。
- 项目会自动使用本地 Mock fallback，核心流程仍然可演示。

如需在受控环境验证真实模型，再添加：

```text
AI_API_KEY=your-key
AI_BASE_URL=https://api.openai.com/v1
AI_TIMEOUT_MS=20000
```

## Demo 安全行为

`INTERVIEW_DEMO=true` 时：

- 使用临时 SQLite。
- 冷启动注入四件示例展品。
- 删除展品和清空数据库返回 403。
- 页面显示“公开面试 Demo”提示。
- 实例重建后恢复示例馆藏，不承诺保存访客新增内容。

不要部署本地 `data/memory-museum.sqlite`，不要提交 `.env`。

## 发布前检查

```powershell
npm.cmd run check
```

检查通过后：

```powershell
git push github main
```

## 部署后验证

确认以下地址均可访问：

```text
https://ai-memory-museum-demo.vercel.app
https://ai-memory-museum-demo.vercel.app/api/health
https://ai-memory-museum-demo.vercel.app/api/demo/status
```

`/api/demo/status` 应包含：

```json
{
  "interviewDemo": true,
  "storage": "ephemeral-sqlite-on-tmp",
  "seededExamples": 4,
  "destructiveActionsBlocked": true,
  "aiMode": "mock-fallback"
}
```

最后在无痕窗口完成一次人工路径：浏览展品、AI 整理、保存临时展品、混合检索、讲解引用和回顾；同时确认删除按钮不可用。

## 重复 Vercel 项目

同一 GitHub 仓库如果连接多个 Vercel 项目，每次推送可能重复构建。正式简历链接只保留：

```text
ai-memory-museum-demo
```

其他重复项目应删除或断开 Git 连接，避免浪费构建额度和误用域名。
