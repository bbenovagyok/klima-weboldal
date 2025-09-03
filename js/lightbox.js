// js/lightbox.js
window.Lightbox = (function () {
  const lightbox   = document.getElementById('lightbox');
  const imgEl      = document.getElementById('lightbox-image');
  const titleEl    = document.getElementById('lightbox-title');
  const descEl     = document.getElementById('lightbox-description');
  const closeBtn   = document.getElementById('close-lightbox');

  const open = (src, title='', desc='') => {
    imgEl.src = src; titleEl.textContent = title; descEl.textContent = desc;
    lightbox.classList.remove('hidden');
    document.documentElement.classList.add('no-scroll');
    document.body.classList.add('no-scroll');
  };

  const close = () => {
    lightbox.classList.add('hidden');
    document.documentElement.classList.remove('no-scroll');
    document.body.classList.remove('no-scroll');
    imgEl.src = ''; titleEl.textContent=''; descEl.textContent='';
  };

  const wireUp = () => {
    // delegáció – minden .gallery-item kattintására nyíljon
    document.getElementById('gallery-container')?.addEventListener('click', (e) => {
      const card = e.target.closest('.gallery-item');
      if (!card) return;
      open(card.dataset.src, card.dataset.title, card.dataset.description);
    });
  };

  // ESC és X
  closeBtn?.addEventListener('click', close);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !lightbox.classList.contains('hidden')) close(); });

  // publik API
  return { open, close, wireUp };
})();
