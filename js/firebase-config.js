// Minden Firebase import + inicializálás egy helyen.
// Ezt a modult használja a reviews-firebase.js.

import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

// ---- A SAJÁT KONFIGOD ----
const firebaseConfig = {
  apiKey: "AIzaSyB0yin_VnilXLpth-qzNsJqpIwyalirI6M",
  authDomain: "klima-weboldal.firebaseapp.com",
  projectId: "klima-weboldal",
  storageBucket: "klima-weboldal.appspot.com",
  messagingSenderId: "31440003199",
  appId: "1:31440003199:web:13ec2fcd1601861eec5f4a"
};

// ---- Inicializálás ----
export const app  = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db   = getFirestore(app);

// A reviews modulnak ezekre a függvényekre is szüksége lesz:
export { signInAnonymously, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
export { collection, addDoc, getDocs, Timestamp, query, orderBy } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";
