"use strict";

const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const dockerfile = read("Dockerfile");
const dockerignore = read(".dockerignore");
const gitignore = read(".gitignore");
const environmentText = read("deploy/cloudbase/cloudbase.env.example");
const environment = parseEnvironment(environmentText);
const settings = JSON.parse(read("deploy/cloudbase/console-settings.json"));
const guide = read("deploy/cloudbase/README.md");
let assertions = 0;

check("shared Docker image exposes the CloudBase container port", /EXPOSE 3000/u.test(dockerfile) && /CMD \["node", "server\.js"\]/u.test(dockerfile));
check("shared Docker runtime remains non-root", /USER node/u.test(dockerfile));
check("local CloudBase environment files stay out of Git and Docker contexts", gitignore.includes("deploy/cloudbase/cloudbase.env") && dockerignore.includes("deploy/cloudbase/cloudbase.env"));

const expectedKeys = [
  "NODE_ENV",
  "PUBLIC_DEPLOYMENT",
  "INTERVIEW_DEMO",
  "BIND_HOST",
  "PORT",
  "ALLOWED_HOSTS",
  "DB_PATH",
  "MEDIA_ROOT"
];
check("environment template contains only the eight reviewed runtime variables", canonical([...environment.keys()].sort()) === canonical([...expectedKeys].sort()));
check("environment template hard-codes the protected public Demo boundary", environment.get("NODE_ENV") === "production" && environment.get("PUBLIC_DEPLOYMENT") === "true" && environment.get("INTERVIEW_DEMO") === "true");
check("environment template binds the CloudBase container on port 3000", environment.get("BIND_HOST") === "0.0.0.0" && environment.get("PORT") === "3000");
check("host allowlist placeholder fails closed until explicitly replaced", environment.get("ALLOWED_HOSTS") === "REPLACE_WITH_EXACT_CLOUDBASE_HOST" && environment.get("ALLOWED_HOSTS").includes("_"));
check("Demo database and media stay on temporary storage", environment.get("DB_PATH") === "/tmp/ai-memory-museum-cloudbase-demo.sqlite" && environment.get("MEDIA_ROOT") === "/tmp/ai-memory-museum-cloudbase-demo-media");
check("environment template contains no AI or provider credential", ![...environment.keys()].some((key) => /(?:AI|OPENAI|ANTHROPIC|TOKEN|SECRET|PASSWORD|KEY)/u.test(key)));

check("console manifest selects the repository-root Dockerfile", settings.service?.deploymentMode === "dockerfile" && settings.service?.repositoryContext === "." && settings.service?.dockerfilePath === "Dockerfile");
check("console manifest exposes only the expected application port", settings.service?.containerPort === 3000);
check("console manifest selects the reviewed low-traffic resource size", settings.resources?.cpu === 0.5 && settings.resources?.memoryGiB === 1);
check("console manifest fixes the public service to one scale-to-zero instance", settings.traffic?.publicAccess === true && settings.scaling?.minimumInstances === 0 && settings.scaling?.maximumInstances === 1);
check("console manifest forbids pay-as-you-go upgrades", settings.billing?.resourcePointsOnly === true && settings.billing?.payAsYouGo === false && settings.billing?.stopIfUpgradeIsRequired === true);
check("console manifest routes the HTTPS root path", settings.traffic?.routePath === "/" && settings.traffic?.externalScheme === "https");
check("console manifest uses a TCP health check on the container port", settings.healthCheck?.protocol === "TCP" && settings.healthCheck?.port === 3000);
check("console manifest forbids persistent application state", settings.state?.persistentStorage === false && settings.state?.temporaryDirectory === "/tmp");
check("console manifest points to the reviewed environment template", settings.environmentTemplate === "deploy/cloudbase/cloudbase.env.example");

check("guide identifies the manifest as review-only rather than a CLI import", guide.includes("不是 CloudBase CLI 可导入文件"));
check("guide requires exact HTTPS host configuration", guide.includes("环境 ID 和公开 hostname 不是同一个值") && guide.includes("不要填写 `https://`") && guide.includes("不能只改路由而忘记同步白名单"));
check("guide requires root routing, scale-to-zero, one instance and TCP health", guide.includes("最小实例数为 `0`、最大实例数为 `1`") && guide.includes("根路由 `/`") && guide.includes("健康检查必须使用 `TCP:3000`"));
check("guide fixes the reviewed CloudBase CPU and memory size", guide.includes("0.5 核 / 1 GiB") && guide.includes("约覆盖 50 小时实例存活时间"));
check("guide discloses shared ephemeral visitor data", guide.includes("访客提交的有限临时内容在实例存活期间可能被其他访客看到") && guide.includes("缩容到 0") && guide.includes("不要输入真实姓名"));
check("guide forbids AI keys and private persistence", guide.includes("不配置 `AI_API_KEY`") && guide.includes("不挂载持久卷") && guide.includes("不要添加持久磁盘、云数据库或第二个服务实例"));
check("guide keeps the free trial behind a hard resource-point boundary", guide.includes("每月提供 3000 资源点") && guide.includes("“按量付费”必须始终保持关闭") && guide.includes("要求打开按量付费、充值或升级个人版") && guide.includes("停止条件"));
check("guide keeps resume claims behind real-device acceptance", guide.includes("电脑、手机 Wi-Fi 和手机蜂窝网络") && guide.includes("才能把它更新到简历"));

console.log(`CloudBase deployment asset checks passed: ${assertions} assertions.`);

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), "utf8").replace(/\r\n/g, "\n");
}

function parseEnvironment(value) {
  const entries = new Map();
  for (const [index, rawLine] of value.split("\n").entries()) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const separator = line.indexOf("=");
    if (separator <= 0) throw new Error(`Invalid environment template line ${index + 1}.`);
    const key = line.slice(0, separator).trim();
    const item = line.slice(separator + 1).trim();
    if (!/^[A-Z][A-Z0-9_]*$/u.test(key)) throw new Error(`Invalid environment key on line ${index + 1}: ${key}`);
    if (entries.has(key)) throw new Error(`Duplicate environment key: ${key}`);
    entries.set(key, item);
  }
  return entries;
}

function canonical(value) {
  return JSON.stringify(value);
}

function check(name, condition) {
  assertions += 1;
  if (!condition) throw new Error(`not ok - ${name}`);
  console.log(`ok - ${name}`);
}
