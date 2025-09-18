import { db, doc, getDoc, setDoc, updateDoc, onSnapshot, serverTimestamp, runTransaction } from "./firebase.js";

const $ = (id) => document.getElementById(id);
const role = () => document.querySelector('input[name="role"]:checked')?.value || "p1";

function onlyDigits3(s){ return /^\d{3}$/.test(s); }
function hasUniqueDigits(s){ return new Set(s.split("")).size === s.length; }
function bulls(a,b){ let c=0; for(let i=0;i<3;i++) if(a[i]===b[i]) c++; return c; }

const roomIdEl = $("roomId");
const joinBtn = $("joinBtn");
const leaveBtn = $("leaveBtn");
const allowRepeatsEl = $("allowRepeats");

const p1secretEl = $("p1secret");
const p2secretEl = $("p2secret");
const toggleP1Btn = $("toggleP1");
const toggleP2Btn = $("toggleP2");
const p1ReadyBtn = $("p1ReadyBtn");
const p2ReadyBtn = $("p2ReadyBtn");
const startBtn = $("startBtn");
const resetBtn = $("resetBtn");

const revealP1Val = $("revealP1Val");
const revealP2Val = $("revealP2Val");

const p1GuessEl = $("p1guess");
const p2GuessEl = $("p2guess");
const p1SubmitBtn = $("p1Submit");
const p2SubmitBtn = $("p2Submit");

const roundNo = $("roundNo");
const p1Tries = $("p1Tries");
const p2Tries = $("p2Tries");
const roomStatus = $("roomStatus");
const p1HistoryTbody = $("p1History");
const p2HistoryTbody = $("p2History");
const gameStatus = $("gameStatus");
const winnerArea = $("winnerArea");

let unsub = null;
let roomRef = null;
let lastSnap = null;

function renderRoom(data){
  const {
    status="idle", round=0, allowRepeats=false,
    p1Ready=false, p2Ready=false, p1Secret="", p2Secret="",
    current={ p1Guess:null, p2Guess:null },
    history=[], winner=null
  } = data || {};

  allowRepeatsEl.checked = !!allowRepeats;
  roundNo.textContent = round;
  p1Tries.textContent = history.filter(h=>h.p1Guess!=null).length;
  p2Tries.textContent = history.filter(h=>h.p2Guess!=null).length;
  roomStatus.textContent = status;

  revealP1Val.textContent = p1Secret ? p1Secret : "";
  revealP2Val.textContent = p2Secret ? p2Secret : "";

  const myRole = role();
  const isP1 = myRole === "p1";

  allowRepeatsEl.disabled = (status!=="idle") || !isP1;
  p1ReadyBtn.disabled = (status!=="idle") || !p1secretEl.value;
  p2ReadyBtn.disabled = (status!=="idle") || !p2secretEl.value;
  startBtn.disabled = !(isP1 && status==="ready");
  resetBtn.disabled = !(status==="finished" || status==="ready" || status==="playing");

  const canGuess = status==="playing";
  p1GuessEl.disabled = !canGuess || current.p1Guess!=null;
  p2GuessEl.disabled = !canGuess || current.p2Guess!=null;
  p1SubmitBtn.disabled = p1GuessEl.disabled;
  p2SubmitBtn.disabled = p2GuessEl.disabled;

  if(status==="idle"){
    gameStatus.innerHTML = `<span class="tag tag-info">Room</span> Set secrets & Ready. P1 may configure "Allow repeats".`;
  }else if(status==="ready"){
    gameStatus.innerHTML = `<span class="tag tag-info">Ready</span> Both players are ready. P1 can start the game.`;
  }else if(status==="playing"){
    const need = [
      current.p1Guess==null ? "P1 to guess" : null,
      current.p2Guess==null ? "P2 to guess" : null
    ].filter(Boolean).join("  ") || "Both guessed  resolving";
    gameStatus.innerHTML = `<span class="tag tag-info">Round ${round}</span> ${need}`;
  }else if(status==="finished"){
    if(winner==="p1") gameStatus.innerHTML = `<span class="tag tag-ok">Game over</span> Player 1 wins `;
    else if(winner==="p2") gameStatus.innerHTML = `<span class="tag tag-bad">Game over</span> Player 2 wins `;
    else gameStatus.innerHTML = `<span class="tag tag-info">Game over</span> Draw  both got 3 bulls same round.`;
  }else{
    gameStatus.textContent = "";
  }

  p1HistoryTbody.innerHTML = "";
  p2HistoryTbody.innerHTML = "";
  history.forEach(h=>{
    const tr1 = document.createElement("tr");
    tr1.innerHTML = `<td>${h.round}</td><td class="reveal">${h.p1Guess ?? ""}</td><td>${h.p1Bulls ?? ""}</td>`;
    p1HistoryTbody.appendChild(tr1);

    const tr2 = document.createElement("tr");
    tr2.innerHTML = `<td>${h.round}</td><td class="reveal">${h.p2Guess ?? ""}</td><td>${h.p2Bulls ?? ""}</td>`;
    p2HistoryTbody.appendChild(tr2);
  });

  winnerArea.innerHTML = "";
  if(status==="finished"){
    const div = document.createElement("div");
    const cls = winner==="draw" ? "warn" : (winner==="p1" ? "ok" : "bad");
    div.className = `winner ${cls}`;
    div.innerHTML = winner==="draw"
      ? ` Draw! P1 secret: <b class="reveal">${p1Secret}</b>  P2 secret: <b class="reveal">${p2Secret}</b>`
      : winner==="p1"
        ? ` Player 1 wins! P2 secret was: <b class="reveal">${p2Secret}</b>`
        : ` Player 2 wins! P1 secret was: <b class="reveal">${p1Secret}</b>`;
    winnerArea.appendChild(div);
  }
}

function blankRoom(roomId){
  return {
    roomId,
    createdAt: serverTimestamp(),
    status: "idle",
    allowRepeats: false,
    round: 0,
    p1Ready: false,
    p2Ready: false,
    p1Secret: "",
    p2Secret: "",
    current: { p1Guess: null, p2Guess: null },
    history: [],
    winner: null
  };
}

async function joinRoom(){
  const id = roomIdEl.value.trim();
  if(!id){ alert("Enter a Room ID"); return; }

  roomRef = doc(db, "rooms", id);
  const snap = await getDoc(roomRef);
  if(!snap.exists()){
    await setDoc(roomRef, blankRoom(id));
  }
  if(unsub) unsub();
  unsub = onSnapshot(roomRef, (s)=>{
    lastSnap = s;
    const data = s.data();
    renderRoom(data);
    if(data?.status==="playing" && role()==="p1"){
      maybeResolveRoundAsLeader(data).catch(console.error);
    }
  });

  joinBtn.disabled = true;
  leaveBtn.disabled = false;
  resetBtn.disabled = false;
}

async function leaveRoom(){
  if(unsub) unsub();
  unsub = null;
  roomRef = null;
  lastSnap = null;

  joinBtn.disabled = false;
  leaveBtn.disabled = true;
  resetBtn.disabled = true;
  renderRoom(blankRoom(""));
}

async function setReady(player){
  if(!roomRef) return;
  const s1 = p1secretEl.value.trim();
  const s2 = p2secretEl.value.trim();
  const allow = !!allowRepeatsEl.checked;

  const myRole = role();
  const mine = myRole==="p1" ? s1 : s2;
  if(!onlyDigits3(mine)){ alert("Secret must be exactly 3 digits."); return; }
  if(!allow && !hasUniqueDigits(mine)){ alert("With current settings, digits must be unique."); return; }

  await runTransaction(db, async (tr)=>{
    const cur = await tr.get(roomRef);
    const data = cur.data() || blankRoom(roomRef.id);
    if(data.status!=="idle") return;

    if(player==="p1"){
      data.p1Secret = s1;
      data.p1Ready = true;
      if(role()==="p1") data.allowRepeats = allow;
    }else{
      data.p2Secret = s2;
      data.p2Ready = true;
    }
    if(data.p1Ready && data.p2Ready){
      data.status = "ready";
    }
    tr.set(roomRef, data);
  });
}

async function startGame(){
  if(role()!=="p1"){ alert("Only Player 1 can start."); return; }
  if(!roomRef) return;

  await runTransaction(db, async (tr)=>{
    const cur = await tr.get(roomRef);
    const data = cur.data();
    if(!data || data.status!=="ready") return;
    data.status = "playing";
    data.round = 1;
    data.current = { p1Guess: null, p2Guess: null };
    data.history = [];
    data.winner = null;
    tr.set(roomRef, data);
  });
}

async function submitGuess(player){
  if(!roomRef || !lastSnap) return;
  const data = lastSnap.data();
  if(!data || data.status!=="playing") return;

  const allow = !!data.allowRepeats;
  const myInput = player==="p1" ? p1GuessEl : p2GuessEl;
  const g = myInput.value.trim();

  if(!onlyDigits3(g)){ alert("Enter exactly 3 digits."); return; }
  if(!allow && !hasUniqueDigits(g)){ alert("With current settings, digits must be unique."); return; }

  const payload = player==="p1" ? { "current.p1Guess": g } : { "current.p2Guess": g };
  await updateDoc(roomRef, payload);
  myInput.value = "";
}

async function maybeResolveRoundAsLeader(data){
  const { current, status } = data;
  if(status!=="playing") return;
  if(current.p1Guess==null || current.p2Guess==null) return;

  await runTransaction(db, async (tr)=>{
    const cur = await tr.get(roomRef);
    const d = cur.data();
    if(!d || d.status!=="playing") return;
    if(d.current.p1Guess==null || d.current.p2Guess==null) return;

    const p1B = bulls(d.current.p1Guess, d.p2Secret);
    const p2B = bulls(d.current.p2Guess, d.p1Secret);

    const newEntry = {
      round: d.round,
      p1Guess: d.current.p1Guess, p1Bulls: p1B,
      p2Guess: d.current.p2Guess, p2Bulls: p2B
    };
    const nextHistory = [...(d.history||[]), newEntry];

    let winner = null;
    if(p1B===3 && p2B===3) winner = "draw";
    else if(p1B===3) winner = "p1";
    else if(p2B===3) winner = "p2";

    if(winner){
      tr.update(roomRef, {
        history: nextHistory,
        status: "finished",
        winner,
        "current.p1Guess": null,
        "current.p2Guess": null
      });
    }else{
      tr.update(roomRef, {
        history: nextHistory,
        round: d.round + 1,
        "current.p1Guess": null,
        "current.p2Guess": null
      });
    }
  });
}

async function resetRoom(){
  if(!roomRef) return;
  await runTransaction(db, async (tr)=>{
    const cur = await tr.get(roomRef);
    if(!cur.exists()) return;
    const keepRepeats = cur.data().allowRepeats ?? false;
    const id = cur.id;
    tr.set(roomRef, { ...blankRoom(id), allowRepeats: keepRepeats });
  });
}

document.addEventListener("DOMContentLoaded", ()=>{
  renderRoom(blankRoom(""));

  joinBtn.addEventListener("click", joinRoom);
  leaveBtn.addEventListener("click", leaveRoom);

  allowRepeatsEl.addEventListener("change", async ()=>{
    if(!roomRef || role()!=="p1") return;
    const snap = await getDoc(roomRef);
    if(snap.exists() && snap.data().status==="idle"){
      await updateDoc(roomRef, { allowRepeats: !!allowRepeatsEl.checked });
    }
  });

  p1ReadyBtn.addEventListener("click", ()=>setReady("p1"));
  p2ReadyBtn.addEventListener("click", ()=>setReady("p2"));
  startBtn.addEventListener("click", startGame);

  p1SubmitBtn.addEventListener("click", ()=>submitGuess("p1"));
  p2SubmitBtn.addEventListener("click", ()=>submitGuess("p2"));

  p1GuessEl.addEventListener("keyup", (e)=>{ if(e.key==="Enter") submitGuess("p1"); });
  p2GuessEl.addEventListener("keyup", (e)=>{ if(e.key==="Enter") submitGuess("p2"); });

  toggleP1Btn.addEventListener("click", ()=>{ p1secretEl.type = p1secretEl.type==="password" ? "text" : "password"; });
  toggleP2Btn.addEventListener("click", ()=>{ p2secretEl.type = p2secretEl.type==="password" ? "text" : "password"; });

  resetBtn.addEventListener("click", resetRoom);
});
