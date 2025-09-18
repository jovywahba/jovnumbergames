// Easier online flow: auto-roles, auto-ready, auto-start
import { db, doc, getDoc, setDoc, updateDoc, onSnapshot, serverTimestamp, runTransaction } from './firebase.js';

const $ = (id) => document.getElementById(id);

// ===== Local identity & role =====
const MY_ID_KEY = 'guess3_my_id';
function getMyId(){
  let id = sessionStorage.getItem(MY_ID_KEY);
  if(!id){
    id = 'u_' + Math.random().toString(36).slice(2, 10);
    sessionStorage.setItem(MY_ID_KEY, id);
  }
  return id;
}
let myId = getMyId();
let myRole = 'spectator'; // 'p1' | 'p2' | 'spectator'

// ===== Helpers =====
function onlyDigits3(s){ return /^\d{3}$/.test(s); }
function hasUniqueDigits(s){ return new Set(s.split('')).size === s.length; }
function bulls(a,b){ let c=0; for(let i=0;i<3;i++) if(a[i]===b[i]) c++; return c; }

// ===== DOM =====
const roomIdEl = $('roomId');
const joinBtn = $('joinBtn');
const leaveBtn = $('leaveBtn');
const copyLinkBtn = $('copyLink');
const allowRepeatsEl = $('allowRepeats');

const yourRoleEl = $('yourRole');

const p1secretEl = $('p1secret');
const p2secretEl = $('p2secret');
const toggleP1Btn = $('toggleP1');
const toggleP2Btn = $('toggleP2');

const startBtn = $('startBtn');
const resetBtn = $('resetBtn');

const revealP1Val = $('revealP1Val');
const revealP2Val = $('revealP2Val');

const p1GuessEl = $('p1guess');
const p2GuessEl = $('p2guess');
const p1SubmitBtn = $('p1Submit');
const p2SubmitBtn = $('p2Submit');

const roundNo = $('roundNo');
const p1Tries = $('p1Tries');
const p2Tries = $('p2Tries');
const roomStatus = $('roomStatus');
const p1HistoryTbody = $('p1History');
const p2HistoryTbody = $('p2History');
const gameStatus = $('gameStatus');
const winnerArea = $('winnerArea');

// ===== Firestore refs =====
let roomRef = null;
let unsub = null;
let lastSnap = null;

// ===== Room model =====
function blankRoom(roomId){
  return {
    roomId,
    createdAt: serverTimestamp(),
    status: 'idle',                 // idle -> ready -> playing -> finished
    allowRepeats: false,
    round: 0,
    // participants
    p1Id: null, p2Id: null,
    // secrets + readiness
    p1Secret: '', p2Secret: '',
    p1Ready: false, p2Ready: false,
    // per-round
    current: { p1Guess: null, p2Guess: null },
    history: [],
    winner: null
  };
}

// ===== Render =====
function render(data){
  const {
    status='idle', round=0, allowRepeats=false,
    p1Secret='', p2Secret='',
    p1Ready=false, p2Ready=false,
    p1Id=null, p2Id=null,
    current={ p1Guess:null, p2Guess:null },
    history=[], winner=null
  } = data || {};

  // compute my role
  myRole = (myId && myId===p1Id) ? 'p1' : (myId && myId===p2Id) ? 'p2' : 'spectator';
  yourRoleEl.textContent = myRole.toUpperCase();

  allowRepeatsEl.checked = !!allowRepeats;
  roundNo.textContent = round;
  p1Tries.textContent = history.filter(h=>h.p1Guess!=null).length;
  p2Tries.textContent = history.filter(h=>h.p2Guess!=null).length;
  roomStatus.textContent = status;

  // secrets preview (for dev/simple play)
  revealP1Val.textContent = p1Secret ? p1Secret : '•••';
  revealP2Val.textContent = p2Secret ? p2Secret : '•••';

  // input enablement
  const inIdle = status==='idle';
  const canGuess = status==='playing';

  allowRepeatsEl.disabled = !inIdle || myRole!=='p1';

  // Only enable YOUR secret field while idle
  p1secretEl.disabled = !inIdle || myRole!=='p1';
  p2secretEl.disabled = !inIdle || myRole!=='p2';

  startBtn.disabled = !(status==='ready' && myRole==='p1');
  resetBtn.disabled = !(status==='finished' || status==='ready' || status==='playing');

  // Guessing is per-role, per-round
  p1GuessEl.disabled = !(canGuess && myRole==='p1' && current.p1Guess==null);
  p2GuessEl.disabled = !(canGuess && myRole==='p2' && current.p2Guess==null);
  p1SubmitBtn.disabled = p1GuessEl.disabled;
  p2SubmitBtn.disabled = p2GuessEl.disabled;

  // status line
  if(status==='idle'){
    const need = [
      myRole==='p1' && !p1Ready ? 'Type your P1 secret' : null,
      myRole==='p2' && !p2Ready ? 'Type your P2 secret' : null,
      (myRole==='spectator') ? 'Waiting for players to join' : null
    ].filter(Boolean).join(' • ') || 'Waiting for both secrets…';
    gameStatus.innerHTML = `<span class="tag tag-info">Idle</span> ${need}`;
  }else if(status==='ready'){
    gameStatus.innerHTML = `<span class="tag tag-info">Ready</span> Both secrets set. P1 can start (auto-start soon).`;
  }else if(status==='playing'){
    const need = [
      current.p1Guess==null ? 'P1 to guess' : null,
      current.p2Guess==null ? 'P2 to guess' : null
    ].filter(Boolean).join(' • ') || 'Both guessed — resolving…';
    gameStatus.innerHTML = `<span class="tag tag-info">Round ${round}</span> ${need}`;
  }else if(status==='finished'){
    if(winner==='p1') gameStatus.innerHTML = `<span class="tag tag-ok">Game over</span> Player 1 wins 👑`;
    else if(winner==='p2') gameStatus.innerHTML = `<span class="tag tag-bad">Game over</span> Player 2 wins 👑`;
    else gameStatus.innerHTML = `<span class="tag tag-info">Game over</span> Draw — both got 3 bulls same round.`;
  }else{
    gameStatus.textContent = '—';
  }

  // tables
  p1HistoryTbody.innerHTML = '';
  p2HistoryTbody.innerHTML = '';
  for(const h of history){
    const tr1 = document.createElement('tr');
    tr1.innerHTML = `<td>${h.round}</td><td class="reveal">${h.p1Guess ?? '—'}</td><td>${h.p1Bulls ?? '—'}</td>`;
    p1HistoryTbody.appendChild(tr1);

    const tr2 = document.createElement('tr');
    tr2.innerHTML = `<td>${h.round}</td><td class="reveal">${h.p2Guess ?? '—'}</td><td>${h.p2Bulls ?? '—'}</td>`;
    p2HistoryTbody.appendChild(tr2);
  }

  // winner banner
  winnerArea.innerHTML = '';
  if(status==='finished'){
    const div = document.createElement('div');
    const cls = winner==='draw' ? 'warn' : (winner==='p1' ? 'ok' : 'bad');
    div.className = `winner ${cls}`;
    div.innerHTML = winner==='draw'
      ? `⚖️ Draw! P1 secret: <b class="reveal">${p1Secret}</b> — P2 secret: <b class="reveal">${p2Secret}</b>`
      : winner==='p1'
        ? `🎉 Player 1 wins! P2 secret was: <b class="reveal">${p2Secret}</b>`
        : `🎉 Player 2 wins! P1 secret was: <b class="reveal">${p1Secret}</b>`;
    winnerArea.appendChild(div);
  }
}

// ===== Join / role claim =====
async function joinRoom(){
  // room from query ?room=xxx if present
  const urlParams = new URLSearchParams(location.search);
  const paramRoom = urlParams.get('room');
  const id = (roomIdEl.value.trim() || paramRoom || '').slice(0,24);
  if(!id){ alert('Enter a Room ID'); return; }
  roomIdEl.value = id;

  roomRef = doc(db, 'rooms', id);
  await runTransaction(db, async (tr)=>{
    const snap = await tr.get(roomRef);
    let data;
    if(!snap.exists()){
      data = blankRoom(id);
      // first joiner becomes P1
      data.p1Id = myId;
      tr.set(roomRef, data);
      return;
    }else{
      data = snap.data();
      // claim a slot if available
      if(!data.p1Id) data.p1Id = myId;
      else if(!data.p2Id && data.p1Id!==myId) data.p2Id = myId;
      tr.set(roomRef, data, { merge: true });
    }
  });

  if(unsub) unsub();
  unsub = onSnapshot(roomRef, (s)=>{
    lastSnap = s;
    const data = s.data();
    render(data);
    // Auto-start: only P1 triggers to avoid race
    if(data?.status==='ready' && myRole==='p1'){
      startGame(true).catch(()=>{ /* ignore */ });
    }
    // Auto-resolve: only P1 acts as leader
    if(data?.status==='playing' && myRole==='p1'){
      maybeResolveRoundAsLeader(data).catch(console.error);
    }
  });

  joinBtn.disabled = true;
  leaveBtn.disabled = false;
  resetBtn.disabled = false;

  // update URL with ?room=ID for easy sharing
  const url = new URL(location.href);
  url.searchParams.set('room', id);
  history.replaceState(null, '', url.toString());
}

async function leaveRoom(){
  if(unsub) unsub();
  unsub = null;
  roomRef = null;
  lastSnap = null;
  yourRoleEl.textContent = '—';

  joinBtn.disabled = false;
  leaveBtn.disabled = true;
  resetBtn.disabled = true;
  render(blankRoom(''));
}

// ===== Secrets (auto-ready on valid 3 digits) =====
async function setSecretAuto(player){
  if(!roomRef || !lastSnap) return;
  const data = lastSnap.data();
  if(!data || data.status!=='idle') return;

  const allow = !!data.allowRepeats;
  const val = player==='p1' ? p1secretEl.value.trim() : p2secretEl.value.trim();
  if(!onlyDigits3(val)) return; // wait until 3 digits

  if(!allow && !hasUniqueDigits(val)){
    alert('Digits must be unique (toggle "Allow repeated digits" if you want repeats).');
    return;
  }

  await runTransaction(db, async (tr)=>{
    const cur = await tr.get(roomRef);
    const d = cur.data();
    if(!d || d.status!=='idle') return;

    if(player==='p1' && myRole==='p1'){
      d.p1Secret = val; d.p1Ready = true;
    }
    if(player==='p2' && myRole==='p2'){
      d.p2Secret = val; d.p2Ready = true;
    }
    // move to ready if both prepared
    if(d.p1Ready && d.p2Ready) d.status = 'ready';
    tr.set(roomRef, d);
  });
}

// ===== Start / Reset =====
async function startGame(auto=false){
  if(!roomRef || myRole!=='p1') return;
  await runTransaction(db, async (tr)=>{
    const cur = await tr.get(roomRef);
    const d = cur.data();
    if(!d) return;
    if(d.status!=='ready') return;
    d.status = 'playing';
    d.round = 1;
    d.current = { p1Guess: null, p2Guess: null };
    d.history = [];
    d.winner = null;
    tr.set(roomRef, d);
  });
  if(!auto) gameStatus.innerHTML = `<span class="tag tag-info">Round 1</span> Game started!`;
}

async function resetRoom(){
  if(!roomRef || !lastSnap) return;
  const keep = lastSnap.data();
  await runTransaction(db, async (tr)=>{
    const cur = await tr.get(roomRef);
    if(!cur.exists()) return;
    const d = cur.data();
    // keep participants & repeats flag
    const next = {
      ...blankRoom(cur.id),
      allowRepeats: !!d.allowRepeats,
      p1Id: d.p1Id || null,
      p2Id: d.p2Id || null
    };
    tr.set(roomRef, next);
  });
}

// ===== Guessing =====
async function submitGuess(player){
  if(!roomRef || !lastSnap) return;
  const data = lastSnap.data();
  if(!data || data.status!=='playing') return;

  const allow = !!data.allowRepeats;
  const input = player==='p1' ? p1GuessEl : p2GuessEl;
  const g = input.value.trim();

  if(!onlyDigits3(g)){ alert('Enter exactly 3 digits.'); return; }
  if(!allow && !hasUniqueDigits(g)){ alert('Digits must be unique (turn on repeats if needed).'); return; }

  if(player==='p1' && myRole!=='p1') return;
  if(player==='p2' && myRole!=='p2') return;

  const payload = player==='p1' ? { 'current.p1Guess': g } : { 'current.p2Guess': g };
  await updateDoc(roomRef, payload);
  input.value = '';
}

// ===== Round resolution (P1 leads) =====
async function maybeResolveRoundAsLeader(data){
  const { current, status } = data;
  if(status!=='playing') return;
  if(current.p1Guess==null || current.p2Guess==null) return;

  await runTransaction(db, async (tr)=>{
    const cur = await tr.get(roomRef);
    const d = cur.data();
    if(!d || d.status!=='playing') return;
    if(d.current.p1Guess==null || d.current.p2Guess==null) return;

    const p1B = bulls(d.current.p1Guess, d.p2Secret);
    const p2B = bulls(d.current.p2Guess, d.p1Secret);

    const entry = {
      round: d.round,
      p1Guess: d.current.p1Guess, p1Bulls: p1B,
      p2Guess: d.current.p2Guess, p2Bulls: p2B
    };
    const nextHistory = [...(d.history || []), entry];

    let winner = null;
    if(p1B===3 && p2B===3) winner = 'draw';
    else if(p1B===3) winner = 'p1';
    else if(p2B===3) winner = 'p2';

    if(winner){
      tr.update(roomRef, {
        history: nextHistory,
        status: 'finished',
        winner,
        'current.p1Guess': null,
        'current.p2Guess': null
      });
    }else{
      tr.update(roomRef, {
        history: nextHistory,
        round: d.round + 1,
        'current.p1Guess': null,
        'current.p2Guess': null
      });
    }
  });
}

// ===== Events =====
document.addEventListener('DOMContentLoaded', ()=>{
  // Pre-fill room from ?room=...
  const urlParams = new URLSearchParams(location.search);
  const qRoom = urlParams.get('room');
  if(qRoom) roomIdEl.value = qRoom;

  render(blankRoom(''));

  joinBtn.addEventListener('click', joinRoom);
  leaveBtn.addEventListener('click', leaveRoom);
  copyLinkBtn.addEventListener('click', ()=>{
    const id = roomIdEl.value.trim();
    if(!id){ alert('Enter a Room ID first'); return; }
    const url = `${location.origin}${location.pathname}?room=${encodeURIComponent(id)}`;
    navigator.clipboard.writeText(url).then(()=> alert('Link copied! Share it with your friend.'));
  });

  allowRepeatsEl.addEventListener('change', async ()=>{
    if(!roomRef || myRole!=='p1') return;
    const snap = await getDoc(roomRef);
    if(snap.exists()){
      const d = snap.data();
      if(d.status==='idle'){
        await updateDoc(roomRef, { allowRepeats: !!allowRepeatsEl.checked });
      }
    }
  });

  // Secrets auto-ready when valid 3 digits
  p1secretEl.addEventListener('input', ()=> setSecretAuto('p1'));
  p2secretEl.addEventListener('input', ()=> setSecretAuto('p2'));

  startBtn.addEventListener('click', ()=> startGame(false));
  resetBtn.addEventListener('click', resetRoom);

  p1SubmitBtn.addEventListener('click', ()=> submitGuess('p1'));
  p2SubmitBtn.addEventListener('click', ()=> submitGuess('p2'));

  p1GuessEl.addEventListener('keyup', (e)=>{ if(e.key==='Enter') submitGuess('p1'); });
  p2GuessEl.addEventListener('keyup', (e)=>{ if(e.key==='Enter') submitGuess('p2'); });

  toggleP1Btn.addEventListener('click', ()=>{ p1secretEl.type = p1secretEl.type==='password' ? 'text' : 'password'; });
  toggleP2Btn.addEventListener('click', ()=>{ p2secretEl.type = p2secretEl.type==='password' ? 'text' : 'password'; });
});
