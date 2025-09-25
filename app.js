// app.js — Auth-required, reliable stats counting (single finalization w/ retry),
// persistent players count, big 5s winner overlay, deadline timer,
// P1-only Reset, Leave, 20-min soft expire.

import {
  auth, onAuthStateChanged, updateProfile,
  db, doc, getDoc, setDoc, onSnapshot, serverTimestamp, runTransaction
} from "./firebase.js";

const $ = (id) => document.getElementById(id);

/* ========== Identity (from Firebase Auth) ========== */
let myId = null;       // auth.uid
let myName = null;     // auth.displayName
let myRole = "spectator";

/* ========== Helpers ========== */
function onlyDigitsN(s, n){ return new RegExp(`^\\d{${n}}$`).test(s); }
function hasUniqueDigits(s){ return new Set(s.split("")).size === s.length; }
function bulls(a,b){ let c=0; for(let i=0;i<Math.min(a.length,b.length);i++) if(a[i]===b[i]) c++; return c; }
function pairKey(a,b){ return [a,b].sort().join("_"); }
function nowMs(){ return Date.now(); }
function ceilSec(ms){ return Math.max(0, Math.ceil(ms/1000)); }

/* ---- Retry helper for contention (base-version mismatch) ---- */
async function withRetry(fn, tries = 5){
  let delay = 120; // ms
  for(let i=0;i<tries;i++){
    try{ return await fn(); }
    catch(e){
      const msg = (e && e.message) || "";
      const code = (e && e.code) || "";
      const contention =
        code === "aborted" ||
        code === "failed-precondition" ||
        /base version/i.test(msg) ||
        /transaction/i.test(msg);
      if(!contention || i === tries-1) throw e;
      await new Promise(r=>setTimeout(r, delay + Math.floor(Math.random()*80)));
      delay *= 2;
    }
  }
}

/* ========== UI Refs ========== */
const banner = $("banner");
const overlay = $("overlay");
const overlayContent = $("overlayContent");

const yourRoleEl = $("yourRole");
const turnNowEl  = $("turnNow");
const roomStatus = $("roomStatus");
const gameStatus = $("gameStatus");
const codeLenBadge = $("codeLen");
const timeLeftBadge = $("timeLeft");

const playersPill = $("playersPill");
const playersCountEl = $("playersCount");

const p1NameEl = $("p1Name");
const p2NameEl = $("p2Name");

const copyLinkBtn = $("copyLink");
const leaveBtn = $("leaveBtn");
const resetBtn = $("resetBtn");

const p1SecretRow = $("p1SecretRow");
const p2SecretRow = $("p2SecretRow");
const p1secretEl = $("p1secret");
const p2secretEl = $("p2secret");
const toggleP1Btn = $("toggleP1");
const toggleP2Btn = $("toggleP2");

const p1Board = $("p1Board");
const p2Board = $("p2Board");
const p1Title = $("p1Title");
const p2Title = $("p2Title");
const p1GuessRow = $("p1GuessRow");
const p2GuessRow = $("p2GuessRow");
const p1GuessEl = $("p1guess");
const p2GuessEl = $("p2guess");
const p1SubmitBtn = $("p1Submit");
const p2SubmitBtn = $("p2Submit");
const p1HistoryTbody = $("p1History");
const p2HistoryTbody = $("p2History");
const p1TimerEl = $("p1Timer");
const p2TimerEl = $("p2Timer");

let roomRef = null, unsub = null, lastSnap = null;

let localTick = null;
let serverTick = null;
let softExpireTimer = null;
let currentDeadlineMs = null;
let winnerOverlayTimer = null;
let lastStatus = null;
let drivingCountdown = false;

/* ===== UI helpers ===== */
function showBanner(msg){ if(!banner) return; banner.innerHTML = msg; banner.style.display="block"; }
function hideBanner(){ if(!banner) return; banner.style.display="none"; banner.innerHTML = ""; }

function showOverlayNum(n){
  if(!overlay || !overlayContent) return;
  overlayContent.textContent = String(n);
  overlay.style.display = "grid";
}
function showOverlayText(text){
  if(!overlay || !overlayContent) return;
  overlayContent.innerHTML = `<div style="font-size:clamp(32px,6vw,56px); font-weight:900; letter-spacing:.5px;">${text}</div>`;
  overlay.style.display = "grid";
}
function hideOverlay(){ if(!overlay) return; overlay.style.display = "none"; }

function setActiveTurn(turn){
  [p1Board,p2Board].forEach(x=> x && x.classList.remove("active-turn"));
  if(turn==="p1" && p1Board) p1Board.classList.add("active-turn");
  if(turn==="p2" && p2Board) p2Board.classList.add("active-turn");
}
function clearLocalTick(){ if(localTick){ clearInterval(localTick); localTick = null; } }
function clearServerTick(){ if(serverTick){ clearInterval(serverTick); serverTick = null; } }
function clearSoftExpire(){ if(softExpireTimer){ clearTimeout(softExpireTimer); softExpireTimer = null; } }
function clearWinnerOverlayTimer(){ if(winnerOverlayTimer){ clearTimeout(winnerOverlayTimer); winnerOverlayTimer = null; } }

/* ===== Render ===== */
function render(d){
  const {
    createdById=null,
    status="waiting",
    codeLen=3, turnTimeSec=20, timeLeft=turnTimeSec,
    p1Id=null,p2Id=null, p1Name="",p2Name="",
    p1Ready=false,p2Ready=false, turn=null, history=[], winner=null,
    countdown=null, tickDriverId=null,
    createdAt=null,
    turnDeadlineMs=null,
    resultsLogged=false
  } = d || {};

  if(status === "closed"){
    showBanner(`<span class="tag tag-bad">Closed</span> Room closed.`);
    setTimeout(()=>{ location.href="home.html"; }, 800);
  }

  myRole = (myId===p1Id) ? "p1" : (myId===p2Id) ? "p2" : "spectator";
  const isAdmin = (createdById ? createdById === myId : (myRole === "p1"));
  const iAmTickDriver = (tickDriverId === myId);

  const p1Display = p1Name || "Player 1";
  const p2Display = p2Name || "Player 2";

  if(p1Title) p1Title.textContent = `${p1Display} Board`;
  if(p2Title) p2Title.textContent = `${p2Display} Board`;

  // Players count — keep always visible and updated
  const playersCount = (p1Id?1:0) + (p2Id?1:0);
  if(playersPill){ playersPill.style.display = "inline-block"; }
  if(playersCountEl){ playersCountEl.textContent = `${playersCount}/2`; }

  // Top info
  yourRoleEl.textContent = myRole.toUpperCase();
  roomStatus.textContent = status;
  const turnName = (turn==="p1") ? p1Display : (turn==="p2" ? p2Display : "—");
  turnNowEl.textContent = (status==="playing") ? turnName : "—";
  codeLenBadge.textContent = String(codeLen);
  p1NameEl.textContent = p1Display;
  p2NameEl.textContent = p2Display;

  // Secret entry: always visible to owner; disabled after start
  p1SecretRow.style.display = (myRole==="p1") ? "flex" : "none";
  p2SecretRow.style.display = (myRole==="p2") ? "flex" : "none";
  if(p1secretEl) p1secretEl.disabled = status!=="idle";
  if(p2secretEl) p2secretEl.disabled = status!=="idle";

  // Guess inputs only for self
  const canGuessP1 = status==="playing" && myRole==="p1" && turn==="p1";
  const canGuessP2 = status==="playing" && myRole==="p2" && turn==="p2";
  p1GuessRow.style.display = (myRole==="p1") ? "flex" : "none";
  p2GuessRow.style.display = (myRole==="p2") ? "flex" : "none";
  p1GuessEl.disabled = !canGuessP1; p1SubmitBtn.disabled = !canGuessP1;
  p2GuessEl.disabled = !canGuessP2; p2SubmitBtn.disabled = !canGuessP2;

  // P1-only Reset
  resetBtn.style.display = (myRole==="p1") ? "inline-block" : "none";
  resetBtn.disabled = !(status==="finished" || status==="idle" || status==="playing");

  // Banners & overlay
  if(lastStatus !== status){
    if(status==="waiting"){
      showBanner(`<span class="tag tag-info">Waiting</span> Waiting for another player to join…`);
    }else if(status==="idle"){
      hideBanner();
      showBanner(`<span class="tag tag-info">Ready</span> Both players joined — write your <b>${codeLen}</b>-digit secret.`);
    }else{
      hideBanner();
    }
  }

  if(status==="waiting"){
    gameStatus.innerHTML = `<span class="tag tag-info">Waiting</span> Waiting for another player to join…`;
  }else if(status==="idle"){
    const need = [
      (myRole==="p1" && !p1Ready) ? `Type your secret (${codeLen} digits)` : null,
      (myRole==="p2" && !p2Ready) ? `Type your secret (${codeLen} digits)` : null,
    ].filter(Boolean).join(" • ") || "Waiting for both secrets…";
    gameStatus.innerHTML = `<span class="tag tag-info">Idle</span> ${need}`;
  }else if(status==="countdown"){
    gameStatus.innerHTML = `<span class="tag tag-info">Get ready</span> The game starts in ${countdown}s…`;
    if(countdown!=null) showOverlayNum(countdown);
  }else if(status==="playing"){
    hideOverlay();
    gameStatus.innerHTML = `<span class="tag tag-info">Turn</span> ${turnName} — enter your guess.`;
  }else if(status==="finished"){
    const winnerName = winner==="p1" ? p1Display : (winner==="p2" ? p2Display : "Draw");
    if(winnerName && lastStatus!=="finished"){
      // Winner overlay for 5s
      clearWinnerOverlayTimer();
      showOverlayText(winner==="draw" ? "Draw!" : `${winnerName} wins!`);
      winnerOverlayTimer = setTimeout(hideOverlay, 5000);
    }
    if(winner==="p1") gameStatus.innerHTML = `<span class="tag tag-ok">Game over</span> ${p1Display} wins 👑`;
    else if(winner==="p2") gameStatus.innerHTML = `<span class="tag tag-bad">Game over</span> ${p2Display} wins 👑`;
    else gameStatus.innerHTML = `<span class="tag tag-info">Game over</span> Draw.`;
  }
  lastStatus = status;

  // History
  p1HistoryTbody.innerHTML = "";
  p2HistoryTbody.innerHTML = "";
  let p1Step=0, p2Step=0;
  for(const h of (history || [])){
    if(h.by==="p1"){
      p1Step++;
      const tr=document.createElement("tr");
      tr.innerHTML = `<td>${p1Step}</td><td class="reveal">${h.guess}</td><td>${h.bulls}</td>`;
      p1HistoryTbody.appendChild(tr);
    }else if(h.by==="p2"){
      p2Step++;
      const tr=document.createElement("tr");
      tr.innerHTML = `<td>${p2Step}</td><td class="reveal">${h.guess}</td><td>${h.bulls}</td>`;
      p2HistoryTbody.appendChild(tr);
    }
  }

  // Turn highlight
  setActiveTurn(status==="playing" ? turn : null);

  // DEADLINE DISPLAY
  currentDeadlineMs = (typeof turnDeadlineMs === "number") ? turnDeadlineMs : null;
  refreshLocalTimeLeftDisplay(status, turn, turnTimeSec);

  // Authoritative tick by tickDriver
  if(status==="playing" && iAmTickDriver){
    if(!serverTick){
      serverTick = setInterval(()=>{ serverTickOnce().catch((e)=>console.error("tick error",e)); }, 1000);
    }
  }else{
    clearServerTick();
  }

  // Soft expire (20 min) by creator
  setupSoftExpire(createdAt, isAdmin);
}

/* ---- Local visual timer ---- */
function refreshLocalTimeLeftDisplay(status, turn, turnTimeSec){
  const paint = ()=>{
    let remaining = "—";
    if(status==="playing" && currentDeadlineMs){
      const msLeft = currentDeadlineMs - nowMs();
      remaining = ceilSec(msLeft);
    }
    timeLeftBadge.textContent = (status==="playing") ? remaining : "—";
    p1TimerEl.textContent = (status==="playing" && turn==="p1") ? remaining : "—";
    p2TimerEl.textContent = (status==="playing" && turn==="p2") ? remaining : "—";
  };
  paint();
  clearLocalTick();
  if(status==="playing"){ localTick = setInterval(paint, 1000); }
}

/* ---- Server tick (deadline-based) ---- */
async function serverTickOnce(){
  if(!roomRef) return;
  await runTransaction(db, async (tr)=>{
    const cur = await tr.get(roomRef);
    if(!cur.exists()) return;
    const d = cur.data();
    if(d.status!=="playing") return;

    const tt = d.turnTimeSec ?? 20;
    const now = nowMs();
    let deadline = typeof d.turnDeadlineMs === "number" ? d.turnDeadlineMs : null;

    if(!deadline){
      tr.set(roomRef, { turnDeadlineMs: now + tt*1000, timeLeft: tt }, { merge:true });
      return;
    }

    const remaining = ceilSec(deadline - now);
    if(remaining > 0){
      tr.set(roomRef, { timeLeft: remaining }, { merge:true });
    }else{
      // timeout -> dash, flip
      const step = (d.history?.length || 0) + 1;
      const entry = { step, by: d.turn, guess: "—", bulls: "—", timeout: true };
      const nextHistory = [ ...(d.history||[]), entry ];
      const nextTurn = d.turn==="p1" ? "p2" : "p1";
      const nextDeadline = now + tt*1000;

      tr.set(roomRef, {
        history: nextHistory,
        turn: nextTurn,
        timeLeft: tt,
        turnDeadlineMs: nextDeadline
      }, { merge:true });
    }
  });
}

/* ---- Secrets ---- */
async function setSecretAuto(player){
  try{
    if(!roomRef || !lastSnap) return;
    const d = lastSnap.data(); if(!d) return;
    const codeLen = d.codeLen || 3;

    const val = player==="p1" ? (p1secretEl?.value||"").trim() : (p2secretEl?.value||"").trim();
    if(!onlyDigitsN(val, codeLen)) return;
    if(!hasUniqueDigits(val)){ alert("Digits must be unique."); return; }

    const patch={};
    if(player==="p1" && myRole==="p1"){ patch.p1Secret = val; patch.p1Ready = true; }
    if(player==="p2" && myRole==="p2"){ patch.p2Secret = val; patch.p2Ready = true; }
    const p1R=(d.p1Ready||patch.p1Ready), p2R=(d.p2Ready||patch.p2Ready);
    if(d.status==="idle" && p1R && p2R) patch.status="ready";
    await setDoc(roomRef, patch, { merge:true });
  }catch(e){
    console.error("setSecretAuto error:", e);
    showBanner(`<span class="tag tag-bad">Error</span> ${e?.message||e}`);
  }
}

/* ---- Countdown (P1) -> Playing ---- */
async function startCountdownThenPlay(){
  try{
    if(!roomRef || !lastSnap) return;
    if(myRole!=="p1") return;
    const d = lastSnap.data(); if(!d || d.status!=="ready") return;

    await setDoc(roomRef, { status: "countdown", countdown: 3, tickDriverId: d.p1Id }, { merge:true });
    drivingCountdown = true; showOverlayNum(3);

    let n = 3;
    const tick = setInterval(async ()=>{
      n -= 1;
      if(n > 0){
        await setDoc(roomRef, { countdown: n }, { merge:true });
        showOverlayNum(n);
      }else{
        clearInterval(tick);
        drivingCountdown = false;
        await runTransaction(db, async (tr)=>{
          const cur = await tr.get(roomRef);
          if(!cur.exists()) return;
          const d2 = cur.data();
          if(!d2 || (d2.status!=="countdown" && d2.status!=="ready")) return;
          const tt = d2.turnTimeSec ?? 20;
          const deadline = nowMs() + tt*1000;
          tr.set(roomRef, {
            status: "playing",
            turn: "p1",
            history: [],
            winner: null,
            timeLeft: tt,
            turnDeadlineMs: deadline,
            resultsLogged: false
          }, { merge:true });
        });
        hideOverlay();
      }
    }, 1000);
  }catch(e){
    console.error("startCountdownThenPlay error:", e);
    showBanner(`<span class="tag tag-bad">Error</span> ${e?.message||e}`);
  }
}

/* ---- Submit Guess ---- */
async function submitGuess(player){
  try{
    if(!roomRef || !lastSnap) return;
    const d0 = lastSnap.data(); if(!d0 || d0.status!=="playing") return;
    const codeLen = d0.codeLen || 3;

    const input = player==="p1" ? p1GuessEl : p2GuessEl;
    const g = (input?.value||"").trim();
    if(!onlyDigitsN(g, codeLen)){ alert(`Enter exactly ${codeLen} digits.`); return; }
    if(!hasUniqueDigits(g)){ alert("Digits must be unique."); return; }

    await runTransaction(db, async (tr)=>{
      const cur=await tr.get(roomRef); if(!cur.exists()) return;
      const d = cur.data(); if(!d || d.status!=="playing") return;

      if(d.turn!==player) return;
      if(player==="p1" && myRole!=="p1") return;
      if(player==="p2" && myRole!=="p2") return;

      const secret = player==="p1" ? d.p2Secret : d.p1Secret;
      const score = bulls(g, secret);
      const step = (d.history?.length||0)+1;
      const entry = { step, by:player, guess:g, bulls:score };
      const nextHistory = [ ...(d.history||[]), entry ];

      if(score===codeLen){
        d.status="finished"; d.winner=player; d.turn=null;
        d.turnDeadlineMs = null;
        d.timeLeft = 0;
      }else{
        d.turn = (player==="p1" ? "p2" : "p1");
        const tt = d.turnTimeSec ?? 20;
        d.timeLeft = tt;
        d.turnDeadlineMs = nowMs() + tt*1000;
      }
      d.history = nextHistory;
      tr.set(roomRef,d);
    });

    // finalize results once if finished
    const snap = await getDoc(roomRef);
    const d2 = snap.data() || {};
    if(d2.status==="finished"){
      await finalizeResultsOnce(d2);
    }

    if(input) input.value="";
  }catch(e){
    console.error("submitGuess error:", e);
    showBanner(`<span class="tag tag-bad">Error</span> ${e?.message||e}`);
  }
}

/* ===== Finalize stats ONE time (wins/losses + matchup games) with retries ===== */
async function finalizeResultsOnce(roomData){
  const rref = roomRef; if(!rref) return;
  const { p1Id, p2Id, p1Name, p2Name, winner } = roomData;
  if(!p1Id || !p2Id || !winner) return;

  await withRetry(async ()=>{
    await runTransaction(db, async (tr)=>{
      const rs = await tr.get(rref);
      if(!rs.exists()) return;
      const d = rs.data();
      if(d.status!=="finished") return;

      // Guard: if already logged by another client, stop.
      if(d.resultsLogged === true) return;

      // Mark as logged first so any concurrent transaction will see it and bail.
      tr.set(rref, { resultsLogged: true, resultsLoggedAt: serverTimestamp() }, { merge:true });

      // ---- matchup doc
      const key = pairKey(p1Id,p2Id);
      const mref = doc(db, "matchups", key);
      const ms = await tr.get(mref);
      let wins = ms.exists() ? (ms.data().wins || {}) : {};
      wins[p1Id] = wins[p1Id] || 0;
      wins[p2Id] = wins[p2Id] || 0;
      if(winner==="p1") wins[p1Id] += 1; else if(winner==="p2") wins[p2Id] += 1;
      const gamesPlayed = (wins[p1Id] + wins[p2Id]);
      tr.set(mref, {
        wins,
        gamesPlayed,
        players: { [p1Id]: p1Name || "P1", [p2Id]: p2Name || "P2" },
        updatedAt: serverTimestamp()
      }, { merge:true });

      // ---- per-user totals + append game line (capped to 200)
      const lineFor = (meUid, meName, oppUid, oppName, meWon)=>({
        opponentId: oppUid,
        opponentName: oppName || "Player",
        roomId: d.roomId || rref.id,
        meWon: !!meWon,
        winnerUid: meWon ? meUid : oppUid,
        at: serverTimestamp()
      });

      const u1 = doc(db, "users", p1Id);
      const u2 = doc(db, "users", p2Id);

      const s1 = await tr.get(u1);
      const d1 = s1.exists()? (s1.data()||{}) : {};
      const g1 = Array.isArray(d1.games) ? d1.games.slice(-199) : [];
      g1.push(lineFor(p1Id, p1Name, p2Id, p2Name, winner==="p1"));
      tr.set(u1, {
        name: p1Name || "Player",
        updatedAt: serverTimestamp(),
        totalWins: (d1.totalWins||0) + (winner==="p1"?1:0),
        totalLosses: (d1.totalLosses||0) + (winner==="p2"?1:0),
        totalGames: (d1.totalGames||0) + 1,
        games: g1
      }, { merge:true });

      const s2 = await tr.get(u2);
      const d2 = s2.exists()? (s2.data()||{}) : {};
      const g2 = Array.isArray(d2.games) ? d2.games.slice(-199) : [];
      g2.push(lineFor(p2Id, p2Name, p1Id, p1Name, winner==="p2"));
      tr.set(u2, {
        name: p2Name || "Player",
        updatedAt: serverTimestamp(),
        totalWins: (d2.totalWins||0) + (winner==="p2"?1:0),
        totalLosses: (d2.totalLosses||0) + (winner==="p1"?1:0),
        totalGames: (d2.totalGames||0) + 1,
        games: g2
      }, { merge:true });
    });
  });
}

/* ---- Reset (P1 only) ---- */
async function resetRoom(){
  try{
    if(!roomRef || !lastSnap) return;
    const d = lastSnap.data(); if(!d) return;
    if(myRole !== "p1"){ alert("Only Player 1 can reset."); return; }
    await setDoc(roomRef,{
      status:(d.p1Id && d.p2Id) ? "idle" : "waiting",
      turn:null, p1Secret:"", p2Secret:"", p1Ready:false, p2Ready:false,
      history:[], winner:null, timeLeft: d.turnTimeSec ?? 20,
      countdown:null, tickDriverId:null, turnDeadlineMs:null,
      resultsLogged:false
    }, { merge:true });
    clearLocalTick(); clearServerTick(); hideOverlay(); clearWinnerOverlayTimer(); drivingCountdown=false;
  }catch(e){
    console.error("resetRoom error:", e);
    showBanner(`<span class="tag tag-bad">Error</span> ${e?.message||e}`);
  }
}

/* ---- Leave ---- */
async function leaveRoom(){
  try{
    if(roomRef && lastSnap?.exists()){
      const d = lastSnap.data();
      if(myRole === "p1"){
        await setDoc(roomRef, { status:"closed", closedAt: serverTimestamp() }, { merge:true });
      }else if(myRole === "p2"){
        await setDoc(roomRef, {
          p2Id: null, p2Name: "", p2Secret: "", p2Ready: false,
          status: "waiting", turn: null, countdown: null, tickDriverId: null, turnDeadlineMs:null, timeLeft: d.turnTimeSec ?? 20
        }, { merge:true });
      }
    }
  }catch(e){
    console.error("leaveRoom error:", e);
  }finally{
    if(unsub) unsub(); unsub=null; roomRef=null; lastSnap=null;
    clearLocalTick(); clearServerTick(); clearSoftExpire(); clearWinnerOverlayTimer();
    hideOverlay(); drivingCountdown=false;
    location.href = "home.html";
  }
}

/* ---- Soft expire ---- */
function setupSoftExpire(createdAt, isAdmin){
  clearSoftExpire();
  try{
    if(createdAt && typeof createdAt.toMillis === "function"){
      const createdMs = createdAt.toMillis();
      const expireMs = createdMs + 20*60*1000;
      const n = nowMs();
      if(n >= expireMs){
        if(isAdmin && roomRef){
          setDoc(roomRef, { status:"closed", closedAt: serverTimestamp() }, { merge:true }).catch(()=>{});
        }
        showBanner(`<span class="tag tag-bad">Expired</span> Room expired.`);
        setTimeout(()=>{ location.href="home.html"; }, 800);
      }else if(isAdmin){
        softExpireTimer = setTimeout(()=>{
          if(roomRef) setDoc(roomRef, { status:"closed", closedAt: serverTimestamp() }, { merge:true }).catch(()=>{});
          location.href="home.html";
        }, expireMs - n);
      }
    }
  }catch(e){
    console.error("expire calc error:", e);
  }
}

/* ---- Profile ensure ---- */
async function ensureUserProfile(u){
  try{
    if(!u.displayName){
      const fallback = (u.email ? u.email.split("@")[0] : ("Player-"+u.uid.slice(0,5)));
      await updateProfile(u, { displayName: fallback });
      myName = fallback;
    }else{
      myName = u.displayName;
    }
  }catch(e){
    console.warn("updateProfile skipped:", e?.message||e);
    myName = u.displayName || (u.email ? u.email.split("@")[0] : "Player");
  }
  await setDoc(doc(db,"users",u.uid),{
    name: myName,
    updatedAt: serverTimestamp(),
    createdAt: serverTimestamp()
  },{ merge:true });
}

/* ---- Join via URL (Auth required) ---- */
async function joinRoomFromURL(){
  let id = (new URLSearchParams(location.search).get("room")||"").slice(0,24);
  if(!id){
    showBanner(`<span class="tag tag-bad">Error</span> No room id in URL. Go back and choose a room.`);
    return;
  }

  roomRef = doc(db,"rooms",id);

  await runTransaction(db, async (tr)=>{
    const snap = await tr.get(roomRef);
    if(!snap.exists()){
      const now = nowMs();
      const d = {
        roomId:id, createdAt: serverTimestamp(),
        expiresAt: new Date(now + 20*60*1000),
        status:"waiting", codeLen:3,
        turnTimeSec:20, timeLeft:20,
        createdById: myId,
        p1Id: myId, p1Name: myName,
        p2Id:null, p2Name:"",
        p1Secret:"", p2Secret:"", p1Ready:false, p2Ready:false,
        turn:null, history:[], winner:null,
        countdown:null, tickDriverId:null,
        turnDeadlineMs:null,
        resultsLogged:false
      };
      tr.set(roomRef, d);
    }else{
      const d = snap.data() || {};
      if(d.status === "closed"){
        if(d.createdById === myId){
          d.status = "waiting";
          d.p2Id = null; d.p2Name=""; d.p2Secret=""; d.p2Ready=false;
          d.turn=null; d.countdown=null; d.tickDriverId=null; d.history=[];
          d.turnDeadlineMs=null; d.timeLeft=d.turnTimeSec ?? 20;
          d.resultsLogged=false;
        }else{
          throw new Error("Room is closed.");
        }
      }
      if(!d.p1Id){ d.p1Id=myId; d.p1Name=myName; }
      else if(!d.p2Id && d.p1Id!==myId){ d.p2Id=myId; d.p2Name=myName; }
      if(d.p1Id && d.p2Id && d.status==="waiting"){
        d.status="idle";
        d.p1Secret=""; d.p2Secret=""; d.p1Ready=false; d.p2Ready=false;
        d.turn=null; d.history=[]; d.winner=null; d.timeLeft=d.turnTimeSec ?? 20;
        d.countdown=null; d.tickDriverId=null; d.turnDeadlineMs=null;
        d.resultsLogged=false;
      }
      tr.set(roomRef, d, { merge:true });
    }
  });

  if(unsub) unsub();
  unsub = onSnapshot(roomRef, (s)=>{
    try{
      lastSnap = s;
      const d = s.data() || {};
      render(d);
      if(d.status==="ready" && myRole==="p1" && !drivingCountdown){
        startCountdownThenPlay().catch(()=>{ drivingCountdown=false; });
      }
      // If somehow finished but not logged (e.g., reconnect), finalize once.
      if(d.status==="finished" && d.resultsLogged !== true){
        finalizeResultsOnce(d).catch(()=>{});
      }
    }catch(e){
      console.error("onSnapshot render error:", e);
      showBanner(`<span class="tag tag-bad">Error</span> ${e?.message||e}`);
    }
  }, (err)=>{
    console.error("onSnapshot error:", err);
    showBanner(`<span class="tag tag-bad">Listen error</span> ${err?.message||err}`);
  });

  leaveBtn.disabled = false; copyLinkBtn.disabled = false;
}

/* ---- Events / Auth gate ---- */
document.addEventListener("DOMContentLoaded", ()=>{
  render({ status:"waiting" });

  p1secretEl && p1secretEl.addEventListener("input", ()=> setSecretAuto("p1"));
  p2secretEl && p2secretEl.addEventListener("input", ()=> setSecretAuto("p2"));
  toggleP1Btn && toggleP1Btn.addEventListener("click", ()=>{ if(p1secretEl) p1secretEl.type = p1secretEl.type==="password" ? "text" : "password"; });
  toggleP2Btn && toggleP2Btn.addEventListener("click", ()=>{ if(p2secretEl) p2secretEl.type = p2secretEl.type==="password" ? "text" : "password"; });

  p1SubmitBtn && p1SubmitBtn.addEventListener("click", ()=> submitGuess("p1"));
  p2SubmitBtn && p2SubmitBtn.addEventListener("click", ()=> submitGuess("p2"));
  p1GuessEl && p1GuessEl.addEventListener("keyup", (e)=>{ if(e.key==="Enter") submitGuess("p1"); });
  p2GuessEl && p2GuessEl.addEventListener("keyup", (e)=>{ if(e.key==="Enter") submitGuess("p2"); });

  copyLinkBtn && copyLinkBtn.addEventListener("click", ()=>{
    navigator.clipboard.writeText(location.href).then(()=> showBanner(`<span class="tag tag-info">Link</span> Room link copied — share it!`));
    setTimeout(hideBanner, 2000);
  });
  leaveBtn && leaveBtn.addEventListener("click", ()=>{ leaveRoom().catch(()=>{}); });
  resetBtn && resetBtn.addEventListener("click", ()=>{ resetRoom().catch(()=>{}); });

  onAuthStateChanged(auth, async (u)=>{
    if(!u){
      location.href = "login.html?next=" + encodeURIComponent(location.href);
      return;
    }
    myId = u.uid;
    await ensureUserProfile(u);
    myName = u.displayName || myName || (u.email ? u.email.split("@")[0] : "Player");
    joinRoomFromURL().catch((e)=>{
      console.error("joinRoomFromURL error:", e);
      showBanner(`<span class="tag tag-bad">Error</span> ${e?.message||e}`);
    });
  });
});
