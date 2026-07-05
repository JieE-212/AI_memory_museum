const fs = require("fs");
const path = require("path");

const projectRoot = path.resolve(__dirname, "..");
const workspaceRoot = path.resolve(projectRoot, "..");

function readText(...parts) {
  return fs.readFileSync(path.join(...parts), "utf8");
}

function assert(label, condition) {
  if (!condition) {
    console.error(`not ok - ${label}`);
    process.exit(1);
  }
  console.log(`ok - ${label}`);
}

const server = readText(projectRoot, "server.js");
const operations = readText(projectRoot, "src", "services", "operations.js");
const packageJson = JSON.parse(readText(projectRoot, "package.json"));
const readme = readText(projectRoot, "README.md");
const plan = readText(workspaceRoot, "项目文档", "项目规划.md");
const whitepaper = readText(workspaceRoot, "项目文档", "项目白皮书.md");
const hygiene = readText(workspaceRoot, "项目文档", "工程卫生收口记录.md");
const evidencePack = readText(workspaceRoot, "项目文档", "阶段30人工复核证据包.md");
const closureReview = readText(workspaceRoot, "项目文档", "阶段30收口审查包.md");
const rcBrief = readText(workspaceRoot, "项目文档", "阶段30候选交付说明.md");
const evidenceWorksheet = readText(workspaceRoot, "项目文档", "阶段30人工复核证据填写表.md");
const rcFreeze = readText(workspaceRoot, "项目文档", "阶段30RC冻结清单.md");
const evidenceIntakePlan = readText(workspaceRoot, "项目文档", "阶段30人工证据收集计划.md");
const evidenceIntakeRegister = readText(workspaceRoot, "项目文档", "阶段30人工证据收集登记表.md");
const evidenceSubmissionGate = readText(workspaceRoot, "项目文档", "阶段30人工证据提交门禁.md");
const evidenceSubmissionTemplate = readText(workspaceRoot, "项目文档", "阶段30人工证据提交样例.json");
const reviewerHandoff = readText(workspaceRoot, "项目文档", "阶段30人工Reviewer交接包.md");
const gitFlatteningDecision = readText(workspaceRoot, "项目文档", "仓库扁平化确认记录.md");
const gitFlatteningPreflight = readText(workspaceRoot, "项目文档", "仓库索引迁移预检清单.md");
const gitFlatteningMigrationPlan = readText(workspaceRoot, "项目文档", "仓库索引迁移执行方案.md");
const docsOwnershipDecision = readText(workspaceRoot, "项目文档", "文档归属决策记录.md");

assert("phase 30 closure review does not change the active runtime phase", server.includes("const PHASE = 29"));
assert("phase 30 closure review does not change version identity", packageJson.version === "1.9.48" && server.includes('const APP_VERSION = "1.9.48"') && server.includes('const BUILD_LABEL = "phase29-release-exit-final-archive-manifest-preview"'));
assert("package exposes phase 30 closure review check", packageJson.scripts["phase30:closure-review"] === "node scripts/phase30-closure-review.js");
assert("package exposes phase 30 RC freeze check", packageJson.scripts["phase30:rc-freeze"] === "node scripts/phase30-rc-freeze.js");
assert("package exposes phase 30 evidence intake readiness", packageJson.scripts["phase30:evidence-intake-readiness"] === "node scripts/phase30-evidence-intake-readiness.js");
assert("package exposes phase 30 evidence intake register", packageJson.scripts["phase30:evidence-intake-register"] === "node scripts/phase30-evidence-intake-register.js");
assert("package exposes phase 30 evidence submission gate", packageJson.scripts["phase30:evidence-submission-gate"] === "node scripts/phase30-evidence-submission-gate.js");
assert("package exposes phase 30 evidence submission template", packageJson.scripts["phase30:evidence-submission-template"] === "node scripts/phase30-evidence-submission-template.js");
assert("package exposes phase 30 reviewer handoff", packageJson.scripts["phase30:reviewer-handoff"] === "node scripts/phase30-reviewer-handoff.js");
assert("package exposes git flattening preflight", packageJson.scripts["git:flattening-preflight"] === "node scripts/git-flattening-preflight.js");
assert("package exposes git flattening migration plan", packageJson.scripts["git:flattening-migration-plan"] === "node scripts/git-flattening-migration-plan.js");
assert("package exposes docs ownership check", packageJson.scripts["docs:ownership-check"] === "node scripts/docs-ownership-check.js");
assert("package exposes staged index check", packageJson.scripts["git:flattening-index-staged-check"] === "node scripts/git-flattening-index-staged-check.js");
assert("check pipeline includes phase 30 closure review", packageJson.scripts.check.includes("node scripts/phase30-closure-review.js"));
assert("check pipeline includes phase 30 RC freeze", packageJson.scripts.check.includes("node scripts/phase30-rc-freeze.js"));
assert("check pipeline includes phase 30 evidence intake readiness", packageJson.scripts.check.includes("node scripts/phase30-evidence-intake-readiness.js"));
assert("check pipeline includes phase 30 evidence intake register", packageJson.scripts.check.includes("node scripts/phase30-evidence-intake-register.js"));
assert("check pipeline includes phase 30 evidence submission gate", packageJson.scripts.check.includes("node scripts/phase30-evidence-submission-gate.js"));
assert("check pipeline includes phase 30 evidence submission template", packageJson.scripts.check.includes("node scripts/phase30-evidence-submission-template.js"));
assert("check pipeline includes phase 30 reviewer handoff", packageJson.scripts.check.includes("node scripts/phase30-reviewer-handoff.js"));
assert("README declares phase 30 closure review", readme.includes("Phase 30 closure review package: active") && readme.includes("不是 release approval"));
assert("README declares phase 30 candidate delivery materials", readme.includes("Phase 30 release candidate brief: active") && readme.includes("Phase 30 human review evidence worksheet: active"));
assert("README declares phase 30 RC freeze and intake register", readme.includes("Phase 30 RC freeze checklist: active") && readme.includes("Phase 30 human evidence intake register: active"));
assert("README declares phase 30 evidence submission gate", readme.includes("Phase 30 human evidence submission gate: active") && readme.includes("not release approval"));
assert("README declares phase 30 evidence submission template", readme.includes("Phase 30 human evidence submission template: active") && readme.includes("template-only"));
assert("README declares phase 30 reviewer handoff", readme.includes("Phase 30 human reviewer handoff package: active") && readme.includes("handoff-only"));
assert("project plan declares phase 30 closure review", plan.includes("Phase 30 closure review package: active") && plan.includes("阶段30收口审查包.md"));
assert("project plan links candidate delivery materials", plan.includes("Phase 30 release candidate brief: active") && plan.includes("阶段30候选交付说明.md") && plan.includes("阶段30人工复核证据填写表.md"));
assert("project plan records accepted git path shape", plan.includes("Git path shape decision: active") && plan.includes("仓库扁平化确认记录.md") && plan.includes("索引迁移提交已完成"));
assert("project plan links RC freeze and intake register", plan.includes("阶段30RC冻结清单.md") && plan.includes("阶段30人工证据收集计划.md") && plan.includes("阶段30人工证据收集登记表.md"));
assert("project plan links evidence submission gate", plan.includes("阶段30人工证据提交门禁.md") && plan.includes("data/phase30-human-evidence-submission.json"));
assert("project plan links evidence submission template", plan.includes("阶段30人工证据提交样例.json") && plan.includes("2.0.13 / phase30-human-evidence-submission-template"));
assert("project plan links reviewer handoff", plan.includes("阶段30人工Reviewer交接包.md") && plan.includes("2.0.14 / phase30-human-reviewer-handoff-package"));
assert("whitepaper explains closure review is not release approval", whitepaper.includes("Phase 30 closure review package: active") && whitepaper.includes("不代表发布批准"));
assert("whitepaper explains candidate delivery is not release", whitepaper.includes("Phase 30 release candidate brief: active") && whitepaper.includes("rc-reviewable-but-not-releasable"));
assert("whitepaper records accepted git path shape", whitepaper.includes("Git path shape decision: active") && whitepaper.includes("索引迁移已提交") && whitepaper.includes("不代表正式 release"));
assert("whitepaper explains evidence intake register is not approval", whitepaper.includes("Phase 30 human evidence intake register: active") && whitepaper.includes("不代表任何 evidence slot 已通过"));
assert("whitepaper explains evidence submission gate is not approval", whitepaper.includes("Phase 30 human evidence submission gate: active") && whitepaper.includes("格式通过仍不代表 release approval"));
assert("whitepaper explains evidence submission template is not live", whitepaper.includes("Phase 30 human evidence submission template: active") && whitepaper.includes("不是 live submission"));
assert("whitepaper explains reviewer handoff is not signoff", whitepaper.includes("Phase 30 human reviewer handoff package: active") && whitepaper.includes("不代表签核完成"));
assert("closure review package declares 2.0.7 identity", closureReview.includes("2.0.7 / phase30-closure-review-package") && closureReview.includes("Phase 30 closure review package: active"));
assert("closure review package blocks release and runtime", closureReview.includes("releaseReady=false") && closureReview.includes("phase29ExitReady=false") && closureReview.includes("phase30EntryReady=false") && closureReview.includes("runtimeExecution=false") && closureReview.includes("thirdPartyExecution=false"));
assert("closure review package keeps git migration human-owned", closureReview.includes("不执行 `git reset`") && closureReview.includes("不执行 `git add -A`") && closureReview.includes("mutate-git-index-without-human-confirmation"));
assert("closure review package records accepted git path shape", closureReview.includes("gitPathShape=accepted-flattened-project-root") && closureReview.includes("gitIndexMigration=committed-flattened-project-root") && closureReview.includes("仓库扁平化确认记录.md"));
assert("closure review package references git preflight without release commit", closureReview.includes("仓库索引迁移预检清单.md") && closureReview.includes("indexMutation=committed-path-migration"));
assert("closure review package references migration plan without execution", closureReview.includes("仓库索引迁移执行方案.md") && closureReview.includes("docsOwnershipDecision=docs-in-repo") && closureReview.includes("outsideMirrorRetained=true"));
assert("closure review package records docs ownership decision", closureReview.includes("文档归属决策记录.md") && closureReview.includes("docs:ownership-check") && closureReview.includes("indexMutation=committed-path-migration"));
assert("closure review package records committed index check", closureReview.includes("git:flattening-index-staged-check") && closureReview.includes("commitCreated=true"));
assert("closure review package defines RC boundary", closureReview.includes("Release Candidate 边界") && closureReview.includes("不能作为正式 release") && closureReview.includes("任何 check pass 都不能转换为人工批准"));
assert("closure review package defines human evidence execution list", closureReview.includes("release-blocker-disposition") && closureReview.includes("runtime-owner-go-no-go") && closureReview.includes("secret-boundary-review") && closureReview.includes("audit-dry-run-review"));
assert("closure review package forbids runtime mutation", closureReview.includes("enable-runtimeExecution") && closureReview.includes("enable-thirdPartyExecution") && closureReview.includes("execute-real-third-party-plugin") && closureReview.includes("persist-runtime-state"));
assert("closure review package defines completion standard", closureReview.includes("phase30:closure-review") && closureReview.includes("npm.cmd run check") && closureReview.includes("Phase 30 human review execution ledger"));
assert("release candidate brief declares not releasable", rcBrief.includes("2.0.8 / phase30-release-candidate-brief") && rcBrief.includes("rc-reviewable-but-not-releasable") && rcBrief.includes("Phase 30 release candidate brief is not release approval"));
assert("release candidate brief preserves disabled scope", rcBrief.includes("Phase 30 implementation entry") && rcBrief.includes("runtime execution") && rcBrief.includes("third-party execution") && rcBrief.includes("不是正式 release"));
assert("release candidate brief forbids false claims", rcBrief.includes("已经正式发布") && rcBrief.includes("第三方插件可以执行") && rcBrief.includes("检查通过等同于人工批准"));
assert("release candidate brief records committed git index migration", rcBrief.includes("仓库扁平化确认记录.md") && rcBrief.includes("git 路径形态已确认接受") && rcBrief.includes("索引迁移提交已完成"));
assert("release candidate brief references RC freeze and intake plan", rcBrief.includes("阶段30RC冻结清单.md") && rcBrief.includes("阶段30人工证据收集计划.md") && rcBrief.includes("rc-reviewable-but-not-releasable"));
assert("release candidate brief references intake register", rcBrief.includes("阶段30人工证据收集登记表.md") && rcBrief.includes("pendingSlots=10") && rcBrief.includes("approvedSlots=0"));
assert("RC freeze checklist remains not releasable", rcFreeze.includes("2.0.9 / phase30-rc-freeze-checklist") && rcFreeze.includes("rc-reviewable-but-not-releasable") && rcFreeze.includes("releaseReady=false"));
assert("RC freeze checklist preserves pending evidence", rcFreeze.includes("10 个人工 evidence slots") && rcFreeze.includes("pending") && rcFreeze.includes("evidenceRef"));
assert("evidence intake plan keeps all slots pending", evidenceIntakePlan.includes("2.0.10 / phase30-human-evidence-intake-plan") && evidenceIntakePlan.includes("currentDisposition=pending") && evidenceIntakePlan.includes("reviewer=unassigned"));
assert("evidence intake plan defines required fields", evidenceIntakePlan.includes("evidenceRef") && evidenceIntakePlan.includes("reviewedAt") && evidenceIntakePlan.includes("decisionReason") && evidenceIntakePlan.includes("residualRisk"));
assert("evidence intake register keeps all slots pending", evidenceIntakeRegister.includes("2.0.11 / phase30-human-evidence-intake-register") && evidenceIntakeRegister.includes("pendingSlots=10") && evidenceIntakeRegister.includes("approvedSlots=0"));
assert("evidence intake register forbids automatic approval", evidenceIntakeRegister.includes("no automatic approval") && evidenceIntakeRegister.includes("mark-releaseReady-true") && evidenceIntakeRegister.includes("enable-runtimeExecution"));
assert("evidence submission gate is ready but not submitted", evidenceSubmissionGate.includes("2.0.12 / phase30-human-evidence-submission-gate") && evidenceSubmissionGate.includes("submissionStatus=not-submitted") && evidenceSubmissionGate.includes("format-gate-ready-but-evidence-not-submitted"));
assert("evidence submission gate forbids approval conversion", evidenceSubmissionGate.includes("convert-format-valid-to-release-approval") && evidenceSubmissionGate.includes("convert-format-valid-to-runtime-go"));
assert("evidence submission template remains offline only", evidenceSubmissionTemplate.includes("2.0.13 / phase30-human-evidence-submission-template") && evidenceSubmissionTemplate.includes("template-only-not-human-submission") && evidenceSubmissionTemplate.includes("REPLACE_WITH_REAL_REVIEWER"));
assert("reviewer handoff remains assignment only", reviewerHandoff.includes("2.0.14 / phase30-human-reviewer-handoff-package") && reviewerHandoff.includes("handoffOnly=true") && (reviewerHandoff.includes("not live submission") || reviewerHandoff.includes("不是 live submission")));
assert("reviewer handoff covers all roles", reviewerHandoff.includes("release owner") && reviewerHandoff.includes("runtime owner") && reviewerHandoff.includes("security reviewer") && reviewerHandoff.includes("data steward") && reviewerHandoff.includes("audit reviewer"));
assert("reviewer handoff covers all required slots", reviewerHandoff.includes("release-blocker-disposition") && reviewerHandoff.includes("runtime-owner-go-no-go") && reviewerHandoff.includes("private-memory-boundary-review") && reviewerHandoff.includes("audit-dry-run-review"));
assert("human evidence worksheet is pending template only", evidenceWorksheet.includes("2.0.8 / phase30-human-review-evidence-worksheet") && evidenceWorksheet.includes("Phase 30 human review evidence worksheet is not human signoff") && evidenceWorksheet.includes("pending"));
assert("human evidence worksheet covers all required slots", evidenceWorksheet.includes("release-blocker-disposition") && evidenceWorksheet.includes("runtime-owner-go-no-go") && evidenceWorksheet.includes("private-memory-boundary-review") && evidenceWorksheet.includes("audit-dry-run-review"));
assert("human evidence worksheet requires reviewer fields", evidenceWorksheet.includes("evidenceRef") && evidenceWorksheet.includes("reviewer") && evidenceWorksheet.includes("reviewedAt") && evidenceWorksheet.includes("decisionReason") && evidenceWorksheet.includes("residualRisk"));
assert("git flattening decision records accepted root", gitFlatteningDecision.includes("accepted-flattened-project-root") && gitFlatteningDecision.includes("项目工程") && gitFlatteningDecision.includes("gitIndexMigration=committed-flattened-project-root"));
assert("git flattening decision remains non-destructive", gitFlatteningDecision.includes("git reset --hard") && gitFlatteningDecision.includes("git add -A") && gitFlatteningDecision.includes("releaseCommit=blocked-until-human-release-approval"));
assert("git flattening preflight records committed index migration", gitFlatteningPreflight.includes("git-flattening-preflight") && gitFlatteningPreflight.includes("gitIndexMigration=committed-flattened-project-root") && gitFlatteningPreflight.includes("indexMutation=committed-path-migration"));
assert("git flattening preflight remains read-only", gitFlatteningPreflight.includes("git add -A") && gitFlatteningPreflight.includes("git commit") && gitFlatteningPreflight.includes("git reset --hard") && gitFlatteningPreflight.includes("runtime execution enablement"));
assert("git flattening migration plan records docs ownership decision", gitFlatteningMigrationPlan.includes("git-flattening-migration-plan") && gitFlatteningMigrationPlan.includes("docsOwnershipDecision=docs-in-repo") && gitFlatteningMigrationPlan.includes("outsideMirrorRetained=true"));
assert("git flattening migration plan records committed migration", gitFlatteningMigrationPlan.includes("indexMutation=committed-path-migration") && gitFlatteningMigrationPlan.includes("不执行 `git add -A`") && gitFlatteningMigrationPlan.includes("不执行 release commit"));
assert("docs ownership decision records in-repo ownership", docsOwnershipDecision.includes("docsOwnershipDecision=docs-in-repo") && docsOwnershipDecision.includes("outsideMirrorRetained=true") && docsOwnershipDecision.includes("gitIndexMigration=committed-flattened-project-root"));
assert("docs ownership decision remains release-gated", docsOwnershipDecision.includes("indexMutation=committed-path-migration") && docsOwnershipDecision.includes("git add -A") && docsOwnershipDecision.includes("release"));
assert("engineering hygiene records accepted git path with committed migration", hygiene.includes("gitPathShape=accepted-flattened-project-root") && hygiene.includes("gitIndexMigration=committed-flattened-project-root") && hygiene.includes("不建议制作正式 release commit"));
assert("engineering hygiene records git preflight state", hygiene.includes("仓库索引迁移预检清单.md") && hygiene.includes("indexMutation=committed-path-migration") && hygiene.includes("git-flattening-preflight.js"));
assert("engineering hygiene records migration plan docs boundary", hygiene.includes("仓库索引迁移执行方案.md") && hygiene.includes("docsOwnershipDecision=docs-in-repo") && hygiene.includes("outsideMirrorRetained=true"));
assert("engineering hygiene records candidate delivery remains not releasable", hygiene.includes("rc-reviewable-but-not-releasable") && hygiene.includes("不代表人工签核完成"));
assert("evidence pack remains pending and no-signoff", evidencePack.includes("Human evidence remains pending") && evidencePack.includes("No human signoff is granted"));
assert("operations ledger remains read-only pending", operations.includes("readonly-human-review-execution-ledger-no-signoff") && operations.includes("pendingSlots") && operations.includes("evidenceRef: \"missing\"") && operations.includes("reviewer: \"unassigned\""));

console.log("Phase 30 closure review checks passed.");
