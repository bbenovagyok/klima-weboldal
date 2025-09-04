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
      desktop: { bump: 0, pad: {T:0, L:0,  R:0, B:100},  shiftX: 100 },
      mobile:  { bump: -0.6, pad: {T:0, L:0,  R:0, B:0},  shiftX: 45 }
    },
    county: {
      desktop: { bump: -1.5, pad: {T:0, L:0, R:0,  B:0},  shiftX: 0 },
      mobile:  { bump: -0.5, pad: {T:8, L:12, R:12,  B:14},  shiftX: 0 }
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
      duration: Number(cfg.duration) || 0.35,
      easeLinearity: 0.25
    });

    return { maxZoom, cfg };
  }

  /* ===================== Állapot + UI ===================== */
  let loc;
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
    const css = document.createElement("style");
    css.textContent = `
      .tuner-panel {
        position:absolute; right:10px; top:10px; z-index:9999;
        background:#ffffffcc; backdrop-filter: blur(6px);
        border:1px solid #cbd5e1; border-radius:12px; padding:10px;
        font: 12px/1.3 system-ui, -apple-system, "Segoe UI", Roboto, Inter, Arial, sans-serif;
        color:#0f172a; box-shadow:0 10px 24px rgba(2,6,23,.2); width: 270px;
      }
      .tuner-panel h4 { margin:0 0 8px 0; font-size:13px; }
      .tuner-row { display:flex; align-items:center; gap:6px; margin:6px 0; }
      .tuner-row label { width:88px; color:#334155; }
      .tuner-row input[type="number"] { width:72px; padding:3px 6px; border:1px solid #94a3b8; border-radius:8px; }
      .tuner-row .padbox { width:52px; }
      .tuner-btns { display:flex; flex-wrap:wrap; gap:6px; margin-top:8px; }
      .tbtn { padding:6px 8px; border-radius:8px; border:1px solid #0ea5e9; color:#0c4a6e; background:#e0f2fe; cursor:pointer; }
      .tbtn.alt { border-color:#10b981; background:#dcfce7; color:#065f46; }
      .tbtn.warn { border-color:#f59e0b; background:#fff7ed; color:#78350f; }
      .tuner-selects { display:flex; gap:6px; margin-bottom:6px; }
      .tuner-selects select { flex:1; padding:4px 6px; border:1px solid #94a3b8; border-radius:8px; }
      .muted { color:#64748b; }
    `;
    document.head.appendChild(css);

    const panel = document.createElement("div");
    panel.className = "tuner-panel";
    panel.innerHTML = `
      <h4>🛠️ Térkép Tuner</h4>
      <div class="tuner-selects">
        <select id="tmode">
          <option value="overview">Alap nézet</option>
          <option value="county">Megye nézet</option>
        </select>
        <select id="tdevice">
          <option value="mobile">Mobil</option>
          <option value="desktop">Desktop</option>
        </select>
      </div>

      <div class="tuner-row">
        <label>Zoom bump</label>
        <input id="tbump" type="number" step="0.05" min="-2" max="0" />
        <span class="muted">(negatív = kijjebb)</span>
      </div>

      <div class="tuner-row"><label>Padding T</label><input id="tpadT" class="padbox" type="number" step="2" min="0" /></div>
      <div class="tuner-row"><label>Padding L</label><input id="tpadL" class="padbox" type="number" step="2" min="0" /></div>
      <div class="tuner-row"><label>Padding R</label><input id="tpadR" class="padbox" type="number" step="2" min="0" /></div>
      <div class="tuner-row"><label>Padding B</label><input id="tpadB" class="padbox" type="number" step="2" min="0" /></div>

      <div class="tuner-row">
        <label>Eltolás X (px)</label>
        <input id="tshiftX" type="number" step="10" min="-600" max="600" />
        <span class="muted" title="Pozitív = balra tolás">(+ = balra)</span>
      </div>

      <div class="tuner-btns">
        <button id="tpreviewOverview" class="tbtn">Előnézet: Alap</button>
        <button id="tpreviewCounty" class="tbtn">Előnézet: Megye</button>
        <button id="tsave" class="tbtn alt">Mentés</button>
        <button id="treset" class="tbtn warn">Gyári vissza</button>
      </div>
      <div class="muted" style="margin-top:6px">Tipp: nagyobb <b>R</b> padding + pozitív <b>Eltolás X</b> = alap nézet balra tolva.</div>
    `;
    mapEl.appendChild(panel);

    const $ = (id) => panel.querySelector(id);
    const els = {
      mode:   $("#tmode"),
      dev:    $("#tdevice"),
      bump:   $("#tbump"),
      padT:   $("#tpadT"),
      padL:   $("#tpadL"),
      padR:   $("#tpadR"),
      padB:   $("#tpadB"),
      shiftX: $("#tshiftX"),
      prevO:  $("#tpreviewOverview"),
      prevC:  $("#tpreviewCounty"),
      save:   $("#tsave"),
      reset:  $("#treset")
    };

    function currentCfgUI() { return ZOOMCFG[els.mode.value][els.dev.value]; }
    function syncInputsFromCfg() {
      const c = currentCfgUI();
      els.bump.value  = String(c.bump ?? 0);
      els.padT.value  = String(c.pad?.T ?? 0);
      els.padL.value  = String(c.pad?.L ?? 0);
      els.padR.value  = String(c.pad?.R ?? 0);
      els.padB.value  = String(c.pad?.B ?? 0);
      els.shiftX.value= String(c.shiftX ?? 0);
    }
    function applyInputsToCfg() {
      const c = currentCfgUI();
      c.bump  = clamp(Number(els.bump.value||0), -2, 0);
      c.pad   = {
        T: clamp(Number(els.padT.value||0),0, 500),
        L: clamp(Number(els.padL.value||0),0, 500),
        R: clamp(Number(els.padR.value||0),0, 500),
        B: clamp(Number(els.padB.value||0),0, 500)
      };
      c.shiftX = clamp(Number(els.shiftX.value||0), -600, 600);
    }

    els.mode.addEventListener("change", syncInputsFromCfg);
    els.dev.addEventListener("change", syncInputsFromCfg);
    [els.bump, els.padT, els.padL, els.padR, els.padB, els.shiftX].forEach(inp=>{
      inp.addEventListener("change", ()=>{ applyInputsToCfg(); });
    });

    els.prevO.addEventListener("click", ()=>{ applyInputsToCfg(); showOverview(); });
    els.prevC.addEventListener("click", ()=>{
      applyInputsToCfg();
      if (selectedCountyKey) showCounty(selectedCountyKey);
      else alert("Kattints egy megyére a térképen, és utána használd ezt a gombot!");
    });

    els.save.addEventListener("click", ()=>{
      applyInputsToCfg();
      localStorage.setItem(CFG_KEY, JSON.stringify(ZOOMCFG));
      els.save.textContent = "Mentve ✔";
      setTimeout(()=>els.save.textContent="Mentés",1200);
    });

    els.reset.addEventListener("click", ()=>{
      ZOOMCFG = deepClone(DEFAULT_ZOOMCFG);
      localStorage.setItem(CFG_KEY, JSON.stringify(ZOOMCFG));
      syncInputsFromCfg();
      showOverview();
    });

    syncInputsFromCfg();
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
