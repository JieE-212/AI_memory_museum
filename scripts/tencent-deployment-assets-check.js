"use strict";

const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const dockerfile = read("Dockerfile");
const dockerignore = read(".dockerignore");
const gitignore = read(".gitignore");
const compose = read("deploy/tencent/compose.yml");
const caddy = read("deploy/tencent/Caddyfile");
const environment = read("deploy/tencent/tencent.env.example");
const guide = read("deploy/tencent/README.md");
const app = between(compose, "  app:\n", "\n  caddy:\n");
const proxy = between(compose, "  caddy:\n", "\nvolumes:\n");
let assertions = 0;

check("runtime image stays on Node 24 and executes permanent build checks", /FROM node:24-bookworm-slim AS checks/u.test(dockerfile) && /RUN npm run build/u.test(dockerfile));
check("runtime image contains only required application assets", ["package.json", "server.js", "database.js", "lib", "public"].every((name) => dockerfile.includes(`/app/${name}`)) && /USER node/u.test(dockerfile));
check("Docker context excludes private data and common credentials", ["data", "*.sqlite", "*.time-isle", "*.pem", "*.key", "deploy/tencent/tencent.env"].every((pattern) => dockerignore.includes(pattern)));
check("real Tencent environment file is ignored by Git", gitignore.includes("deploy/tencent/tencent.env"));

check("application container hard-codes the protected public Demo boundary", /PUBLIC_DEPLOYMENT: "true"/u.test(app) && /INTERVIEW_DEMO: "true"/u.test(app) && /ALLOWED_HOSTS: \$\{DOMAIN:\?/u.test(app));
check("application container keeps Demo state on a bounded temporary filesystem", /DB_PATH: \/tmp\/ai-memory-museum-/u.test(app) && /MEDIA_ROOT: \/tmp\/ai-memory-museum-/u.test(app) && /tmpfs:/u.test(app) && /size=536870912/u.test(app));
check("application port is internal-only", /expose:[\s\S]*"3000"/u.test(app) && !/\n    ports:/u.test(app));
check("application container drops write and process privileges", /read_only: true/u.test(app) && /cap_drop:[\s\S]*- ALL/u.test(app) && /no-new-privileges:true/u.test(app) && /mem_limit: 1g/u.test(app) && /pids_limit: 128/u.test(app));
check("application logging is bounded", /driver: local/u.test(app) && /max-size: 10m/u.test(app) && /max-file: "3"/u.test(app));

check("Caddy is the only service publishing web ports", /"80:80"/u.test(proxy) && /"443:443"/u.test(proxy) && /"443:443\/udp"/u.test(proxy));
check("Caddy keeps only its certificate state persistent", /caddy_data:\/data/u.test(proxy) && /caddy_config:\/config/u.test(proxy));
check("Caddy runs with a read-only root and bounded privileges", /read_only: true/u.test(proxy) && /cap_drop:[\s\S]*- ALL/u.test(proxy) && /cap_add:[\s\S]*- NET_BIND_SERVICE/u.test(proxy) && /no-new-privileges:true/u.test(proxy));
check("backend network is internal", /backend:\n    internal: true/u.test(compose));

check("Caddy terminates TLS for the exact configured domain", /\{\$DOMAIN\}/u.test(caddy) && /email \{\$ACME_EMAIL\}/u.test(caddy) && /reverse_proxy app:3000/u.test(caddy) && /header_up Host \{host\}/u.test(caddy));
check("environment template contains no model key or private path", /^DOMAIN=[^\r\n]+/mu.test(environment) && /^ACME_EMAIL=[^\r\n]+/mu.test(environment) && !/^(?:AI_API_KEY|DB_PATH|MEDIA_ROOT)=/mu.test(environment));
check("deployment guide discloses shared temporary text and forbids private content", guide.includes("同一共享实例的其他访客看到") && guide.includes("绝不能输入私人或敏感内容") && guide.includes("不要把 `INTERVIEW_DEMO` 改为 `false`"));
check("deployment guide requires a bare domain and keeps Vercel as fallback", guide.includes("裸 ASCII/Punycode 完整域名") && guide.includes("Vercel 地址继续作为全球备用"));

console.log(`Tencent deployment asset checks passed: ${assertions} assertions.`);

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), "utf8").replace(/\r\n/g, "\n");
}

function between(value, start, end) {
  const from = value.indexOf(start);
  const to = value.indexOf(end, from + start.length);
  if (from < 0 || to < 0) throw new Error(`Deployment section not found: ${start.trim()}`);
  return value.slice(from, to);
}

function check(name, condition) {
  assertions += 1;
  if (!condition) throw new Error(`not ok - ${name}`);
  console.log(`ok - ${name}`);
}
