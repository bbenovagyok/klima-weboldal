/* interaktív megye -> város nézet, csak „Vissza” gombbal */
(() => {
  const mapEl = document.getElementById("work-map");
  if (!mapEl) return;

  // ===== segédek
  const strip = s => String(s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  const keyOf  = s => strip(s).replace(/\bmegye\b/gi, "").replace(/\s+/g, " ").trim().toLowerCase();

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

  // ===== belső padding + pan segédek (hogy a címkék ne lógjanak ki)
  function _innerPad(map) {
    const s = map.getSize();
    // kb. 8% szélesség, 24–120 px közé szorítva
    const p = Math.round(Math.min(120, Math.max(24, s.x * 0.08)));
    return [p, p];
  }
  function fitBoundsWithPad(map, bounds, opts = {}) {
    const [px, py] = _innerPad(map);
    map.fitBounds(bounds, {
      paddingTopLeft: [px, py],
      paddingBottomRight: [px, py],
      ...opts
    });
  }
  // pan egy pontot belülre hoz paddinggal (fallback, ha a natív panInside hiányzik)
  function panCityInside(map, latlng) {
    const [px, py] = _innerPad(map);
    const size = map.getSize();
    const pt = map.latLngToContainerPoint(latlng);
    const minX = px, maxX = size.x - px;
    const minY = py,  maxY = size.y - py;

    let dx = 0, dy = 0;
    if (pt.x < minX) dx = minX - pt.x;
    else if (pt.x > maxX) dx = maxX - pt.x;
    if (pt.y < minY) dy = minY - pt.y;
    else if (pt.y > maxY) dy = maxY - pt.y;

    if (dx !== 0 || dy !== 0) {
      map.panBy([dx, dy], { animate: true, duration: 0.5 });
    }
  }

  // ===== Leaflet alap
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

  fitBoundsWithPad(map, HU_TMP);

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
  let countyLayer = null;          // ország szintű megye poligonok
  let cityLayer   = null;          // kiválasztott megye város-pöttyök
  let selectedCountyKey = null;
  let selectedCountyBounds = null;

  // áttekintő nézet határai
  let overviewBoundsAll = null;    // összes megye
  let overviewBoundsActive = null; // csak a kiemelt megyék (locations.json szerint)

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

    // Átméretezéskor igazítsuk újra az éppen látható nézetet
    map.on("resize", () => {
      if (selectedCountyKey && selectedCountyBounds) {
        fitBoundsWithPad(map, selectedCountyBounds);
        const z = map.getZoom();
        map.setMinZoom(z); map.setMaxZoom(z);
        map.setMaxBounds(selectedCountyBounds.pad(0.0015));
      } else if (countyLayer) {
        const b = getOverviewTargetBounds();
        fitBoundsWithPad(map, b);
        const z = map.getZoom();
        map.setMinZoom(z); map.setMaxZoom(z);
        map.setMaxBounds(b.pad(0.005));
      }
    });
  }

  // <<< ÚJ segédfüggvény: áttekintő célbounds (mobilon kicsit tágabb)
  function getOverviewTargetBounds() {
    let b = (overviewBoundsActive || overviewBoundsAll || countyLayer.getBounds());
    const isMobile = window.matchMedia("(max-width: 640px)").matches;
    // Desktopon ~6% tágítás, mobilon ~12% (hogy a szomszéd megyenevek is beférjenek)
    return b.pad(isMobile ? 0.12 : 0.08);
  }

  // ===== nézetek
  function showOverview() {
    selectedCountyKey = null;
    selectedCountyBounds = null;
    if (cityLayer) { map.removeLayer(cityLayer); cityLayer = null; }

    if (countyLayer) {
      countyLayer.eachLayer(l => countyLayer.resetStyle(l));
      countyLayer.addTo(map);

      unlockView();
      map.invalidateSize();

      const b = getOverviewTargetBounds();
      fitBoundsWithPad(map, b);
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
    selectedCountyBounds = b;

    // finom animáció a megyére, dinamikus paddinggal
    map.invalidateSize();
    const [px, py] = _innerPad(map);
    map.flyToBounds(b, {
      paddingTopLeft:     [px, py],
      paddingBottomRight: [px, py],
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
    const cities    = (countyRow?.cities || []).filter(c => c?.completed && c?.lat && c?.lng);

    cities.forEach(c => {
      const marker = L.circleMarker([c.lat, c.lng], {
        radius: 6,
        weight: 2,
        color: "#b91c1c",
        fillColor: "#ef4444",
        fillOpacity: 0.9
      }).addTo(cityLayer);

      marker.bindTooltip(String(c.city_name || c.name), {
        permanent: true,
        direction: "auto",
        offset: [8, 0],
        className: "city-label"
      }).openTooltip();

      // interakció esetén biztosan belülre hozzuk
      marker.on("click", () => panCityInside(map, marker.getLatLng()));
      marker.on("mouseover", () => panCityInside(map, marker.getLatLng()));
    });

    infoBadge.textContent = cities.length
      ? `Megjelölt városok: ${cities.length}`
      : "Ebben a megyében még nincs megjelölt város.";

    backBtn.classList.remove("hidden");
    infoBadge.classList.remove("hidden");
  }

  // ===== betöltés + megye-réteg
  (async () => {
    const [geoData, locData] = await Promise.all([
      fetchFirstOk(tryUrls("hungary-counties.json")),
      fetchFirstOk(tryUrls("locations.json"))
    ]);
    geo = geoData; loc = locData;

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

    // áttekintő határok kiszámolása
    overviewBoundsAll = countyLayer.getBounds(); // minden megye
    countyLayer.eachLayer(l => {
      if (highlighted.has(l.feature.__key)) {
        const lb = l.getBounds();
        if (overviewBoundsActive) {
          overviewBoundsActive.extend(lb);
        } else {
          overviewBoundsActive = L.latLngBounds(lb.getSouthWest(), lb.getNorthEast());
        }
      }
    });

    ensureUi();
    showOverview();
  })().catch(e => {
    console.error("Térkép betöltési hiba:", e);
    mapEl.innerHTML = '<p class="text-center text-white">Hiba történt a térkép betöltésekor.</p>';
  });
})();
