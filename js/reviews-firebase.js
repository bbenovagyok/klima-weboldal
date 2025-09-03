// A vélemény sáv és a vélemény-űrlap logikája.
// A Firebase init + importok a firebase-config.js-ben vannak.

import {
  app, db, auth,
  signInAnonymously, onAuthStateChanged,
  collection, addDoc, getDocs, Timestamp, query, orderBy
} from './firebase-config.js';

// DOM elemek
const reviewForm = document.getElementById('reviewForm');
const reviewsContainer = document.getElementById('reviews-container'); // felső vízszintes sáv

// ---- HTML-generátorok ----
const buildReview = (text, name, city) => `
  <div class="review-card">
    <span class="inline-flex items-center justify-center w-6 h-6 rounded-full bg-white/20">
      <i class="fa-solid fa-quote-left text-xs"></i>
    </span>
    <span class="font-bold tracking-tight">"${text}"</span>
    <span class="opacity-90 font-semibold">– ${name}, ${city}</span>
  </div>
`;

const buildReviewBgCard = (r) => `
  <div class="review-bg-card">
    <p>"${r.text}"</p>
    <div class="meta">– ${r.name}, ${r.city}</div>
  </div>
`;

// ---- Vertikális háttéroszlopok renderelése ----
function renderVerticalBgColumns(list){
  const data = list && list.length ? list : [];
  const cols = [[],[],[]];
  data.forEach((r,i)=> cols[i%3].push(r));

  ['rev-col-1','rev-col-2','rev-col-3'].forEach((id, idx) => {
    const el = document.getElementById(id);
    if (!el) return;
    const cards = (cols[idx].length ? cols[idx] : [{text:'Gyors, tiszta, profi munka!',name:'Mintapélda',city:'Siófok'}])
      .map(buildReviewBgCard).join('');
    const set = `<div class="reviews-set">${cards}</div>`;
    const dur = 20 + idx*4; // oszloponként eltérő sebesség
    el.innerHTML = `<div class="reviews-track" style="--dur:${dur}s">${set}${set}</div>`;
  });
}

const escapeHtml = s => String(s).replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));

// ---- Alapértelmezett vélemények (ha nincs adat) ----
const defaults = [
  {name:"Nagy Család",city:"Siófok",text:"Gyorsak, profik és nagyon tisztán dolgoztak. Végre hűvös van a nappaliban!"},
  {name:"Kiss Péter",city:"Székesfehérvár",text:"Minden a megbeszéltek szerint történt, a klíma tökéletesen működik. Csak ajánlani tudom!"},
  {name:"Horváth Éva",city:"Veszprém",text:"A régi, zajos klímánkat cserélték le egy újra. Hatalmas a különbség, köszönjük!"}
];

function loadDefault(){
  const lane = defaults.map(r => buildReview(escapeHtml(r.text), escapeHtml(r.name), escapeHtml(r.city))).join('');
  if (reviewsContainer) reviewsContainer.innerHTML = lane + lane;
  renderVerticalBgColumns(defaults);
}

// ---- Firebase-ből töltés ----
async function loadReviews(){
  if (!db) { loadDefault(); return; }
  try{
    const snap = await getDocs(query(collection(db,'reviews'),orderBy('createdAt','desc')));
    if (snap.empty){ loadDefault(); return; }
    const arr = [];
    let lane = '';
    snap.forEach(doc=>{
      const r=doc.data();
      const safe={ text:escapeHtml(r.text), name:escapeHtml(r.name), city:escapeHtml(r.city) };
      arr.push(safe);
      lane += buildReview(safe.text, safe.name, safe.city);
    });
    if (reviewsContainer) reviewsContainer.innerHTML = lane + lane;
    renderVerticalBgColumns(arr);
  }catch(e){
    console.warn('Review load failed, using defaults', e);
    loadDefault();
  }
}

// ---- Auth + indítás ----
if (auth){
  onAuthStateChanged(auth,(user)=>{
    if(user) loadReviews();
    else signInAnonymously(auth).then(loadReviews).catch(loadDefault);
  });
}else{
  loadDefault();
}

// ---- Submit űrlap ----
reviewForm?.addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!db) { alert("A véleményküldés funkció jelenleg nem elérhető."); return; }
  const btn = document.getElementById('submitReviewBtn');
  btn.disabled = true; btn.textContent = 'Küldés...';

  const name = document.getElementById('reviewerName')?.value?.trim();
  const city = document.getElementById('reviewerCity')?.value?.trim();
  const text = document.getElementById('reviewText')?.value?.trim();
  if (!name || !text || !city) {
    alert('Töltsön ki minden mezőt!');
    btn.disabled=false; btn.textContent='Vélemény elküldése';
    return;
  }

  try {
    await addDoc(collection(db, 'reviews'), { name, city, text, createdAt: Timestamp.now() });
    reviewForm.reset();
    alert('Köszönjük a véleményét!');
    await loadReviews();
  } catch (err) {
    console.error('Hiba a mentéskor:', err);
    alert('Hiba történt a vélemény mentése során.');
  } finally {
    btn.disabled=false; btn.textContent='Vélemény elküldése';
  }
});
