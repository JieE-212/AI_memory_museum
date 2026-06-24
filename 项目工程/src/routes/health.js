function createHealthRoutes(deps) {
  const {
    schemaVersion,
    phase,
    phaseName,
    store,
    operationsService,
    agentRoles,
    sendJson,
    buildPhase10Handoff,
    buildPhase11Handoff,
    buildPhase11WorkflowBlueprint,
    buildPhase12Sovereignty,
    buildPrivacyPolicy,
    isAiConfigured,
    getAiModel
  } = deps;

  function handleHealthRoute(request, response, url) {
    if (request.method !== "GET" || url.pathname !== "/api/health") return false;

    const memories = store.listMemories();
    sendJson(response, 200, {
      ok: true,
      schemaVersion,
      phase,
      phaseName,
      database: {
        enabled: true,
        path: store.dbPath,
        stats: store.getStats(),
        phase10Handoff: buildPhase10Handoff(memories),
        phase11Handoff: buildPhase11Handoff(memories),
        phase12Sovereignty: buildPhase12Sovereignty(memories)
      },
      orchestration: buildPhase11WorkflowBlueprint(memories),
      privacy: buildPrivacyPolicy(memories).summary,
      operations: operationsService.buildOperationsSummary(memories),
      agents: agentRoles.map((role) => role.name),
      aiConfigured: isAiConfigured(),
      model: getAiModel(),
      mode: isAiConfigured() ? "ai" : "mock"
    });
    return true;
  }

  return { handleHealthRoute };
}

module.exports = { createHealthRoutes };
