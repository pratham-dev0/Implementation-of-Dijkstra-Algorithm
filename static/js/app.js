(() => {
  "use strict";
  const state = {
    graph: Object.create(null), source: "", destination: "", networkName: "Custom network", presets: [],
    tool: "select", selection: null, pendingLinkStart: null, pendingLink: null,
    cy: null, result: null, history: [], currentStep: 0, playbackTimer: null,
    packetToken: 0, packetFrame: null, pathPulseTimer: null,
  };
  const $ = (id) => document.getElementById(id);
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

  const cloneGraph = (graph) => {
    const copy = Object.create(null);
    Object.entries(graph || {}).forEach(([key, value]) => { copy[key] = Object.assign(Object.create(null), value); });
    return copy;
  };
  const validateRouterName = window.NetRouteRouterNames.validateRouterName;
  const toast = (message, type = "info") => {
    const item = document.createElement("div");
    item.className = `toast ${type === "error" ? "error" : type === "success" ? "success" : ""}`;
    item.textContent = message;
    $("toast-region").append(item);
    setTimeout(() => item.remove(), 3600);
  };
  const showAlert = (message) => { $("api-alert").textContent = message; $("api-alert").classList.remove("hidden"); };
  const clearAlert = () => { $("api-alert").textContent = ""; $("api-alert").classList.add("hidden"); };

  async function api(path, options = {}) {
    let response;
    try {
      response = await fetch(path, {
        ...options,
        headers: { ...(options.body ? { "Content-Type": "application/json" } : {}), ...options.headers },
      });
    } catch (_error) {
      connectionStatus(false);
      throw new Error("Cannot reach the Flask backend. Check that the server is running.");
    }
    connectionStatus(true);
    let data;
    try { data = await response.json(); } catch (_error) { throw new Error("The server returned an unreadable response."); }
    if (!response.ok) throw new Error(data?.error?.message || `Request failed (${response.status}).`);
    return data;
  }
  const bodyFor = (extra = {}) => JSON.stringify({ graph: cloneGraph(state.graph), ...extra });
  function validateCurrentGraph() {
    return api("/api/network/validate", {
      method: "POST",
      body: JSON.stringify({ graph: cloneGraph(state.graph) }),
    });
  }
  const color = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  const formatCost = (value) => value === null || value === undefined || !Number.isFinite(Number(value)) ? "∞" : String(value);

  function connectionStatus(online) {
    $("connection-status").classList.toggle("connected", online);
    $("connection-status").classList.toggle("offline", !online);
    $("connection-label").textContent = online ? "Backend online" : "Backend offline";
  }
  async function checkBackend() {
    try { await api("/api/health"); connectionStatus(true); return true; }
    catch (_error) { connectionStatus(false); return false; }
  }

  function cyStyle() {
    const panel = color("--panel");
    return [
      { selector: "node", style: {
        label: "data(label)", width: 48, height: 48, "background-color": color("--blue"),
        "border-width": 2, "border-color": "rgba(135,185,255,.7)", color: color("--text-strong"),
        "font-size": 13, "font-weight": "bold", "text-valign": "center", "text-halign": "center",
        "text-outline-width": 2, "text-outline-color": panel, "overlay-opacity": 0,
        "transition-property": "background-color, border-color, border-width, width, height", "transition-duration": "180ms",
      } },
      { selector: "node.visited", style: { "background-color": "#8b76cf", "border-color": "#c0b0ff" } },
      { selector: "node.route-path", style: { "border-color": color("--cyan"), "border-width": 3 } },
      { selector: "node.source", style: { "background-color": color("--green") } },
      { selector: "node.destination", style: { "background-color": color("--red") } },
      { selector: "node.current", style: { "background-color": color("--cyan"), "border-color": color("--text-strong"), "border-width": 4, width: 54, height: 54, "z-index": 30 } },
      { selector: "node:selected", style: { "border-color": color("--amber"), "border-width": 5, "z-index": 40 } },
      { selector: "edge", style: {
        label: "data(label)", width: 2, "line-color": color("--border-strong"), "curve-style": "bezier",
        "target-arrow-shape": "none", "source-arrow-shape": "none", color: color("--muted"),
        "font-size": 10, "font-weight": "bold", "text-background-color": panel, "text-background-opacity": 0.95,
        "text-background-padding": 3, "text-rotation": "none", "overlay-opacity": 0,
        "transition-property": "line-color, width", "transition-duration": "180ms",
      } },
      { selector: "edge:selected", style: { "line-color": color("--cyan"), width: 4, "z-index": 20 } },
      { selector: "edge.route-path", style: { "line-color": color("--cyan"), width: 4, "z-index": 10, "line-style": "dashed", "line-dash-pattern": [8, 4], "shadow-blur": 8, "shadow-color": color("--cyan"), "shadow-opacity": 0.45 } },
      { selector: "edge.route-path.route-pulse", style: { width: 5 } },
      { selector: "node.route-path.route-pulse", style: { "border-width": 4 } },
    ];
  }
  const edgeId = (a, b) => [String(a), String(b)].sort().map(encodeURIComponent).join(":");

  function initGraph() {
    if (!window.cytoscape) {
      showAlert("Cytoscape.js did not load. Check your connection and reload the page.");
      toast("Network visualization library is unavailable.", "error");
      return;
    }
    state.cy = cytoscape({
      container: $("cy"), elements: [], style: cyStyle(), layout: { name: "grid", padding: 48 },
      minZoom: 0.3, maxZoom: 3, wheelSensitivity: 0.18, boxSelectionEnabled: true, selectionType: "single",
    });
    state.cy.on("tap", "node", (event) => nodeTap(event.target));
    state.cy.on("tap", "edge", (event) => selectElement(event.target, "edge"));
    state.cy.on("tap", (event) => {
      if (event.target !== state.cy) return;
      if (state.tool === "add-router") openRouterDialog();
      else if (state.tool === "add-link") { state.pendingLinkStart = null; hint("Choose the first router, then the second router to connect."); }
      else clearSelection();
    });
    state.cy.on("drag free", "node", stopPacket);
  }

  function graphElements() {
    const items = [];
    const seen = new Set();
    Object.entries(state.graph).forEach(([router, neighbors]) => {
      items.push({ data: { id: router, label: router } });
      Object.entries(neighbors).forEach(([neighbor, weight]) => {
        const id = edgeId(router, neighbor);
        if (seen.has(id)) return;
        seen.add(id);
        items.push({ data: { id, source: router, target: neighbor, weight, label: formatCost(weight) } });
      });
    });
    return items;
  }
  function countLinks() {
    const links = new Set();
    Object.entries(state.graph).forEach(([router, neighbors]) => Object.keys(neighbors).forEach((neighbor) => links.add(edgeId(router, neighbor))));
    return links.size;
  }
  function renderGraph(layout = false, fresh = false) {
    if (!state.cy) return;
    const oldPositions = new Map(state.cy.nodes().map((node) => [node.id(), { ...node.position() }]));
    state.cy.batch(() => {
      state.cy.elements().remove();
      state.cy.add(graphElements());
      if (!fresh) state.cy.nodes().forEach((node) => { if (oldPositions.has(node.id())) node.position(oldPositions.get(node.id())); });
      state.cy.style(cyStyle()).update();
      endpointClasses();
    });
    $("canvas-empty").classList.toggle("hidden", Object.keys(state.graph).length > 0);
    $("router-count").textContent = Object.keys(state.graph).length;
    $("link-count").textContent = countLinks();
    if (layout && state.cy.nodes().length) state.cy.layout({
      name: $("layout-select").value || "cose", animate: !reduceMotion.matches, animationDuration: 340,
      randomize: fresh, padding: 65, nodeRepulsion: () => 9000, idealEdgeLength: () => 155, fit: true,
    }).run();
    if (fresh) state.cy.fit(undefined, 55);
  }
  function endpointClasses() {
    if (!state.cy) return;
    state.cy.nodes().removeClass("source destination");
    if (state.source && state.cy.getElementById(state.source).length) state.cy.getElementById(state.source).addClass("source");
    if (state.destination && state.cy.getElementById(state.destination).length) state.cy.getElementById(state.destination).addClass("destination");
  }
  function syncEndpoints() {
    const routers = Object.keys(state.graph);
    for (const [id, placeholder] of [["source-select", "Choose source"], ["destination-select", "Choose destination"]]) {
      const select = $(id); select.replaceChildren();
      const empty = new Option(placeholder, ""); select.add(empty);
      routers.forEach((router) => select.add(new Option(router, router)));
    }
    state.source = routers.includes(state.source) ? state.source : (routers[0] || "");
    state.destination = routers.includes(state.destination) ? state.destination : (routers.find((router) => router !== state.source) || state.source || "");
    $("source-select").value = state.source;
    $("destination-select").value = state.destination;
    endpointClasses();
  }

  function hint(message) { $("tool-hint").textContent = message; $("canvas-status").textContent = message; }
  function setTool(tool) {
    state.tool = tool; state.pendingLinkStart = null;
    document.querySelectorAll(".tool-button[data-tool]").forEach((button) => button.classList.toggle("active", button.dataset.tool === tool));
    const hints = { select: "Select a router or link to inspect it.", "add-router": "Click an empty area of the canvas to place a router.", "add-link": "Choose the first router, then the second router to connect." };
    hint(hints[tool]);
  }
  function stopPacket() {
    state.packetToken += 1;
    if (state.packetFrame !== null) cancelAnimationFrame(state.packetFrame);
    state.packetFrame = null;
    $("packet-layer").replaceChildren();
  }
  function stopPlayback() {
    if (state.playbackTimer !== null) clearInterval(state.playbackTimer);
    state.playbackTimer = null;
    $("sim-play").textContent = "▶ Play";
    $("simulation-state").textContent = state.history.length ? "PAUSED" : "IDLE";
    $("simulation-state").classList.remove("running");
  }
  function clearSimulation() {
    stopPlayback(); state.history = []; state.currentStep = 0;
    $("simulation-summary").innerHTML = '<span class="sim-step-number">—</span><span>Generate history to inspect each algorithm step.</span>';
    $("simulation-current").classList.add("hidden");
    $("distance-list").innerHTML = '<p class="muted-copy">No simulation state yet.</p>';
    $("update-list").replaceChildren(); $("distance-update-indicator").textContent = "";
    $("sim-progress").value = 0; $("sim-progress").max = 0; $("sim-progress").disabled = true;
    $("progress-current").textContent = "Step 0"; $("progress-total").textContent = "0 steps";
    ["sim-previous", "sim-play", "sim-next", "sim-reset"].forEach((id) => { $(id).disabled = true; });
    if (state.cy) state.cy.nodes().removeClass("visited current");
    clearIterationTable();
  }
  function clearIterationTable() {
    const head = $("iteration-table-head"), body = $("iteration-table-body");
    if (!head || !body) return;
    head.replaceChildren(); body.replaceChildren();
    const row = document.createElement("tr"), cell = document.createElement("td");
    cell.textContent = "Generate history to view iterations."; row.append(cell); body.append(row);
  }
  function renderIterationTable() {
    const head = $("iteration-table-head"), body = $("iteration-table-body");
    head.replaceChildren(); body.replaceChildren();
    const routers = Object.keys(state.history[0]?.distances || {});
    const header = document.createElement("tr");
    ["Step", "Selected", ...routers].forEach((label) => { const th = document.createElement("th"); th.textContent = label; header.append(th); });
    head.append(header);
    state.history.forEach((step, index) => {
      const row = document.createElement("tr"); row.dataset.stepIndex = index;
      const selected = step.current_router === null ? "Initial" : step.current_router;
      [step.step, selected, ...routers.map((router) => formatCost(step.distances[router]))].forEach((value, column) => {
        const cell = document.createElement(column < 2 ? "th" : "td"); cell.textContent = String(value);
        if (column >= 2 && step.distance_updates.some((update) => update.router === routers[column - 2])) cell.classList.add("distance-updated");
        if (column >= 2 && step.visited_order.includes(routers[column - 2])) cell.classList.add("distance-finalized");
        if (column >= 2 && routers[column - 2] === step.current_router) cell.classList.add("distance-current-router");
        row.append(cell);
      });
      body.append(row);
    });
  }
  function clearResultVisuals() {
    stopPacket();
    if (state.pathPulseTimer !== null) clearInterval(state.pathPulseTimer);
    state.pathPulseTimer = null;
    if (state.cy) {
      state.cy.elements().removeClass("route-path route-pulse");
      state.cy.nodes().removeClass("visited current");
      endpointClasses();
    }
  }
  function clearResults() {
    state.result = null; clearResultVisuals();
    $("result-empty").classList.remove("hidden"); $("result-content").classList.add("hidden"); $("packet-start").disabled = true;
    $("routing-table-body").innerHTML = '<tr><td colspan="4" class="table-empty">Calculate a route to populate the routing table.</td></tr>';
  }
  async function refreshTable() {
    const target = $("routing-table-body");
    if (!state.source || !Object.keys(state.graph).length) {
      target.innerHTML = '<tr><td colspan="4" class="table-empty">Add a network and choose a source router.</td></tr>'; return;
    }
    const data = await api("/api/routing-table", { method: "POST", body: bodyFor({ source: state.source }) });
    target.replaceChildren();
    Object.entries(data.routing_table || {}).forEach(([destination, route]) => {
      const row = document.createElement("tr");
      if (route.cost === null) row.classList.add("unreachable-row");
      [destination, route.next_hop ?? "—", formatCost(route.cost), route.path?.length ? route.path.join(" → ") : "—"].forEach((value, index) => {
        const cell = document.createElement("td"); cell.textContent = value;
        if (index === 1 || index === 3) cell.classList.add("route-cell");
        if (index === 2) cell.classList.add("cost-cell");
        row.append(cell);
      });
      target.append(row);
    });
    if (!target.children.length) target.innerHTML = '<tr><td colspan="4" class="table-empty">No routers in this network.</td></tr>';
  }
  function onGraphChanged(name = "Custom network") {
    stopPacket(); state.networkName = name; $("network-name").textContent = name.toUpperCase();
    clearResults(); clearSimulation(); syncEndpoints(); renderGraph(); clearSelection();
    validateCurrentGraph().then(refreshTable).catch((error) => showAlert(error.message));
  }

  function nodeTap(node) {
    if (state.tool === "add-link") {
      if (!state.pendingLinkStart) { state.pendingLinkStart = node.id(); hint(`Select a second router to connect with ${node.id()}.`); return; }
      if (state.pendingLinkStart === node.id()) { state.pendingLinkStart = null; hint("Choose two different routers to create a link."); return; }
      openLinkDialog(state.pendingLinkStart, node.id()); return;
    }
    if (state.tool !== "add-router") selectElement(node, "node");
  }
  function addBadge(parent, text, className) {
    const badge = document.createElement("span"); badge.className = `router-badge ${className}`; badge.textContent = text; parent.append(badge);
  }
  function selectElement(element, kind) {
    state.cy.$(":selected").unselect(); element.select(); state.selection = { kind, id: element.id() };
    $("delete-selection").disabled = false;
    if (kind === "node") {
      $("router-empty").classList.add("hidden"); $("router-form").classList.remove("hidden");
      $("link-empty").classList.remove("hidden"); $("link-form").classList.add("hidden");
      $("router-selection-tag").textContent = element.id(); $("router-name").value = element.id();
      const badges = $("router-badges"); badges.replaceChildren();
      if (element.id() === state.source) addBadge(badges, "SOURCE", "source-badge");
      if (element.id() === state.destination) addBadge(badges, "DESTINATION", "destination-badge");
    } else {
      const data = element.data();
      $("router-empty").classList.remove("hidden"); $("router-form").classList.add("hidden");
      $("link-empty").classList.add("hidden"); $("link-form").classList.remove("hidden");
      $("link-selection-tag").textContent = `${data.source}—${data.target}`;
      $("link-cost").value = data.weight; $("link-endpoints").textContent = `${data.source} ↔ ${data.target}`;
    }
  }
  function clearSelection() {
    if (state.cy) state.cy.$(":selected").unselect(); state.selection = null; $("delete-selection").disabled = true;
    $("router-empty").classList.remove("hidden"); $("router-form").classList.add("hidden");
    $("link-empty").classList.remove("hidden"); $("link-form").classList.add("hidden");
    $("router-selection-tag").textContent = "NONE"; $("link-selection-tag").textContent = "NONE";
  }
  function nextRouterName() { let i = 1; while (Object.hasOwn(state.graph, `R${i}`)) i += 1; return `R${i}`; }
  function openRouterDialog() { $("new-router-name").value = nextRouterName(); $("router-dialog").showModal(); setTimeout(() => $("new-router-name").select(), 0); }
  function openLinkDialog(a, b) {
    state.pendingLinkStart = null; state.pendingLink = [a, b];
    $("link-from-label").textContent = a; $("link-to-label").textContent = b;
    $("new-link-cost").value = state.graph[a]?.[b] ?? 1;
    $("link-dialog").showModal(); setTimeout(() => $("new-link-cost").focus(), 0);
  }
  function addRouter(rawName) {
    const name = validateRouterName(rawName, state.graph);
    state.graph[name] = Object.create(null); onGraphChanged(); setTool("select"); toast(`Router ${name} added.`, "success");
  }
  function setLink(a, b, weight) {
    if (!state.graph[a] || !state.graph[b]) throw new Error("Both routers must exist before linking them.");
    if (a === b) throw new Error("A router cannot link to itself.");
    if (!Number.isFinite(weight) || weight < 0) throw new Error("Link cost must be a finite, non-negative number.");
    const existed = Object.hasOwn(state.graph[a], b) || Object.hasOwn(state.graph[b], a);
    state.graph[a][b] = weight; state.graph[b][a] = weight; onGraphChanged();
    toast(existed ? "Link cost updated." : `Link ${a} ↔ ${b} created.`, "success");
  }
  function removeSelection() {
    if (!state.selection) return;
    const selected = state.selection;
    if (selected.kind === "node") {
      const router = selected.id; delete state.graph[router];
      Object.values(state.graph).forEach((neighbors) => { delete neighbors[router]; });
      if (state.source === router) state.source = ""; if (state.destination === router) state.destination = "";
      onGraphChanged(); toast(`Router ${router} and its links deleted.`, "success");
    } else {
      const edge = state.cy.getElementById(selected.id).data();
      delete state.graph[edge.source][edge.target]; delete state.graph[edge.target][edge.source];
      onGraphChanged(); toast(`Link ${edge.source} ↔ ${edge.target} deleted.`, "success");
    }
  }
  function renameRouter() {
    if (!state.selection || state.selection.kind !== "node") return;
    const oldName = state.selection.id; const newName = $("router-name").value.trim();
    let validatedName;
    try { validatedName = validateRouterName(newName, state.graph, oldName); }
    catch (error) { return toast(error.message, "error"); }
    if (!validatedName) return;
    if (newName === oldName) return;
    const renamed = Object.create(null);
    Object.entries(state.graph).forEach(([router, neighbors]) => {
      const newKey = router === oldName ? validatedName : router; const updated = Object.create(null);
      Object.entries(neighbors).forEach(([neighbor, weight]) => { updated[neighbor === oldName ? newName : neighbor] = weight; });
      renamed[newKey] = updated;
    });
    state.graph = renamed;
    if (state.source === oldName) state.source = validatedName; if (state.destination === oldName) state.destination = validatedName;
    onGraphChanged(); toast(`Router renamed to ${newName}.`, "success");
  }

  function applyPreset(preset) {
    stopPacket(); state.graph = cloneGraph(preset.graph); state.source = preset.default_source; state.destination = preset.default_destination;
    state.networkName = preset.name; $("network-name").textContent = preset.name.toUpperCase();
    clearResults(); clearSimulation(); syncEndpoints(); renderGraph(true, true); clearIterationTable(); clearSelection(); setTool("select");
    validateCurrentGraph().then(refreshTable).catch((error) => showAlert(error.message)); toast(`${preset.name} loaded.`, "success");
  }
  function selectedPreset() { return state.presets.find((item) => item.id === $("preset-select").value); }
  function renderPresetList() {
    const select = $("preset-select"); select.replaceChildren();
    state.presets.forEach((item, index) => { select.add(new Option(item.name, item.id)); if (index === 0) select.value = item.id; });
    $("preset-description").textContent = selectedPreset()?.description || "Choose a network to see its description.";
  }
  async function loadPresets() {
    try {
      state.presets = (await api("/api/presets")).presets || []; renderPresetList();
      if (state.presets.length) applyPreset(state.presets[0]);
    } catch (error) {
      $("preset-select").replaceChildren(new Option("Presets unavailable", "")); $("preset-description").textContent = error.message; showAlert(error.message);
    }
  }
  function highlightRoute(path) {
    if (!state.cy) return;
    if (state.pathPulseTimer !== null) clearInterval(state.pathPulseTimer);
    state.cy.elements().removeClass("route-path route-pulse");
    path.forEach((router) => state.cy.getElementById(router).addClass("route-path"));
    for (let i = 0; i < path.length - 1; i += 1) {
      state.cy.getElementById(edgeId(path[i], path[i + 1])).addClass("route-path");
    }
    state.pathPulseTimer = setInterval(() => state.cy.elements(".route-path").toggleClass("route-pulse"), 820);
  }
  function renderResult(result) {
    state.result = result; $("result-empty").classList.add("hidden"); $("result-content").classList.remove("hidden");
    $("result-source").textContent = result.source; $("result-destination").textContent = result.destination;
    $("result-state").classList.toggle("no-route", !result.reachable);
    $("result-state-text").textContent = result.reachable ? "Route found" : "No path available";
    $("result-cost").textContent = result.reachable ? formatCost(result.cost) : "∞";
    $("result-visited-count").textContent = result.visited_order.length;
    const pathDisplay = $("result-path"); pathDisplay.replaceChildren();
    if (result.reachable) {
      result.path.forEach((router, index) => {
        const chip = document.createElement("span"); chip.className = "path-node"; chip.textContent = router; pathDisplay.append(chip);
        if (index < result.path.length - 1) { const arrow = document.createElement("span"); arrow.className = "path-separator"; arrow.textContent = "→"; pathDisplay.append(arrow); }
      });
      highlightRoute(result.path);
    } else {
      pathDisplay.textContent = "No route connects these routers.";
      if (state.pathPulseTimer !== null) clearInterval(state.pathPulseTimer);
      state.pathPulseTimer = null;
      if (state.cy) state.cy.elements().removeClass("route-path route-pulse");
    }
    const visited = $("visited-order"); visited.replaceChildren();
    result.visited_order.forEach((router) => { const chip = document.createElement("span"); chip.className = "visited-chip"; chip.textContent = router; visited.append(chip); });
    $("packet-start").disabled = !result.reachable || result.path.length < 2;
  }
  async function calculatePath() {
    clearAlert();
    if (!state.source || !state.destination) return toast("Choose both a source and destination router.", "error");
    $("calculate-path").disabled = true; $("calculate-path").textContent = "Calculating…";
    try {
      const result = await api("/api/shortest-path", { method: "POST", body: bodyFor({ source: state.source, destination: state.destination }) });
      renderResult(result); await refreshTable();
      toast(result.reachable ? `Shortest route found · cost ${formatCost(result.cost)}.` : "No route is available for these endpoints.", result.reachable ? "success" : "info");
    } catch (error) { showAlert(error.message); toast(error.message, "error"); }
    finally { $("calculate-path").disabled = false; $("calculate-path").innerHTML = '<span aria-hidden="true">⌁</span> Calculate shortest path'; }
  }
  function renderStep(index) {
    if (!state.history.length) return;
    state.currentStep = Math.max(0, Math.min(index, state.history.length - 1));
    const step = state.history[state.currentStep]; const last = state.history.length - 1;
    document.querySelectorAll(".iteration-table tr").forEach((row) => row.classList.toggle("iteration-current", Number(row.dataset.stepIndex) === state.currentStep));
    $("sim-progress").value = state.currentStep; $("progress-current").textContent = `Step ${step.step}`; $("progress-total").textContent = `${last} steps`;
    const summary = $("simulation-summary");
    summary.replaceChildren();
    const stepBadge = document.createElement("span");
    stepBadge.className = "sim-step-number";
    stepBadge.textContent = String(step.step);
    const stepDescription = document.createElement("span");
    stepDescription.textContent = step.current_router !== null
      ? `Finalized router ${step.current_router}.`
      : "Initial distances before processing.";
    summary.append(stepBadge, stepDescription);
    $("simulation-current").classList.toggle("hidden", step.current_router === null);
    $("current-router").textContent = step.current_router ?? "—"; $("current-step-text").textContent = step.current_router ? `of ${last}` : "starting state";
    $("distance-update-indicator").textContent = step.distance_updates.length ? `${step.distance_updates.length} update${step.distance_updates.length === 1 ? "" : "s"}` : "No updates";
    const visited = new Set(step.visited_order); const distanceList = $("distance-list"); distanceList.replaceChildren();
    Object.entries(step.distances).forEach(([router, distance]) => {
      const item = document.createElement("div"); item.className = "distance-item";
      if (router === step.current_router) item.classList.add("current"); if (visited.has(router)) item.classList.add("visited");
      const label = document.createElement("span"); label.textContent = router; const value = document.createElement("strong"); value.textContent = formatCost(distance);
      item.append(label, value); distanceList.append(item);
    });
    const updates = $("update-list"); updates.replaceChildren();
    step.distance_updates.forEach((update) => { const chip = document.createElement("span"); chip.className = "update-chip"; chip.textContent = `${update.router}: ${formatCost(update.old_distance)} → ${formatCost(update.new_distance)}`; updates.append(chip); });
    if (state.cy) {
      state.cy.nodes().removeClass("visited current");
      step.visited_order.forEach((router) => state.cy.getElementById(router).addClass("visited"));
      if (step.current_router !== null) state.cy.getElementById(step.current_router).addClass("current"); endpointClasses();
    }
    $("sim-previous").disabled = state.currentStep === 0; $("sim-next").disabled = state.currentStep === last;
    $("sim-reset").disabled = state.currentStep === 0; $("sim-progress").disabled = false;
  }
  async function runSimulation() {
    clearAlert(); if (!state.source) return toast("Choose a source router before running the simulation.", "error");
    stopPlayback(); $("sim-run").disabled = true; $("sim-run").textContent = "Building history…";
    try {
      const result = await api("/api/simulate", { method: "POST", body: bodyFor({ source: state.source }) });
      state.history = result.steps || []; renderIterationTable(); $("sim-progress").max = Math.max(0, state.history.length - 1);
      ["sim-previous", "sim-play", "sim-next", "sim-reset"].forEach((id) => { $(id).disabled = !state.history.length; });
      if (state.history.length) renderStep(0); $("simulation-state").textContent = "READY";
      toast("Execution history loaded from Flask.", "success");
    } catch (error) { showAlert(error.message); toast(error.message, "error"); }
    finally { $("sim-run").disabled = false; $("sim-run").textContent = "▣ Generate execution history"; }
  }
  function playback() {
    if (state.playbackTimer !== null) { stopPlayback(); return; }
    if (!state.history.length) return;
    if (state.currentStep >= state.history.length - 1) renderStep(0);
    $("sim-play").textContent = "Ⅱ Pause"; $("simulation-state").textContent = "PLAYING"; $("simulation-state").classList.add("running");
    state.playbackTimer = setInterval(() => {
      if (state.currentStep >= state.history.length - 1) return stopPlayback();
      renderStep(state.currentStep + 1); if (state.currentStep >= state.history.length - 1) stopPlayback();
    }, 920);
  }

  function stopPacket() {
    state.packetToken += 1;
    if (state.packetFrame !== null) cancelAnimationFrame(state.packetFrame);
    state.packetFrame = null; $("packet-layer").replaceChildren();
  }
  async function forwardPacket() {
    if (!state.result?.reachable || state.result.path.length < 2 || !state.cy) return;
    stopPacket(); const token = state.packetToken;
    const marker = document.createElement("span"); marker.className = "packet"; $("packet-layer").append(marker);
    if (reduceMotion.matches) { marker.remove(); return toast("Packet forwarding completed along the highlighted route.", "success"); }
    const path = state.result.path;
    for (let i = 0; i < path.length - 1; i += 1) {
      if (token !== state.packetToken) return;
      const startNode = state.cy.getElementById(path[i]); const endNode = state.cy.getElementById(path[i + 1]);
      if (!startNode.length || !endNode.length) break;
      const start = startNode.renderedPosition(); const end = endNode.renderedPosition(); const began = performance.now();
      const completed = await new Promise((resolve) => {
        const tick = (now) => {
          if (token !== state.packetToken) return resolve(false);
          const progress = Math.min(1, (now - began) / 560); const eased = progress * (2 - progress);
          marker.style.transform = `translate(${start.x + (end.x - start.x) * eased}px, ${start.y + (end.y - start.y) * eased}px) translate(-50%, -50%)`;
          if (progress < 1) state.packetFrame = requestAnimationFrame(tick); else resolve(true);
        };
        state.packetFrame = requestAnimationFrame(tick);
      });
      if (!completed) return;
    }
    if (token === state.packetToken) { marker.remove(); toast("Packet arrived at the destination.", "success"); }
  }
  function setTheme(theme) {
    document.documentElement.dataset.theme = theme; const dark = theme === "dark";
    $("theme-toggle").setAttribute("aria-label", `Switch to ${dark ? "light" : "dark"} theme`);
    $("theme-toggle").title = `Switch to ${dark ? "light" : "dark"} theme`;
    document.querySelector(".theme-glyph").textContent = dark ? "☼" : "☾";
    document.querySelector('meta[name="theme-color"]').content = dark ? "#0b1220" : "#f2f5fa";
    try { localStorage.setItem("netroute-theme", theme); } catch (_error) { /* Storage may be disabled. */ }
    if (state.cy) state.cy.style(cyStyle()).update();
  }
  function bind() {
    document.querySelectorAll(".tool-button[data-tool]").forEach((button) => button.addEventListener("click", () => setTool(button.dataset.tool)));
    $("empty-add-router").addEventListener("click", openRouterDialog);
    $("delete-selection").addEventListener("click", removeSelection);
    $("rename-router").addEventListener("click", renameRouter);
    $("calculate-path").addEventListener("click", calculatePath);
    $("refresh-table").addEventListener("click", () => refreshTable().catch((error) => toast(error.message, "error")));
    $("sim-run").addEventListener("click", runSimulation);
    $("sim-play").addEventListener("click", playback);
    $("sim-next").addEventListener("click", () => renderStep(state.currentStep + 1));
    $("sim-previous").addEventListener("click", () => renderStep(state.currentStep - 1));
    $("sim-reset").addEventListener("click", () => { stopPlayback(); renderStep(0); });
    $("sim-progress").addEventListener("input", (event) => { stopPlayback(); renderStep(Number(event.target.value)); });
    $("packet-start").addEventListener("click", forwardPacket);
    $("fit-canvas").addEventListener("click", () => state.cy?.fit(undefined, 48));
    $("zoom-in").addEventListener("click", () => { if (state.cy) state.cy.zoom({ level: state.cy.zoom() * 1.2, renderedPosition: { x: state.cy.width() / 2, y: state.cy.height() / 2 } }); });
    $("zoom-out").addEventListener("click", () => { if (state.cy) state.cy.zoom({ level: state.cy.zoom() / 1.2, renderedPosition: { x: state.cy.width() / 2, y: state.cy.height() / 2 } }); });
    $("layout-select").addEventListener("change", () => {
      if (state.cy?.nodes().length) state.cy.layout({ name: $("layout-select").value, animate: !reduceMotion.matches, animationDuration: 320, padding: 55 }).run();
    });
    $("preset-select").addEventListener("change", () => { $("preset-description").textContent = selectedPreset()?.description || "Choose a network to see its description."; });
    $("load-preset").addEventListener("click", () => { const preset = selectedPreset(); if (preset) applyPreset(preset); });
    $("clear-network").addEventListener("click", () => {
      state.graph = Object.create(null); state.source = ""; state.destination = ""; onGraphChanged(); setTool("select"); toast("Network cleared.");
    });
    $("update-link").addEventListener("click", () => {
      if (!state.selection || state.selection.kind !== "edge") return;
      const raw = $("link-cost").value; const weight = Number(raw);
      if (raw === "" || !Number.isFinite(weight) || weight < 0) return toast("Link cost must be finite and non-negative.", "error");
      const edge = state.cy.getElementById(state.selection.id).data(); setLink(edge.source, edge.target, weight);
    });
    $("source-select").addEventListener("change", () => {
      state.source = $("source-select").value; clearResults(); clearSimulation(); endpointClasses();
      validateCurrentGraph().then(refreshTable).catch((error) => showAlert(error.message));
    });
    $("destination-select").addEventListener("change", () => { state.destination = $("destination-select").value; clearResults(); endpointClasses(); });
    $("theme-toggle").addEventListener("click", () => setTheme(document.documentElement.dataset.theme === "dark" ? "light" : "dark"));
    $("mobile-menu-toggle").addEventListener("click", () => {
      const open = $("sidebar").classList.toggle("open"); $("mobile-menu-toggle").setAttribute("aria-expanded", String(open));
    });
    document.querySelectorAll(".topnav a").forEach((link) => link.addEventListener("click", () => {
      $("sidebar").classList.remove("open"); $("mobile-menu-toggle").setAttribute("aria-expanded", "false");
    }));
    $("router-dialog-form").addEventListener("submit", (event) => {
      event.preventDefault();
      if (event.submitter?.value === "cancel") return $("router-dialog").close();
      try { addRouter($("new-router-name").value); $("router-dialog").close(); }
      catch (error) { toast(error.message, "error"); }
    });
    $("link-dialog-form").addEventListener("submit", (event) => {
      event.preventDefault();
      if (event.submitter?.value === "cancel") return $("link-dialog").close();
      const raw = $("new-link-cost").value; const weight = Number(raw);
      if (raw === "" || !Number.isFinite(weight) || weight < 0) return toast("Link cost must be finite and non-negative.", "error");
      try { setLink(...state.pendingLink, weight); $("link-dialog").close(); }
      catch (error) { toast(error.message, "error"); }
    });
    window.addEventListener("resize", () => state.cy?.resize());
  }

  async function init() {
    try { setTheme(localStorage.getItem("netroute-theme") === "light" ? "light" : "dark"); }
    catch (_error) { setTheme("dark"); }
    initGraph(); bind();
    await checkBackend();
    await loadPresets();
  }
  document.addEventListener("DOMContentLoaded", init);
})();







