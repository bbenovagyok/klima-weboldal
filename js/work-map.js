// Leaflet térkép – HU fókusz, mobil declutter, „Városok száma”
document.addEventListener('DOMContentLoaded', async () => {
  const mapEl = document.getElementById('work-map');
  if (!mapEl || !window.L) return;

  const isMobile = window.matchMedia('(max-width: 640px)').matches;
  const HU_BOUNDS_TMP = L.latLngBounds([45.6, 16.0], [48.7, 22.95]);

  const map = L.map('work-map', {
    zoomControl:false, dragging:false, scrollWheelZoom:false, doubleClickZoom:false,
    touchZoom:false, boxZoom:false, keyboard:false, attributionControl:false,
    zoomSnap:0, zoomDelta:0.1
  });

  L.tileLayer('https://{s}.basemaps.cartocdn.com/light_nolabels/{z}/{x}/{y}{r}.png', {
    attribution:'&copy; OpenStreetMap & CARTO'
  }).addTo(map);

  map.fitBounds(HU_BOUNDS_TMP, { padding:[0,0] });

  // --- betöltő segédek ---
  const tryUrls = f => [`data/${f}`, `/data/${f}`, new URL(`data/${f}`, document.baseURI).href];
  const parseJsonSafe = t => (t.charCodeAt(0)===0xFEFF ? JSON.parse(t.slice(1)) : JSON.parse(t));
  const fetchFirstOk = async (cands) => {
    let last; for (const u of cands) {
      try { const r=await fetch(u,{cache:'no-store'}); if(!r.ok) throw 0; return parseJsonSafe(await r.text()); }
      catch(e){ last=e; }
    } throw last || new Error('load error');
  };

  // --- adatok ---
  let geojson, loc;
  try {
    [geojson, loc] = await Promise.all([
      fetchFirstOk(tryUrls('hungary-counties.json')),
      fetchFirstOk(tryUrls('locations.json'))
    ]);
  } catch (e) {
    console.error('Térkép betöltési hiba:', e);
    mapEl.innerHTML = '<p class="text-center text-white">Hiba a térkép betöltésekor.</p>';
    return;
  }
  if (!geojson?.features) return;

  // --- név normalizálás ---
  const strip = s => String(s||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'');
  const clean = s => strip(s).replace(/\bmegye\b/gi,'').replace(/\s+/g,' ').trim().toLowerCase();
  const getRawName = f => {
    const p=f?.properties||{};
    return p.name||p.NAME||p.NAME_1||p.megye||p.megye_nev||p.megyeNev||
           p.county||p.CountY||p.COUNTY||p.MEGYE||p.NEV||p.Név||p.nev||
           p.NUTS_NAME||p.NUTS_NAME_HU||p.TER_NEV||p.TERNEV||p.megye_name||'';
  };
  const getNames = f => { const raw=getRawName(f); return {display:String(raw).trim(), key:clean(raw)}; };

  // --- jelölések és számlálók ---
  const hot = new Set();
  const byKeyDisplay = new Map();
  const cityCount = {};
  geojson.features.forEach(f => { const {display,key}=getNames(f); if(key) byKeyDisplay.set(key,display); });

  const ensure = k => { if(!(k in cityCount)) cityCount[k]=0; };
  if (Array.isArray(loc?.counties)) {
    loc.counties.forEach(co => {
      const k = clean(co.county_name||co.name||co.megye||co.megye_nev||''); if(!k) return;
      hot.add(k); ensure(k); (co.cities||[]).forEach(c=>{ if(c?.completed) cityCount[k]++; });
    });
  } else if (Array.isArray(loc)) {
    loc.forEach(row=>{
      const k = clean(row.county_name||row.county||row.megye||''); if(!k) return;
      hot.add(k); ensure(k);
      if (row?.cities?.length) row.cities.forEach(c=>{ if(c?.completed) cityCount[k]++; });
      else if (row?.completed) cityCount[k]++;
    });
  }

  const baseStyle = { fillColor:'#e5e7eb', fillOpacity:0.0, color:'#cbd5e1', weight:1, opacity:1, className:'county-outline' };
  const hotStyle  = { fillColor:'#16a34a', fillOpacity:0.6, color:'#15803d', weight:2, opacity:1, className:'county-outline' };

  const layer = L.geoJSON(geojson, {
    style:f => hot.has(getNames(f).key) ? hotStyle : baseStyle,
    onEachFeature:(feature, lyr)=>{
      const {key} = getNames(feature);
      const display = byKeyDisplay.get(key) || 'Ismeretlen megye';
      const isHot = hot.has(key);
      const count = cityCount[key] || 0;

      if (!isMobile || isHot) {
        lyr.bindTooltip(display, {permanent:true, direction:'center', className:'county-label'}).openTooltip();
      }
      lyr.on('mouseover', () => { if(isHot) lyr.setStyle({fillColor:'#15803d'}); });
      lyr.on('mouseout',  () => { if(isHot) lyr.setStyle({fillColor:'#16a34a'}); });

      lyr.on('click', () => {
        const b=lyr.getBounds();
        const msg = isHot
          ? `<b>${display}</b><br>Városok száma: <b>${count}</b>`
          : `<b>${display}</b><br>Még nincs jelölt munka.`;
        L.popup({closeButton:true,autoClose:true})
          .setLatLng(b.getCenter()).setContent(msg).openOn(map);
      });
    }
  }).addTo(map);

  const b = layer.getBounds();
  map.fitBounds(b,{padding:[2,2]});
  let z = map.getZoom();
  if (isMobile) { map.setView(b.getCenter(), z+0.4); z = map.getZoom(); }
  map.setMinZoom(z); map.setMaxZoom(z); map.setMaxBounds(b.pad(0.005));

  map.dragging.disable(); map.scrollWheelZoom.disable(); map.doubleClickZoom.disable();
  map.touchZoom.disable(); map.boxZoom.disable(); map.keyboard.disable(); if(map.tap) map.tap.disable();
});
