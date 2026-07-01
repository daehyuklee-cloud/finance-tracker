import { useState, useEffect, useRef, useCallback } from "react";
import { loadData, saveData, syncWhenOnline } from "../db";

const TABS = ["Dashboard", "Banks", "Investments", "Analytics", "Notes", "Settings"];
const COLORS_LIST = ["#3B82F6","#10B981","#F59E0B","#8B5CF6","#EC4899","#06B6D4","#F97316","#84CC16","#EF4444","#14B8A6"];
const BANK_COLOR_CHOICES = ["#3B82F6","#10B981","#F59E0B","#8B5CF6","#EC4899","#06B6D4","#F97316","#84CC16","#EF4444","#14B8A6","#A855F7","#64748B"];
const ENVELOPE_EMOJIS = ["🗂️","🏠","🚗","🍔","✈️","💊","🎁","💡","📚","👕","🎮","💰","🏦","❤️","🎓","🐶","☕","🛒","💳","🔧","🎵","🏖️","💼","📱"];
const UNALLOC_ID = "__unallocated__";
const MAX_HISTORY = 50;
const CURRENCY_SYMBOLS = { PHP:"₱", SGD:"S$", USD:"$", KRW:"₩", JPY:"¥", EUR:"€", GBP:"£", AUD:"A$", HKD:"HK$", MYR:"RM", IDR:"Rp", THB:"฿" };
const CURRENCY_LIST = Object.keys(CURRENCY_SYMBOLS);
const INVESTMENT_BUCKETS = ["Stocks","ETF","Crypto","Artwork","Watches","Real Estate","Bonds","Other"];
const VERSION = "v5.1.1";

function sym(c){ return CURRENCY_SYMBOLS[c]||(c?c+" ":""); }
const fmtNum = n => Number(n||0).toLocaleString("en-US",{minimumFractionDigits:2,maximumFractionDigits:2});
function getCurrencyColor(currency){ const idx=CURRENCY_LIST.indexOf(currency); return COLORS_LIST[Math.max(0,idx)%COLORS_LIST.length]; }
function bankColor(b){ return b.color||getCurrencyColor(b.currency); }

const THEMES = {
  dark:{ bg:"#0f1117", card:"#1e2130", card2:"#0f1117", border:"#334155", text:"#f1f5f9", subtext:"#94a3b8", faint:"#475569", input:"#0f1117" },
  light:{ bg:"#f8fafc", card:"#ffffff", card2:"#f1f5f9", border:"#e2e8f0", text:"#0f172a", subtext:"#475569", faint:"#94a3b8", input:"#ffffff" }
};
let T = THEMES.light;

function maskVal(str,hide){ return hide?"••••••":str; }

// ── Exchange Rate ──
const rateCache={};
async function fetchRate(from,to){
  if(from===to)return 1;
  const key=`${from}_${to}`;
  if(rateCache[key]!==undefined)return rateCache[key];
  try{
    const res=await fetch(`https://open.er-api.com/v6/latest/${from}`);
    const data=await res.json();
    const r=(data.result==="success"&&data.rates?.[to])?data.rates[to]:null;
    if(r!==null)Object.entries(data.rates||{}).forEach(([cur,val])=>{rateCache[`${from}_${cur}`]=val;});
    else rateCache[key]=null;
    return r;
  }catch{return null;}
}
function useMultiConvert(items,target){
  const [total,setTotal]=useState(null);
  useEffect(()=>{
    let active=true;
    (async()=>{let sum=0,ok=true;for(const it of items){const r=await fetchRate(it.currency,target);if(r===null){ok=false;break;}sum+=it.amount*r;}if(active)setTotal(ok?sum:null);})();
    return()=>{active=false;};
  // eslint-disable-next-line
  },[JSON.stringify(items),target]);
  return total;
}
function ConversionBadge({amount,fromCurrency,toCurrency,style}){
  const [rate,setRate]=useState(null);
  useEffect(()=>{if(fromCurrency!==toCurrency)fetchRate(fromCurrency,toCurrency).then(setRate);},[fromCurrency,toCurrency]);
  if(fromCurrency===toCurrency||rate===null)return null;
  return <span style={{fontSize:11,color:T.faint,marginLeft:8,...style}}>≈ {sym(toCurrency)}{fmtNum(amount*rate)} {toCurrency}</span>;
}

function useOnlineStatus(){
  const [online,setOnline]=useState(navigator.onLine);
  useEffect(()=>{const on=()=>setOnline(true);const off=()=>setOnline(false);window.addEventListener("online",on);window.addEventListener("offline",off);return()=>{window.removeEventListener("online",on);window.removeEventListener("offline",off);};},[]);
  return online;
}

function useUndoable(init){
  const [history,setHistory]=useState([init]);
  const [idx,setIdx]=useState(0);
  const val=history[idx];
  const set=useCallback((fn)=>{setHistory(h=>{const next=typeof fn==="function"?fn(h[idx]):fn;return[...h.slice(0,idx+1),next].slice(-MAX_HISTORY);});setIdx(i=>Math.min(i+1,MAX_HISTORY-1));},[idx]);
  const undo=useCallback(()=>setIdx(i=>Math.max(0,i-1)),[]);
  const redo=useCallback(()=>setIdx(i=>Math.min(history.length-1,i+1)),[history.length]);
  return[val,set,undo,redo,idx>0,idx<history.length-1];
}

function Modal({title,onClose,children,isDirty=false}){
  const requestClose=()=>{if(isDirty){if(window.confirm("You have unsaved changes. Close anyway?"))onClose();}else onClose();};
  return(
    <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.6)",zIndex:100,display:"flex",alignItems:"center",justifyContent:"center"}} onClick={requestClose}>
      <div onClick={e=>e.stopPropagation()} style={{background:T.card,borderRadius:12,padding:24,minWidth:340,maxWidth:480,width:"90%",maxHeight:"85vh",overflowY:"auto"}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16}}>
          <strong style={{fontSize:16,color:T.text}}>{title}</strong>
          <button onClick={requestClose} style={{background:"none",border:"none",color:T.subtext,cursor:"pointer",fontSize:22,lineHeight:1}}>×</button>
        </div>
        {children}
      </div>
    </div>
  );
}

function ConfirmModal({message,detail,confirmLabel="Delete",requireDel,onConfirm,onClose}){
  const [val,setVal]=useState("");
  const ok=requireDel?val==="DEL":true;
  return(
    <Modal title="Please Confirm" onClose={onClose} isDirty={false}>
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

function Inp({label,...p}){return(<div style={{marginBottom:12}}>{label&&<div style={{fontSize:12,color:T.subtext,marginBottom:4}}>{label}</div>}<input {...p} style={{width:"100%",background:T.input,border:`1px solid ${T.border}`,borderRadius:8,padding:"8px 10px",color:T.text,fontSize:14,boxSizing:"border-box",...p.style}}/></div>);}
function Sel({label,children,...p}){return(<div style={{marginBottom:12}}>{label&&<div style={{fontSize:12,color:T.subtext,marginBottom:4}}>{label}</div>}<select {...p} style={{width:"100%",background:T.input,border:`1px solid ${T.border}`,borderRadius:8,padding:"8px 10px",color:T.text,fontSize:14,...p.style}}>{children}</select></div>);}
function Btn({children,color="#3B82F6",outline,small,...p}){return(<button {...p} style={{background:outline?"transparent":color,border:`1px solid ${color}`,color:outline?color:"#fff",borderRadius:8,padding:small?"4px 10px":"8px 16px",fontSize:small?12:14,cursor:"pointer",fontWeight:500,...p.style}}>{children}</button>);}
function UndoBar({undo,redo,canUndo,canRedo}){return(<div style={{display:"flex",gap:6,marginBottom:14}}><button onClick={undo} disabled={!canUndo} style={{background:canUndo?T.card:T.card2,border:`1px solid ${T.border}`,color:canUndo?T.text:T.faint,borderRadius:8,padding:"5px 12px",cursor:canUndo?"pointer":"not-allowed",fontSize:13}}>↩ Undo</button><button onClick={redo} disabled={!canRedo} style={{background:canRedo?T.card:T.card2,border:`1px solid ${T.border}`,color:canRedo?T.text:T.faint,borderRadius:8,padding:"5px 12px",cursor:canRedo?"pointer":"not-allowed",fontSize:13}}>↪ Redo</button></div>);}
function SyncBar({status,isOnline}){
  const colors={idle:T.faint,saving:"#F59E0B",saved:"#10B981",error:"#ef4444",loading:"#3B82F6",offline:"#F97316"};
  const icons={idle:"☁️",saving:"⏳",saved:"✓",error:"⚠️",loading:"⏳",offline:"📵"};
  const labels={idle:"Ready",saving:"Saving…",saved:"Saved",error:"Failed",loading:"Loading…",offline:"Offline"};
  const s=!isOnline?"offline":status;
  return<div style={{display:"flex",alignItems:"center",gap:6,fontSize:12,color:colors[s],padding:"4px 10px",background:T.card,borderRadius:8}}><span>{icons[s]}</span><span>{labels[s]}</span></div>;
}

function makeBank(name,currency,balance,color){return{id:Date.now(),name,currency,color:color||null,balance,envelopes:[{id:UNALLOC_ID,name:"Unallocated",emoji:"📂",balance,transactions:[],isUnalloc:true}]};}
function bankTotal(bank){return(bank.envelopes||[]).reduce((s,e)=>s+e.balance,0);}

function EmojiPicker({value,onPick}){return(<div style={{display:"flex",flexWrap:"wrap",gap:6,marginBottom:12}}>{ENVELOPE_EMOJIS.map(em=>(<button key={em} onClick={()=>onPick(em)} style={{fontSize:18,padding:"4px 6px",borderRadius:8,cursor:"pointer",background:value===em?"#3B82F6":T.input,border:`1px solid ${value===em?"#3B82F6":T.border}`}}>{em}</button>))}</div>);}

function TxEditModal({tx,tags,onSave,onClose}){
  const [form,setForm]=useState({...tx});
  const isDirty=JSON.stringify(form)!==JSON.stringify(tx);
  return(
    <Modal title="Edit Transaction" onClose={onClose} isDirty={isDirty}>
      <div style={{display:"flex",gap:8,marginBottom:12}}>{["income","expense"].map(t=><Btn key={t} color={t==="income"?"#10B981":"#ef4444"} outline={form.type!==t} onClick={()=>setForm(f=>({...f,type:t}))} style={{flex:1,textTransform:"capitalize"}}>{t}</Btn>)}</div>
      <Inp label="Description" value={form.desc} onChange={e=>setForm(f=>({...f,desc:e.target.value}))}/>
      <Inp label="Amount" type="number" value={form.amount} onChange={e=>setForm(f=>({...f,amount:e.target.value}))}/>
      <Sel label="Tag" value={form.tag||""} onChange={e=>setForm(f=>({...f,tag:e.target.value}))}><option value="">No tag</option>{(tags||[]).map(t=><option key={t} value={t}>{t}</option>)}</Sel>
      <Inp label="Note" value={form.note||""} onChange={e=>setForm(f=>({...f,note:e.target.value}))}/>
      <Inp label="Date" type="date" value={form.date} onChange={e=>setForm(f=>({...f,date:e.target.value}))}/>
      <Btn color="#3B82F6" onClick={()=>onSave({...form,amount:parseFloat(form.amount)||0})} style={{width:"100%"}}>Save Changes</Btn>
    </Modal>
  );
}

// ── Transfer Modal (interbank) ──
function TransferModal({bank,allBanks,onClose,onTransfer}){
  const color=bankColor(bank);
  const [fromEnvId,setFromEnvId]=useState(bank.envelopes[0]?.id||"");
  const [toBank,setToBank]=useState(String(bank.id));
  const [toEnvId,setToEnvId]=useState("");
  const [amt,setAmt]=useState("");
  const [fee,setFee]=useState("");
  const [received,setReceived]=useState("");
  const srcEnvs=bank.envelopes||[];
  const destBank=allBanks.find(b=>String(b.id)===String(toBank));
  const destEnvs=destBank?.envelopes||[];
  const isCross=destBank&&destBank.currency!==bank.currency;
  const isDirty=!!amt||!!fee||!!received;
  useEffect(()=>{setToEnvId(destEnvs[0]?.id||"");},[toBank]);
  const doTransfer=()=>{
    const a=parseFloat(amt)||0;
    const f=parseFloat(fee)||0;
    const total=a+f;
    const srcEnv=srcEnvs.find(e=>e.id===fromEnvId);
    const destEnv=destEnvs.find(e=>e.id===toEnvId);
    if(!srcEnv||!destEnv)return;
    if(String(toBank)===String(bank.id)&&fromEnvId===toEnvId){alert("Source and destination must differ.");return;}
    if(srcEnv.balance<total){alert(`Insufficient balance. Need ${sym(bank.currency)}${fmtNum(total)}.`);return;}
    const rec=isCross?(parseFloat(received)||0):a;
    if(isCross&&!rec){alert("Please enter the amount received in the destination currency.");return;}
    onTransfer({srcEnv,destEnv,destBank,amt:a,fee:f,received:rec,isCross,srcCurrency:bank.currency,destCurrency:destBank.currency});
    onClose();
  };
  return(
    <Modal title="Transfer" onClose={onClose} isDirty={isDirty}>
      <div style={{fontSize:12,color:T.subtext,marginBottom:4}}>From</div>
      <div style={{display:"flex",gap:8,marginBottom:12}}>
        <div style={{flex:1,background:T.card2,border:`1px solid ${T.border}`,borderRadius:8,padding:"8px 10px",color:T.text,fontSize:14}}>{bank.name}</div>
        <select value={fromEnvId} onChange={e=>setFromEnvId(e.target.value)} style={{flex:1,background:T.input,border:`1px solid ${T.border}`,borderRadius:8,padding:"8px 10px",color:T.text,fontSize:14}}>
          {srcEnvs.map(e=><option key={e.id} value={e.id}>{e.name} ({sym(bank.currency)}{fmtNum(e.balance)})</option>)}
        </select>
      </div>
      <div style={{fontSize:12,color:T.subtext,marginBottom:4}}>To</div>
      <div style={{display:"flex",gap:8,marginBottom:12}}>
        <select value={toBank} onChange={e=>setToBank(e.target.value)} style={{flex:1,background:T.input,border:`1px solid ${T.border}`,borderRadius:8,padding:"8px 10px",color:T.text,fontSize:14}}>
          {allBanks.map(b=><option key={b.id} value={String(b.id)}>{b.name} ({b.currency})</option>)}
        </select>
        <select value={toEnvId} onChange={e=>setToEnvId(e.target.value)} style={{flex:1,background:T.input,border:`1px solid ${T.border}`,borderRadius:8,padding:"8px 10px",color:T.text,fontSize:14}}>
          {destEnvs.map(e=><option key={e.id} value={e.id}>{e.name} ({sym(destBank?.currency)}{fmtNum(e.balance)})</option>)}
        </select>
      </div>
      <Inp label={`Amount to send (${bank.currency})`} type="number" value={amt} onChange={e=>setAmt(e.target.value)} placeholder="0.00"/>
      <Inp label={`Fee (${bank.currency}) — on top of transfer amount`} type="number" value={fee} onChange={e=>setFee(e.target.value)} placeholder="0.00 (optional)"/>
      {isCross&&(
        <div style={{background:"#F59E0B22",border:"1px solid #F59E0B44",borderRadius:8,padding:10,marginBottom:12}}>
          <div style={{fontSize:12,color:"#F59E0B",marginBottom:8}}>💱 Cross-currency transfer</div>
          <Inp label={`Amount received in destination (${destBank?.currency})`} type="number" value={received} onChange={e=>setReceived(e.target.value)} placeholder="Enter exact amount received"/>
        </div>
      )}
      {amt&&(
        <div style={{background:T.card2,borderRadius:8,padding:10,marginBottom:12,fontSize:12,color:T.subtext}}>
          <div>Source deducted: <strong style={{color:"#ef4444"}}>{sym(bank.currency)}{fmtNum((parseFloat(amt)||0)+(parseFloat(fee)||0))}</strong>{fee?` (${sym(bank.currency)}${fmtNum(parseFloat(amt)||0)} + ${sym(bank.currency)}${fmtNum(parseFloat(fee)||0)} fee)`:""}</div>
          <div style={{marginTop:4}}>Destination receives: <strong style={{color:"#10B981"}}>{isCross?(received?`${sym(destBank?.currency)}${fmtNum(parseFloat(received)||0)}`:"—"):`${sym(bank.currency)}${fmtNum(parseFloat(amt)||0)}`}</strong></div>
        </div>
      )}
      <Btn color={color} onClick={doTransfer} style={{width:"100%"}}>Confirm Transfer</Btn>
    </Modal>
  );
}

// ── Envelope View ──
function EnvelopeView({bank,bankId,setBanks,tags}){
  const color=bankColor(bank); const currency=bank.currency;
  const [showAdd,setShowAdd]=useState(false);
  const [showTx,setShowTx]=useState(null);
  const [showHist,setShowHist]=useState(null);
  const [editEnv,setEditEnv]=useState(null);
  const [editTx,setEditTx]=useState(null);
  const [confirmDelTx,setConfirmDelTx]=useState(null);
  const [confirmDelEnv,setConfirmDelEnv]=useState(null);
  const [envName,setEnvName]=useState(""); const [envBal,setEnvBal]=useState(""); const [envGoal,setEnvGoal]=useState(""); const [envEmoji,setEnvEmoji]=useState("🗂️");
  const [convCurrency,setConvCurrency]=useState("");
  const [tx,setTx]=useState({type:"expense",desc:"",amount:"",tag:"",note:"",date:new Date().toISOString().slice(0,10)});
  const envelopes=bank.envelopes||[]; const unallocEnv=envelopes.find(e=>e.id===UNALLOC_ID);
  const updateBank=fn=>setBanks(bs=>bs.map(b=>b.id!==bankId?b:fn(b)));

  const addEnvelope=()=>{if(!envName.trim())return;const amt=parseFloat(envBal)||0;if(unallocEnv&&amt>unallocEnv.balance+0.001){alert("Not enough in Unallocated!");return;}updateBank(b=>({...b,envelopes:b.envelopes.map(e=>e.id!==UNALLOC_ID?e:{...e,balance:e.balance-amt}).concat([{id:Date.now(),name:envName.trim(),emoji:envEmoji,balance:amt,goal:parseFloat(envGoal)||null,transactions:[]}])}));setEnvName("");setEnvBal("");setEnvGoal("");setEnvEmoji("🗂️");setShowAdd(false);};
  const saveEnvEdit=()=>{updateBank(b=>({...b,envelopes:b.envelopes.map(e=>e.id!==editEnv.id?e:{...e,name:editEnv.name,emoji:editEnv.emoji,goal:parseFloat(editEnv.goal)||null})}));setEditEnv(null);};
  const delEnvelope=envId=>{updateBank(b=>{const env=b.envelopes.find(e=>e.id===envId);return{...b,envelopes:b.envelopes.filter(e=>e.id!==envId).map(e=>e.id===UNALLOC_ID?{...e,balance:e.balance+(env?.balance||0)}:e)};});setConfirmDelEnv(null);};
  const addTx=()=>{if(!tx.desc||!tx.amount)return;const amt=parseFloat(tx.amount);const isIncome=tx.type==="income";const newTx={id:Date.now(),...tx,amount:amt};updateBank(b=>({...b,balance:b.balance+(isIncome?amt:-amt),envelopes:b.envelopes.map(e=>e.id!==showTx?e:{...e,balance:e.balance+(isIncome?amt:-amt),transactions:[newTx,...e.transactions]})}));setTx({type:"expense",desc:"",amount:"",tag:"",note:"",date:new Date().toISOString().slice(0,10)});setShowTx(null);};
  const saveTxEdit=(envId,updated)=>{updateBank(b=>{const env=b.envelopes.find(e=>e.id===envId);const old=env.transactions.find(t=>t.id===updated.id);const oldD=old.type==="income"?old.amount:-old.amount;const newD=updated.type==="income"?updated.amount:-updated.amount;const diff=newD-oldD;return{...b,balance:b.balance+diff,envelopes:b.envelopes.map(e=>e.id!==envId?e:{...e,balance:e.balance+diff,transactions:e.transactions.map(t=>t.id===updated.id?updated:t)})};});setEditTx(null);};
  const delTx=(envId,txId)=>{updateBank(b=>{const env=b.envelopes.find(e=>e.id===envId);const t=env?.transactions.find(x=>x.id===txId);if(!t)return b;const delta=t.type==="income"?-t.amount:t.amount;return{...b,balance:b.balance+delta,envelopes:b.envelopes.map(e=>e.id!==envId?e:{...e,balance:e.balance+delta,transactions:e.transactions.filter(x=>x.id!==txId)})};});setConfirmDelTx(null);};
  const histEnv=envelopes.find(e=>e.id===showHist);

  return(
    <div style={{marginTop:12}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
        <div style={{display:"flex",alignItems:"center",gap:8}}>
          <span style={{fontSize:13,color:T.subtext}}>Envelopes</span>
          <select value={convCurrency} onChange={e=>setConvCurrency(e.target.value)} style={{background:T.input,border:`1px solid ${T.border}`,borderRadius:6,padding:"2px 6px",color:T.faint,fontSize:11}}>
            <option value="">+ Convert</option>{CURRENCY_LIST.filter(c=>c!==currency).map(c=><option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        <Btn small color={color} onClick={()=>setShowAdd(true)}>+ Envelope</Btn>
      </div>

      <div style={{display:"flex",flexDirection:"column",gap:6}}>
        {envelopes.map(e=>(
          <div key={e.id} style={{background:T.card2,borderRadius:8,padding:"10px 12px",border:`1px solid ${e.isUnalloc?T.border:color+"33"}`,display:"flex",justifyContent:"space-between",alignItems:"center",gap:8}}>
            <div style={{display:"flex",alignItems:"center",gap:8,flex:1,minWidth:0}}>
              <span style={{fontSize:16}}>{e.isUnalloc?"📂":(e.emoji||"🗂️")}</span>
              <div style={{flex:1,minWidth:0}}>
                <div style={{fontSize:13,color:e.isUnalloc?T.faint:T.text,fontStyle:e.isUnalloc?"italic":"normal"}}>{e.name}{e.goal?<span style={{fontSize:11,color:T.faint,marginLeft:6}}>Goal: {sym(currency)}{fmtNum(e.goal)}</span>:null}</div>
                {e.goal&&!e.isUnalloc&&(()=>{const pct=Math.min(100,Math.round((e.balance/e.goal)*100));const rem=e.goal-e.balance;return(<div style={{marginTop:4}}><div style={{background:T.card,borderRadius:99,height:5,overflow:"hidden"}}><div style={{width:`${pct}%`,height:"100%",background:pct>=100?"#10B981":color,borderRadius:99}}/></div><div style={{fontSize:10,color:pct>=100?"#10B981":T.faint,marginTop:2}}>{pct}%{pct>=100?" ✓":<span style={{marginLeft:4,color:T.subtext}}>· {sym(currency)}{fmtNum(rem)} left</span>}</div></div>);})()}
                {!e.goal&&<div style={{fontSize:11,color:T.faint}}>{e.transactions.length} tx</div>}
              </div>
            </div>
            <div style={{display:"flex",gap:4,alignItems:"center",flexShrink:0}}>
              <div style={{textAlign:"right"}}>
                <div style={{color:e.balance<0?"#ef4444":e.isUnalloc?T.faint:color,fontWeight:600,fontSize:13}}>{sym(currency)}{fmtNum(e.balance)}</div>
                {convCurrency&&<ConversionBadge amount={e.balance} fromCurrency={currency} toCurrency={convCurrency} style={{marginLeft:0}}/>}
              </div>
              <Btn small color={color} onClick={()=>setShowTx(e.id)}>+</Btn>
              <Btn small outline color={color} onClick={()=>setShowHist(e.id)}>📄</Btn>
              {!e.isUnalloc&&<Btn small outline color={T.subtext} onClick={()=>setEditEnv({id:e.id,name:e.name,emoji:e.emoji||"🗂️",goal:e.goal||""})}>✏️</Btn>}
              {!e.isUnalloc&&<Btn small outline color="#ef4444" onClick={()=>setConfirmDelEnv({id:e.id,name:e.name})}>🗑</Btn>}
            </div>
          </div>
        ))}
      </div>

      {confirmDelEnv&&<ConfirmModal message={`Delete envelope "${confirmDelEnv.name}"?`} detail="Its balance returns to Unallocated." requireDel onConfirm={()=>delEnvelope(confirmDelEnv.id)} onClose={()=>setConfirmDelEnv(null)}/>}
      {confirmDelTx&&<ConfirmModal message={`Delete transaction "${confirmDelTx.desc}"?`} onConfirm={()=>delTx(confirmDelTx.envId,confirmDelTx.txId)} onClose={()=>setConfirmDelTx(null)}/>}

      {showAdd&&<Modal title="New Envelope" onClose={()=>setShowAdd(false)} isDirty={!!envName||!!envBal||!!envGoal}>
        <div style={{fontSize:13,color:T.subtext,marginBottom:12}}>Available: <strong style={{color}}>{sym(currency)}{fmtNum(unallocEnv?.balance||0)}</strong></div>
        <Inp label="Name" value={envName} onChange={e=>setEnvName(e.target.value)} placeholder="e.g. Rent, Emergency"/>
        <div style={{fontSize:12,color:T.subtext,marginBottom:4}}>Icon</div><EmojiPicker value={envEmoji} onPick={setEnvEmoji}/>
        <Inp label="Allocate Amount" type="number" value={envBal} onChange={e=>setEnvBal(e.target.value)} placeholder="0.00"/>
        <Inp label="Goal (optional)" type="number" value={envGoal} onChange={e=>setEnvGoal(e.target.value)} placeholder="e.g. 10000"/>
        <Btn color={color} onClick={addEnvelope} style={{width:"100%"}}>Create Envelope</Btn>
      </Modal>}

      {editEnv&&<Modal title="Edit Envelope" onClose={()=>setEditEnv(null)} isDirty={true}>
        <Inp label="Name" value={editEnv.name} onChange={e=>setEditEnv(v=>({...v,name:e.target.value}))}/>
        <div style={{fontSize:12,color:T.subtext,marginBottom:4}}>Icon</div><EmojiPicker value={editEnv.emoji} onPick={em=>setEditEnv(v=>({...v,emoji:em}))}/>
        <Inp label="Goal (blank to remove)" type="number" value={editEnv.goal} onChange={e=>setEditEnv(v=>({...v,goal:e.target.value}))}/>
        <Btn color={color} onClick={saveEnvEdit} style={{width:"100%"}}>Save</Btn>
      </Modal>}

      {showTx&&<Modal title={`Add Transaction → ${envelopes.find(e=>e.id===showTx)?.name}`} onClose={()=>setShowTx(null)} isDirty={!!tx.desc||!!tx.amount}>
        <div style={{display:"flex",gap:8,marginBottom:12}}>{["income","expense"].map(t=><Btn key={t} color={t==="income"?"#10B981":"#ef4444"} outline={tx.type!==t} onClick={()=>setTx(x=>({...x,type:t}))} style={{flex:1,textTransform:"capitalize"}}>{t}</Btn>)}</div>
        <Inp label="Description" value={tx.desc} onChange={e=>setTx(x=>({...x,desc:e.target.value}))} placeholder="e.g. Salary, Groceries"/>
        <Inp label="Amount" type="number" value={tx.amount} onChange={e=>setTx(x=>({...x,amount:e.target.value}))} placeholder="0.00"/>
        <Sel label="Tag (optional)" value={tx.tag} onChange={e=>setTx(x=>({...x,tag:e.target.value}))}><option value="">No tag</option>{(tags||[]).map(t=><option key={t} value={t}>{t}</option>)}</Sel>
        <Inp label="Note (optional)" value={tx.note} onChange={e=>setTx(x=>({...x,note:e.target.value}))} placeholder="Any notes..."/>
        <Inp label="Date" type="date" value={tx.date} onChange={e=>setTx(x=>({...x,date:e.target.value}))}/>
        <Btn color={color} onClick={addTx} style={{width:"100%"}}>Add Transaction</Btn>
      </Modal>}

      {showHist&&<Modal title={`${histEnv?.name} · History`} onClose={()=>setShowHist(null)} isDirty={false}>
        {histEnv?.transactions.length===0&&<div style={{color:T.faint,textAlign:"center",padding:16}}>No transactions yet.</div>}
        <div style={{display:"flex",flexDirection:"column",gap:8,maxHeight:360,overflowY:"auto"}}>
          {histEnv?.transactions.map(t=>(
            <div key={t.id} style={{background:T.card2,borderRadius:8,padding:"8px 12px"}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                <div><div style={{fontSize:13,color:T.text}}>{t.desc}</div><div style={{fontSize:11,color:T.faint}}>{t.date}{t.tag?<span style={{marginLeft:6,background:T.card,borderRadius:4,padding:"1px 6px"}}>{t.tag}</span>:null}</div>{t.note&&<div style={{fontSize:11,color:T.faint,marginTop:2,fontStyle:"italic"}}>{t.note}</div>}</div>
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

// ── Banks Section ──
function BanksSection({banks,setBanks,tags}){
  const [showBank,setShowBank]=useState(false);
  const [expandedSet,setExpandedSet]=useState({});
  const [editBank,setEditBank]=useState(null);
  const [confirmDel,setConfirmDel]=useState(null);
  const [transferBank,setTransferBank]=useState(null);
  const [bankName,setBankName]=useState(""); const [bankCurrency,setBankCurrency]=useState("PHP"); const [bankBal,setBankBal]=useState(""); const [bankColorPick,setBankColorPick]=useState(BANK_COLOR_CHOICES[0]);
  const [globalConv,setGlobalConv]=useState("");
  const grouped=banks.reduce((acc,b)=>{(acc[b.currency]=acc[b.currency]||[]).push(b);return acc;},{});
  const toggle=id=>setExpandedSet(s=>({...s,[id]:!s[id]}));
  const addBank=()=>{if(!bankName.trim())return;setBanks(b=>[...b,makeBank(bankName.trim(),bankCurrency,parseFloat(bankBal)||0,bankColorPick)]);setBankName("");setBankBal("");setShowBank(false);};
  const saveBankEdit=()=>{const newTotal=parseFloat(editBank.balance);setBanks(bs=>bs.map(b=>{if(b.id!==editBank.id)return b;let envelopes=b.envelopes;if(!isNaN(newTotal)&&newTotal!==bankTotal(b)){const diff=newTotal-bankTotal(b);envelopes=b.envelopes.map(e=>e.id===UNALLOC_ID?{...e,balance:e.balance+diff}:e);}return{...b,name:editBank.name,color:editBank.color,envelopes};}));setEditBank(null);};
  const delBank=id=>{setBanks(b=>b.filter(x=>x.id!==id));setConfirmDel(null);};

  const doTransfer=({srcEnv,destEnv,destBank,amt,fee,received,isCross,srcCurrency,destCurrency})=>{
    const totalDeducted=amt+fee;
    const date=new Date().toISOString().slice(0,10);
    const srcTx={id:Date.now(),type:"expense",desc:`Transfer to ${destBank.name}${isCross?` · ${sym(destCurrency)}${fmtNum(received)} received`:""}${fee?` · ${sym(srcCurrency)}${fmtNum(fee)} fee`:""}`,amount:totalDeducted,tag:"Transfer",note:"",date};
    const destTx={id:Date.now()+1,type:"income",desc:`Transfer from ${transferBank.name}${isCross?` · ${sym(srcCurrency)}${fmtNum(amt)} sent`:""}`,amount:received,tag:"Transfer",note:"",date};
    setBanks(bs=>bs.map(b=>{
      if(b.id===transferBank.id)return{...b,balance:b.balance-totalDeducted,envelopes:b.envelopes.map(e=>e.id!==srcEnv.id?e:{...e,balance:e.balance-totalDeducted,transactions:[srcTx,...e.transactions]})};
      if(b.id===destBank.id)return{...b,balance:b.balance+received,envelopes:b.envelopes.map(e=>e.id!==destEnv.id?e:{...e,balance:e.balance+received,transactions:[destTx,...e.transactions]})};
      return b;
    }));
    setTransferBank(null);
  };

  return(
    <div>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16}}>
        <div style={{display:"flex",alignItems:"center",gap:8}}>
          <span style={{fontSize:18,fontWeight:700,color:T.text}}>All Banks</span>
          <select value={globalConv} onChange={e=>setGlobalConv(e.target.value)} style={{background:T.card,border:`1px solid ${T.border}`,borderRadius:6,padding:"3px 8px",color:T.faint,fontSize:12}}>
            <option value="">Convert →</option>{CURRENCY_LIST.map(c=><option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        <Btn color="#3B82F6" onClick={()=>setShowBank(true)}>+ Add Bank</Btn>
      </div>

      {banks.length===0&&<div style={{color:T.faint,textAlign:"center",padding:32}}>No banks yet.</div>}

      {Object.entries(grouped).map(([currency,cBanks])=>{
        const total=cBanks.reduce((s,b)=>s+bankTotal(b),0); const gc=getCurrencyColor(currency);
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
                  <div key={bk.id} style={{background:T.card,borderRadius:12,border:`1px solid ${T.border}`,overflow:"hidden"}}>
                    <div style={{padding:"14px 16px",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                      <div style={{display:"flex",alignItems:"center",gap:10}}>
                        <div style={{width:4,height:36,borderRadius:2,background:color}}/>
                        <div>
                          <div style={{fontWeight:600,fontSize:15,color:T.text}}>{bk.name}</div>
                          <div style={{fontSize:20,fontWeight:700,color,marginTop:2}}>{sym(bk.currency)}{fmtNum(bankTotal(bk))}{globalConv&&<ConversionBadge amount={bankTotal(bk)} fromCurrency={bk.currency} toCurrency={globalConv}/>}</div>
                          <div style={{fontSize:11,color:T.faint,marginTop:2}}>{(bk.envelopes||[]).length} envelopes</div>
                        </div>
                      </div>
                      <div style={{display:"flex",gap:6,alignItems:"center"}}>
                        <Btn small outline color={T.subtext} onClick={()=>setEditBank({id:bk.id,name:bk.name,balance:bankTotal(bk),color:bankColor(bk)})}>✏️</Btn>
                        <Btn small outline color={color} onClick={()=>setTransferBank(bk)}>⇄</Btn>
                        <Btn small outline color={color} onClick={()=>toggle(bk.id)}>{expandedSet[bk.id]?"▲":"▼"}</Btn>
                        <Btn small outline color="#ef4444" onClick={()=>setConfirmDel({id:bk.id,name:bk.name})}>🗑</Btn>
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
      {confirmDel&&<ConfirmModal message={`Delete bank "${confirmDel.name}"?`} detail="All its envelopes and transactions will be removed." requireDel onConfirm={()=>delBank(confirmDel.id)} onClose={()=>setConfirmDel(null)}/>}

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

// ── Investments ──
function subGain(s){const g=s.value-(s.cost||0);const pct=s.cost?(g/s.cost*100):0;return{g,pct};}
function subATHATL(s){const vals=(s.history||[]).map(h=>h.value);if(!vals.length)return{ath:s.value,atl:s.value};return{ath:Math.max(...vals),atl:Math.min(...vals)};}
function invTotals(inv){const items=inv.items||[];const value=items.reduce((s,i)=>s+(i.value||0),0);const cost=items.reduce((s,i)=>s+(i.cost||0),0);const g=value-cost;const pct=cost?(g/cost*100):0;return{value,cost,g,pct};}

function InvestmentsSection({investments,setInvestments,hideTotals}){
  const [showAddInv,setShowAddInv]=useState(false); const [editInv,setEditInv]=useState(null); const [confirmDelInv,setConfirmDelInv]=useState(null);
  const [addItemTo,setAddItemTo]=useState(null); const [editItem,setEditItem]=useState(null); const [confirmDelItem,setConfirmDelItem]=useState(null);
  const [showHist,setShowHist]=useState(null); const [updateValOf,setUpdateValOf]=useState(null); const [newVal,setNewVal]=useState("");
  const [invForm,setInvForm]=useState({name:"",bucket:"Stocks"}); const [itemForm,setItemForm]=useState({name:"",currency:"USD",cost:"",value:"",notes:""}); const [overviewCur,setOverviewCur]=useState("USD");
  const addInv=()=>{if(!invForm.name)return;setInvestments(i=>[...i,{id:Date.now(),name:invForm.name,bucket:invForm.bucket,items:[]}]);setInvForm({name:"",bucket:"Stocks"});setShowAddInv(false);};
  const saveInvEdit=()=>{setInvestments(invs=>invs.map(x=>x.id!==editInv.id?x:{...x,name:editInv.name,bucket:editInv.bucket}));setEditInv(null);};
  const delInv=id=>{setInvestments(i=>i.filter(x=>x.id!==id));setConfirmDelInv(null);};
  const addItem=()=>{if(!itemForm.name)return;const v=parseFloat(itemForm.value)||0;setInvestments(invs=>invs.map(x=>x.id!==addItemTo?x:{...x,items:[...(x.items||[]),{id:Date.now(),name:itemForm.name,currency:itemForm.currency,cost:parseFloat(itemForm.cost)||0,value:v,notes:itemForm.notes,history:[{value:v,date:new Date().toISOString()}]}]}));setItemForm({name:"",currency:"USD",cost:"",value:"",notes:""});setAddItemTo(null);};
  const saveItemEdit=()=>{const{invId,item}=editItem;const newMV=parseFloat(item.value);setInvestments(invs=>invs.map(x=>x.id!==invId?x:{...x,items:x.items.map(it=>{if(it.id!==item.id)return it;const valueChanged=!isNaN(newMV)&&newMV!==it.value;return{...it,name:item.name,currency:item.currency,cost:parseFloat(item.cost)||0,notes:item.notes,value:!isNaN(newMV)?newMV:it.value,history:valueChanged?[...(it.history||[]),{value:newMV,date:new Date().toISOString()}]:it.history};})}));setEditItem(null);};
  const delItem=(invId,itemId)=>{setInvestments(invs=>invs.map(x=>x.id!==invId?x:{...x,items:x.items.filter(it=>it.id!==itemId)}));setConfirmDelItem(null);};
  const recordValue=(invId,itemId)=>{const v=parseFloat(newVal);if(isNaN(v))return;setInvestments(invs=>invs.map(x=>x.id!==invId?x:{...x,items:x.items.map(it=>it.id!==itemId?it:{...it,value:v,history:[...(it.history||[]),{value:v,date:new Date().toISOString()}]})}));setNewVal("");setUpdateValOf(null);};
  const grouped=investments.reduce((acc,inv)=>{(acc[inv.bucket||"Other"]=acc[inv.bucket||"Other"]||[]).push(inv);return acc;},{});
  const allItems=investments.flatMap(inv=>(inv.items||[]).map(it=>({amount:it.value,currency:it.currency})));
  const allCostItems=investments.flatMap(inv=>(inv.items||[]).map(it=>({amount:it.cost||0,currency:it.currency})));
  const grandValue=useMultiConvert(allItems,overviewCur); const grandCost=useMultiConvert(allCostItems,overviewCur);
  const grandGain=(grandValue!==null&&grandCost!==null)?grandValue-grandCost:null; const grandPct=(grandGain!==null&&grandCost)?(grandGain/grandCost*100):null;
  const histItem=(()=>{if(!showHist)return null;const inv=investments.find(i=>i.id===showHist.invId);return inv?.items.find(it=>it.id===showHist.itemId);})();

  return(
    <div>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16}}><span style={{fontSize:18,fontWeight:700,color:T.text}}>Investments</span><Btn color="#8B5CF6" onClick={()=>setShowAddInv(true)}>+ Add</Btn></div>
      <div style={{background:"linear-gradient(135deg,#8B5CF6,#EC4899)",borderRadius:14,padding:18,marginBottom:20,color:"#fff"}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start"}}>
          <div>
            <div style={{fontSize:13,opacity:0.85}}>Total Investments</div>
            <div style={{fontSize:26,fontWeight:800,marginTop:2}}>{hideTotals?"••••••":(grandValue===null?"…":`${sym(overviewCur)}${fmtNum(grandValue)}`)}</div>
            {grandGain!==null&&!hideTotals&&<div style={{fontSize:13,marginTop:4,opacity:0.95}}>{grandGain>=0?"▲":"▼"} {sym(overviewCur)}{fmtNum(Math.abs(grandGain))} ({grandGain>=0?"+":""}{grandPct?.toFixed(1)}%)</div>}
          </div>
          <select value={overviewCur} onChange={e=>setOverviewCur(e.target.value)} style={{background:"rgba(255,255,255,0.2)",border:"1px solid rgba(255,255,255,0.3)",borderRadius:8,padding:"6px 10px",color:"#fff",fontSize:14}}>{CURRENCY_LIST.map(c=><option key={c} value={c} style={{color:"#000"}}>{c}</option>)}</select>
        </div>
      </div>
      {investments.length===0&&<div style={{color:T.faint,textAlign:"center",padding:32}}>No investments yet.</div>}
      {Object.entries(grouped).map(([bucket,invs])=>{
        const bucketItems=invs.flatMap(inv=>(inv.items||[]).map(it=>({amount:it.value,currency:it.currency})));
        return(<BucketBlock key={bucket} bucket={bucket} invs={invs} bucketItems={bucketItems} overviewCur={overviewCur} onAddItem={setAddItemTo} onEditInv={setEditInv} onDelInv={setConfirmDelInv} onEditItem={setEditItem} onDelItem={setConfirmDelItem} onHist={setShowHist} updateValOf={updateValOf} setUpdateValOf={setUpdateValOf} newVal={newVal} setNewVal={setNewVal} recordValue={recordValue}/>);
      })}
      {confirmDelInv&&<ConfirmModal message={`Delete investment "${confirmDelInv.name}"?`} detail="All its holdings and history will be removed." requireDel onConfirm={()=>delInv(confirmDelInv.id)} onClose={()=>setConfirmDelInv(null)}/>}
      {confirmDelItem&&<ConfirmModal message={`Delete holding "${confirmDelItem.name}"?`} requireDel onConfirm={()=>delItem(confirmDelItem.invId,confirmDelItem.itemId)} onClose={()=>setConfirmDelItem(null)}/>}
      {showAddInv&&<Modal title="Add Investment" onClose={()=>setShowAddInv(false)} isDirty={!!invForm.name}><Inp label="Name" value={invForm.name} onChange={e=>setInvForm(f=>({...f,name:e.target.value}))} placeholder="e.g. Crypto Portfolio, US Stocks"/><Sel label="Bucket" value={invForm.bucket} onChange={e=>setInvForm(f=>({...f,bucket:e.target.value}))}>{INVESTMENT_BUCKETS.map(b=><option key={b} value={b}>{b}</option>)}</Sel><Btn color="#8B5CF6" onClick={addInv} style={{width:"100%"}}>Add Investment</Btn></Modal>}
      {editInv&&<Modal title="Edit Investment" onClose={()=>setEditInv(null)} isDirty={true}><Inp label="Name" value={editInv.name} onChange={e=>setEditInv(v=>({...v,name:e.target.value}))}/><Sel label="Bucket" value={editInv.bucket} onChange={e=>setEditInv(v=>({...v,bucket:e.target.value}))}>{INVESTMENT_BUCKETS.map(b=><option key={b} value={b}>{b}</option>)}</Sel><Btn color="#8B5CF6" onClick={saveInvEdit} style={{width:"100%"}}>Save</Btn></Modal>}
      {addItemTo&&<Modal title="Add Holding" onClose={()=>setAddItemTo(null)} isDirty={!!itemForm.name||!!itemForm.value}><Inp label="Name" value={itemForm.name} onChange={e=>setItemForm(f=>({...f,name:e.target.value}))} placeholder="e.g. BTC, AAPL, Rolex Sub"/><Sel label="Currency" value={itemForm.currency} onChange={e=>setItemForm(f=>({...f,currency:e.target.value}))}>{CURRENCY_LIST.map(c=><option key={c} value={c}>{c} — {CURRENCY_SYMBOLS[c]}</option>)}</Sel><Inp label="Amount Invested (cost)" type="number" value={itemForm.cost} onChange={e=>setItemForm(f=>({...f,cost:e.target.value}))} placeholder="0.00"/><Inp label="Current Market Value" type="number" value={itemForm.value} onChange={e=>setItemForm(f=>({...f,value:e.target.value}))} placeholder="0.00"/><Inp label="Notes (optional)" value={itemForm.notes} onChange={e=>setItemForm(f=>({...f,notes:e.target.value}))}/><Btn color="#8B5CF6" onClick={addItem} style={{width:"100%"}}>Add Holding</Btn></Modal>}
      {editItem&&<Modal title="Edit Holding" onClose={()=>setEditItem(null)} isDirty={true}><Inp label="Name" value={editItem.item.name} onChange={e=>setEditItem(v=>({...v,item:{...v.item,name:e.target.value}}))}/><Sel label="Currency" value={editItem.item.currency} onChange={e=>setEditItem(v=>({...v,item:{...v.item,currency:e.target.value}}))}>{CURRENCY_LIST.map(c=><option key={c} value={c}>{c} — {CURRENCY_SYMBOLS[c]}</option>)}</Sel><Inp label="Amount Invested (cost)" type="number" value={editItem.item.cost} onChange={e=>setEditItem(v=>({...v,item:{...v.item,cost:e.target.value}}))}/><Inp label="Current Market Value (logs to history)" type="number" value={editItem.item.value} onChange={e=>setEditItem(v=>({...v,item:{...v.item,value:e.target.value}}))}/><Inp label="Notes" value={editItem.item.notes||""} onChange={e=>setEditItem(v=>({...v,item:{...v.item,notes:e.target.value}}))}/><Btn color="#8B5CF6" onClick={saveItemEdit} style={{width:"100%"}}>Save</Btn></Modal>}
      {showHist&&<Modal title={`${histItem?.name} · Value History`} onClose={()=>setShowHist(null)} isDirty={false}>{(!histItem?.history||histItem.history.length===0)&&<div style={{color:T.faint,textAlign:"center",padding:16}}>No history.</div>}<div style={{display:"flex",flexDirection:"column",gap:6,maxHeight:320,overflowY:"auto"}}>{[...(histItem?.history||[])].reverse().map((h,i)=>(<div key={i} style={{display:"flex",justifyContent:"space-between",background:T.card2,borderRadius:8,padding:"8px 12px",fontSize:13}}><span style={{color:T.subtext}}>{new Date(h.date).toLocaleString()}</span><span style={{color:T.text,fontWeight:600}}>{sym(histItem.currency)}{fmtNum(h.value)}</span></div>))}</div></Modal>}
    </div>
  );
}

function BucketBlock({bucket,invs,bucketItems,overviewCur,onAddItem,onEditInv,onDelInv,onEditItem,onDelItem,onHist,updateValOf,setUpdateValOf,newVal,setNewVal,recordValue}){
  const bucketTotal=useMultiConvert(bucketItems,overviewCur);
  return(
    <div style={{marginBottom:20}}>
      <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:8}}><div style={{fontSize:14,fontWeight:700,color:"#8B5CF6"}}>{bucket}</div><div style={{fontSize:13,color:T.subtext}}>{bucketTotal===null?"…":`${sym(overviewCur)}${fmtNum(bucketTotal)}`}</div></div>
      <div style={{display:"flex",flexDirection:"column",gap:10}}>
        {invs.map(inv=>{const tot=invTotals(inv);const up=tot.g>=0;return(
          <div key={inv.id} style={{background:T.card,borderRadius:12,border:`1px solid ${T.border}`,padding:14}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:8}}>
              <div><div style={{fontWeight:600,color:T.text,fontSize:15}}>{inv.name}</div><div style={{fontSize:12,color:T.subtext,marginTop:2}}>Value {fmtNum(tot.value)} · Cost {fmtNum(tot.cost)} · <span style={{color:up?"#10B981":"#ef4444",fontWeight:600}}>{up?"+":""}{tot.pct.toFixed(1)}%</span></div></div>
              <div style={{display:"flex",gap:4}}><Btn small color="#8B5CF6" onClick={()=>onAddItem(inv.id)}>+ Holding</Btn><Btn small outline color={T.subtext} onClick={()=>onEditInv({id:inv.id,name:inv.name,bucket:inv.bucket})}>✏️</Btn><Btn small outline color="#ef4444" onClick={()=>onDelInv({id:inv.id,name:inv.name})}>🗑</Btn></div>
            </div>
            <div style={{display:"flex",flexDirection:"column",gap:6}}>
              {(inv.items||[]).map(it=>{const{g,pct}=subGain(it);const u=g>=0;const{ath,atl}=subATHATL(it);return(
                <div key={it.id} style={{background:T.card2,borderRadius:8,padding:"10px 12px"}}>
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start"}}>
                    <div style={{flex:1}}><div style={{fontSize:13,fontWeight:600,color:T.text}}>{it.name} <span style={{fontSize:11,color:T.faint}}>· {it.currency}</span></div>{it.notes&&<div style={{fontSize:11,color:T.subtext}}>{it.notes}</div>}<div style={{display:"flex",gap:10,marginTop:4,fontSize:11,flexWrap:"wrap"}}><span style={{color:T.subtext}}>Cost {sym(it.currency)}{fmtNum(it.cost)}</span><span style={{color:T.text}}>Val {sym(it.currency)}{fmtNum(it.value)}</span><span style={{color:u?"#10B981":"#ef4444",fontWeight:600}}>{u?"▲":"▼"}{sym(it.currency)}{fmtNum(Math.abs(g))} ({u?"+":""}{pct.toFixed(1)}%)</span></div><div style={{fontSize:10,color:T.faint,marginTop:2}}>ATH {sym(it.currency)}{fmtNum(ath)} · ATL {sym(it.currency)}{fmtNum(atl)}</div></div>
                    <div style={{display:"flex",flexDirection:"column",gap:3,alignItems:"flex-end"}}><Btn small color="#8B5CF6" onClick={()=>{setUpdateValOf({invId:inv.id,itemId:it.id});setNewVal(String(it.value));}}>Update</Btn><div style={{display:"flex",gap:3}}><Btn small outline color={T.subtext} onClick={()=>onHist({invId:inv.id,itemId:it.id})}>📄</Btn><Btn small outline color={T.subtext} onClick={()=>onEditItem({invId:inv.id,item:{...it}})}>✏️</Btn><Btn small outline color="#ef4444" onClick={()=>onDelItem({invId:inv.id,itemId:it.id,name:it.name})}>🗑</Btn></div></div>
                  </div>
                  {updateValOf&&updateValOf.invId===inv.id&&updateValOf.itemId===it.id&&<div style={{display:"flex",gap:6,marginTop:8}}><input type="number" value={newVal} onChange={e=>setNewVal(e.target.value)} placeholder="New market value" style={{flex:1,background:T.input,border:`1px solid ${T.border}`,borderRadius:8,padding:"5px 10px",color:T.text,fontSize:12}}/><Btn small color="#10B981" onClick={()=>recordValue(inv.id,it.id)}>Save</Btn><Btn small outline color={T.subtext} onClick={()=>setUpdateValOf(null)}>×</Btn></div>}
                </div>
              );})}
              {(inv.items||[]).length===0&&<div style={{fontSize:12,color:T.faint,textAlign:"center",padding:8}}>No holdings yet — add one.</div>}
            </div>
          </div>
        );})}
      </div>
    </div>
  );
}

// ── Analytics ──
function PieChart({data}){
  const total=data.reduce((s,d)=>s+d.value,0);
  if(!total)return<div style={{color:T.faint,textAlign:"center",padding:24}}>No expense data.</div>;
  let angle=0;const slices=data.map((d,i)=>{const pct=d.value/total;const start=angle;angle+=pct*360;return{...d,start,end:angle,pct,color:COLORS_LIST[i%COLORS_LIST.length]};});
  const xy=(deg,r)=>[50+r*Math.cos((deg-90)*Math.PI/180),50+r*Math.sin((deg-90)*Math.PI/180)];
  const arc=(s,e,r)=>{if(e-s>=360)e=359.99;const[x1,y1]=xy(s,r);const[x2,y2]=xy(e,r);const l=e-s>180?1:0;return`M 50 50 L ${x1} ${y1} A ${r} ${r} 0 ${l} 1 ${x2} ${y2} Z`;};
  return(<div style={{display:"flex",gap:24,alignItems:"center",flexWrap:"wrap"}}><svg viewBox="0 0 100 100" style={{width:160,height:160,flexShrink:0}}>{slices.map((s,i)=><path key={i} d={arc(s.start,s.end,45)} fill={s.color} stroke={T.bg} strokeWidth="0.5"/>)}<circle cx="50" cy="50" r="25" fill={T.bg}/></svg><div style={{display:"flex",flexDirection:"column",gap:6,flex:1}}>{slices.map((s,i)=>(<div key={i} style={{display:"flex",justifyContent:"space-between",alignItems:"center",gap:12}}><div style={{display:"flex",alignItems:"center",gap:6}}><div style={{width:10,height:10,borderRadius:2,background:s.color}}/><span style={{fontSize:13,color:T.text}}>{s.label}</span></div><div><span style={{fontSize:13,color:s.color,fontWeight:600}}>{Math.round(s.pct*100)}%</span><span style={{fontSize:11,color:T.faint,marginLeft:6}}>{s.currencySym}{fmtNum(s.value)}</span></div></div>))}</div></div>);
}
function BarChart({data}){
  if(!data.length)return<div style={{color:T.faint,textAlign:"center",padding:24}}>No data.</div>;
  const max=Math.max(...data.map(d=>d.value),1);
  return(<div style={{display:"flex",alignItems:"flex-end",gap:6,height:120,marginTop:8}}>{data.map((d,i)=>(<div key={i} style={{flex:1,display:"flex",flexDirection:"column",alignItems:"center",gap:4}}><div style={{fontSize:10,color:T.faint}}>{d.currencySym}{fmtNum(d.value)}</div><div style={{width:"100%",background:COLORS_LIST[i%COLORS_LIST.length],borderRadius:"4px 4px 0 0",height:`${Math.max(4,(d.value/max)*80)}px`}}/><div style={{fontSize:10,color:T.faint,whiteSpace:"nowrap"}}>{d.label}</div></div>))}</div>);
}
function AnalyticsSection({banks}){
  const today=new Date();const firstOfMonth=new Date(today.getFullYear(),today.getMonth(),1).toISOString().slice(0,10);
  const[from,setFrom]=useState(firstOfMonth);const[to,setTo]=useState(today.toISOString().slice(0,10));const[filterCurrency,setFilterCurrency]=useState("all");
  const currencies=[...new Set(banks.map(b=>b.currency))];const effectiveCurrency=filterCurrency==="all"?(currencies[0]||""):filterCurrency;
  const allTx=banks.flatMap(b=>b.envelopes.flatMap(e=>e.transactions.map(t=>({...t,currency:b.currency})))).filter(t=>(filterCurrency==="all"||t.currency===filterCurrency)&&t.date>=from&&t.date<=to);
  const income=allTx.filter(t=>t.type==="income").reduce((s,t)=>s+t.amount,0);const expense=allTx.filter(t=>t.type==="expense").reduce((s,t)=>s+t.amount,0);
  const tagTotals={};allTx.filter(t=>t.type==="expense").forEach(t=>{const k=t.tag||"Untagged";tagTotals[k]=(tagTotals[k]||0)+t.amount;});
  const pieData=Object.entries(tagTotals).map(([label,value])=>({label,value,currencySym:sym(effectiveCurrency)}));
  const monthTotals={};allTx.filter(t=>t.type==="expense").forEach(t=>{const k=t.date?.slice(0,7)||"?";monthTotals[k]=(monthTotals[k]||0)+t.amount;});
  const barData=Object.entries(monthTotals).sort(([a],[b])=>a.localeCompare(b)).slice(-6).map(([label,value])=>({label:label.slice(5),value,currencySym:sym(effectiveCurrency)}));
  return(
    <div>
      <div style={{display:"flex",gap:8,marginBottom:16,flexWrap:"wrap",alignItems:"flex-end"}}>
        <div><div style={{fontSize:11,color:T.subtext,marginBottom:4}}>From</div><input type="date" value={from} onChange={e=>setFrom(e.target.value)} style={{background:T.card,border:`1px solid ${T.border}`,borderRadius:8,padding:"6px 10px",color:T.text,fontSize:13}}/></div>
        <div><div style={{fontSize:11,color:T.subtext,marginBottom:4}}>To</div><input type="date" value={to} onChange={e=>setTo(e.target.value)} style={{background:T.card,border:`1px solid ${T.border}`,borderRadius:8,padding:"6px 10px",color:T.text,fontSize:13}}/></div>
        <select value={filterCurrency} onChange={e=>setFilterCurrency(e.target.value)} style={{background:T.card,border:`1px solid ${T.border}`,borderRadius:8,padding:"6px 10px",color:T.text,fontSize:13}}><option value="all">First currency</option>{currencies.map(c=><option key={c} value={c}>{c}</option>)}</select>
      </div>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12,marginBottom:16}}>
        <div style={{background:T.card,borderRadius:12,padding:16,border:"1px solid #10B98133"}}><div style={{fontSize:12,color:T.subtext}}>Income</div><div style={{fontSize:22,fontWeight:700,color:"#10B981"}}>{sym(effectiveCurrency)}{fmtNum(income)}</div></div>
        <div style={{background:T.card,borderRadius:12,padding:16,border:"1px solid #ef444433"}}><div style={{fontSize:12,color:T.subtext}}>Expense</div><div style={{fontSize:22,fontWeight:700,color:"#ef4444"}}>{sym(effectiveCurrency)}{fmtNum(expense)}</div></div>
      </div>
      <div style={{background:T.card,borderRadius:12,padding:16,marginBottom:8,textAlign:"center"}}><span style={{fontSize:12,color:T.subtext}}>Net: </span><span style={{fontSize:16,fontWeight:700,color:income-expense>=0?"#10B981":"#ef4444"}}>{sym(effectiveCurrency)}{fmtNum(income-expense)}</span></div>
      <div style={{background:T.card,borderRadius:12,padding:16,marginBottom:16}}><div style={{fontSize:13,fontWeight:600,color:T.text,marginBottom:12}}>💸 Spending by Tag</div><PieChart data={pieData}/></div>
      <div style={{background:T.card,borderRadius:12,padding:16}}><div style={{fontSize:13,fontWeight:600,color:T.text,marginBottom:4}}>📅 Monthly Spending</div><BarChart data={barData}/></div>
    </div>
  );
}

// ── Notes ──
function NotesSection({notesState}){
  const[notes,setNotes,undo,redo,canUndo,canRedo]=notesState;
  const[confirmDel,setConfirmDel]=useState(null);
  const add=()=>setNotes(n=>[{id:Date.now(),text:""},...n]);
  const update=(id,text)=>setNotes(n=>n.map(x=>x.id===id?{...x,text}:x));
  const reqDel=note=>{if(note.text.trim()==="")setNotes(n=>n.filter(x=>x.id!==note.id));else setConfirmDel(note);};
  const del=id=>{setNotes(n=>n.filter(x=>x.id!==id));setConfirmDel(null);};
  return(
    <div>
      <UndoBar undo={undo} redo={redo} canUndo={canUndo} canRedo={canRedo}/>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16}}><span style={{fontSize:13,color:T.subtext}}>Sticky notes — auto-saved</span><Btn color="#10B981" onClick={add}>+ New Note</Btn></div>
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(200px,1fr))",gap:12}}>
        {notes.map(note=>(<div key={note.id} style={{background:"#FEF3C7",borderRadius:8,padding:12,minHeight:140,boxShadow:"0 2px 8px rgba(0,0,0,0.2)",display:"flex",flexDirection:"column"}}><textarea value={note.text} onChange={e=>update(note.id,e.target.value)} placeholder="Write something..." style={{flex:1,background:"transparent",border:"none",resize:"none",outline:"none",color:"#451a03",fontSize:14,lineHeight:1.5,fontFamily:"system-ui"}}/><button onClick={()=>reqDel(note)} style={{alignSelf:"flex-end",background:"none",border:"none",color:"#b45309",cursor:"pointer",fontSize:13,marginTop:4}}>🗑</button></div>))}
        {notes.length===0&&<div style={{color:T.faint,gridColumn:"1/-1",textAlign:"center",padding:32}}>No notes yet — add one!</div>}
      </div>
      {confirmDel&&<ConfirmModal message="Delete this note?" detail="It has content that will be lost." onConfirm={()=>del(confirmDel.id)} onClose={()=>setConfirmDel(null)}/>}
    </div>
  );
}

// ── Quick Add ──
function QuickAdd({banks,setBanks,tags}){
  const[open,setOpen]=useState(false);const[bankId,setBankId]=useState("");const[envId,setEnvId]=useState("");
  const[tx,setTx]=useState({type:"expense",desc:"",amount:"",tag:"",note:"",date:new Date().toISOString().slice(0,10)});
  const bank=banks.find(b=>String(b.id)===String(bankId));
  const submit=()=>{if(!bank||!envId||!tx.desc||!tx.amount)return;const amt=parseFloat(tx.amount);const isIncome=tx.type==="income";const newTx={id:Date.now(),...tx,amount:amt};setBanks(bs=>bs.map(b=>b.id!==bank.id?b:{...b,balance:b.balance+(isIncome?amt:-amt),envelopes:b.envelopes.map(e=>e.id!==envId?e:{...e,balance:e.balance+(isIncome?amt:-amt),transactions:[newTx,...e.transactions]})}));setTx({type:"expense",desc:"",amount:"",tag:"",note:"",date:new Date().toISOString().slice(0,10)});setOpen(false);};
  return(<>
    <Btn color="#10B981" onClick={()=>setOpen(true)} style={{width:"100%",marginBottom:20}}>⚡ Quick Add Transaction</Btn>
    {open&&<Modal title="Quick Add Transaction" onClose={()=>setOpen(false)} isDirty={!!tx.desc||!!tx.amount}>
      <Sel label="Bank" value={bankId} onChange={e=>{setBankId(e.target.value);setEnvId("");}}><option value="">Select bank</option>{banks.map(b=><option key={b.id} value={b.id}>{b.name} ({b.currency})</option>)}</Sel>
      {bank&&<Sel label="Envelope" value={envId} onChange={e=>setEnvId(e.target.value)}><option value="">Select envelope</option>{bank.envelopes.map(e=><option key={e.id} value={e.id}>{e.name}</option>)}</Sel>}
      <div style={{display:"flex",gap:8,marginBottom:12}}>{["income","expense"].map(t=><Btn key={t} color={t==="income"?"#10B981":"#ef4444"} outline={tx.type!==t} onClick={()=>setTx(x=>({...x,type:t}))} style={{flex:1,textTransform:"capitalize"}}>{t}</Btn>)}</div>
      <Inp label="Description" value={tx.desc} onChange={e=>setTx(x=>({...x,desc:e.target.value}))} placeholder="e.g. Groceries"/>
      <Inp label="Amount" type="number" value={tx.amount} onChange={e=>setTx(x=>({...x,amount:e.target.value}))} placeholder="0.00"/>
      <Sel label="Tag (optional)" value={tx.tag} onChange={e=>setTx(x=>({...x,tag:e.target.value}))}><option value="">No tag</option>{(tags||[]).map(t=><option key={t} value={t}>{t}</option>)}</Sel>
      <Inp label="Date" type="date" value={tx.date} onChange={e=>setTx(x=>({...x,date:e.target.value}))}/>
      <Btn color="#10B981" onClick={submit} style={{width:"100%"}}>Add Transaction</Btn>
    </Modal>}
  </>);
}

// ── Universal Total ──
function UniversalTotal({banks,investments,target,setTarget,hideTotals}){
  const items=[...banks.map(b=>({amount:bankTotal(b),currency:b.currency})),...investments.flatMap(inv=>(inv.items||[]).map(it=>({amount:it.value,currency:it.currency})))];
  const total=useMultiConvert(items,target);
  return(<div style={{background:"linear-gradient(135deg,#3B82F6,#8B5CF6)",borderRadius:14,padding:20,marginBottom:20,color:"#fff"}}><div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}><div><div style={{fontSize:13,opacity:0.85}}>Total Net Worth</div><div style={{fontSize:30,fontWeight:800,marginTop:4}}>{hideTotals?"••••••":(total===null?"…":`${sym(target)}${fmtNum(total)}`)}</div></div><select value={target} onChange={e=>setTarget(e.target.value)} style={{background:"rgba(255,255,255,0.2)",border:"1px solid rgba(255,255,255,0.3)",borderRadius:8,padding:"6px 10px",color:"#fff",fontSize:14}}>{CURRENCY_LIST.map(c=><option key={c} value={c} style={{color:"#000"}}>{c}</option>)}</select></div></div>);
}

// ── Custom Total ──
function CustomTotal({banks,investments}){
  const[selected,setSelected]=useState({});const[target,setTarget]=useState("USD");
  const toggleBank=(bankId)=>{setSelected(s=>{const selecting=!s[`bank_${bankId}`];const next={...s,[`bank_${bankId}`]:selecting};if(selecting)banks.find(b=>String(b.id)===String(bankId))?.envelopes.forEach(e=>{next[`env_${bankId}_${e.id}`]=false;});return next;});};
  const toggleEnv=(bankId,envId)=>{setSelected(s=>{const selecting=!s[`env_${bankId}_${envId}`];const next={...s,[`env_${bankId}_${envId}`]:selecting};if(selecting)next[`bank_${bankId}`]=false;return next;});};
  const toggleItem=(itemId)=>setSelected(s=>({...s,[`item_${itemId}`]:!s[`item_${itemId}`]}));
  const items=[];banks.forEach(b=>{b.envelopes.forEach(e=>{if(selected[`env_${b.id}_${e.id}`])items.push({amount:e.balance,currency:b.currency});});if(selected[`bank_${b.id}`])items.push({amount:bankTotal(b),currency:b.currency});});
  investments.forEach(inv=>(inv.items||[]).forEach(it=>{if(selected[`item_${it.id}`])items.push({amount:it.value,currency:it.currency});}));
  const total=useMultiConvert(items,target);
  return(<div style={{background:T.card,borderRadius:12,padding:16,marginBottom:20}}><div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}><div style={{fontSize:13,fontWeight:600,color:T.text}}>🧮 Custom Total</div><select value={target} onChange={e=>setTarget(e.target.value)} style={{background:T.input,border:`1px solid ${T.border}`,borderRadius:6,padding:"3px 8px",color:T.text,fontSize:12}}>{CURRENCY_LIST.map(c=><option key={c} value={c}>{c}</option>)}</select></div><div style={{maxHeight:200,overflowY:"auto",marginBottom:12}}>{banks.map(b=>(<div key={b.id} style={{marginBottom:6}}><label style={{display:"flex",alignItems:"center",gap:6,fontSize:13,color:T.text,cursor:"pointer"}}><input type="checkbox" checked={!!selected[`bank_${b.id}`]} onChange={()=>toggleBank(b.id)}/><strong>{b.name}</strong> <span style={{color:T.faint}}>({sym(b.currency)}{fmtNum(bankTotal(b))})</span></label><div style={{paddingLeft:20}}>{b.envelopes.map(e=>(<label key={e.id} style={{display:"flex",alignItems:"center",gap:6,fontSize:12,color:T.subtext,cursor:"pointer"}}><input type="checkbox" checked={!!selected[`env_${b.id}_${e.id}`]} onChange={()=>toggleEnv(b.id,e.id)}/>{e.isUnalloc?"📂":(e.emoji||"🗂️")} {e.name} <span style={{color:T.faint}}>({sym(b.currency)}{fmtNum(e.balance)})</span></label>))}</div></div>))}{investments.length>0&&<div style={{marginTop:8}}><div style={{fontSize:11,color:T.faint,marginBottom:4}}>Investment Holdings</div>{investments.flatMap(inv=>(inv.items||[]).map(it=>(<label key={it.id} style={{display:"flex",alignItems:"center",gap:6,fontSize:12,color:T.subtext,cursor:"pointer"}}><input type="checkbox" checked={!!selected[`item_${it.id}`]} onChange={()=>toggleItem(it.id)}/>{inv.name} / {it.name} <span style={{color:T.faint}}>({sym(it.currency)}{fmtNum(it.value)})</span></label>)))}</div>}</div><div style={{borderTop:`1px solid ${T.border}`,paddingTop:10,textAlign:"right"}}><span style={{fontSize:12,color:T.subtext}}>Total: </span><span style={{fontSize:18,fontWeight:700,color:"#10B981"}}>{total===null?"…":`${sym(target)}${fmtNum(total)}`}</span></div></div>);
}

// ── Dashboard ──
function Dashboard({banks,setBanks,investments,tags,overviewCur,setOverviewCur,hideTotals,setHideTotals}){
  const byCurrency=banks.reduce((acc,b)=>{acc[b.currency]=(acc[b.currency]||0)+bankTotal(b);return acc;},{});
  const invByCurrency={};investments.forEach(inv=>(inv.items||[]).forEach(it=>{invByCurrency[it.currency]=(invByCurrency[it.currency]||0)+it.value;}));
  const invItems=investments.flatMap(inv=>(inv.items||[]).map(it=>({amount:it.value,currency:it.currency})));const invConverted=useMultiConvert(invItems,overviewCur);
  return(
    <div>
      <div style={{display:"flex",justifyContent:"flex-end",marginBottom:8}}><button onClick={()=>setHideTotals(h=>!h)} style={{background:T.card,border:`1px solid ${T.border}`,borderRadius:8,padding:"4px 10px",cursor:"pointer",fontSize:13,color:T.subtext,display:"flex",alignItems:"center",gap:6}}>{hideTotals?"🙈 Show totals":"👁️ Hide totals"}</button></div>
      <UniversalTotal banks={banks} investments={investments} target={overviewCur} setTarget={setOverviewCur} hideTotals={hideTotals}/>
      <QuickAdd banks={banks} setBanks={setBanks} tags={tags}/>
      <CustomTotal banks={banks} investments={investments}/>
      <div style={{fontSize:13,color:T.subtext,marginBottom:12}}>Accounts overview</div>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12,marginBottom:24}}>
        {Object.entries(byCurrency).map(([currency,total])=>(<div key={currency} style={{background:T.card,borderRadius:12,padding:18,border:`1px solid ${getCurrencyColor(currency)}33`}}><div style={{fontSize:12,color:T.subtext,marginBottom:4}}>{currency} Banks</div><div style={{fontSize:20,fontWeight:700,color:getCurrencyColor(currency)}}>{sym(currency)}{fmtNum(total)}</div><div style={{fontSize:12,color:T.faint,marginTop:2}}>{banks.filter(b=>b.currency===currency).length} accounts</div></div>))}
        <div style={{background:T.card,borderRadius:12,padding:18,border:"1px solid #8B5CF633"}}><div style={{fontSize:12,color:T.subtext,marginBottom:4}}>Investments ({overviewCur})</div><div style={{fontSize:20,fontWeight:700,color:"#8B5CF6"}}>{invConverted===null?"…":`${sym(overviewCur)}${fmtNum(invConverted)}`}</div><div style={{fontSize:11,color:T.faint,marginTop:2}}>{Object.entries(invByCurrency).map(([c,v])=>`${sym(c)}${fmtNum(v)}`).join(" · ")||"none"}</div></div>
      </div>
      {Object.entries(banks.reduce((acc,b)=>{(acc[b.currency]=acc[b.currency]||[]).push(b);return acc;},{})).map(([currency,cBanks])=>(<div key={currency} style={{marginBottom:20}}><div style={{fontSize:13,fontWeight:600,color:getCurrencyColor(currency),marginBottom:8}}>{currency} Accounts</div>{cBanks.map(b=>(<div key={b.id} style={{marginBottom:8}}><div style={{display:"flex",justifyContent:"space-between",padding:"6px 0",borderBottom:`1px solid ${T.border}`,fontSize:14,color:T.text,fontWeight:600}}><span>{b.name}</span><span style={{color:bankColor(b)}}>{sym(currency)}{fmtNum(bankTotal(b))}</span></div>{(b.envelopes||[]).map(e=>(<div key={e.id} style={{display:"flex",justifyContent:"space-between",padding:"4px 0 4px 14px",fontSize:12,color:e.isUnalloc?T.faint:T.subtext,fontStyle:e.isUnalloc?"italic":"normal"}}><span>{e.isUnalloc?"📂":(e.emoji||"🗂️")} {e.name}{e.goal?` (${Math.min(100,Math.round((e.balance/e.goal)*100))}%)`:""}</span><span style={{color:e.isUnalloc?T.faint:bankColor(b)}}>{sym(currency)}{fmtNum(e.balance)}</span></div>))}</div>))}</div>))}
    </div>
  );
}

// ── Settings ──
function SettingsSection({tags,setTags,banks,theme,setTheme,appName,setAppName,profile,setProfile,googleName,googlePhoto,getData,onImport,onSignOut}){
  const[newTag,setNewTag]=useState("");const[confirmDelTag,setConfirmDelTag]=useState(null);
  const fileRef=useRef(null);const picRef=useRef(null);
  const tagUsage=tag=>banks.reduce((c,b)=>c+b.envelopes.reduce((c2,e)=>c2+e.transactions.filter(t=>t.tag===tag).length,0),0);
  const addTag=()=>{if(!newTag.trim()||tags.includes(newTag.trim()))return;setTags(t=>[...t,newTag.trim()]);setNewTag("");};
  const reqDelTag=tag=>{const u=tagUsage(tag);setConfirmDelTag({tag,count:u});};
  const delTag=tag=>{setTags(t=>t.filter(x=>x!==tag));setConfirmDelTag(null);};
  const exportData=()=>{const blob=new Blob([JSON.stringify(getData(),null,2)],{type:"application/json"});const url=URL.createObjectURL(blob);const a=document.createElement("a");a.href=url;a.download=`acountee-backup-${new Date().toISOString().slice(0,10)}.json`;a.click();URL.revokeObjectURL(url);};
  const importData=e=>{const file=e.target.files?.[0];if(!file)return;const reader=new FileReader();reader.onload=ev=>{try{const p=JSON.parse(ev.target.result);if(!confirm("Replace current data with backup?"))return;onImport(p);}catch{alert("Invalid file.");}};reader.readAsText(file);e.target.value="";};
  const uploadPic=e=>{const file=e.target.files?.[0];if(!file)return;const reader=new FileReader();reader.onload=ev=>{const img=new Image();img.onload=()=>{const canvas=document.createElement("canvas");const size=128;canvas.width=size;canvas.height=size;const ctx=canvas.getContext("2d");const min=Math.min(img.width,img.height);ctx.drawImage(img,(img.width-min)/2,(img.height-min)/2,min,min,0,0,size,size);setProfile(p=>({...p,photo:canvas.toDataURL("image/jpeg",0.8)}));};img.src=ev.target.result;};reader.readAsDataURL(file);e.target.value="";};
  const displayName=profile.name||googleName||"";const displayPhoto=profile.photo||googlePhoto||"";
  const card={background:T.card,borderRadius:12,padding:16,marginBottom:16,border:`1px solid ${T.border}`};
  return(
    <div>
      <div style={card}>
        <div style={{fontSize:14,fontWeight:700,color:T.text,marginBottom:12}}>👤 Profile</div>
        <div style={{display:"flex",alignItems:"center",gap:14,marginBottom:12}}>
          <div style={{width:64,height:64,borderRadius:"50%",overflow:"hidden",background:T.card2,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>{displayPhoto?<img src={displayPhoto} alt="" style={{width:"100%",height:"100%",objectFit:"cover"}}/>:<span style={{fontSize:24}}>👤</span>}</div>
          <div style={{flex:1}}><Btn small outline color="#3B82F6" onClick={()=>picRef.current?.click()}>Upload Photo</Btn>{profile.photo&&<Btn small outline color="#ef4444" onClick={()=>setProfile(p=>({...p,photo:""}))} style={{marginLeft:6}}>Use Google</Btn>}<input ref={picRef} type="file" accept="image/*" onChange={uploadPic} style={{display:"none"}}/></div>
        </div>
        <Inp label="Display Name (blank uses Google)" value={profile.name} onChange={e=>setProfile(p=>({...p,name:e.target.value}))} placeholder={googleName||"Your name"}/>
        <div style={{fontSize:12,color:T.faint}}>Showing as: <strong style={{color:T.text}}>{displayName||"—"}</strong></div>
      </div>
      <div style={card}>
        <div style={{fontSize:14,fontWeight:700,color:T.text,marginBottom:12}}>🎨 Appearance</div>
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between"}}><span style={{fontSize:13,color:T.subtext}}>Theme</span><Btn small outline color={T.subtext} onClick={()=>setTheme(t=>t==="dark"?"light":"dark")}>{theme==="dark"?"☀️ Light":"🌙 Dark"}</Btn></div>
        <div style={{marginTop:12}}><Inp label="App Name" value={appName} onChange={e=>setAppName(e.target.value)} placeholder="acountee"/></div>
      </div>
      <div style={card}>
        <div style={{fontSize:14,fontWeight:700,color:T.text,marginBottom:10}}>🏷️ Manage Tags</div>
        <div style={{display:"flex",gap:8,marginBottom:10}}><input value={newTag} onChange={e=>setNewTag(e.target.value)} onKeyDown={e=>e.key==="Enter"&&addTag()} placeholder="New tag..." style={{flex:1,background:T.input,border:`1px solid ${T.border}`,borderRadius:8,padding:"6px 10px",color:T.text,fontSize:13}}/><Btn small color="#3B82F6" onClick={addTag}>Add</Btn></div>
        <div style={{display:"flex",flexWrap:"wrap",gap:6}}>{tags.map((t,i)=>(<div key={t} style={{background:`${COLORS_LIST[i%COLORS_LIST.length]}22`,border:`1px solid ${COLORS_LIST[i%COLORS_LIST.length]}44`,borderRadius:6,padding:"3px 10px",fontSize:12,color:COLORS_LIST[i%COLORS_LIST.length],display:"flex",alignItems:"center",gap:6}}>{t}<button onClick={()=>reqDelTag(t)} style={{background:"none",border:"none",color:"#ef4444",cursor:"pointer",fontSize:12,padding:0}}>×</button></div>))}{tags.length===0&&<span style={{fontSize:12,color:T.faint}}>No tags yet</span>}</div>
      </div>
      <div style={card}>
        <div style={{fontSize:14,fontWeight:700,color:T.text,marginBottom:10}}>💾 Backup</div>
        <div style={{display:"flex",gap:8}}><Btn small outline color="#10B981" onClick={exportData}>⬇ Download Backup</Btn><Btn small outline color="#3B82F6" onClick={()=>fileRef.current?.click()}>⬆ Restore Backup</Btn><input ref={fileRef} type="file" accept="application/json" onChange={importData} style={{display:"none"}}/></div>
      </div>
      <div style={card}>
        <div style={{fontSize:14,fontWeight:700,color:T.text,marginBottom:10}}>Account</div>
        <Btn outline color="#ef4444" onClick={onSignOut} style={{width:"100%"}}>Sign out</Btn>
      </div>
      {confirmDelTag&&<ConfirmModal message={confirmDelTag.count>0?`Tag "${confirmDelTag.tag}" is used by ${confirmDelTag.count} transaction${confirmDelTag.count!==1?"s":""}.`:`Delete tag "${confirmDelTag.tag}"?`} detail={confirmDelTag.count>0?"Those transactions will lose this tag label. Continue?":undefined} confirmLabel="Delete Tag" onConfirm={()=>delTag(confirmDelTag.tag)} onClose={()=>setConfirmDelTag(null)}/>}
    </div>
  );
}

// ── Root ──
export default function FinanceTracker({userId,userEmail,userName,userPhoto,onSignOut}){
  const[tab,setTab]=useState(0);
  const[theme,setTheme]=useState("light");
  T=THEMES[theme];
  const[banks,setBanks]=useState([]);
  const[investments,setInvestments]=useState([]);
  const[tags,setTags]=useState(["Food","Transport","Rent","Entertainment","Health","Shopping","Utilities","Salary"]);
  const notesState=useUndoable([]);const[notes,setNotes]=[notesState[0],notesState[1]];
  const[appName,setAppName]=useState("acountee");
  const[profile,setProfile]=useState({name:"",photo:""});
  const[overviewCur,setOverviewCur]=useState("USD");
  const[hideTotals,setHideTotals]=useState(false);
  const[syncStatus,setSyncStatus]=useState("loading");
  const isOnline=useOnlineStatus();
  const saveTimerRef=useRef(null);const initialLoadDone=useRef(false);const getCurrentPayload=useRef(null);

  useEffect(()=>{
    (async()=>{
      setSyncStatus("loading");
      const data=await loadData(userId);
      if(data){
        if(data.banks)setBanks(data.banks);
        else if(data.phpBanks||data.sgdBanks)setBanks([...(data.phpBanks||[]).map(b=>({...b,currency:"PHP"})),...(data.sgdBanks||[]).map(b=>({...b,currency:"SGD"}))]);
        let inv=[];
        if(data.investments){inv=data.investments.map(i=>{if(i.items)return i;const v=parseFloat(i.value)||0;return{id:i.id||Date.now()+Math.random(),name:i.name,bucket:i.bucket||"Stocks",items:[{id:Date.now()+Math.random(),name:i.name,currency:i.currency||"USD",cost:i.cost||0,value:v,notes:i.notes||"",history:i.history||[{value:v,date:new Date().toISOString()}]}]};});}
        if(data.crypto){const cryptoItems=data.crypto.map(c=>({id:(c.id||Date.now())+Math.random(),name:c.coin,currency:c.currency||"USD",cost:0,value:parseFloat(c.value)||0,notes:c.notes||`${c.amount} tokens`,history:[{value:parseFloat(c.value)||0,date:new Date().toISOString()}]}));if(cryptoItems.length)inv.push({id:Date.now()+Math.random(),name:"Crypto Portfolio",bucket:"Crypto",items:cryptoItems});}
        setInvestments(inv);
        if(data.tags)setTags(data.tags);
        if(Array.isArray(data.notes))setNotes(data.notes);else if(typeof data.notes==="string"&&data.notes.trim())setNotes([{id:Date.now(),text:data.notes}]);
        if(data.theme)setTheme(data.theme);
        if(data.appName)setAppName(data.appName);
        if(data.profile)setProfile(data.profile);
        if(data.overviewCur)setOverviewCur(data.overviewCur);
      }
      setSyncStatus("saved");initialLoadDone.current=true;
    })();
  // eslint-disable-next-line
  },[userId]);

  useEffect(()=>{
    if(!initialLoadDone.current)return;
    getCurrentPayload.current=()=>({banks,investments,tags,notes,theme,appName,profile,overviewCur});
    setSyncStatus("saving");if(saveTimerRef.current)clearTimeout(saveTimerRef.current);
    saveTimerRef.current=setTimeout(async()=>{await saveData(userId,{banks,investments,tags,notes,theme,appName,profile,overviewCur});setSyncStatus(isOnline?"saved":"offline");},2000);
    return()=>clearTimeout(saveTimerRef.current);
  },[banks,investments,tags,notes,theme,appName,profile,overviewCur,userId,isOnline]);

  useEffect(()=>{
    if(!initialLoadDone.current)return;
    const unsub=syncWhenOnline(userId,()=>getCurrentPayload.current?.()??{});
    return()=>{unsub.then(fn=>fn?.());};
  },[userId]);

  const importBackup=p=>{if(p.banks)setBanks(p.banks);if(p.investments)setInvestments(p.investments);if(p.tags)setTags(p.tags);if(Array.isArray(p.notes))setNotes(p.notes);if(p.theme)setTheme(p.theme);if(p.appName)setAppName(p.appName);if(p.profile)setProfile(p.profile);};
  const getData=()=>({banks,investments,tags,notes,theme,appName,profile,overviewCur});
  const TAB_COLORS=["#3B82F6","#3B82F6","#8B5CF6","#06B6D4","#10B981","#64748B"];

  return(
    <div style={{minHeight:"100vh",background:T.bg,color:T.text,fontFamily:"system-ui,sans-serif"}}>
      <div style={{maxWidth:680,margin:"0 auto",padding:"0 16px 40px"}}>
        <div style={{padding:"20px 0 12px",borderBottom:`1px solid ${T.border}`,marginBottom:20,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
          <div>
            <div style={{fontSize:22,fontWeight:700}}>💰 {appName}</div>
            <div style={{fontSize:11,color:T.faint,marginTop:2}}>{VERSION}</div>
          </div>
          <div style={{display:"flex",alignItems:"center",gap:8}}>
            <SyncBar status={syncStatus} isOnline={isOnline}/>
            <button onClick={()=>setTheme(t=>t==="dark"?"light":"dark")} style={{background:T.card,border:`1px solid ${T.border}`,borderRadius:8,padding:"5px 10px",cursor:"pointer",fontSize:14}}>{theme==="dark"?"☀️":"🌙"}</button>
            <button onClick={onSignOut} style={{background:"transparent",border:`1px solid ${T.border}`,color:T.subtext,borderRadius:8,padding:"5px 12px",cursor:"pointer",fontSize:12}}>Sign out</button>
          </div>
        </div>
        <div style={{display:"flex",gap:6,overflowX:"auto",marginBottom:24,paddingBottom:4}}>
          {TABS.map((t,i)=>(<button key={t} onClick={()=>setTab(i)} style={{background:tab===i?TAB_COLORS[i]:T.card,color:tab===i?"#fff":T.subtext,border:"none",borderRadius:8,padding:"7px 14px",cursor:"pointer",fontSize:13,fontWeight:500,whiteSpace:"nowrap"}}>{t}</button>))}
        </div>
        {tab===0&&<Dashboard banks={banks} setBanks={setBanks} investments={investments} tags={tags} overviewCur={overviewCur} setOverviewCur={setOverviewCur} hideTotals={hideTotals} setHideTotals={setHideTotals}/>}
        {tab===1&&<BanksSection banks={banks} setBanks={setBanks} tags={tags}/>}
        {tab===2&&<InvestmentsSection investments={investments} setInvestments={setInvestments} hideTotals={hideTotals}/>}
        {tab===3&&<AnalyticsSection banks={banks}/>}
        {tab===4&&<NotesSection notesState={notesState}/>}
        {tab===5&&<SettingsSection tags={tags} setTags={setTags} banks={banks} theme={theme} setTheme={setTheme} appName={appName} setAppName={setAppName} profile={profile} setProfile={setProfile} googleName={userName} googlePhoto={userPhoto} getData={getData} onImport={importBackup} onSignOut={onSignOut}/>}
      </div>
    </div>
  );
}