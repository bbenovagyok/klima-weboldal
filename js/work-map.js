/* interaktív megye -> város nézet | koord. és "completed" automatikus */
(() => {
  const mapEl = document.getElementById("work-map");
  if (!mapEl) return;

  // ===== segédek
  const strip = s => String(s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  const keyOf  = s => strip(s).replace(/\bmegye\b/gi, "").replace(/\s+/g, " ").trim().toLowerCase();
  const trimStr = s => String(s || "").trim();

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

  // nagyon kicsi beépített névtár végső fallbacknek (ha nincs hu-cities.json és a geokódolás sem megy)
  const tinyGazetteer = [
    { name:"Siófok",        lat:46.905, lng:18.059 },
    { name:"Kaposvár",      lat:46.359, lng:17.796 },
    { name:"Veszprém",      lat:47.093, lng:17.911 },
    { name:"Székesfehérvár",lat:47.186, lng:18.422 },
    { name:"Dunaújváros",   lat:46.964, lng:18.935 },
    { name:"Pécs",          lat:46.072, lng:18.233 },
    { name:"Szekszárd",     lat:46.352, lng:18.706 },
    { name:"Paks",          lat:46.624, lng:18.859 }
  ];

  const gazetteerIndex = new Map(); // "kulcs" -> {lat,lng,name}

  function indexGazetteer(list) {
    (list || []).forEach(row => {
      const nm = trimStr(row.name || row.city || row.city_name);
      if (!nm || typeof row.lat !== "number" || typeof row.lng !== "number") return;
      gazetteerIndex.set(keyOf(nm), { name:nm, lat:row.lat, lng:row.lng });
    });
  }

  // ===== Leaflet alap
  const HU_BOUNDS = L.latLngBounds([45.6, 16.0], [48.7, 22.95]);

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

  map.fitBounds(HU_BOUNDS, { padding: [0, 0] });

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
  let countyLayer = null;   // ország szintű megye poligonok
  let cityLayer   = null;   // kiválasztott megye város-pöttyök
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

  // ===== adatok normalizálása admin felülethez
  function normalizeCities(rawCities) {
    if (!Array.isArray(rawCities)) return [];
    return rawCities.map(c => {
      if (typeof c === "string") {
        return { city_name: trimStr(c), completed: true };
      }
      const name = trimStr(c.city_name || c.name || c.varos);
      const done = (c.completed === undefined ? true : !!c.completed);
      let lat = c.lat, lng = c.lng;
      if (!lat && !lng && typeof c.coords === "string") {
        const m = c.coords.split(",").map(s => parseFloat(s));
        if (m.length === 2 && m.every(n => !Number.isNaN(n))) { lat = m[0]; lng = m[1]; }
      }
      return { city_name: name, completed: done, lat, lng };
    }).filter(x => x.city_name);
  }

  // ===== koord. megszerzése (gazetteer / geokódolás)
  const GKEY = "hu-city-geo-";
  async function geocodeCityIfNeeded(name, countyDisplay) {
    const key = GKEY + keyOf(`${name}|${countyDisplay}`);
    try {
      const cached = localStorage.getItem(key);
      if (cached) {
        const p = JSON.parse(cached);
        if (typeof p.lat === "number" && typeof p.lng === "number") return p;
      }
    } catch {}
    // Nominatim – óvatosan, egy lekérés városonként, cache-elve
    try {
      const url = new URL("https://nominatim.openstreetmap.org/search");
      url.searchParams.set("format","json");
      url.searchParams.set("countrycodes","HU");
      url.searchParams.set("city", name);
      if (countyDisplay) url.searchParams.set("county", countyDisplay);
      url.searchParams.set("limit","1");

      const r = await fetch(url.toString(), {
        headers: { "Accept": "application/json", "User-Agent": "klima-site/1.0 (map)" }
      });
      const arr = await r.json();
      if (Array.isArray(arr) && arr[0] && arr[0].lat && arr[0].lon) {
        const p = { lat: parseFloat(arr[0].lat), lng: parseFloat(arr[0].lon) };
        if (!Number.isNaN(p.lat) && !Number.isNaN(p.lng)) {
          try { localStorage.setItem(key, JSON.stringify(p)); } catch {}
          return p;
        }
      }
    } catch {}
    return null;
  }

  function coordsFromGazetteer(name) {
    const hit = gazetteerIndex.get(keyOf(name));
    return hit ? { lat: hit.lat, lng: hit.lng } : null;
  }

  // ===== nézetek
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

  function showCounty(countyKey) {
    selectedCountyKey = countyKey;
    if (!countyLayer) return;

    unlockView();

    // megkeressük a kiválasztott megyét
    let target = null;
    countyLayer.eachLayer(l => { if (l.feature.__key === countyKey) target = l; });
    if (!target) return;
    const b = target.getBounds();

    // Töltse ki szinte teljesen a dobozt: minimális padding px-ben
    const pad = Math.max(6, mapEl.clientWidth < 640 ? 8 : 12);

    // finom animáció a megyére, "cover" hatás
    map.invalidateSize();
    map.flyToBounds(b, {
      paddingTopLeft:     [pad, pad],
      paddingBottomRight: [pad, pad],
      duration: 0.65,
      easeLinearity: 0.25
    });

    // a mozgás végén "lefagyasztjuk" a nézetet
    const freeze = () => {
      map.off("moveend", freeze);
      const nowZ = map.getZoom();
      map.setMinZoom(nowZ);
      map.setMaxZoom(nowZ);
      map.setMaxBounds(b.pad(0.0015));
      setInteractions(false);
    };
    map.on("moveend", freeze);

    // város-pöttyök
    if (cityLayer) { map.removeLayer(cityLayer); cityLayer = null; }
    cityLayer = L.layerGroup().addTo(map);

    const dataArr   = Array.isArray(loc?.counties) ? loc.counties : (Array.isArray(loc) ? loc : []);
    const countyRow = dataArr.find(c => keyOf(c.county_name || c.megye || c.name) === countyKey);
    const countyDisplay = String(countyRow?.county_name || countyRow?.megye || countyRow?.name || "").trim();

    const cities = normalizeCities(countyRow?.cities);

    let shown = 0;

    (async () => {
      for (const c of cities) {
        if (!c.completed) continue; // ha valaki direkt hamisra állítja
        const name = c.city_name;

        // 1) explicit lat/lng
        let pt = (typeof c.lat === "number" && typeof c.lng === "number")
          ? { lat:c.lat, lng:c.lng }
          : null;

        // 2) helyi névtár
        if (!pt) pt = coordsFromGazetteer(name);

        // 3) geokódolás + cache
        if (!pt) pt = await geocodeCityIfNeeded(name, countyDisplay);

        // 4) ha semmi, akkor kihagyjuk (nem dobunk hibát)
        if (!pt) continue;

        const marker = L.circleMarker([pt.lat, pt.lng], {
          radius: 6,
          weight: 2,
          color: "#b91c1c",
          fillColor: "#ef4444",
          fillOpacity: 0.9
        }).addTo(cityLayer);

        marker.bindTooltip(String(name), {
          permanent: true,
          direction: "auto",
          offset: [8, 0],
          className: "city-label"
        }).openTooltip();

        shown++;
      }

      infoBadge.textContent = shown
        ? `Megjelölt városok: ${shown}`
        : "Ebben a megyében még nincs megjelölt város.";

      backBtn.classList.remove("hidden");
      infoBadge.classList.remove("hidden");
    })();
  }

  // ===== betöltés + megye-réteg
  (async () => {
    // hu-cities.json (opcionális, de erősen ajánlott)
    try {
      const gaz = await fetchFirstOk(tryUrls("hu-cities.json")).catch(() => null);
      if (gaz) indexGazetteer(gaz);
    } catch {}
    // beépített mini fallback
    indexGazetteer(tinyGazetteer);

    [geo, loc] = await Promise.all([
      fetchFirstOk(tryUrls("hungary-counties.json")),
      fetchFirstOk(tryUrls("locations.json"))
    ]);

    // megye kulcsok + megjelenített nevek
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
