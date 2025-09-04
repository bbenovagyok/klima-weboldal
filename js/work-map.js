/* interaktív megye -> város nézet + automata geokódolás (offline->online->fallback, county-bias) */
(() => {
  const mapEl = document.getElementById("work-map");
  if (!mapEl) return;

  /* ===================== Segédek ===================== */
  const strip = s => String(s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  const keyOf  = s => strip(s).replace(/\bmegye\b/gi, "").replace(/\s+/g, " ").trim().toLowerCase();
  const sleep  = (ms) => new Promise(r => setTimeout(r, ms));
  const round5 = n => Math.round(Number(n) * 1e5) / 1e5;  // determinisztikus kerekítés

  const tryUrls = (file) => [
    `data/${file}`,
    `/data/${file}`,
    new URL(`data/${file}`, document.baseURI).href
  ];
  const parseJsonSafe = (t) => (t && t.charCodeAt && t.charCodeAt(0) === 0xFEFF ? JSON.parse(t.slice(1)) : JSON.parse(t));
  const fetchFirstOk = async (cands) => {
    let last;
    for (const u of cands) {
      try {
        const r = await fetch(u, { cache: "no-store" });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return parseJsonSafe(await r.text());
      } catch (e) { last = e; }
    }
    throw last || new Error("Betöltési hiba");
  };

  /* ===== Geokód cache (verzió bump) ===== */
  const CACHE_KEY = "geoCache-v3";
  let geoCache = {};
  try { geoCache = JSON.parse(localStorage.getItem(CACHE_KEY) || "{}"); } catch {}

  const cacheGet = (countyKey, cityName) => geoCache[`${countyKey}|${keyOf(cityName)}`];
  const cacheSet = (countyKey, cityName, lat, lng) => {
    geoCache[`${countyKey}|${keyOf(cityName)}`] = { lat: round5(lat), lng: round5(lng) };
    try { localStorage.setItem(CACHE_KEY, JSON.stringify(geoCache)); } catch {}
  };

  /* ===== Opcionális offline település-index ===== */
  let OFFLINE_INDEX = null; // { "iszkaz": {lat, lng}, ... }
  async function loadOfflineIndex() {
    if (OFFLINE_INDEX !== null) return OFFLINE_INDEX;
    try {
      const raw = await fetchFirstOk(tryUrls("hu-telepulesek.json"));
      const idx = {};
      (raw || []).forEach(r => {
        const name = r.name || r.telepules || r.varos || r.nev;
        const lat  = r.lat  ?? r.latitude;
        const lng  = r.lng  ?? r.lon ?? r.longitude;
        if (name && typeof lat === "number" && typeof lng === "number") {
          idx[keyOf(name)] = { lat: Number(lat), lng: Number(lng) };
        }
      });
      OFFLINE_INDEX = idx;
    } catch {
      OFFLINE_INDEX = {};
    }
    return OFFLINE_INDEX;
  }

  /* ===== Eredmény „behúzása” a megye bbox-ába ===== */
  function snapWithinBounds(lat, lng, bounds) {
    const minLat = bounds.getSouth(), maxLat = bounds.getNorth();
    const minLng = bounds.getWest(),  maxLng = bounds.getEast();
    const m = 0.002; // kis margó
    const clampedLat = Math.min(maxLat - m, Math.max(minLat + m, lat));
    const clampedLng = Math.min(maxLng - m, Math.max(minLng + m, lng));
    return { lat: clampedLat, lng: clampedLng };
  }

  /* ===== Online geokódolás (Nominatim) – county-bias viewbox-szal ===== */
  async function geocodeOnline(cityName, countyDisplay, countyBounds) {
    await sleep(900); // udvarias throttling

    // viewbox: lon1,lat1,lon2,lat2 (Nominatimnál észak van a 2. értékpárban)
    const west  = countyBounds.getWest();
    const south = countyBounds.getSouth();
    const east  = countyBounds.getEast();
    const north = countyBounds.getNorth();

    const q = `${cityName}, ${countyDisplay} megye, Magyarország`;
    const url =
      `https://nominatim.openstreetmap.org/search` +
      `?format=jsonv2&limit=1&countrycodes=hu&accept-language=hu` +
      `&bounded=1&viewbox=${west},${north},${east},${south}` +
      `&q=${encodeURIComponent(q)}`;

    const r = await fetch(url, { headers: { "Accept-Language": "hu" } });
    if (!r.ok) throw new Error(`Nominatim HTTP ${r.status}`);
    const arr = await r.json();
    if (Array.isArray(arr) && arr[0]?.lat && arr[0]?.lon) {
      let lat = parseFloat(arr[0].lat);
      let lng = parseFloat(arr[0].lon);
      ({ lat, lng } = snapWithinBounds(lat, lng, countyBounds));
      return { lat, lng };
    }
    return null;
  }

  /* ===== Város -> {lat,lng} feloldás ===== */
  async function resolveLatLng(cityName, countyKey, countyDisplay, countyBounds) {
    const hit = cacheGet(countyKey, cityName);
    if (hit) return hit;

    const idx = await loadOfflineIndex();
    const off = idx[keyOf(cityName)];
    if (off) { cacheSet(countyKey, cityName, off.lat, off.lng); return off; }

    try {
      const online = await geocodeOnline(cityName, countyDisplay, countyBounds);
      if (online) { cacheSet(countyKey, cityName, online.lat, online.lng); return online; }
    } catch (e) {
      console.warn("Online geokódolás hiba:", e);
    }

    const c = countyBounds.getCenter();
    const fb = { lat: c.lat, lng: c.lng };
    cacheSet(countyKey, cityName, fb.lat, fb.lng);
    return fb;
  }

  /* ===================== Leaflet alap ===================== */
  const HU_TMP = L.latLngBounds([45.6, 16.0], [48.7, 22.95]);

  const map = L.map("work-map", {
    zoomControl: false,
    attributionControl: false,
    dragging: false,
    scrollWheelZoom: false,
    doubleClickZoom: false,
    touchZoom: false,
    boxZoom: false,
    keyboard: false,
    zoomSnap: 0,
    zoomDelta: 0.1
  });

  L.tileLayer("https://{s}.basemaps.cartocdn.com/light_nolabels/{z}/{x}/{y}{r}.png", {
    attribution: "&copy; OpenStreetMap & CARTO",
    maxZoom: 22
  }).addTo(map);

  map.fitBounds(HU_TMP, { padding: [0, 0] });

  function setInteractions(on) {
    const f = on ? "enable" : "disable";
    map.dragging[f](); map.scrollWheelZoom[f](); map.doubleClickZoom[f]();
    map.touchZoom[f](); map.boxZoom[f](); map.keyboard[f]();
  }
  function unlockView() {
    map.setMinZoom(0);
    map.setMaxZoom(22);
    map.setMaxBounds(null);
  }

  /* ===================== Állapot + UI ===================== */
  let geo, loc;
  let countyLayer = null;
  let cityLayer   = null;
  let selectedCountyKey = null;

  let backBtn = null;
  let infoBadge = null;

  function ensureUi() {
    if (!backBtn) {
      backBtn = document.createElement("button");
      backBtn.className = "map-back-btn hidden";
      backBtn.type = "button";
      backBtn.textContent = "← Vissza";
      backBtn.addEventListener("click", () => showOverview());
      mapEl.appendChild(backBtn);
    }
    if (!infoBadge) {
      infoBadge = document.createElement("div");
      infoBadge.className = "map-hint hidden";
      mapEl.appendChild(infoBadge);
    }
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && !backBtn.classList.contains("hidden")) showOverview();
    });
  }

  /* ===================== Zoom helper (stabil) ===================== */
  function applyFitZoomWithBump(bounds) {
  const fitZoom    = map.getBoundsZoom(bounds, true);
  const bump       = mapEl.clientWidth < 640 ? -0.30 : -0.60;
  const targetZoom = Math.min(22, fitZoom + bump);

  // Aszimmetrikus padding – NAGYOBB JOBB OLDAL
  const PAD = mapEl.clientWidth < 640
    ? { L: 10, T: 8,  R: 200, B: 16 }   // mobil
    : { L: 16, T: 12, R: 350, B: 20 };  // desktop

  map.flyToBounds(bounds, {
    maxZoom: targetZoom,
    paddingTopLeft:     [PAD.L, PAD.T],
    paddingBottomRight: [PAD.R, PAD.B],
    duration: 0.50,
    easeLinearity: 0.15
  });
  return targetZoom;
}

  /* ===================== Nézetek ===================== */
  function showOverview() {
    selectedCountyKey = null;
    if (cityLayer) { map.removeLayer(cityLayer); cityLayer = null; }

    if (countyLayer) {
      countyLayer.eachLayer(l => countyLayer.resetStyle(l));
      countyLayer.addTo(map);

      unlockView();
      map.invalidateSize();

      const b = countyLayer.getBounds();
      const z = applyFitZoomWithBump(b);

      const freeze = () => {
        map.off("moveend", freeze);
        map.setMinZoom(z);
        map.setMaxZoom(z);
        map.setMaxBounds(b.pad(0.005));
      };
      map.on("moveend", freeze);
    }

    setInteractions(false);
    backBtn?.classList.add("hidden");
    infoBadge?.classList.add("hidden");
  }

  async function showCounty(countyKey) {
    selectedCountyKey = countyKey;
    if (!countyLayer) return;

    unlockView();

    // keresett megye réteg + határ
    let target = null;
    countyLayer.eachLayer(l => { if (l.feature.__key === countyKey) target = l; });
    if (!target) return;
    const b = target.getBounds();

    map.invalidateSize();
    const z = applyFitZoomWithBump(b);

    const freeze = () => {
      map.off("moveend", freeze);
      map.setMinZoom(z);
      map.setMaxZoom(z);
      map.setMaxBounds(b.pad(0.0015));
      setInteractions(false);
    };
    map.on("moveend", freeze);

    // városok réteg újra
    if (cityLayer) { map.removeLayer(cityLayer); cityLayer = null; }
    cityLayer = L.layerGroup().addTo(map);

    const dataArr   = Array.isArray(loc?.counties) ? loc.counties : (Array.isArray(loc) ? loc : []);
    const countyRow = dataArr.find(c => keyOf(c.county_name || c.megye || c.name) === countyKey);
    const countyDisplay = countyRow?.county_name || countyRow?.megye || target.feature.__display || "";

    const rawCities = (countyRow?.cities || []).map(c => (typeof c === "string" ? { city_name: c } : c));

    let countPlaced = 0;
    for (const c of rawCities) {
      const name = c.city_name || c.name;
      if (!name) continue;

      let lat = c.lat, lng = c.lng;
      if (typeof lat !== "number" || typeof lng !== "number") {
        const pos = await resolveLatLng(name, countyKey, countyDisplay, b);
        lat = pos.lat; lng = pos.lng;
      }

      ({ lat, lng } = snapWithinBounds(lat, lng, b));
      lat = round5(lat); lng = round5(lng);

      const marker = L.circleMarker([lat, lng], {
        radius: 6,
        weight: 2,
        color: "#b91c1c",
        fillColor: "#ef4444",
        fillOpacity: 0.9
      }).addTo(cityLayer);

      marker.bindTooltip(String(name), {
        permanent: true,
        direction: "right",
        offset: [8, 0],
        className: "city-label"
      }).openTooltip();

      countPlaced++;
    }

    infoBadge.textContent = countPlaced
      ? `Megjelölt városok: ${countPlaced}`
      : "Ebben a megyében még nincs megjelölt város.";

    backBtn.classList.remove("hidden");
    infoBadge.classList.remove("hidden");
  }

  /* ===================== Betöltés + megye-réteg ===================== */
  (async () => {
    [geo, loc] = await Promise.all([
      fetchFirstOk(tryUrls("hungary-counties.json")),
      fetchFirstOk(tryUrls("locations.json"))
    ]);

    const highlighted = new Set();

    (geo.features || []).forEach(f => {
      const p = f.properties || {};
      const raw =
        p.name || p.NAME || p.NAME_1 || p.megye || p.megye_nev || p.megyeNev ||
        p.county || p.County || p.COUNTY || p.MEGYE || p.NEV || p.Név || p.nev ||
        p.NUTS_NAME || p.NUTS_NAME_HU || p.TER_NEV || p.TERNEV || p.megye_name || "";
      f.__display = String(raw).trim();
      f.__key = keyOf(raw);
    });

    const arr = Array.isArray(loc?.counties) ? loc.counties : (Array.isArray(loc) ? loc : []);
    arr.forEach(c => {
      const k = keyOf(c.county_name || c.megye || c.name || "");
      if (k) highlighted.add(k);
    });

    const baseStyle = {
      fillColor: "#e5e7eb", fillOpacity: 0.0,
      color: "#cbd5e1", weight: 1, opacity: 1,
      className: "county-outline"
    };
    const hotStyle  = {
      fillColor: "#16a34a", fillOpacity: 0.6,
      color: "#15803d", weight: 2, opacity: 1,
      className: "county-outline"
    };

    countyLayer = L.geoJSON(geo, {
      style: f => highlighted.has(f.__key) ? hotStyle : baseStyle,
      onEachFeature: (feature, layer) => {
        layer.feature.__key = feature.__key;

        layer.bindTooltip(feature.__display, {
          permanent: true,
          direction: "center",
          className: "county-label"
        }).openTooltip();

        layer.on("click", () => showCounty(feature.__key));
        layer.on("mouseover", () => highlighted.has(feature.__key) && layer.setStyle({ fillColor: "#15803d" }));
        layer.on("mouseout",  () => highlighted.has(feature.__key) && layer.setStyle({ fillColor: "#16a34a" }));
      }
    }).addTo(map);

    ensureUi();
    showOverview();
  })().catch(e => {
    console.error("Térkép betöltési hiba:", e);
    mapEl.innerHTML = '<p class="text-center text-white">Hiba történt a térkép betöltésekor.</p>';
  });
})();
