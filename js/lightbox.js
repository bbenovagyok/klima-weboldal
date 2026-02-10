// js/lightbox.js
window.Lightbox = (function () {
  const lightbox = document.getElementById('lightbox');
  const imgEl = document.getElementById('lightbox-image');
  const closeBtn = document.getElementById('close-lightbox');

  const open = (src) => {
    imgEl.src = src;
    lightbox.classList.remove('hidden');
    lightbox.classList.add('flex'); // Ensure flex is added for centering
    document.documentElement.classList.add('no-scroll');
    document.body.classList.add('no-scroll');
  };

  const close = () => {
    lightbox.classList.add('hidden');
    lightbox.classList.remove('flex');
    document.documentElement.classList.remove('no-scroll');
    document.body.classList.remove('no-scroll');
    imgEl.src = '';
  };

  const wireUp = () => {
    // delegáció – minden .gallery-item kattintására nyíljon
    document.getElementById('gallery-container')?.addEventListener('click', (e) => {
      const card = e.target.closest('.gallery-item');
      if (!card) return;
      open(card.dataset.src);
    });
  };

  // ESC és X
  closeBtn?.addEventListener('click', close);
  lightbox?.addEventListener('click', (e) => { if (e.target === lightbox) close(); }); // Close on background click
  imgEl?.addEventListener('click', close); // Close on image click
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !lightbox.classList.contains('hidden')) close(); });

  // publik API
  return { open, close, wireUp };
})();
