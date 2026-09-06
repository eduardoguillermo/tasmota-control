const APP_VERSION = "1.1.0";
const STORAGE_KEY = "tasmota_devices";
const BACKUPS_KEY = "tasmota_backups";
const MAX_BACKUPS = 10;
const PING_INTERVAL_MS = 20000;

let devices = [];
let editingId = null;
let pingTimer = null;

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
function timeAgo(ts){
  if(!ts) return "";
  const s = Math.floor((Date.now()-ts)/1000);
  if(s < 60) return "hace instantes";
  const m = Math.floor(s/60);
  if(m < 60) return `hace ${m} min`;
  const h = Math.floor(m/60);
  if(h < 24) return `hace ${h} h`;
  const d = Math.floor(h/24);
  return `hace ${d} d`;
}

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

// ---------- Tasmota HTTP (modo no-cors) ----------
// El firmware oficial de Tasmota no manda el header Access-Control-Allow-Origin,
// asi que no podemos LEER la respuesta desde un origen distinto (GitHub Pages).
// Con mode:"no-cors" el navegador SI manda el pedido (el rele cambia), pero la
// respuesta llega "opaca": no podemos saber si dio 200, 401 o 404.
// Por eso el estado que mostramos es el ULTIMO COMANDO ENVIADO, no el estado real
// del dispositivo. Si alguien lo prende/apaga por otro medio (boton fisico, HA,
// otra app), esta pantalla queda desactualizada hasta el proximo comando.
function buildUrl(dev, cmnd){
  let url = `http://${dev.ip}/cm?cmnd=${encodeURIComponent(cmnd)}`;
  if(dev.user) url += `&user=${encodeURIComponent(dev.user)}`;
  if(dev.pass) url += `&password=${encodeURIComponent(dev.pass)}`;
  return url;
}
async function pingDevice(dev){
  try{
    await fetch(buildUrl(dev, "Power"), { mode: "no-cors", cache: "no-store" });
    dev._reachable = true;
  }catch(e){
    dev._reachable = false;
  }
  renderDevice(dev);
}
async function sendCommand(dev, cmd){
  // cmd: "On" | "Off"
  const group = document.querySelector(`.state-btns[data-id="${dev.id}"]`);
  if(group) group.classList.add("sending");
  try{
    await fetch(buildUrl(dev, `Power ${cmd}`), { mode: "no-cors", cache: "no-store" });
    dev.lastCmd = cmd;
    dev.lastCmdTime = Date.now();
    dev._reachable = true;
  }catch(e){
    dev._reachable = false;
    toast(`No se pudo enviar el comando a ${dev.name}`);
  }
  if(group) group.classList.remove("sending");
  persist();
  renderDevice(dev);
}
function pingAll(){
  devices.forEach(pingDevice);
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
      <div class="info">
        <div class="name">${escapeHtml(dev.name)}</div>
        <div class="ip">${escapeHtml(dev.ip)}</div>
        <div class="status" data-role="status">sin comandos enviados</div>
        <div class="reach unknown" data-role="reach">verificando conexión...</div>
      </div>
      <div class="state-btns" data-id="${dev.id}">
        <button class="state-btn on-btn" data-role="on">ON</button>
        <button class="state-btn off-btn" data-role="off">OFF</button>
      </div>
    `;
    list.appendChild(el);
    el.querySelector('[data-role="on"]').addEventListener("click", ()=>sendCommand(dev,"On"));
    el.querySelector('[data-role="off"]').addEventListener("click", ()=>sendCommand(dev,"Off"));
    el.addEventListener("dblclick", (e)=>{
      if(e.target.closest(".state-btn")) return;
      openSheet(dev);
    });
  });
  devices.forEach(renderDevice);
}
function renderDevice(dev){
  const el = document.querySelector(`.device[data-id="${dev.id}"]`);
  if(!el) return;
  const status = el.querySelector('[data-role="status"]');
  const reach = el.querySelector('[data-role="reach"]');
  const onBtn = el.querySelector('[data-role="on"]');
  const offBtn = el.querySelector('[data-role="off"]');

  onBtn.classList.toggle("active", dev.lastCmd === "On");
  offBtn.classList.toggle("active", dev.lastCmd === "Off");

  if(dev.lastCmd){
    status.textContent = `${dev.lastCmd === "On" ? "Encendido" : "Apagado"} (asumido) · ${timeAgo(dev.lastCmdTime)}`;
    status.className = "status " + (dev.lastCmd === "On" ? "on" : "off");
  } else {
    status.textContent = "sin comandos enviados";
    status.className = "status off";
  }

  if(dev._reachable === true){
    reach.textContent = "conectado";
    reach.className = "reach ok";
  } else if(dev._reachable === false){
    reach.textContent = "sin respuesta de red";
    reach.className = "reach bad";
  } else {
    reach.textContent = "verificando conexión...";
    reach.className = "reach unknown";
  }
}
function escapeHtml(s){
  return s.replace(/[&<>"']/g, c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
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
    devices.push({ id: uid(), name, ip, user, pass, lastCmd: null, lastCmdTime: null });
  }
  persist();
  renderList();
  pingAll();
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
  pingAll();
  pingTimer = setInterval(pingAll, PING_INTERVAL_MS);
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
