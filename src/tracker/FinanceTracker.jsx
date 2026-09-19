import { useState, useEffect, useRef, useCallback, useId } from "react";
import { loadData, saveData, syncWhenOnline } from "../db";
import { isLockEnabled, isWebAuthnSupported, hasWebAuthnCredential, hasPin, enrollWebAuthn, setPin as setLockPin, disableLock } from "../lock";

const TABS = ["Dashboard", "Banks", "Investments", "Analytics", "Notes", "Settings"];
const COLORS_LIST = ["#3B82F6","#10B981","#F59E0B","#8B5CF6","#EC4899","#06B6D4","#F97316","#84CC16","#EF4444","#14B8A6"];
const BANK_COLOR_CHOICES = ["#3B82F6","#10B981","#F59E0B","#8B5CF6","#EC4899","#06B6D4","#F97316","#84CC16","#EF4444","#14B8A6","#A855F7","#64748B"];
const ENVELOPE_EMOJIS = ["🗂️","🏠","🚗","🍔","✈️","💊","🎁","💡","📚","👕","🎮","💰","🏦","❤️","🎓","🐶","☕","🛒","💳","🔧","🎵","🏖️","💼","📱"];
const UNALLOC_ID = "__unallocated__";
const MAX_HISTORY = 50;
const CURRENCY_SYMBOLS = { PHP:"₱", SGD:"S$", USD:"$", KRW:"₩", JPY:"¥", EUR:"€", GBP:"£", AUD:"A$", HKD:"HK$", MYR:"RM", IDR:"Rp", THB:"฿" };
const CURRENCY_LIST = Object.keys(CURRENCY_SYMBOLS);
const INVESTMENT_BUCKETS = ["Stocks","ETF","Crypto","Artwork","Watches","Real Estate","Companies","Bonds","Other"];
const BUCKET_ICONS = { Stocks:"📈", ETF:"📊", Crypto:"🪙", Artwork:"🖼️", Watches:"⌚", "Real Estate":"🏠", Companies:"🏢", Bonds:"📜", Other:"📦" };
function bucketColor(bucket){ const idx=INVESTMENT_BUCKETS.indexOf(bucket); return COLORS_LIST[Math.max(0,idx)%COLORS_LIST.length]; }
const VERSION = "v5.18.0";

function sym(c){ return CURRENCY_SYMBOLS[c]||(c?c+" ":""); }
const fmtNum = n => Number(n||0).toLocaleString("en-US",{minimumFractionDigits:2,maximumFractionDigits:2});
const r2 = n => Math.round((n+Number.EPSILON)*100)/100; // round to the cent to kill float drift from repeated balance +/-
const normalizeBanks = banks => (banks||[]).map(b=>({...b,balance:r2(b.balance||0),envelopes:(b.envelopes||[]).map(e=>({...e,balance:r2(e.balance||0)}))})); // one-time snap for balances carrying pre-fix float dust

// ── Toast: lightweight global pub/sub so any component can surface a message
// without prop-drilling a callback through the whole tree. ──
let toastListeners=[];
function toast(type,msg){toastListeners.forEach(fn=>fn({id:Date.now()+Math.random(),type,msg}));}
function DashboardSkeleton(){
  return(
    <div>
      <div className="skeleton" style={{height:80,marginBottom:16}}/>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12,marginBottom:16}}>
        <div className="skeleton" style={{height:74}}/>
        <div className="skeleton" style={{height:74}}/>
      </div>
      <div className="skeleton" style={{height:52,marginBottom:8}}/>
      <div className="skeleton" style={{height:52,marginBottom:8}}/>
      <div className="skeleton" style={{height:52}}/>
    </div>
  );
}
function ToastHost(){
  const[items,setItems]=useState([]);
  useEffect(()=>{
    const onToast=t=>{setItems(is=>[...is,t]);setTimeout(()=>setItems(is=>is.filter(x=>x.id!==t.id)),3200);};
    toastListeners.push(onToast);
    return()=>{toastListeners=toastListeners.filter(f=>f!==onToast);};
  },[]);
  if(!items.length)return null;
  return(
    <div style={{position:"fixed",bottom:16,left:"50%",transform:"translateX(-50%)",zIndex:500,display:"flex",flexDirection:"column",gap:8,alignItems:"center",pointerEvents:"none"}}>
      {items.map(t=>(
        <div key={t.id} className="toast-enter" style={{background:t.type==="error"?"#ef4444":t.type==="success"?"#10B981":T.text,color:t.type?"#fff":T.bg,padding:"10px 16px",borderRadius:10,fontSize:13,fontWeight:600,boxShadow:"0 4px 16px rgba(0,0,0,0.25)",maxWidth:"90vw",pointerEvents:"auto"}}>
          {t.type==="error"?"⚠️ ":t.type==="success"?"✓ ":""}{t.msg}
        </div>
      ))}
    </div>
  );
}
const SHEET_COLS=8;
const SHEET_INITIAL_ROWS=10;
const SHEET_MAX_ROWS=40;
function colLetter(i){return String.fromCharCode(65+i);}
function roundNum(n){return isFinite(n)?Math.round(n*10000)/10000:n;}
function evalSheetCell(cells,key,visiting,memo){
  if(memo.has(key))return memo.get(key);
  if(visiting.has(key)){memo.set(key,NaN);return NaN;}
  const raw=cells[key];
  if(raw===undefined||raw===""){memo.set(key,0);return 0;}
  if(typeof raw==="string"&&raw.trim().startsWith("=")){
    visiting.add(key);
    const val=evalSheetExpr(raw.trim().slice(1),cells,visiting,memo);
    visiting.delete(key);
    memo.set(key,val);
    return val;
  }
  const num=parseFloat(raw);
  const val=isNaN(num)?NaN:num;
  memo.set(key,val);
  return val;
}
function evalSheetExpr(expr,cells,visiting,memo){
  const tokens=expr.match(/[A-Za-z]+\d+|\d+\.?\d*|\.\d+|[+\-*/()]/g)||[];
  let pos=0;
  const peek=()=>tokens[pos];
  const next=()=>tokens[pos++];
  function parseExpr(){
    let val=parseTerm();
    while(peek()==="+"||peek()==="-"){const op=next();const rhs=parseTerm();val=op==="+"?val+rhs:val-rhs;}
    return val;
  }
  function parseTerm(){
    let val=parseFactor();
    while(peek()==="*"||peek()==="/"){const op=next();const rhs=parseFactor();val=op==="*"?val*rhs:(rhs===0?NaN:val/rhs);}
    return val;
  }
  function parseFactor(){
    if(peek()==="-"){next();return -parseFactor();}
    if(peek()==="+"){next();return parseFactor();}
    if(peek()==="("){next();const val=parseExpr();if(peek()===")")next();return val;}
    const tok=next();
    if(tok===undefined)return 0;
    if(/^[A-Za-z]+\d+$/.test(tok))return evalSheetCell(cells,tok.toUpperCase(),visiting,memo);
    const num=parseFloat(tok);
    return isNaN(num)?0:num;
  }
  if(tokens.length===0)return 0;
  return parseExpr();
}
function computeSheet(cells){
  const memo=new Map();const visiting=new Set();const out={};
  Object.keys(cells).forEach(key=>{out[key]=evalSheetCell(cells,key,visiting,memo);});
  return out;
}
function getCurrencyColor(currency){ const idx=CURRENCY_LIST.indexOf(currency); return COLORS_LIST[Math.max(0,idx)%COLORS_LIST.length]; }
function bankColor(b){ return b.color||getCurrencyColor(b.currency); }
function localDateStr(){ const d=new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`; }
function localDateTimeStr(d=new Date()){ return d.toLocaleString(undefined,{year:"numeric",month:"short",day:"numeric",hour:"2-digit",minute:"2-digit"}); }

const THEMES = {
  dark:{ bg:"#0f1117", card:"#1e2130", card2:"#0f1117", border:"#334155", text:"#f1f5f9", subtext:"#94a3b8", faint:"#475569", input:"#0f1117" },
  light:{ bg:"#f8fafc", card:"#ffffff", card2:"#f1f5f9", border:"#e2e8f0", text:"#0f172a", subtext:"#475569", faint:"#94a3b8", input:"#ffffff" }
};
let T = THEMES.light;

const rateCache={};
// Rate-service health, exposed as a tiny pub/sub hook so any component can
// tell "still converting" apart from "the exchange-rate API is down" instead
// of both looking like an endless "Converting…". A failed pair is never
// cached (only successes are), so the next render/retry always re-attempts
// the network instead of being stuck on a poisoned null forever.
let rateHealthy=true;
let rateHealthListeners=[];
function setRateHealthy(v){ if(v!==rateHealthy){rateHealthy=v;rateHealthListeners.forEach(f=>f(v));} }
function useRateHealth(){
  const[h,setH]=useState(rateHealthy);
  useEffect(()=>{const f=v=>setH(v);rateHealthListeners.push(f);return()=>{rateHealthListeners=rateHealthListeners.filter(x=>x!==f);};},[]);
  return h;
}
async function fetchRate(from,to){
  if(from===to)return 1;
  const key=`${from}_${to}`;
  if(rateCache[key]!==undefined)return rateCache[key];
  try{
    const ctrl=new AbortController();
    const timer=setTimeout(()=>ctrl.abort(),8000);
    const res=await fetch(`https://open.er-api.com/v6/latest/${from}`,{signal:ctrl.signal});
    clearTimeout(timer);
    const data=await res.json();
    const r=(data.result==="success"&&data.rates?.[to])?data.rates[to]:null;
    if(r!==null){Object.entries(data.rates||{}).forEach(([cur,val])=>{rateCache[`${from}_${cur}`]=val;});setRateHealthy(true);}
    else setRateHealthy(false);
    return r;
  }catch{setRateHealthy(false);return null;}
}
function useMultiConvert(items,target,retryTick=0){
  const[total,setTotal]=useState(null);
  useEffect(()=>{
    let active=true;
    (async()=>{let sum=0,ok=true;for(const it of items){const r=await fetchRate(it.currency,target);if(r===null){ok=false;break;}sum+=it.amount*r;}if(active)setTotal(ok?sum:null);})();
    return()=>{active=false;};
  // eslint-disable-next-line
  },[JSON.stringify(items),target,retryTick]);
  return total;
}
function useConvertedItems(items,target,retryTick=0){
  const[converted,setConverted]=useState(null);
  useEffect(()=>{
    let active=true;
    (async()=>{
      const out=[];let ok=true;
      for(const it of items){const r=await fetchRate(it.currency,target);if(r===null){ok=false;break;}out.push({...it,amount:it.amount*r});}
      if(active)setConverted(ok?out:null);
    })();
    return()=>{active=false;};
  // eslint-disable-next-line
  },[JSON.stringify(items),target,retryTick]);
  return converted;
}
function ConversionBadge({amount,fromCurrency,toCurrency,style}){
  const[rate,setRate]=useState(null);
  useEffect(()=>{if(fromCurrency!==toCurrency)fetchRate(fromCurrency,toCurrency).then(setRate);},[fromCurrency,toCurrency]);
  if(fromCurrency===toCurrency||rate===null)return null;
  return <span style={{fontSize:11,color:T.faint,marginLeft:8,...style}}>≈ {sym(toCurrency)}{fmtNum(amount*rate)} {toCurrency}</span>;
}
function useOnlineStatus(){
  const[online,setOnline]=useState(navigator.onLine);
  useEffect(()=>{const on=()=>setOnline(true);const off=()=>setOnline(false);window.addEventListener("online",on);window.addEventListener("offline",off);return()=>{window.removeEventListener("online",on);window.removeEventListener("offline",off);};},[]);
  return online;
}
function useUndoable(init){
  const[history,setHistory]=useState([init]);
  const[idx,setIdx]=useState(0);
  const val=history[idx];
  const set=useCallback((fn)=>{setHistory(h=>{const next=typeof fn==="function"?fn(h[idx]):fn;return[...h.slice(0,idx+1),next].slice(-MAX_HISTORY);});setIdx(i=>Math.min(i+1,MAX_HISTORY-1));},[idx]);
  const undo=useCallback(()=>setIdx(i=>Math.max(0,i-1)),[]);
  const redo=useCallback(()=>setIdx(i=>Math.min(history.length-1,i+1)),[history.length]);
  return[val,set,undo,redo,idx>0,idx<history.length-1];
}

function Modal({title,onClose,children,isDirty=false,zIndex=100}){
  const[askClose,setAskClose]=useState(false);
  const[closing,setClosing]=useState(false);
  const doClose=()=>{setClosing(true);setTimeout(onClose,110);};
  const requestClose=()=>{if(isDirty)setAskClose(true);else doClose();};
  if(askClose){
    return(
      <ConfirmModal message="You have unsaved changes." detail="Close anyway? Your edits in this form will be lost." confirmLabel="Close anyway" onConfirm={doClose} onClose={()=>setAskClose(false)} zIndex={zIndex+50}/>
    );
  }
  return(
    <div className={`modal-backdrop${closing?" closing":""}`} style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.6)",zIndex,display:"flex",alignItems:"center",justifyContent:"center"}} onClick={requestClose}>
      <div className="modal-panel" onClick={e=>e.stopPropagation()} style={{background:T.card,borderRadius:12,padding:24,minWidth:340,maxWidth:480,width:"90%",maxHeight:"85vh",overflowY:"auto"}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16}}>
          <strong style={{fontSize:16,color:T.text}}>{title}</strong>
          <button onClick={requestClose} style={{background:"none",border:"none",color:T.subtext,cursor:"pointer",fontSize:22,lineHeight:1,padding:8,minWidth:38,minHeight:38}}>×</button>
        </div>
        {children}
      </div>
    </div>
  );
}
function ConfirmModal({message,detail,confirmLabel="Delete",requireDel,onConfirm,onClose,zIndex=200}){
  const[val,setVal]=useState("");
  const ok=requireDel?val==="DEL":true;
  return(
    <Modal title="Please Confirm" onClose={onClose} isDirty={false} zIndex={zIndex}>
      <p style={{color:T.text,fontSize:14,marginBottom:8}}>{message}</p>
      {detail&&<p style={{color:T.subtext,fontSize:13,marginBottom:12}}>{detail}</p>}
      {requireDel&&<><p style={{color:T.subtext,fontSize:13,marginBottom:8}}>Type <strong style={{color:"#ef4444",letterSpacing:2}}>DEL</strong> to confirm.</p><input value={val} onChange={e=>setVal(e.target.value)} placeholder="Type DEL" autoFocus style={{width:"100%",background:T.input,border:`1px solid ${val==="DEL"?"#ef4444":T.border}`,borderRadius:8,padding:"8px 10px",color:T.text,fontSize:14,boxSizing:"border-box",marginBottom:12,letterSpacing:2}}/></>}
      <div style={{display:"flex",gap:8}}>
        <button onClick={onClose} style={{flex:1,background:"transparent",border:`1px solid ${T.border}`,color:T.subtext,borderRadius:8,padding:"8px",cursor:"pointer",fontSize:14}}>Cancel</button>
        <button onClick={()=>ok&&onConfirm()} disabled={!ok} style={{flex:1,background:ok?"#ef4444":"#2d1f1f",border:"1px solid #ef4444",color:ok?"#fff":"#7f3f3f",borderRadius:8,padding:"8px",cursor:ok?"pointer":"not-allowed",fontSize:14,fontWeight:600}}>{confirmLabel}</button>
      </div>
    </Modal>
  );
}
function FormError({msg}){ if(!msg)return null; return <div style={{background:"#ef444422",border:"1px solid #ef444466",borderRadius:8,padding:"8px 12px",marginBottom:12,fontSize:13,color:"#ef4444"}}>⚠️ {msg}</div>; }
function Inp({label,...p}){return(<div style={{marginBottom:12}}>{label&&<div style={{fontSize:12,color:T.subtext,marginBottom:4}}>{label}</div>}<input {...p} style={{width:"100%",background:T.input,border:`1px solid ${T.border}`,borderRadius:8,padding:"8px 10px",color:T.text,fontSize:14,boxSizing:"border-box",...p.style}}/></div>);}
function Sel({label,children,...p}){return(<div style={{marginBottom:12}}>{label&&<div style={{fontSize:12,color:T.subtext,marginBottom:4}}>{label}</div>}<select {...p} style={{width:"100%",background:T.input,border:`1px solid ${T.border}`,borderRadius:8,padding:"8px 10px",color:T.text,fontSize:14,...p.style}}>{children}</select></div>);}
function Btn({children,color="#3B82F6",outline,small,...p}){return(<button {...p} style={{background:outline?"transparent":color,border:`1px solid ${color}`,color:outline?color:"#fff",borderRadius:8,padding:small?"4px 10px":"8px 16px",fontSize:small?12:14,cursor:"pointer",fontWeight:500,...p.style}}>{children}</button>);}
function UndoBar({undo,redo,canUndo,canRedo}){return(<div style={{display:"flex",gap:6,marginBottom:14}}><button onClick={undo} disabled={!canUndo} style={{background:canUndo?T.card:T.card2,border:`1px solid ${T.border}`,color:canUndo?T.text:T.faint,borderRadius:8,padding:"5px 12px",cursor:canUndo?"pointer":"not-allowed",fontSize:13}}>↩ Undo</button><button onClick={redo} disabled={!canRedo} style={{background:canRedo?T.card:T.card2,border:`1px solid ${T.border}`,color:canRedo?T.text:T.faint,borderRadius:8,padding:"5px 12px",cursor:canRedo?"pointer":"not-allowed",fontSize:13}}>↪ Redo</button></div>);}
function SyncBar({status,isOnline}){
  const colors={idle:T.faint,saving:"#F59E0B",saved:"#10B981",error:"#ef4444",loading:"#3B82F6",offline:"#F97316"};
  const icons={idle:"☁️",saving:"⏳",saved:"✓",error:"⚠️",loading:"⏳",offline:"📵"};
  const labels={idle:"Ready",saving:"Saving…",saved:"Saved",error:"Failed",loading:"Loading…",offline:"Offline"};
  const s=!isOnline?"offline":status;
  return<div key={s} className="sync-chip-enter" style={{display:"flex",alignItems:"center",gap:6,fontSize:12,fontWeight:s==="error"?700:400,color:colors[s],padding:"4px 10px",background:T.card,border:s==="error"?"1px solid #ef444466":"1px solid transparent",borderRadius:8}}><span>{icons[s]}</span><span>{labels[s]}</span></div>;
}
function EmojiPicker({value,onPick}){return(<div style={{display:"flex",flexWrap:"wrap",gap:6,marginBottom:12}}>{ENVELOPE_EMOJIS.map(em=>(<button key={em} onClick={()=>onPick(em)} style={{fontSize:18,padding:"4px 6px",borderRadius:8,cursor:"pointer",background:value===em?"#3B82F6":T.input,border:`1px solid ${value===em?"#3B82F6":T.border}`}}>{em}</button>))}</div>);}

function VersionBar(){
  const now=new Date();
  return(
    <div style={{fontSize:11,color:T.faint,marginTop:2,display:"flex",gap:8,alignItems:"center"}}>
      <span>{VERSION}</span>
      <span style={{color:T.border}}>·</span>
      <span>{now.toLocaleDateString(undefined,{month:"short",day:"numeric",year:"numeric"})}</span>
    </div>
  );
}

function makeBank(name,currency,balance,color){
  return{id:Date.now(),name,currency,color:color||null,balance,envelopes:[{id:UNALLOC_ID,name:"Unallocated",emoji:"📂",balance,transactions:[],isUnalloc:true}]};
}
function bankTotal(bank){return(bank.envelopes||[]).reduce((s,e)=>s+e.balance,0);}
function envelopeMonthSpend(env){
  const monthKey=localDateStr().slice(0,7);
  return(env.transactions||[]).filter(t=>t.type==="expense"&&t.date&&t.date.slice(0,7)===monthKey).reduce((s,t)=>s+t.amount,0);
}
function daysLeftInMonth(){
  const now=new Date();
  const lastDay=new Date(now.getFullYear(),now.getMonth()+1,0).getDate();
  return lastDay-now.getDate()+1;
}

// ── Observations: plain rule-based checks over your own data. No LLM, no
// network, nothing leaves the device — just arithmetic on numbers you
// already have, surfaced instead of left buried in a bank/envelope you'd
// have to go dig into yourself. ──
function computeObservations(banks){
  const obs=[];
  const today=new Date();
  const monthKey=localDateStr().slice(0,7);
  const cutoff60=new Date(today.getTime()-60*86400000).toISOString().slice(0,10);
  const cutoff30=new Date(today.getTime()-30*86400000).toISOString().slice(0,10);
  const dayOfMonth=today.getDate();
  const daysInMonth=new Date(today.getFullYear(),today.getMonth()+1,0).getDate();

  banks.forEach(b=>{
    const bTotal=bankTotal(b);
    if(bTotal<=0)return;
    b.envelopes.forEach(e=>{
      if(e.balance>0){
        const lastTxDate=e.transactions.reduce((max,t)=>t.date>max?t.date:max,"");
        const idle=!lastTxDate||lastTxDate<cutoff60;
        if(idle&&e.balance>=bTotal*0.1){
          obs.push({id:`idle_${b.id}_${e.id}`,icon:"💤",tone:"warn",
            text:`${sym(b.currency)}${fmtNum(e.balance)} in ${e.isUnalloc?`${b.name}'s Unallocated`:`"${e.name}" (${b.name})`} hasn't moved in 60+ days.`});
        }
      }
      // Wait until at least a third of the month has passed, and cap the
      // Only project a pace for a category with an actual recurring pattern
      // this month (spending on 2+ different days) — extrapolating a single
      // lump payment (a one-time fee, a yearly subscription) as if it
      // repeats every remaining day produces a nonsense number. Also cap
      // the extrapolation multiplier itself so early-month noise doesn't
      // get amplified into a dramatic-looking percentage.
      const monthExpenses=e.transactions.filter(t=>t.type==="expense"&&t.date?.slice(0,7)===monthKey);
      const patternDays=new Set(monthExpenses.map(t=>t.date)).size;
      if(e.budget&&patternDays>=2&&dayOfMonth>=Math.max(10,Math.round(daysInMonth/3))){
        const spent=monthExpenses.reduce((s,t)=>s+t.amount,0);
        const multiplier=Math.min(daysInMonth/dayOfMonth,2.5);
        const projected=spent*multiplier;
        if(projected>e.budget*1.25){
          const overPct=Math.round(((projected-e.budget)/e.budget)*100);
          obs.push({id:`budget_${b.id}_${e.id}`,icon:"⚠️",tone:"warn",
            text:`On pace to spend ${sym(b.currency)}${fmtNum(projected)} in "${e.name}" this month — ${overPct}% over your ${sym(b.currency)}${fmtNum(e.budget)} budget.`});
        }
      }
      if(e.goal&&e.balance<e.goal){
        const recentIncome=e.transactions.some(t=>t.type==="income"&&t.date>=cutoff30);
        if(!recentIncome){
          obs.push({id:`goal_${b.id}_${e.id}`,icon:"🐌",tone:"warn",
            text:`"${e.name}" hasn't grown in 30+ days — still ${sym(b.currency)}${fmtNum(e.goal-e.balance)} away from its ${sym(b.currency)}${fmtNum(e.goal)} goal.`});
        }
      }
    });
  });

  const byCurrency={};
  banks.forEach(b=>{(byCurrency[b.currency]=byCurrency[b.currency]||[]).push(b);});

  Object.entries(byCurrency).forEach(([currency,cBanks])=>{
    const expenseTx=cBanks.flatMap(b=>b.envelopes.flatMap(e=>e.transactions.filter(t=>t.type==="expense"&&t.tag!=="Transfer")));
    const byTagMonth={};
    expenseTx.forEach(t=>{
      const mk=t.date?.slice(0,7);if(!mk)return;
      const tag=t.tag||"Untagged";
      byTagMonth[tag]=byTagMonth[tag]||{};
      byTagMonth[tag][mk]=(byTagMonth[tag][mk]||0)+t.amount;
    });
    Object.entries(byTagMonth).forEach(([tag,months])=>{
      const completed=Object.keys(months).filter(k=>k!==monthKey).sort().slice(-3);
      if(completed.length<3)return;
      const[v0,v1,v2]=completed.map(k=>months[k]);
      if(v0<v1&&v1<v2){
        obs.push({id:`trend_${currency}_${tag}`,icon:"📈",tone:"info",
          text:`"${tag}" spending has grown for 3 months straight (${sym(currency)}${fmtNum(v0)} → ${sym(currency)}${fmtNum(v2)}).`});
      }
    });
    const monthTx=expenseTx.filter(t=>t.date?.slice(0,7)===monthKey);
    if(monthTx.length){
      const biggest=monthTx.reduce((a,b)=>b.amount>a.amount?b:a);
      if(biggest.amount>0){
        obs.push({id:`biggest_${currency}`,icon:"🔎",tone:"info",
          text:`Biggest expense this month (${currency}): ${sym(currency)}${fmtNum(biggest.amount)} — "${biggest.desc}"${biggest.tag?` · ${biggest.tag}`:""}.`});
      }
    }
  });

  return obs.sort((a,b)=>(a.tone==="warn"?0:1)-(b.tone==="warn"?0:1));
}

function AddTxModal({envName,tx,setTx,tags,color,onAdd,onClose}){
  const[err,setErr]=useState("");
  const submit=()=>{
    if(!tx.desc){setErr("Please enter a description.");return;}
    if(!tx.amount||parseFloat(tx.amount)<=0){setErr("Please enter a valid amount greater than 0.");return;}
    setErr("");onAdd();
  };
  return(
    <Modal title={`Add Transaction → ${envName}`} onClose={onClose} isDirty={!!tx.desc||!!tx.amount}>
      <div style={{display:"flex",gap:8,marginBottom:12}}>
        {["income","expense"].map(t=><Btn key={t} color={t==="income"?"#10B981":"#ef4444"} outline={tx.type!==t} onClick={()=>setTx(x=>({...x,type:t}))} style={{flex:1,textTransform:"capitalize"}}>{t}</Btn>)}
      </div>
      <FormError msg={err}/>
      <Inp label="Description" value={tx.desc} onChange={e=>{setErr("");setTx(x=>({...x,desc:e.target.value}));}} placeholder="e.g. Salary, Groceries"/>
      <Inp label="Amount" type="number" value={tx.amount} onChange={e=>{setErr("");setTx(x=>({...x,amount:e.target.value}));}} placeholder="0.00"/>
      <Sel label="Tag (optional)" value={tx.tag} onChange={e=>setTx(x=>({...x,tag:e.target.value}))}><option value="">No tag</option>{(tags||[]).map(t=><option key={t} value={t}>{t}</option>)}</Sel>
      <Inp label="Note (optional)" value={tx.note} onChange={e=>setTx(x=>({...x,note:e.target.value}))} placeholder="Any notes..."/>
      <Inp label="Date" type="date" value={tx.date} onChange={e=>setTx(x=>({...x,date:e.target.value}))}/>
      <Btn color={color} onClick={submit} style={{width:"100%"}}>Add Transaction</Btn>
    </Modal>
  );
}

function TxEditModal({tx,tags,onSave,onClose}){
  const[form,setForm]=useState({...tx});
  const[err,setErr]=useState("");
  const isDirty=JSON.stringify(form)!==JSON.stringify(tx);
  const submit=()=>{
    if(!form.desc){setErr("Please enter a description.");return;}
    if(!form.amount||parseFloat(form.amount)<=0){setErr("Please enter a valid amount.");return;}
    setErr("");onSave({...form,amount:parseFloat(form.amount)||0});
  };
  return(
    <Modal title="Edit Transaction" onClose={onClose} isDirty={isDirty}>
      <div style={{display:"flex",gap:8,marginBottom:12}}>{["income","expense"].map(t=><Btn key={t} color={t==="income"?"#10B981":"#ef4444"} outline={form.type!==t} onClick={()=>setForm(f=>({...f,type:t}))} style={{flex:1,textTransform:"capitalize"}}>{t}</Btn>)}</div>
      <FormError msg={err}/>
      <Inp label="Description" value={form.desc} onChange={e=>{setErr("");setForm(f=>({...f,desc:e.target.value}));}}/>
      <Inp label="Amount" type="number" value={form.amount} onChange={e=>{setErr("");setForm(f=>({...f,amount:e.target.value}));}}/>
      <Sel label="Tag" value={form.tag||""} onChange={e=>setForm(f=>({...f,tag:e.target.value}))}><option value="">No tag</option>{(tags||[]).map(t=><option key={t} value={t}>{t}</option>)}</Sel>
      <Inp label="Note" value={form.note||""} onChange={e=>setForm(f=>({...f,note:e.target.value}))}/>
      <Inp label="Date" type="date" value={form.date} onChange={e=>setForm(f=>({...f,date:e.target.value}))}/>
      <Btn color="#3B82F6" onClick={submit} style={{width:"100%"}}>Save Changes</Btn>
    </Modal>
  );
}

function TransferModal({bank,allBanks,onClose,onTransfer}){
  const color=bankColor(bank);
  const[fromExternal,setFromExternal]=useState(false);
  const[fromEnvId,setFromEnvId]=useState(bank.envelopes[0]?.id||"");
  const[toBank,setToBank]=useState(String(bank.id));
  const[toEnvId,setToEnvId]=useState("");
  const[amt,setAmt]=useState("");
  const[fee,setFee]=useState("");
  const[received,setReceived]=useState("");
  const[err,setErr]=useState("");
  const srcEnvs=bank.envelopes||[];
  const toExternal=toBank==="external";
  const destBank=toExternal?null:allBanks.find(b=>String(b.id)===String(toBank));
  const destEnvs=destBank?.envelopes||[];
  const isCross=!fromExternal&&!toExternal&&destBank&&destBank.currency!==bank.currency;
  const isDirty=!!amt||!!fee||!!received;
  useEffect(()=>{if(!toExternal)setToEnvId(destEnvs[0]?.id||"");},[toBank]);
  useEffect(()=>{if(fromExternal&&toExternal)setToBank(String(bank.id));},[fromExternal]);
  const doTransfer=()=>{
    setErr("");
    const a=parseFloat(amt)||0;
    const f=fromExternal?0:(parseFloat(fee)||0);
    const total=a+f;
    if(a<=0){setErr("Please enter an amount greater than 0.");return;}
    let srcEnv=null,destEnv=null;
    if(!fromExternal){
      srcEnv=srcEnvs.find(e=>String(e.id)===String(fromEnvId));
      if(!srcEnv){setErr("Please select a source envelope.");return;}
      if(!toExternal&&String(toBank)===String(bank.id)&&String(fromEnvId)===String(toEnvId)){setErr("Source and destination must differ.");return;}
      if(srcEnv.balance<total-0.005){setErr(`Insufficient balance. Need ${sym(bank.currency)}${fmtNum(total)} but source has ${sym(bank.currency)}${fmtNum(srcEnv.balance)}.`);return;}
    }
    if(!toExternal){
      destEnv=destEnvs.find(e=>String(e.id)===String(toEnvId));
      if(!destEnv){setErr("Please select a destination envelope.");return;}
    }
    const rec=isCross?(parseFloat(received)||0):a;
    if(isCross&&!rec){setErr("Please enter the amount received in the destination currency.");return;}
    onTransfer({fromExternal,toExternal,srcEnv,destEnv,destBank,amt:a,fee:f,received:rec,isCross,srcCurrency:bank.currency,destCurrency:toExternal?bank.currency:destBank.currency});
    onClose();
  };
  return(
    <Modal title="Transfer" onClose={onClose} isDirty={isDirty}>
      <div style={{fontSize:12,color:T.subtext,marginBottom:4}}>From</div>
      <div style={{display:"flex",gap:8,marginBottom:12}}>
        <select value={fromExternal?"external":"bank"} onChange={e=>setFromExternal(e.target.value==="external")} style={{flex:1,background:T.input,border:`1px solid ${T.border}`,borderRadius:8,padding:"8px 10px",color:T.text,fontSize:14}}>
          <option value="bank">{bank.name}</option>
          <option value="external">External</option>
        </select>
        {!fromExternal&&<select value={fromEnvId} onChange={e=>setFromEnvId(e.target.value)} style={{flex:1,background:T.input,border:`1px solid ${T.border}`,borderRadius:8,padding:"8px 10px",color:T.text,fontSize:14}}>
          {srcEnvs.map(e=><option key={e.id} value={e.id}>{e.name} ({sym(bank.currency)}{fmtNum(e.balance)})</option>)}
        </select>}
      </div>
      <div style={{fontSize:12,color:T.subtext,marginBottom:4}}>To</div>
      <div style={{display:"flex",gap:8,marginBottom:12}}>
        <select value={toBank} onChange={e=>setToBank(e.target.value)} style={{flex:1,background:T.input,border:`1px solid ${T.border}`,borderRadius:8,padding:"8px 10px",color:T.text,fontSize:14}}>
          {allBanks.map(b=><option key={b.id} value={String(b.id)}>{b.name} ({b.currency})</option>)}
          {!fromExternal&&<option value="external">External</option>}
        </select>
        {!toExternal&&<select value={toEnvId} onChange={e=>setToEnvId(e.target.value)} style={{flex:1,background:T.input,border:`1px solid ${T.border}`,borderRadius:8,padding:"8px 10px",color:T.text,fontSize:14}}>
          {destEnvs.map(e=><option key={e.id} value={e.id}>{e.name} ({sym(destBank?.currency)}{fmtNum(e.balance)})</option>)}
        </select>}
      </div>
      <Inp label={`Amount ${fromExternal?"received":"to send"} (${bank.currency})`} type="number" value={amt} onChange={e=>{setErr("");setAmt(e.target.value);}} placeholder="0.00"/>
      {!fromExternal&&<Inp label={`Fee (${bank.currency}) — on top of transfer amount`} type="number" value={fee} onChange={e=>setFee(e.target.value)} placeholder="0.00 (optional)"/>}
      {isCross&&(
        <div style={{background:"#F59E0B22",border:"1px solid #F59E0B44",borderRadius:8,padding:10,marginBottom:12}}>
          <div style={{fontSize:12,color:"#F59E0B",marginBottom:8}}>💱 Cross-currency transfer</div>
          <Inp label={`Amount received in destination (${destBank?.currency})`} type="number" value={received} onChange={e=>{setErr("");setReceived(e.target.value);}} placeholder="Enter exact amount received"/>
        </div>
      )}
      {amt&&(
        <div style={{background:T.card2,borderRadius:8,padding:10,marginBottom:12,fontSize:12,color:T.subtext}}>
          {!fromExternal&&<div>Source deducted: <strong style={{color:"#ef4444"}}>{sym(bank.currency)}{fmtNum((parseFloat(amt)||0)+(parseFloat(fee)||0))}</strong>{fee?` (${sym(bank.currency)}${fmtNum(parseFloat(amt)||0)} + ${sym(bank.currency)}${fmtNum(parseFloat(fee)||0)} fee)`:""}</div>}
          <div style={{marginTop:fromExternal?0:4}}>Destination receives: <strong style={{color:"#10B981"}}>{isCross?(received?`${sym(destBank?.currency)}${fmtNum(parseFloat(received)||0)}`:"—"):`${sym(bank.currency)}${fmtNum(parseFloat(amt)||0)}`}</strong></div>
        </div>
      )}
      <FormError msg={err}/>
      <Btn color={color} onClick={doTransfer} style={{width:"100%"}}>Confirm Transfer</Btn>
    </Modal>
  );
}
function EnvelopeView({bank,bankId,setBanks,tags}){
  const color=bankColor(bank);
  const currency=bank.currency;
  const[showAdd,setShowAdd]=useState(false);
  const[showTx,setShowTx]=useState(null);
  const[showHist,setShowHist]=useState(null);
  const[editEnv,setEditEnv]=useState(null);
  const[editTx,setEditTx]=useState(null);
  const[confirmDelTx,setConfirmDelTx]=useState(null);
  const[confirmDelEnv,setConfirmDelEnv]=useState(null);
  const[envName,setEnvName]=useState("");
  const[envBal,setEnvBal]=useState("");
  const[envGoal,setEnvGoal]=useState("");
  const[envBudget,setEnvBudget]=useState("");
  const[envEmoji,setEnvEmoji]=useState("🗂️");
  const[convCurrency,setConvCurrency]=useState("");
  const[tx,setTx]=useState({type:"expense",desc:"",amount:"",tag:"",note:"",date:localDateStr()});
  const envelopes=bank.envelopes||[];
  const updateBank=fn=>setBanks(bs=>bs.map(b=>b.id!==bankId?b:fn(b)));

  const addEnvelope=()=>{
    if(!envName.trim())return;
    const amt=parseFloat(envBal)||0;
    updateBank(b=>({...b,balance:r2(b.balance+amt),envelopes:[...b.envelopes,{id:Date.now(),name:envName.trim(),emoji:envEmoji,balance:amt,goal:parseFloat(envGoal)||null,budget:parseFloat(envBudget)||null,transactions:[]}]}));
    setEnvName("");setEnvBal("");setEnvGoal("");setEnvBudget("");setEnvEmoji("🗂️");setShowAdd(false);
  };
  const saveEnvEdit=()=>{
    updateBank(b=>({...b,envelopes:b.envelopes.map(e=>e.id!==editEnv.id?e:{...e,name:editEnv.name,emoji:editEnv.emoji,goal:parseFloat(editEnv.goal)||null,budget:parseFloat(editEnv.budget)||null})}));
    setEditEnv(null);
  };
  const delEnvelope=envId=>{
    updateBank(b=>{const env=b.envelopes.find(e=>e.id===envId);return{...b,balance:r2(b.balance-(env?.balance||0)),envelopes:b.envelopes.filter(e=>e.id!==envId)};});
    setConfirmDelEnv(null);
  };
  const addTx=()=>{
    const amt=parseFloat(tx.amount);
    const isIncome=tx.type==="income";
    const newTx={id:Date.now(),...tx,amount:amt};
    updateBank(b=>({...b,balance:r2(b.balance+(isIncome?amt:-amt)),envelopes:b.envelopes.map(e=>e.id!==showTx?e:{...e,balance:r2(e.balance+(isIncome?amt:-amt)),transactions:[newTx,...e.transactions]})}));
    setTx({type:"expense",desc:"",amount:"",tag:"",note:"",date:localDateStr()});
    setShowTx(null);
    toast("success","Transaction added.");
  };
  const saveTxEdit=(envId,updated)=>{
    updateBank(b=>{
      const env=b.envelopes.find(e=>e.id===envId);
      const old=env.transactions.find(t=>t.id===updated.id);
      const oldD=old.type==="income"?old.amount:-old.amount;
      const newD=updated.type==="income"?updated.amount:-updated.amount;
      const diff=newD-oldD;
      return{...b,balance:r2(b.balance+diff),envelopes:b.envelopes.map(e=>e.id!==envId?e:{...e,balance:r2(e.balance+diff),transactions:e.transactions.map(t=>t.id===updated.id?updated:t)})};
    });
    setEditTx(null);
  };
  const delTx=(envId,txId)=>{
    updateBank(b=>{
      const env=b.envelopes.find(e=>e.id===envId);
      const t=env?.transactions.find(x=>x.id===txId);
      if(!t)return b;
      const delta=t.type==="income"?-t.amount:t.amount;
      return{...b,balance:r2(b.balance+delta),envelopes:b.envelopes.map(e=>e.id!==envId?e:{...e,balance:r2(e.balance+delta),transactions:e.transactions.filter(x=>x.id!==txId)})};
    });
    setConfirmDelTx(null);
  };
  const histEnv=envelopes.find(e=>e.id===showHist);

  return(
    <div style={{marginTop:12}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
        <div style={{display:"flex",alignItems:"center",gap:8}}>
          <span style={{fontSize:13,color:T.subtext}}>Envelopes</span>
          <select value={convCurrency} onChange={e=>setConvCurrency(e.target.value)} style={{background:T.input,border:`1px solid ${T.border}`,borderRadius:6,padding:"2px 6px",color:T.faint,fontSize:11}}>
            <option value="">+ Convert</option>
            {CURRENCY_LIST.filter(c=>c!==currency).map(c=><option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        <Btn small color={color} onClick={()=>setShowAdd(true)}>+ Envelope</Btn>
      </div>

      <div style={{display:"flex",flexDirection:"column",gap:6}}>
        {envelopes.map(e=>(
          <div key={e.id} style={{background:T.card2,borderRadius:8,padding:"10px 12px",border:`1px solid ${e.isUnalloc?T.border:color+"33"}`,display:"flex",justifyContent:"space-between",alignItems:"center",gap:8,flexWrap:"wrap"}}>
            <div style={{display:"flex",alignItems:"center",gap:8,flex:1,minWidth:0}}>
              <span style={{fontSize:16}}>{e.isUnalloc?"📂":(e.emoji||"🗂️")}</span>
              <div style={{flex:1,minWidth:0}}>
                <div style={{fontSize:13,color:e.isUnalloc?T.faint:T.text,fontStyle:e.isUnalloc?"italic":"normal",display:"flex",alignItems:"center",gap:6,minWidth:0}}>
                  <span style={{overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",minWidth:0}}>{e.name}</span>
                  {e.goal?<span style={{fontSize:11,color:T.faint,whiteSpace:"nowrap",flexShrink:0}}>Goal: {sym(currency)}{fmtNum(e.goal)}</span>:null}
                  {!e.isUnalloc&&<button onClick={()=>setEditEnv({id:e.id,name:e.name,emoji:e.emoji||"🗂️",goal:e.goal||"",budget:e.budget||""})} style={{background:"none",border:"none",color:T.subtext,cursor:"pointer",fontSize:12,padding:0,flexShrink:0}}>✏️</button>}
                </div>
                {e.goal&&!e.isUnalloc&&(()=>{const pct=Math.min(100,Math.round((e.balance/e.goal)*100));const rem=e.goal-e.balance;return(<div style={{marginTop:4}}><div style={{background:T.card,borderRadius:99,height:5,overflow:"hidden"}}><div style={{width:`${pct}%`,height:"100%",background:pct>=100?"#10B981":color,borderRadius:99}}/></div><div style={{fontSize:10,color:pct>=100?"#10B981":T.faint,marginTop:2}}>{pct}%{pct>=100?" ✓":<span style={{marginLeft:4,color:T.subtext}}>· {sym(currency)}{fmtNum(rem)} left</span>}</div></div>);})()}
                {e.budget&&!e.isUnalloc&&(()=>{const spent=envelopeMonthSpend(e);const pct=Math.min(100,Math.round((spent/e.budget)*100));const over=spent>e.budget;const rem=e.budget-spent;const days=daysLeftInMonth();const perDay=!over&&days>0?rem/days:null;return(<div style={{marginTop:4}}><div style={{fontSize:10,color:T.faint,marginBottom:1}}>Budget this month</div><div style={{background:T.card,borderRadius:99,height:5,overflow:"hidden"}}><div style={{width:`${pct}%`,height:"100%",background:over?"#ef4444":"#F59E0B",borderRadius:99}}/></div><div style={{fontSize:10,color:over?"#ef4444":T.faint,marginTop:2}}>{sym(currency)}{fmtNum(spent)} / {sym(currency)}{fmtNum(e.budget)}{over?` · ${sym(currency)}${fmtNum(Math.abs(rem))} over`:` · ${sym(currency)}${fmtNum(rem)} left`}</div>{perDay!==null&&<div style={{fontSize:10,color:T.faint,marginTop:1}}>{sym(currency)}{fmtNum(perDay)}/day · {sym(currency)}{fmtNum(perDay*7)}/week · {days} day{days!==1?"s":""} left</div>}</div>);})()}
                {!e.goal&&!e.budget&&<div style={{fontSize:11,color:T.faint}}>{e.transactions.length} tx</div>}
              </div>
            </div>
            <div style={{display:"flex",gap:4,alignItems:"center",flexWrap:"wrap",justifyContent:"flex-end"}}>
              <div style={{textAlign:"right"}}>
                <div style={{color:e.balance<0?"#ef4444":e.isUnalloc?T.faint:color,fontWeight:600,fontSize:13,whiteSpace:"nowrap"}}>{sym(currency)}{fmtNum(e.balance)}</div>
                {convCurrency&&<ConversionBadge amount={e.balance} fromCurrency={currency} toCurrency={convCurrency} style={{marginLeft:0}}/>}
              </div>
              <Btn small color={color} onClick={()=>setShowTx(e.id)}>+</Btn>
              <Btn small outline color={color} onClick={()=>setShowHist(e.id)}>📄</Btn>
              {!e.isUnalloc&&<Btn small outline color="#ef4444" onClick={()=>setConfirmDelEnv({id:e.id,name:e.name,hasContent:e.balance!==0||e.transactions.length>0})}>🗑</Btn>}
            </div>
          </div>
        ))}
      </div>

      {confirmDelEnv&&<ConfirmModal message={`Delete envelope "${confirmDelEnv.name}"?`} detail={confirmDelEnv.hasContent?"This will remove the envelope, its balance, and its transaction history from the bank total.":"It's empty — this just removes the envelope itself."} confirmLabel="Delete Envelope" requireDel={confirmDelEnv.hasContent} onConfirm={()=>delEnvelope(confirmDelEnv.id)} onClose={()=>setConfirmDelEnv(null)}/>}
      {confirmDelTx&&<ConfirmModal message={`Delete transaction "${confirmDelTx.desc}"?`} onConfirm={()=>delTx(confirmDelTx.envId,confirmDelTx.txId)} onClose={()=>setConfirmDelTx(null)}/>}

      {showAdd&&<Modal title="New Envelope" onClose={()=>setShowAdd(false)} isDirty={!!envName||!!envBal||!!envGoal||!!envBudget}>
        <Inp label="Name" value={envName} onChange={e=>setEnvName(e.target.value)} placeholder="e.g. Rent, Emergency"/>
        <div style={{fontSize:12,color:T.subtext,marginBottom:4}}>Icon</div>
        <EmojiPicker value={envEmoji} onPick={setEnvEmoji}/>
        <Inp label="Starting Amount" type="number" value={envBal} onChange={e=>setEnvBal(e.target.value)} placeholder="0.00"/>
        <Inp label="Goal (optional)" type="number" value={envGoal} onChange={e=>setEnvGoal(e.target.value)} placeholder="e.g. 10000"/>
        <Inp label="Monthly Budget (optional)" type="number" value={envBudget} onChange={e=>setEnvBudget(e.target.value)} placeholder="e.g. 500 — resets each month"/>
        <Btn color={color} onClick={addEnvelope} style={{width:"100%"}}>Create Envelope</Btn>
      </Modal>}

      {editEnv&&<Modal title="Edit Envelope" onClose={()=>setEditEnv(null)} isDirty={true}>
        <Inp label="Name" value={editEnv.name} onChange={e=>setEditEnv(v=>({...v,name:e.target.value}))}/>
        <div style={{fontSize:12,color:T.subtext,marginBottom:4}}>Icon</div>
        <EmojiPicker value={editEnv.emoji} onPick={em=>setEditEnv(v=>({...v,emoji:em}))}/>
        <Inp label="Goal (blank to remove)" type="number" value={editEnv.goal} onChange={e=>setEditEnv(v=>({...v,goal:e.target.value}))}/>
        <Inp label="Monthly Budget (blank to remove)" type="number" value={editEnv.budget} onChange={e=>setEditEnv(v=>({...v,budget:e.target.value}))}/>
        <Btn color={color} onClick={saveEnvEdit} style={{width:"100%"}}>Save</Btn>
      </Modal>}

      {showTx&&<AddTxModal
        envName={envelopes.find(e=>e.id===showTx)?.name||""}
        tx={tx} setTx={setTx} tags={tags} color={color}
        onAdd={addTx}
        onClose={()=>setShowTx(null)}
      />}

      {showHist&&<Modal title={`${histEnv?.name} · History`} onClose={()=>setShowHist(null)} isDirty={false}>
        {histEnv?.transactions.length===0&&<div style={{color:T.faint,textAlign:"center",padding:16}}>No transactions yet.</div>}
        <div style={{display:"flex",flexDirection:"column",gap:8,maxHeight:360,overflowY:"auto"}}>
          {histEnv?.transactions.map(t=>(
            <div key={t.id} style={{background:T.card2,borderRadius:8,padding:"8px 12px"}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                <div>
                  <div style={{fontSize:13,color:T.text}}>{t.desc}</div>
                  <div style={{fontSize:11,color:T.faint}}>{t.date}{t.tag?<span style={{marginLeft:6,background:T.card,borderRadius:4,padding:"1px 6px"}}>{t.tag}</span>:null}</div>
                  {t.note&&<div style={{fontSize:11,color:T.faint,marginTop:2,fontStyle:"italic"}}>{t.note}</div>}
                </div>
                <div style={{display:"flex",gap:6,alignItems:"center"}}>
                  <span style={{color:t.type==="income"?"#10B981":"#ef4444",fontWeight:600}}>{t.type==="income"?"+":"-"}{sym(currency)}{fmtNum(t.amount)}</span>
                  <button onClick={()=>setEditTx({envId:showHist,tx:t})} style={{background:"none",border:"none",color:T.subtext,cursor:"pointer",fontSize:13}}>✏️</button>
                  <button onClick={()=>setConfirmDelTx({envId:showHist,txId:t.id,desc:t.desc})} style={{background:"none",border:"none",color:"#ef4444",cursor:"pointer"}}>✕</button>
                </div>
              </div>
            </div>
          ))}
        </div>
      </Modal>}

      {editTx&&<TxEditModal tx={editTx.tx} tags={tags} onSave={updated=>saveTxEdit(editTx.envId,updated)} onClose={()=>setEditTx(null)}/>}
    </div>
  );
}

function BanksSection({banks,setBanks,tags,focusBank,clearFocusBank}){
  const[showBank,setShowBank]=useState(false);
  const[expandedSet,setExpandedSet]=useState({});
  useEffect(()=>{
    if(!focusBank)return;
    setExpandedSet(s=>({...s,[focusBank]:true}));
    const t=setTimeout(()=>{document.getElementById(`bank-${focusBank}`)?.scrollIntoView({behavior:"smooth",block:"start"});clearFocusBank?.();},60);
    return()=>clearTimeout(t);
  // eslint-disable-next-line
  },[focusBank]);
  const[editBank,setEditBank]=useState(null);
  const[confirmDel,setConfirmDel]=useState(null);
  const[transferBank,setTransferBank]=useState(null);
  const[quickTxBank,setQuickTxBank]=useState(null);
  const[quickTxEnvId,setQuickTxEnvId]=useState("");
  const[quickTx,setQuickTx]=useState({type:"expense",desc:"",amount:"",tag:"",note:"",date:localDateStr()});
  const[reserveOn,setReserveOn]=useState(false);
  const[reserveBankId,setReserveBankId]=useState("");
  const[reserveEnvId,setReserveEnvId]=useState("");
  const[quickTxErr,setQuickTxErr]=useState("");
  const[bankName,setBankName]=useState("");
  const[bankCurrency,setBankCurrency]=useState("PHP");
  const[bankBal,setBankBal]=useState("");
  const[bankColorPick,setBankColorPick]=useState(BANK_COLOR_CHOICES[0]);
  const[globalConv,setGlobalConv]=useState("");
  const[showBankHist,setShowBankHist]=useState(null);
  const[showAllHist,setShowAllHist]=useState(false);
  const[bankHistVisible,setBankHistVisible]=useState(50);
  const[allHistVisible,setAllHistVisible]=useState(50);
  const HIST_PAGE_SIZE=50;
  const[editHistTx,setEditHistTx]=useState(null);
  const[confirmDelHistTx,setConfirmDelHistTx]=useState(null);
  const grouped=banks.reduce((acc,b)=>{(acc[b.currency]=acc[b.currency]||[]).push(b);return acc;},{});
  const toggle=id=>setExpandedSet(s=>({...s,[id]:!s[id]}));
  const addBank=()=>{if(!bankName.trim())return;setBanks(b=>[...b,makeBank(bankName.trim(),bankCurrency,parseFloat(bankBal)||0,bankColorPick)]);setBankName("");setBankBal("");setShowBank(false);};
  const saveBankEdit=()=>{
    const newTotal=parseFloat(editBank.balance);
    setBanks(bs=>bs.map(b=>{
      if(b.id!==editBank.id)return b;
      let envelopes=b.envelopes;
      if(!isNaN(newTotal)&&newTotal!==bankTotal(b)){const diff=newTotal-bankTotal(b);envelopes=b.envelopes.map(e=>e.id===UNALLOC_ID?{...e,balance:r2(e.balance+diff)}:e);}
      return{...b,name:editBank.name,color:editBank.color,envelopes};
    }));
    setEditBank(null);
  };
  const delBank=id=>{setBanks(b=>b.filter(x=>x.id!==id));setConfirmDel(null);};
  const doTransfer=({fromExternal,toExternal,srcEnv,destEnv,destBank,amt,fee,received,isCross,srcCurrency,destCurrency})=>{
    const date=localDateStr();
    if(fromExternal){
      const destTx={id:Date.now(),type:"income",desc:"Received from External account",amount:received,tag:"Transfer",note:"",date};
      setBanks(bs=>bs.map(b=>String(b.id)===String(destBank.id)?{...b,balance:r2(b.balance+received),envelopes:b.envelopes.map(e=>String(e.id)===String(destEnv.id)?{...e,balance:r2(e.balance+received),transactions:[destTx,...e.transactions]}:e)}:b));
      setTransferBank(null);
      toast("success","Transfer recorded.");
      return;
    }
    if(toExternal){
      const totalDeducted=amt+fee;
      const srcTx={id:Date.now(),type:"expense",desc:`Sent to External account${fee?` · ${sym(srcCurrency)}${fmtNum(fee)} fee`:""}`,amount:totalDeducted,tag:"Transfer",note:"",date};
      const srcBankId=transferBank.id;
      setBanks(bs=>bs.map(b=>String(b.id)===String(srcBankId)?{...b,balance:r2(b.balance-totalDeducted),envelopes:b.envelopes.map(e=>String(e.id)===String(srcEnv.id)?{...e,balance:r2(e.balance-totalDeducted),transactions:[srcTx,...e.transactions]}:e)}:b));
      setTransferBank(null);
      toast("success","Transfer recorded.");
      return;
    }
    const totalDeducted=amt+fee;
    const srcBankId=transferBank.id;
    const destBankId=destBank.id;
    const srcTx={id:Date.now(),type:"expense",desc:`Transfer to ${destBank.name}${isCross?` · ${sym(destCurrency)}${fmtNum(received)} received`:""}${fee?` · ${sym(srcCurrency)}${fmtNum(fee)} fee`:""}`,amount:totalDeducted,tag:"Transfer",note:"",date};
    const destTx={id:Date.now()+1,type:"income",desc:`Transfer from ${transferBank.name}${isCross?` · ${sym(srcCurrency)}${fmtNum(amt)} sent`:""}`,amount:received,tag:"Transfer",note:"",date};
    const sameBank=String(srcBankId)===String(destBankId);
    setBanks(bs=>bs.map(b=>{
      if(sameBank&&String(b.id)===String(srcBankId)){
        return{...b,balance:r2(b.balance-totalDeducted+received),envelopes:b.envelopes.map(e=>{
          if(String(e.id)===String(srcEnv.id))return{...e,balance:r2(e.balance-totalDeducted),transactions:[srcTx,...e.transactions]};
          if(String(e.id)===String(destEnv.id))return{...e,balance:r2(e.balance+received),transactions:[destTx,...e.transactions]};
          return e;
        })};
      }
      if(!sameBank&&String(b.id)===String(srcBankId))return{...b,balance:r2(b.balance-totalDeducted),envelopes:b.envelopes.map(e=>String(e.id)===String(srcEnv.id)?{...e,balance:r2(e.balance-totalDeducted),transactions:[srcTx,...e.transactions]}:e)};
      if(!sameBank&&String(b.id)===String(destBankId))return{...b,balance:r2(b.balance+received),envelopes:b.envelopes.map(e=>String(e.id)===String(destEnv.id)?{...e,balance:r2(e.balance+received),transactions:[destTx,...e.transactions]}:e)};
      return b;
    }));
    setTransferBank(null);
    toast("success","Transfer recorded.");
  };
  const submitQuickTx=()=>{
    if(!quickTxEnvId){setQuickTxErr("Please select an envelope.");return;}
    if(!quickTx.desc){setQuickTxErr("Please enter a description.");return;}
    if(!quickTx.amount||parseFloat(quickTx.amount)<=0){setQuickTxErr("Please enter a valid amount greater than 0.");return;}
    const amt=parseFloat(quickTx.amount);
    const isIncome=quickTx.type==="income";
    const bankId=quickTxBank.id;
    if(reserveOn&&!isIncome){
      if(!reserveBankId||!reserveEnvId){setQuickTxErr("Please select where to reserve this amount.");return;}
      if(String(reserveBankId)===String(bankId)&&String(reserveEnvId)===String(quickTxEnvId)){setQuickTxErr("Reserve envelope must differ from the spending envelope.");return;}
      const reserveBankObj=banks.find(b=>String(b.id)===String(reserveBankId));
      if(reserveBankObj&&reserveBankObj.currency!==quickTxBank.currency){setQuickTxErr(`Reserve envelope must be in ${quickTxBank.currency} — the selected one is ${reserveBankObj.currency}.`);return;}
      const newTx={id:Date.now(),...quickTx,amount:amt};
      const reserveTx={id:Date.now()+1,type:"income",desc:`Reserved: ${quickTx.desc}`,amount:amt,tag:"Transfer",note:"",date:quickTx.date};
      const sameBank=String(bankId)===String(reserveBankId);
      setBanks(bs=>bs.map(b=>{
        if(sameBank&&String(b.id)===String(bankId)){
          return{...b,envelopes:b.envelopes.map(e=>{
            if(String(e.id)===String(quickTxEnvId))return{...e,balance:r2(e.balance-amt),transactions:[newTx,...e.transactions]};
            if(String(e.id)===String(reserveEnvId))return{...e,balance:r2(e.balance+amt),transactions:[reserveTx,...e.transactions]};
            return e;
          })};
        }
        if(!sameBank&&String(b.id)===String(bankId))return{...b,balance:r2(b.balance-amt),envelopes:b.envelopes.map(e=>String(e.id)===String(quickTxEnvId)?{...e,balance:r2(e.balance-amt),transactions:[newTx,...e.transactions]}:e)};
        if(!sameBank&&String(b.id)===String(reserveBankId))return{...b,balance:r2(b.balance+amt),envelopes:b.envelopes.map(e=>String(e.id)===String(reserveEnvId)?{...e,balance:r2(e.balance+amt),transactions:[reserveTx,...e.transactions]}:e)};
        return b;
      }));
    }else{
      const newTx={id:Date.now(),...quickTx,amount:amt};
      setBanks(bs=>bs.map(b=>String(b.id)!==String(bankId)?b:{...b,balance:r2(b.balance+(isIncome?amt:-amt)),envelopes:b.envelopes.map(e=>String(e.id)!==String(quickTxEnvId)?e:{...e,balance:r2(e.balance+(isIncome?amt:-amt)),transactions:[newTx,...e.transactions]})}));
    }
    setQuickTx({type:"expense",desc:"",amount:"",tag:"",note:"",date:localDateStr()});
    setQuickTxEnvId("");setQuickTxErr("");setQuickTxBank(null);
    setReserveOn(false);setReserveBankId("");setReserveEnvId("");
    toast("success","Transaction added.");
  };
  const historyTxsForBank=bank=>bank.envelopes.flatMap(e=>e.transactions.map(t=>({...t,bankId:bank.id,bankName:bank.name,bankCurrency:bank.currency,envId:e.id,envName:e.name,envEmoji:e.isUnalloc?"📂":(e.emoji||"🗂️")}))).sort((a,b)=>b.date.localeCompare(a.date)||b.id-a.id);
  const historyTxsAll=()=>banks.flatMap(b=>historyTxsForBank(b)).sort((a,b)=>b.date.localeCompare(a.date)||b.id-a.id);
  const saveHistTxEdit=updated=>{
    const{bankId,envId}=editHistTx;
    setBanks(bs=>bs.map(b=>{
      if(b.id!==bankId)return b;
      const env=b.envelopes.find(e=>e.id===envId);
      const old=env.transactions.find(t=>t.id===updated.id);
      const oldD=old.type==="income"?old.amount:-old.amount;
      const newD=updated.type==="income"?updated.amount:-updated.amount;
      const diff=newD-oldD;
      return{...b,balance:r2(b.balance+diff),envelopes:b.envelopes.map(e=>e.id!==envId?e:{...e,balance:r2(e.balance+diff),transactions:e.transactions.map(t=>t.id===updated.id?updated:t)})};
    }));
    setEditHistTx(null);
  };
  const delHistTx=()=>{
    const{bankId,envId,txId}=confirmDelHistTx;
    setBanks(bs=>bs.map(b=>{
      if(b.id!==bankId)return b;
      const env=b.envelopes.find(e=>e.id===envId);
      const t=env?.transactions.find(x=>x.id===txId);
      if(!t)return b;
      const delta=t.type==="income"?-t.amount:t.amount;
      return{...b,balance:r2(b.balance+delta),envelopes:b.envelopes.map(e=>e.id!==envId?e:{...e,balance:r2(e.balance+delta),transactions:e.transactions.filter(x=>x.id!==txId)})};
    }));
    setConfirmDelHistTx(null);
  };

  return(
    <div>
      <div style={{display:"flex",flexWrap:"wrap",justifyContent:"space-between",alignItems:"center",gap:10,marginBottom:16}}>
        <div style={{display:"flex",alignItems:"center",gap:8,flexWrap:"wrap"}}>
          <span style={{fontSize:18,fontWeight:700,color:T.text}}>All Banks</span>
          <select value={globalConv} onChange={e=>setGlobalConv(e.target.value)} style={{background:T.card,border:`1px solid ${T.border}`,borderRadius:6,padding:"3px 8px",color:T.faint,fontSize:12}}>
            <option value="">Convert →</option>{CURRENCY_LIST.map(c=><option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
          <Btn small outline color={T.subtext} onClick={()=>{setShowAllHist(true);setAllHistVisible(HIST_PAGE_SIZE);}}>📄 All Transactions</Btn>
          <Btn small color="#3B82F6" onClick={()=>setShowBank(true)}>+ Add Bank</Btn>
        </div>
      </div>
      {banks.length===0&&<div style={{color:T.faint,textAlign:"center",padding:32}}>No banks yet.</div>}
      {Object.entries(grouped).map(([currency,cBanks])=>{
        const total=cBanks.reduce((s,b)=>s+bankTotal(b),0);
        const gc=getCurrencyColor(currency);
        return(
          <div key={currency} style={{marginBottom:24}}>
            <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:10}}>
              <div style={{fontSize:13,fontWeight:600,color:gc}}>{currency} Banks</div>
              <div style={{fontSize:13,color:gc}}>{sym(currency)}{fmtNum(total)}</div>
              {globalConv&&<ConversionBadge amount={total} fromCurrency={currency} toCurrency={globalConv}/>}
            </div>
            <div style={{display:"flex",flexDirection:"column",gap:10}}>
              {cBanks.map(bk=>{
                const color=bankColor(bk);
                return(
                  <div key={bk.id} id={`bank-${bk.id}`} style={{background:T.card,borderRadius:12,border:`1px solid ${T.border}`,overflow:"hidden",scrollMarginTop:12}}>
                    <div style={{padding:"14px 16px",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                      <div style={{display:"flex",alignItems:"center",gap:10}}>
                        <div style={{width:4,height:36,borderRadius:2,background:color}}/>
                        <div>
                          <div style={{display:"flex",alignItems:"center",gap:6}}>
                            <div style={{fontWeight:600,fontSize:15,color:T.text}}>{bk.name}</div>
                            <button onClick={()=>setEditBank({id:bk.id,name:bk.name,balance:bankTotal(bk),color:bankColor(bk)})} style={{background:"none",border:"none",color:T.subtext,cursor:"pointer",fontSize:13,padding:0}}>✏️</button>
                          </div>
                          <div style={{fontSize:20,fontWeight:700,color,marginTop:2}}>{sym(bk.currency)}{fmtNum(bankTotal(bk))}{globalConv&&<ConversionBadge amount={bankTotal(bk)} fromCurrency={bk.currency} toCurrency={globalConv}/>}</div>
                          <div style={{fontSize:11,color:T.faint,marginTop:2}}>{(bk.envelopes||[]).length} envelopes</div>
                        </div>
                      </div>
                      <div style={{display:"flex",gap:6,alignItems:"center"}}>
                        <Btn small outline color={color} onClick={()=>{setQuickTxBank(bk);setQuickTxEnvId(bk.envelopes[0]?.id||"");}}>+</Btn>
                        <Btn small outline color={color} onClick={()=>{setShowBankHist(bk.id);setBankHistVisible(HIST_PAGE_SIZE);}}>📄</Btn>
                        <Btn small outline color={color} onClick={()=>setTransferBank(bk)}>⇄</Btn>
                        <Btn small outline color={color} onClick={()=>toggle(bk.id)}>{expandedSet[bk.id]?"▲":"▼"}</Btn>
                        <Btn small outline color="#ef4444" onClick={()=>setConfirmDel({id:bk.id,name:bk.name,hasContent:bankTotal(bk)!==0||bk.envelopes.some(e=>e.transactions.length>0)})}>🗑</Btn>
                      </div>
                    </div>
                    {expandedSet[bk.id]&&<div style={{borderTop:`1px solid ${T.border}`,padding:"12px 16px"}}><EnvelopeView bank={bk} bankId={bk.id} setBanks={setBanks} tags={tags}/></div>}
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
      {transferBank&&<TransferModal bank={transferBank} allBanks={banks} onClose={()=>setTransferBank(null)} onTransfer={doTransfer}/>}
      {quickTxBank&&<Modal title={`Add Transaction → ${quickTxBank.name}`} onClose={()=>{setQuickTxBank(null);setQuickTxErr("");setReserveOn(false);setReserveBankId("");setReserveEnvId("");}} isDirty={!!quickTx.desc||!!quickTx.amount}>
        <Sel label="Envelope" value={quickTxEnvId} onChange={e=>{setQuickTxEnvId(e.target.value);setQuickTxErr("");}}>
          {quickTxBank.envelopes.map(e=><option key={e.id} value={e.id}>{e.isUnalloc?"📂":(e.emoji||"🗂️")} {e.name}</option>)}
        </Sel>
        <div style={{display:"flex",gap:8,marginBottom:12}}>
          {["income","expense"].map(t=><Btn key={t} color={t==="income"?"#10B981":"#ef4444"} outline={quickTx.type!==t} onClick={()=>setQuickTx(x=>({...x,type:t}))} style={{flex:1,textTransform:"capitalize"}}>{t}</Btn>)}
        </div>
        <FormError msg={quickTxErr}/>
        <Inp label="Description" value={quickTx.desc} onChange={e=>{setQuickTxErr("");setQuickTx(x=>({...x,desc:e.target.value}));}} placeholder="e.g. Groceries"/>
        <Inp label="Amount" type="number" value={quickTx.amount} onChange={e=>{setQuickTxErr("");setQuickTx(x=>({...x,amount:e.target.value}));}} placeholder="0.00"/>
        <Sel label="Tag (optional)" value={quickTx.tag} onChange={e=>setQuickTx(x=>({...x,tag:e.target.value}))}>
          <option value="">No tag</option>{(tags||[]).map(t=><option key={t} value={t}>{t}</option>)}
        </Sel>
        <Inp label="Date" type="date" value={quickTx.date} onChange={e=>setQuickTx(x=>({...x,date:e.target.value}))}/>
        {quickTx.type==="expense"&&<div style={{background:T.card2,borderRadius:8,padding:10,marginBottom:12}}>
          <label style={{display:"flex",alignItems:"center",gap:8,fontSize:13,color:T.text,cursor:"pointer"}}>
            <input type="checkbox" checked={reserveOn} onChange={e=>{setReserveOn(e.target.checked);setQuickTxErr("");}}/>
            💳 Paid by credit card — reserve this amount
          </label>
          {reserveOn&&<div style={{marginTop:10}}>
            <div style={{fontSize:11,color:T.subtext,marginBottom:4}}>Reserve into</div>
            <div style={{display:"flex",gap:8}}>
              <select value={reserveBankId} onChange={e=>{setReserveBankId(e.target.value);setReserveEnvId("");setQuickTxErr("");}} style={{flex:1,background:T.input,border:`1px solid ${T.border}`,borderRadius:8,padding:"8px 10px",color:T.text,fontSize:14}}>
                <option value="">Select bank</option>
                {banks.map(b=><option key={b.id} value={String(b.id)}>{b.name} ({b.currency})</option>)}
              </select>
              <select value={reserveEnvId} onChange={e=>{setReserveEnvId(e.target.value);setQuickTxErr("");}} style={{flex:1,background:T.input,border:`1px solid ${T.border}`,borderRadius:8,padding:"8px 10px",color:T.text,fontSize:14}}>
                <option value="">Select envelope</option>
                {(banks.find(b=>String(b.id)===String(reserveBankId))?.envelopes||[]).map(e=><option key={e.id} value={e.id}>{e.name}</option>)}
              </select>
            </div>
          </div>}
        </div>}
        <Btn color={bankColor(quickTxBank)} onClick={submitQuickTx} style={{width:"100%"}}>Add Transaction</Btn>
      </Modal>}
      {showBankHist&&(()=>{
        const bank=banks.find(b=>b.id===showBankHist);
        if(!bank)return null;
        const txs=historyTxsForBank(bank);
        const visibleTxs=txs.slice(0,bankHistVisible);
        const remaining=txs.length-visibleTxs.length;
        return(
          <Modal title={`${bank.name} · All History`} onClose={()=>setShowBankHist(null)} isDirty={false}>
            {txs.length===0&&<div style={{color:T.faint,textAlign:"center",padding:16}}>No transactions yet.</div>}
            <div style={{display:"flex",flexDirection:"column",gap:8,maxHeight:420,overflowY:"auto"}}>
              {visibleTxs.map(t=>(
                <div key={t.id} style={{background:T.card2,borderRadius:8,padding:"8px 12px"}}>
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                    <div>
                      <div style={{fontSize:13,color:T.text}}>{t.desc}</div>
                      <div style={{fontSize:11,color:T.faint}}>{t.envEmoji} {t.envName} · {t.date}{t.tag?<span style={{marginLeft:6,background:T.card,borderRadius:4,padding:"1px 6px"}}>{t.tag}</span>:null}</div>
                      {t.note&&<div style={{fontSize:11,color:T.faint,marginTop:2,fontStyle:"italic"}}>{t.note}</div>}
                    </div>
                    <div style={{display:"flex",gap:6,alignItems:"center"}}>
                      <span style={{color:t.type==="income"?"#10B981":"#ef4444",fontWeight:600}}>{t.type==="income"?"+":"-"}{sym(t.bankCurrency)}{fmtNum(t.amount)}</span>
                      <button onClick={()=>setEditHistTx({bankId:t.bankId,envId:t.envId,tx:t})} style={{background:"none",border:"none",color:T.subtext,cursor:"pointer",fontSize:13}}>✏️</button>
                      <button onClick={()=>setConfirmDelHistTx({bankId:t.bankId,envId:t.envId,txId:t.id,desc:t.desc})} style={{background:"none",border:"none",color:"#ef4444",cursor:"pointer"}}>✕</button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
            {remaining>0&&<Btn small outline color={bankColor(bank)} onClick={()=>setBankHistVisible(v=>v+HIST_PAGE_SIZE)} style={{width:"100%",marginTop:10}}>Load {Math.min(remaining,HIST_PAGE_SIZE)} more ({remaining} left)</Btn>}
          </Modal>
        );
      })()}
      {showAllHist&&(()=>{
        const txs=historyTxsAll();
        const visibleTxs=txs.slice(0,allHistVisible);
        const remaining=txs.length-visibleTxs.length;
        return(
          <Modal title="All Transactions" onClose={()=>setShowAllHist(false)} isDirty={false}>
            {txs.length===0&&<div style={{color:T.faint,textAlign:"center",padding:16}}>No transactions yet.</div>}
            <div style={{display:"flex",flexDirection:"column",gap:8,maxHeight:420,overflowY:"auto"}}>
              {visibleTxs.map(t=>(
                <div key={`${t.bankId}-${t.id}`} style={{background:T.card2,borderRadius:8,padding:"8px 12px"}}>
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                    <div>
                      <div style={{fontSize:13,color:T.text}}>{t.desc}</div>
                      <div style={{fontSize:11,color:T.faint}}>{t.bankName} · {t.envEmoji} {t.envName} · {t.date}{t.tag?<span style={{marginLeft:6,background:T.card,borderRadius:4,padding:"1px 6px"}}>{t.tag}</span>:null}</div>
                      {t.note&&<div style={{fontSize:11,color:T.faint,marginTop:2,fontStyle:"italic"}}>{t.note}</div>}
                    </div>
                    <div style={{display:"flex",gap:6,alignItems:"center"}}>
                      <span style={{color:t.type==="income"?"#10B981":"#ef4444",fontWeight:600}}>{t.type==="income"?"+":"-"}{sym(t.bankCurrency)}{fmtNum(t.amount)}</span>
                      <button onClick={()=>setEditHistTx({bankId:t.bankId,envId:t.envId,tx:t})} style={{background:"none",border:"none",color:T.subtext,cursor:"pointer",fontSize:13}}>✏️</button>
                      <button onClick={()=>setConfirmDelHistTx({bankId:t.bankId,envId:t.envId,txId:t.id,desc:t.desc})} style={{background:"none",border:"none",color:"#ef4444",cursor:"pointer"}}>✕</button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
            {remaining>0&&<Btn small outline color={T.subtext} onClick={()=>setAllHistVisible(v=>v+HIST_PAGE_SIZE)} style={{width:"100%",marginTop:10}}>Load {Math.min(remaining,HIST_PAGE_SIZE)} more ({remaining} left)</Btn>}
          </Modal>
        );
      })()}
      {editHistTx&&<TxEditModal tx={editHistTx.tx} tags={tags} onSave={saveHistTxEdit} onClose={()=>setEditHistTx(null)}/>}
      {confirmDelHistTx&&<ConfirmModal message={`Delete transaction "${confirmDelHistTx.desc}"?`} onConfirm={delHistTx} onClose={()=>setConfirmDelHistTx(null)}/>}
      {confirmDel&&<ConfirmModal message={`Delete bank "${confirmDel.name}"?`} detail={confirmDel.hasContent?"All its envelopes and transaction history will be removed.":"It has no balance or history — this just removes the bank itself."} confirmLabel="Delete Bank" requireDel={confirmDel.hasContent} onConfirm={()=>delBank(confirmDel.id)} onClose={()=>setConfirmDel(null)}/>}
      {showBank&&<Modal title="Add Bank" onClose={()=>setShowBank(false)} isDirty={!!bankName||!!bankBal}>
        <Inp label="Bank Name" value={bankName} onChange={e=>setBankName(e.target.value)} placeholder="e.g. BDO, DBS, Chase"/>
        <Sel label="Currency" value={bankCurrency} onChange={e=>setBankCurrency(e.target.value)}>{CURRENCY_LIST.map(c=><option key={c} value={c}>{c} — {CURRENCY_SYMBOLS[c]}</option>)}</Sel>
        <div style={{fontSize:12,color:T.subtext,marginBottom:4}}>Color</div>
        <div style={{display:"flex",flexWrap:"wrap",gap:6,marginBottom:12}}>{BANK_COLOR_CHOICES.map(c=><button key={c} onClick={()=>setBankColorPick(c)} style={{width:28,height:28,borderRadius:8,background:c,border:bankColorPick===c?"3px solid #fff":"1px solid #00000033",cursor:"pointer"}}/>)}</div>
        <Inp label="Starting Balance" type="number" value={bankBal} onChange={e=>setBankBal(e.target.value)} placeholder="0.00"/>
        <Btn color={bankColorPick} onClick={addBank} style={{width:"100%"}}>Add Bank</Btn>
      </Modal>}
      {editBank&&<Modal title="Edit Bank" onClose={()=>setEditBank(null)} isDirty={true}>
        <Inp label="Bank Name" value={editBank.name} onChange={e=>setEditBank(v=>({...v,name:e.target.value}))}/>
        <Inp label="Total Balance (adjusts Unallocated)" type="number" value={editBank.balance} onChange={e=>setEditBank(v=>({...v,balance:e.target.value}))}/>
        <div style={{fontSize:12,color:T.subtext,marginBottom:4}}>Color</div>
        <div style={{display:"flex",flexWrap:"wrap",gap:6,marginBottom:12}}>{BANK_COLOR_CHOICES.map(c=><button key={c} onClick={()=>setEditBank(v=>({...v,color:c}))} style={{width:28,height:28,borderRadius:8,background:c,border:editBank.color===c?"3px solid #fff":"1px solid #00000033",cursor:"pointer"}}/>)}</div>
        <Btn color={editBank.color} onClick={saveBankEdit} style={{width:"100%"}}>Save</Btn>
      </Modal>}
    </div>
  );
}
function subGain(s){const g=s.value-(s.cost||0);const pct=s.cost?(g/s.cost*100):0;return{g,pct};}
function subATHATL(s){const vals=(s.history||[]).map(h=>h.value);if(!vals.length)return{ath:s.value,atl:s.value};return{ath:Math.max(...vals),atl:Math.min(...vals)};}
function invTotals(inv){const items=inv.items||[];const value=items.reduce((s,i)=>s+(i.value||0),0);const cost=items.reduce((s,i)=>s+(i.cost||0),0);const g=value-cost;const pct=cost?(g/cost*100):0;return{value,cost,g,pct};}

function BucketBlock({bucket,invs,bucketItems,overviewCur,onAddItem,onEditInv,onDelInv,onEditItem,onDelItem,onHist,updateValOf,setUpdateValOf,newVal,setNewVal,recordValue}){
  const bucketTotal=useMultiConvert(bucketItems,overviewCur);
  return(
    <div style={{marginBottom:20}}>
      <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:8}}>
        <div style={{fontSize:14,fontWeight:700,color:"#8B5CF6"}}>{bucket}</div>
        <div style={{fontSize:13,color:T.subtext}}>{bucketTotal===null?"…":`${sym(overviewCur)}${fmtNum(bucketTotal)}`}</div>
      </div>
      <div style={{display:"flex",flexDirection:"column",gap:10}}>
        {invs.map(inv=>{
          const tot=invTotals(inv);const up=tot.g>=0;
          return(
            <div key={inv.id} style={{background:T.card,borderRadius:12,border:`1px solid ${T.border}`,padding:14}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:8}}>
                <div>
                  <div style={{display:"flex",alignItems:"center",gap:6}}>
                    <div style={{fontWeight:600,color:T.text,fontSize:15}}>{inv.name}</div>
                    <button onClick={()=>onEditInv({id:inv.id,name:inv.name,bucket:inv.bucket})} style={{background:"none",border:"none",color:T.subtext,cursor:"pointer",fontSize:13,padding:0}}>✏️</button>
                  </div>
                  <div style={{fontSize:12,color:T.subtext,marginTop:2}}>Value {fmtNum(tot.value)} · Cost {fmtNum(tot.cost)} · <span style={{color:up?"#10B981":"#ef4444",fontWeight:600}}>{up?"+":""}{tot.pct.toFixed(1)}%</span></div>
                </div>
                <div style={{display:"flex",gap:4}}>
                  <Btn small color="#8B5CF6" onClick={()=>onAddItem(inv.id)}>+ Holding</Btn>
                  <Btn small outline color="#ef4444" onClick={()=>onDelInv({id:inv.id,name:inv.name})}>🗑</Btn>
                </div>
              </div>
              <div style={{display:"flex",flexDirection:"column",gap:6}}>
                {(inv.items||[]).map(it=>{
                  const{g,pct}=subGain(it);const u=g>=0;const{ath,atl}=subATHATL(it);
                  return(
                    <div key={it.id} style={{background:T.card2,borderRadius:8,padding:"10px 12px"}}>
                      <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start"}}>
                        <div style={{flex:1}}>
                          <div style={{fontSize:13,fontWeight:600,color:T.text,display:"flex",alignItems:"center",gap:6}}>
                            <span>{it.name} <span style={{fontSize:11,color:T.faint}}>· {it.currency}</span></span>
                            <button onClick={()=>onEditItem({invId:inv.id,item:{...it}})} style={{background:"none",border:"none",color:T.subtext,cursor:"pointer",fontSize:12,padding:0}}>✏️</button>
                          </div>
                          {it.notes&&<div style={{fontSize:11,color:T.subtext}}>{it.notes}</div>}
                          <div style={{display:"flex",gap:10,marginTop:4,fontSize:11,flexWrap:"wrap"}}>
                            <span style={{color:T.subtext}}>Cost {sym(it.currency)}{fmtNum(it.cost)}</span>
                            <span style={{color:T.text}}>Val {sym(it.currency)}{fmtNum(it.value)}</span>
                            <span style={{color:u?"#10B981":"#ef4444",fontWeight:600}}>{u?"▲":"▼"}{sym(it.currency)}{fmtNum(Math.abs(g))} ({u?"+":""}{pct.toFixed(1)}%)</span>
                          </div>
                          <div style={{fontSize:10,color:T.faint,marginTop:2}}>ATH {sym(it.currency)}{fmtNum(ath)} · ATL {sym(it.currency)}{fmtNum(atl)}</div>
                        </div>
                        <div style={{display:"flex",flexDirection:"column",gap:3,alignItems:"flex-end"}}>
                          <Btn small color="#8B5CF6" onClick={()=>{setUpdateValOf({invId:inv.id,itemId:it.id});setNewVal(String(it.value));}}>Update</Btn>
                          <div style={{display:"flex",gap:3}}>
                            <Btn small outline color={T.subtext} onClick={()=>onHist({invId:inv.id,itemId:it.id})}>📄</Btn>
                            <Btn small outline color="#ef4444" onClick={()=>onDelItem({invId:inv.id,itemId:it.id,name:it.name})}>🗑</Btn>
                          </div>
                        </div>
                      </div>
                      {updateValOf&&updateValOf.invId===inv.id&&updateValOf.itemId===it.id&&(
                        <div style={{display:"flex",gap:6,marginTop:8}}>
                          <input type="number" value={newVal} onChange={e=>setNewVal(e.target.value)} placeholder="New market value" style={{flex:1,background:T.input,border:`1px solid ${T.border}`,borderRadius:8,padding:"5px 10px",color:T.text,fontSize:12}}/>
                          <Btn small color="#10B981" onClick={()=>recordValue(inv.id,it.id)}>Save</Btn>
                          <Btn small outline color={T.subtext} onClick={()=>setUpdateValOf(null)}>×</Btn>
                        </div>
                      )}
                    </div>
                  );
                })}
                {(inv.items||[]).length===0&&<div style={{fontSize:12,color:T.faint,textAlign:"center",padding:8}}>No holdings yet — add one.</div>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function InvestmentsSection({investments,setInvestments,hideTotals}){
  const[showAddInv,setShowAddInv]=useState(false);
  const[editInv,setEditInv]=useState(null);
  const[confirmDelInv,setConfirmDelInv]=useState(null);
  const[addItemTo,setAddItemTo]=useState(null);
  const[editItem,setEditItem]=useState(null);
  const[confirmDelItem,setConfirmDelItem]=useState(null);
  const[showHist,setShowHist]=useState(null);
  const[updateValOf,setUpdateValOf]=useState(null);
  const[newVal,setNewVal]=useState("");
  const[invForm,setInvForm]=useState({name:"",bucket:"Stocks"});
  const[itemForm,setItemForm]=useState({name:"",currency:"USD",cost:"",value:"",notes:""});
  const[overviewCur,setOverviewCur]=useState("USD");

  const addInv=()=>{if(!invForm.name)return;setInvestments(i=>[...i,{id:Date.now(),name:invForm.name,bucket:invForm.bucket,items:[]}]);setInvForm({name:"",bucket:"Stocks"});setShowAddInv(false);};
  const saveInvEdit=()=>{setInvestments(invs=>invs.map(x=>x.id!==editInv.id?x:{...x,name:editInv.name,bucket:editInv.bucket}));setEditInv(null);};
  const delInv=id=>{setInvestments(i=>i.filter(x=>x.id!==id));setConfirmDelInv(null);};
  const addItem=()=>{
    if(!itemForm.name)return;
    const v=parseFloat(itemForm.value)||0;
    setInvestments(invs=>invs.map(x=>x.id!==addItemTo?x:{...x,items:[...(x.items||[]),{id:Date.now(),name:itemForm.name,currency:itemForm.currency,cost:parseFloat(itemForm.cost)||0,value:v,notes:itemForm.notes,history:[{value:v,date:new Date().toISOString()}]}]}));
    setItemForm({name:"",currency:"USD",cost:"",value:"",notes:""});
    setAddItemTo(null);
  };
  const saveItemEdit=()=>{
    const{invId,item}=editItem;
    const newMV=parseFloat(item.value);
    setInvestments(invs=>invs.map(x=>x.id!==invId?x:{...x,items:x.items.map(it=>{
      if(it.id!==item.id)return it;
      const valueChanged=!isNaN(newMV)&&newMV!==it.value;
      return{...it,name:item.name,currency:item.currency,cost:parseFloat(item.cost)||0,notes:item.notes,value:!isNaN(newMV)?newMV:it.value,history:valueChanged?[...(it.history||[]),{value:newMV,date:new Date().toISOString()}]:it.history};
    })}));
    setEditItem(null);
  };
  const delItem=(invId,itemId)=>{setInvestments(invs=>invs.map(x=>x.id!==invId?x:{...x,items:x.items.filter(it=>it.id!==itemId)}));setConfirmDelItem(null);};
  const recordValue=(invId,itemId)=>{
    const v=parseFloat(newVal);if(isNaN(v))return;
    setInvestments(invs=>invs.map(x=>x.id!==invId?x:{...x,items:x.items.map(it=>it.id!==itemId?it:{...it,value:v,history:[...(it.history||[]),{value:v,date:new Date().toISOString()}]})}));
    setNewVal("");setUpdateValOf(null);
  };

  const grouped=investments.reduce((acc,inv)=>{(acc[inv.bucket||"Other"]=acc[inv.bucket||"Other"]||[]).push(inv);return acc;},{});
  const allItems=investments.flatMap(inv=>(inv.items||[]).map(it=>({amount:it.value,currency:it.currency})));
  const allCostItems=investments.flatMap(inv=>(inv.items||[]).map(it=>({amount:it.cost||0,currency:it.currency})));
  const grandValue=useMultiConvert(allItems,overviewCur);
  const grandCost=useMultiConvert(allCostItems,overviewCur);
  const grandGain=(grandValue!==null&&grandCost!==null)?grandValue-grandCost:null;
  const grandPct=(grandGain!==null&&grandCost)?(grandGain/grandCost*100):null;
  const histItem=(()=>{if(!showHist)return null;const inv=investments.find(i=>i.id===showHist.invId);return inv?.items.find(it=>it.id===showHist.itemId);})();

  return(
    <div>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16}}>
        <span style={{fontSize:18,fontWeight:700,color:T.text}}>Investments</span>
        <Btn color="#8B5CF6" onClick={()=>setShowAddInv(true)}>+ Add</Btn>
      </div>
      <div style={{background:"linear-gradient(135deg,#8B5CF6,#EC4899)",borderRadius:14,padding:18,marginBottom:20,color:"#fff"}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start"}}>
          <div>
            <div style={{fontSize:13,opacity:0.85}}>Total Investments</div>
            <div style={{fontSize:26,fontWeight:800,marginTop:2}}>{hideTotals?"••••••":(grandValue===null?"…":`${sym(overviewCur)}${fmtNum(grandValue)}`)}</div>
            {grandGain!==null&&!hideTotals&&<div style={{fontSize:13,marginTop:4,opacity:0.95}}>{grandGain>=0?"▲":"▼"} {sym(overviewCur)}{fmtNum(Math.abs(grandGain))} ({grandGain>=0?"+":""}{grandPct?.toFixed(1)}%)</div>}
          </div>
          <select value={overviewCur} onChange={e=>setOverviewCur(e.target.value)} style={{background:"rgba(255,255,255,0.2)",border:"1px solid rgba(255,255,255,0.3)",borderRadius:8,padding:"6px 10px",color:"#fff",fontSize:14}}>
            {CURRENCY_LIST.map(c=><option key={c} value={c} style={{color:"#000"}}>{c}</option>)}
          </select>
        </div>
      </div>
      {investments.length===0&&<div style={{color:T.faint,textAlign:"center",padding:32}}>No investments yet.</div>}
      {Object.entries(grouped).map(([bucket,invs])=>{
        const bucketItems=invs.flatMap(inv=>(inv.items||[]).map(it=>({amount:it.value,currency:it.currency})));
        return(<BucketBlock key={bucket} bucket={bucket} invs={invs} bucketItems={bucketItems} overviewCur={overviewCur} onAddItem={setAddItemTo} onEditInv={setEditInv} onDelInv={setConfirmDelInv} onEditItem={setEditItem} onDelItem={setConfirmDelItem} onHist={setShowHist} updateValOf={updateValOf} setUpdateValOf={setUpdateValOf} newVal={newVal} setNewVal={setNewVal} recordValue={recordValue}/>);
      })}
      {confirmDelInv&&<ConfirmModal message={`Delete investment "${confirmDelInv.name}"?`} detail="All its holdings and history will be removed." requireDel onConfirm={()=>delInv(confirmDelInv.id)} onClose={()=>setConfirmDelInv(null)}/>}
      {confirmDelItem&&<ConfirmModal message={`Delete holding "${confirmDelItem.name}"?`} requireDel onConfirm={()=>delItem(confirmDelItem.invId,confirmDelItem.itemId)} onClose={()=>setConfirmDelItem(null)}/>}
      {showAddInv&&<Modal title="Add Investment" onClose={()=>setShowAddInv(false)} isDirty={!!invForm.name}><Inp label="Name" value={invForm.name} onChange={e=>setInvForm(f=>({...f,name:e.target.value}))} placeholder="e.g. Crypto Portfolio"/><Sel label="Bucket" value={invForm.bucket} onChange={e=>setInvForm(f=>({...f,bucket:e.target.value}))}>{INVESTMENT_BUCKETS.map(b=><option key={b} value={b}>{b}</option>)}</Sel><Btn color="#8B5CF6" onClick={addInv} style={{width:"100%"}}>Add Investment</Btn></Modal>}
      {editInv&&<Modal title="Edit Investment" onClose={()=>setEditInv(null)} isDirty={true}><Inp label="Name" value={editInv.name} onChange={e=>setEditInv(v=>({...v,name:e.target.value}))}/><Sel label="Bucket" value={editInv.bucket} onChange={e=>setEditInv(v=>({...v,bucket:e.target.value}))}>{INVESTMENT_BUCKETS.map(b=><option key={b} value={b}>{b}</option>)}</Sel><Btn color="#8B5CF6" onClick={saveInvEdit} style={{width:"100%"}}>Save</Btn></Modal>}
      {addItemTo&&<Modal title="Add Holding" onClose={()=>setAddItemTo(null)} isDirty={!!itemForm.name||!!itemForm.value}><Inp label="Name" value={itemForm.name} onChange={e=>setItemForm(f=>({...f,name:e.target.value}))} placeholder="e.g. BTC, AAPL, Rolex Sub"/><Sel label="Currency" value={itemForm.currency} onChange={e=>setItemForm(f=>({...f,currency:e.target.value}))}>{CURRENCY_LIST.map(c=><option key={c} value={c}>{c} — {CURRENCY_SYMBOLS[c]}</option>)}</Sel><Inp label="Amount Invested (cost)" type="number" value={itemForm.cost} onChange={e=>setItemForm(f=>({...f,cost:e.target.value}))} placeholder="0.00"/><Inp label="Current Market Value" type="number" value={itemForm.value} onChange={e=>setItemForm(f=>({...f,value:e.target.value}))} placeholder="0.00"/><Inp label="Notes (optional)" value={itemForm.notes} onChange={e=>setItemForm(f=>({...f,notes:e.target.value}))}/><Btn color="#8B5CF6" onClick={addItem} style={{width:"100%"}}>Add Holding</Btn></Modal>}
      {editItem&&<Modal title="Edit Holding" onClose={()=>setEditItem(null)} isDirty={true}><Inp label="Name" value={editItem.item.name} onChange={e=>setEditItem(v=>({...v,item:{...v.item,name:e.target.value}}))}/><Sel label="Currency" value={editItem.item.currency} onChange={e=>setEditItem(v=>({...v,item:{...v.item,currency:e.target.value}}))}>{CURRENCY_LIST.map(c=><option key={c} value={c}>{c} — {CURRENCY_SYMBOLS[c]}</option>)}</Sel><Inp label="Amount Invested (cost)" type="number" value={editItem.item.cost} onChange={e=>setEditItem(v=>({...v,item:{...v.item,cost:e.target.value}}))}/><Inp label="Current Market Value (logs to history)" type="number" value={editItem.item.value} onChange={e=>setEditItem(v=>({...v,item:{...v.item,value:e.target.value}}))}/><Inp label="Notes" value={editItem.item.notes||""} onChange={e=>setEditItem(v=>({...v,item:{...v.item,notes:e.target.value}}))}/><Btn color="#8B5CF6" onClick={saveItemEdit} style={{width:"100%"}}>Save</Btn></Modal>}
      {showHist&&<Modal title={`${histItem?.name} · Value History`} onClose={()=>setShowHist(null)} isDirty={false}>
        {(!histItem?.history||histItem.history.length===0)&&<div style={{color:T.faint,textAlign:"center",padding:16}}>No history.</div>}
        <div style={{display:"flex",flexDirection:"column",gap:6,maxHeight:320,overflowY:"auto"}}>
          {[...(histItem?.history||[])].reverse().map((h,i)=>(<div key={i} style={{display:"flex",justifyContent:"space-between",background:T.card2,borderRadius:8,padding:"8px 12px",fontSize:13}}><span style={{color:T.subtext}}>{localDateTimeStr(new Date(h.date))}</span><span style={{color:T.text,fontWeight:600}}>{sym(histItem.currency)}{fmtNum(h.value)}</span></div>))}
        </div>
      </Modal>}
    </div>
  );
}

function LineAreaChart({data,color="#3B82F6"}){
  const gradId=useId();
  if(!data||data.length<2)return<div style={{color:T.faint,textAlign:"center",padding:16,fontSize:13}}>Not enough history yet.</div>;
  const W=380,H=90,padTop=6,padBottom=14;
  const values=data.map(d=>d.value);
  const min=Math.min(...values),max=Math.max(...values);
  const range=(max-min)||Math.abs(max)||1;
  const stepX=W/(data.length-1);
  const pts=data.map((d,i)=>[i*stepX,H-padBottom-((d.value-min)/range)*(H-padTop-padBottom)]);
  const linePath="M"+pts.map(p=>p.join(",")).join(" L");
  const areaPath=`${linePath} L${W},${H} L0,${H} Z`;
  return(
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} preserveAspectRatio="none" style={{overflow:"visible"}}>
        <defs><linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={color} stopOpacity="0.35"/><stop offset="100%" stopColor={color} stopOpacity="0"/></linearGradient></defs>
        <path d={areaPath} fill={`url(#${gradId})`}/>
        <path d={linePath} fill="none" stroke={color} strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round"/>
        <circle cx={pts[pts.length-1][0]} cy={pts[pts.length-1][1]} r="4" fill={color}/>
      </svg>
      <div style={{display:"flex",justifyContent:"space-between",fontSize:10,color:T.faint,marginTop:2}}>
        {data.map((d,i)=><span key={i}>{d.label}</span>)}
      </div>
    </div>
  );
}
// Reconstructs past net worth from present balances minus every recorded
// transaction dated after each cutoff — no historical snapshots need to
// exist for this to work. It's an approximation where balance changes
// happened outside a transaction (a manual bank-total edit), and in "All"
// mode it converts every point at TODAY's rate rather than the rate on
// that historical date (no historical-FX source available) — both are
// disclosed in the UI rather than presented as exact.
function useNetWorthTrend(scopedBanks,isAll,targetCur,retryTick){
  const[trend,setTrend]=useState(null);
  const key=JSON.stringify(scopedBanks.map(b=>({c:b.currency,bal:bankTotal(b),tx:b.envelopes.flatMap(e=>e.transactions.map(t=>[t.date,t.type,t.amount]))})));
  useEffect(()=>{
    let active=true;
    (async()=>{
      const today=new Date();
      const cutoffs=[];
      for(let i=5;i>=1;i--){const d=new Date(today.getFullYear(),today.getMonth()-i+1,0);cutoffs.push({label:d.toLocaleDateString(undefined,{month:"short"}),date:d.toISOString().slice(0,10)});}
      cutoffs.push({label:"Now",date:localDateStr()});
      const currentItems=scopedBanks.map(b=>({amount:bankTotal(b),currency:b.currency}));
      const txItems=scopedBanks.flatMap(b=>b.envelopes.flatMap(e=>e.transactions.map(t=>({date:t.date,amount:t.type==="income"?t.amount:-t.amount,currency:b.currency}))));
      let convCurrentTotal=0,convTx=txItems,ok=true;
      if(isAll){
        for(const it of currentItems){const r=await fetchRate(it.currency,targetCur);if(r===null){ok=false;break;}convCurrentTotal+=it.amount*r;}
        if(ok){convTx=[];for(const t of txItems){const r=await fetchRate(t.currency,targetCur);if(r===null){ok=false;break;}convTx.push({...t,amount:t.amount*r});}}
      }else convCurrentTotal=currentItems.reduce((s,it)=>s+it.amount,0);
      if(!active)return;
      if(!ok){setTrend(null);return;}
      setTrend(cutoffs.map(c=>({label:c.label,value:r2(convCurrentTotal-convTx.filter(t=>t.date>c.date).reduce((s,t)=>s+t.amount,0))})));
    })();
    return()=>{active=false;};
  // eslint-disable-next-line
  },[key,isAll,targetCur,retryTick]);
  return trend;
}
function shiftPeriod(from,to){
  const f=new Date(from+"T00:00:00"),t=new Date(to+"T00:00:00");
  const lenDays=Math.round((t-f)/86400000)+1;
  const prevTo=new Date(f.getTime()-86400000);
  const prevFrom=new Date(prevTo.getTime()-(lenDays-1)*86400000);
  return{prevFrom:prevFrom.toISOString().slice(0,10),prevTo:prevTo.toISOString().slice(0,10)};
}
const untaggedKey=(bankId,envId,txId)=>`${bankId}:${envId}:${txId}`;
const normDesc=d=>(d||"").trim().toLowerCase();
function collectUntagged(banks){
  const out=[];
  banks.forEach(b=>b.envelopes.forEach(e=>e.transactions.forEach(t=>{
    if(t.tag)return;
    out.push({key:untaggedKey(b.id,e.id,t.id),tx:t,bank:b,env:e});
  })));
  return out;
}
// Most-used tag per description across everything already tagged — a plain
// lookup over the user's own history, used to suggest a chip.
function suggestionMap(banks){
  const counts={};
  banks.forEach(b=>b.envelopes.forEach(e=>e.transactions.forEach(t=>{
    if(!t.tag||t.tag==="Transfer")return;
    const k=normDesc(t.desc);if(!k)return;
    counts[k]=counts[k]||{};counts[k][t.tag]=(counts[k][t.tag]||0)+1;
  })));
  const out={};
  Object.entries(counts).forEach(([k,m])=>{out[k]=Object.entries(m).sort((a,b)=>b[1]-a[1])[0][0];});
  return out;
}
function OrganizeUntaggedModal({banks,setBanks,tags,setTags,onClose}){
  const[queue]=useState(()=>collectUntagged(banks).sort((a,b)=>b.tx.amount-a.tx.amount));
  const[suggest]=useState(()=>suggestionMap(banks));
  const[handled,setHandled]=useState(()=>new Set());
  const[history,setHistory]=useState([]);
  const[picked,setPicked]=useState(null);
  const[applyAll,setApplyAll]=useState(true);
  const[addingNew,setAddingNew]=useState(false);
  const[newTag,setNewTag]=useState("");
  const pending=queue.filter(q=>!handled.has(q.key));
  const cur=pending[0];
  const total=queue.length;
  const taggedN=history.filter(h=>!h.skipped).reduce((n,h)=>n+h.keys.length,0);
  const skippedN=history.filter(h=>h.skipped).length;
  const similar=cur?pending.filter(q=>q.key!==cur.key&&normDesc(q.tx.desc)===normDesc(cur.tx.desc)):[];
  const chipTags=tags.filter(t=>t!=="Transfer");
  const suggested=cur?suggest[normDesc(cur.tx.desc)]:null;
  const markHandled=keys=>setHandled(h=>{const n=new Set(h);keys.forEach(k=>n.add(k));return n;});
  const setTagFor=(keys,tag)=>{
    const ks=new Set(keys);
    setBanks(bs=>bs.map(b=>({...b,envelopes:b.envelopes.map(e=>({...e,transactions:e.transactions.map(t=>ks.has(untaggedKey(b.id,e.id,t.id))?{...t,tag}:t)}))})));
  };
  const ok=()=>{
    if(!picked)return;
    const keys=[cur.key,...(applyAll?similar.map(q=>q.key):[])];
    setTagFor(keys,picked);
    if(!tags.includes(picked))setTags(t=>[...t,picked]);
    markHandled(keys);setHistory(h=>[...h,{keys}]);setPicked(null);setAddingNew(false);
  };
  const skip=()=>{markHandled([cur.key]);setHistory(h=>[...h,{keys:[cur.key],skipped:true}]);setPicked(null);setAddingNew(false);};
  const undo=()=>{
    const last=history[history.length-1];if(!last)return;
    if(!last.skipped)setTagFor(last.keys,"");
    setHandled(h=>{const n=new Set(h);last.keys.forEach(k=>n.delete(k));return n;});
    setHistory(h=>h.slice(0,-1));setPicked(null);
  };
  const addNew=()=>{const t=newTag.trim();if(!t)return;setPicked(t);setAddingNew(false);setNewTag("");};
  const chip=(active,dashed,suggestedChip)=>({border:`1.5px ${dashed?"dashed":"solid"} ${active?"#3B82F6":suggestedChip?"#8B5CF6":T.border}`,background:active?"#3B82F6":T.card2,color:active?"#fff":dashed?T.subtext:T.text,borderRadius:99,padding:"7px 13px",fontSize:13,fontWeight:600,cursor:"pointer"});
  const curSym=cur?sym(cur.bank.currency):"";
  return(
    <Modal title="Organize untagged" onClose={onClose} isDirty={false}>
      {total===0&&<div style={{textAlign:"center",padding:"20px 0",color:T.subtext,fontSize:14}}>🎉 Nothing untagged — every transaction has a tag.</div>}
      {total>0&&!cur&&<div style={{textAlign:"center",padding:"12px 0"}}>
        <div style={{fontSize:36,marginBottom:8}}>🎉</div>
        <div style={{fontSize:17,fontWeight:800,color:T.text,marginBottom:6}}>All sorted</div>
        <div style={{fontSize:13,color:T.subtext,lineHeight:1.5,marginBottom:16}}>{taggedN} tagged{skippedN?`, ${skippedN} skipped`:""}.</div>
        <div style={{display:"flex",gap:8,justifyContent:"center"}}>
          {history.length>0&&<Btn small outline color={T.subtext} onClick={undo}>↩ Undo last</Btn>}
          <Btn small color="#3B82F6" onClick={onClose}>Done</Btn>
        </div>
      </div>}
      {cur&&<div>
        <div style={{display:"flex",justifyContent:"space-between",fontSize:12,color:T.subtext,marginBottom:6}}><span><b style={{color:T.text}}>{handled.size+1}</b> of {total}</span><span>Biggest first</span></div>
        <div style={{background:T.card2,borderRadius:8,height:8,overflow:"hidden",marginBottom:16}}><div style={{width:`${(handled.size/total)*100}%`,height:"100%",background:"linear-gradient(90deg,#3B82F6,#8B5CF6)",borderRadius:8,transition:"width .3s ease"}}/></div>
        <span style={{display:"inline-block",fontSize:10.5,fontWeight:800,letterSpacing:".05em",textTransform:"uppercase",padding:"3px 8px",borderRadius:6,marginBottom:10,background:cur.tx.type==="income"?"#10B98118":"#ef444418",color:cur.tx.type==="income"?"#10B981":"#ef4444"}}>{cur.tx.type==="income"?"Income":"Expense"}</span>
        <div style={{fontSize:18,fontWeight:800,color:T.text,marginBottom:2,wordBreak:"break-word"}}>{cur.tx.desc||"(no description)"}</div>
        <div style={{fontSize:22,fontWeight:800,fontVariantNumeric:"tabular-nums",marginBottom:6,color:cur.tx.type==="income"?"#10B981":"#ef4444"}}>{cur.tx.type==="income"?"+":"−"}{curSym}{fmtNum(cur.tx.amount)}</div>
        <div style={{fontSize:11.5,color:T.faint,lineHeight:1.5,marginBottom:16}}>{cur.bank.name} · {cur.env.name} · {cur.tx.date}{cur.tx.note?` · ${cur.tx.note}`:""}</div>
        <div style={{display:"flex",justifyContent:"space-between",fontSize:11,color:T.subtext,marginBottom:8}}><span>Pick a tag</span>{suggested&&<span style={{color:"#8B5CF6"}}>✨ from your history</span>}</div>
        <div style={{display:"flex",flexWrap:"wrap",gap:8,marginBottom:14}}>
          {chipTags.map(g=><button key={g} onClick={()=>setPicked(g)} style={chip(picked===g,false,g===suggested)}>{g===suggested?"✨ ":""}{g}</button>)}
          {picked&&!chipTags.includes(picked)&&<button style={chip(true,false,false)}>{picked}</button>}
          {!addingNew&&<button onClick={()=>setAddingNew(true)} style={chip(false,true,false)}>+ New</button>}
        </div>
        {addingNew&&<div style={{display:"flex",gap:8,marginBottom:14}}>
          <input autoFocus value={newTag} onChange={e=>setNewTag(e.target.value)} onKeyDown={e=>e.key==="Enter"&&addNew()} placeholder="New tag name" style={{flex:1,background:T.input,border:`1px solid ${T.border}`,borderRadius:8,padding:"8px 10px",color:T.text,fontSize:14}}/>
          <Btn small color="#3B82F6" onClick={addNew}>Add</Btn>
        </div>}
        {similar.length>0&&<label style={{display:"flex",alignItems:"center",gap:8,background:T.card2,borderRadius:10,padding:"10px 12px",fontSize:12,color:T.subtext,marginBottom:14,cursor:"pointer"}}>
          <input type="checkbox" checked={applyAll} onChange={e=>setApplyAll(e.target.checked)}/>
          <span>Also tag the <b style={{color:T.text}}>{similar.length} other</b> untagged “{cur.tx.desc}” transaction{similar.length!==1?"s":""}</span>
        </label>}
        <div style={{display:"flex",gap:8}}>
          <Btn outline color={T.subtext} onClick={skip} style={{flex:1}}>Skip</Btn>
          <Btn color="#3B82F6" onClick={ok} disabled={!picked} style={{flex:1,opacity:picked?1:0.4,cursor:picked?"pointer":"not-allowed"}}>OK</Btn>
        </div>
        {history.length>0&&<div style={{textAlign:"center",marginTop:12}}><button onClick={undo} style={{background:"none",border:"none",color:T.faint,fontSize:12,cursor:"pointer",textDecoration:"underline"}}>↩ Undo last</button></div>}
      </div>}
    </Modal>
  );
}
function AnalyticsSection({banks,setBanks,tags,setTags,prefs,setPrefs,onOpenBank}){
  const today=new Date();
  const firstOfMonth=new Date(today.getFullYear(),today.getMonth(),1).toISOString().slice(0,10);
  const[from,setFrom]=useState(firstOfMonth);
  const[to,setTo]=useState(localDateStr());
  const[retryTick,setRetryTick]=useState(0);
  const rateHealthy=useRateHealth();
  const allObservations=computeObservations(banks);
  const[showOrganize,setShowOrganize]=useState(false);
  const untaggedAll=collectUntagged(banks);
  const untaggedSpend={},untaggedIncome={};
  untaggedAll.forEach(({tx,bank})=>{const m=tx.type==="income"?untaggedIncome:untaggedSpend;m[bank.currency]=(m[bank.currency]||0)+tx.amount;});
  const fmtByCur=m=>Object.entries(m).map(([c,v])=>`${sym(c)}${fmtNum(v)}`).join(" · ");

  // Currency-first: pick a native currency and everything computes with zero
  // network dependency (no FX call can ever break it). "All (converted)" is
  // an opt-in mode for a cross-currency view, and is the only mode that can
  // hit the exchange-rate API.
  const currencies=[...new Set(banks.map(b=>b.currency))];
  const currencyTab=(prefs.currency&&(prefs.currency==="ALL"||currencies.includes(prefs.currency)))?prefs.currency:(currencies[0]||"ALL");
  const isAll=currencyTab==="ALL";
  const setCurrencyTab=c=>setPrefs(p=>({...p,currency:c}));
  const targetCur=isAll?(prefs.allTargetCurrency||currencies[0]||"USD"):currencyTab;
  const setAllTarget=c=>setPrefs(p=>({...p,allTargetCurrency:c}));

  const tabBanks=isAll?banks:banks.filter(b=>b.currency===currencyTab);
  const accountIds=tabBanks.map(b=>String(b.id));
  const savedAccounts=Array.isArray(prefs.accounts)?prefs.accounts.filter(id=>accountIds.includes(id)):[];
  const activeAccounts=savedAccounts.length?savedAccounts:accountIds;
  const allSelected=activeAccounts.length===accountIds.length;
  const toggleAccount=id=>{
    const base=(Array.isArray(prefs.accounts)?prefs.accounts:accountIds).filter(x=>accountIds.includes(x));
    const next=base.includes(id)?base.filter(x=>x!==id):[...base,id];
    setPrefs(p=>({...p,accounts:next}));
  };
  const selectAllAccounts=()=>setPrefs(p=>({...p,accounts:accountIds}));
  const scopedBanks=tabBanks.filter(b=>activeAccounts.includes(String(b.id)));

  const{prevFrom,prevTo}=shiftPeriod(from,to);
  const rawTx=scopedBanks.flatMap(b=>b.envelopes.flatMap(e=>e.transactions.map(t=>({...t,currency:b.currency})))).filter(t=>t.tag!=="Transfer");
  const rangeTxRaw=rawTx.filter(t=>t.date>=from&&t.date<=to);
  const prevRangeTxRaw=rawTx.filter(t=>t.date>=prevFrom&&t.date<=prevTo);

  const rangeConverted=useConvertedItems(isAll?rangeTxRaw:[],targetCur,retryTick);
  const prevRangeConverted=useConvertedItems(isAll?prevRangeTxRaw:[],targetCur,retryTick);
  const netWorthTrend=useNetWorthTrend(scopedBanks,isAll,targetCur,retryTick);
  const loading=isAll&&(rangeConverted===null||prevRangeConverted===null||netWorthTrend===null);
  const rangeTx=isAll?(rangeConverted||[]):rangeTxRaw;
  const prevRangeTx=isAll?(prevRangeConverted||[]):prevRangeTxRaw;
  const showRateError=loading&&!rateHealthy;

  const income=rangeTx.filter(t=>t.type==="income").reduce((s,t)=>s+t.amount,0);
  const expense=rangeTx.filter(t=>t.type==="expense").reduce((s,t)=>s+t.amount,0);
  const net=income-expense;
  const savingsRate=income>0?Math.round((net/income)*100):null;

  // "Your average" savings rate — native-currency only (no FX pass added
  // just for a comparison baseline); trailing 6 completed months.
  let avgSavingsRate=null;
  if(!isAll){
    const monthlyAgg={};
    rawTx.forEach(t=>{const mk=t.date?.slice(0,7);if(!mk)return;monthlyAgg[mk]=monthlyAgg[mk]||{inc:0,exp:0};monthlyAgg[mk][t.type==="income"?"inc":"exp"]+=t.amount;});
    const thisMonthKey=localDateStr().slice(0,7);
    const pastMonths=Object.keys(monthlyAgg).filter(k=>k!==thisMonthKey).sort().slice(-6);
    const rates=pastMonths.map(k=>monthlyAgg[k].inc>0?(monthlyAgg[k].inc-monthlyAgg[k].exp)/monthlyAgg[k].inc:null).filter(r=>r!==null);
    if(rates.length)avgSavingsRate=Math.round((rates.reduce((s,r)=>s+r,0)/rates.length)*100);
  }

  const tagTotals={};rangeTx.filter(t=>t.type==="expense").forEach(t=>{const k=t.tag||"Untagged";tagTotals[k]=(tagTotals[k]||0)+t.amount;});
  const prevTagTotals={};prevRangeTx.filter(t=>t.type==="expense").forEach(t=>{const k=t.tag||"Untagged";prevTagTotals[k]=(prevTagTotals[k]||0)+t.amount;});
  const catList=Object.entries(tagTotals).map(([tag,amount])=>{
    const prev=prevTagTotals[tag]||0;
    const deltaPct=prev>0?Math.round(((amount-prev)/prev)*100):null;
    return{tag,amount,prev,deltaPct};
  }).sort((a,b)=>b.amount-a.amount);
  const maxCatAmount=catList[0]?.amount||1;
  const movers=catList.filter(c=>c.prev>0&&Math.abs(c.deltaPct)>=10);
  const biggestMover=movers.length?movers.reduce((a,b)=>Math.abs(b.amount-b.prev)>Math.abs(a.amount-a.prev)?b:a):null;

  const nwFirst=netWorthTrend?.[0]?.value;
  const nwLast=netWorthTrend?.[netWorthTrend.length-1]?.value;
  const nwDeltaPct=(netWorthTrend&&nwFirst!==undefined&&nwFirst!==0)?Math.round(((nwLast-nwFirst)/Math.abs(nwFirst))*100):null;

  const allGoalEnvelopes=banks.flatMap(b=>b.envelopes.filter(e=>e.goal>0).map(e=>({...e,currency:b.currency,bankId:b.id,bankName:b.name}))).sort((a,b)=>(b.balance/b.goal)-(a.balance/a.goal));

  return(
    <div>
      {allObservations.length>0&&<div style={{background:T.card,borderRadius:12,padding:16,marginBottom:16,border:`1px solid ${T.border}`}}>
        <div style={{fontSize:13,fontWeight:700,color:T.text,marginBottom:12}}>Observations</div>
        {allObservations.map((o,i)=>(
          <div key={o.id} style={{display:"flex",gap:10,alignItems:"flex-start",padding:"10px 0",borderTop:i>0?`1px solid ${T.border}`:"none"}}>
            <div style={{fontSize:16,lineHeight:1.3,flexShrink:0}}>{o.icon}</div>
            <div style={{fontSize:12.5,color:T.text,lineHeight:1.45}}>{o.text}</div>
          </div>
        ))}
      </div>}
      {untaggedAll.length>0&&<div style={{display:"flex",alignItems:"center",gap:12,background:"#F59E0B14",border:"1px solid #F59E0B55",borderRadius:12,padding:"12px 14px",marginBottom:16}}>
        <div style={{flex:1,fontSize:12.5,lineHeight:1.4,color:T.text}}>
          <b style={{color:"#F59E0B"}}>{untaggedAll.length} untagged transaction{untaggedAll.length!==1?"s":""}</b>
          <div style={{fontSize:11.5,color:T.subtext,marginTop:2}}>{[Object.keys(untaggedSpend).length?`${fmtByCur(untaggedSpend)} spent`:"",Object.keys(untaggedIncome).length?`${fmtByCur(untaggedIncome)} income`:""].filter(Boolean).join(" · ")} with no tag, across all your banks.</div>
        </div>
        <Btn small color="#F59E0B" onClick={()=>setShowOrganize(true)}>Organize</Btn>
      </div>}
      <div style={{display:"flex",flexWrap:"wrap",gap:6,marginBottom:14}}>
        {currencies.map(c=>(
          <button key={c} onClick={()=>setCurrencyTab(c)} style={{background:currencyTab===c?getCurrencyColor(c):T.card,color:currencyTab===c?"#fff":T.subtext,border:`1px solid ${currencyTab===c?getCurrencyColor(c):T.border}`,borderRadius:8,padding:"6px 14px",cursor:"pointer",fontSize:13,fontWeight:600}}>{c}</button>
        ))}
        {currencies.length>1&&<button onClick={()=>setCurrencyTab("ALL")} style={{background:isAll?T.text:T.card,color:isAll?T.bg:T.subtext,border:`1px solid ${isAll?T.text:T.border}`,borderRadius:8,padding:"6px 14px",cursor:"pointer",fontSize:13,fontWeight:600}}>🌐 All (converted)</button>}
        {banks.length===0&&<span style={{fontSize:12,color:T.faint}}>No banks yet.</span>}
      </div>
      <div style={{display:"flex",gap:8,marginBottom:12,flexWrap:"wrap",alignItems:"flex-end"}}>
        <div><div style={{fontSize:11,color:T.subtext,marginBottom:4}}>From</div><input type="date" value={from} onChange={e=>setFrom(e.target.value)} style={{background:T.card,border:`1px solid ${T.border}`,borderRadius:8,padding:"6px 10px",color:T.text,fontSize:13}}/></div>
        <div><div style={{fontSize:11,color:T.subtext,marginBottom:4}}>To</div><input type="date" value={to} onChange={e=>setTo(e.target.value)} style={{background:T.card,border:`1px solid ${T.border}`,borderRadius:8,padding:"6px 10px",color:T.text,fontSize:13}}/></div>
        {isAll&&<div>
          <div style={{fontSize:11,color:T.subtext,marginBottom:4}}>Convert to</div>
          <select value={targetCur} onChange={e=>setAllTarget(e.target.value)} style={{background:T.card,border:`1px solid ${T.border}`,borderRadius:8,padding:"6px 10px",color:T.text,fontSize:13}}>
            {[...new Set([targetCur,...CURRENCY_LIST])].map(c=><option key={c} value={c}>{c}</option>)}
          </select>
        </div>}
      </div>
      <div style={{marginBottom:16}}>
        <div style={{fontSize:11,color:T.subtext,marginBottom:6}}>Accounts included</div>
        <div style={{display:"flex",flexWrap:"wrap",gap:6}}>
          <button onClick={selectAllAccounts} style={{background:allSelected?T.text:T.card,color:allSelected?T.bg:T.subtext,border:`1px solid ${allSelected?T.text:T.border}`,borderRadius:8,padding:"5px 12px",cursor:"pointer",fontSize:12,fontWeight:600}}>All accounts</button>
          {tabBanks.map(b=>{
            const on=activeAccounts.includes(String(b.id));
            const c=bankColor(b);
            return(
              <button key={b.id} onClick={()=>toggleAccount(String(b.id))} style={{background:on?c:T.card,color:on?"#fff":T.subtext,border:`1px solid ${on?c:T.border}`,borderRadius:8,padding:"5px 12px",cursor:"pointer",fontSize:12,fontWeight:500}}>{b.name}{isAll?<span style={{opacity:0.85}}> ({b.currency})</span>:null}</button>
            );
          })}
        </div>
      </div>
      {showRateError&&<div style={{background:T.card,border:"1px solid #ef444466",borderRadius:12,padding:16,marginBottom:16,textAlign:"center"}}>
        <div style={{color:"#ef4444",fontSize:13,marginBottom:10}}>⚠️ Couldn't reach the exchange-rate service, so amounts can't be converted right now.</div>
        <Btn small color="#ef4444" onClick={()=>setRetryTick(t=>t+1)}>Retry</Btn>
      </div>}
      {loading&&!showRateError&&<div style={{color:T.faint,textAlign:"center",padding:16,fontSize:13}}>Converting…</div>}
      {!loading&&<>
        <div style={{background:T.card,borderRadius:12,padding:16,marginBottom:14,border:`1px solid ${T.border}`}}>
          <div style={{fontSize:13,fontWeight:700,color:T.text}}>Net Worth Trend</div>
          <div style={{fontSize:11,color:T.faint,marginBottom:10}}>Reconstructed from transaction &amp; investment history{isAll?" · converted at today's rates":""} — not exact, but directional</div>
          {netWorthTrend&&<div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-end",marginBottom:6}}>
            <div style={{fontSize:22,fontWeight:800,fontVariantNumeric:"tabular-nums"}}>{sym(targetCur)}{fmtNum(nwLast)}</div>
            {nwDeltaPct!==null&&<div style={{fontSize:12,fontWeight:700,color:nwDeltaPct>=0?"#10B981":"#ef4444",background:nwDeltaPct>=0?"#10B98118":"#ef444418",padding:"3px 8px",borderRadius:6}}>{nwDeltaPct>=0?"▲":"▼"} {Math.abs(nwDeltaPct)}% / 6mo</div>}
          </div>}
          <LineAreaChart data={netWorthTrend} color="#3B82F6"/>
        </div>

        {biggestMover&&<div style={{display:"flex",gap:10,alignItems:"flex-start",background:"linear-gradient(135deg,#3B82F612,#8B5CF612)",border:"1px solid #8B5CF633",borderRadius:12,padding:"12px 14px",marginBottom:14}}>
          <div style={{fontSize:18,lineHeight:1}}>💡</div>
          <div style={{fontSize:12.5,color:T.text,lineHeight:1.45}}>
            <b style={{color:"#8B5CF6"}}>{biggestMover.tag}</b> is {biggestMover.amount>biggestMover.prev?"up":"down"} <b style={{color:"#8B5CF6"}}>{Math.abs(biggestMover.deltaPct)}%</b> vs the previous period ({sym(targetCur)}{fmtNum(biggestMover.prev)} → {sym(targetCur)}{fmtNum(biggestMover.amount)}) — your biggest mover.
          </div>
        </div>}

        <div style={{background:T.card,borderRadius:12,padding:16,marginBottom:14,border:`1px solid ${T.border}`}}>
          <div style={{fontSize:13,fontWeight:700,color:T.text,marginBottom:12}}>This Period</div>
          <div style={{display:"flex",gap:8,marginBottom:income>0?12:0}}>
            <div style={{flex:1,textAlign:"center"}}><div style={{fontSize:10.5,color:T.faint,textTransform:"uppercase",letterSpacing:".04em"}}>Income</div><div style={{fontSize:16,fontWeight:700,color:"#10B981",fontVariantNumeric:"tabular-nums"}}>{sym(targetCur)}{fmtNum(income)}</div></div>
            <div style={{flex:1,textAlign:"center"}}><div style={{fontSize:10.5,color:T.faint,textTransform:"uppercase",letterSpacing:".04em"}}>Expense</div><div style={{fontSize:16,fontWeight:700,color:"#ef4444",fontVariantNumeric:"tabular-nums"}}>{sym(targetCur)}{fmtNum(expense)}</div></div>
            <div style={{flex:1,textAlign:"center"}}><div style={{fontSize:10.5,color:T.faint,textTransform:"uppercase",letterSpacing:".04em"}}>Net</div><div style={{fontSize:16,fontWeight:700,color:net>=0?"#10B981":"#ef4444",fontVariantNumeric:"tabular-nums"}}>{sym(targetCur)}{fmtNum(net)}</div></div>
          </div>
          {savingsRate!==null&&<>
            <div style={{background:T.card2,borderRadius:8,height:8,overflow:"hidden"}}><div style={{background:"linear-gradient(90deg,#10B981,#34d399)",height:"100%",borderRadius:8,width:`${Math.max(0,Math.min(100,savingsRate))}%`}}/></div>
            <div style={{display:"flex",justifyContent:"space-between",fontSize:11,color:T.subtext,marginTop:6}}>
              <span>Saved <b style={{color:T.text}}>{savingsRate}%</b> of income</span>
              {avgSavingsRate!==null&&<span style={{color:T.faint}}>your avg is {avgSavingsRate}%</span>}
            </div>
          </>}
        </div>

        <div style={{background:T.card,borderRadius:12,padding:16,marginBottom:14,border:`1px solid ${T.border}`}}>
          <div style={{fontSize:13,fontWeight:700,color:T.text}}>Where It Goes</div>
          <div style={{fontSize:11,color:T.faint,marginBottom:10}}>Ranked by spend this period, vs. the period before</div>
          {catList.length===0&&<div style={{color:T.faint,fontSize:13,textAlign:"center",padding:12}}>No expenses in this period.</div>}
          {catList.map((c,i)=>(
            <div key={c.tag} onClick={c.tag==="Untagged"?()=>setShowOrganize(true):undefined} style={{display:"flex",alignItems:"center",gap:10,padding:"9px 0",borderBottom:i<catList.length-1?`1px solid ${T.border}`:"none",cursor:c.tag==="Untagged"?"pointer":"default"}}>
              <div style={{width:9,height:9,borderRadius:"50%",flexShrink:0,background:COLORS_LIST[i%COLORS_LIST.length]}}/>
              <div style={{fontSize:13,fontWeight:600,color:T.text,width:88,flexShrink:0,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{c.tag}</div>
              <div style={{flex:1,background:T.card2,borderRadius:6,height:6}}><div style={{height:"100%",borderRadius:6,width:`${Math.max(2,(c.amount/maxCatAmount)*100)}%`,background:COLORS_LIST[i%COLORS_LIST.length]}}/></div>
              <div style={{fontSize:12.5,fontWeight:700,width:84,textAlign:"right",flexShrink:0,fontVariantNumeric:"tabular-nums"}}>{sym(targetCur)}{fmtNum(c.amount)}</div>
              <div style={{fontSize:10.5,fontWeight:700,width:40,textAlign:"right",flexShrink:0,color:c.deltaPct===null?T.faint:c.deltaPct>0?"#ef4444":"#10B981"}}>{c.deltaPct===null?(c.prev===0&&c.amount>0?"New":"–"):`${c.deltaPct>0?"▲":"▼"}${Math.abs(c.deltaPct)}%`}</div>
              {c.tag==="Untagged"&&<div style={{color:T.faint,fontSize:14}}>›</div>}
            </div>
          ))}
        </div>

        <div style={{background:T.card,borderRadius:12,padding:16,border:`1px solid ${T.border}`}}>
          <div style={{fontSize:13,fontWeight:700,color:T.text}}>Goals</div>
          <div style={{fontSize:11,color:T.faint,marginBottom:12}}>Envelopes with a savings goal set — across all banks and currencies</div>
          {allGoalEnvelopes.length===0&&<div style={{color:T.faint,fontSize:13,textAlign:"center",padding:8}}>No goals set — add one to an envelope in Banks to track it here.</div>}
          {allGoalEnvelopes.map(e=>{
            const pct=Math.min(100,Math.round((e.balance/e.goal)*100));
            const barColor=pct>=90?"#10B981":pct<30?"#F59E0B":"#3B82F6";
            return(
              <div key={`${e.bankId}-${e.id}`} onClick={()=>onOpenBank?.(e.bankId)} role="button" tabIndex={0} onKeyDown={ev=>{if(ev.key==="Enter")onOpenBank?.(e.bankId);}} style={{marginBottom:14,cursor:"pointer"}}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",gap:10,fontSize:12.5,marginBottom:5}}>
                  <div style={{minWidth:0}}>
                    <div style={{fontWeight:600,color:T.text}}>{e.emoji||"🗂️"} {e.name}</div>
                    <div style={{fontSize:11,color:T.faint,marginTop:1}}>{e.bankName} ›</div>
                  </div>
                  <span style={{color:T.subtext,fontVariantNumeric:"tabular-nums",textAlign:"right",flexShrink:0}}>{sym(e.currency)}{fmtNum(e.balance)} / {sym(e.currency)}{fmtNum(e.goal)} · {pct}%</span>
                </div>
                <div style={{background:T.card2,borderRadius:8,height:9,overflow:"hidden"}}><div style={{height:"100%",borderRadius:8,width:`${pct}%`,background:barColor}}/></div>
              </div>
            );
          })}
        </div>
      </>}
      {showOrganize&&<OrganizeUntaggedModal banks={banks} setBanks={setBanks} tags={tags} setTags={setTags} onClose={()=>setShowOrganize(false)}/>}
    </div>
  );
}
function ChecklistNote({note,onUpdate,onDelete}){
  const items=note.items||[];
  const addItem=()=>onUpdate({...note,items:[...items,{id:Date.now(),text:"",checked:false}]});
  const updateItem=(id,patch)=>onUpdate({...note,items:items.map(it=>it.id===id?{...it,...patch}:it)});
  const delItem=id=>onUpdate({...note,items:items.filter(it=>it.id!==id)});
  return(
    <div style={{background:"#FEF3C7",borderRadius:8,padding:12,minHeight:140,boxShadow:"0 2px 8px rgba(0,0,0,0.2)",display:"flex",flexDirection:"column"}}>
      <input value={note.title||""} onChange={e=>onUpdate({...note,title:e.target.value})} placeholder="Checklist title" style={{background:"transparent",border:"none",outline:"none",color:"#451a03",fontWeight:700,fontSize:13,marginBottom:8}}/>
      <div style={{flex:1,display:"flex",flexDirection:"column",gap:4}}>
        {items.map(it=>(
          <div key={it.id} style={{display:"flex",alignItems:"center",gap:6}}>
            <input type="checkbox" checked={!!it.checked} onChange={e=>updateItem(it.id,{checked:e.target.checked})}/>
            <input value={it.text} onChange={e=>updateItem(it.id,{text:e.target.value})} placeholder="Item" style={{flex:1,minWidth:0,background:"transparent",border:"none",outline:"none",color:"#451a03",fontSize:13,textDecoration:it.checked?"line-through":"none",opacity:it.checked?0.6:1}}/>
            <button onClick={()=>delItem(it.id)} style={{background:"none",border:"none",color:"#b45309",cursor:"pointer",fontSize:14,flexShrink:0}}>×</button>
          </div>
        ))}
        {items.length===0&&<div style={{fontSize:12,color:"#b45309",opacity:0.7}}>No items yet.</div>}
      </div>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginTop:8}}>
        <button onClick={addItem} style={{background:"none",border:"none",color:"#b45309",cursor:"pointer",fontSize:12}}>+ item</button>
        <button onClick={onDelete} style={{background:"none",border:"none",color:"#b45309",cursor:"pointer",fontSize:13}}>🗑</button>
      </div>
    </div>
  );
}
function SheetNote({note,onUpdate,onDelete}){
  const cells=note.cells||{};
  const rows=note.rows||SHEET_INITIAL_ROWS;
  const[expanded,setExpanded]=useState(false);
  const[editingKey,setEditingKey]=useState(null);
  const[editVal,setEditVal]=useState("");
  const computed=computeSheet(cells);
  const filledCount=Object.keys(cells).filter(k=>cells[k]!=="").length;
  const setCell=(key,val)=>{
    const next={...cells};
    if(val==="")delete next[key];else next[key]=val;
    onUpdate({...note,cells:next});
  };
  const startEdit=key=>{setEditingKey(key);setEditVal(cells[key]||"");};
  const commitEdit=()=>{if(editingKey!==null)setCell(editingKey,editVal);setEditingKey(null);};
  const displayValue=key=>{
    const raw=cells[key];
    if(!raw)return"";
    if(typeof raw==="string"&&raw.trim().startsWith("=")){
      const v=computed[key];
      return isNaN(v)?"#ERR":String(roundNum(v));
    }
    return raw;
  };
  const addRow=()=>{if(rows<SHEET_MAX_ROWS)onUpdate({...note,rows:rows+1});};
  if(!expanded){
    return(
      <div style={{background:T.card,border:`1px solid ${T.border}`,borderRadius:8,padding:12,minHeight:140,boxShadow:"0 2px 8px rgba(0,0,0,0.15)",display:"flex",flexDirection:"column"}}>
        <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:8}}>
          <span style={{fontSize:16}}>📊</span>
          <input value={note.title||""} onChange={e=>onUpdate({...note,title:e.target.value})} placeholder="Sheet title" style={{background:"transparent",border:"none",outline:"none",color:T.text,fontWeight:700,fontSize:13,flex:1,minWidth:0}}/>
        </div>
        <div style={{flex:1,fontSize:12,color:T.faint}}>{filledCount===0?"Empty sheet":`${filledCount} cell${filledCount!==1?"s":""} filled`}</div>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginTop:8}}>
          <button onClick={()=>setExpanded(true)} style={{background:"none",border:`1px solid ${T.border}`,color:T.subtext,cursor:"pointer",fontSize:12,borderRadius:6,padding:"4px 10px"}}>Open</button>
          <button onClick={onDelete} style={{background:"none",border:"none",color:"#ef4444",cursor:"pointer",fontSize:13}}>🗑</button>
        </div>
      </div>
    );
  }
  return(
    <div style={{gridColumn:"1/-1",background:T.card,border:`1px solid ${T.border}`,borderRadius:8,padding:12}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
        <input value={note.title||""} onChange={e=>onUpdate({...note,title:e.target.value})} placeholder="Sheet title" style={{background:"transparent",border:"none",outline:"none",color:T.text,fontWeight:700,fontSize:14,flex:1}}/>
        <div style={{display:"flex",gap:8,alignItems:"center"}}>
          <button onClick={()=>setExpanded(false)} style={{background:"none",border:`1px solid ${T.border}`,color:T.subtext,cursor:"pointer",fontSize:12,borderRadius:6,padding:"4px 10px"}}>Collapse</button>
          <button onClick={onDelete} style={{background:"none",border:"none",color:"#ef4444",cursor:"pointer",fontSize:14}}>🗑</button>
        </div>
      </div>
      <div style={{overflowX:"auto"}}>
        <table style={{borderCollapse:"collapse"}}>
          <thead>
            <tr>
              <th style={{width:32}}></th>
              {Array.from({length:SHEET_COLS}).map((_,c)=><th key={c} style={{fontSize:11,color:T.subtext,padding:"2px 4px",fontWeight:600}}>{colLetter(c)}</th>)}
            </tr>
          </thead>
          <tbody>
            {Array.from({length:rows}).map((_,r)=>{
              const rowNum=r+1;
              return(
                <tr key={rowNum}>
                  <td style={{fontSize:11,color:T.faint,textAlign:"right",paddingRight:4}}>{rowNum}</td>
                  {Array.from({length:SHEET_COLS}).map((_,c)=>{
                    const key=`${colLetter(c)}${rowNum}`;
                    const isEditing=editingKey===key;
                    return(
                      <td key={key} style={{padding:1}}>
                        <input
                          value={isEditing?editVal:displayValue(key)}
                          onFocus={()=>startEdit(key)}
                          onChange={e=>setEditVal(e.target.value)}
                          onBlur={commitEdit}
                          onKeyDown={e=>{if(e.key==="Enter")e.target.blur();}}
                          placeholder=""
                          style={{width:64,background:T.input,border:`1px solid ${T.border}`,borderRadius:4,padding:"3px 5px",color:T.text,fontSize:12,textAlign:isEditing?"left":"right"}}
                        />
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {rows<SHEET_MAX_ROWS&&<button onClick={addRow} style={{marginTop:8,background:"none",border:`1px solid ${T.border}`,color:T.subtext,cursor:"pointer",fontSize:12,borderRadius:6,padding:"4px 10px"}}>+ Add row</button>}
      <div style={{fontSize:10,color:T.faint,marginTop:6}}>Start a cell with = to use a formula, e.g. =A1+B2*3</div>
    </div>
  );
}
function NotesSection({notesState}){
  const[notes,setNotes,undo,redo,canUndo,canRedo]=notesState;
  const[confirmDel,setConfirmDel]=useState(null);
  const[showTypePicker,setShowTypePicker]=useState(false);
  const addSticky=()=>{setNotes(n=>[{id:Date.now(),type:"sticky",text:""},...n]);setShowTypePicker(false);};
  const addChecklist=()=>{setNotes(n=>[{id:Date.now(),type:"checklist",title:"",items:[]},...n]);setShowTypePicker(false);};
  const addSheet=()=>{setNotes(n=>[{id:Date.now(),type:"sheet",title:"",cells:{},rows:SHEET_INITIAL_ROWS},...n]);setShowTypePicker(false);};
  const updateText=(id,text)=>setNotes(n=>n.map(x=>x.id===id?{...x,text}:x));
  const replaceNote=updated=>setNotes(n=>n.map(x=>x.id===updated.id?updated:x));
  const isEmpty=note=>{
    const type=note.type||"sticky";
    if(type==="checklist")return!note.items||note.items.length===0||note.items.every(it=>!it.text||it.text.trim()==="");
    if(type==="sheet")return!note.cells||Object.keys(note.cells).length===0;
    return!note.text||note.text.trim()==="";
  };
  const reqDel=note=>{if(isEmpty(note))setNotes(n=>n.filter(x=>x.id!==note.id));else setConfirmDel(note);};
  const del=id=>{setNotes(n=>n.filter(x=>x.id!==id));setConfirmDel(null);};
  return(
    <div>
      <UndoBar undo={undo} redo={redo} canUndo={canUndo} canRedo={canRedo}/>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16}}>
        <span style={{fontSize:13,color:T.subtext}}>Notes — auto-saved</span>
        <Btn color="#10B981" onClick={()=>setShowTypePicker(true)}>+ New Note</Btn>
      </div>
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(200px,1fr))",gap:12}}>
        {notes.map(note=>{
          const type=note.type||"sticky";
          if(type==="checklist")return<ChecklistNote key={note.id} note={note} onUpdate={replaceNote} onDelete={()=>reqDel(note)}/>;
          if(type==="sheet")return<SheetNote key={note.id} note={note} onUpdate={replaceNote} onDelete={()=>reqDel(note)}/>;
          return(
            <div key={note.id} style={{background:"#FEF3C7",borderRadius:8,padding:12,minHeight:140,boxShadow:"0 2px 8px rgba(0,0,0,0.2)",display:"flex",flexDirection:"column"}}>
              <textarea value={note.text||""} onChange={e=>updateText(note.id,e.target.value)} placeholder="Write something..." style={{flex:1,background:"transparent",border:"none",resize:"none",outline:"none",color:"#451a03",fontSize:14,lineHeight:1.5,fontFamily:"system-ui"}}/>
              <button onClick={()=>reqDel(note)} style={{alignSelf:"flex-end",background:"none",border:"none",color:"#b45309",cursor:"pointer",fontSize:13,marginTop:4}}>🗑</button>
            </div>
          );
        })}
        {notes.length===0&&<div style={{color:T.faint,gridColumn:"1/-1",textAlign:"center",padding:32}}>No notes yet — add one!</div>}
      </div>
      {showTypePicker&&<Modal title="New Note" onClose={()=>setShowTypePicker(false)} isDirty={false}>
        <div style={{display:"flex",flexDirection:"column",gap:8}}>
          <Btn color="#F59E0B" onClick={addSticky}>📝 Sticky Note</Btn>
          <Btn color="#3B82F6" onClick={addChecklist}>☑️ Checklist</Btn>
          <Btn color="#10B981" onClick={addSheet}>📊 Sheet</Btn>
        </div>
      </Modal>}
      {confirmDel&&<ConfirmModal message="Delete this note?" detail="It has content that will be lost." onConfirm={()=>del(confirmDel.id)} onClose={()=>setConfirmDel(null)}/>}
    </div>
  );
}

function QuickAdd({banks,setBanks,tags}){
  const[open,setOpen]=useState(false);
  const[bankId,setBankId]=useState("");
  const[envId,setEnvId]=useState("");
  const[tx,setTx]=useState({type:"expense",desc:"",amount:"",tag:"",note:"",date:localDateStr()});
  const[err,setErr]=useState("");
  const bank=banks.find(b=>String(b.id)===String(bankId));
  const submit=()=>{
    if(!bank){setErr("Please select a bank.");return;}
    if(!envId){setErr("Please select an envelope.");return;}
    if(!tx.desc){setErr("Please enter a description.");return;}
    if(!tx.amount||parseFloat(tx.amount)<=0){setErr("Please enter a valid amount.");return;}
    const amt=parseFloat(tx.amount);const isIncome=tx.type==="income";
    const newTx={id:Date.now(),...tx,amount:amt};
    setBanks(bs=>bs.map(b=>String(b.id)!==String(bank.id)?b:{...b,balance:r2(b.balance+(isIncome?amt:-amt)),envelopes:b.envelopes.map(e=>String(e.id)!==String(envId)?e:{...e,balance:r2(e.balance+(isIncome?amt:-amt)),transactions:[newTx,...e.transactions]})}));
    setTx({type:"expense",desc:"",amount:"",tag:"",note:"",date:localDateStr()});
    setErr("");setOpen(false);
    toast("success","Transaction added.");
  };
  return(
    <>
      <Btn color="#10B981" onClick={()=>setOpen(true)} style={{width:"100%",marginBottom:20}}>⚡ Quick Add Transaction</Btn>
      {open&&<Modal title="Quick Add Transaction" onClose={()=>setOpen(false)} isDirty={!!tx.desc||!!tx.amount}>
        <Sel label="Bank" value={bankId} onChange={e=>{setBankId(e.target.value);setEnvId("");setErr("");}}>
          <option value="">Select bank</option>{banks.map(b=><option key={b.id} value={b.id}>{b.name} ({b.currency})</option>)}
        </Sel>
        {bank&&<Sel label="Envelope" value={envId} onChange={e=>{setEnvId(e.target.value);setErr("");}}>
          <option value="">Select envelope</option>{bank.envelopes.map(e=><option key={e.id} value={e.id}>{e.name}</option>)}
        </Sel>}
        <div style={{display:"flex",gap:8,marginBottom:12}}>
          {["income","expense"].map(t=><Btn key={t} color={t==="income"?"#10B981":"#ef4444"} outline={tx.type!==t} onClick={()=>setTx(x=>({...x,type:t}))} style={{flex:1,textTransform:"capitalize"}}>{t}</Btn>)}
        </div>
        <FormError msg={err}/>
        <Inp label="Description" value={tx.desc} onChange={e=>{setErr("");setTx(x=>({...x,desc:e.target.value}));}} placeholder="e.g. Groceries"/>
        <Inp label="Amount" type="number" value={tx.amount} onChange={e=>{setErr("");setTx(x=>({...x,amount:e.target.value}));}} placeholder="0.00"/>
        <Sel label="Tag (optional)" value={tx.tag} onChange={e=>setTx(x=>({...x,tag:e.target.value}))}>
          <option value="">No tag</option>{(tags||[]).map(t=><option key={t} value={t}>{t}</option>)}
        </Sel>
        <Inp label="Date" type="date" value={tx.date} onChange={e=>setTx(x=>({...x,date:e.target.value}))}/>
        <Btn color="#10B981" onClick={submit} style={{width:"100%"}}>Add Transaction</Btn>
      </Modal>}
    </>
  );
}

function UniversalTotal({banks,investments,target,setTarget,hideTotals}){
  const items=[...banks.map(b=>({amount:bankTotal(b),currency:b.currency})),...investments.flatMap(inv=>(inv.items||[]).map(it=>({amount:it.value,currency:it.currency})))];
  const total=useMultiConvert(items,target);
  return(
    <div style={{background:"linear-gradient(135deg,#3B82F6,#8B5CF6)",borderRadius:14,padding:20,color:"#fff"}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
        <div>
          <div style={{fontSize:13,opacity:0.85}}>Total Net Worth</div>
          <div style={{fontSize:30,fontWeight:800,marginTop:4}}>{hideTotals?"••••••":(total===null?"…":`${sym(target)}${fmtNum(total)}`)}</div>
        </div>
        <select value={target} onChange={e=>setTarget(e.target.value)} style={{background:"rgba(255,255,255,0.2)",border:"1px solid rgba(255,255,255,0.3)",borderRadius:8,padding:"6px 10px",color:"#fff",fontSize:14}}>
          {CURRENCY_LIST.map(c=><option key={c} value={c} style={{color:"#000"}}>{c}</option>)}
        </select>
      </div>
    </div>
  );
}

function BanksByCurrency({banks,hideTotals}){
  const byCurrency={};
  banks.forEach(b=>{(byCurrency[b.currency]=byCurrency[b.currency]||[]).push(b);});
  const currencies=Object.keys(byCurrency);
  if(currencies.length===0)return(
    <div>
      <div style={{fontSize:11,color:T.faint,textTransform:"uppercase",letterSpacing:".06em",fontWeight:700,margin:"0 0 10px"}}>In your banks</div>
      <div style={{color:T.faint,textAlign:"center",padding:24,background:T.card,borderRadius:12,border:`1px solid ${T.border}`,fontSize:13}}>No banks yet.</div>
    </div>
  );
  return(
    <div>
      <div style={{fontSize:11,color:T.faint,textTransform:"uppercase",letterSpacing:".06em",fontWeight:700,margin:"0 0 10px"}}>In your banks</div>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
        {currencies.map(currency=>{
          const cBanks=byCurrency[currency];
          const total=cBanks.reduce((s,b)=>s+bankTotal(b),0);
          const c=getCurrencyColor(currency);
          return(
            <div key={currency} style={{background:T.card,border:`1px solid ${T.border}`,borderRadius:12,padding:14}}>
              <div style={{fontSize:11,color:T.subtext,marginBottom:4,display:"flex",alignItems:"center",gap:6}}><span style={{width:8,height:8,borderRadius:"50%",background:c,flexShrink:0}}/>{currency} · {cBanks.length} account{cBanks.length!==1?"s":""}</div>
              <div style={{fontSize:19,fontWeight:700,color:T.text}}>{hideTotals?"••••••":`${sym(currency)}${fmtNum(total)}`}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
function InvestmentsByBucket({investments,overviewCur,hideTotals}){
  const byBucket={};
  investments.forEach(inv=>{const b=inv.bucket||"Other";(byBucket[b]=byBucket[b]||[]).push(...(inv.items||[]));});
  const buckets=INVESTMENT_BUCKETS.filter(b=>byBucket[b]?.length);
  const allItems=buckets.flatMap(b=>byBucket[b].map(it=>({amount:it.value,currency:it.currency})));
  const grandTotal=useMultiConvert(allItems,overviewCur);
  if(buckets.length===0)return(
    <div>
      <div style={{fontSize:11,color:T.faint,textTransform:"uppercase",letterSpacing:".06em",fontWeight:700,margin:"0 0 10px"}}>In your investments</div>
      <div style={{color:T.faint,textAlign:"center",padding:24,background:T.card,borderRadius:12,border:`1px solid ${T.border}`,fontSize:13}}>No investments yet.</div>
    </div>
  );
  return(
    <div>
      <div style={{fontSize:11,color:T.faint,textTransform:"uppercase",letterSpacing:".06em",fontWeight:700,margin:"0 0 10px"}}>In your investments</div>
      <div style={{background:T.card,border:`1px solid ${T.border}`,borderRadius:12,padding:"4px 14px"}}>
        {buckets.map(bucket=>(
          <BucketRow key={bucket} bucket={bucket} items={byBucket[bucket]} overviewCur={overviewCur} hideTotals={hideTotals}/>
        ))}
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"12px 0 10px",marginTop:2,borderTop:`1px dashed ${T.border}`}}>
          <span style={{fontSize:12,color:T.subtext}}>Total investments ({overviewCur})</span>
          <span style={{fontSize:15,fontWeight:800,color:"#8B5CF6"}}>{hideTotals?"••••••":(grandTotal===null?"…":`${sym(overviewCur)}${fmtNum(grandTotal)}`)}</span>
        </div>
      </div>
    </div>
  );
}
function BucketRow({bucket,items,overviewCur,hideTotals}){
  const total=useMultiConvert(items.map(it=>({amount:it.value,currency:it.currency})),overviewCur);
  const c=bucketColor(bucket);
  return(
    <div style={{display:"flex",alignItems:"center",gap:12,padding:"12px 0",borderBottom:`1px solid ${T.border}`}}>
      <div style={{width:38,height:38,borderRadius:10,flexShrink:0,display:"flex",alignItems:"center",justifyContent:"center",fontSize:17,background:`${c}22`}}>{BUCKET_ICONS[bucket]||"📦"}</div>
      <div style={{flex:1,minWidth:0}}>
        <div style={{fontSize:13.5,fontWeight:600,color:T.text}}>{bucket}</div>
        <div style={{fontSize:11,color:T.faint,marginTop:1}}>{items.length} holding{items.length!==1?"s":""}</div>
      </div>
      <div style={{fontSize:14.5,fontWeight:700,color:T.text,flexShrink:0,fontVariantNumeric:"tabular-nums"}}>{hideTotals?"••••••":(total===null?"…":`${sym(overviewCur)}${fmtNum(total)}`)}</div>
    </div>
  );
}
function ObservationBanner({banks}){
  const obs=computeObservations(banks);
  if(!obs.length)return null;
  const top=obs[0];
  return(
    <div style={{display:"flex",gap:10,alignItems:"flex-start",background:top.tone==="warn"?"#F59E0B12":"linear-gradient(135deg,#3B82F612,#8B5CF612)",border:`1px solid ${top.tone==="warn"?"#F59E0B44":"#8B5CF633"}`,borderRadius:12,padding:"12px 14px"}}>
      <div style={{fontSize:17,lineHeight:1}}>{top.icon}</div>
      <div style={{fontSize:12.5,color:T.text,lineHeight:1.45,flex:1}}>{top.text}</div>
      {obs.length>1&&<div style={{fontSize:11,color:T.faint,flexShrink:0,whiteSpace:"nowrap"}}>+{obs.length-1} more in Analytics</div>}
    </div>
  );
}
function PinnedBudgetsSection({banks,setBanks,tags,pinnedBudgets}){
  const items=(pinnedBudgets||[]).map(key=>{
    const[bankId,envId]=key.split(":");
    const bank=banks.find(b=>String(b.id)===String(bankId));
    const env=bank?.envelopes.find(e=>String(e.id)===String(envId));
    return env?{bank,env,key}:null;
  }).filter(Boolean);
  const[showAddFor,setShowAddFor]=useState(null);
  const[tx,setTx]=useState({type:"expense",desc:"",amount:"",tag:"",note:"",date:localDateStr()});
  if(items.length===0)return null;
  const addTx=()=>{
    const amt=parseFloat(tx.amount);
    const isIncome=tx.type==="income";
    const newTx={id:Date.now(),...tx,amount:amt};
    const{bank,env}=showAddFor;
    setBanks(bs=>bs.map(b=>String(b.id)!==String(bank.id)?b:{...b,balance:r2(b.balance+(isIncome?amt:-amt)),envelopes:b.envelopes.map(e=>String(e.id)!==String(env.id)?e:{...e,balance:r2(e.balance+(isIncome?amt:-amt)),transactions:[newTx,...e.transactions]})}));
    setTx({type:"expense",desc:"",amount:"",tag:"",note:"",date:localDateStr()});
    setShowAddFor(null);
    toast("success","Transaction added.");
  };
  return(
    <div>
      <div style={{fontSize:11,color:T.faint,textTransform:"uppercase",letterSpacing:".06em",fontWeight:700,margin:"0 0 10px"}}>Budgets</div>
      {items.map(({bank,env,key})=>{
        const spent=envelopeMonthSpend(env);
        const pct=Math.min(100,Math.round((spent/env.budget)*100));
        const over=spent>env.budget;
        const rem=env.budget-spent;
        const days=daysLeftInMonth();
        const perDay=!over&&days>0?rem/days:null;
        const barColor=over?"#ef4444":pct>=80?"#F59E0B":"#10B981";
        return(
          <div key={key} style={{background:T.card,border:`1px solid ${T.border}`,borderRadius:12,padding:14,marginBottom:10}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:8}}>
              <div><div style={{fontSize:13.5,fontWeight:700,color:T.text}}>{env.emoji||"🗂️"} {env.name}</div><div style={{fontSize:11,color:T.faint,marginTop:1}}>{bank.name} · {bank.currency}</div></div>
              <button onClick={()=>setShowAddFor({bank,env})} style={{width:30,height:30,borderRadius:9,border:"none",background:bankColor(bank),color:"#fff",fontSize:17,fontWeight:700,cursor:"pointer",flexShrink:0,display:"flex",alignItems:"center",justifyContent:"center"}}>+</button>
            </div>
            <div style={{background:T.card2,borderRadius:8,height:8,overflow:"hidden"}}><div style={{width:`${pct}%`,height:"100%",borderRadius:8,background:barColor}}/></div>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"baseline",marginTop:8}}>
              <span style={{fontSize:15,fontWeight:700,color:over?"#ef4444":T.text,fontVariantNumeric:"tabular-nums"}}>{over?`${sym(bank.currency)}${fmtNum(Math.abs(rem))} over`:`${sym(bank.currency)}${fmtNum(rem)} left`}</span>
              <span style={{fontSize:11,color:T.faint}}>of {sym(bank.currency)}{fmtNum(env.budget)}</span>
            </div>
            <div style={{fontSize:11,color:T.faint,marginTop:3}}>
              {perDay!==null?`${sym(bank.currency)}${fmtNum(perDay)}/day · `:""}{perDay!==null&&days>=7?`${sym(bank.currency)}${fmtNum(perDay*7)}/week · `:""}{days} day{days!==1?"s":""} left
            </div>
          </div>
        );
      })}
      {showAddFor&&<AddTxModal envName={showAddFor.env.name} tx={tx} setTx={setTx} tags={tags} color={bankColor(showAddFor.bank)} onAdd={addTx} onClose={()=>setShowAddFor(null)}/>}
    </div>
  );
}
const DASHBOARD_SECTIONS=[
  {id:"networth",label:"💰 Total Net Worth"},
  {id:"observations",label:"👀 Observations"},
  {id:"budgets",label:"📌 Pinned Budgets"},
  {id:"banks",label:"🏦 Banks by Currency"},
  {id:"investments",label:"📈 Investments by Bucket"},
];
const DEFAULT_DASHBOARD_ORDER=DASHBOARD_SECTIONS.map(s=>s.id);
// Drops any id that no longer exists (a removed section) and appends any id
// missing from a saved order (a section added after that order was saved) —
// so an old saved order never hides new sections or breaks on a renamed one.
function resolveDashboardOrder(order){
  const valid=(order||[]).filter(id=>DEFAULT_DASHBOARD_ORDER.includes(id));
  return[...valid,...DEFAULT_DASHBOARD_ORDER.filter(id=>!valid.includes(id))];
}
function Dashboard({banks,setBanks,tags,investments,overviewCur,setOverviewCur,hideTotals,setHideTotals,pinnedBudgets,dashboardOrder}){
  const sections={
    networth:<UniversalTotal banks={banks} investments={investments} target={overviewCur} setTarget={setOverviewCur} hideTotals={hideTotals}/>,
    observations:<ObservationBanner banks={banks}/>,
    budgets:<PinnedBudgetsSection banks={banks} setBanks={setBanks} tags={tags} pinnedBudgets={pinnedBudgets}/>,
    banks:<BanksByCurrency banks={banks} hideTotals={hideTotals}/>,
    investments:<InvestmentsByBucket investments={investments} overviewCur={overviewCur} hideTotals={hideTotals}/>,
  };
  return(
    <div>
      <div style={{display:"flex",justifyContent:"flex-end",marginBottom:8}}>
        <button onClick={()=>setHideTotals(h=>!h)} title={hideTotals?"Show totals":"Hide totals"} aria-label={hideTotals?"Show totals":"Hide totals"} style={{background:T.card,border:`1px solid ${T.border}`,borderRadius:8,padding:"4px 10px",cursor:"pointer",fontSize:13,color:T.subtext,display:"flex",alignItems:"center",gap:6}}>
          {hideTotals?"🙈":"🙉"}
        </button>
      </div>
      {resolveDashboardOrder(dashboardOrder).map(id=><div key={id} className="dash-sec">{sections[id]}</div>)}
    </div>
  );
}

function LockSettingsCard({userId,userEmail}){
  const[enabled,setEnabled]=useState(isLockEnabled());
  const[hasBiometric,setHasBiometric]=useState(hasWebAuthnCredential());
  const[pinSet,setPinSet]=useState(hasPin());
  const[showPinSetup,setShowPinSetup]=useState(false);
  const[pin1,setPin1]=useState("");const[pin2,setPin2]=useState("");
  const[err,setErr]=useState("");
  const supported=isWebAuthnSupported();
  const enroll=async()=>{
    setErr("");
    try{await enrollWebAuthn(userId,userEmail);setEnabled(true);setHasBiometric(true);toast("success","Face ID / Touch ID enabled.");}
    catch{setErr("Couldn't set up biometric unlock on this device. Try a PIN instead.");}
  };
  const savePin=async()=>{
    if(pin1.length<4){setErr("PIN must be at least 4 digits.");return;}
    if(pin1!==pin2){setErr("PINs don't match.");return;}
    await setLockPin(pin1);
    setPinSet(true);setEnabled(true);setShowPinSetup(false);setPin1("");setPin2("");setErr("");
    toast("success","PIN unlock enabled.");
  };
  const turnOff=()=>{disableLock();setEnabled(false);setHasBiometric(false);setPinSet(false);toast("success","App lock turned off.");};
  return(
    <div style={{background:T.card,borderRadius:12,padding:16,marginBottom:16,border:`1px solid ${T.border}`}}>
      <div style={{fontSize:14,fontWeight:700,color:T.text,marginBottom:6}}>🔒 App Lock</div>
      <div style={{fontSize:12,color:T.subtext,marginBottom:12}}>Require Face ID, Touch ID, or a PIN to open acountee on this device — including when you're offline.</div>
      <FormError msg={err}/>
      {enabled?<div>
        <div style={{fontSize:13,color:"#10B981",fontWeight:600,marginBottom:10}}>✓ Lock is on{hasBiometric?" (biometric)":pinSet?" (PIN)":""}</div>
        <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
          {supported&&!hasBiometric&&<Btn small outline color="#3B82F6" onClick={enroll}>Add Face ID / Touch ID</Btn>}
          {!pinSet&&<Btn small outline color="#3B82F6" onClick={()=>setShowPinSetup(true)}>{pinSet?"Change PIN":"Add PIN backup"}</Btn>}
          <Btn small outline color="#ef4444" onClick={turnOff}>Turn off lock</Btn>
        </div>
      </div>:<div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
        {supported&&<Btn small color="#3B82F6" onClick={enroll}>Set up Face ID / Touch ID</Btn>}
        <Btn small outline color="#3B82F6" onClick={()=>setShowPinSetup(true)}>Set up PIN instead</Btn>
      </div>}
      {showPinSetup&&<div style={{marginTop:12,paddingTop:12,borderTop:`1px solid ${T.border}`}}>
        <Inp label="New PIN (4+ digits)" type="password" inputMode="numeric" value={pin1} onChange={e=>setPin1(e.target.value)}/>
        <Inp label="Confirm PIN" type="password" inputMode="numeric" value={pin2} onChange={e=>setPin2(e.target.value)}/>
        <div style={{display:"flex",gap:8}}>
          <Btn small color="#3B82F6" onClick={savePin}>Save PIN</Btn>
          <Btn small outline color={T.subtext} onClick={()=>{setShowPinSetup(false);setErr("");}}>Cancel</Btn>
        </div>
      </div>}
    </div>
  );
}
const MAX_PINNED_BUDGETS=4;
function budgetKey(bankId,envId){return `${bankId}:${envId}`;}
function PinnedBudgetsCard({banks,pinnedBudgets,setPinnedBudgets}){
  const budgeted=banks.flatMap(b=>b.envelopes.filter(e=>e.budget>0).map(e=>({bank:b,env:e,key:budgetKey(b.id,e.id)})));
  const toggle=key=>{
    const on=pinnedBudgets.includes(key);
    if(!on&&pinnedBudgets.length>=MAX_PINNED_BUDGETS){toast("error",`You can pin up to ${MAX_PINNED_BUDGETS} budgets — unpin one first.`);return;}
    setPinnedBudgets(on?pinnedBudgets.filter(k=>k!==key):[...pinnedBudgets,key]);
  };
  return(
    <div style={{background:T.card,borderRadius:12,padding:16,marginBottom:16,border:`1px solid ${T.border}`}}>
      <div style={{fontSize:14,fontWeight:700,color:T.text,marginBottom:4}}>📌 Pinned Budgets</div>
      <div style={{fontSize:12,color:T.subtext,marginBottom:12}}>Pick up to {MAX_PINNED_BUDGETS} budgets to show front and center on your Dashboard, with a quick-add button for each.</div>
      {budgeted.length===0&&<div style={{color:T.faint,fontSize:13,textAlign:"center",padding:12}}>No envelopes have a monthly budget yet — set one in Banks first.</div>}
      {budgeted.map(({bank,env,key})=>{
        const on=pinnedBudgets.includes(key);
        return(
          <label key={key} style={{display:"flex",alignItems:"center",gap:10,padding:"9px 0",borderBottom:`1px solid ${T.border}`,cursor:"pointer"}}>
            <input type="checkbox" checked={on} onChange={()=>toggle(key)}/>
            <div style={{flex:1,minWidth:0}}>
              <div style={{fontSize:13.5,fontWeight:600,color:T.text}}>{env.emoji||"🗂️"} {env.name}</div>
              <div style={{fontSize:11,color:T.faint,marginTop:1}}>{bank.name}</div>
            </div>
            <div style={{fontSize:12,color:T.subtext,flexShrink:0}}>{sym(bank.currency)}{fmtNum(env.budget)}/mo</div>
          </label>
        );
      })}
    </div>
  );
}
function DashboardLayoutCard({dashboardOrder,setDashboardOrder}){
  const order=resolveDashboardOrder(dashboardOrder);
  const labels=Object.fromEntries(DASHBOARD_SECTIONS.map(s=>[s.id,s.label]));
  const move=(idx,dir)=>{
    const swapIdx=idx+dir;
    if(swapIdx<0||swapIdx>=order.length)return;
    const next=[...order];
    [next[idx],next[swapIdx]]=[next[swapIdx],next[idx]];
    setDashboardOrder(next);
  };
  return(
    <div style={{background:T.card,borderRadius:12,padding:16,marginBottom:16,border:`1px solid ${T.border}`}}>
      <div style={{fontSize:14,fontWeight:700,color:T.text,marginBottom:4}}>🔀 Dashboard Layout</div>
      <div style={{fontSize:12,color:T.subtext,marginBottom:12}}>Reorder the sections on your Dashboard.</div>
      {order.map((id,i)=>(
        <div key={id} style={{display:"flex",alignItems:"center",gap:10,padding:"8px 0",borderBottom:i<order.length-1?`1px solid ${T.border}`:"none"}}>
          <span style={{flex:1,fontSize:13.5,color:T.text}}>{labels[id]}</span>
          <button onClick={()=>move(i,-1)} disabled={i===0} style={{background:T.card2,border:`1px solid ${T.border}`,color:i===0?T.faint:T.text,borderRadius:8,cursor:i===0?"not-allowed":"pointer",fontSize:14,padding:"4px 10px"}}>▲</button>
          <button onClick={()=>move(i,1)} disabled={i===order.length-1} style={{background:T.card2,border:`1px solid ${T.border}`,color:i===order.length-1?T.faint:T.text,borderRadius:8,cursor:i===order.length-1?"not-allowed":"pointer",fontSize:14,padding:"4px 10px"}}>▼</button>
        </div>
      ))}
    </div>
  );
}
function SettingsSection({tags,setTags,banks,theme,setTheme,appName,setAppName,profile,setProfile,googleName,googlePhoto,userId,userEmail,pinnedBudgets,setPinnedBudgets,dashboardOrder,setDashboardOrder,getData,onImport,onSignOut}){
  const[newTag,setNewTag]=useState("");
  const[confirmDelTag,setConfirmDelTag]=useState(null);
  const[pendingImport,setPendingImport]=useState(null);
  const[importErr,setImportErr]=useState("");
  const fileRef=useRef(null);const picRef=useRef(null);
  const tagUsage=tag=>banks.reduce((c,b)=>c+b.envelopes.reduce((c2,e)=>c2+e.transactions.filter(t=>t.tag===tag).length,0),0);
  const addTag=()=>{if(!newTag.trim()||tags.includes(newTag.trim()))return;setTags(t=>[...t,newTag.trim()]);setNewTag("");};
  const reqDelTag=tag=>{const u=tagUsage(tag);setConfirmDelTag({tag,count:u});};
  const delTag=tag=>{setTags(t=>t.filter(x=>x!==tag));setConfirmDelTag(null);};
  const exportData=()=>{const blob=new Blob([JSON.stringify(getData(),null,2)],{type:"application/json"});const url=URL.createObjectURL(blob);const a=document.createElement("a");a.href=url;a.download=`acountee-backup-${localDateStr()}.json`;a.click();URL.revokeObjectURL(url);};
  const importData=e=>{const file=e.target.files?.[0];if(!file)return;const reader=new FileReader();reader.onload=ev=>{try{const p=JSON.parse(ev.target.result);setImportErr("");setPendingImport(p);}catch{setImportErr("That file isn't a valid acountee backup (invalid JSON).");}};reader.readAsText(file);e.target.value="";};
  const confirmImport=()=>{onImport(pendingImport);setPendingImport(null);toast("success","Backup restored.");};
  const uploadPic=e=>{const file=e.target.files?.[0];if(!file)return;const reader=new FileReader();reader.onload=ev=>{const img=new Image();img.onload=()=>{const canvas=document.createElement("canvas");const size=128;canvas.width=size;canvas.height=size;const ctx=canvas.getContext("2d");const min=Math.min(img.width,img.height);ctx.drawImage(img,(img.width-min)/2,(img.height-min)/2,min,min,0,0,size,size);setProfile(p=>({...p,photo:canvas.toDataURL("image/jpeg",0.8)}));};img.src=ev.target.result;};reader.readAsDataURL(file);e.target.value="";};
  const displayName=profile.name||googleName||"";
  const displayPhoto=profile.photo||googlePhoto||"";
  const card={background:T.card,borderRadius:12,padding:16,marginBottom:16,border:`1px solid ${T.border}`};
  return(
    <div>
      <div style={card}>
        <div style={{fontSize:14,fontWeight:700,color:T.text,marginBottom:12}}>👤 Profile</div>
        <div style={{display:"flex",alignItems:"center",gap:14,marginBottom:12}}>
          <div style={{width:64,height:64,borderRadius:"50%",overflow:"hidden",background:T.card2,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>
            {displayPhoto?<img src={displayPhoto} alt="" style={{width:"100%",height:"100%",objectFit:"cover"}}/>:<span style={{fontSize:24}}>👤</span>}
          </div>
          <div style={{flex:1}}>
            <Btn small outline color="#3B82F6" onClick={()=>picRef.current?.click()}>Upload Photo</Btn>
            {profile.photo&&<Btn small outline color="#ef4444" onClick={()=>setProfile(p=>({...p,photo:""}))} style={{marginLeft:6}}>Use Google</Btn>}
            <input ref={picRef} type="file" accept="image/*" onChange={uploadPic} style={{display:"none"}}/>
          </div>
        </div>
        <Inp label="Display Name (blank uses Google)" value={profile.name} onChange={e=>setProfile(p=>({...p,name:e.target.value}))} placeholder={googleName||"Your name"}/>
        <div style={{fontSize:12,color:T.faint}}>Showing as: <strong style={{color:T.text}}>{displayName||"—"}</strong></div>
      </div>
      <DashboardLayoutCard dashboardOrder={dashboardOrder} setDashboardOrder={setDashboardOrder}/>
      <PinnedBudgetsCard banks={banks} pinnedBudgets={pinnedBudgets} setPinnedBudgets={setPinnedBudgets}/>
      <LockSettingsCard userId={userId} userEmail={userEmail}/>
      <div style={card}>
        <div style={{fontSize:14,fontWeight:700,color:T.text,marginBottom:12}}>🎨 Appearance</div>
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between"}}>
          <span style={{fontSize:13,color:T.subtext}}>Theme</span>
          <Btn small outline color={T.subtext} onClick={()=>setTheme(t=>t==="dark"?"light":"dark")}>{theme==="dark"?"☀️ Light":"🌙 Dark"}</Btn>
        </div>
        <div style={{marginTop:12}}><Inp label="App Name" value={appName} onChange={e=>setAppName(e.target.value)} placeholder="acountee"/></div>
      </div>
      <div style={card}>
        <div style={{fontSize:14,fontWeight:700,color:T.text,marginBottom:10}}>🏷️ Manage Tags</div>
        <div style={{display:"flex",gap:8,marginBottom:10}}>
          <input value={newTag} onChange={e=>setNewTag(e.target.value)} onKeyDown={e=>e.key==="Enter"&&addTag()} placeholder="New tag..." style={{flex:1,background:T.input,border:`1px solid ${T.border}`,borderRadius:8,padding:"6px 10px",color:T.text,fontSize:13}}/>
          <Btn small color="#3B82F6" onClick={addTag}>Add</Btn>
        </div>
        <div style={{display:"flex",flexWrap:"wrap",gap:6}}>
          {tags.map((t,i)=>(
            <div key={t} style={{background:`${COLORS_LIST[i%COLORS_LIST.length]}22`,border:`1px solid ${COLORS_LIST[i%COLORS_LIST.length]}44`,borderRadius:6,padding:"3px 10px",fontSize:12,color:COLORS_LIST[i%COLORS_LIST.length],display:"flex",alignItems:"center",gap:6}}>
              {t}<button onClick={()=>reqDelTag(t)} style={{background:"none",border:"none",color:"#ef4444",cursor:"pointer",fontSize:12,padding:0}}>×</button>
            </div>
          ))}
          {tags.length===0&&<span style={{fontSize:12,color:T.faint}}>No tags yet</span>}
        </div>
      </div>
      <div style={card}>
        <div style={{fontSize:14,fontWeight:700,color:T.text,marginBottom:10}}>💾 Backup</div>
        <FormError msg={importErr}/>
        <div style={{display:"flex",gap:8}}>
          <Btn small outline color="#10B981" onClick={exportData}>⬇ Download Backup</Btn>
          <Btn small outline color="#3B82F6" onClick={()=>fileRef.current?.click()}>⬆ Restore Backup</Btn>
          <input ref={fileRef} type="file" accept="application/json" onChange={importData} style={{display:"none"}}/>
        </div>
      </div>
      <div style={card}>
        <div style={{fontSize:14,fontWeight:700,color:T.text,marginBottom:10}}>Account</div>
        <Btn outline color="#ef4444" onClick={onSignOut} style={{width:"100%"}}>Sign out</Btn>
      </div>
      {confirmDelTag&&<ConfirmModal message={confirmDelTag.count>0?`Tag "${confirmDelTag.tag}" is used by ${confirmDelTag.count} transaction${confirmDelTag.count!==1?"s":""}.`:`Delete tag "${confirmDelTag.tag}"?`} detail={confirmDelTag.count>0?"Those transactions will lose this tag label. Continue?":undefined} confirmLabel="Delete Tag" requireDel={confirmDelTag.count>0} onConfirm={()=>delTag(confirmDelTag.tag)} onClose={()=>setConfirmDelTag(null)}/>}
      {pendingImport&&<ConfirmModal message="Replace all current data with this backup?" detail="Every bank, envelope, transaction, investment and note currently in the app will be overwritten. This can't be undone." confirmLabel="Replace everything" requireDel onConfirm={confirmImport} onClose={()=>setPendingImport(null)}/>}
    </div>
  );
}
export default function FinanceTracker({userId,userEmail,userName,userPhoto,isOffline,onSignOut}){
  const[tab,setTab]=useState(0);
  const[theme,setTheme]=useState("light");
  T=THEMES[theme];
  const[banks,setBanks]=useState([]);
  const[investments,setInvestments]=useState([]);
  const[tags,setTags]=useState(["Food","Transport","Rent","Entertainment","Health","Shopping","Utilities","Salary"]);
  const notesState=useUndoable([]);
  const[notes,setNotes]=[notesState[0],notesState[1]];
  const[appName,setAppName]=useState("acountee");
  const[profile,setProfile]=useState({name:"",photo:""});
  const[overviewCur,setOverviewCur]=useState("USD");
  const[hideTotals,setHideTotals]=useState(false);
  const[analyticsPrefs,setAnalyticsPrefs]=useState({currency:null,accounts:null});
  const[pinnedBudgets,setPinnedBudgets]=useState([]);
  const[focusBank,setFocusBank]=useState(null);
  const openBank=bankId=>{setFocusBank(String(bankId));setTab(1);};
  const[dashboardOrder,setDashboardOrder]=useState(DEFAULT_DASHBOARD_ORDER);
  const[syncStatus,setSyncStatus]=useState("loading");
  const isOnline=useOnlineStatus();
  const saveTimerRef=useRef(null);
  const initialLoadDone=useRef(false);
  const getCurrentPayload=useRef(null);

  useEffect(()=>{
    (async()=>{
      setSyncStatus("loading");
      const data=await loadData(userId);
      if(data){
        if(data.banks)setBanks(normalizeBanks(data.banks));
        else if(data.phpBanks||data.sgdBanks)setBanks(normalizeBanks([...(data.phpBanks||[]).map(b=>({...b,currency:"PHP"})),...(data.sgdBanks||[]).map(b=>({...b,currency:"SGD"}))]));
        let inv=[];
        if(data.investments){inv=data.investments.map(i=>{if(i.items)return i;const v=parseFloat(i.value)||0;return{id:i.id||Date.now()+Math.random(),name:i.name,bucket:i.bucket||"Stocks",items:[{id:Date.now()+Math.random(),name:i.name,currency:i.currency||"USD",cost:i.cost||0,value:v,notes:i.notes||"",history:i.history||[{value:v,date:new Date().toISOString()}]}]};});}
        if(data.crypto){const cryptoItems=data.crypto.map(c=>({id:(c.id||Date.now())+Math.random(),name:c.coin,currency:c.currency||"USD",cost:0,value:parseFloat(c.value)||0,notes:c.notes||`${c.amount} tokens`,history:[{value:parseFloat(c.value)||0,date:new Date().toISOString()}]}));if(cryptoItems.length)inv.push({id:Date.now()+Math.random(),name:"Crypto Portfolio",bucket:"Crypto",items:cryptoItems});}
        setInvestments(inv);
        if(data.tags)setTags(data.tags);
        if(Array.isArray(data.notes))setNotes(data.notes);
        else if(typeof data.notes==="string"&&data.notes.trim())setNotes([{id:Date.now(),text:data.notes}]);
        if(data.theme)setTheme(data.theme);
        if(data.appName)setAppName(data.appName);
        if(data.profile)setProfile(data.profile);
        if(data.overviewCur)setOverviewCur(data.overviewCur);
        if(data.hideTotals!==undefined)setHideTotals(data.hideTotals);
        if(data.analyticsPrefs)setAnalyticsPrefs(data.analyticsPrefs);
        if(Array.isArray(data.pinnedBudgets))setPinnedBudgets(data.pinnedBudgets);
        if(Array.isArray(data.dashboardOrder))setDashboardOrder(data.dashboardOrder);
      }
      setSyncStatus("saved");
      initialLoadDone.current=true;
    })();
  // eslint-disable-next-line
  },[userId]);

  useEffect(()=>{
    if(!initialLoadDone.current)return;
    getCurrentPayload.current=()=>({banks,investments,tags,notes,theme,appName,profile,overviewCur,hideTotals,analyticsPrefs,pinnedBudgets,dashboardOrder});
    setSyncStatus("saving");
    if(saveTimerRef.current)clearTimeout(saveTimerRef.current);
    saveTimerRef.current=setTimeout(async()=>{
      const result=await saveData(userId,{banks,investments,tags,notes,theme,appName,profile,overviewCur,hideTotals,analyticsPrefs,pinnedBudgets,dashboardOrder});
      if(result==="synced")setSyncStatus("saved");
      else if(result==="queued-offline")setSyncStatus("offline");
      else{setSyncStatus("error");toast("error","Couldn't reach the server — saved on this device and will sync once it's back.");}
    },2000);
    return()=>clearTimeout(saveTimerRef.current);
  },[banks,investments,tags,notes,theme,appName,profile,overviewCur,hideTotals,analyticsPrefs,pinnedBudgets,dashboardOrder,userId,isOnline]);

  useEffect(()=>{
    const flushPendingSave=()=>{
      if(!initialLoadDone.current)return;
      if(saveTimerRef.current){
        clearTimeout(saveTimerRef.current);
        saveTimerRef.current=null;
        const payload=getCurrentPayload.current?.();
        if(payload)saveData(userId,payload);
      }
    };
    const onVisibilityChange=()=>{if(document.hidden)flushPendingSave();};
    document.addEventListener("visibilitychange",onVisibilityChange);
    window.addEventListener("pagehide",flushPendingSave);
    window.addEventListener("beforeunload",flushPendingSave);
    return()=>{
      document.removeEventListener("visibilitychange",onVisibilityChange);
      window.removeEventListener("pagehide",flushPendingSave);
      window.removeEventListener("beforeunload",flushPendingSave);
    };
  },[userId]);

  useEffect(()=>{
    if(!initialLoadDone.current)return;
    const unsub=syncWhenOnline(userId,()=>getCurrentPayload.current?.()??{},result=>{
      if(result==="synced"){setSyncStatus("saved");toast("success","Back online — synced.");}
      else{setSyncStatus("error");toast("error","Still couldn't sync — will keep retrying.");}
    });
    return()=>{unsub.then(fn=>fn?.());};
  },[userId]);

  const importBackup=p=>{
    if(p.banks)setBanks(normalizeBanks(p.banks));
    if(p.investments)setInvestments(p.investments);
    if(p.tags)setTags(p.tags);
    if(Array.isArray(p.notes))setNotes(p.notes);
    if(p.theme)setTheme(p.theme);
    if(p.appName)setAppName(p.appName);
    if(p.profile)setProfile(p.profile);
    if(p.overviewCur)setOverviewCur(p.overviewCur);
    if(p.hideTotals!==undefined)setHideTotals(p.hideTotals);
    if(p.analyticsPrefs)setAnalyticsPrefs(p.analyticsPrefs);
    if(Array.isArray(p.pinnedBudgets))setPinnedBudgets(p.pinnedBudgets);
    if(Array.isArray(p.dashboardOrder))setDashboardOrder(p.dashboardOrder);
  };
  const getData=()=>({banks,investments,tags,notes,theme,appName,profile,overviewCur,hideTotals,analyticsPrefs,pinnedBudgets,dashboardOrder});
  const TAB_COLORS=["#3B82F6","#3B82F6","#8B5CF6","#06B6D4","#10B981","#64748B"];

  return(
    <div style={{minHeight:"100vh",background:T.bg,color:T.text,fontFamily:"system-ui,sans-serif"}}>
      <ToastHost/>
      {isOffline&&<div style={{background:"#F97316",color:"#fff",textAlign:"center",fontSize:12,fontWeight:600,padding:"6px 12px"}}>📵 Offline — showing data saved on this device. Changes will sync once you're back online.</div>}
      <div style={{maxWidth:680,margin:"0 auto",padding:"0 16px 40px"}}>
        <div style={{padding:"20px 0 12px",borderBottom:`1px solid ${T.border}`,marginBottom:20,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
          <div>
            <div style={{fontSize:22,fontWeight:700}}>💰 {appName}</div>
            <VersionBar/>
          </div>
          <div style={{display:"flex",alignItems:"center",gap:8}}>
            <SyncBar status={syncStatus} isOnline={isOnline}/>
            <button onClick={()=>setTheme(t=>t==="dark"?"light":"dark")} style={{background:T.card,border:`1px solid ${T.border}`,borderRadius:8,padding:"5px 10px",cursor:"pointer",fontSize:14}}>{theme==="dark"?"☀️":"🌙"}</button>
            <button onClick={onSignOut} style={{background:"transparent",border:`1px solid ${T.border}`,color:T.subtext,borderRadius:8,padding:"5px 12px",cursor:"pointer",fontSize:12}}>Sign out</button>
          </div>
        </div>
        <div style={{display:"flex",gap:6,overflowX:"auto",marginBottom:24,paddingBottom:4}}>
          {TABS.map((t,i)=>(<button key={t} onClick={()=>setTab(i)} style={{background:tab===i?TAB_COLORS[i]:T.card,color:tab===i?"#fff":T.subtext,border:"none",borderRadius:8,padding:"7px 14px",cursor:"pointer",fontSize:13,fontWeight:500,whiteSpace:"nowrap",flexShrink:0}}>{t}</button>))}
        </div>
        {syncStatus==="loading"?<DashboardSkeleton/>:<>
        {tab===0&&<Dashboard banks={banks} setBanks={setBanks} tags={tags} investments={investments} overviewCur={overviewCur} setOverviewCur={setOverviewCur} hideTotals={hideTotals} setHideTotals={setHideTotals} pinnedBudgets={pinnedBudgets} dashboardOrder={dashboardOrder}/>}
        {tab===1&&<BanksSection banks={banks} setBanks={setBanks} tags={tags} focusBank={focusBank} clearFocusBank={()=>setFocusBank(null)}/>}
        {tab===2&&<InvestmentsSection investments={investments} setInvestments={setInvestments} hideTotals={hideTotals}/>}
        {tab===3&&<AnalyticsSection banks={banks} setBanks={setBanks} tags={tags} setTags={setTags} prefs={analyticsPrefs} setPrefs={setAnalyticsPrefs} onOpenBank={openBank}/>}
        {tab===4&&<NotesSection notesState={notesState}/>}
        {tab===5&&<SettingsSection tags={tags} setTags={setTags} banks={banks} theme={theme} setTheme={setTheme} appName={appName} setAppName={setAppName} profile={profile} setProfile={setProfile} googleName={userName} googlePhoto={userPhoto} userId={userId} userEmail={userEmail} pinnedBudgets={pinnedBudgets} setPinnedBudgets={setPinnedBudgets} dashboardOrder={dashboardOrder} setDashboardOrder={setDashboardOrder} getData={getData} onImport={importBackup} onSignOut={onSignOut}/>}
        </>}
      </div>
    </div>
  );
}
