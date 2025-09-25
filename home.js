// home.js — Shows "Games • Wins • Losses" on the home screen in real time

import {
  auth, onAuthStateChanged,
  db, doc, onSnapshot
} from "./firebase.js";

const $ = (id) => document.getElementById(id);

// Expect these IDs on your home page:
const welcomeNameEl = $("welcomeName"); // e.g. <span id="welcomeName"></span>
const gamesEl       = $("statGames");   // e.g. <span id="statGames">0</span>
const winsEl        = $("statWins");    // e.g. <span id="statWins">0</span>
const lossesEl      = $("statLosses");  // e.g. <span id="statLosses">0</span>

function setCounts({games=0, wins=0, losses=0}){
  if(gamesEl)  gamesEl.textContent = String(games);
  if(winsEl)   winsEl.textContent  = String(wins);
  if(lossesEl) lossesEl.textContent= String(losses);
}

function setWelcome(name){
  if(welcomeNameEl) welcomeNameEl.textContent = name || "Player";
}

document.addEventListener("DOMContentLoaded", ()=>{
  // Default UI while loading
  setCounts({games:0, wins:0, losses:0});
  setWelcome("");

  onAuthStateChanged(auth, (u)=>{
    if(!u){
      // Not signed in -> send to login, keep return URL
      location.href = "login.html?next=" + encodeURIComponent(location.href);
      return;
    }
    setWelcome(u.displayName || (u.email ? u.email.split("@")[0] : "Player"));

    const uref = doc(db, "users", u.uid);

    // Live subscribe to your user document
    onSnapshot(uref, (snap)=>{
      if(!snap.exists()){
        // No doc yet -> show zeros
        setCounts({games:0, wins:0, losses:0});
        return;
      }
      const d = snap.data() || {};

      // Prefer fast counters written by finalizeResultsOnce()
      let games  = (typeof d.totalGames  === "number") ? d.totalGames  : null;
      let wins   = (typeof d.totalWins   === "number") ? d.totalWins   : null;
      let losses = (typeof d.totalLosses === "number") ? d.totalLosses : null;

      // If counters missing, derive from games[] history as a fallback
      if(games === null || wins === null || losses === null){
        const arr = Array.isArray(d.games) ? d.games : [];
        const w   = arr.filter(g => g && g.meWon === true).length;
        games  = (games  === null) ? arr.length : games;
        wins   = (wins   === null) ? w          : wins;
        losses = (losses === null) ? Math.max(0, games - wins) : losses;
      }

      setCounts({ games, wins, losses });
    }, (err)=>{
      console.error("Home counters subscribe error:", err);
      // Keep UI stable; you could show a toast here if you want
    });
  });
});
