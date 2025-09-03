/* interaktív megye -> város nézet, csak egy „Vissza” gombbal */
(() => {
  const mapEl = document.getElementById("work-map");
  if (!mapEl) return;

  // ===== helpers
  const strip = s => String(s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  const keyOf = s => strip(s).replace(/\bmegye\b/gi, "").replace(/\s+/g, " ").trim().toLowerCase();

  const tryUrls = (file) => [`data/${file}`, `/data/${file}`, new URL(`data/${file}`, document.baseURI).href];
  const parseJsonSafe = (t) => (t.charCodeAt(0) === 0xFEFF ? JSON.parse(t.slice(1)) : JSON.parse(t));
  const fetchFirstOk = async (cands) => {
    let last; for (const u of cands) {
      try { const r = await fetch(u, { cache: "no-store" }); if (!r.ok) throw new Error(r.statusText); return parseJsonSafe(await r.text()); }
      catch (e) { last = e; }
    }
    throw last || new Error("Betöltési hiba");
  };

  // ===== Leaflet alap
  const HU_TMP = L.latLngBounds([45.6, 16.0], [48.7, 22.95]);

  const map = L.map("work-map", {
    zoomControl: false,
    attributionControl: false,
    dragging: false, scrollWheelZoom: false, doubleClickZoom: false,
    touchZoom: false, boxZoom: false, keyboard: false, zoomSnap: 0, zoomDelta: 0.1
  });

  L.tileLayer("https://{s}.basemaps.cartocdn.com/light_nolabels/{z}/{x}/{y}{r}.png", {
    attribution: "&copy; OpenStreetMap & CARTO"
  }).addTo(map);

  map.fitBounds(HU_TMP, { padding: [0, 0] });

  // ===== állapot
  let geo, loc;
  let countyLayer;         // országnézet poligonok
  let cityLayer;           // város pöttyök egy megyében
  let selectedCountyKey;   // melyik megyében vagyunk
  let backBtn;             // Vissza gomb (DOM elem)
  let infoBadge;           // jobb alsó kis infó (DOM elem)

  // UI vezérlők (DOM a mapEl-en belül)
  function ensureUi() {
    if (!backBtn) {
      backBtn = document.createElement("button");
      backBtn.className = "map-back-btn hidden";
      backBtn.type = "button";
      backBtn.textContent = "← Vissza";
      backBtn.onclick = () => showOverview();
      mapEl.appendChild(backBtn);
    }
    if (!infoBadge) {
      infoBadge = document.createElement("div");
      infoBadge.className = "map-hint hidden";
      mapEl.appendChild(infoBadge);
    }
  }

  function setInteractions(on) {
    const f = on ? "enable" : "disable";
    map.dragging[f](); map.scrollWheelZoom[f](); map.doubleClickZoom[f]();
    map.touchZoom[f](); map.boxZoom[f](); map.keyboard[f]();
  }

  // ===== nézetek
  function showOverview() {
    selectedCountyKey = null;
    if (cityLayer) { map.removeLayer(cityLayer); cityLayer = null; }
    if (!countyLayer) return;

    countyLayer.eachLayer(l => countyLayer.resetStyle(l));
    countyLayer.addTo(map);

    // teljes ország keret
    const b = countyLayer.getBounds();
    map.fitBounds(b, { padding: [2, 2] });
    map.setMinZoom(map.getZoom());
    map.setMaxZoom(map.getZoom());
    map.setMaxBounds(b.pad(0.005));
    setInteractions(false);

    backBtn?.classList.add("hidden");
    infoBadge?.classList.add("hidden");
  }

  // >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>
  //     ÚJ: erős rázúzás megyére + utána plusz zoom
  // >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>
  function showCounty(countyKey) {
    selectedCountyKey = countyKey;
    if (!countyLayer) return;

    // a kiválasztott megye geometriája és bounds
    let target;
    countyLayer.eachLayer(l => {
      const k = l.feature.__key;
      if (k === countyKey) target = l;
    });
    if (!target) return;

    // interakciók tiltva maradnak
    setInteractions(false);

    // 1) Rárepülünk nagyon kicsi paddal, hogy a megye szinte kitöltse a keretet
    const b = target.getBounds();
    const PADDING = 6;      // ha még jobban rá akarod húzni, csökkentsd 4-re
    const ZOOM_BOOST = 1.25; // utólagos +zoom mértéke

    map.flyToBounds(b, { padding: [PADDING, PADDING], duration: 0.8, easeLinearity: 0.25 });

    // 2) amikor beállt a bounds, még egy kicsit rázúzunk
    const once = () => {
      map.off("moveend", once);
      const targetZoom = Math.min(
        (typeof map.getMaxZoom === "function" ? map.getMaxZoom() : 19),
        map.getZoom() + ZOOM_BOOST
      );
      setTimeout(() => {
        map.setZoom(targetZoom, { animate: true });

        // fagyasszuk be ezt a zoomot/boundst – ne lehessen mászni
        map.setMinZoom(map.getZoom());
        map.setMaxZoom(map.getZoom());
        map.setMaxBounds(b.pad(0.002));
      }, 80);
    };
    map.on("moveend", once);

    // város pöttyök kirajzolása (csak completed + lat/lng)
    if (cityLayer) { map.removeLayer(cityLayer); cityLayer = null; }
    cityLayer = L.layerGroup().addTo(map);

    const countyRow =
      (Array.isArray(loc?.counties) ? loc.counties : loc)?.find(c => keyOf(c.county_name || c.megye || c.name) === countyKey);

    const cities = (countyRow?.cities || []).filter(c => c?.completed && c?.lat && c?.lng);

    cities.forEach(c => {
      const p = L.circleMarker([c.lat, c.lng], {
        radius: 6, weight: 2,
        color: "#b91c1c", fillColor: "#ef4444", fillOpacity: 0.9
      }).addTo(cityLayer);

      // városnév címke
      p.bindTooltip(String(c.city_name || c.name), {
        permanent: true, direction: "right", offset: [8, 0], className: "city-label"
      }).openTooltip();
    });

    // infó badge
    if (!cities.length) {
      infoBadge.textContent = "Ebben a megyében még nincs megjelölt város.";
    } else {
      infoBadge.textContent = `Megjelölt városok: ${cities.length}`;
    }
    backBtn.classList.remove("hidden");
    infoBadge.classList.remove("hidden");
  }
  // <<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<

  // ===== betöltés + rétegépítés
  (async () => {
    [geo, loc] = await Promise.all([
      fetchFirstOk(tryUrls("hungary-counties.json")),
      fetchFirstOk(tryUrls("locations.json"))
    ]);

    // kulcsok és megjelenített név tára
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

    // mely megyék vannak az adatban
    const arr = Array.isArray(loc?.counties) ? loc.counties : (Array.isArray(loc) ? loc : []);
    arr.forEach(c => {
      const k = keyOf(c.county_name || c.megye || c.name || "");
      if (k) highlighted.add(k);
    });

    const baseStyle = { fillColor: "#e5e7eb", fillOpacity: 0.0, color: "#cbd5e1", weight: 1, opacity: 1, className: "county-outline" };
    const hotStyle  = { fillColor: "#16a34a", fillOpacity: 0.6, color: "#15803d", weight: 2, opacity: 1, className: "county-outline" };

    countyLayer = L.geoJSON(geo, {
      style: f => highlighted.has(f.__key) ? hotStyle : baseStyle,
      onEachFeature: (feature, layer) => {
        // elmentjük a kulcsot a layerre
        layer.feature.__key = feature.__key;
        // felirat az ország nézetben
        layer.bindTooltip(feature.__display, { permanent: true, direction: "center", className: "county-label" }).openTooltip();

        // katt: belépés megye-nézetbe (ÚJ zoom logikával)
        layer.on("click", () => showCounty(feature.__key));

        // kis hover effekt csak a „zöld” megyékre
        layer.on("mouseover", () => highlighted.has(feature.__key) && layer.setStyle({ fillColor: "#15803d" }));
        layer.on("mouseout",  () => highlighted.has(feature.__key) && layer.setStyle({ fillColor: "#16a34a" }));
      }
    }).addTo(map);

    // UI init és induló nézet
    ensureUi();
    showOverview();
  })().catch(e => {
    console.error("Térkép betöltési hiba:", e);
    mapEl.innerHTML = '<p class="text-center text-white">Hiba történt a térkép betöltésekor.</p>';
  });
})();
