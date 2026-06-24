function createOperationsRoutes(deps) {
  const {
    listMemories,
    operationsService,
    sendJson
  } = deps;

  function handleOperationsRoute(request, response, url) {
    if (request.method !== "GET") return false;

    if (url.pathname === "/api/version") {
      sendJson(response, 200, operationsService.buildVersionInfo(listMemories()));
      return true;
    }

    if (url.pathname === "/api/operations") {
      sendJson(response, 200, operationsService.buildOperationsConsole(listMemories()));
      return true;
    }

    if (url.pathname === "/api/operations/export") {
      sendJson(response, 200, operationsService.buildOperationsExport(listMemories()));
      return true;
    }

    return false;
  }

  return { handleOperationsRoute };
}

module.exports = { createOperationsRoutes };
