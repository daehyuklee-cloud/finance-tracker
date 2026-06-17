import { useState, useEffect, useRef, useCallback } from "react";
import { loadData, saveData } from "../db";

const TABS = ["Dashboard", "Banks", "Investments", "Analytics", "Notes"];
const COLORS_LIST = ["#3B82F6","#10B981","#F59E0B","#8B5CF6","#EC4899","#06B6D4","#F97316","#84CC16","#EF4444","#14B8A6"];
const BANK_COLOR_CHOICES = ["#3B82F6","#10B981","#F59E0B","#8B5CF6","#EC4899","#06B6D4","#F97316","#84CC16","#EF4444","#14B8A6","#A855F7","#64748B"];
const ENVELOPE_EMOJIS = ["🗂️","🏠","🚗","🍔","✈️","💊","🎁","💡","📚","👕","🎮","💰","🏦","❤️","🎓","🐶","☕","🛒","💳","🔧","🎵","🏖️","💼","📱"];
const UNALLOC_ID = "__unallocated__";
const MAX_HISTORY = 50;

const CURRENCY_SYMBOLS = { PHP:"₱", SGD:"S$", USD:"$", KRW:"₩", JPY:"¥", EUR:"€", GBP:"£", AUD:"A$", HKD:"HK$", MYR:"RM", IDR:"Rp", THB:"฿" };
const CURRENCY_LIST = Object.keys(CURRENCY_SYMBOLS);
const INVESTMENT_BUCKETS = ["Stocks","ETF","Crypto","Artwork","Watches","Real Estate","Bonds","Other"];

function sym(c){ return CURRENCY_SYMBOLS[c] || (c?c+" ":""); }
const fmtNum = n => Number(n||0).toLocaleString("en-US",{minimumFractionDigits:2,maximumFractionDigits:2});
function getCurrencyColor(currency){ const idx=CURRENCY_LIST.indexOf(currency); return COLORS_LIST[Math.max(0,idx)%COLORS_LIST.length]; }
function bankColor(b){ return b.color || getCurrencyColor(b.currency); }

// ── Theme ──
const THEMES = {
  dark: { bg:"#0f1117", card:"#1e2130", card2:"#0f1117", border:"#334155", text:"#f1f5f9", subtext:"#94a3b8", faint:"#475569", input:"#0f1117" },
  light:{ bg:"#f8fafc", card:"#ffffff", card2:"#f1f5f9", border:"#e2e8f0", text:"#0f172a", subtext:"#475569", faint:"#94a3b8", input:"#ffffff" }
};
let T = THEMES.dark;

function useUndoable(init) {
  const [history, setHistory] = useState([init]);
  const [idx, setIdx] = useState(0);
  const val = history[idx];
  const set = useCallback((fn) => {
    setHistory(h => { const next = typeof fn==="function"?fn(h[idx]):fn; return [...h.slice(0,idx+1),next].slice(-MAX_HISTORY); });
    setIdx(i => Math.min(i+1, MAX_HISTORY-1));
  }, [idx]);
  const undo = useCallback(()=>setIdx(i=>Math.max(0,i-1)),[]);
  const redo = useCallback(()=>setIdx(i=>Math.min(history.length-1,i+1)),[history.length]);
  return [val, set, undo, redo, idx>0, idx<history.length-1];
}

function Modal({ title, onClose, children }) {
  return (
    <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.6)",zIndex:100,display:"flex",alignItems:"center",justifyContent:"center"}}>
      <div style={{background:T.card,borderRadius:12,padding:24,minWidth:340,maxWidth:480,width:"90%",maxHeight:"85vh",overflowY:"auto"}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16}}>
          <strong style={{fontSize:16,color:T.text}}>{title}</strong>
          <button onClick={onClose} style={{background:"none",border:"none",color:T.subtext,cursor:"pointer",fontSize:22,lineHeight:1}}>×</button>
        </div>
        {children}
      </div>
    </div>
  );
}

function ConfirmModal({ message, detail, confirmLabel="Delete", requireDel, onConfirm, onClose }) {
  const [val, setVal] = useState("");
  const ok = requireDel ? val==="DEL" : true;
  return (
    <Modal title="Please Confirm" onClose={onClose}>
      <p style={{color:T.text,fontSize:14,marginBottom:8}}>{message}</p>
      {detail&&<p style={{color:T.subtext,fontSize:13,marginBottom:12}}>{detail}</p>}
      {requireDel&&<>
        <p style={{color:T.subtext,fontSize:13,marginBottom:8}}>Type <strong style={{color:"#ef4444",letterSpacing:2}}>DEL</strong> to confirm.</p>
        <input value={val} onChange={e=>setVal(e.target.value)} placeholder="Type DEL" autoFocus style={{width:"100%",background:T.input,border:`1px solid ${val==="DEL"?"#ef4444":T.border}`,borderRadius:8,padding:"8px 10px",color:T.text,fontSize:14,boxSizing:"border-box",marginBottom:12,letterSpacing:2}}/>
      </>}
      <div style={{display:"flex",gap:8}}>
        <button onClick={onClose} style={{flex:1,background:"transparent",border:`1px solid ${T.border}`,color:T.subtext,borderRadius:8,padding:"8px",cursor:"pointer",fontSize:14}}>Cancel</button>
        <button onClick={()=>ok&&onConfirm()} disabled={!ok} style={{flex:1,background:ok?"#ef4444":"#2d1f1f",border:"1px solid #ef4444",color:ok?"#fff":"#7f3f3f",borderRadius:8,padding:"8px",cursor:ok?"pointer":"not-allowed",fontSize:14,fontWeight:600}}>{confirmLabel}</button>
      </div>
    </Modal>
  );
}

function Inp({ label, ...p }) {
  return (
    <div style={{marginBottom:12}}>
      {label && <div style={{fontSize:12,color:T.subtext,marginBottom:4}}>{label}</div>}
      <input {...p} style={{width:"100%",background:T.input,border:`1px solid ${T.border}`,borderRadius:8,padding:"8px 10px",color:T.text,fontSize:14,boxSizing:"border-box",...p.style}}/>
    </div>
  );
}

function Sel({ label, children, ...p }) {
  return (
    <div style={{marginBottom:12}}>
      {label && <div style={{fontSize:12,color:T.subtext,marginBottom:4}}>{label}</div>}
      <select {...p} style={{width:"100%",background:T.input,border:`1px solid ${T.border}`,borderRadius:8,padding:"8px 10px",color:T.text,fontSize:14,...p.style}}>{children}</select>
    </div>
  );
}

function Btn({ children, color="#3B82F6", outline, small, ...p }) {
  return (
    <button {...p} style={{background:outline?"transparent":color,border:`1px solid ${color}`,color:outline?color:"#fff",borderRadius:8,padding:small?"4px 10px":"8px 16px",fontSize:small?12:14,cursor:"pointer",fontWeight:500,...p.style}}>
      {children}
    </button>
  );
}

function UndoBar({ undo, redo, canUndo, canRedo }) {
  return (
    <div style={{display:"flex",gap:6,marginBottom:14}}>
      <button onClick={undo} disabled={!canUndo} style={{background:canUndo?T.card:T.card2,border:`1px solid ${T.border}`,color:canUndo?T.text:T.faint,borderRadius:8,padding:"5px 12px",cursor:canUndo?"pointer":"not-allowed",fontSize:13}}>↩ Undo</button>
      <button onClick={redo} disabled={!canRedo} style={{background:canRedo?T.card:T.card2,border:`1px solid ${T.border}`,color:canRedo?T.text:T.faint,borderRadius:8,padding:"5px 12px",cursor:canRedo?"pointer":"not-allowed",fontSize:13}}>↪ Redo</button>
    </div>
  );
}

function SyncBar({ status }) {
  const colors={idle:T.faint,saving:"#F59E0B",saved:"#10B981",error:"#ef4444",loading:"#3B82F6"};
  const icons={idle:"☁️",saving:"⏳",saved:"✓",error:"⚠️",loading:"⏳"};
  const labels={idle:"Ready",saving:"Saving…",saved:"Saved",error:"Failed",loading:"Loading…"};
  return (
    <div style={{display:"flex",alignItems:"center",gap:6,fontSize:12,color:colors[status],padding:"4px 10px",background:T.card,borderRadius:8}}>
      <span>{icons[status]}</span><span>{labels[status]}</span>
    </div>
  );
}

function makeBank(name, currency, balance, color) {
  return { id:Date.now(), name, currency, color:color||null, balance, envelopes:[{id:UNALLOC_ID,name:"Unallocated",emoji:"📂",balance,transactions:[],isUnalloc:true}] };
}
function bankTotal(bank){ return (bank.envelopes||[]).reduce((s,e)=>s+e.balance,0); }

// ── Exchange Rate ──
const rateCache = {};
async function fetchRate(from, to) {
  if(from===to) return 1;
  const key=`${from}_${to}`;
  if(rateCache[key]!==undefined) return rateCache[key];
  try {
    // open.er-api.com — free, no key, supports PHP/KRW/IDR/THB and 160+ currencies
    const res = await fetch(`https://open.er-api.com/v6/latest/${from}`);
    const data = await res.json();
    const r = (data.result==="success" && data.rates?.[to]) ? data.rates[to] : null;
    if(r!==null){
      // cache all pairs from this base to save requests
      Object.entries(data.rates||{}).forEach(([cur,val])=>{ rateCache[`${from}_${cur}`]=val; });
    } else {
      rateCache[key]=null;
    }
    return r;
  } catch { return null; }
}

function ConversionBadge({ amount, fromCurrency, toCurrency, style }) {
  const [rate, setRate] = useState(null);
  useEffect(()=>{ if(fromCurrency!==toCurrency) fetchRate(fromCurrency,toCurrency).then(setRate); },[fromCurrency,toCurrency]);
  if(fromCurrency===toCurrency || rate===null) return null;
  return <span style={{fontSize:11,color:T.faint,marginLeft:8,...style}}>≈ {sym(toCurrency)}{fmtNum(amount*rate)} {toCurrency}</span>;
}

// Hook: convert a set of {amount,currency} into target currency total
function useMultiConvert(items, target) {
  const [total, setTotal] = useState(null);
  useEffect(()=>{
    let active=true;
    (async()=>{
      let sum=0, ok=true;
      for(const it of items){
        const r=await fetchRate(it.currency,target);
        if(r===null){ ok=false; break; }
        sum+=it.amount*r;
      }
      if(active) setTotal(ok?sum:null);
    })();
    return ()=>{active=false;};
  // eslint-disable-next-line
  },[JSON.stringify(items),target]);
  return total;
}

// ── Transaction Edit Modal ──
function TxEditModal({ tx, currency, tags, onSave, onClose }) {
  const [form, setForm] = useState({...tx});
  return (
    <Modal title="Edit Transaction" onClose={onClose}>
      <div style={{display:"flex",gap:8,marginBottom:12}}>
        {["income","expense"].map(t=><Btn key={t} color={t==="income"?"#10B981":"#ef4444"} outline={form.type!==t} onClick={()=>setForm(f=>({...f,type:t}))} style={{flex:1,textTransform:"capitalize"}}>{t}</Btn>)}
      </div>
      <Inp label="Description" value={form.desc} onChange={e=>setForm(f=>({...f,desc:e.target.value}))}/>
      <Inp label="Amount" type="number" value={form.amount} onChange={e=>setForm(f=>({...f,amount:e.target.value}))}/>
      <Sel label="Tag" value={form.tag||""} onChange={e=>setForm(f=>({...f,tag:e.target.value}))}>
        <option value="">No tag</option>
        {(tags||[]).map(t=><option key={t} value={t}>{t}</option>)}
      </Sel>
      <Inp label="Note" value={form.note||""} onChange={e=>setForm(f=>({...f,note:e.target.value}))}/>
      <Inp label="Date" type="date" value={form.date} onChange={e=>setForm(f=>({...f,date:e.target.value}))}/>
      <Btn color="#3B82F6" onClick={()=>onSave({...form,amount:parseFloat(form.amount)||0})} style={{width:"100%"}}>Save Changes</Btn>
    </Modal>
  );
}

function TransferModal({ bank, onClose, onTransfer }) {
  const envs = bank.envelopes||[];
  const color = bankColor(bank);
  const [from,setFrom]=useState(envs[0]?.id||"");
  const [to,setTo]=useState(envs[1]?.id||"");
  const [amt,setAmt]=useState("");
  const doTransfer=()=>{
    const a=parseFloat(amt);if(!a||from===to)return;
    const src=envs.find(e=>e.id===from);
    if(!src||src.balance<a){alert("Insufficient balance!");return;}
    onTransfer(from,to,a);onClose();
  };
  return (
    <Modal title="Transfer Between Envelopes" onClose={onClose}>
      <Sel label="From" value={from} onChange={e=>setFrom(e.target.value)}>
        {envs.map(e=><option key={e.id} value={e.id}>{e.name} ({sym(bank.currency)}{fmtNum(e.balance)})</option>)}
      </Sel>
      <Sel label="To" value={to} onChange={e=>setTo(e.target.value)}>
        {envs.map(e=><option key={e.id} value={e.id}>{e.name} ({sym(bank.currency)}{fmtNum(e.balance)})</option>)}
      </Sel>
      <Inp label="Amount" type="number" value={amt} onChange={e=>setAmt(e.target.value)} placeholder="0.00"/>
      <Btn color={color} onClick={doTransfer} style={{width:"100%"}}>Transfer</Btn>
    </Modal>
  );
}

function EmojiPicker({ value, onPick }) {
  return (
    <div style={{display:"flex",flexWrap:"wrap",gap:6,marginBottom:12}}>
      {ENVELOPE_EMOJIS.map(em=>(
        <button key={em} onClick={()=>onPick(em)} style={{fontSize:18,padding:"4px 6px",borderRadius:8,cursor:"pointer",background:value===em?"#3B82F6":T.input,border:`1px solid ${value===em?"#3B82F6":T.border}`}}>{em}</button>
      ))}
    </div>
  );
}

function EnvelopeView({ bank, bankId, setBanks, tags }) {
  const color = bankColor(bank);
  const currency = bank.currency;
  const [showAdd,setShowAdd]=useState(false);
  const [showTx,setShowTx]=useState(null);
  const [showHist,setShowHist]=useState(null);
  const [showTransfer,setShowTransfer]=useState(false);
  const [editEnv,setEditEnv]=useState(null);
  const [editTx,setEditTx]=useState(null); // {envId, tx}
  const [confirmDelTx,setConfirmDelTx]=useState(null); // {envId, txId, desc}
  const [confirmDelEnv,setConfirmDelEnv]=useState(null);
  const [envName,setEnvName]=useState("");
  const [envBal,setEnvBal]=useState("");
  const [envGoal,setEnvGoal]=useState("");
  const [envEmoji,setEnvEmoji]=useState("🗂️");
  const [convCurrency,setConvCurrency]=useState("");
  const [tx,setTx]=useState({type:"expense",desc:"",amount:"",tag:"",note:"",date:new Date().toISOString().slice(0,10)});
  const envelopes=bank.envelopes||[];
  const unallocEnv=envelopes.find(e=>e.id===UNALLOC_ID);
  const updateBank=fn=>setBanks(bs=>bs.map(b=>b.id!==bankId?b:fn(b)));

  const addEnvelope=()=>{
    if(!envName.trim())return;
    const amt=parseFloat(envBal)||0;
    if(unallocEnv&&amt>unallocEnv.balance+0.001){alert("Not enough in Unallocated!");return;}
    updateBank(b=>({...b,envelopes:b.envelopes.map(e=>e.id!==UNALLOC_ID?e:{...e,balance:e.balance-amt}).concat([{id:Date.now(),name:envName.trim(),emoji:envEmoji,balance:amt,goal:parseFloat(envGoal)||null,transactions:[]}])}));
    setEnvName("");setEnvBal("");setEnvGoal("");setEnvEmoji("🗂️");setShowAdd(false);
  };
  const saveEnvEdit=()=>{
    updateBank(b=>({...b,envelopes:b.envelopes.map(e=>e.id!==editEnv.id?e:{...e,name:editEnv.name,emoji:editEnv.emoji,goal:parseFloat(editEnv.goal)||null})}));
    setEditEnv(null);
  };
  const delEnvelope=envId=>{
    updateBank(b=>{const env=b.envelopes.find(e=>e.id===envId);return{...b,envelopes:b.envelopes.filter(e=>e.id!==envId).map(e=>e.id===UNALLOC_ID?{...e,balance:e.balance+(env?.balance||0)}:e)};});
    setConfirmDelEnv(null);
  };
  const addTx=()=>{
    if(!tx.desc||!tx.amount)return;
    const amt=parseFloat(tx.amount);const isIncome=tx.type==="income";
    const newTx={id:Date.now(),...tx,amount:amt};
    updateBank(b=>({...b,balance:b.balance+(isIncome?amt:-amt),envelopes:b.envelopes.map(e=>e.id!==showTx?e:{...e,balance:e.balance+(isIncome?amt:-amt),transactions:[newTx,...e.transactions]})}));
    setTx({type:"expense",desc:"",amount:"",tag:"",note:"",date:new Date().toISOString().slice(0,10)});setShowTx(null);
  };
  const saveTxEdit=(envId,updated)=>{
    updateBank(b=>{
      const env=b.envelopes.find(e=>e.id===envId);
      const old=env.transactions.find(t=>t.id===updated.id);
      const oldDelta=old.type==="income"?old.amount:-old.amount;
      const newDelta=updated.type==="income"?updated.amount:-updated.amount;
      const diff=newDelta-oldDelta;
      return {...b,balance:b.balance+diff,envelopes:b.envelopes.map(e=>e.id!==envId?e:{...e,balance:e.balance+diff,transactions:e.transactions.map(t=>t.id===updated.id?updated:t)})};
    });
    setEditTx(null);
  };
  const delTx=(envId,txId)=>{
    updateBank(b=>{const env=b.envelopes.find(e=>e.id===envId);const t=env?.transactions.find(x=>x.id===txId);if(!t)return b;const delta=t.type==="income"?-t.amount:t.amount;return{...b,balance:b.balance+delta,envelopes:b.envelopes.map(e=>e.id!==envId?e:{...e,balance:e.balance+delta,transactions:e.transactions.filter(x=>x.id!==txId)})};});
    setConfirmDelTx(null);
  };
  const doTransfer=(fromId,toId,amt)=>updateBank(b=>({...b,envelopes:b.envelopes.map(e=>e.id===fromId?{...e,balance:e.balance-amt}:e.id===toId?{...e,balance:e.balance+amt}:e)}));
  const histEnv=envelopes.find(e=>e.id===showHist);

  return (
    <div style={{marginTop:12}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
        <div style={{display:"flex",alignItems:"center",gap:8}}>
          <span style={{fontSize:13,color:T.subtext}}>Envelopes</span>
          <select value={convCurrency} onChange={e=>setConvCurrency(e.target.value)} style={{background:T.input,border:`1px solid ${T.border}`,borderRadius:6,padding:"2px 6px",color:T.faint,fontSize:11}}>
            <option value="">+ Convert</option>
            {CURRENCY_LIST.filter(c=>c!==currency).map(c=><option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        <div style={{display:"flex",gap:6}}>
          <Btn small outline color={color} onClick={()=>setShowTransfer(true)}>⇄</Btn>
          <Btn small color={color} onClick={()=>setShowAdd(true)}>+ Envelope</Btn>
        </div>
      </div>
      <div style={{display:"flex",flexDirection:"column",gap:6}}>
        {envelopes.map(e=>(
          <div key={e.id} style={{background:T.card2,borderRadius:8,padding:"10px 12px",border:`1px solid ${e.isUnalloc?T.border:color+"33"}`,display:"flex",justifyContent:"space-between",alignItems:"center",gap:8}}>
            <div style={{display:"flex",alignItems:"center",gap:8,flex:1,minWidth:0}}>
              <span style={{fontSize:16}}>{e.isUnalloc?"📂":(e.emoji||"🗂️")}</span>
              <div style={{flex:1,minWidth:0}}>
                <div style={{fontSize:13,color:e.isUnalloc?T.faint:T.text,fontStyle:e.isUnalloc?"italic":"normal"}}>
                  {e.name}{e.goal?<span style={{fontSize:11,color:T.faint,marginLeft:6}}>Goal: {sym(currency)}{fmtNum(e.goal)}</span>:null}
                </div>
                {e.goal&&!e.isUnalloc&&(()=>{const pct=Math.min(100,Math.round((e.balance/e.goal)*100));const rem=e.goal-e.balance;return(<div style={{marginTop:4}}><div style={{background:T.card,borderRadius:99,height:5,overflow:"hidden"}}><div style={{width:`${pct}%`,height:"100%",background:pct>=100?"#10B981":color,borderRadius:99}}/></div><div style={{fontSize:10,color:pct>=100?"#10B981":T.faint,marginTop:2}}>{pct}%{pct>=100?" ✓":<span style={{marginLeft:4,color:T.subtext}}>· {sym(currency)}{fmtNum(rem)} left</span>}</div></div>);})()}
                {!e.goal&&<div style={{fontSize:11,color:T.faint}}>{e.transactions.length} tx</div>}
              </div>
            </div>
            <div style={{display:"flex",gap:4,alignItems:"center",flexShrink:0}}>
              <div style={{textAlign:"right"}}>
                <div style={{color:e.balance<0?"#ef4444":e.isUnalloc?T.faint:color,fontWeight:600,fontSize:13}}>{sym(currency)}{fmtNum(e.balance)}</div>
                {convCurrency&&<ConversionBadge amount={e.balance} fromCurrency={currency} toCurrency={convCurrency} style={{marginLeft:0}}/>}
              </div>
              <Btn small color={color} onClick={()=>setShowTx(e.id)}>+Tx</Btn>
              <Btn small outline color={color} onClick={()=>setShowHist(e.id)}>↗</Btn>
              {!e.isUnalloc&&<Btn small outline color={T.subtext} onClick={()=>setEditEnv({id:e.id,name:e.name,emoji:e.emoji||"🗂️",goal:e.goal||""})}>✏️</Btn>}
              {!e.isUnalloc&&<Btn small outline color="#ef4444" onClick={()=>setConfirmDelEnv({id:e.id,name:e.name})}>🗑</Btn>}
            </div>
          </div>
        ))}
      </div>

      {confirmDelEnv&&<ConfirmModal message={`Delete envelope "${confirmDelEnv.name}"?`} detail="Its balance returns to Unallocated." requireDel onConfirm={()=>delEnvelope(confirmDelEnv.id)} onClose={()=>setConfirmDelEnv(null)}/>}
      {confirmDelTx&&<ConfirmModal message={`Delete transaction "${confirmDelTx.desc}"?`} confirmLabel="Delete" onConfirm={()=>delTx(confirmDelTx.envId,confirmDelTx.txId)} onClose={()=>setConfirmDelTx(null)}/>}

      {showAdd&&<Modal title="New Envelope" onClose={()=>setShowAdd(false)}>
        <div style={{fontSize:13,color:T.subtext,marginBottom:12}}>Available: <strong style={{color}}>{sym(currency)}{fmtNum(unallocEnv?.balance||0)}</strong></div>
        <Inp label="Name" value={envName} onChange={e=>setEnvName(e.target.value)} placeholder="e.g. Rent, Emergency"/>
        <div style={{fontSize:12,color:T.subtext,marginBottom:4}}>Icon</div>
        <EmojiPicker value={envEmoji} onPick={setEnvEmoji}/>
        <Inp label="Allocate Amount" type="number" value={envBal} onChange={e=>setEnvBal(e.target.value)} placeholder="0.00"/>
        <Inp label="Goal (optional)" type="number" value={envGoal} onChange={e=>setEnvGoal(e.target.value)} placeholder="e.g. 10000"/>
        <Btn color={color} onClick={addEnvelope} style={{width:"100%"}}>Create Envelope</Btn>
      </Modal>}

      {editEnv&&<Modal title="Edit Envelope" onClose={()=>setEditEnv(null)}>
        <Inp label="Name" value={editEnv.name} onChange={e=>setEditEnv(v=>({...v,name:e.target.value}))}/>
        <div style={{fontSize:12,color:T.subtext,marginBottom:4}}>Icon</div>
        <EmojiPicker value={editEnv.emoji} onPick={em=>setEditEnv(v=>({...v,emoji:em}))}/>
        <Inp label="Goal (blank to remove)" type="number" value={editEnv.goal} onChange={e=>setEditEnv(v=>({...v,goal:e.target.value}))}/>
        <Btn color={color} onClick={saveEnvEdit} style={{width:"100%"}}>Save</Btn>
      </Modal>}

      {showTx&&<Modal title={`Add Transaction → ${envelopes.find(e=>e.id===showTx)?.name}`} onClose={()=>setShowTx(null)}>
        <div style={{display:"flex",gap:8,marginBottom:12}}>
          {["income","expense"].map(t=><Btn key={t} color={t==="income"?"#10B981":"#ef4444"} outline={tx.type!==t} onClick={()=>setTx(x=>({...x,type:t}))} style={{flex:1,textTransform:"capitalize"}}>{t}</Btn>)}
        </div>
        <Inp label="Description" value={tx.desc} onChange={e=>setTx(x=>({...x,desc:e.target.value}))} placeholder="e.g. Salary, Groceries"/>
        <Inp label="Amount" type="number" value={tx.amount} onChange={e=>setTx(x=>({...x,amount:e.target.value}))} placeholder="0.00"/>
        <Sel label="Tag (optional)" value={tx.tag} onChange={e=>setTx(x=>({...x,tag:e.target.value}))}>
          <option value="">No tag</option>
          {(tags||[]).map(t=><option key={t} value={t}>{t}</option>)}
        </Sel>
        <Inp label="Note (optional)" value={tx.note} onChange={e=>setTx(x=>({...x,note:e.target.value}))} placeholder="Any notes..."/>
        <Inp label="Date" type="date" value={tx.date} onChange={e=>setTx(x=>({...x,date:e.target.value}))}/>
        <Btn color={color} onClick={addTx} style={{width:"100%"}}>Add Transaction</Btn>
      </Modal>}

      {showHist&&<Modal title={`${histEnv?.name} · History`} onClose={()=>setShowHist(null)}>
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

      {editTx&&<TxEditModal tx={editTx.tx} currency={currency} tags={tags} onSave={updated=>saveTxEdit(editTx.envId,updated)} onClose={()=>setEditTx(null)}/>}
      {showTransfer&&<TransferModal bank={bank} onClose={()=>setShowTransfer(false)} onTransfer={doTransfer}/>}
    </div>
  );
}

function BanksSection({ banks, setBanks, tags, undoProps }) {
  const [showBank,setShowBank]=useState(false);
  const [expandedSet,setExpandedSet]=useState({});
  const [editBank,setEditBank]=useState(null);
  const [confirmDel,setConfirmDel]=useState(null);
  const [bankName,setBankName]=useState("");
  const [bankCurrency,setBankCurrency]=useState("PHP");
  const [bankBal,setBankBal]=useState("");
  const [bankColorPick,setBankColorPick]=useState(BANK_COLOR_CHOICES[0]);
  const [globalConv,setGlobalConv]=useState("");

  const grouped = banks.reduce((acc,b)=>{(acc[b.currency]=acc[b.currency]||[]).push(b);return acc;},{});
  const toggle=id=>setExpandedSet(s=>({...s,[id]:!s[id]}));

  const addBank=()=>{
    if(!bankName.trim())return;
    setBanks(b=>[...b,makeBank(bankName.trim(),bankCurrency,parseFloat(bankBal)||0,bankColorPick)]);
    setBankName("");setBankBal("");setShowBank(false);
  };
  const saveBankEdit=()=>{
    const newTotal=parseFloat(editBank.balance);
    setBanks(bs=>bs.map(b=>{
      if(b.id!==editBank.id)return b;
      let envelopes=b.envelopes;
      if(!isNaN(newTotal)&&newTotal!==bankTotal(b)){
        const diff=newTotal-bankTotal(b);
        envelopes=b.envelopes.map(e=>e.id===UNALLOC_ID?{...e,balance:e.balance+diff}:e);
      }
      return {...b,name:editBank.name,color:editBank.color,envelopes};
    }));
    setEditBank(null);
  };
  const delBank=id=>{setBanks(b=>b.filter(x=>x.id!==id));setConfirmDel(null);};

  return (
    <div>
      <UndoBar {...undoProps}/>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16}}>
        <div style={{display:"flex",alignItems:"center",gap:8}}>
          <span style={{fontSize:18,fontWeight:700,color:T.text}}>All Banks</span>
          <select value={globalConv} onChange={e=>setGlobalConv(e.target.value)} style={{background:T.card,border:`1px solid ${T.border}`,borderRadius:6,padding:"3px 8px",color:T.faint,fontSize:12}}>
            <option value="">Convert →</option>
            {CURRENCY_LIST.map(c=><option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        <Btn color="#3B82F6" onClick={()=>setShowBank(true)}>+ Add Bank</Btn>
      </div>

      {banks.length===0&&<div style={{color:T.faint,textAlign:"center",padding:32}}>No banks yet.</div>}

      {Object.entries(grouped).map(([currency,cBanks])=>{
        const total=cBanks.reduce((s,b)=>s+bankTotal(b),0);
        const gc=getCurrencyColor(currency);
        return (
          <div key={currency} style={{marginBottom:24}}>
            <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:10}}>
              <div style={{fontSize:13,fontWeight:600,color:gc}}>{currency} Banks</div>
              <div style={{fontSize:13,color:gc}}>{sym(currency)}{fmtNum(total)}</div>
              {globalConv&&<ConversionBadge amount={total} fromCurrency={currency} toCurrency={globalConv}/>}
            </div>
            <div style={{display:"flex",flexDirection:"column",gap:10}}>
              {cBanks.map(bk=>{
                const color=bankColor(bk);
                return (
                  <div key={bk.id} style={{background:T.card,borderRadius:12,border:`1px solid ${T.border}`,overflow:"hidden"}}>
                    <div style={{padding:"14px 16px",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                      <div style={{display:"flex",alignItems:"center",gap:10}}>
                        <div style={{width:4,height:36,borderRadius:2,background:color}}/>
                        <div>
                          <div style={{fontWeight:600,fontSize:15,color:T.text}}>{bk.name}</div>
                          <div style={{fontSize:20,fontWeight:700,color,marginTop:2}}>
                            {sym(bk.currency)}{fmtNum(bankTotal(bk))}
                            {globalConv&&<ConversionBadge amount={bankTotal(bk)} fromCurrency={bk.currency} toCurrency={globalConv}/>}
                          </div>
                          <div style={{fontSize:11,color:T.faint,marginTop:2}}>{(bk.envelopes||[]).length} envelopes</div>
                        </div>
                      </div>
                      <div style={{display:"flex",gap:6}}>
                        <Btn small outline color={T.subtext} onClick={()=>setEditBank({id:bk.id,name:bk.name,balance:bankTotal(bk),color:bankColor(bk)})}>✏️</Btn>
                        <Btn small outline color={color} onClick={()=>toggle(bk.id)}>{expandedSet[bk.id]?"▲":"▼"}</Btn>
                        <Btn small outline color="#ef4444" onClick={()=>setConfirmDel({id:bk.id,name:bk.name})}>🗑</Btn>
                      </div>
                    </div>
                    {expandedSet[bk.id]&&<div style={{borderTop:`1px solid ${T.border}`,padding:"12px 16px"}}>
                      <EnvelopeView bank={bk} bankId={bk.id} setBanks={setBanks} tags={tags}/>
                    </div>}
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}

      {confirmDel&&<ConfirmModal message={`Delete bank "${confirmDel.name}"?`} detail="All its envelopes and transactions will be removed." requireDel onConfirm={()=>delBank(confirmDel.id)} onClose={()=>setConfirmDel(null)}/>}

      {showBank&&<Modal title="Add Bank" onClose={()=>setShowBank(false)}>
        <Inp label="Bank Name" value={bankName} onChange={e=>setBankName(e.target.value)} placeholder="e.g. BDO, DBS, Chase"/>
        <Sel label="Currency" value={bankCurrency} onChange={e=>setBankCurrency(e.target.value)}>
          {CURRENCY_LIST.map(c=><option key={c} value={c}>{c} — {CURRENCY_SYMBOLS[c]}</option>)}
        </Sel>
        <div style={{fontSize:12,color:T.subtext,marginBottom:4}}>Color</div>
        <div style={{display:"flex",flexWrap:"wrap",gap:6,marginBottom:12}}>
          {BANK_COLOR_CHOICES.map(c=><button key={c} onClick={()=>setBankColorPick(c)} style={{width:28,height:28,borderRadius:8,background:c,border:bankColorPick===c?"3px solid #fff":"1px solid #00000033",cursor:"pointer"}}/>)}
        </div>
        <Inp label="Starting Balance" type="number" value={bankBal} onChange={e=>setBankBal(e.target.value)} placeholder="0.00"/>
        <Btn color={bankColorPick} onClick={addBank} style={{width:"100%"}}>Add Bank</Btn>
      </Modal>}

      {editBank&&<Modal title="Edit Bank" onClose={()=>setEditBank(null)}>
        <Inp label="Bank Name" value={editBank.name} onChange={e=>setEditBank(v=>({...v,name:e.target.value}))}/>
        <Inp label="Total Balance (adjusts Unallocated)" type="number" value={editBank.balance} onChange={e=>setEditBank(v=>({...v,balance:e.target.value}))}/>
        <div style={{fontSize:12,color:T.subtext,marginBottom:4}}>Color</div>
        <div style={{display:"flex",flexWrap:"wrap",gap:6,marginBottom:12}}>
          {BANK_COLOR_CHOICES.map(c=><button key={c} onClick={()=>setEditBank(v=>({...v,color:c}))} style={{width:28,height:28,borderRadius:8,background:c,border:editBank.color===c?"3px solid #fff":"1px solid #00000033",cursor:"pointer"}}/>)}
        </div>
        <Btn color={editBank.color} onClick={saveBankEdit} style={{width:"100%"}}>Save</Btn>
      </Modal>}
    </div>
  );
}

// ── Investments with buckets, history, gain/loss ──
function InvestmentsSection({ investments, setInvestments }) {
  const [showAdd,setShowAdd]=useState(false);
  const [confirmDel,setConfirmDel]=useState(null);
  const [showHist,setShowHist]=useState(null);
  const [updateVal,setUpdateVal]=useState(null); // investment id
  const [newVal,setNewVal]=useState("");
  const [form,setForm]=useState({name:"",bucket:"Stocks",currency:"USD",cost:"",value:"",notes:""});

  const add=()=>{
    if(!form.name)return;
    const v=parseFloat(form.value)||0;
    setInvestments(i=>[...i,{id:Date.now(),name:form.name,bucket:form.bucket,currency:form.currency,cost:parseFloat(form.cost)||0,value:v,notes:form.notes,history:[{value:v,date:new Date().toISOString()}]}]);
    setForm({name:"",bucket:"Stocks",currency:"USD",cost:"",value:"",notes:""});setShowAdd(false);
  };
  const del=id=>{setInvestments(i=>i.filter(x=>x.id!==id));setConfirmDel(null);};
  const recordValue=id=>{
    const v=parseFloat(newVal);if(isNaN(v))return;
    setInvestments(invs=>invs.map(x=>x.id!==id?x:{...x,value:v,history:[...(x.history||[]),{value:v,date:new Date().toISOString()}]}));
    setNewVal("");setUpdateVal(null);
  };

  const grouped=investments.reduce((acc,inv)=>{(acc[inv.bucket||"Other"]=acc[inv.bucket||"Other"]||[]).push(inv);return acc;},{});
  const histInv=investments.find(i=>i.id===showHist);

  const gainOf=inv=>{const g=inv.value-(inv.cost||0);const pct=inv.cost?((g/inv.cost)*100):0;return {g,pct};};
  const athatl=inv=>{const vals=(inv.history||[]).map(h=>h.value);if(!vals.length)return{ath:inv.value,atl:inv.value};return{ath:Math.max(...vals),atl:Math.min(...vals)};};

  return (
    <div>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16}}>
        <span style={{fontSize:18,fontWeight:700,color:T.text}}>Investments</span>
        <Btn color="#8B5CF6" onClick={()=>setShowAdd(true)}>+ Add</Btn>
      </div>
      {investments.length===0&&<div style={{color:T.faint,textAlign:"center",padding:32}}>No investments yet.</div>}

      {Object.entries(grouped).map(([bucket,items])=>(
        <div key={bucket} style={{marginBottom:20}}>
          <div style={{fontSize:13,fontWeight:600,color:"#8B5CF6",marginBottom:8}}>{bucket}</div>
          <div style={{display:"flex",flexDirection:"column",gap:10}}>
            {items.map(inv=>{
              const {g,pct}=gainOf(inv);
              const up=g>=0;
              return (
                <div key={inv.id} style={{background:T.card,borderRadius:10,padding:14,border:`1px solid ${T.border}`}}>
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start"}}>
                    <div style={{flex:1}}>
                      <div style={{fontWeight:600,color:T.text}}>{inv.name} <span style={{fontSize:11,color:T.faint}}>· {inv.currency}</span></div>
                      {inv.notes&&<div style={{fontSize:12,color:T.subtext}}>{inv.notes}</div>}
                      <div style={{display:"flex",gap:12,marginTop:6,fontSize:12,flexWrap:"wrap"}}>
                        <span style={{color:T.subtext}}>Cost: {sym(inv.currency)}{fmtNum(inv.cost)}</span>
                        <span style={{color:T.text}}>Value: {sym(inv.currency)}{fmtNum(inv.value)}</span>
                        <span style={{color:up?"#10B981":"#ef4444",fontWeight:600}}>{up?"▲":"▼"} {sym(inv.currency)}{fmtNum(Math.abs(g))} ({up?"+":""}{pct.toFixed(1)}%)</span>
                      </div>
                      {(()=>{const{ath,atl}=athatl(inv);return <div style={{fontSize:11,color:T.faint,marginTop:4}}>ATH {sym(inv.currency)}{fmtNum(ath)} · ATL {sym(inv.currency)}{fmtNum(atl)}</div>;})()}
                    </div>
                    <div style={{display:"flex",flexDirection:"column",gap:4,alignItems:"flex-end"}}>
                      <Btn small color="#8B5CF6" onClick={()=>{setUpdateVal(inv.id);setNewVal(String(inv.value));}}>Update</Btn>
                      <Btn small outline color={T.subtext} onClick={()=>setShowHist(inv.id)}>History</Btn>
                      <Btn small outline color="#ef4444" onClick={()=>setConfirmDel({id:inv.id,name:inv.name})}>🗑</Btn>
                    </div>
                  </div>
                  {updateVal===inv.id&&<div style={{display:"flex",gap:8,marginTop:10}}>
                    <input type="number" value={newVal} onChange={e=>setNewVal(e.target.value)} placeholder="New market value" style={{flex:1,background:T.input,border:`1px solid ${T.border}`,borderRadius:8,padding:"6px 10px",color:T.text,fontSize:13}}/>
                    <Btn small color="#10B981" onClick={()=>recordValue(inv.id)}>Save</Btn>
                    <Btn small outline color={T.subtext} onClick={()=>setUpdateVal(null)}>×</Btn>
                  </div>}
                </div>
              );
            })}
          </div>
        </div>
      ))}

      {confirmDel&&<ConfirmModal message={`Delete "${confirmDel.name}"?`} requireDel onConfirm={()=>del(confirmDel.id)} onClose={()=>setConfirmDel(null)}/>}

      {showHist&&<Modal title={`${histInv?.name} · Value History`} onClose={()=>setShowHist(null)}>
        {(!histInv?.history||histInv.history.length===0)&&<div style={{color:T.faint,textAlign:"center",padding:16}}>No history yet.</div>}
        <div style={{display:"flex",flexDirection:"column",gap:6,maxHeight:320,overflowY:"auto"}}>
          {[...(histInv?.history||[])].reverse().map((h,i)=>(
            <div key={i} style={{display:"flex",justifyContent:"space-between",background:T.card2,borderRadius:8,padding:"8px 12px",fontSize:13}}>
              <span style={{color:T.subtext}}>{new Date(h.date).toLocaleString()}</span>
              <span style={{color:T.text,fontWeight:600}}>{sym(histInv.currency)}{fmtNum(h.value)}</span>
            </div>
          ))}
        </div>
      </Modal>}

      {showAdd&&<Modal title="Add Investment" onClose={()=>setShowAdd(false)}>
        <Inp label="Name" value={form.name} onChange={e=>setForm(f=>({...f,name:e.target.value}))} placeholder="e.g. BTC, MSFT, Rolex Sub"/>
        <Sel label="Bucket" value={form.bucket} onChange={e=>setForm(f=>({...f,bucket:e.target.value}))}>
          {INVESTMENT_BUCKETS.map(b=><option key={b} value={b}>{b}</option>)}
        </Sel>
        <Sel label="Currency" value={form.currency} onChange={e=>setForm(f=>({...f,currency:e.target.value}))}>
          {CURRENCY_LIST.map(c=><option key={c} value={c}>{c} — {CURRENCY_SYMBOLS[c]}</option>)}
        </Sel>
        <Inp label="Amount Invested (cost)" type="number" value={form.cost} onChange={e=>setForm(f=>({...f,cost:e.target.value}))} placeholder="0.00"/>
        <Inp label="Current Market Value" type="number" value={form.value} onChange={e=>setForm(f=>({...f,value:e.target.value}))} placeholder="0.00"/>
        <Inp label="Notes (optional)" value={form.notes} onChange={e=>setForm(f=>({...f,notes:e.target.value}))} placeholder="e.g. held on Binance"/>
        <Btn color="#8B5CF6" onClick={add} style={{width:"100%"}}>Add Investment</Btn>
      </Modal>}
    </div>
  );
}

// ── Analytics ──
function PieChart({ data }) {
  const total=data.reduce((s,d)=>s+d.value,0);
  if(!total) return <div style={{color:T.faint,textAlign:"center",padding:24}}>No expense data.</div>;
  let angle=0;
  const slices=data.map((d,i)=>{const pct=d.value/total;const start=angle;angle+=pct*360;return{...d,start,end:angle,pct,color:COLORS_LIST[i%COLORS_LIST.length]};});
  const xy=(deg,r)=>[50+r*Math.cos((deg-90)*Math.PI/180),50+r*Math.sin((deg-90)*Math.PI/180)];
  const arc=(s,e,r)=>{if(e-s>=360)e=359.99;const[x1,y1]=xy(s,r);const[x2,y2]=xy(e,r);const l=e-s>180?1:0;return `M 50 50 L ${x1} ${y1} A ${r} ${r} 0 ${l} 1 ${x2} ${y2} Z`;};
  return (
    <div style={{display:"flex",gap:24,alignItems:"center",flexWrap:"wrap"}}>
      <svg viewBox="0 0 100 100" style={{width:160,height:160,flexShrink:0}}>
        {slices.map((s,i)=><path key={i} d={arc(s.start,s.end,45)} fill={s.color} stroke={T.bg} strokeWidth="0.5"/>)}
        <circle cx="50" cy="50" r="25" fill={T.bg}/>
      </svg>
      <div style={{display:"flex",flexDirection:"column",gap:6,flex:1}}>
        {slices.map((s,i)=>(
          <div key={i} style={{display:"flex",justifyContent:"space-between",alignItems:"center",gap:12}}>
            <div style={{display:"flex",alignItems:"center",gap:6}}><div style={{width:10,height:10,borderRadius:2,background:s.color}}/><span style={{fontSize:13,color:T.text}}>{s.label}</span></div>
            <div><span style={{fontSize:13,color:s.color,fontWeight:600}}>{Math.round(s.pct*100)}%</span><span style={{fontSize:11,color:T.faint,marginLeft:6}}>{s.currencySym}{fmtNum(s.value)}</span></div>
          </div>
        ))}
      </div>
    </div>
  );
}

function BarChart({ data }) {
  if(!data.length) return <div style={{color:T.faint,textAlign:"center",padding:24}}>No data.</div>;
  const max=Math.max(...data.map(d=>d.value),1);
  return (
    <div style={{display:"flex",alignItems:"flex-end",gap:6,height:120,marginTop:8}}>
      {data.map((d,i)=>(
        <div key={i} style={{flex:1,display:"flex",flexDirection:"column",alignItems:"center",gap:4}}>
          <div style={{fontSize:10,color:T.faint}}>{d.currencySym}{fmtNum(d.value)}</div>
          <div style={{width:"100%",background:COLORS_LIST[i%COLORS_LIST.length],borderRadius:"4px 4px 0 0",height:`${Math.max(4,(d.value/max)*80)}px`}}/>
          <div style={{fontSize:10,color:T.faint,whiteSpace:"nowrap"}}>{d.label}</div>
        </div>
      ))}
    </div>
  );
}

function AnalyticsSection({ banks }) {
  const today=new Date();
  const firstOfMonth=new Date(today.getFullYear(),today.getMonth(),1).toISOString().slice(0,10);
  const [from,setFrom]=useState(firstOfMonth);
  const [to,setTo]=useState(today.toISOString().slice(0,10));
  const [filterCurrency,setFilterCurrency]=useState("all");

  const currencies=[...new Set(banks.map(b=>b.currency))];
  const effectiveCurrency = filterCurrency==="all" ? (currencies[0]||"") : filterCurrency;

  const allTx=banks.flatMap(b=>b.envelopes.flatMap(e=>e.transactions.map(t=>({...t,currency:b.currency}))))
    .filter(t=>(filterCurrency==="all"||t.currency===filterCurrency)&&t.date>=from&&t.date<=to);

  const income=allTx.filter(t=>t.type==="income").reduce((s,t)=>s+t.amount,0);
  const expense=allTx.filter(t=>t.type==="expense").reduce((s,t)=>s+t.amount,0);

  const tagTotals={};
  allTx.filter(t=>t.type==="expense").forEach(t=>{const k=t.tag||"Untagged";tagTotals[k]=(tagTotals[k]||0)+t.amount;});
  const pieData=Object.entries(tagTotals).map(([label,value])=>({label,value,currencySym:sym(effectiveCurrency)}));

  const monthTotals={};
  allTx.filter(t=>t.type==="expense").forEach(t=>{const k=t.date?.slice(0,7)||"?";monthTotals[k]=(monthTotals[k]||0)+t.amount;});
  const barData=Object.entries(monthTotals).sort(([a],[b])=>a.localeCompare(b)).slice(-6).map(([label,value])=>({label:label.slice(5),value,currencySym:sym(effectiveCurrency)}));

  return (
    <div>
      <div style={{display:"flex",gap:8,marginBottom:16,flexWrap:"wrap",alignItems:"flex-end"}}>
        <div><div style={{fontSize:11,color:T.subtext,marginBottom:4}}>From</div><input type="date" value={from} onChange={e=>setFrom(e.target.value)} style={{background:T.card,border:`1px solid ${T.border}`,borderRadius:8,padding:"6px 10px",color:T.text,fontSize:13}}/></div>
        <div><div style={{fontSize:11,color:T.subtext,marginBottom:4}}>To</div><input type="date" value={to} onChange={e=>setTo(e.target.value)} style={{background:T.card,border:`1px solid ${T.border}`,borderRadius:8,padding:"6px 10px",color:T.text,fontSize:13}}/></div>
        <select value={filterCurrency} onChange={e=>setFilterCurrency(e.target.value)} style={{background:T.card,border:`1px solid ${T.border}`,borderRadius:8,padding:"6px 10px",color:T.text,fontSize:13}}>
          <option value="all">First currency</option>
          {currencies.map(c=><option key={c} value={c}>{c}</option>)}
        </select>
      </div>

      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12,marginBottom:16}}>
        <div style={{background:T.card,borderRadius:12,padding:16,border:"1px solid #10B98133"}}>
          <div style={{fontSize:12,color:T.subtext}}>Income</div>
          <div style={{fontSize:22,fontWeight:700,color:"#10B981"}}>{sym(effectiveCurrency)}{fmtNum(income)}</div>
        </div>
        <div style={{background:T.card,borderRadius:12,padding:16,border:"1px solid #ef444433"}}>
          <div style={{fontSize:12,color:T.subtext}}>Expense</div>
          <div style={{fontSize:22,fontWeight:700,color:"#ef4444"}}>{sym(effectiveCurrency)}{fmtNum(expense)}</div>
        </div>
      </div>
      <div style={{background:T.card,borderRadius:12,padding:16,marginBottom:8,textAlign:"center"}}>
        <span style={{fontSize:12,color:T.subtext}}>Net: </span>
        <span style={{fontSize:16,fontWeight:700,color:income-expense>=0?"#10B981":"#ef4444"}}>{sym(effectiveCurrency)}{fmtNum(income-expense)}</span>
      </div>

      <div style={{background:T.card,borderRadius:12,padding:16,marginBottom:16}}>
        <div style={{fontSize:13,fontWeight:600,color:T.text,marginBottom:12}}>💸 Spending by Tag</div>
        <PieChart data={pieData}/>
      </div>
      <div style={{background:T.card,borderRadius:12,padding:16}}>
        <div style={{fontSize:13,fontWeight:600,color:T.text,marginBottom:4}}>📅 Monthly Spending</div>
        <BarChart data={barData}/>
      </div>
    </div>
  );
}

// ── Sticky Notes ──
function NotesSection({ notes, setNotes }) {
  const add=()=>setNotes(n=>[{id:Date.now(),text:""},...n]);
  const update=(id,text)=>setNotes(n=>n.map(x=>x.id===id?{...x,text}:x));
  const del=id=>setNotes(n=>n.filter(x=>x.id!==id));
  return (
    <div>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16}}>
        <span style={{fontSize:13,color:T.subtext}}>Sticky notes — auto-saved</span>
        <Btn color="#10B981" onClick={add}>+ New Note</Btn>
      </div>
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(200px,1fr))",gap:12}}>
        {notes.map(note=>(
          <div key={note.id} style={{background:"#FEF3C7",borderRadius:8,padding:12,minHeight:140,boxShadow:"0 2px 8px rgba(0,0,0,0.2)",display:"flex",flexDirection:"column"}}>
            <textarea value={note.text} onChange={e=>update(note.id,e.target.value)} placeholder="Write something..." style={{flex:1,background:"transparent",border:"none",resize:"none",outline:"none",color:"#451a03",fontSize:14,lineHeight:1.5,fontFamily:"system-ui"}}/>
            <button onClick={()=>del(note.id)} style={{alignSelf:"flex-end",background:"none",border:"none",color:"#b45309",cursor:"pointer",fontSize:13,marginTop:4}}>🗑</button>
          </div>
        ))}
        {notes.length===0&&<div style={{color:T.faint,gridColumn:"1/-1",textAlign:"center",padding:32}}>No notes yet — add one!</div>}
      </div>
    </div>
  );
}

// ── Tags Manager (with in-use warning) ──
function TagsManager({ tags, setTags, banks }) {
  const [newTag,setNewTag]=useState("");
  const [confirmDel,setConfirmDel]=useState(null);
  const tagUsage=tag=>banks.reduce((c,b)=>c+b.envelopes.reduce((c2,e)=>c2+e.transactions.filter(t=>t.tag===tag).length,0),0);
  const add=()=>{if(!newTag.trim()||tags.includes(newTag.trim()))return;setTags(t=>[...t,newTag.trim()]);setNewTag("");};
  const reqDel=tag=>{const u=tagUsage(tag);if(u>0)setConfirmDel({tag,count:u});else setTags(t=>t.filter(x=>x!==tag));};
  const del=tag=>{setTags(t=>t.filter(x=>x!==tag));setConfirmDel(null);};
  return (
    <div style={{background:T.card,borderRadius:12,padding:16,marginBottom:20}}>
      <div style={{fontSize:13,fontWeight:600,color:T.text,marginBottom:10}}>🏷️ Manage Tags</div>
      <div style={{display:"flex",gap:8,marginBottom:10}}>
        <input value={newTag} onChange={e=>setNewTag(e.target.value)} onKeyDown={e=>e.key==="Enter"&&add()} placeholder="New tag..." style={{flex:1,background:T.input,border:`1px solid ${T.border}`,borderRadius:8,padding:"6px 10px",color:T.text,fontSize:13}}/>
        <Btn small color="#3B82F6" onClick={add}>Add</Btn>
      </div>
      <div style={{display:"flex",flexWrap:"wrap",gap:6}}>
        {tags.map((t,i)=>(
          <div key={t} style={{background:`${COLORS_LIST[i%COLORS_LIST.length]}22`,border:`1px solid ${COLORS_LIST[i%COLORS_LIST.length]}44`,borderRadius:6,padding:"3px 10px",fontSize:12,color:COLORS_LIST[i%COLORS_LIST.length],display:"flex",alignItems:"center",gap:6}}>
            {t}<button onClick={()=>reqDel(t)} style={{background:"none",border:"none",color:"#ef4444",cursor:"pointer",fontSize:12,padding:0}}>×</button>
          </div>
        ))}
        {tags.length===0&&<span style={{fontSize:12,color:T.faint}}>No tags yet</span>}
      </div>
      {confirmDel&&<ConfirmModal message={`Tag "${confirmDel.tag}" is used by ${confirmDel.count} transaction${confirmDel.count!==1?"s":""}.`} detail="Deleting it won't remove those transactions, but they'll lose this tag label. Continue?" confirmLabel="Delete Tag" onConfirm={()=>del(confirmDel.tag)} onClose={()=>setConfirmDel(null)}/>}
    </div>
  );
}

// ── Custom Total Selector ──
function CustomTotal({ banks, investments }) {
  const [selected,setSelected]=useState({});
  const [target,setTarget]=useState("USD");
  const toggle=key=>setSelected(s=>({...s,[key]:!s[key]}));

  const items=[];
  banks.forEach(b=>{
    b.envelopes.forEach(e=>{
      const key=`env_${b.id}_${e.id}`;
      if(selected[key])items.push({amount:e.balance,currency:b.currency});
    });
    const bkey=`bank_${b.id}`;
    if(selected[bkey])items.push({amount:bankTotal(b),currency:b.currency});
  });
  investments.forEach(inv=>{const k=`inv_${inv.id}`;if(selected[k])items.push({amount:inv.value,currency:inv.currency});});

  const total=useMultiConvert(items,target);

  return (
    <div style={{background:T.card,borderRadius:12,padding:16,marginBottom:20}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}>
        <div style={{fontSize:13,fontWeight:600,color:T.text}}>🧮 Custom Total</div>
        <select value={target} onChange={e=>setTarget(e.target.value)} style={{background:T.input,border:`1px solid ${T.border}`,borderRadius:6,padding:"3px 8px",color:T.text,fontSize:12}}>
          {CURRENCY_LIST.map(c=><option key={c} value={c}>{c}</option>)}
        </select>
      </div>
      <div style={{maxHeight:200,overflowY:"auto",marginBottom:12}}>
        {banks.map(b=>(
          <div key={b.id} style={{marginBottom:6}}>
            <label style={{display:"flex",alignItems:"center",gap:6,fontSize:13,color:T.text,cursor:"pointer"}}>
              <input type="checkbox" checked={!!selected[`bank_${b.id}`]} onChange={()=>toggle(`bank_${b.id}`)}/>
              <strong>{b.name}</strong> <span style={{color:T.faint}}>({sym(b.currency)}{fmtNum(bankTotal(b))})</span>
            </label>
            <div style={{paddingLeft:20}}>
              {b.envelopes.map(e=>(
                <label key={e.id} style={{display:"flex",alignItems:"center",gap:6,fontSize:12,color:T.subtext,cursor:"pointer"}}>
                  <input type="checkbox" checked={!!selected[`env_${b.id}_${e.id}`]} onChange={()=>toggle(`env_${b.id}_${e.id}`)}/>
                  {e.isUnalloc?"📂":(e.emoji||"🗂️")} {e.name} <span style={{color:T.faint}}>({sym(b.currency)}{fmtNum(e.balance)})</span>
                </label>
              ))}
            </div>
          </div>
        ))}
        {investments.length>0&&<div style={{marginTop:8}}>
          <div style={{fontSize:11,color:T.faint,marginBottom:4}}>Investments</div>
          {investments.map(inv=>(
            <label key={inv.id} style={{display:"flex",alignItems:"center",gap:6,fontSize:12,color:T.subtext,cursor:"pointer"}}>
              <input type="checkbox" checked={!!selected[`inv_${inv.id}`]} onChange={()=>toggle(`inv_${inv.id}`)}/>
              {inv.name} <span style={{color:T.faint}}>({sym(inv.currency)}{fmtNum(inv.value)})</span>
            </label>
          ))}
        </div>}
      </div>
      <div style={{borderTop:`1px solid ${T.border}`,paddingTop:10,textAlign:"right"}}>
        <span style={{fontSize:12,color:T.subtext}}>Total: </span>
        <span style={{fontSize:18,fontWeight:700,color:"#10B981"}}>{total===null?"…":`${sym(target)}${fmtNum(total)}`}</span>
      </div>
    </div>
  );
}

// ── Universal Total ──
function UniversalTotal({ banks, investments }) {
  const [target,setTarget]=useState("USD");
  const items=[
    ...banks.map(b=>({amount:bankTotal(b),currency:b.currency})),
    ...investments.map(i=>({amount:i.value,currency:i.currency}))
  ];
  const total=useMultiConvert(items,target);
  return (
    <div style={{background:`linear-gradient(135deg,#3B82F6,#8B5CF6)`,borderRadius:14,padding:20,marginBottom:20,color:"#fff"}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
        <div>
          <div style={{fontSize:13,opacity:0.85}}>Total Net Worth</div>
          <div style={{fontSize:30,fontWeight:800,marginTop:4}}>{total===null?"…":`${sym(target)}${fmtNum(total)}`}</div>
        </div>
        <select value={target} onChange={e=>setTarget(e.target.value)} style={{background:"rgba(255,255,255,0.2)",border:"1px solid rgba(255,255,255,0.3)",borderRadius:8,padding:"6px 10px",color:"#fff",fontSize:14}}>
          {CURRENCY_LIST.map(c=><option key={c} value={c} style={{color:"#000"}}>{c}</option>)}
        </select>
      </div>
    </div>
  );
}

function Dashboard({ banks, investments }) {
  const byCurrency=banks.reduce((acc,b)=>{acc[b.currency]=(acc[b.currency]||0)+bankTotal(b);return acc;},{});
  const investByBucket=investments.reduce((acc,i)=>{(acc[i.bucket||"Other"]=acc[i.bucket||"Other"]||[]).push(i);return acc;},{});
  return (
    <div>
      <UniversalTotal banks={banks} investments={investments}/>
      <CustomTotal banks={banks} investments={investments}/>
      <div style={{fontSize:13,color:T.subtext,marginBottom:12}}>Accounts overview</div>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12,marginBottom:24}}>
        {Object.entries(byCurrency).map(([currency,total])=>(
          <div key={currency} style={{background:T.card,borderRadius:12,padding:18,border:`1px solid ${getCurrencyColor(currency)}33`}}>
            <div style={{fontSize:12,color:T.subtext,marginBottom:4}}>{currency} Banks</div>
            <div style={{fontSize:20,fontWeight:700,color:getCurrencyColor(currency)}}>{sym(currency)}{fmtNum(total)}</div>
            <div style={{fontSize:12,color:T.faint,marginTop:2}}>{banks.filter(b=>b.currency===currency).length} accounts</div>
          </div>
        ))}
        <div style={{background:T.card,borderRadius:12,padding:18,border:"1px solid #8B5CF633"}}>
          <div style={{fontSize:12,color:T.subtext,marginBottom:4}}>Investments</div>
          <div style={{fontSize:20,fontWeight:700,color:"#8B5CF6"}}>{investments.length}</div>
          <div style={{fontSize:12,color:T.faint,marginTop:2}}>{Object.keys(investByBucket).length} buckets</div>
        </div>
      </div>

      {Object.entries(banks.reduce((acc,b)=>{(acc[b.currency]=acc[b.currency]||[]).push(b);return acc;},{})).map(([currency,cBanks])=>(
        <div key={currency} style={{marginBottom:20}}>
          <div style={{fontSize:13,fontWeight:600,color:getCurrencyColor(currency),marginBottom:8}}>{currency} Accounts</div>
          {cBanks.map(b=>(
            <div key={b.id} style={{marginBottom:8}}>
              <div style={{display:"flex",justifyContent:"space-between",padding:"6px 0",borderBottom:`1px solid ${T.border}`,fontSize:14,color:T.text,fontWeight:600}}>
                <span>{b.name}</span><span style={{color:bankColor(b)}}>{sym(currency)}{fmtNum(bankTotal(b))}</span>
              </div>
              {(b.envelopes||[]).map(e=>(
                <div key={e.id} style={{display:"flex",justifyContent:"space-between",padding:"4px 0 4px 14px",fontSize:12,color:e.isUnalloc?T.faint:T.subtext,fontStyle:e.isUnalloc?"italic":"normal"}}>
                  <span>{e.isUnalloc?"📂":(e.emoji||"🗂️")} {e.name}{e.goal?` (${Math.min(100,Math.round((e.balance/e.goal)*100))}%)`:""}</span>
                  <span style={{color:e.isUnalloc?T.faint:bankColor(b)}}>{sym(currency)}{fmtNum(e.balance)}</span>
                </div>
              ))}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

// ── Backup ──
function BackupBar({ getData, onImport }) {
  const fileRef=useRef(null);
  const exportData=()=>{
    const blob=new Blob([JSON.stringify(getData(),null,2)],{type:"application/json"});
    const url=URL.createObjectURL(blob);const a=document.createElement("a");
    a.href=url;a.download=`finance-backup-${new Date().toISOString().slice(0,10)}.json`;a.click();
    URL.revokeObjectURL(url);
  };
  const importData=e=>{
    const file=e.target.files?.[0];if(!file)return;
    const reader=new FileReader();
    reader.onload=ev=>{try{const p=JSON.parse(ev.target.result);if(!confirm("Replace current data with backup?"))return;onImport(p);}catch{alert("Invalid file.");}};
    reader.readAsText(file);e.target.value="";
  };
  return (
    <div style={{display:"flex",gap:8,marginBottom:16}}>
      <Btn small outline color="#10B981" onClick={exportData}>⬇ Backup</Btn>
      <Btn small outline color="#3B82F6" onClick={()=>fileRef.current?.click()}>⬆ Restore</Btn>
      <input ref={fileRef} type="file" accept="application/json" onChange={importData} style={{display:"none"}}/>
    </div>
  );
}

export default function FinanceTracker({ userId, userEmail, onSignOut }) {
  const [tab,setTab]=useState(0);
  const [theme,setTheme]=useState("dark");
  T = THEMES[theme];

  const [banks,setBanks,undoBanks,redoBanks,canUndo,canRedo]=useUndoable([]);
  const [investments,setInvestments]=useState([]);
  const [tags,setTags]=useState(["Food","Transport","Rent","Entertainment","Health","Shopping","Utilities","Salary"]);
  const [notes,setNotes]=useState([]);
  const [syncStatus,setSyncStatus]=useState("loading");
  const saveTimerRef=useRef(null);
  const initialLoadDone=useRef(false);

  useEffect(()=>{
    (async()=>{
      setSyncStatus("loading");
      const data=await loadData(userId);
      if(data){
        // banks
        if(data.banks)setBanks(data.banks);
        else if(data.phpBanks||data.sgdBanks){
          setBanks([...(data.phpBanks||[]).map(b=>({...b,currency:"PHP"})),...(data.sgdBanks||[]).map(b=>({...b,currency:"SGD"}))]);
        }
        // investments + fold crypto
        let inv=[];
        if(data.investments)inv=data.investments.map(i=>({bucket:i.bucket||"Stocks",currency:i.currency||"USD",cost:i.cost||0,value:parseFloat(i.value)||0,history:i.history||[{value:parseFloat(i.value)||0,date:new Date().toISOString()}],...i}));
        if(data.crypto)inv=[...inv,...data.crypto.map(c=>({id:c.id||Date.now()+Math.random(),name:c.coin,bucket:"Crypto",currency:c.currency||"USD",cost:0,value:parseFloat(c.value)||0,notes:c.notes||`${c.amount} tokens`,history:[{value:parseFloat(c.value)||0,date:new Date().toISOString()}]}))];
        setInvestments(inv);
        if(data.tags)setTags(data.tags);
        // notes migration: string -> sticky array
        if(Array.isArray(data.notes))setNotes(data.notes);
        else if(typeof data.notes==="string"&&data.notes.trim())setNotes([{id:Date.now(),text:data.notes}]);
        if(data.theme)setTheme(data.theme);
      }
      setSyncStatus("saved");
      initialLoadDone.current=true;
    })();
  // eslint-disable-next-line
  },[userId]);

  useEffect(()=>{
    if(!initialLoadDone.current)return;
    setSyncStatus("saving");
    if(saveTimerRef.current)clearTimeout(saveTimerRef.current);
    saveTimerRef.current=setTimeout(async()=>{
      await saveData(userId,{banks,investments,tags,notes,theme});
      setSyncStatus("saved");
    },2000);
    return()=>clearTimeout(saveTimerRef.current);
  },[banks,investments,tags,notes,theme,userId]);

  const importBackup=p=>{
    if(p.banks)setBanks(p.banks);
    if(p.investments)setInvestments(p.investments);
    if(p.tags)setTags(p.tags);
    if(Array.isArray(p.notes))setNotes(p.notes);
    else if(typeof p.notes==="string")setNotes([{id:Date.now(),text:p.notes}]);
    if(p.theme)setTheme(p.theme);
  };

  const undoProps={undo:undoBanks,redo:redoBanks,canUndo,canRedo};
  const TAB_COLORS=["#3B82F6","#3B82F6","#8B5CF6","#06B6D4","#10B981"];

  return (
    <div style={{minHeight:"100vh",background:T.bg,color:T.text,fontFamily:"system-ui,sans-serif",transition:"background 0.2s"}}>
      <div style={{maxWidth:680,margin:"0 auto",padding:"0 16px 40px"}}>
        <div style={{padding:"20px 0 12px",borderBottom:`1px solid ${T.border}`,marginBottom:16,display:"flex",justifyContent:"space-between",alignItems:"flex-end"}}>
          <div>
            <div style={{fontSize:22,fontWeight:700}}>💰 Finance Tracker</div>
            <div style={{fontSize:13,color:T.faint}}>{userEmail}</div>
          </div>
          <div style={{display:"flex",alignItems:"center",gap:8}}>
            <button onClick={()=>setTheme(t=>t==="dark"?"light":"dark")} title="Toggle theme" style={{background:T.card,border:`1px solid ${T.border}`,borderRadius:8,padding:"5px 10px",cursor:"pointer",fontSize:14}}>{theme==="dark"?"☀️":"🌙"}</button>
            <SyncBar status={syncStatus}/>
            <button onClick={onSignOut} style={{background:"transparent",border:`1px solid ${T.border}`,color:T.subtext,borderRadius:8,padding:"5px 12px",cursor:"pointer",fontSize:12}}>Sign out</button>
          </div>
        </div>

        <BackupBar getData={()=>({banks,investments,tags,notes,theme})} onImport={importBackup}/>
        <TagsManager tags={tags} setTags={setTags} banks={banks}/>

        <div style={{display:"flex",gap:6,overflowX:"auto",marginBottom:24,paddingBottom:4}}>
          {TABS.map((t,i)=>(
            <button key={t} onClick={()=>setTab(i)} style={{background:tab===i?TAB_COLORS[i]:T.card,color:tab===i?"#fff":T.subtext,border:"none",borderRadius:8,padding:"7px 14px",cursor:"pointer",fontSize:13,fontWeight:500,whiteSpace:"nowrap"}}>{t}</button>
          ))}
        </div>

        {tab===0&&<Dashboard banks={banks} investments={investments}/>}
        {tab===1&&<BanksSection banks={banks} setBanks={setBanks} tags={tags} undoProps={undoProps}/>}
        {tab===2&&<InvestmentsSection investments={investments} setInvestments={setInvestments}/>}
        {tab===3&&<AnalyticsSection banks={banks}/>}
        {tab===4&&<NotesSection notes={notes} setNotes={setNotes}/>}
      </div>
    </div>
  );
}
