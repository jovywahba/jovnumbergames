// signup.js

import { authReady } from "./firebase.js";
await authReady; // ensures persistence is set before you sign in/up


import {
  auth, createUserWithEmailAndPassword, updateProfile, sendEmailVerification,
  db, doc, setDoc, serverTimestamp
} from "./firebase.js";

const $ = (id)=>document.getElementById(id);
const banner = $("banner");
const emailEl = $("email");
const usernameEl = $("username");
const pwdEl = $("password");
const btn = $("signupBtn");
const toggle = $("togglePwd");

function showMsg(text, type="ok"){
  banner.className = "winner " + (type==="ok" ? "ok" : "bad");
  banner.innerHTML = text;
  banner.style.display = "block";
}
function clearMsg(){
  banner.style.display = "none";
  banner.innerHTML = "";
}

toggle?.addEventListener("click", ()=>{
  pwdEl.type = pwdEl.type === "password" ? "text" : "password";
});

btn?.addEventListener("click", async ()=>{
  clearMsg();
  const email = (emailEl.value||"").trim();
  const username = (usernameEl.value||"").trim();
  const pwd = (pwdEl.value||"").trim();

  if(!email || !username || !pwd){ showMsg("Please fill all fields.", "bad"); return; }
  if(pwd.length < 6){ showMsg("Password must be at least 6 characters.", "bad"); return; }

  btn.disabled = true;
  try{
    const cred = await createUserWithEmailAndPassword(auth, email, pwd);
    // Set display name
    await updateProfile(cred.user, { displayName: username });

    // Write/merge a user profile doc
    await setDoc(doc(db,"users", cred.user.uid), {
      name: username,
      email,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      totalWins: 0, totalLosses: 0, totalGames: 0,
      games: []
    }, { merge:true });

    // Optional: send verification (you can remove if not needed)
    try{ await sendEmailVerification(cred.user); }catch{}

    showMsg("Account created! Redirecting…", "ok");
    const next = new URLSearchParams(location.search).get("next") || "home.html";
    setTimeout(()=> location.href = next, 700);
  }catch(e){
    let msg = e?.message || String(e);
    // friendlier messages
    if(/email-already-in-use/i.test(msg)) msg = "This email is already in use.";
    if(/invalid-email/i.test(msg)) msg = "That email looks invalid.";
    if(/weak-password/i.test(msg)) msg = "Password is too weak.";
    showMsg(msg, "bad");
  }finally{
    btn.disabled = false;
  }
});

// Enter submits
[emailEl,usernameEl,pwdEl].forEach(el=>{
  el?.addEventListener("keyup",(ev)=>{ if(ev.key==="Enter") btn.click(); });
});
