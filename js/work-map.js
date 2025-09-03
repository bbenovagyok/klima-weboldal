// js/work-map.js
(function () {
  const init = async () => {
    const el = document.getElementById('work-map');
    if (!el) return;

    // biztos, ami biztos: zoom gombok elrejtése css-ből is
    const style = document.createElement('style');
    style.textContent = `.leaflet-control-zoom{display:none!important}`;
    document.head.appendChild(style);

    const map = L.map('work-map', {
      zoomControl: false,
      dragging: false,
      scrollWheelZoom: false,
      doubleClickZoom: false,
      touchZoom: false,
      boxZoom: false,
      keyboard: false,
      attributionControl: false
    });

    // Csempék (felirat nélküli)
    L.tileLayer('https://{s}.basemaps.cartocdn.com/light_nolabels/{z}/{x}/{y}{r}.png', {
      maxZoom: 18
    }).addTo(map);

    // adatok
    const fetchJSON = (p) => fetch(p, {cache: 'no-store'}).then(r => r.json());
    let geojson, locs;
    try {
      [geojson, locs] = await Promise.all([
        fetchJSON('data/hungary-counties.json'),
        fetchJSON('data/locations.json')
      ]);
    } catch (e) {
      console.error('Adat betöltési hiba', e);
      el.innerHTML = '<p class="text-center text-white p-4">Hiba történt a térkép adatok betöltésekor.</p>';
      return;
    }

    // normalizált megye nevek
    const strip = s => String(s||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'');
    const keyOf = s => strip(s).replace(/\bmegye\b/gi,'').replace(/\s+/g,' ').trim().toLowerCase();
    const getName = f => {
      const p=f.properties||{};
      const raw = p.name || p.NAME || p.NAME_1 || p.megye || p.megye_nev || p.megyeNev ||
                  p.county || p.COUNTY || p.NEV || p.nev || '';
      return { display:String(raw).trim(), key:keyOf(raw) };
    };

    // completed megyék + városszám
    const hot = new Set();
    const countBy = {};
    (locs?.counties || []).forEach(c => {
      const k = keyOf(c.county_name || c.name || '');
      if (!k) return;
      hot.add(k);
      countBy[k] = (c.cities || []).filter(x => x.completed).length;
    });

    const baseStyle = { fillColor:'#e5e7eb', fillOpacity:0.0, color:'#cbd5e1', weight:1, opacity:1, className:'county-outline' };
    const hotStyle  = { fillColor:'#16a34a', fillOpacity:0.6, color:'#15803d', weight:2, opacity:1, className:'county-outline' };

    const layer = L.geoJSON(geojson, {
      style: f => hot.has(getName(f).key) ? hotStyle : baseStyle,
      onEachFeature: (feature, lyr) => {
        const { display, key } = getName(feature);
        const isHot = hot.has(key);
        const cnt = countBy[key] || 0;

        // címke
        lyr.bindTooltip(display, { permanent:true, direction:'center', className:'county-label' }).openTooltip();

        // hover kiemelés csak zöldekre
        lyr.on('mouseover', () => isHot && lyr.setStyle({ fillColor:'#15803d' }));
        lyr.on('mouseout',  () => isHot && lyr.setStyle({ fillColor:'#16a34a' }));

        // katt: nagyítás + popup info (amíg nincs koordináta a városokhoz)
        lyr.on('click', () => {
          const b = lyr.getBounds();
          map.fitBounds(b.pad(0.1));
          const html = isHot
            ? `<b>${display}</b><br/>Jelölt városok száma: <b>${cnt}</b>`
            : `<b>${display}</b><br/>Még nincs jelölt munka.`;
          L.popup({closeButton:true, autoClose:true}).setLatLng(b.getCenter()).setContent(html).openOn(map);
        });
      }
    }).addTo(map);

    // első nézet
    const b = layer.getBounds();
    map.fitBounds(b, { padding:[2,2] });

    // fordíthatatlan zoom – teljesen statikus
    const z = map.getZoom();
    map.setMinZoom(z);
    map.setMaxZoom(z);
    map.setMaxBounds(b.pad(0.005));
  };

  document.addEventListener('DOMContentLoaded', init);
})();
