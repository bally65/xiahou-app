/* 蝦猴採集 PWA — offline field capture. Hardened for mobile (HEIC re-encode, IDB ArrayBuffer, ungated save). */
'use strict';
const $ = id => document.getElementById(id);
const CONSENT_VER = 'consent_v1';
const RETAIN_MS = 30 * 86400000;
const MAXEDGE = 2000;            // cap long edge -> kills HEIC/12MP corruption + memory

/* ---------- IndexedDB ---------- */
let db;
function openDB(){return new Promise((res,rej)=>{const r=indexedDB.open('sbcv',1);
  r.onupgradeneeded=e=>{const d=e.target.result; if(!d.objectStoreNames.contains('records')) d.createObjectStore('records',{keyPath:'id'});};
  r.onsuccess=e=>{db=e.target.result;res();}; r.onerror=()=>rej(r.error);});}
function tx(m){return db.transaction('records',m).objectStore('records');}
function putRec(r){return new Promise((res,rej)=>{const q=tx('readwrite').put(r);q.onsuccess=res;q.onerror=()=>rej(q.error);});}
function allRecs(){return new Promise((res,rej)=>{const q=tx('readonly').getAll();q.onsuccess=()=>res(q.result||[]);q.onerror=()=>rej(q.error);});}
function getRec(id){return new Promise((res,rej)=>{const q=tx('readonly').get(id);q.onsuccess=()=>res(q.result);q.onerror=()=>rej(q.error);});}
function recBlob(r){ const buf=r.img_buf||r.img; return (buf instanceof Blob)?buf:new Blob([buf],{type:r.img_type||'image/jpeg'}); }

/* ---------- settings ---------- */
const S = JSON.parse(localStorage.getItem('sbcv_set')||'{}');
function loadSettings(){ $('sOp').value=S.op||''; $('sTeam').value=S.team||''; $('sZone').value=S.zone||'漢寶';
  $('sFrame').value=S.frame||30; $('frameCm').textContent=S.frame||30; refreshAssign(); lineStatusText(); }
function saveSettings(){ S.op=$('sOp').value.trim(); S.team=$('sTeam').value.trim(); S.zone=$('sZone').value;
  S.frame=parseFloat($('sFrame').value)||30; localStorage.setItem('sbcv_set',JSON.stringify(S));
  $('frameCm').textContent=S.frame; refreshAssign(); toast('設定已儲存'); show('capture'); }
function refreshAssign(){ $('assignline').textContent=`${S.op||'(未設姓名)'} · ${S.team||'(未設隊伍)'} · 區域 ${S.zone||'-'}`; }

/* ---------- nav ---------- */
function show(v){ ['capture','edit','list','trash','set'].forEach(x=>$('v-'+x).classList.toggle('hidden',x!==v));
  document.querySelectorAll('nav button').forEach(b=>b.classList.toggle('on',b.dataset.v===v));
  if(v==='list') renderList(); }
function showErr(m){ const e=$('errline'); if(m){e.textContent='⚠ '+m;e.classList.remove('hidden');} else e.classList.add('hidden'); }

/* ---------- consent ---------- */
function checkConsent(){ if(localStorage.getItem(CONSENT_VER)) return;
  $('consent').classList.remove('hidden'); $('agree').onchange=e=>{$('agreeBtn').disabled=!e.target.checked;}; }
function acceptConsent(){ localStorage.setItem(CONSENT_VER,new Date().toISOString()); $('consent').classList.add('hidden'); initLine(); }
function reConsent(){ localStorage.removeItem(CONSENT_VER); checkConsent(); }

/* ---------- LINE login (LIFF; optional, falls back to local mode) ---------- */
let lineProfile = JSON.parse(localStorage.getItem('sbcv_line')||'null');
function lineStatusText(){ const e=$('lineStatus'); if(!e)return; const cfg=window.SBCV_CONFIG||{};
  if(!cfg.liffId){ e.innerHTML='LINE:未設定(本機模式)— 見 config.js'; return; }
  if(lineProfile) e.innerHTML='LINE:已登入 '+lineProfile.displayName+' &nbsp;<a href="#" onclick="lineLogout();return false" style="color:#f4c87a">登出</a>';
  else e.innerHTML='LINE:未登入 &nbsp;<a href="#" onclick="showLineGate();return false" style="color:#4FB3A6">登入</a>'; }
function setLineUser(p){ lineProfile={userId:p.userId,displayName:p.displayName}; localStorage.setItem('sbcv_line',JSON.stringify(lineProfile));
  if(!S.op){ S.op=p.displayName; localStorage.setItem('sbcv_set',JSON.stringify(S)); if($('sOp'))$('sOp').value=p.displayName; refreshAssign(); }
  lineStatusText(); }
function showLineGate(){ $('lineGate').classList.remove('hidden'); }
function lineSkip(){ $('lineGate').classList.add('hidden'); }
async function lineLogin(){ const cfg=window.SBCV_CONFIG||{};
  if(!cfg.liffId){ alert('尚未設定 LIFF ID(見 config.js)'); return; }
  try{ if(!window.liff) throw new Error('LIFF SDK 未載入(需連網)');
    if(!liff.isLoggedIn()){ liff.login({redirectUri:location.href}); return; }
    const p=await liff.getProfile(); setLineUser(p); $('lineGate').classList.add('hidden'); toast('LINE 已登入:'+p.displayName);
  }catch(e){ alert('LINE 登入失敗:'+(e.message||e)); } }
function lineLogout(){ try{ if(window.liff&&liff.isLoggedIn&&liff.isLoggedIn()) liff.logout(); }catch(_){}
  lineProfile=null; localStorage.removeItem('sbcv_line'); lineStatusText(); toast('已登出 LINE'); }
async function initLine(){ const cfg=window.SBCV_CONFIG||{}; lineStatusText();
  if(!cfg.liffId) return;          // local mode (no LIFF configured)
  if(!window.liff) return;         // SDK offline -> keep cached profile / local
  try{ await liff.init({liffId:cfg.liffId});
    if(liff.isLoggedIn()){ const p=await liff.getProfile(); setLineUser(p); }
    else if(!lineProfile){ showLineGate(); }
  }catch(_){ /* offline/init fail -> cached or local */ } }

/* ---------- capture ---------- */
let cap=null, curType='shrimp';
$('file').addEventListener('change', async e=>{
  const f=e.target.files&&e.target.files[0]; e.target.value=''; if(!f) return;
  showErr(''); toast('處理照片中…');
  try{
    // decode (createImageBitmap handles HEIC on Safari + EXIF orientation), fallback to <img>
    let src, ow, oh;
    try{ const bmp=await createImageBitmap(f,{imageOrientation:'from-image'}); ow=bmp.width; oh=bmp.height; src=bmp; }
    catch(_){ const im=await blobToImage(f); ow=im.naturalWidth; oh=im.naturalHeight; src=im; }
    if(!ow||!oh) throw new Error('照片無法解碼(可能是 HEIC,試著在 iPhone 設定→相機→格式改「最相容 JPEG」)');
    // re-encode to capped JPEG -> clean, small, no corruption, works everywhere
    const sc=Math.min(1, MAXEDGE/Math.max(ow,oh));
    const cw=Math.round(ow*sc), ch=Math.round(oh*sc);
    const cv=document.createElement('canvas'); cv.width=cw; cv.height=ch; cv.getContext('2d').drawImage(src,0,0,cw,ch);
    const jpeg=await new Promise((rs,rj)=>cv.toBlob(b=>b?rs(b):rj(new Error('JPEG 轉檔失敗')),'image/jpeg',0.9));
    const dispW=Math.min(cw,1100), factor=cw/dispW, dispH=Math.round(ch/factor);
    cap={blob:jpeg, origW:cw, origH:ch, dispW, dispH, factor, _src:cv, gps:null, corners:[], gsd:null, points:[], frame_cm:parseFloat(S.frame)||30};
    const st=$('stage'); st.width=dispW; st.height=dispH; st.getContext('2d').drawImage(cv,0,0,dispW,dispH);
    if($('capFrame')) $('capFrame').value = S.frame||30;
    show('edit'); editScaleMode();
    // GPS (non-blocking, never blocks save)
    $('gpsPill').textContent='GPS…'; $('gpsPill').className='pill amber';
    if(navigator.geolocation) navigator.geolocation.getCurrentPosition(
      p=>{cap.gps={lat:p.coords.latitude,lon:p.coords.longitude,acc:p.coords.accuracy};
          $('gpsPill').textContent=`GPS ✓ ±${Math.round(p.coords.accuracy)}m`; $('gpsPill').className='pill ok';},
      ()=>{$('gpsPill').textContent='GPS 失敗(仍可存)'; $('gpsPill').className='pill red';},
      {enableHighAccuracy:true,timeout:9000,maximumAge:0});
    else { $('gpsPill').textContent='無 GPS'; $('gpsPill').className='pill red'; }
    // QR on the capped image
    try{ const d=cv.getContext('2d').getImageData(0,0,cw,ch);
      const code=window.jsQR&&jsQR(d.data,cw,ch);
      if(code&&code.data){ $('cell').value=code.data.trim(); $('qrPill').textContent='QR ✓ '+code.data.trim(); $('qrPill').className='pill ok'; }
      else { $('qrPill').textContent='無 QR(手填格號)'; $('qrPill').className='pill amber'; }
    }catch(_){ $('qrPill').textContent='QR—'; $('qrPill').className='pill amber'; }
    toast('照片已載入');
  }catch(err){ showErr(String(err.message||err)); toast('照片處理失敗'); show('capture'); }
});
function blobToImage(b){return new Promise((res,rej)=>{const u=URL.createObjectURL(b);const i=new Image();
  i.onload=()=>res(i); i.onerror=()=>rej(new Error('影像載入失敗')); i.src=u;});}

/* ---------- scale: tap 4 corners (optional) ---------- */
function editScaleMode(){ $('stepScale').classList.remove('hidden'); $('stepLabel').classList.add('hidden');
  $('editTitle').textContent='② 比例尺(可選)+ 標註'; drawStage();
  $('gsdPill').textContent='GSD —'; $('gsdPill').className='pill amber'; }
function resetCorners(){ if(!cap)return; cap.corners=[]; cap.gsd=null; drawStage();
  $('gsdPill').textContent='GSD —'; $('gsdPill').className='pill amber'; }
let stDown=null;
$('stage').addEventListener('pointerup', ev=>{ if(!cap)return; if(stDown&&Math.hypot(ev.clientX-stDown[0],ev.clientY-stDown[1])>10)return;
  const cv=$('stage'), r=cv.getBoundingClientRect();
  const x=(ev.clientX-r.left)/r.width*cv.width, y=(ev.clientY-r.top)/r.height*cv.height;
  if(cap.corners.length>=4) cap.corners=[]; cap.corners.push([x,y]); drawStage();
  if(cap.corners.length===4) computeGSD(); });
$('stage').addEventListener('pointerdown', ev=>{stDown=[ev.clientX,ev.clientY];});
function drawStage(){ const cv=$('stage'); if(!cap||!cap._src)return; const c=cv.getContext('2d');
  c.drawImage(cap._src,0,0,cv.width,cv.height); c.fillStyle='#ff3';
  cap.corners.forEach(([x,y],i)=>{c.beginPath();c.arc(x,y,8,0,7);c.fill();c.fillStyle='#000';c.font='bold 13px sans-serif';c.fillText(i+1,x-3,y+4);c.fillStyle='#ff3';}); }
function capFrameCm(){ return parseFloat($('capFrame')&&$('capFrame').value)||parseFloat(S.frame)||30; }
function computeGSD(){ const P=cap.corners.map(([x,y])=>[x*cap.factor,y*cap.factor]);
  const d=[]; for(let i=0;i<4;i++)for(let j=i+1;j<4;j++)d.push(Math.hypot(P[i][0]-P[j][0],P[i][1]-P[j][1]));
  d.sort((a,b)=>a-b); const meanSide=(d[0]+d[1]+d[2]+d[3])/4;
  cap.frame_cm=capFrameCm(); cap.gsd=cap.frame_cm/meanSide;
  $('gsdPill').textContent=`GSD ${cap.gsd.toFixed(4)} cm/px (框 ${cap.frame_cm}cm)`; $('gsdPill').className='pill ok'; }

/* ---------- label: pinch-zoom + tap ---------- */
let tf={s:1,tx:0,ty:0};
function goLabel(){ if(!cap)return; $('stepScale').classList.add('hidden'); $('stepLabel').classList.remove('hidden');
  $('editTitle').textContent='③ 標註洞口'; setType('shrimp');
  const cv=$('stage2'); cv.width=cap.dispW; cv.height=cap.dispH; tf={s:1,tx:0,ty:0}; applyTF(); drawLabel(); }
function backToScale(){ editScaleMode(); }
function setType(t){ curType=t; [['Shrimp','shrimp'],['Crab','crab'],['Other','other'],['Unsure','unsure']]
  .forEach(([k,v])=>{$('t'+k).style.outline=(v===t)?'3px solid #fff':'none';}); }
function applyTF(){ const e=$('stage2'); e.style.transformOrigin='0 0'; e.style.transform=`translate(${tf.tx}px,${tf.ty}px) scale(${tf.s})`; }
const COL={shrimp:'#E8D8B0',crab:'#f0b9c8',other:'#7fd',unsure:'#f4c87a'};
function drawLabel(){ const cv=$('stage2'),c=cv.getContext('2d'); c.drawImage(cap._src,0,0,cv.width,cv.height);
  cap.points.forEach(p=>{const x=p.x/cap.factor,y=p.y/cap.factor; c.beginPath();c.arc(x,y,6,0,7);
    c.strokeStyle=COL[p.type]||'#fff';c.lineWidth=2;c.stroke();c.beginPath();c.arc(x,y,2,0,7);c.fillStyle=COL[p.type];c.fill();});
  const n=t=>cap.points.filter(p=>p.type===t).length;
  $('cShrimp').textContent=n('shrimp'); $('cCrab').textContent=n('crab'); $('cOther').textContent=n('other'); $('cUnsure').textContent=n('unsure'); }
let ptrs=new Map(),startDist=0,startTF=null,moved=false,downPt=null;
const st2=$('stage2');
st2.addEventListener('pointerdown',e=>{st2.setPointerCapture(e.pointerId);ptrs.set(e.pointerId,[e.clientX,e.clientY]);moved=false;downPt=[e.clientX,e.clientY];
  if(ptrs.size===2){const v=[...ptrs.values()];startDist=Math.hypot(v[0][0]-v[1][0],v[0][1]-v[1][1]);startTF={...tf};}});
st2.addEventListener('pointermove',e=>{ if(!ptrs.has(e.pointerId))return; const prev=ptrs.get(e.pointerId); ptrs.set(e.pointerId,[e.clientX,e.clientY]);
  if(Math.hypot(e.clientX-downPt[0],e.clientY-downPt[1])>8)moved=true;
  if(ptrs.size===2){const v=[...ptrs.values()];const dist=Math.hypot(v[0][0]-v[1][0],v[0][1]-v[1][1]); tf.s=Math.max(1,Math.min(6,startTF.s*dist/startDist)); applyTF();}
  else if(ptrs.size===1&&tf.s>1){ tf.tx+=e.clientX-prev[0]; tf.ty+=e.clientY-prev[1]; applyTF(); }});
st2.addEventListener('pointerup',e=>{ ptrs.delete(e.pointerId); if(!moved&&ptrs.size===0) addOrRemove(e.clientX,e.clientY); });
function addOrRemove(cx,cy){ const r=st2.getBoundingClientRect();
  const x=(cx-r.left)/r.width*st2.width*cap.factor, y=(cy-r.top)/r.height*st2.height*cap.factor;
  const ri=cap.points.findIndex(p=>Math.hypot(p.x-x,p.y-y)<14*cap.factor);
  if(ri>=0)cap.points.splice(ri,1); else cap.points.push({x,y,type:curType}); drawLabel(); }

/* ---------- save (never blocked; surfaces errors) ---------- */
async function saveRecord(isZero){
  showErr('');
  if(!cap){ showErr('沒有照片可存,請先拍照'); return; }
  const cell=$('cell').value.trim();
  if(!cell){ showErr('請先填格號(上方欄位)'); show('edit'); editScaleMode(); $('cell').focus(); return; }
  try{
    if(isZero) cap.points=cap.points.filter(p=>p.type!=='shrimp');
    const n=t=>cap.points.filter(p=>p.type===t).length;
    const buf=await cap.blob.arrayBuffer();   // store ArrayBuffer (dodges iOS IDB Blob bug)
    const rec={ id:crypto.randomUUID(), ts:new Date().toISOString(),
      op:S.op||'', operator_line_id:(lineProfile&&lineProfile.userId)||'', team:S.team||'', zone:S.zone||'', cell, substrate:$('substrate').value,
      frame_cm:cap.frame_cm||capFrameCm(), gsd_cm_px:cap.gsd||null, gps:cap.gps||null,
      corners_orig_px:cap.corners.map(([x,y])=>[Math.round(x*cap.factor),Math.round(y*cap.factor)]),
      openings:cap.points.map(p=>({x_px:Math.round(p.x),y_px:Math.round(p.y),type:p.type})),
      count_shrimp:n('shrimp'), count_crab:n('crab'), count_other:n('other'), count_unsure:n('unsure'),
      is_zero:isZero, notes:$('notes').value.trim(),
      img_buf:buf, img_type:'image/jpeg', img_w:cap.origW, img_h:cap.origH,
      deleted:false, exported:false, app:'sbcv-pwa/0.4' };
    await putRec(rec);
    const back=await getRec(rec.id);                 // write-verify: confirm it really persisted
    if(!back || !(back.img_buf||back.img)) throw new Error('寫入後讀不到(裝置可能拒絕儲存空間)');
    const total=(await allRecs()).filter(r=>!r.deleted).length;
    cap=null; $('cell').value=''; $('notes').value='';
    toast(`${isZero?'已存(0 蝦猴)':'已儲存'} ✓ 共 ${total} 筆`); show('list');
  }catch(err){ showErr('儲存失敗:'+(err.message||err)+'(請截圖回報)'); }
}

/* ---------- list / soft-delete / undo / trash ---------- */
async function renderList(){ const recs=(await allRecs()).filter(r=>!r.deleted).sort((a,b)=>b.ts<a.ts?-1:1);
  $('listCount').textContent=`(${recs.length} 筆 · ${recs.filter(r=>!r.exported).length} 未備份)`;
  const box=$('recs'); box.innerHTML=''; if(!recs.length){box.innerHTML='<p class="muted">尚無紀錄</p>';return;}
  recs.forEach(r=>box.appendChild(recRow(r))); }
function recRow(r){ const d=document.createElement('div'); d.className='rec';
  const im=document.createElement('img'); try{im.src=URL.createObjectURL(recBlob(r));}catch(_){ } d.appendChild(im);
  const m=document.createElement('div'); m.className='meta';
  m.innerHTML=`<b>${r.cell}</b> · 蝦猴 ${r.count_shrimp}　<span class="pill ${r.gsd_cm_px?'ok':'amber'}">${r.gsd_cm_px?r.gsd_cm_px.toFixed(3)+' cm/px':'無比例'}</span><br>
    <small>${r.zone} · ${r.substrate} · ${new Date(r.ts).toLocaleString('zh-TW')} ${r.gps?'· GPS✓':'· 無GPS'} ${r.exported?'· 已備份':''}</small>`;
  d.appendChild(m);
  const ex=document.createElement('button'); ex.textContent='⬇️'; ex.className='sec'; ex.style.cssText='width:52px;margin:0'; ex.onclick=()=>exportOne(r.id); d.appendChild(ex);
  const del=document.createElement('button'); del.textContent='🗑'; del.className='danger'; del.style.cssText='width:52px;margin:0 0 0 8px'; del.onclick=()=>softDelete(r.id); d.appendChild(del);
  return d; }
async function softDelete(id){ const r=await getRec(id); r.deleted=true; r.deleted_at=new Date().toISOString(); await putRec(r); renderList();
  toast('已刪除',{label:'↩ 還原',fn:async()=>{const x=await getRec(id);x.deleted=false;delete x.deleted_at;await putRec(x);renderList();}}); }
async function showTrash(){ show('trash'); const recs=(await allRecs()).filter(r=>r.deleted);
  const box=$('trashList'); box.innerHTML=recs.length?'':'<p class="muted">垃圾桶空的</p>';
  recs.forEach(r=>{const d=document.createElement('div');d.className='rec';
    const im=document.createElement('img');try{im.src=URL.createObjectURL(recBlob(r));}catch(_){} d.appendChild(im);
    const m=document.createElement('div');m.className='meta';
    m.innerHTML=`<b>${r.cell}</b> · 蝦猴 ${r.count_shrimp}<br><small>刪於 ${new Date(r.deleted_at).toLocaleString('zh-TW')}</small>`;d.appendChild(m);
    const b=document.createElement('button');b.textContent='還原';b.className='sec';b.style.cssText='width:72px;margin:0';
    b.onclick=async()=>{r.deleted=false;delete r.deleted_at;await putRec(r);showTrash();toast('已還原');};d.appendChild(b); box.appendChild(d);}); }
async function purgeOld(){ const now=Date.now(); for(const r of await allRecs())
  if(r.deleted&&r.deleted_at&&now-Date.parse(r.deleted_at)>RETAIN_MS) tx('readwrite').delete(r.id); }

/* ---------- export ---------- */
function blobToB64(b){return new Promise(res=>{const fr=new FileReader();fr.onload=()=>res(fr.result);fr.readAsDataURL(b);});}
async function recJSON(r){ const o={...r}; delete o.img_buf; delete o.img; o.image_b64=await blobToB64(recBlob(r)); return o; }
async function exportOne(id){ const r=await getRec(id); download(`sbcv_${r.cell}_${r.id.slice(0,8)}.json`, JSON.stringify(await recJSON(r)));
  r.exported=true; await putRec(r); renderList(); }
async function exportAll(){ const recs=(await allRecs()).filter(r=>!r.deleted); if(!recs.length){toast('無紀錄');return;}
  const arr=[]; for(const r of recs) arr.push(await recJSON(r));
  download(`sbcv_backup_${new Date().toISOString().slice(0,10)}_${recs.length}筆.json`, JSON.stringify(arr));
  for(const r of recs){r.exported=true; await putRec(r);} renderList(); toast(`已匯出 ${recs.length} 筆`); }
function download(name,text){ const b=new Blob([text],{type:'application/json'}); const u=URL.createObjectURL(b);
  const a=document.createElement('a'); a.href=u; a.download=name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(()=>URL.revokeObjectURL(u),5000); }

/* ---------- toast ---------- */
let tT;
function toast(msg,action){ const t=$('toast'); t.innerHTML=''; const s=document.createElement('span'); s.textContent=msg; t.appendChild(s);
  if(action){const b=document.createElement('button');b.textContent=action.label;b.onclick=()=>{action.fn();t.classList.add('hidden');};t.appendChild(b);}
  t.classList.remove('hidden'); clearTimeout(tT); tT=setTimeout(()=>t.classList.add('hidden'), action?7000:2200); }

/* ---------- net ---------- */
function net(){ $('net').textContent=navigator.onLine?'🟢 線上':'🟠 離線(資料安全存本機)'; }
addEventListener('online',net); addEventListener('offline',net);

/* ---------- boot ---------- */
(async ()=>{ try{ if(navigator.storage&&navigator.storage.persist) navigator.storage.persist(); }catch(_){}
  try{ await openDB(); await purgeOld(); }catch(e){ showErr('資料庫開啟失敗:'+e); }
  loadSettings(); net(); checkConsent(); show('capture');
  if(localStorage.getItem(CONSENT_VER)) initLine(); })();
