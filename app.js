const GPX_NS = "http://www.topografix.com/GPX/1/1";
const XSI_NS = "http://www.w3.org/2001/XMLSchema-instance";
const EARTH_RADIUS_METERS = 6371000;

const state = {
  segments: [],
  map: null,
  mobileMap: null,
  activePanel: "segments-panel",
  draggedSegmentId: null,
  layers: {
    desktop: null,
    mobile: null,
  },
};

const elements = {
  file: document.querySelector("#gpx-file"),
  segments: document.querySelector("#segments"),
  segmentCount: document.querySelector("#segment-count"),
  totalDistance: document.querySelector("#total-distance"),
  totalDistanceKm: document.querySelector("#total-distance-km"),
  validationSummary: document.querySelector("#validation-summary"),
  validationList: document.querySelector("#validation-list"),
  threshold: document.querySelector("#join-threshold"),
  duplicateWaypoints: document.querySelector("#duplicate-waypoints"),
  skipDuplicateJoinPoints: document.querySelector("#skip-duplicate-join-points"),
  darkMode: document.querySelector("#dark-mode"),
  downloadGpx: document.querySelector("#download-gpx"),
  downloadKml: document.querySelector("#download-kml"),
  downloadGeoJson: document.querySelector("#download-geojson"),
  clear: document.querySelector("#clear-all"),
  routeName: document.querySelector("#route-name"),
  drawer: document.querySelector("#app-drawer"),
  menuRail: document.querySelector(".menu-rail"),
  railClose: document.querySelector(".rail-close"),
  workspace: document.querySelector(".workspace"),
  segmentsPanel: document.querySelector("#segments-panel"),
  segmentsDropZone: document.querySelector("#segments-drop-zone"),
  uploadButton: document.querySelector("#upload-button"),
  menuToggle: document.querySelector(".menu-toggle"),
  menuItems: Array.from(document.querySelectorAll(".menu-item")),
  drawerPanels: Array.from(document.querySelectorAll(".drawer-panel")),
};

const STRIKETHROUGH_TITLE = "r̶o̶u̶t̶e̶/̶s̶p̶l̶i̶c̶e̶r̶";

function formatLocalDateYYYYMMDD(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}${month}${day}`;
}

function getDefaultRouteName() {
  return `${formatLocalDateYYYYMMDD(new Date())}-route-splicer-output`;
}

function initializePageChrome() {
  document.title = STRIKETHROUGH_TITLE;
  const defaultName = getDefaultRouteName();
  elements.routeName.placeholder = defaultName;
  elements.routeName.value = elements.routeName.value.trim() || defaultName;
  initializeTheme();
  unregisterLegacyDownloadWorker();
}

function initializeTheme() {
  const isDark = localStorage.getItem("route-splicer-theme") === "dark";
  elements.darkMode.checked = isDark;
  applyTheme(isDark);
}

function applyTheme(isDark) {
  document.documentElement.classList.toggle("dark-mode", isDark);
  localStorage.setItem("route-splicer-theme", isDark ? "dark" : "light");
}

function unregisterLegacyDownloadWorker() {
  if (!("serviceWorker" in navigator)) {
    return;
  }

  navigator.serviceWorker
    .getRegistration()
    .then((registration) => registration?.unregister())
    .catch(() => {});
}

function initMap() {
  state.map = createMap("map");
  state.mobileMap = createMap("mobile-map");

  state.layers.desktop = createLayerSet(state.map);
  state.layers.mobile = createLayerSet(state.mobileMap);
}

function createMap(elementId) {
  const map = L.map(elementId, {
    scrollWheelZoom: true,
    zoomControl: true,
  }).setView([42.87879, -71.61505], 14);

  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
  }).addTo(map);

  return map;
}

function createLayerSet(map) {
  return {
    inputs: L.layerGroup().addTo(map),
    output: L.layerGroup().addTo(map),
    warnings: L.layerGroup().addTo(map),
  };
}

function metersToMiles(meters) {
  return meters / 1609.344;
}

function metersToKm(meters) {
  return meters / 1000;
}

function formatDistance(meters) {
  return `${metersToMiles(meters).toFixed(2)} mi / ${metersToKm(meters).toFixed(2)} km`;
}

function haversineMeters(a, b) {
  const toRad = (value) => (value * Math.PI) / 180;
  const lat1 = toRad(a.lat);
  const lon1 = toRad(a.lon);
  const lat2 = toRad(b.lat);
  const lon2 = toRad(b.lon);
  const dlat = lat2 - lat1;
  const dlon = lon2 - lon1;
  const h =
    Math.sin(dlat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dlon / 2) ** 2;
  return 2 * EARTH_RADIUS_METERS * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

function pathDistance(points) {
  return points.slice(1).reduce((total, point, index) => {
    return total + haversineMeters(points[index], point);
  }, 0);
}

function directChildrenByTag(parent, tagName) {
  return Array.from(parent.children).filter((child) => child.localName === tagName);
}

function descendantsByTag(parent, tagName) {
  return Array.from(parent.getElementsByTagNameNS("*", tagName));
}

function childText(parent, tagName) {
  const child = directChildrenByTag(parent, tagName)[0];
  return child ? child.textContent : "";
}

function setChildText(doc, parent, tagName, text) {
  let child = directChildrenByTag(parent, tagName)[0];
  if (!child) {
    child = doc.createElementNS(GPX_NS, tagName);
    parent.appendChild(child);
  }
  child.textContent = text;
}

function pointFromElement(element) {
  const ele = Number.parseFloat(childText(element, "ele"));
  return {
    lat: Number.parseFloat(element.getAttribute("lat")),
    lon: Number.parseFloat(element.getAttribute("lon")),
    ele: Number.isFinite(ele) ? ele : null,
  };
}

function waypointFromGpxElement(element) {
  const ele = Number.parseFloat(childText(element, "ele"));
  return {
    lat: Number.parseFloat(element.getAttribute("lat")),
    lon: Number.parseFloat(element.getAttribute("lon")),
    ele: Number.isFinite(ele) ? ele : null,
    name: childText(element, "name"),
    type: childText(element, "type"),
    desc: childText(element, "desc"),
  };
}

function pointFromCoordinate(coordinate) {
  return {
    lon: Number(coordinate[0]),
    lat: Number(coordinate[1]),
    ele: Number.isFinite(Number(coordinate[2])) ? Number(coordinate[2]) : null,
  };
}

function waypointFromCoordinate(coordinate, name = "", type = "", desc = "") {
  return {
    ...pointFromCoordinate(coordinate),
    name,
    type,
    desc,
  };
}

function parseXml(text) {
  const doc = new DOMParser().parseFromString(text, "application/xml");
  const parserError = doc.querySelector("parsererror");
  if (parserError) {
    throw new Error("The file is not valid XML.");
  }
  return doc;
}

function parseGpx(text, fileName) {
  const doc = parseXml(text);

  const routePointElements = descendantsByTag(doc, "rtept");
  const trackPointElements = descendantsByTag(doc, "trkpt");
  const sourceElements = routePointElements.length ? routePointElements : trackPointElements;
  const sourceKind = routePointElements.length ? "route" : "track";

  if (!sourceElements.length) {
    throw new Error("No route points or track points found.");
  }

  const points = sourceElements.map(pointFromElement);
  const waypoints = directChildrenByTag(doc.documentElement, "wpt").map(waypointFromGpxElement);
  const metadataName = descendantsByTag(doc, "metadata")
    .flatMap((node) => directChildrenByTag(node, "name"))[0];
  const routeName = descendantsByTag(doc, "rte")
    .flatMap((node) => directChildrenByTag(node, "name"))[0];
  const trackName = descendantsByTag(doc, "trk")
    .flatMap((node) => directChildrenByTag(node, "name"))[0];

  return {
    id: crypto.randomUUID(),
    fileName,
    name:
      metadataName?.textContent ||
      routeName?.textContent ||
      trackName?.textContent ||
      fileName.replace(/\.gpx$/i, ""),
    sourceKind,
    points,
    waypoints,
    distance: pathDistance(points),
    laps: 1,
  };
}

function parseGeoJson(text, fileName) {
  let data;
  try {
    data = JSON.parse(text);
  } catch (error) {
    throw new Error(`The file is not valid GeoJSON: ${error.message}`);
  }

  const features = data.type === "FeatureCollection"
    ? data.features
    : data.type === "Feature"
      ? [data]
      : [{ type: "Feature", properties: {}, geometry: data }];

  const points = [];
  const waypoints = [];

  for (const feature of features) {
    if (!feature?.geometry) {
      continue;
    }

    const name =
      feature.properties?.name ||
      feature.properties?.title ||
      feature.properties?.Name ||
      "";
    const desc =
      feature.properties?.description ||
      feature.properties?.desc ||
      "";

    collectGeoJsonGeometry(feature.geometry, points, waypoints, name, desc);
  }

  if (points.length < 2) {
    throw new Error("No GeoJSON LineString or MultiLineString geometry found.");
  }

  return {
    id: crypto.randomUUID(),
    fileName,
    name: data.name || fileName.replace(/\.(geojson|json)$/i, ""),
    sourceKind: "geojson",
    points,
    waypoints,
    distance: pathDistance(points),
    laps: 1,
  };
}

function collectGeoJsonGeometry(geometry, points, waypoints, name, desc) {
  if (!geometry) {
    return;
  }

  if (geometry.type === "GeometryCollection") {
    geometry.geometries.forEach((child) => {
      collectGeoJsonGeometry(child, points, waypoints, name, desc);
    });
    return;
  }

  if (geometry.type === "LineString") {
    points.push(...geometry.coordinates.map(pointFromCoordinate));
    return;
  }

  if (geometry.type === "MultiLineString") {
    geometry.coordinates.forEach((line) => {
      points.push(...line.map(pointFromCoordinate));
    });
    return;
  }

  if (geometry.type === "Polygon") {
    points.push(...geometry.coordinates[0].map(pointFromCoordinate));
    return;
  }

  if (geometry.type === "MultiPolygon") {
    geometry.coordinates.forEach((polygon) => {
      points.push(...polygon[0].map(pointFromCoordinate));
    });
    return;
  }

  if (geometry.type === "Point") {
    waypoints.push(waypointFromCoordinate(geometry.coordinates, name, "Waypoint", desc));
    return;
  }

  if (geometry.type === "MultiPoint") {
    geometry.coordinates.forEach((coordinate, index) => {
      waypoints.push(
        waypointFromCoordinate(
          coordinate,
          name ? `${name} ${index + 1}` : `Waypoint ${index + 1}`,
          "Waypoint",
          desc,
        ),
      );
    });
  }
}

function parseKml(text, fileName) {
  const doc = parseXml(text);
  const placemarks = descendantsByTag(doc, "Placemark");
  const points = [];
  const waypoints = [];

  for (const placemark of placemarks) {
    const name = childText(placemark, "name");
    const desc = childText(placemark, "description");

    descendantsByTag(placemark, "LineString").forEach((lineString) => {
      points.push(...parseKmlCoordinates(childText(lineString, "coordinates")));
    });

    descendantsByTag(placemark, "LinearRing").forEach((linearRing) => {
      points.push(...parseKmlCoordinates(childText(linearRing, "coordinates")));
    });

    descendantsByTag(placemark, "Point").forEach((point) => {
      const coordinate = parseKmlCoordinates(childText(point, "coordinates"))[0];
      if (coordinate) {
        waypoints.push({
          ...coordinate,
          name,
          type: "Waypoint",
          desc,
        });
      }
    });
  }

  if (points.length < 2) {
    throw new Error("No KML LineString or LinearRing geometry found.");
  }

  const docName = descendantsByTag(doc, "Document")
    .flatMap((node) => directChildrenByTag(node, "name"))[0];

  return {
    id: crypto.randomUUID(),
    fileName,
    name: docName?.textContent || fileName.replace(/\.kml$/i, ""),
    sourceKind: "kml",
    points,
    waypoints,
    distance: pathDistance(points),
    laps: 1,
  };
}

function parseKmlCoordinates(text) {
  return text
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((item) => item.split(",").map(Number))
    .filter((coordinate) => Number.isFinite(coordinate[0]) && Number.isFinite(coordinate[1]))
    .map(pointFromCoordinate);
}

function parseRouteFile(text, fileName) {
  const lowerName = fileName.toLowerCase();
  const trimmed = text.trim();

  if (lowerName.endsWith(".geojson") || lowerName.endsWith(".json") || trimmed.startsWith("{")) {
    return parseGeoJson(text, fileName);
  }

  if (lowerName.endsWith(".kml") || trimmed.includes("<kml")) {
    return parseKml(text, fileName);
  }

  return parseGpx(text, fileName);
}

async function addFile(file) {
  try {
    const text = await file.text();
    state.segments.push(parseRouteFile(text, file.name));
    render();
  } catch (error) {
    alert(`Could not read ${file.name}: ${error.message}`);
  } finally {
    elements.file.value = "";
  }
}

function openFilePicker() {
  elements.file.click();
}

function handleDroppedFiles(fileList) {
  const files = Array.from(fileList || []).filter((file) =>
    /\.(gpx|geojson|json|kml)$/i.test(file.name),
  );

  if (!files.length) {
    return;
  }

  files.forEach((file) => addFile(file));
}

function getThresholdMeters() {
  const value = Number.parseFloat(elements.threshold.value);
  return Number.isFinite(value) && value > 0 ? value : 50;
}

function getCombinedPoints() {
  const skipDuplicates = elements.skipDuplicateJoinPoints.checked;
  const combined = [];

  for (const segment of state.segments) {
    for (let lap = 1; lap <= segment.laps; lap += 1) {
      segment.points.forEach((point, pointIndex) => {
        const previous = combined.at(-1);
        const isBoundaryPoint = pointIndex === 0 && combined.length > 0;
        const samePoint = previous && haversineMeters(previous, point) < 0.02;

        if (skipDuplicates && isBoundaryPoint && samePoint) {
          return;
        }

        combined.push(point);
      });
    }
  }

  return combined;
}

function getValidationItems() {
  const items = [];
  const threshold = getThresholdMeters();

  for (const segment of state.segments) {
    if (segment.laps > 1) {
      const gap = haversineMeters(segment.points.at(-1), segment.points[0]);
      items.push({
        severity: gap > threshold ? "warn" : "ok",
        text: `${segment.name}: lap repeat gap is ${gap.toFixed(1)} m.`,
        coords: gap > threshold ? [segment.points.at(-1), segment.points[0]] : null,
      });
    }
  }

  for (let index = 1; index < state.segments.length; index += 1) {
    const previous = state.segments[index - 1];
    const current = state.segments[index];
    const gap = haversineMeters(previous.points.at(-1), current.points[0]);
    items.push({
      severity: gap > threshold ? "warn" : "ok",
      text: `${previous.name} to ${current.name}: file join gap is ${gap.toFixed(1)} m.`,
      coords: gap > threshold ? [previous.points.at(-1), current.points[0]] : null,
    });
  }

  if (!items.length && state.segments.length) {
    items.push({ severity: "ok", text: "No joins need warnings.", coords: null });
  }

  return items;
}

function escapeHtml(value) {
  return value.replace(/[&<>"']/g, (char) => {
    return {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#039;",
    }[char];
  });
}

function renderSegments() {
  elements.segmentCount.textContent = state.segments.length
    ? `${state.segments.length} file${state.segments.length === 1 ? "" : "s"}`
    : "No files";

  elements.segments.classList.toggle("empty", state.segments.length === 0);

  if (!state.segments.length) {
    elements.segments.innerHTML = "<p>Add a route file to start building the course.</p>";
    return;
  }

  elements.segments.replaceChildren(
    ...state.segments.map((segment, index) => {
      const row = document.createElement("article");
      row.className = "segment";
      row.draggable = true;
      row.dataset.segmentId = segment.id;
      row.addEventListener("dragstart", (event) => {
        state.draggedSegmentId = segment.id;
        row.classList.add("dragging");
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData("text/plain", segment.id);
      });
      row.addEventListener("dragend", () => {
        state.draggedSegmentId = null;
        row.classList.remove("dragging");
        document
          .querySelectorAll(".segment.drop-target")
          .forEach((element) => element.classList.remove("drop-target"));
      });
      row.addEventListener("dragover", (event) => {
        event.preventDefault();
        if (state.draggedSegmentId && state.draggedSegmentId !== segment.id) {
          row.classList.add("drop-target");
        }
      });
      row.addEventListener("dragleave", () => {
        row.classList.remove("drop-target");
      });
      row.addEventListener("drop", (event) => {
        event.preventDefault();
        row.classList.remove("drop-target");
        moveSegment(state.draggedSegmentId, segment.id);
      });

      const dragHandle = document.createElement("button");
      dragHandle.className = "drag-handle";
      dragHandle.type = "button";
      dragHandle.title = "Drag to reorder";
      dragHandle.setAttribute("aria-label", `Drag ${segment.name} to reorder`);
      dragHandle.textContent = "⋮⋮";

      const details = document.createElement("div");
      details.innerHTML = `
        <div class="segment-title">${escapeHtml(segment.name)}</div>
        <div class="segment-meta">
          <span>${escapeHtml(segment.fileName)}</span>
          <span>${segment.sourceKind}</span>
          <span>${segment.points.length} points</span>
          <span>${segment.waypoints.length} waypoints</span>
          <span>${formatDistance(segment.distance)}</span>
        </div>
      `;

      const lapLabel = document.createElement("label");
      lapLabel.className = "lap-input";
      lapLabel.textContent = "Laps";
      const lapInput = document.createElement("input");
      lapInput.type = "number";
      lapInput.min = "1";
      lapInput.step = "1";
      lapInput.value = segment.laps;
      lapInput.addEventListener("input", () => {
        segment.laps = Math.max(1, Number.parseInt(lapInput.value, 10) || 1);
        render();
      });
      lapLabel.appendChild(lapInput);

      const remove = document.createElement("button");
      remove.className = "remove";
      remove.type = "button";
      remove.textContent = "x";
      remove.setAttribute("aria-label", `Remove ${segment.name}`);
      remove.addEventListener("click", () => {
        state.segments.splice(index, 1);
        render();
      });

      row.append(dragHandle, details, lapLabel, remove);
      return row;
    }),
  );
}

function moveSegment(sourceId, targetId) {
  if (!sourceId || !targetId || sourceId === targetId) {
    return;
  }

  const sourceIndex = state.segments.findIndex((segment) => segment.id === sourceId);
  const targetIndex = state.segments.findIndex((segment) => segment.id === targetId);
  if (sourceIndex === -1 || targetIndex === -1) {
    return;
  }

  const [source] = state.segments.splice(sourceIndex, 1);
  state.segments.splice(targetIndex, 0, source);
  render();
}

function renderTotals() {
  const combined = getCombinedPoints();
  const total = pathDistance(combined);
  elements.totalDistance.textContent = `${metersToMiles(total).toFixed(2)} mi`;
  elements.totalDistanceKm.textContent = `${metersToKm(total).toFixed(2)} km`;
  const disabled = combined.length < 2;
  elements.downloadGpx.disabled = disabled;
  elements.downloadKml.disabled = disabled;
  elements.downloadGeoJson.disabled = disabled;
  elements.clear.disabled = state.segments.length === 0;
}

function renderValidation() {
  const items = getValidationItems();
  const warnings = items.filter((item) => item.severity === "warn");
  elements.validationSummary.textContent = warnings.length
    ? `${warnings.length} warning${warnings.length === 1 ? "" : "s"}`
    : state.segments.length
      ? "Looks usable"
      : "Waiting for files";

  elements.validationList.replaceChildren(
    ...items.map((item) => {
      const li = document.createElement("li");
      li.className = item.severity;
      li.textContent = item.text;
      return li;
    }),
  );
}

function renderMap() {
  if (!state.map || !state.mobileMap) {
    return;
  }

  renderMapInstance(state.map, state.layers.desktop, document.querySelector(".map-card"));
  renderMapInstance(state.mobileMap, state.layers.mobile, document.querySelector("#mobile-map"));
}

function renderMapInstance(map, layers, container) {
  if (!container.offsetParent) {
    return;
  }

  layers.inputs.clearLayers();
  layers.output.clearLayers();
  layers.warnings.clearLayers();

  const boundsPoints = [];

  for (const segment of state.segments) {
    const latLngs = segment.points.map((point) => [point.lat, point.lon]);
    boundsPoints.push(...latLngs);
    L.polyline(latLngs, {
      color: "#247a88",
      weight: 4,
      opacity: 0.62,
    })
      .bindTooltip(segment.name)
      .addTo(layers.inputs);
  }

  const combined = getCombinedPoints();
  if (combined.length > 1) {
    const latLngs = combined.map((point) => [point.lat, point.lon]);
    boundsPoints.push(...latLngs);
    L.polyline(latLngs, {
      color: "#b85f3d",
      weight: 5,
      opacity: 0.9,
    }).addTo(layers.output);
  }

  for (const item of getValidationItems()) {
    if (!item.coords) {
      continue;
    }
    const latLngs = item.coords.map((point) => [point.lat, point.lon]);
    L.polyline(latLngs, {
      color: "#b3342c",
      weight: 4,
      dashArray: "8 8",
    })
      .bindTooltip(item.text)
      .addTo(layers.warnings);
    L.circleMarker(latLngs[0], {
      radius: 6,
      color: "#b3342c",
      fillColor: "#b3342c",
      fillOpacity: 0.9,
    }).addTo(layers.warnings);
    L.circleMarker(latLngs[1], {
      radius: 6,
      color: "#b3342c",
      fillColor: "#b3342c",
      fillOpacity: 0.9,
    }).addTo(layers.warnings);
  }

  map.invalidateSize();
  if (boundsPoints.length) {
    map.fitBounds(boundsPoints, { padding: [34, 34], maxZoom: 16 });
  }
}

function showPanel(panelId) {
  state.activePanel = panelId;
  elements.workspace.dataset.activePanel = panelId;

  elements.drawerPanels.forEach((panel) => {
    panel.classList.toggle("active", panel.id === panelId);
  });
  elements.menuItems.forEach((item) => {
    item.classList.toggle("active", item.dataset.panel === panelId);
  });

  if (panelId === "map-panel") {
    [0, 220].forEach((delay) => setTimeout(() => {
      state.map?.invalidateSize();
      state.mobileMap?.invalidateSize();
      renderMap();
    }, delay));
  }
}

function setRailExpanded(isOpen) {
  elements.menuRail.classList.toggle("expanded", isOpen);
  elements.menuToggle.setAttribute("aria-expanded", String(isOpen));
}

function toggleRail() {
  setRailExpanded(!elements.menuRail.classList.contains("expanded"));
}

function buildGpxDocument() {
  const doc = document.implementation.createDocument(GPX_NS, "gpx");
  const root = doc.documentElement;
  root.setAttribute("version", "1.1");
  root.setAttribute("creator", "route-splicer");
  root.setAttributeNS(XSI_NS, "xsi:schemaLocation", `${GPX_NS} ${GPX_NS}/gpx.xsd`);

  const metadata = doc.createElementNS(GPX_NS, "metadata");
  const metadataName = doc.createElementNS(GPX_NS, "name");
  metadataName.textContent = "Combined Ultra Route";
  metadata.appendChild(metadataName);
  root.appendChild(metadata);

  if (elements.duplicateWaypoints.checked) {
    for (const [fileIndex, segment] of state.segments.entries()) {
      for (let lap = 1; lap <= segment.laps; lap += 1) {
        for (const waypoint of segment.waypoints) {
          const baseName = waypoint.name || waypoint.type || "Waypoint";
          root.appendChild(
            createWaypointElement(doc, {
              ...waypoint,
              name: `File ${fileIndex + 1} Lap ${lap} - ${baseName}`,
            }),
          );
        }
      }
    }
  } else {
    for (const segment of state.segments) {
      for (const waypoint of segment.waypoints) {
        root.appendChild(createWaypointElement(doc, waypoint));
      }
    }
  }

  const route = doc.createElementNS(GPX_NS, "rte");
  const routeName = doc.createElementNS(GPX_NS, "name");
  routeName.textContent = "Combined Ultra Route";
  route.appendChild(routeName);

  for (const point of getCombinedPoints()) {
    route.appendChild(createRoutePointElement(doc, point));
  }

  root.appendChild(route);
  return doc;
}

function createRoutePointElement(doc, point) {
  const routePoint = doc.createElementNS(GPX_NS, "rtept");
  routePoint.setAttribute("lat", String(point.lat));
  routePoint.setAttribute("lon", String(point.lon));
  appendElevation(doc, routePoint, point.ele);
  return routePoint;
}

function createWaypointElement(doc, waypoint) {
  const element = doc.createElementNS(GPX_NS, "wpt");
  element.setAttribute("lat", String(waypoint.lat));
  element.setAttribute("lon", String(waypoint.lon));
  appendElevation(doc, element, waypoint.ele);

  if (waypoint.name) {
    setChildText(doc, element, "name", waypoint.name);
  }
  if (waypoint.desc) {
    setChildText(doc, element, "desc", waypoint.desc);
  }
  if (waypoint.type) {
    setChildText(doc, element, "type", waypoint.type);
  }

  return element;
}

function appendElevation(doc, parent, ele) {
  if (!Number.isFinite(ele)) {
    return;
  }

  const elevation = doc.createElementNS(GPX_NS, "ele");
  elevation.textContent = String(ele);
  parent.appendChild(elevation);
}

async function downloadGpx() {
  const doc = buildGpxDocument();
  const xml = new XMLSerializer().serializeToString(doc);
  await downloadFile(
    `<?xml version="1.0" encoding="UTF-8"?>\n${xml}\n`,
    exportFileName("gpx"),
    "application/gpx+xml",
  );
}

function buildKmlDocument() {
  const doc = document.implementation.createDocument(
    "http://www.opengis.net/kml/2.2",
    "kml",
  );
  const root = doc.documentElement;
  const documentElement = doc.createElementNS(root.namespaceURI, "Document");
  const name = doc.createElementNS(root.namespaceURI, "name");
  name.textContent = "Combined Ultra Route";
  documentElement.appendChild(name);

  const routePlacemark = doc.createElementNS(root.namespaceURI, "Placemark");
  const routeName = doc.createElementNS(root.namespaceURI, "name");
  routeName.textContent = "Combined Ultra Route";
  routePlacemark.appendChild(routeName);

  const lineString = doc.createElementNS(root.namespaceURI, "LineString");
  const tessellate = doc.createElementNS(root.namespaceURI, "tessellate");
  tessellate.textContent = "1";
  const coordinates = doc.createElementNS(root.namespaceURI, "coordinates");
  coordinates.textContent = getCombinedPoints()
    .map((point) => `${point.lon},${point.lat}${Number.isFinite(point.ele) ? `,${point.ele}` : ""}`)
    .join(" ");
  lineString.append(tessellate, coordinates);
  routePlacemark.appendChild(lineString);
  documentElement.appendChild(routePlacemark);

  getCombinedWaypoints().forEach((waypoint) => {
    const placemark = doc.createElementNS(root.namespaceURI, "Placemark");
    const placemarkName = doc.createElementNS(root.namespaceURI, "name");
    placemarkName.textContent = waypoint.name || waypoint.type || "Waypoint";
    placemark.appendChild(placemarkName);

    if (waypoint.desc) {
      const description = doc.createElementNS(root.namespaceURI, "description");
      description.textContent = waypoint.desc;
      placemark.appendChild(description);
    }

    const point = doc.createElementNS(root.namespaceURI, "Point");
    const pointCoordinates = doc.createElementNS(root.namespaceURI, "coordinates");
    pointCoordinates.textContent = `${waypoint.lon},${waypoint.lat}${
      Number.isFinite(waypoint.ele) ? `,${waypoint.ele}` : ""
    }`;
    point.appendChild(pointCoordinates);
    placemark.appendChild(point);
    documentElement.appendChild(placemark);
  });

  root.appendChild(documentElement);
  return doc;
}

async function downloadKml() {
  const doc = buildKmlDocument();
  const xml = new XMLSerializer().serializeToString(doc);
  await downloadFile(
    `<?xml version="1.0" encoding="UTF-8"?>\n${xml}\n`,
    exportFileName("kml"),
    "application/vnd.google-earth.kml+xml",
  );
}

function buildGeoJson() {
  const routeCoordinates = getCombinedPoints().map((point) => {
    const coordinate = [point.lon, point.lat];
    if (Number.isFinite(point.ele)) {
      coordinate.push(point.ele);
    }
    return coordinate;
  });

  const features = [
    {
      type: "Feature",
      properties: {
        name: "Combined Ultra Route",
      },
      geometry: {
        type: "LineString",
        coordinates: routeCoordinates,
      },
    },
  ];

  getCombinedWaypoints().forEach((waypoint) => {
    const coordinate = [waypoint.lon, waypoint.lat];
    if (Number.isFinite(waypoint.ele)) {
      coordinate.push(waypoint.ele);
    }

    features.push({
      type: "Feature",
      properties: {
        name: waypoint.name || waypoint.type || "Waypoint",
        type: waypoint.type || "Waypoint",
        description: waypoint.desc || "",
      },
      geometry: {
        type: "Point",
        coordinates: coordinate,
      },
    });
  });

  return {
    type: "FeatureCollection",
    name: "Combined Ultra Route",
    features,
  };
}

async function downloadGeoJson() {
  await downloadFile(
    `${JSON.stringify(buildGeoJson(), null, 2)}\n`,
    exportFileName("geojson"),
    "application/geo+json",
  );
}

function exportFileName(extension) {
  const base = (elements.routeName?.value || "combined-ultra-route").trim() || "combined-ultra-route";
  const safeBase = base.replace(/[\\/:*?"<>|]+/g, "-").replace(/\s+/g, "-");
  return `${safeBase}.${extension}`;
}

function getCombinedWaypoints() {
  const waypoints = [];

  if (elements.duplicateWaypoints.checked) {
    for (const [fileIndex, segment] of state.segments.entries()) {
      for (let lap = 1; lap <= segment.laps; lap += 1) {
        for (const waypoint of segment.waypoints) {
          const baseName = waypoint.name || waypoint.type || "Waypoint";
          waypoints.push({
            ...waypoint,
            name: `File ${fileIndex + 1} Lap ${lap} - ${baseName}`,
          });
        }
      }
    }
    return waypoints;
  }

  for (const segment of state.segments) {
    waypoints.push(...segment.waypoints);
  }

  return waypoints;
}

async function downloadFile(content, fileName, type) {
  const anchor = document.createElement("a");
  anchor.href = `data:${type};charset=utf-8,${encodeURIComponent(content)}`;
  anchor.download = fileName;
  anchor.rel = "noopener";
  anchor.style.display = "none";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
}

function render() {
  renderSegments();
  renderTotals();
  renderValidation();
  renderMap();
}

elements.threshold.addEventListener("input", render);
elements.duplicateWaypoints.addEventListener("change", render);
elements.skipDuplicateJoinPoints.addEventListener("change", render);
elements.darkMode.addEventListener("change", () => applyTheme(elements.darkMode.checked));
elements.downloadGpx.addEventListener("click", downloadGpx);
elements.downloadKml.addEventListener("click", downloadKml);
elements.downloadGeoJson.addEventListener("click", downloadGeoJson);
elements.segmentsDropZone.addEventListener("click", (event) => {
  if (event.target === elements.uploadButton || event.target === elements.file) {
    return;
  }
  openFilePicker();
});
elements.segmentsDropZone.addEventListener("dragover", (event) => {
  event.preventDefault();
  elements.segmentsDropZone.classList.add("drag-over");
});
elements.segmentsDropZone.addEventListener("dragleave", (event) => {
  if (!elements.segmentsDropZone.contains(event.relatedTarget)) {
    elements.segmentsDropZone.classList.remove("drag-over");
  }
});
elements.segmentsDropZone.addEventListener("drop", (event) => {
  event.preventDefault();
  elements.segmentsDropZone.classList.remove("drag-over");
  handleDroppedFiles(event.dataTransfer?.files);
});
elements.clear.addEventListener("click", () => {
  state.segments = [];
  render();
});
elements.file.addEventListener("change", () => {
  handleDroppedFiles(elements.file.files);
  elements.file.value = "";
});
elements.menuToggle.addEventListener("click", toggleRail);
elements.railClose.addEventListener("click", () => setRailExpanded(false));
elements.menuItems.forEach((item) => {
  item.addEventListener("click", () => showPanel(item.dataset.panel));
});
window.addEventListener("resize", () => {
  renderMap();
});

initMap();
initializePageChrome();
showPanel(state.activePanel);
setRailExpanded(false);
render();
