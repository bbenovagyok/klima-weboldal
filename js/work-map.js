// js/work-map.js
(() => {
  const mapEl = document.getElementById('work-map');
  if (!mapEl) return;

  // ----- hasznosak -----
  const stripDiacritics = s => String(s||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'');
  const clean = s => stripDiacritics(s).replace(/\bmegye\b/gi,'').replace(/\s+/g,' ').trim().toLowerCase();
  const escapeHtml = s => String(s).replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
  const isMobile = window.matchMedia('(max-width: 640px)').matches;

  const tryUrls = (file) => [ `data/${file}`, `/data/${file}`, new URL(`data/${file}`, document.baseURI).href ];
  const parseJsonSafe = (txt) => { const noBom = txt.charCodeAt(0)===0xFEFF ? txt.slice(1) : txt; return JSON.parse(noBom); };
  const fetchFirstOk = async (cands) => {
    let lastErr; for (const u of cands) {
      try { const r = await fetch(u, { cache:'no-store' }); if(!r.ok) throw new Error(`HTTP ${r.status}`); return parseJsonSafe(await r.text()); }
      catch(e){ lastErr=e; }
    }
    throw lastErr || new Error('Betöltési hiba');
  };

  // ----- Leaflet térkép -----
  const map = L.map('work-map', {
    zoomControl: true,
    attributionControl: false,
    minZoom: 6,
    maxZoom: 16
  });

  L.tileLayer('https://{s}.basemaps.cartocdn.com/light_nolabels/{z}/{x}/{y}{r}.png', {
    attribution: '&copy; OpenStreetMap & CARTO'
  }).addTo(map);

  // infó panel
  const info = L.control({position:'topright'});
  info.onAdd = function(){
    this._div = L.DomUtil.create('div','county-info');
    this.update();
    return this._div;
  };
  info.update = function(html=''){ this._div.innerHTML = html; };
  info.addTo(map);

  // "Vissza" gomb
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

  // Város jelölők
  const citiesLayer = L.featureGroup().addTo(map);
  const makeCityIcon = (name='') => L.divIcon({
    className: 'city-marker',
    html: `<span class="city-dot"></span><span class="city-name">${escapeHtml(name)}</span>`,
    iconSize: null,
    iconAnchor: [0, 10]     // bal szél, kb. középmagasság
  });

  // adatok betöltése
  Promise.all([
    fetchFirstOk(tryUrls('hungary-counties.json')),
    fetchFirstOk(tryUrls('locations.json'))
  ]).then(([geojson, locRaw])=>{
    if (!geojson?.features?.length) throw new Error('Hibás counties GeoJSON');

    // county név -> display + key
    const getCountyNameRaw = (f) => {
      const p=f?.properties||{};
      return p.name || p.NAME || p.NAME_1 || p.megye || p.megye_nev || p.megyeNev ||
             p.county || p.County || p.COUNTY || p.MEGYE || p.NEV || p.Név || p.nev ||
             p.NUTS_NAME || p.NUTS_NAME_HU || p.TER_NEV || p.TERNEV || p.megye_name || '';
    };
    const getCountyName = f => { const raw=getCountyNameRaw(f); return { display:String(raw).trim(), key:clean(raw) }; };

    // locations normalizálás
    let countyRows = Array.isArray(locRaw?.counties) ? locRaw.counties : Array.isArray(locRaw) ? locRaw : [];
    countyRows = countyRows.map(r => ({ ...r, _key: clean(r.county_name || r.name || r.megye || r.megye_nev || '') }));

    // mely megyék „zöldek”
    const highlightedKeys = new Set(countyRows.map(r => r._key).filter(Boolean));

    // styles
    const baseStyle = { fillColor:'#e5e7eb', fillOpacity:0,   color:'#cbd5e1', weight:1, opacity:1, className:'county-outline' };
    const hotStyle  = { fillColor:'#16a34a', fillOpacity:0.55,color:'#15803d', weight:2, opacity:1, className:'county-outline' };
    const hotHover  = { fillColor:'#15803d' };

    let currentKey = null;
    let layerBounds = null;

    const countiesLayer = L.geoJSON(geojson, {
      style: f => highlightedKeys.has(getCountyName(f).key) ? hotStyle : baseStyle,
      onEachFeature: (feature, lyr) => {
        const { display, key } = getCountyName(feature);
        const isHot = highlightedKeys.has(key);

        // ország-nézet címkék: mobilon csak a zöldek
        if (!isMobile || isHot) {
          lyr.bindTooltip(display, { permanent:true, direction:'center', className:'county-label' }).openTooltip();
        }

        // vizuális hover a zöldeken
        lyr.on('mouseover', () => isHot ? lyr.setStyle(hotHover) : null);
        lyr.on('mouseout',  () => isHot ? lyr.setStyle(hotStyle) : null);

        // kattintás – megyenézet
        lyr.on('click', () => showCounty(key, display, lyr.getBounds()));
      }
    }).addTo(map);

    layerBounds = countiesLayer.getBounds();
    map.fitBounds(layerBounds, { padding:[4,4] });

    if (isMobile) map.setView(layerBounds.getCenter(), map.getZoom() + 0.4);

    // -------- megye nézet --------
    function showCounty(key, displayName, bounds){
      currentKey = key;
      citiesLayer.clearLayers();

      // kiválasztott megye városai
      const row = countyRows.find(r => r._key === key);
      const cities = (row?.cities || []).filter(c => c && (c.completed === true || c.completed === 'true'));

      // jelölők
      const markerBounds = [];
      cities.forEach(c => {
        const lat = Number(c.lat ?? c.latitude), lng = Number(c.lng ?? c.lon ?? c.longitude);
        if (Number.isFinite(lat) && Number.isFinite(lng)) {
          L.marker([lat,lng], { icon: makeCityIcon(c.name || c.varos || '') })
            .addTo(citiesLayer)
            .bindPopup(`<b>${escapeHtml(c.name || c.varos || '')}</b><br>${escapeHtml(displayName)} megye`);
          markerBounds.push([lat,lng]);
        }
      });

      // nézet: a megye + esetleg a jelölők
      let b = bounds;
      if (markerBounds.length){
        const mb = L.latLngBounds(markerBounds);
        b = mb.extend(bounds); // biztosan minden beférjen
      }
      map.fitBounds(b, { padding: isMobile ? [20,20] : [30,30], maxZoom: isMobile ? 11.5 : 12.5 });

      // vezérlők
      if (!map.hasLayer(backCtrl)) backCtrl.addTo(map);
      info.update(`<div class="row"><strong>${escapeHtml(displayName)}</strong><br>Városok száma: <strong>${cities.length}</strong></div>`);
    }

    // -------- vissza ország nézetre --------
    function resetToCountry(){
      currentKey = null;
      citiesLayer.clearLayers();
      map.fitBounds(layerBounds, { padding:[4,4] });
      if (isMobile) map.setView(layerBounds.getCenter(), map.getZoom()); // maradhat közelebb kicsit
      try { map.removeControl(backCtrl); } catch {}
      info.update('');
    }

    // „külső” elérés a resethez (ha később kell)
    window.__resetWorkMapToCountry = resetToCountry;
  }).catch(err=>{
    console.error(err);
    mapEl.innerHTML = '<p class="text-center text-white">Hiba történt a térkép betöltésekor.</p>';
  });
})();
