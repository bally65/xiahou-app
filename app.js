/* 蝦猴採集 PWA — offline field capture (spike/MVP). Vanilla JS, no build. */
'use strict';
const $ = id => document.getElementById(id);
const CONSENT_VER = 'consent_v1';
const RETAIN_MS = 30 * 86400000;

/* ---------- IndexedDB ---------- */
let db;
function openDB(){return new Promise((res,rej)=>{const r=indexedDB.open('sbcv',1);
  r.onupgradeneeded=e=>{const d=e.target.result; if(!d.objectStoreNames.contains('records'))
    d.createObjectStore('records',{keyPath:'id'});};
  r.onsuccess=e=>{db=e.target.result;res();}; r.onerror=()=>rej(r.error);});}
function tx(mode){return db.transaction('records',mode).objectStore('records');}
function putRec(r){return new Promise((res,rej)=>{const q=tx('readwrite').put(r);q.onsuccess=res;q.onerror=()=>rej(q.error);});}
function allRecs(){return new Promise((res,rej)=>{const q=tx('readonly').getAll();q.onsuccess=()=>res(q.result||[]);q.onerror=()=>rej(q.error);});}
function getRec(id){return new Promise((res,rej)=>{const q=tx('readonly').get(id);q.onsuccess=()=>res(q.result);q.onerror=()=>rej(q.error);});}

/* ---------- settings ---------- */
const S = JSON.parse(localStorage.getItem('sbcv_set')||'{}');
function loadSettings(){ $('sOp').value=S.op||''; $('sTeam').value=S.team||''; $('sZone').value=S.zone||'漢寶';
  $('sFrame').value=S.frame||30; $('frameCm').textContent=S.frame||30; refreshAssign(); }
function saveSettings(){ S.op=$('sOp').value.trim(); S.team=$('sTeam').value.trim(); S.zone=$('sZone').value;
  S.frame=parseFloat($('sFrame').value)||30; localStorage.setItem('sbcv_set',JSON.stringify(S));
  $('frameCm').textContent=S.frame; refreshAssign(); toast('設定已儲存'); show('capture'); }
function refreshAssign(){ $('assignline').textContent=`${S.op||'(未設姓名)'} · ${S.team||'(未設隊伍)'} · 區域 ${S.zone||'-'}`; }

/* ---------- nav ---------- */
function show(v){ ['capture','edit','list','trash','set'].forEach(x=>$('v-'+x).classList.toggle('hidden',x!==v));
  document.querySelectorAll('nav button').forEach(b=>b.classList.toggle('on',b.dataset.v===v));
  if(v==='list') renderList(); }

/* ---------- consent ---------- */
function checkConsent(){ if(localStorage.getItem(CONSENT_VER)) return;
  $('consent').classList.remove('hidden');
  $('agree').onchange=e=>{$('agreeBtn').disabled=!e.target.checked;}; }
function acceptConsent(){ localStorage.setItem(CONSENT_VER,new Date().toISOString()); $('consent').classList.add('hidden'); }
function reConsent(){ localStorage.removeItem(CONSENT_VER); checkConsent(); }

/* ---------- capture state ---------- */
let cap = null; // {blob, origW, origH, dispW, dispH, factor, gps, corners[], gsd, points[], type}
let curType='shrimp';

$('file').addEventListener('change', async e=>{
  const f=e.target.files[0]; if(!f) return;
  const img=await blobToImage(f);
  const origW=img.naturalWidth, origH=img.naturalHeight;
  const dispW=Math.min(origW,1100), factor=origW/dispW, dispH=Math.round(origH/factor);
  cap={blob:f, origW, origH, dispW, dispH, factor, gps:null, corners:[], gsd:null, points:[], type:'shrimp'};
  // draw to stage
  const cv=$('stage'); cv.width=dispW; cv.height=dispH; cv.getContext('2d').drawImage(img,0,0,dispW,dispH);
  cap._img=img;
  $('cell').value = $('cell').value || '';
  show('edit'); editScaleMode();
  $('gpsPill').textContent='GPS…'; $('gpsPill').className='pill amber';
  $('qrPill').textContent='QR 掃描…'; $('qrPill').className='pill amber';
  // GPS
  navigator.geolocation && navigator.geolocation.getCurrentPosition(
    p=>{cap.gps={lat:p.coords.latitude,lon:p.coords.longitude,acc:p.coords.accuracy};
        $('gpsPill').textContent=`GPS ✓ ±${Math.round(p.coords.accuracy)}m`; $('gpsPill').className='pill ok';},
    ()=>{$('gpsPill').textContent='GPS 失敗'; $('gpsPill').className='pill red';},
    {enableHighAccuracy:true,timeout:9000,maximumAge:0});
  // QR (on a downscaled copy)
  try{ const qc=document.createElement('canvas'); const qs=Math.min(origW,900), qf=origW/qs;
    qc.width=qs; qc.height=Math.round(origH/qf); qc.getContext('2d').drawImage(img,0,0,qc.width,qc.height);
    const d=qc.getContext('2d').getImageData(0,0,qc.width,qc.height);
    const code=window.jsQR&&jsQR(d.data,qc.width,qc.height);
    if(code&&code.data){ $('cell').value=code.data.trim(); $('qrPill').textContent='QR ✓ '+code.data.trim(); $('qrPill').className='pill ok'; }
    else { $('qrPill').textContent='無 QR(手填格號)'; $('qrPill').className='pill amber'; }
  }catch(_){ $('qrPill').textContent='QR—'; }
  e.target.value='';
});
function blobToImage(b){return new Promise((res,rej)=>{const u=URL.createObjectURL(b);const i=new Image();
  i.onload=()=>{res(i);};i.onerror=rej;i.src=u;});}

/* ---------- scale: tap 4 corners ---------- */
function editScaleMode(){ $('stepScale').classList.remove('hidden'); $('stepLabel').classList.add('hidden');
  $('editTitle').textContent='② 確認比例尺'; drawStage(); $('toLabelBtn').disabled=true;
  $('gsdPill').textContent='GSD —'; $('gsdPill').className='pill amber'; }
function resetCorners(){ cap.corners=[]; cap.gsd=null; drawStage(); $('toLabelBtn').disabled=true;
  $('gsdPill').textContent='GSD —'; $('gsdPill').className='pill amber'; }
$('stage').addEventListener('click', ev=>{
  if(!cap) return; const cv=$('stage'), r=cv.getBoundingClientRect();
  const x=(ev.clientX-r.left)/r.width*cv.width, y=(ev.clientY-r.top)/r.height*cv.height;
  if(cap.corners.length>=4) cap.corners=[];
  cap.corners.push([x,y]); drawStage();
  if(cap.corners.length===4) computeGSD();
});
function drawStage(){ const cv=$('stage'); if(!cap||!cap._img) return;
  const c=cv.getContext('2d'); c.drawImage(cap._img,0,0,cv.width,cv.height);
  c.fillStyle='#ff3'; c.strokeStyle='#ff3'; c.lineWidth=2;
  cap.corners.forEach(([x,y],i)=>{c.beginPath();c.arc(x,y,7,0,7);c.fill();
    c.fillStyle='#000';c.font='12px sans-serif';c.fillText(i+1,x-3,y+4);c.fillStyle='#ff3';}); }
function computeGSD(){ // 4 corners (display px) -> mean side -> GSD in ORIGINAL cm/px
  const P=cap.corners.map(([x,y])=>[x*cap.factor,y*cap.factor]); // to original px
  const d=[]; for(let i=0;i<4;i++)for(let j=i+1;j<4;j++)d.push(Math.hypot(P[i][0]-P[j][0],P[i][1]-P[j][1]));
  d.sort((a,b)=>a-b); const meanSide=(d[0]+d[1]+d[2]+d[3])/4; // 4 smallest = sides, 2 largest = diagonals
  const frame=parseFloat(S.frame||30); cap.gsd=frame/meanSide; // cm per ORIGINAL px
  $('gsdPill').textContent=`GSD ${cap.gsd.toFixed(4)} cm/px`; $('gsdPill').className='pill ok';
  $('toLabelBtn').disabled=false; }

/* ---------- label: tap openings, pinch-zoom ---------- */
let tf={s:1,tx:0,ty:0};
function goLabel(){ $('stepScale').classList.add('hidden'); $('stepLabel').classList.remove('hidden');
  $('editTitle').textContent='③ 標註洞口'; setType('shrimp');
  const cv=$('stage2'); cv.width=cap.dispW; cv.height=cap.dispH; tf={s:1,tx:0,ty:0}; applyTF(); drawLabel(); }
function backToScale(){ editScaleMode(); }
function setType(t){ curType=t; ['Shrimp','Other','Unsure'].forEach(k=>{const b=$('t'+k);
  b.style.outline = (k.toLowerCase()===t)?'3px solid #fff':'none';}); }
function applyTF(){ $('stage2').style.transform=`translate(${tf.tx}px,${tf.ty}px) scale(${tf.s})`;
  $('stage2').style.transformOrigin='0 0'; }
function drawLabel(){ const cv=$('stage2'),c=cv.getContext('2d'); c.drawImage(cap._img,0,0,cv.width,cv.height);
  const col={shrimp:'#E8D8B0',other:'#7fd',unsure:'#f4c87a'};
  cap.points.forEach(p=>{const x=p.x/cap.factor,y=p.y/cap.factor; c.beginPath();c.arc(x,y,6,0,7);
    c.strokeStyle=col[p.type]||'#fff';c.lineWidth=2;c.stroke();
    c.beginPath();c.arc(x,y,2,0,7);c.fillStyle=col[p.type];c.fill();});
  $('cShrimp').textContent=cap.points.filter(p=>p.type==='shrimp').length;
  $('cOther').textContent=cap.points.filter(p=>p.type==='other').length;
  $('cUnsure').textContent=cap.points.filter(p=>p.type==='unsure').length; }
// pointer: pinch zoom / pan / tap-add
let ptrs=new Map(), startDist=0, startTF=null, moved=false, downPt=null;
const st2=$('stage2');
st2.addEventListener('pointerdown',e=>{st2.setPointerCapture(e.pointerId);ptrs.set(e.pointerId,[e.clientX,e.clientY]);
  moved=false; downPt=[e.clientX,e.clientY];
  if(ptrs.size===2){const v=[...ptrs.values()];startDist=Math.hypot(v[0][0]-v[1][0],v[0][1]-v[1][1]);startTF={...tf};}});
st2.addEventListener('pointermove',e=>{ if(!ptrs.has(e.pointerId))return; const prev=ptrs.get(e.pointerId);
  ptrs.set(e.pointerId,[e.clientX,e.clientY]);
  if(Math.hypot(e.clientX-downPt[0],e.clientY-downPt[1])>8) moved=true;
  if(ptrs.size===2){const v=[...ptrs.values()];const dist=Math.hypot(v[0][0]-v[1][0],v[0][1]-v[1][1]);
    tf.s=Math.max(1,Math.min(6,startTF.s*dist/startDist)); applyTF();}
  else if(ptrs.size===1 && tf.s>1){ tf.tx+=e.clientX-prev[0]; tf.ty+=e.clientY-prev[1]; applyTF(); }});
st2.addEventListener('pointerup',e=>{ ptrs.delete(e.pointerId);
  if(!moved && ptrs.size===0){ addOrRemovePoint(e.clientX,e.clientY); }});
function addOrRemovePoint(cx,cy){ const r=st2.getBoundingClientRect();
  const x=(cx-r.left)/r.width*st2.width*cap.factor, y=(cy-r.top)/r.height*st2.height*cap.factor; // orig px
  // remove if near existing
  const ri=cap.points.findIndex(p=>Math.hypot(p.x-x,p.y-y)< 12*cap.factor);
  if(ri>=0) cap.points.splice(ri,1); else cap.points.push({x,y,type:curType});
  drawLabel(); }

/* ---------- save ---------- */
async function saveRecord(isZero){
  if(!cap){return;}
  const cell=$('cell').value.trim();
  if(!cell){ alert('請填格號'); return; }
  if(isZero) cap.points=cap.points.filter(p=>p.type!=='shrimp');
  const rec={ id:crypto.randomUUID(), ts:new Date().toISOString(),
    op:S.op||'', team:S.team||'', zone:S.zone||'', cell, substrate:$('substrate').value,
    frame_cm:parseFloat(S.frame||30), gsd_cm_px:cap.gsd||null, gps:cap.gps||null,
    corners_orig_px:cap.corners.map(([x,y])=>[x*cap.factor,y*cap.factor]),
    openings:cap.points.map(p=>({x_px:Math.round(p.x),y_px:Math.round(p.y),type:p.type})),
    count_shrimp:cap.points.filter(p=>p.type==='shrimp').length,
    count_other:cap.points.filter(p=>p.type==='other').length,
    count_unsure:cap.points.filter(p=>p.type==='unsure').length,
    is_zero:isZero, notes:$('notes').value.trim(),
    img:cap.blob, img_w:cap.origW, img_h:cap.origH,
    deleted:false, exported:false, app:'sbcv-pwa/0.1' };
  await putRec(rec); cap=null; $('cell').value=''; $('notes').value='';
  toast(isZero?'已存(0 蝦猴)':'已儲存 ✓'); show('list');
}

/* ---------- list / detail / soft-delete / undo / trash ---------- */
async function renderList(){ const recs=(await allRecs()).filter(r=>!r.deleted).sort((a,b)=>b.ts<a.ts?-1:1);
  $('listCount').textContent=`(${recs.length} 筆 · ${recs.filter(r=>!r.exported).length} 未備份)`;
  const box=$('recs'); box.innerHTML=''; if(!recs.length){box.innerHTML='<p class="muted">尚無紀錄</p>';return;}
  recs.forEach(r=>box.appendChild(recRow(r))); }
function recRow(r){ const d=document.createElement('div'); d.className='rec';
  const im=document.createElement('img'); im.src=URL.createObjectURL(r.img); d.appendChild(im);
  const m=document.createElement('div'); m.className='meta';
  m.innerHTML=`<b>${r.cell}</b> · 蝦猴 ${r.count_shrimp}　<span class="pill ${r.gsd_cm_px?'ok':'amber'}">${r.gsd_cm_px?r.gsd_cm_px.toFixed(3)+' cm/px':'無比例'}</span><br>
    <small>${r.zone} · ${r.substrate} · ${new Date(r.ts).toLocaleString('zh-TW')} ${r.gps?'· GPS✓':'· 無GPS'} ${r.exported?'· 已備份':''}</small>`;
  d.appendChild(m);
  const ex=document.createElement('button'); ex.textContent='⬇️'; ex.className='sec'; ex.style.width='52px'; ex.style.margin=0;
  ex.onclick=()=>exportOne(r.id); d.appendChild(ex);
  const del=document.createElement('button'); del.textContent='🗑'; del.className='danger'; del.style.width='52px'; del.style.margin='0 0 0 8px';
  del.onclick=()=>softDelete(r.id); d.appendChild(del);
  return d; }
async function softDelete(id){ const r=await getRec(id); r.deleted=true; r.deleted_at=new Date().toISOString();
  await putRec(r); renderList(); toast('已刪除',{label:'↩ 還原',fn:async()=>{const x=await getRec(id);x.deleted=false;delete x.deleted_at;await putRec(x);renderList();}}); }
async function showTrash(){ show('trash'); const recs=(await allRecs()).filter(r=>r.deleted);
  const box=$('trashList'); box.innerHTML=recs.length?'':'<p class="muted">垃圾桶空的</p>';
  recs.forEach(r=>{const d=document.createElement('div');d.className='rec';
    const im=document.createElement('img');im.src=URL.createObjectURL(r.img);d.appendChild(im);
    const m=document.createElement('div');m.className='meta';
    m.innerHTML=`<b>${r.cell}</b> · 蝦猴 ${r.count_shrimp}<br><small>刪於 ${new Date(r.deleted_at).toLocaleString('zh-TW')}</small>`;d.appendChild(m);
    const b=document.createElement('button');b.textContent='還原';b.className='sec';b.style.width='72px';b.style.margin=0;
    b.onclick=async()=>{r.deleted=false;delete r.deleted_at;await putRec(r);showTrash();toast('已還原');};d.appendChild(b);
    box.appendChild(d);}); }
async function purgeOld(){ const now=Date.now(); for(const r of await allRecs())
  if(r.deleted&&r.deleted_at&&now-Date.parse(r.deleted_at)>RETAIN_MS){tx('readwrite').delete(r.id);} }

/* ---------- export (backup) ---------- */
function recToJSON(r,b64){ const o={...r}; delete o.img; o.image_b64=b64; return o; }
function blobToB64(b){return new Promise(res=>{const fr=new FileReader();fr.onload=()=>res(fr.result);fr.readAsDataURL(b);});}
async function exportOne(id){ const r=await getRec(id); const b64=await blobToB64(r.img);
  download(`sbcv_${r.cell}_${r.id.slice(0,8)}.json`, JSON.stringify(recToJSON(r,b64)));
  r.exported=true; await putRec(r); renderList(); }
async function exportAll(){ const recs=(await allRecs()).filter(r=>!r.deleted);
  if(!recs.length){toast('無紀錄');return;}
  const arr=[]; for(const r of recs){arr.push(recToJSON(r, await blobToB64(r.img)));}
  download(`sbcv_backup_${new Date().toISOString().slice(0,10)}_${recs.length}筆.json`, JSON.stringify(arr));
  for(const r of recs){r.exported=true; await putRec(r);} renderList(); toast(`已匯出 ${recs.length} 筆備份`); }
function download(name,text){ const b=new Blob([text],{type:'application/json'}); const u=URL.createObjectURL(b);
  const a=document.createElement('a'); a.href=u; a.download=name; a.click(); setTimeout(()=>URL.revokeObjectURL(u),4000); }

/* ---------- toast ---------- */
let toastTimer;
function toast(msg,action){ const t=$('toast'); t.innerHTML=''; const s=document.createElement('span'); s.textContent=msg; t.appendChild(s);
  if(action){const b=document.createElement('button');b.textContent=action.label;b.onclick=()=>{action.fn();t.classList.add('hidden');};t.appendChild(b);}
  t.classList.remove('hidden'); clearTimeout(toastTimer); toastTimer=setTimeout(()=>t.classList.add('hidden'), action?7000:2500); }

/* ---------- net ---------- */
function net(){ const n=$('net'); const on=navigator.onLine; n.textContent=on?'🟢 線上':'🟠 離線(資料安全存本機)'; }
addEventListener('online',net); addEventListener('offline',net);

/* ---------- boot ---------- */
(async ()=>{ await openDB(); await purgeOld(); loadSettings(); net(); checkConsent(); show('capture'); })();
