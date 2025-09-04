<script>
/* interaktív megye -> város nézet + geokódolás (offline->online->fallback, county-bias)
   + Beállító panel (Tuner) mobil/desktop nézethez, mentéssel
   + Tartós vízszintes eltolás (shiftX) – pozitív = balra tolás */
(() => {
  const mapEl = document.getElementById("work-map");
  if (!mapEl) return;

  /* ======= Ha kész vagy a hangolással, állítsd false-ra ======= */
  const DEV_TUNER = false;

  // --- VÉGLEGES, BEÉGETETT NÉZETBEÁLLÍTÁSOK ---
  const DEFAULT_ZOOMCFG = {
    overview: {
      desktop: { bump: -1.30, pad: {T:12, L:8,  R:200, B:20},  shiftX: 0 },
      mobile:  { bump: -0.95, pad: {T:10, L:8,  R:120, B:16},  shiftX: 0 }
    },
    county: {
      desktop: { bump: -0.35, pad: {T:14, L:14, R:14,  B:14},  shiftX: 0 },
      mobile:  { bump: -0.40, pad: {T:12, L:12, R:12,  B:12},  shiftX: 0 }
    }
  };

  const CFG_KEY = "WORKMAP_CFG_V1";
  const deepClone = (o) => JSON.parse(JSON.stringify(o));

  // Alap: a beégetett; ha van elmentett tuner-érték a gépeden, azt betöltjük
  let ZOOMCFG = deepClone(DEFAULT_ZOOMCFG);
  try {
    const saved = JSON.parse(localStorage.getItem(CFG_KEY) || "null");
    if (saved && saved.overview && saved.county) ZOOMCFG = saved;
  } catch {}

  /* ===================== Segédek ===================== */
  const strip = s => String(s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  const keyOf  = s => strip(s).replace(/\bmegye\b/gi, "").replace(/\s+/g, " ").trim().toLowerCase();
  const sleep  = (ms) => new Promise(r => setTimeout(r, ms));
  const round5 = n => Math.round(Number(n) * 1e5) / 1e5;
  const clamp  = (v,min,max)=>Math.min(max,Math.max(min,v));

  const tryUrls = (file) => [
    `data/${file}`, `/data/${file}`, new URL(`data/${file}`, document.baseURI).href
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

  /* ===== Geo cache ===== */
  const CACHE_KEY = "geoCache-v3";
  let geoCache = {};
  try { geoCache = JSON.parse(localStorage.getItem(CACHE_KEY) || "{}"); } catch {}
  const cacheGet = (countyKey, cityName) => geoCache[`${countyKey}|${keyOf(cityName)}`];
  const cacheSet = (countyKey, cityName, lat, lng) => {
    geoCache[`${countyKey}|${keyOf(cityName)}`] = { lat: round5(lat), lng: round5(lng) };
    try { localStorage.setItem(CACHE_KEY, JSON.stringify(geoCache)); } catch {}
  };

  /* ===== Opcionális offline település-index ===== */
  let OFFLINE_INDEX = null;
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
    } catch { OFFLINE_INDEX = {}; }
    return OFFLINE_INDEX;
  }

  /* ===== Találat behúzása a megye bbox-ba ===== */
  function snapWithinBounds(lat, lng, bounds) {
    const minLat = bounds.getSouth(), maxLat = bounds.getNorth();
    const minLng = bounds.getWest(),  maxLng = bounds.getEast();
    const m = 0.002;
    const clampedLat = Math.min(maxLat - m, Math.max(minLat + m, lat));
    const clampedLng = Math.min(maxLng - m, Math.max(minLng + m, lng));
    return { lat: clampedLat, lng: clampedLng };
  }

  /* ===== Online geokódolás – viewbox bias ===== */
  async function geocodeOnline(cityName, countyDisplay, countyBounds) {
    await sleep(900);
    const west  = countyBounds.getWest();
    const south = countyBounds.getSouth();
    const east  = countyBounds.getEast();
    const north = countyBounds.getNorth();

    const q = `${cityName}, ${countyDisplay} megye, Magyarország`;
    const url =
      `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&countrycodes=hu&accept-language=hu` +
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

  /* ===== Város -> {lat,lng} ===== */
  async function resolveLatLng(cityName, countyKey, countyDisplay, countyBounds) {
    const hit = cacheGet(countyKey, cityName);
    if (hit) return hit;

    const idx = await loadOfflineIndex();
    const off = idx[keyOf(cityName)];
    if (off) { cacheSet(countyKey, cityName, off.lat, off.lng); return off; }

    try {
      const online = await geocodeOnline(cityName, countyDisplay, countyBounds);
      if (online) { cacheSet(countyKey, cityName, online.lat, online.lng); return online; }
    } catch (e) { console.warn("Online geokódolás hiba:", e); }

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

  /* ===================== Zoom helper ===================== */
  function currentCfg(mode) {
    const isMobile = mapEl.clientWidth < 640;
    return ZOOMCFG[mode][isMobile ? "mobile" : "desktop"];
  }

  function flyFit(bounds, mode /* "overview" | "county" */) {
    const cfg = currentCfg(mode);
    const bump = Math.min(0, Number(cfg.bump) || 0);
    const fitZoom = map.getBoundsZoom(bounds, true);
    const maxZoom = Math.min(22, fitZoom + bump);
    const P = cfg.pad || {T:0,L:0,R:0,B:0};

    map.flyToBounds(bounds, {
      maxZoom,
      paddingTopLeft:     [Number(P.L)||0, Number(P.T)||0],
      paddingBottomRight: [Number(P.R)||0, Number(P.B)||0],
      duration: Number(cfg.duration) || 0.5,
      easeLinearity: 0.15
    });

    return { maxZoom, cfg };
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
      const { maxZoom, cfg } = flyFit(b, "overview");

      const afterFit = () => {
        map.off("moveend", afterFit);
        const shift = Number(cfg.shiftX) || 0;
        if (shift) {
          map.panBy([-shift, 0], { animate: false });
          map.once("moveend", freeze);
          setTimeout(() => freeze(), 0);
        } else {
          freeze();
        }
      };
      const freeze = () => {
        const lock = map.getBounds();
        map.setMinZoom(maxZoom);
        map.setMaxZoom(maxZoom);
        map.setMaxBounds(lock.pad(0.002));
        setInteractions(false);
      };

      map.on("moveend", afterFit);
    }

    backBtn?.classList.add("hidden");
    infoBadge?.classList.add("hidden");
  }

  async function showCounty(countyKey) {
    selectedCountyKey = countyKey;
    if (!countyLayer) return;

    unlockView();

    let target = null;
    countyLayer.eachLayer(l => { if (l.feature.__key === countyKey) target = l; });
    if (!target) return;
    const b = target.getBounds();

    map.invalidateSize();
    const { maxZoom, cfg } = flyFit(b, "county");

    const afterFit = () => {
      map.off("moveend", afterFit);
      const shift = Number(cfg.shiftX) || 0;
      if (shift) {
        map.panBy([-shift, 0], { animate: false });
        map.once("moveend", freeze);
        setTimeout(() => freeze(), 0);
      } else {
        freeze();
      }
    };
    const freeze = () => {
      const lock = map.getBounds();
      map.setMinZoom(maxZoom);
      map.setMaxZoom(maxZoom);
      map.setMaxBounds(lock.pad(0.0035));
      setInteractions(false);
    };
    map.on("moveend", afterFit);

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
        radius: 6, weight: 2, color: "#b91c1c", fillColor: "#ef4444", fillOpacity: 0.9
      }).addTo(cityLayer);

      marker.bindTooltip(String(name), {
        permanent: true, direction: "right", offset: [8, 0], className: "city-label"
      }).openTooltip();

      countPlaced++;
    }

    infoBadge.textContent = countPlaced
      ? `Megjelölt városok: ${countPlaced}`
      : "Ebben a megyében még nincs megjelölt város.";

    backBtn.classList.remove("hidden");
    infoBadge.classList.remove("hidden");
  }

  /* ===================== Tuner panel ===================== */
  if (DEV_TUNER) {
    // ... (a tuner kódod marad, itt nem változik)
  }

  /* ===================== Betöltés + megye-réteg ===================== */
  (async () => {
    const [geo, locData] = await Promise.all([
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

    const arr = Array.isArray(locData?.counties) ? locData.counties : (Array.isArray(locData) ? locData : []);
    arr.forEach(c => {
      const k = keyOf(c.county_name || c.megye || c.name || "");
      if (k) highlighted.add(k);
    });

    const baseStyle = { fillColor:"#e5e7eb", fillOpacity:0.0, color:"#cbd5e1", weight:1, opacity:1, className:"county-outline" };
    const hotStyle  = { fillColor:"#16a34a", fillOpacity:0.6, color:"#15803d", weight:2, opacity:1, className:"county-outline" };

    countyLayer = L.geoJSON(geo, {
      style: f => highlighted.has(f.__key) ? hotStyle : baseStyle,
      onEachFeature: (feature, layer) => {
        layer.feature.__key = feature.__key;
        layer.bindTooltip(feature.__display, { permanent:true, direction:"center", className:"county-label" }).openTooltip();
        layer.on("click", () => showCounty(feature.__key));
        layer.on("mouseover", () => highlighted.has(feature.__key) && layer.setStyle({ fillColor: "#15803d" }));
        layer.on("mouseout",  () => highlighted.has(feature.__key) && layer.setStyle({ fillColor: "#16a34a" }));
      }
    }).addTo(map);

    loc = locData;
    ensureUi();
    showOverview();
  })().catch(e => {
    console.error("Térkép betöltési hiba:", e);
    mapEl.innerHTML = '<p class="text-center text-white">Hiba történt a térkép betöltésekor.</p>';
  });
})();
</script>
