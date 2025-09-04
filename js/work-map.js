/* interaktív megye -> város nézet + automata geokódolás (offline->online->fallback) */
(() => {
  const mapEl = document.getElementById("work-map");
  if (!mapEl) return;

  /* ===================== Segédek ===================== */
  const strip = s => String(s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  const keyOf  = s => strip(s).replace(/\bmegye\b/gi, "").replace(/\s+/g, " ").trim().toLowerCase();
  const sleep  = (ms) => new Promise(r => setTimeout(r, ms));
  const isMobile = () => mapEl.clientWidth < 640;

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

  /* ===== Geokód cache a böngészőben ===== */
  const CACHE_KEY = "geoCache-v3";   // új kulcs, hogy a régi pontatlan értékek ne maradjanak meg
  let geoCache = {};
  try { geoCache = JSON.parse(localStorage.getItem(CACHE_KEY) || "{}"); } catch {}

  const cacheGet = (countyKey, cityName) => {
    const k = `${countyKey}|${keyOf(cityName)}`;
    return geoCache[k];
  };
  const cacheSet = (countyKey, cityName, lat, lng) => {
    const k = `${countyKey}|${keyOf(cityName)}`;
    // kvantáljuk 5 tizedesre, hogy minden eszközön ugyanaz legyen
    const q = (n) => Math.round(n * 1e5) / 1e5;
    geoCache[k] = { lat: q(lat), lng: q(lng) };
    try { localStorage.setItem(CACHE_KEY, JSON.stringify(geoCache)); } catch {}
  };

  /* ===== Opcionális offline település-index betöltése (ha létezik) ===== */
  let OFFLINE_INDEX = null; // { "iszkaz": {lat:.., lng:..}, ... }
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
          idx[keyOf(name)] = { lat, lng };
        }
      });
      OFFLINE_INDEX = idx;
    } catch {
      OFFLINE_INDEX = {}; // nincs offline adat – nem baj
    }
    return OFFLINE_INDEX;
  }

  /* ===== kis segéd: clamp egy bounds dobozba ===== */
  function clampToBounds(lat, lng, bounds) {
    const south = bounds.getSouth();
    const north = bounds.getNorth();
    const west  = bounds.getWest();
    const east  = bounds.getEast();
    const cLat = Math.min(north, Math.max(south, lat));
    const cLng = Math.min(east,  Math.max(west,  lng));
    return { lat: cLat, lng: cLng };
  }

  /* ===== Online geokódolás (OSM Nominatim) – megye-bounding boxszal szűkítve ===== */
  async function geocodeOnline(cityName, countyDisplay, countyBounds) {
    // ne spammeljünk
    await sleep(900);

    // Nominatim viewbox: minlon,minlat,maxlon,maxlat (FIGYELEM: lon, lat sorrend!)
    const vb = [
      countyBounds.getWest(),
      countyBounds.getSouth(),
      countyBounds.getEast(),
      countyBounds.getNorth()
    ].join(",");

    const q = `${cityName}, ${countyDisplay} megye, Magyarország`;
    const url =
      `https://nominatim.openstreetmap.org/search?` +
      `format=jsonv2&limit=1&dedupe=1&bounded=1&countrycodes=hu&accept-language=hu&` +
      `viewbox=${encodeURIComponent(vb)}&q=${encodeURIComponent(q)}`;

    const r = await fetch(url, { headers: { "Accept-Language": "hu" } });
    if (!r.ok) throw new Error(`Nominatim HTTP ${r.status}`);
    const arr = await r.json();
    if (Array.isArray(arr) && arr[0]?.lat && arr[0]?.lon) {
      return { lat: parseFloat(arr[0].lat), lng: parseFloat(arr[0].lon) };
    }
    return null;
  }

  /* ===== Város -> {lat,lng} feloldás több lépcsőben ===== */
  async function resolveLatLng(cityName, countyKey, countyDisplay, countyBounds) {
    // 0) cache
    const hit = cacheGet(countyKey, cityName);
    if (hit) return hit;

    // 1) offline index
    const idx = await loadOfflineIndex();
    const off = idx[keyOf(cityName)];
    if (off) {
      const clamped = clampToBounds(off.lat, off.lng, countyBounds);
      cacheSet(countyKey, cityName, clamped.lat, clamped.lng);
      return clamped;
    }

    // 2) online – OSM Nominatim, megye-bboxra szűkítve
    try {
      const online = await geocodeOnline(cityName, countyDisplay, countyBounds);
      if (online) {
        const clamped = clampToBounds(online.lat, online.lng, countyBounds);
        cacheSet(countyKey, cityName, clamped.lat, clamped.lng);
        return clamped;
      }
    } catch (e) {
      console.warn("Online geokódolás hiba:", e);
    }

    // 3) végső fallback: megye közepe
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
    // ESC = vissza
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
      map.fitBounds(b, { padding: [2, 2] });
      map.setMinZoom(map.getZoom());
      map.setMaxZoom(map.getZoom());
      map.setMaxBounds(b.pad(0.005));
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

    // "cover" zoom: kis finomhangolás külön mobil / desktop
    const fitZoom = map.getBoundsZoom(b, true);
    const bump = isMobile() ? -0.15 : 0.01;           // mobilon kicsit kijjebb, gépen épphogy beljebb
    const targetZoom = Math.min(22, fitZoom + bump);

    map.invalidateSize();
    map.flyTo(b.getCenter(), targetZoom, { duration: 0.50, easeLinearity: 0.15 });

    const freeze = () => {
      map.off("moveend", freeze);
      map.setMinZoom(targetZoom);
      map.setMaxZoom(targetZoom);
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

    // minden várost kirakunk (ha string, objektummá alakítjuk)
    const rawCities = (countyRow?.cities || []).map(c => (typeof c === "string" ? { city_name: c } : c));

    let countPlaced = 0;
    for (const c of rawCities) {
      const name = c.city_name || c.name;
      if (!name) continue;

      // koordináták feloldása több lépcsőben
      let lat = c.lat, lng = c.lng;
      if (typeof lat !== "number" || typeof lng !== "number") {
        const pos = await resolveLatLng(name, countyKey, countyDisplay, b);
        lat = pos.lat; lng = pos.lng;
      } else {
        // ha kézzel megadott, akkor is clamp a megye bboxába
        const p = clampToBounds(lat, lng, b);
        lat = p.lat; lng = p.lng;
      }

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
    const [geoData, locData] = await Promise.all([
      fetchFirstOk(tryUrls("hungary-counties.json")),
      fetchFirstOk(tryUrls("locations.json"))
    ]);
    geo = geoData;
    loc = locData;

    // megye kulcsok + feliratok
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
