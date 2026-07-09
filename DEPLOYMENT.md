# Interview Demo Deployment

This project can be deployed as a public interview demo on Vercel.

The public demo should use example data only. Do not deploy your private SQLite database or commit `.env` files.

## Vercel Setup

1. Push this repository to GitHub.
2. In Vercel, create a new project from the GitHub repository.
3. If Vercel asks for the project root, choose:

```text
项目工程
```

4. Use these build settings:

```text
Install Command: npm install
Build Command: npm run build
Output Directory: leave empty
```

Vercel runs `server.js` through the Node.js runtime and `vercel.json` routes all requests to it.
5. Add these environment variables in Vercel:

```text
INTERVIEW_DEMO=true
AI_API_KEY=
AI_MODEL=gpt-4.1-mini
```

Optional:

```text
AI_BASE_URL=https://api.openai.com/v1
AI_TIMEOUT_MS=20000
```

## Demo Mode Behavior

When `INTERVIEW_DEMO=true`:

- SQLite uses `/tmp/ai-memory-museum-interview-demo.sqlite`.
- The app seeds four example memories plus one sample exhibition and one sample report draft.
- Delete and purge endpoints are blocked.
- No real private memory is deployed.
- If `AI_API_KEY` is empty, the app uses the local mock workflow.

This is intentional for a resume link: every visitor sees a safe demo instead of your private data.

## Resume Link Format

Use both links on your resume:

```text
Live Demo: https://your-project.vercel.app
GitHub: https://github.com/your-name/ai-memory-museum
```

Suggested description:

```text
AI Memory Museum - Node.js, SQLite, Vanilla JS
Built a local-first memory curation app with SQLite persistence, AI-assisted structuring, import/export, hybrid search, guided Q&A, operational APIs, and release-governance guardrails.
```

## Local Demo Check

Before deploying, run:

```powershell
$env:INTERVIEW_DEMO = "true"
$env:DB_PATH = ""
npm.cmd start
```

Then open:

```text
http://localhost:3000
```

For normal local development, unset `INTERVIEW_DEMO` or set it to `false`.
