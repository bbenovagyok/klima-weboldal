// js/work-map.js
(() => {
  const mapEl = document.getElementById('work-map');
  if (!mapEl) return;

  // --- util ---
  const stripDiacritics = s => String(s||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'');
  const clean = s => stripDiacritics(s).replace(/\bmegye\b/gi,'').replace(/\s+/g,' ').trim().toLowerCase();
  const escapeHtml = s => String(s).replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
  const num = v => (v===null||v===undefined) ? NaN : Number(v);
  const isMobile = window.matchMedia('(max-width: 640px)').matches;

  // Kis fallback koordináta-szótár (bővíthető)
  const CITY_FALLBACKS = {
    "siófok":       { lat: 46.909, lng: 18.1046 },
    "veszprém":     { lat: 47.093, lng: 17.911  },
    "balatonfüred": { lat: 46.961, lng: 17.871  }
  };

  const tryUrls = (file) => [ `data/${file}`, `/data/${file}`, new URL(`data/${file}`, document.baseURI).href ];
  const parseJsonSafe = (txt) => { const noBom = txt.charCodeAt(0)===0xFEFF ? txt.slice(1) : txt; return JSON.parse(noBom); };
  const fetchFirstOk = async (cands) => {
    let lastErr; for (const u of cands) {
      try { const r = await fetch(u, { cache:'no-store' }); if(!r.ok) throw new Error(`HTTP ${r.status}`); return parseJsonSafe(await r.text()); }
      catch(e){ lastErr=e; }
    }
    throw lastErr || new Error('Betöltési hiba');
  };

  // --- map ---
  const map = L.map('work-map', {
    zoomControl: true,
    attributionControl: false,
    minZoom: 6,
    maxZoom: 16
  });

  L.tileLayer('https://{s}.basemaps.cartocdn.com/light_nolabels/{z}/{x}/{y}{r}.png', {
    attribution: '&copy; OpenStreetMap & CARTO'
  }).addTo(map);

  // info panel
  const info = L.control({position:'topright'});
  info.onAdd = function(){
    this._div = L.DomUtil.create('div','county-info');
    this.update();
    return this._div;
  };
  info.update = (html='') => { this._div.innerHTML = html; };
  info.addTo(map);

  // vissza gomb
  const BackCtrl = L.Control.extend({
    options: { position: 'topleft' },
    onAdd: function() {
      const c = L.DomUtil.create('div','leaflet-bar leaflet-control');
      const a = L.DomUtil.create('a','reset-btn', c);
      a.href = '#'; a.title = 'Vissza Magyarországra'; a.textContent = '⟵ Vissza';
      L.DomEvent.on(a,'click', (e)=>{ e.preventDefault(); resetToCountry(); });
      return c;
    }
  });
  const backCtrl = new BackCtrl();

  // város réteg
  const citiesLayer = L.featureGroup().addTo(map);
  const makeCityIcon = (name='') => L.divIcon({
    className: 'city-marker',
    html: `<span class="city-dot"></span><span class="city-name">${escapeHtml(name)}</span>`,
    iconSize: null,
    iconAnchor: [0, 10]
  });

  // adatok
  Promise.all([
    fetchFirstOk(tryUrls('hungary-counties.json')),
    fetchFirstOk(tryUrls('locations.json'))
  ]).then(([geojson, locRaw])=>{
    if (!geojson?.features?.length) throw new Error('Hibás counties GeoJSON');

    const getCountyNameRaw = (f) => {
      const p=f?.properties||{};
      return p.name || p.NAME || p.NAME_1 || p.megye || p.megye_nev || p.megyeNev ||
             p.county || p.County || p.COUNTY || p.MEGYE || p.NEV || p.Név || p.nev ||
             p.NUTS_NAME || p.NUTS_NAME_HU || p.TER_NEV || p.TERNEV || p.megye_name || '';
    };
    const getCountyName = f => { const raw=getCountyNameRaw(f); return { display:String(raw).trim(), key:clean(raw) }; };

    // normalize locations
    let countyRows = Array.isArray(locRaw?.counties) ? locRaw.counties : Array.isArray(locRaw) ? locRaw : [];
    countyRows = countyRows.map(r => ({ ...r, _key: clean(r.county_name || r.name || r.megye || r.megye_nev || '') }));

    const highlightedKeys = new Set(
      countyRows.filter(r => r.completed === true || r.completed === 'true' || (Array.isArray(r.cities) && r.cities.some(c=>c.completed===true||c.completed==='true')))
                .map(r => r._key)
    );

    const baseStyle = { fillColor:'#e5e7eb', fillOpacity:0,   color:'#cbd5e1', weight:1, opacity:1, className:'county-outline' };
    const hotStyle  = { fillColor:'#16a34a', fillOpacity:0.55,color:'#15803d', weight:2, opacity:1, className:'county-outline' };
    const hotHover  = { fillColor:'#15803d' };

    let layerBounds = null;

    const countiesLayer = L.geoJSON(geojson, {
      style: f => highlightedKeys.has(getCountyName(f).key) ? hotStyle : baseStyle,
      onEachFeature: (feature, lyr) => {
        const { display, key } = getCountyName(feature);
        const isHot = highlightedKeys.has(key);

        if (!isMobile || isHot) {
          lyr.bindTooltip(display, { permanent:true, direction:'center', className:'county-label' }).openTooltip();
        }
        lyr.on('mouseover', () => isHot ? lyr.setStyle(hotHover) : null);
        lyr.on('mouseout',  () => isHot ? lyr.setStyle(hotStyle) : null);
        lyr.on('click',     () => showCounty(key, display, lyr.getBounds()));
      }
    }).addTo(map);

    layerBounds = countiesLayer.getBounds();
    map.fitBounds(layerBounds, { padding:[4,4] });
    if (isMobile) map.setView(layerBounds.getCenter(), map.getZoom() + 0.4);

    function showCounty(key, displayName, bounds){
      citiesLayer.clearLayers();

      const row = countyRows.find(r => r._key === key);
      const rawCities = Array.isArray(row?.cities) ? row.cities : [];
      const cities = rawCities.filter(c => c && (c.completed === true || c.completed === 'true'));

      // ha nincs koordináta: próbáld a szótárból, különben a megye közepe köré szórjuk
      const base = bounds.getCenter();
      const n = Math.max(1, cities.length);

      cities.forEach((c, i) => {
        const name = (c.name || c.city_name || c.varos || '').toString().trim();
        const keyName = clean(name);
        let lat = num(c.lat ?? c.latitude);
        let lng = num(c.lng ?? c.lon ?? c.longitude);

        if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
          const fb = CITY_FALLBACKS[keyName];
          if (fb) { lat = fb.lat; lng = fb.lng; }
        }
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
          const angle = (i / n) * 2 * Math.PI;
          const r = 0.06 + (i % 3) * 0.01; // ~pár km szórás
          lat = base.lat + r * Math.cos(angle);
          lng = base.lng + r * Math.sin(angle);
          console.warn(`Koordináta hiányzik: "${name}" – ideiglenesen megye-közép közelébe rakva.`);
        }

        L.marker([lat,lng], { icon: makeCityIcon(name) })
          .addTo(citiesLayer)
          .bindPopup(`<b>${escapeHtml(name)}</b><br>${escapeHtml(displayName)} megye`);
      });

      let b = bounds;
      const pts = citiesLayer.getLayers().map(m => m.getLatLng());
      if (pts.length) b = L.latLngBounds(pts).extend(bounds);

      map.fitBounds(b, { padding: isMobile ? [20,20] : [30,30], maxZoom: isMobile ? 11.5 : 12.5 });

      if (!map.hasLayer(backCtrl)) backCtrl.addTo(map);
      info.update(`<div class="row"><strong>${escapeHtml(displayName)}</strong><br>Városok száma: <strong>${cities.length}</strong></div>`);
    }

    function resetToCountry(){
      citiesLayer.clearLayers();
      map.fitBounds(layerBounds, { padding:[4,4] });
      try { map.removeControl(backCtrl); } catch {}
      info.update('');
    }

    window.__resetWorkMapToCountry = resetToCountry;
  }).catch(err=>{
    console.error(err);
    mapEl.innerHTML = '<p class="text-center text-white">Hiba történt a térkép betöltésekor.</p>';
  });
})();
