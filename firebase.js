// firebase.js — robust Firestore init for locked-down browsers
import { initializeApp } from "https://www.gstatic.com/firebasejs/12.2.1/firebase-app.js";
import {
  initializeFirestore,
  memoryLocalCache,
  doc, getDoc, setDoc, updateDoc, onSnapshot,
  runTransaction, serverTimestamp
} from "https://www.gstatic.com/firebasejs/12.2.1/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyDFXt7on07j1tjPejp8JBDL4ZtPzOEKqfo",
  authDomain: "jovnumbersgame.firebaseapp.com",
  projectId: "jovnumbersgame",
  storageBucket: "jovnumbersgame.firebasestorage.app",
  messagingSenderId: "856540089456",
  appId: "1:856540089456:web:180c1be24efb89a5bb38b5"
};

const app = initializeApp(firebaseConfig);

// Force a memory cache (no IndexedDB) and enable long-polling so it works behind proxies/strict modes.
const db = initializeFirestore(app, {
  localCache: memoryLocalCache(),
  experimentalAutoDetectLongPolling: true,
  useFetchStreams: false
});

export {
  db,
  doc, getDoc, setDoc, updateDoc, onSnapshot,
  runTransaction, serverTimestamp
};
