// login.js

import { authReady } from "./firebase.js";
await authReady; // ensures persistence is set before you sign in/up


import {
  auth, onAuthStateChanged, signInWithEmailAndPassword
} from "./firebase.js";

const $ = (id)=>document.getElementById(id);
const banner = $("banner");
const emailEl = $("email");
const pwdEl = $("password");
const btn = $("loginBtn");
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

// If already signed in, jump to next/home
onAuthStateChanged(auth, (u)=>{
  if(u){
    const next = new URLSearchParams(location.search).get("next") || "home.html";
    location.replace(next);
  }
});

btn?.addEventListener("click", async ()=>{
  clearMsg();
  const email = (emailEl.value||"").trim();
  const pwd = (pwdEl.value||"").trim();
  if(!email || !pwd){ showMsg("Please enter email and password.", "bad"); return; }

  btn.disabled = true;
  try{
    await signInWithEmailAndPassword(auth, email, pwd);
    showMsg("Login successful! Redirecting…", "ok");
    const next = new URLSearchParams(location.search).get("next") || "home.html";
    setTimeout(()=> location.href = next, 500);
  }catch(e){
    let msg = e?.message || String(e);
    if(/invalid-credential|wrong-password/i.test(msg)) msg = "Incorrect email or password.";
    if(/user-not-found/i.test(msg)) msg = "No account with this email.";
    if(/too-many-requests/i.test(msg)) msg = "Too many attempts. Try again later.";
    showMsg(msg, "bad");
  }finally{
    btn.disabled = false;
  }
});

// Enter submits
[emailEl,pwdEl].forEach(el=>{
  el?.addEventListener("keyup",(ev)=>{ if(ev.key==="Enter") btn.click(); });
});
