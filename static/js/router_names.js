(function exposeRouterNameValidation(root) {
  "use strict";

  function validateRouterName(rawName, graph, currentName = null) {
    if (typeof rawName !== "string") throw new Error("Router name must be text.");
    const name = rawName.trim();
    if (!name) throw new Error("Router name cannot be empty.");
    if (name.length > 2) throw new Error("Router names must be one or two characters.");
    if (name !== currentName && Object.hasOwn(graph, name)) {
      throw new Error(`Router “${name}” already exists.`);
    }
    return name;
  }

  const api = { validateRouterName };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) root.NetRouteRouterNames = api;
})(typeof window === "undefined" ? null : window);
