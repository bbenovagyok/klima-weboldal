/* interaktív megye -> város nézet, lat/lng nélkül is működik */
(() => {
  const mapEl = document.getElementById("work-map");
  if (!mapEl) return;

  // ===== segédek
  const strip = s => String(s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  const keyOf  = s => strip(s).replace(/\bmegye\b/gi, "").replace(/\s+/g, " ").trim().toLowerCase();

  // Kis offline adatbázis a leggyakoribb városokhoz (Somogy, Veszprém, Fejér, Tolna és környék)
  const CITY_DB = {
    "siofok":[46.9090,18.1046],
    "kaposvar":[46.3590,17.7960],
    "balatonfoldvar":[46.856,17.879],
    "fonyod":[46.748,17.579],
    "zamardi":[46.882,17.953],

    "veszprem":[47.0930,17.9110],
    "balatonfured":[46.9610,17.8710],
    "balatonalmadi":[47.035,18.012],
    "ajka":[47.103,17.557],
    "tapolca":[46.886,17.441],

    "szekesfehervar":[47.186,18.422],
    "dunaujvaros":[46.967,18.935],
    "garder":[47.2,18.4], // védő: ha félreírás lenne
    "bicske":[47.487,18.639],

    "szekszard":[46.350,18.704],
    "paks":[46.623,18.858],
    "tolna":[46.423,18.782]
  };

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

  // ===== Leaflet alap
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

  // ===== állapot + UI elemek
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

  // Áttekintő nézet paddingok (desktop / mobil)
  function fitWorldBounds(layer) {
    const b = layer.getBounds();
    const isMobile = mapEl.clientWidth < 640;
    const pad = isMobile ? [34, 28] : [26, 24];
    map.fitBounds(b, { paddingTopLeft: pad, paddingBottomRight: pad });
    map.setMinZoom(map.getZoom());
    map.setMaxZoom(map.getZoom());
    map.setMaxBounds(b.pad(0.005));
  }

  function showOverview() {
    selectedCountyKey = null;
    if (cityLayer) { map.removeLayer(cityLayer); cityLayer = null; }

    if (countyLayer) {
      countyLayer.eachLayer(l => countyLayer.resetStyle(l));
      countyLayer.addTo(map);

      unlockView();
      map.invalidateSize();
      fitWorldBounds(countyLayer);
    }

    setInteractions(false);
    backBtn?.classList.add("hidden");
    infoBadge?.classList.add("hidden");
  }

  // Név -> koordináta (lat,lng). Először a városon belül megadott érték, ha nincs, akkor a szótár.
  function coordsForCity(entry, countyRow) {
    // név
    const name = typeof entry === "string"
      ? entry
      : (entry.city_name || entry.name || "");

    const k = keyOf(name);
    if (!k) return null;

    // completed alapból true, csak explicit false esetén hagyjuk ki
    const completed = typeof entry === "object" && "completed" in entry ? !!entry.completed : true;
    if (!completed) return null;

    // lat/lng, ha volt megadva
    let lat = (typeof entry === "object" ? entry.lat : undefined);
    let lng = (typeof entry === "object" ? entry.lng : undefined);

    if (typeof lat !== "number" || typeof lng !== "number") {
      const hit = CITY_DB[k];
      if (hit) [lat, lng] = hit;
    }
    if (typeof lat !== "number" || typeof lng !== "number") return null;

    return { name: String(name), lat, lng };
  }

  function showCounty(countyKey) {
    selectedCountyKey = countyKey;
    if (!countyLayer) return;

    unlockView();

    // kiválasztott megye réteg + bounds
    let target = null;
    countyLayer.eachLayer(l => { if (l.feature.__key === countyKey) target = l; });
    if (!target) return;
    const b = target.getBounds();

    // finom animáció a megyére
    const pad = Math.max(6, mapEl.clientWidth < 640 ? 8 : 12);
    map.invalidateSize();
    map.flyToBounds(b, {
      paddingTopLeft:     [pad, pad],
      paddingBottomRight: [pad, pad],
      duration: 0.65,
      easeLinearity: 0.25
    });

    const freeze = () => {
      map.off("moveend", freeze);
      const nowZ = map.getZoom();
      map.setMinZoom(nowZ);
      map.setMaxZoom(nowZ);
      map.setMaxBounds(b.pad(0.0015));
      setInteractions(false);
    };
    map.on("moveend", freeze);

    // városok kirajzolása (keverék séma támogatás)
    if (cityLayer) { map.removeLayer(cityLayer); cityLayer = null; }
    cityLayer = L.layerGroup().addTo(map);

    const dataArr   = Array.isArray(loc?.counties) ? loc.counties : (Array.isArray(loc) ? loc : []);
    const countyRow = dataArr.find(c => keyOf(c.county_name || c.megye || c.name) === countyKey);

    const rawCities = countyRow?.cities || [];
    const cities = rawCities
      .map(entry => coordsForCity(entry, countyRow))
      .filter(Boolean);

    cities.forEach(c => {
      const marker = L.circleMarker([c.lat, c.lng], {
        radius: 6,
        weight: 2,
        color: "#b91c1c",
        fillColor: "#ef4444",
        fillOpacity: 0.9
      }).addTo(cityLayer);

      marker.bindTooltip(c.name, {
        permanent: true,
        direction: "right",
        offset: [8, 0],
        className: "city-label"
      }).openTooltip();
    });

    infoBadge.textContent = cities.length
      ? `Megjelölt városok: ${cities.length}`
      : "Ebben a megyében még nincs megjelölt város.";

    backBtn.classList.remove("hidden");
    infoBadge.classList.remove("hidden");
  }

  // ===== betöltés + megye-réteg
  (async () => {
    const [geo, locData] = await Promise.all([
      fetchFirstOk(tryUrls("hungary-counties.json")),
      fetchFirstOk(tryUrls("locations.json"))
    ]);
    loc = locData;

    // megye kulcsok + megjelenített nevek
    (geo.features || []).forEach(f => {
      const p = f.properties || {};
      const raw =
        p.name || p.NAME || p.NAME_1 || p.megye || p.megye_nev || p.megyeNev ||
        p.county || p.County || p.COUNTY || p.MEGYE || p.NEV || p.Név || p.nev ||
        p.NUTS_NAME || p.NUTS_NAME_HU || p.TER_NEV || p.TERNEV || p.megye_name || "";
      f.__display = String(raw).trim();
      f.__key = keyOf(raw);
    });

    // mely megyék legyenek kiemelve: minden, ami a JSON-ban szerepel
    const highlighted = new Set();
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

    // induló áttekintő: középmagyar fókusz (kicsit ráközelítve)
    ensureUi();
    map.invalidateSize();
    fitWorldBounds(countyLayer);
  })().catch(e => {
    console.error("Térkép betöltési hiba:", e);
    mapEl.innerHTML = '<p class="text-center text-white">Hiba történt a térkép betöltésekor.</p>';
  });
})();
