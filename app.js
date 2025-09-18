// Turn-based, instant scoring, no opponent secret reveal
import { db, doc, getDoc, setDoc, updateDoc, onSnapshot, serverTimestamp, runTransaction } from "./firebase.js";
const $ = (id) => document.getElementById(id);

// --- identity (for role auto-claim)
const MY_ID_KEY = "guess3_my_id";
function getMyId(){
  let id = sessionStorage.getItem(MY_ID_KEY);
  if(!id){ id = "u_" + Math.random().toString(36).slice(2,10); sessionStorage.setItem(MY_ID_KEY, id); }
  return id;
}
let myId = getMyId();
let myRole = "spectator"; // "p1" | "p2" | "spectator"

// --- helpers
function onlyDigits3(s){ return /^\d{3}$/.test(s); }
function hasUniqueDigits(s){ return new Set(s.split("")).size === s.length; }
function bulls(a,b){ let c=0; for(let i=0;i<3;i++) if(a[i]===b[i]) c++; return c; }

// --- DOM
const roomIdEl = $("roomId");
const joinBtn = $("joinBtn");
const leaveBtn = $("leaveBtn");
const copyLinkBtn = $("copyLink");
const allowRepeatsEl = $("allowRepeats");

const yourRoleEl = $("yourRole");
const turnNowEl = $("turnNow");

const p1secretEl = $("p1secret");
const p2secretEl = $("p2secret");
const toggleP1Btn = $("toggleP1");
const toggleP2Btn = $("toggleP2");

const startBtn = $("startBtn");
const resetBtn = $("resetBtn");

const p1GuessEl = $("p1guess");
const p2GuessEl = $("p2guess");
const p1SubmitBtn = $("p1Submit");
const p2SubmitBtn = $("p2Submit");

const p1HistoryTbody = $("p1History");
const p2HistoryTbody = $("p2History");
const p1Tries = $("p1Tries");
const p2Tries = $("p2Tries");
const roomStatus = $("roomStatus");
const gameStatus = $("gameStatus");
const winnerArea = $("winnerArea");

// --- Firestore state
let roomRef = null, unsub = null, lastSnap = null;

function blankRoom(roomId){
  return {
    roomId, createdAt: serverTimestamp(),
    status: "idle",         // idle -> ready -> playing -> finished
    allowRepeats: false,
    // players
    p1Id: null, p2Id: null,
    // secrets and readiness
    p1Secret: "", p2Secret: "",
    p1Ready: false, p2Ready: false,
    // turn-based play
    turn: null,             // "p1" or "p2" while playing
    // history is now per-step
    history: [],            // [{ step, by: "p1"|"p2", guess, bulls }]
    winner: null
  };
}

// --- Render
function render(d){
  const {
    status="idle", allowRepeats=false,
    p1Id=null, p2Id=null,
    p1Ready=false, p2Ready=false,
    turn=null,
    history=[], winner=null
  } = d || {};

  myRole = (myId===p1Id) ? "p1" : (myId===p2Id) ? "p2" : "spectator";
  yourRoleEl.textContent = myRole.toUpperCase();
  roomStatus.textContent = status;
  turnNowEl.textContent = status==="playing" ? (turn==="p1" ? "Player 1" : "Player 2") : "—";
  allowRepeatsEl.checked = !!allowRepeats;

  // tries
  const p1Steps = history.filter(h=>h.by==="p1").length;
  const p2Steps = history.filter(h=>h.by==="p2").length;
  p1Tries.textContent = p1Steps;
  p2Tries.textContent = p2Steps;

  // enablement
  const inIdle = status==="idle";
  allowRepeatsEl.disabled = !inIdle || myRole!=="p1";
  p1secretEl.disabled = !inIdle || myRole!=="p1";
  p2secretEl.disabled = !inIdle || myRole!=="p2";
  startBtn.disabled = !(status==="ready" && myRole==="p1");
  resetBtn.disabled = !(status==="finished" || status==="ready" || status==="playing");

  const canGuessP1 = status==="playing" && myRole==="p1" && turn==="p1";
  const canGuessP2 = status==="playing" && myRole==="p2" && turn==="p2";
  p1GuessEl.disabled = !canGuessP1;
  p2GuessEl.disabled = !canGuessP2;
  p1SubmitBtn.disabled = !canGuessP1;
  p2SubmitBtn.disabled = !canGuessP2;

  // status line
  if(status==="idle"){
    const need = [
      myRole==="p1" && !p1Ready ? "Type your P1 secret" : null,
      myRole==="p2" && !p2Ready ? "Type your P2 secret" : null,
      (myRole==="spectator") ? "Waiting for players to join" : null
    ].filter(Boolean).join(" • ") || "Waiting for both secrets…";
    gameStatus.innerHTML = `<span class="tag tag-info">Idle</span> ${need}`;
  }else if(status==="ready"){
    gameStatus.innerHTML = `<span class="tag tag-info">Ready</span> Both secrets set. P1 can start (auto-start soon).`;
  }else if(status==="playing"){
    gameStatus.innerHTML = `<span class="tag tag-info">Turn</span> ${turn==="p1" ? "Player 1" : "Player 2"} — enter a guess.`;
  }else if(status==="finished"){
    if(winner==="p1") gameStatus.innerHTML = `<span class="tag tag-ok">Game over</span> Player 1 wins 👑`;
    else if(winner==="p2") gameStatus.innerHTML = `<span class="tag tag-bad">Game over</span> Player 2 wins 👑`;
    else gameStatus.innerHTML = `<span class="tag tag-info">Game over</span> Draw — both reached 3 bulls.`;
  }else{
    gameStatus.textContent = "—";
  }

  // tables
  p1HistoryTbody.innerHTML = "";
  p2HistoryTbody.innerHTML = "";
  for(const h of history){
    if(h.by==="p1"){
      const tr = document.createElement("tr");
      tr.innerHTML = `<td>${h.step}</td><td class="reveal">${h.guess}</td><td>${h.bulls}</td>`;
      p1HistoryTbody.appendChild(tr);
    }else{
      const tr = document.createElement("tr");
      tr.innerHTML = `<td>${h.step}</td><td class="reveal">${h.guess}</td><td>${h.bulls}</td>`;
      p2HistoryTbody.appendChild(tr);
    }
  }

  // winner banner
  winnerArea.innerHTML = "";
  if(status==="finished"){
    const div = document.createElement("div");
    const cls = winner==="draw" ? "warn" : (winner==="p1" ? "ok" : "bad");
    div.className = `winner ${cls}`;
    div.innerHTML = winner==="draw"
      ? `⚖️ Draw!`
      : (winner==="p1" ? `🎉 Player 1 wins!` : `🎉 Player 2 wins!`);
    winnerArea.appendChild(div);
  }
}

// --- Join / claim slots
async function joinRoom(){
  const urlParams = new URLSearchParams(location.search);
  const paramRoom = urlParams.get("room");
  const id = (roomIdEl.value.trim() || paramRoom || "").slice(0,24);
  if(!id){ alert("Enter a Room ID"); return; }
  roomIdEl.value = id;

  roomRef = doc(db, "rooms", id);
  await runTransaction(db, async (tr)=>{
    const snap = await tr.get(roomRef);
    if(!snap.exists()){
      const d = blankRoom(id);
      d.p1Id = myId; // first joiner becomes P1
      tr.set(roomRef, d);
    }else{
      const d = snap.data();
      if(!d.p1Id) d.p1Id = myId;
      else if(!d.p2Id && d.p1Id!==myId) d.p2Id = myId;
      tr.set(roomRef, d, { merge: true });
    }
  });

  if(unsub) unsub();
  unsub = onSnapshot(roomRef, (s)=>{
    lastSnap = s;
    const d = s.data();
    render(d);

    // Auto-start when both ready (only P1 triggers)
    if(d?.status==="ready" && myRole==="p1"){ startGame(true).catch(()=>{}); }
  });

  joinBtn.disabled = true; leaveBtn.disabled = false; resetBtn.disabled = false;

  // shareable URL
  const url = new URL(location.href); url.searchParams.set("room", id);
  history.replaceState(null, "", url.toString());
}

async function leaveRoom(){
  if(unsub) unsub(); unsub = null; roomRef = null; lastSnap = null;
  yourRoleEl.textContent = "—"; turnNowEl.textContent = "—";
  joinBtn.disabled = false; leaveBtn.disabled = true; resetBtn.disabled = true;
  render(blankRoom(""));
}

// --- Secrets: auto-ready when valid
async function setSecretAuto(player){
  if(!roomRef || !lastSnap) return;
  const d = lastSnap.data(); if(!d || d.status!=="idle") return;

  const allow = !!d.allowRepeats;
  const val = player==="p1" ? p1secretEl.value.trim() : p2secretEl.value.trim();
  if(!onlyDigits3(val)) return;
  if(!allow && !hasUniqueDigits(val)){ alert("Digits must be unique (enable repeats if you want)."); return; }

  await runTransaction(db, async (tr)=>{
    const cur = await tr.get(roomRef);
    const x = cur.data(); if(!x || x.status!=="idle") return;
    if(player==="p1" && myRole==="p1"){ x.p1Secret = val; x.p1Ready = true; }
    if(player==="p2" && myRole==="p2"){ x.p2Secret = val; x.p2Ready = true; }
    if(x.p1Ready && x.p2Ready) x.status = "ready";
    tr.set(roomRef, x);
  });
}

// --- Start / Reset
async function startGame(auto=false){
  if(!roomRef || myRole!=="p1") return;
  await runTransaction(db, async (tr)=>{
    const cur = await tr.get(roomRef);
    const d = cur.data(); if(!d || d.status!=="ready") return;
    d.status = "playing";
    d.turn = "p1";
    d.history = [];
    d.winner = null;
    tr.set(roomRef, d);
  });
  if(!auto) gameStatus.innerHTML = `<span class="tag tag-info">Turn</span> Player 1 — enter a guess.`;
}

async function resetRoom(){
  if(!roomRef || !lastSnap) return;
  await runTransaction(db, async (tr)=>{
    const cur = await tr.get(roomRef); if(!cur.exists()) return;
    const d = cur.data();
    tr.set(roomRef, { ...blankRoom(cur.id), allowRepeats: !!d.allowRepeats, p1Id: d.p1Id||null, p2Id: d.p2Id||null });
  });
}

// --- Submit guess (instant scoring; turn-based)
async function submitGuess(player){
  if(!roomRef || !lastSnap) return;

  const input = player==="p1" ? p1GuessEl : p2GuessEl;
  const g = input.value.trim();
  if(!onlyDigits3(g)){ alert("Enter exactly 3 digits."); return; }

  await runTransaction(db, async (tr)=>{
    const cur = await tr.get(roomRef);
    const d = cur.data(); if(!d || d.status!=="playing") return;

    // must be your turn and your role
    if(d.turn!==player) return;
    if(player==="p1" && myRole!=="p1") return;
    if(player==="p2" && myRole!=="p2") return;

    const allow = !!d.allowRepeats;
    if(!allow && !hasUniqueDigits(g)) return;

    // score immediately
    const secret = player==="p1" ? d.p2Secret : d.p1Secret;
    const score = bulls(g, secret);

    const step = (d.history?.length || 0) + 1;
    const entry = { step, by: player, guess: g, bulls: score };
    const nextHistory = [ ...(d.history||[]), entry ];

    // win / next turn
    if(score===3){
      d.status = "finished";
      d.winner = player;
      d.turn = null;
    }else{
      d.turn = (player==="p1" ? "p2" : "p1");
    }
    d.history = nextHistory;

    tr.set(roomRef, d);
  });

  input.value = "";
}

// --- Events
document.addEventListener("DOMContentLoaded", ()=>{
  // Pre-fill room from ?room=...
  const urlParams = new URLSearchParams(location.search);
  const qRoom = urlParams.get("room");
  if(qRoom) roomIdEl.value = qRoom;

  render(blankRoom(""));

  joinBtn.addEventListener("click", joinRoom);
  leaveBtn.addEventListener("click", leaveRoom);
  copyLinkBtn.addEventListener("click", ()=>{
    const id = roomIdEl.value.trim();
    if(!id){ alert("Enter a Room ID first"); return; }
    const url = `${location.origin}${location.pathname}?room=${encodeURIComponent(id)}`;
    navigator.clipboard.writeText(url).then(()=> alert("Link copied! Share it with your friend."));
  });

  allowRepeatsEl.addEventListener("change", async ()=>{
    if(!roomRef || myRole!=="p1") return;
    const snap = await getDoc(roomRef);
    if(snap.exists()){
      const d = snap.data();
      if(d.status==="idle"){ await updateDoc(roomRef, { allowRepeats: !!allowRepeatsEl.checked }); }
    }
  });

  // auto-ready on valid input
  p1secretEl.addEventListener("input", ()=> setSecretAuto("p1"));
  p2secretEl.addEventListener("input", ()=> setSecretAuto("p2"));

  // show/hide own secret locally
  toggleP1Btn.addEventListener("click", ()=>{ if(myRole==="p1") p1secretEl.type = p1secretEl.type==="password" ? "text" : "password"; });
  toggleP2Btn.addEventListener("click", ()=>{ if(myRole==="p2") p2secretEl.type = p2secretEl.type==="password" ? "text" : "password"; });

  // turn-based guessing
  p1SubmitBtn.addEventListener("click", ()=> submitGuess("p1"));
  p2SubmitBtn.addEventListener("click", ()=> submitGuess("p2"));
  p1GuessEl.addEventListener("keyup", (e)=>{ if(e.key==="Enter") submitGuess("p1"); });
  p2GuessEl.addEventListener("keyup", (e)=>{ if(e.key==="Enter") submitGuess("p2"); });

  startBtn.addEventListener("click", ()=> startGame(false));
  resetBtn.addEventListener("click", resetRoom);
});
