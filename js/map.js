/* js/map.js */
'use strict';

function addBaseTiles(map) {
  const carto = L.tileLayer(
    'https://{s}.basemaps.cartocdn.com/light_nolabels/{z}/{x}/{y}{r}.png',
    { attribution: '&copy; OpenStreetMap & CARTO', crossOrigin: true, keepBuffer: 8 }
  );
  const osm = L.tileLayer(
    'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
    { attribution: '&copy; OpenStreetMap', crossOrigin: true, keepBuffer: 8 }
  );

  let usingFallback = false;
  const switchToFallback = () => {
    if (usingFallback) return;
    usingFallback = true;
    try { map.removeLayer(carto); } catch {}
    osm.addTo(map);
    console.warn('[map] CARTO tile hiba – OSM-re váltottunk.');
  };

  carto.on('tileerror', switchToFallback);
  setTimeout(() => {
    const anyCartoTile = Array
      .from(document.querySelectorAll('#work-map .leaflet-tile'))
      .some(t => /basemaps\.cartocdn\.com/.test(t.src || ''));
    if (!anyCartoTile) switchToFallback();
  }, 2000);

  carto.addTo(map);
}

(function initWorkMap(){
  const mapEl = document.getElementById('work-map');
  if (!mapEl) return;

  const isMobile = matchMedia('(max-width: 640px)').matches;

  const map = L.map('work-map', {
    zoomControl: true,
    attributionControl: false,
    zoomSnap: 0,
    zoomDelta: 0.1
  });

  addBaseTiles(map);

  const HU_BOUNDS_TMP = L.latLngBounds([45.6, 16.0], [48.7, 22.95]);
  map.fitBounds(HU_BOUNDS_TMP, { padding: [0,0] });
  setTimeout(() => map.invalidateSize(), 60);

  const tryUrls = (file) => [ `data/${file}`, `/data/${file}`, new URL(`data/${file}`, document.baseURI).href ];
  const parseJsonSafe = (txt) => { const noBom = txt.charCodeAt(0)===0xFEFF ? txt.slice(1) : txt; return JSON.parse(noBom); };
  const fetchFirstOk = async (cands) => {
    let lastErr;
    for (const u of cands) {
      try {
        const r = await fetch(u, { cache:'no-store' });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return parseJsonSafe(await r.text());
      } catch(e){ lastErr = e; }
    }
    throw lastErr || new Error('Betöltési hiba');
  };

  Promise.all([
    fetchFirstOk(tryUrls('hungary-counties.json')),
    fetchFirstOk(tryUrls('locations.json'))
  ])
  .then(([geojson, loc]) => {
    if (!geojson?.type || !Array.isArray(geojson.features)) {
      throw new Error('Hibás GeoJSON (nincs features).');
    }

    const strip = s => String(s||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'');
    const clean = s => strip(s).replace(/\bmegye\b/gi,'').replace(/\s+/g,' ').trim().toLowerCase();
    const getCountyNameRaw = (f) => {
      const p = f?.properties || {};
      return p.name || p.NAME || p.NAME_1 || p.megye || p.megye_nev || p.megyeNev ||
             p.county || p.County || p.COUNTY || p.MEGYE || p.NEV || p.Név || p.nev ||
             p.NUTS_NAME || p.NUTS_NAME_HU || p.TER_NEV || p.TERNEV || p.megye_name || '';
    };
    const getCountyName = (f) => { const raw = getCountyNameRaw(f); return { display: String(raw).trim(), key: clean(raw) }; };

    const highlighted = new Set();
    const cityCountByKey = Object.create(null);
    const displayByKey = new Map();

    geojson.features.forEach(f => {
      const { display, key } = getCountyName(f);
      if (key) displayByKey.set(key, display);
    });

    const ensure = (k) => { if (!(k in cityCountByKey)) cityCountByKey[k] = 0; };

    if (Array.isArray(loc?.counties)) {
      loc.counties.forEach(co => {
        const key = clean(co.county_name || co.name || co.megye || co.megye_nev || '');
        if (!key) return;
        highlighted.add(key);
        ensure(key);
        (co.cities || []).forEach(c => { if (c?.completed) cityCountByKey[key] += 1; });
      });
    } else if (Array.isArray(loc)) {
      loc.forEach(row => {
        const key = clean(row.county_name || row.county || row.megye || '');
        if (!key) return;
        highlighted.add(key);
        ensure(key);
        if (row?.cities?.length) row.cities.forEach(c => { if (c?.completed) cityCountByKey[key] += 1; });
        else if (row?.completed) cityCountByKey[key] += 1;
      });
    }

    const baseStyle = { fillColor:'#e5e7eb', fillOpacity:0.0, color:'#cbd5e1', weight:1, opacity:1, className:'county-outline' };
    const hotStyle  = { fillColor:'#16a34a', fillOpacity:0.6, color:'#15803d', weight:2, opacity:1, className:'county-outline' };

    const countiesLayer = L.geoJSON(geojson, {
      style: f => highlighted.has(getCountyName(f).key) ? hotStyle : baseStyle,
      onEachFeature: (feature, lyr) => {
        const { key } = getCountyName(feature);
        const displayName = displayByKey.get(key) || 'Ismeretlen megye';
        const isHot = highlighted.has(key);
        const count = cityCountByKey[key] || 0;

        if (!isMobile || isHot) {
          lyr.bindTooltip(displayName, { permanent:true, direction:'center', className:'county-label' }).openTooltip();
        }

        if (isHot) {
          lyr.on('mouseover', () => lyr.setStyle({ fillColor:'#15803d' }));
          lyr.on('mouseout',  () => lyr.setStyle({ fillColor:'#16a34a' }));
        }

        lyr.on('click', () => {
          const b = lyr.getBounds();
          map.fitBounds(b.pad(0.05), { animate:true });
          const msg = isHot
            ? `<b>${displayName}</b><br>Városok száma: <b>${count}</b>`
            : `<b>${displayName}</b><br>Még nincs jelölt munka.`;
          L.popup({ closeButton:true, autoClose:true })
            .setLatLng(b.getCenter()).setContent(msg).openOn(map);
        });
      }
    }).addTo(map);

    const b = countiesLayer.getBounds();
    map.fitBounds(b, { padding:[2,2] });
    setTimeout(() => map.invalidateSize(), 60);

    let z = map.getZoom();
    if (isMobile) { map.setView(b.getCenter(), z + 0.4); z = map.getZoom(); }
    map.setMinZoom(z);
    map.setMaxZoom(z);
    map.setMaxBounds(b.pad(0.005));
  })
  .catch(err => {
    console.error('[map] hiba:', err);
    mapEl.innerHTML = '<p class="text-center text-white p-6">Hiba történt a térkép betöltésekor.</p>';
  });
})();
