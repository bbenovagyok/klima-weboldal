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
  const parseJsonSafe = (t) => (t.charCodeAt(0) === 0xFEFF ? JSON.parse(t.slice(1)) : JSON.parse(t));
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
    maxZoom: 22                 // kell, hogy ránagyíthassunk
  }).addTo(map);

  map.fitBounds(HU_TMP, { padding: [0, 0] });

  function setInteractions(on) {
    const f = on ? "enable" : "disable";
    map.dragging[f](); map.scrollWheelZoom[f](); map.doubleClickZoom[f]();
    map.touchZoom[f](); map.boxZoom[f](); map.keyboard[f]();
  }
  function unlockView() {
    // elengedjük az előző korlátokat, hogy szabadon zoomolhasson a fit/fly
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
  }

  // ===== nézetek
  function showOverview() {
    selectedCountyKey = null;

    // felszedjük a város-réteget
    if (cityLayer) { map.removeLayer(cityLayer); cityLayer = null; }

    // minden megye eredeti stílus + látszódjon a réteg
    if (countyLayer) {
      countyLayer.eachLayer(l => countyLayer.resetStyle(l));
      countyLayer.addTo(map);

      // országkeret + fixálás (statikus nézet)
      unlockView();
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

    // engedjük el a korlátokat, különben nem tud ránagyítani
    unlockView();

    // megkeressük a kiválasztott megyét
    let target = null;
    countyLayer.eachLayer(l => { if (l.feature.__key === countyKey) target = l; });
    if (!target) return;
    const b = target.getBounds();

    // "cover" zoom: számolunk egy illeszkedő zoomot, majd rátolunk, hogy kitöltse a #work-map-et
    const fitZoom    = map.getBoundsZoom(b, true);
// kisebb ráemelés (mobil / desktop)
const bump       = mapEl.clientWidth < 640 ? -0.15: 0.01;
const targetZoom = Math.min(22, fitZoom + bump);
map.flyTo(b.getCenter(), targetZoom, { duration: 0.50, easeLinearity: 0.15 });

    // amikor odaért, fagyasszuk le (ne lehessen elmozgatni/zoomolni)
    setTimeout(() => {
      map.setMinZoom(map.getZoom());
      map.setMaxZoom(map.getZoom());
      map.setMaxBounds(b.pad(0.001));  // gyakorlatilag teljesen fix
      setInteractions(false);
    }, 900);

    // város-pöttyök kirajzolása
    if (cityLayer) { map.removeLayer(cityLayer); cityLayer = null; }
    cityLayer = L.layerGroup().addTo(map);

    const dataArr = Array.isArray(loc?.counties) ? loc.counties : (Array.isArray(loc) ? loc : []);
    const countyRow = dataArr.find(c => keyOf(c.county_name || c.megye || c.name) === countyKey);

    const cities = (countyRow?.cities || []).filter(c => c?.completed && c?.lat && c?.lng);

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
    [geo, loc] = await Promise.all([
      fetchFirstOk(tryUrls("hungary-counties.json")),
      fetchFirstOk(tryUrls("locations.json"))
    ]);

    // megye kulcsok + megjelenített nevek
    const highlighted = new Set();
    const displayByKey = new Map();

    (geo.features || []).forEach(f => {
      const p = f.properties || {};
      const raw =
        p.name || p.NAME || p.NAME_1 || p.megye || p.megye_nev || p.megyeNev ||
        p.county || p.County || p.COUNTY || p.MEGYE || p.NEV || p.Név || p.nev ||
        p.NUTS_NAME || p.NUTS_NAME_HU || p.TER_NEV || p.TERNEV || p.megye_name || "";
      const k = keyOf(raw);
      f.__display = String(raw).trim();
      f.__key = k;
      displayByKey.set(k, f.__display);
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
        // a kulcsot elmentjük a layerre
        layer.feature.__key = feature.__key;

        // felirat ország-nézetben
        layer.bindTooltip(feature.__display, {
          permanent: true,
          direction: "center",
          className: "county-label"
        }).openTooltip();

        // kattintás: belépés megye-nézetbe
        layer.on("click", () => showCounty(feature.__key));

        // hover effekt csak a kijelölt (zöld) megyékre
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
