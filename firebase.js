// firebase.js — Firestore + Auth init with robust persistence (mobile friendly)
import { initializeApp } from "https://www.gstatic.com/firebasejs/12.2.1/firebase-app.js";
import {
  initializeFirestore,
  memoryLocalCache,
  doc, getDoc, setDoc, updateDoc, onSnapshot,
  runTransaction, serverTimestamp
} from "https://www.gstatic.com/firebasejs/12.2.1/firebase-firestore.js";
import {
  getAuth,
  setPersistence,
  browserLocalPersistence,
  browserSessionPersistence,
  inMemoryPersistence,
  onAuthStateChanged,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  updateProfile,
  sendEmailVerification,
  signOut
} from "https://www.gstatic.com/firebasejs/12.2.1/firebase-auth.js";

const firebaseConfig = {
  apiKey: "AIzaSyDFXt7on07j1tjPejp8JBDL4ZtPzOEKqfo",
  authDomain: "jovnumbersgame.firebaseapp.com",
  projectId: "jovnumbersgame",
  storageBucket: "jovnumbersgame.firebasestorage.app",
  messagingSenderId: "856540089456",
  appId: "1:856540089456:web:180c1be24efb89a5bb38b5"
};

const app = initializeApp(firebaseConfig);

// --- Firestore: memory cache + long-polling (works behind strict proxies/mobile)
const db = initializeFirestore(app, {
  localCache: memoryLocalCache(),
  experimentalAutoDetectLongPolling: true,
  // (SDK will decide fetch streams support; leaving this flag off is fine)
});

// --- Auth: initialize and choose best persistence with safe fallbacks
const auth = getAuth(app);

// Run persistence setup without blocking module load.
// Pages can `await authReady` before calling sign-in/up if they want.
const authReady = (async () => {
  try {
    await setPersistence(auth, browserLocalPersistence); // keeps session after browser restart
  } catch {
    try {
      await setPersistence(auth, browserSessionPersistence); // until tab closed
    } catch {
      await setPersistence(auth, inMemoryPersistence); // private mode / no storage
    }
  }
})();

// ---- Exports (everything the app uses)
export {
  // readiness
  authReady,

  // auth
  auth,
  onAuthStateChanged,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  updateProfile,
  sendEmailVerification,
  signOut,

  // firestore
  db,
  doc, getDoc, setDoc, updateDoc, onSnapshot, runTransaction, serverTimestamp
};
