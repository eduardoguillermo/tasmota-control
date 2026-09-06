const APP_VERSION = "1.0.0";
const STORAGE_KEY = "tasmota_devices";
const BACKUPS_KEY = "tasmota_backups";
const MAX_BACKUPS = 10;

let devices = [];
let editingId = null;
let pollTimer = null;

// ---------- utils ----------
function pad(n){ return n.toString().padStart(2,"0"); }
function nowStr(){
  const d = new Date();
  return {
    date: `${pad(d.getDate())}/${pad(d.getMonth()+1)}/${d.getFullYear()}`,
    time: `${pad(d.getHours())}:${pad(d.getMinutes())}`
  };
}
function toast(msg){
  const t = document.getElementById("toast");
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(toast._h);
  toast._h = setTimeout(()=>t.classList.remove("show"), 2200);
}
function uid(){ return Date.now().toString(36) + Math.random().toString(36).slice(2,6); }

// ---------- storage / safe-close ----------
function loadDevices(){
  try{
    const raw = localStorage.getItem(STORAGE_KEY);
    devices = raw ? JSON.parse(raw) : [];
  }catch(e){ devices = []; }
}
function persist(){
  localStorage.setItem(STORAGE_KEY, JSON.stringify(devices));
}
function snapshot(){
  try{
    const raw = localStorage.getItem(BACKUPS_KEY);
    const backups = raw ? JSON.parse(raw) : [];
    backups.push({ t: Date.now(), devices });
    while(backups.length > MAX_BACKUPS) backups.shift();
    localStorage.setItem(BACKUPS_KEY, JSON.stringify(backups));
  }catch(e){ /* almacenamiento lleno u otro error, no bloquear cierre */ }
}
window.addEventListener("beforeunload", snapshot);
document.addEventListener("visibilitychange", ()=>{
  if(document.visibilityState === "hidden") snapshot();
});

// ---------- Tasmota HTTP ----------
function buildUrl(dev, cmnd){
  let url = `http://${dev.ip}/cm?cmnd=${encodeURIComponent(cmnd)}`;
  if(dev.user) url += `&user=${encodeURIComponent(dev.user)}`;
  if(dev.pass) url += `&password=${encodeURIComponent(dev.pass)}`;
  return url;
}
async function tasmotaGet(dev, cmnd){
  const res = await fetch(buildUrl(dev, cmnd), { mode: "cors", cache: "no-store" });
  if(!res.ok) throw new Error("HTTP " + res.status);
  return res.json();
}
async function refreshStatus(dev){
  try{
    const data = await tasmotaGet(dev, "Power");
    dev._state = data.POWER === "ON" ? "on" : "off";
    dev._err = false;
  }catch(e){
    dev._err = true;
  }
  renderDevice(dev);
}
async function toggleDevice(dev){
  const rocker = document.querySelector(`.rocker[data-id="${dev.id}"]`);
  if(rocker) rocker.classList.add("loading");
  try{
    const data = await tasmotaGet(dev, "Power TOGGLE");
    dev._state = data.POWER === "ON" ? "on" : "off";
    dev._err = false;
  }catch(e){
    dev._err = true;
    toast(`No se pudo conectar con ${dev.name}`);
  }
  if(rocker) rocker.classList.remove("loading");
  renderDevice(dev);
}

// ---------- render ----------
function renderList(){
  const list = document.getElementById("list");
  const empty = document.getElementById("emptyMsg");
  list.innerHTML = "";
  document.getElementById("deviceCount").textContent =
    `${devices.length} dispositivo${devices.length===1?"":"s"}`;
  if(devices.length === 0){
    empty.style.display = "block";
    return;
  }
  empty.style.display = "none";
  devices.forEach(dev=>{
    const el = document.createElement("div");
    el.className = "device";
    el.dataset.id = dev.id;
    el.innerHTML = `
      <div class="rocker" data-id="${dev.id}"><div class="bar"></div></div>
      <div class="info">
        <div class="name">${escapeHtml(dev.name)}</div>
        <div class="ip">${escapeHtml(dev.ip)}</div>
        <div class="status" data-role="status">verificando...</div>
      </div>
      <button class="menuBtn" data-id="${dev.id}">⋮</button>
    `;
    list.appendChild(el);
    el.querySelector(".rocker").addEventListener("click", ()=>toggleDevice(dev));
    el.querySelector(".menuBtn").addEventListener("click", ()=>openSheet(dev));
  });
}
function renderDevice(dev){
  const el = document.querySelector(`.device[data-id="${dev.id}"]`);
  if(!el) return;
  const rocker = el.querySelector(".rocker");
  const status = el.querySelector('[data-role="status"]');
  if(dev._err){
    rocker.classList.remove("on");
    status.textContent = "sin conexión";
    status.className = "status err";
  } else if(dev._state === "on"){
    rocker.classList.add("on");
    status.textContent = "encendido";
    status.className = "status on";
  } else {
    rocker.classList.remove("on");
    status.textContent = "apagado";
    status.className = "status off";
  }
}
function escapeHtml(s){
  return s.replace(/[&<>"']/g, c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
}
function refreshAll(){
  devices.forEach(refreshStatus);
}

// ---------- sheet (add/edit) ----------
function openSheet(dev){
  editingId = dev ? dev.id : null;
  document.getElementById("sheetTitle").textContent = dev ? "Editar dispositivo" : "Nuevo dispositivo";
  document.getElementById("fName").value = dev ? dev.name : "";
  document.getElementById("fIp").value = dev ? dev.ip : "";
  document.getElementById("fUser").value = dev ? (dev.user||"") : "";
  document.getElementById("fPass").value = dev ? (dev.pass||"") : "";
  document.getElementById("deleteDevice").style.display = dev ? "block" : "none";
  document.getElementById("overlay").style.display = "flex";
}
function closeSheet(){
  document.getElementById("overlay").style.display = "none";
  editingId = null;
}
function saveDevice(){
  const name = document.getElementById("fName").value.trim();
  const ip = document.getElementById("fIp").value.trim();
  const user = document.getElementById("fUser").value.trim();
  const pass = document.getElementById("fPass").value.trim();
  if(!name || !ip){
    toast("Completá nombre e IP");
    return;
  }
  if(editingId){
    const dev = devices.find(d=>d.id===editingId);
    Object.assign(dev, { name, ip, user, pass });
  } else {
    devices.push({ id: uid(), name, ip, user, pass });
  }
  persist();
  renderList();
  refreshAll();
  closeSheet();
}
function deleteDevice(){
  devices = devices.filter(d=>d.id!==editingId);
  persist();
  renderList();
  closeSheet();
}

// ---------- splash ----------
function updateSplashFooter(){
  const { date, time } = nowStr();
  document.getElementById("splashFooter").textContent =
    `tasmota-control · ${date} · ${time} · v${APP_VERSION}`;
}
function closeSplash(){
  document.getElementById("splash").style.display = "none";
  document.getElementById("app").style.display = "flex";
  loadDevices();
  renderList();
  refreshAll();
  pollTimer = setInterval(refreshAll, 15000);
}

// ---------- salir ----------
function doSalir(){
  snapshot();
  toast("Datos guardados localmente");
  setTimeout(()=>{
    document.getElementById("app").style.display = "none";
    document.getElementById("splash").style.display = "flex";
    document.getElementById("splash").innerHTML = `
      <h1>HASTA LUEGO</h1>
      <p>Podés cerrar esta pestaña</p>
    `;
  }, 500);
}

// ---------- init ----------
document.addEventListener("DOMContentLoaded", ()=>{
  updateSplashFooter();
  setInterval(updateSplashFooter, 30000);

  const splash = document.getElementById("splash");
  splash.addEventListener("click", closeSplash);
  document.addEventListener("keydown", (e)=>{
    if(e.key === "Enter" && splash.style.display !== "none") closeSplash();
  });

  document.getElementById("fab").addEventListener("click", ()=>openSheet(null));
  document.getElementById("cancelDevice").addEventListener("click", closeSheet);
  document.getElementById("saveDevice").addEventListener("click", saveDevice);
  document.getElementById("deleteDevice").addEventListener("click", deleteDevice);
  document.getElementById("salirBtn").addEventListener("click", doSalir);

  if("serviceWorker" in navigator){
    navigator.serviceWorker.register("sw.js").catch(()=>{});
  }
});
