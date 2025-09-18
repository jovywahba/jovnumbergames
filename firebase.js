import { initializeApp } from "https://www.gstatic.com/firebasejs/12.2.1/firebase-app.js";
import {
  getFirestore,
  doc, getDoc, setDoc, updateDoc, onSnapshot,
  serverTimestamp, runTransaction
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
const db = getFirestore(app);

export {
  db, doc, getDoc, setDoc, updateDoc, onSnapshot, serverTimestamp, runTransaction
};
