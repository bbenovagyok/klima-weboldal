(() => {
  const wall = document.getElementById('testimonials-grid');
  const bg   = document.getElementById('testimonials-bg');
  if (!wall || !bg) return;

  const esc = s => String(s ?? '').replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[m]));

  const card = r => `
    <article class="t-card">
      <div class="who">${esc(r.name)} <span class="city">• ${esc(r.city)}</span></div>
      <p class="text">“${esc(r.text)}”</p>
    </article>
  `;

  function mountBackground(reviews){
    if (!reviews?.length) return;
    const laneHTML = reviews.map(r => `<div class="ghost-pill">“${esc(r.text)}” — ${esc(r.name)}, ${esc(r.city)}</div>`).join('');
    bg.innerHTML = `
      <div class="ghost-lane">${laneHTML + laneHTML}</div>
      <div class="ghost-lane delay">${laneHTML + laneHTML}</div>
    `;
  }

  function animateCards(){
    const io = new IntersectionObserver((entries)=>{
      entries.forEach(e => { if (e.isIntersecting){ e.target.classList.add('show'); io.unobserve(e.target); } });
    }, { threshold:.2 });
    wall.querySelectorAll('.t-card').forEach(el => io.observe(el));
  }

  // Ezt hívjuk az indexből, amikor megjöttek a review-k
  window.renderTestimonials = (reviews) => {
    if (!Array.isArray(reviews) || !reviews.length) return;
    // max 6 friss véleményt tegyünk kártyába
    wall.innerHTML = reviews.slice(0, 6).map(card).join('');
    animateCards();
    mountBackground(reviews);
  };
})();
