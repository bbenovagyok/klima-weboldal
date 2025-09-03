// Lightbox – globális open/close + galéria kattintás delegálás
(() => {
  const lb   = document.getElementById('lightbox');
  if (!lb) return;
  const img  = document.getElementById('lightbox-image');
  const ttl  = document.getElementById('lightbox-title');
  const desc = document.getElementById('lightbox-description');
  const btn  = document.getElementById('close-lightbox');

  function open(src, t = '', d = ''){
    img.src = src; ttl.textContent = t; desc.textContent = d;
    lb.classList.remove('hidden');
    document.documentElement.classList.add('no-scroll');
    document.body.classList.add('no-scroll');
  }
  function close(){
    lb.classList.add('hidden');
    document.documentElement.classList.remove('no-scroll');
    document.body.classList.remove('no-scroll');
  }

  btn?.addEventListener('click', close);
  lb.addEventListener('click', (e) => { if (e.target === lb) close(); });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !lb.classList.contains('hidden')) close();
  });

  // Galéria: bármely .gallery-item kattintás nyitja
  const gallery = document.getElementById('gallery-container');
  gallery?.addEventListener('click', (e) => {
    const item = e.target.closest('.gallery-item');
    if (!item) return;
    open(item.dataset.src, item.dataset.title || '', item.dataset.description || '');
  });

  // Globális, ha máshonnan hívnád
  window.openLightbox  = open;
  window.closeLightbox = close;
})();
