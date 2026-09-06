const APP_VERSION = "1.2.0";
const STORAGE_KEY = "tasmota_devices";
const BACKUPS_KEY = "tasmota_backups";
const MAX_BACKUPS = 10;
const PING_INTERVAL_MS = 20000;
const MAX_RELAYS = 8;

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
function escapeHtml(s){
  return s.replace(/[&<>"']/g, c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
}

// ---------- storage / safe-close ----------
function loadDevices(){
  try{
    const raw = localStorage.getItem(STORAGE_KEY);
    devices = raw ? JSON.parse(raw) : [];
  }catch(e){ devices = []; }
  // migración: dispositivos guardados antes del soporte multicanal (v1.1.0 y anteriores)
  devices.forEach(dev=>{
    if(!Array.isArray(dev.channels)){
      dev.relayCount = 1;
      dev.channels = [{ name: dev.name, lastCmd: dev.lastCmd || null, lastCmdTime: dev.lastCmdTime || null }];
      delete dev.lastCmd;
      delete dev.lastCmdTime;
    }
  });
  persist();
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
// respuesta llega "opaca". Por eso el estado que mostramos es el ULTIMO COMANDO
// ENVIADO por canal, no el estado real. "Power" a secas siempre apunta al rele 1;
// para el resto se usa Power2, Power3... hasta Power8.
function buildUrl(dev, cmnd){
  let url = `http://${dev.ip}/cm?cmnd=${encodeURIComponent(cmnd)}`;
  if(dev.user) url += `&user=${encodeURIComponent(dev.user)}`;
  if(dev.pass) url += `&password=${encodeURIComponent(dev.pass)}`;
  return url;
}
function relayToken(channelIndex){
  return channelIndex === 0 ? "Power" : `Power${channelIndex+1}`;
}
async function pingDevice(dev){
  try{
    await fetch(buildUrl(dev, "Power"), { mode: "no-cors", cache: "no-store" });
    dev._reachable = true;
  }catch(e){
    dev._reachable = false;
  }
  renderReach(dev);
}
async function sendCommand(dev, channelIndex, cmd){
  const ch = dev.channels[channelIndex];
  const group = document.querySelector(`.state-btns[data-id="${dev.id}"][data-ch="${channelIndex}"]`);
  if(group) group.classList.add("sending");
  try{
    await fetch(buildUrl(dev, `${relayToken(channelIndex)} ${cmd}`), { mode: "no-cors", cache: "no-store" });
    ch.lastCmd = cmd;
    ch.lastCmdTime = Date.now();
    dev._reachable = true;
  }catch(e){
    dev._reachable = false;
    toast(`No se pudo enviar el comando a ${ch.name}`);
  }
  if(group) group.classList.remove("sending");
  persist();
  renderChannel(dev, channelIndex);
  renderReach(dev);
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

    const channelsHtml = dev.channels.map((ch, i)=>`
      <div class="channel-row" data-ch="${i}">
        <div class="info">
          <div class="chname">${escapeHtml(ch.name)}</div>
          <div class="status" data-role="status">sin comandos enviados</div>
        </div>
        <div class="state-btns" data-id="${dev.id}" data-ch="${i}">
          <button class="state-btn on-btn" data-role="on">ON</button>
          <button class="state-btn off-btn" data-role="off">OFF</button>
        </div>
      </div>
    `).join("");

    el.innerHTML = `
      <div class="devHead">
        <div>
          <span class="name">${escapeHtml(dev.name)}</span>
          <span class="ip"> · ${escapeHtml(dev.ip)}</span>
        </div>
        <div style="display:flex; align-items:center; gap:8px;">
          <span class="reach unknown" data-role="reach">verificando...</span>
          <button class="editBtn" data-role="edit">✎</button>
        </div>
      </div>
      ${channelsHtml}
    `;
    list.appendChild(el);

    dev.channels.forEach((ch, i)=>{
      el.querySelector(`.state-btns[data-ch="${i}"] [data-role="on"]`)
        .addEventListener("click", ()=>sendCommand(dev, i, "On"));
      el.querySelector(`.state-btns[data-ch="${i}"] [data-role="off"]`)
        .addEventListener("click", ()=>sendCommand(dev, i, "Off"));
    });
    el.querySelector('[data-role="edit"]').addEventListener("click", ()=>openSheet(dev));
  });
  devices.forEach(dev=>{
    dev.channels.forEach((_, i)=>renderChannel(dev, i));
    renderReach(dev);
  });
}
function renderChannel(dev, channelIndex){
  const el = document.querySelector(`.device[data-id="${dev.id}"] .channel-row[data-ch="${channelIndex}"]`);
  if(!el) return;
  const ch = dev.channels[channelIndex];
  const status = el.querySelector('[data-role="status"]');
  const onBtn = el.querySelector('[data-role="on"]');
  const offBtn = el.querySelector('[data-role="off"]');

  onBtn.classList.toggle("active", ch.lastCmd === "On");
  offBtn.classList.toggle("active", ch.lastCmd === "Off");

  if(ch.lastCmd){
    status.textContent = `${ch.lastCmd === "On" ? "Encendido" : "Apagado"} (asumido) · ${timeAgo(ch.lastCmdTime)}`;
    status.className = "status " + (ch.lastCmd === "On" ? "on" : "off");
  } else {
    status.textContent = "sin comandos enviados";
    status.className = "status off";
  }
}
function renderReach(dev){
  const el = document.querySelector(`.device[data-id="${dev.id}"] [data-role="reach"]`);
  if(!el) return;
  if(dev._reachable === true){
    el.textContent = "conectado";
    el.className = "reach ok";
  } else if(dev._reachable === false){
    el.textContent = "sin respuesta";
    el.className = "reach bad";
  } else {
    el.textContent = "verificando...";
    el.className = "reach unknown";
  }
}

// ---------- sheet (add/edit) ----------
function renderChannelNameInputs(count, existingNames){
  const container = document.getElementById("channelNamesContainer");
  if(count <= 1){
    container.innerHTML = "";
    return;
  }
  let html = "";
  for(let i=0;i<count;i++){
    const val = existingNames && existingNames[i] ? existingNames[i] : "";
    html += `<label>Nombre canal ${i+1} (Power${i+1===1?"":i+1})</label>
      <input class="chNameInput" data-idx="${i}" value="${escapeHtml(val)}" placeholder="Ej: Canal ${i+1}" autocomplete="off">`;
  }
  container.innerHTML = html;
}
function openSheet(dev){
  editingId = dev ? dev.id : null;
  document.getElementById("sheetTitle").textContent = dev ? "Editar dispositivo" : "Nuevo dispositivo";
  document.getElementById("fName").value = dev ? dev.name : "";
  document.getElementById("fIp").value = dev ? dev.ip : "";
  document.getElementById("fUser").value = dev ? (dev.user||"") : "";
  document.getElementById("fPass").value = dev ? (dev.pass||"") : "";
  const relayCount = dev ? dev.channels.length : 1;
  document.getElementById("fRelayCount").value = relayCount;
  renderChannelNameInputs(relayCount, dev ? dev.channels.map(c=>c.name) : null);
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
  let relayCount = parseInt(document.getElementById("fRelayCount").value, 10) || 1;
  relayCount = Math.min(Math.max(relayCount, 1), MAX_RELAYS);

  if(!name || !ip){
    toast("Completá nombre e IP");
    return;
  }

  let channels;
  if(relayCount === 1){
    const prevSingle = editingId ? devices.find(d=>d.id===editingId) : null;
    const prevChan = prevSingle && prevSingle.channels && prevSingle.channels.length===1 ? prevSingle.channels[0] : null;
    channels = [{ name, lastCmd: prevChan ? prevChan.lastCmd : null, lastCmdTime: prevChan ? prevChan.lastCmdTime : null }];
  } else {
    const prev = editingId ? devices.find(d=>d.id===editingId) : null;
    channels = [];
    document.querySelectorAll(".chNameInput").forEach((input, i)=>{
      const chName = input.value.trim() || `Canal ${i+1}`;
      const prevCh = prev && prev.channels && prev.channels[i] ? prev.channels[i] : null;
      channels.push({ name: chName, lastCmd: prevCh ? prevCh.lastCmd : null, lastCmdTime: prevCh ? prevCh.lastCmdTime : null });
    });
  }

  if(editingId){
    const dev = devices.find(d=>d.id===editingId);
    Object.assign(dev, { name, ip, user, pass, channels });
  } else {
    devices.push({ id: uid(), name, ip, user, pass, channels });
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
  document.getElementById("fRelayCount").addEventListener("input", (e)=>{
    let n = parseInt(e.target.value, 10) || 1;
    n = Math.min(Math.max(n,1), MAX_RELAYS);
    const dev = editingId ? devices.find(d=>d.id===editingId) : null;
    renderChannelNameInputs(n, dev ? dev.channels.map(c=>c.name) : null);
  });

  if("serviceWorker" in navigator){
    navigator.serviceWorker.register("sw.js").catch(()=>{});
  }
});
