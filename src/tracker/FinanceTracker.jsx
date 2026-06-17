import { useState, useEffect, useRef, useCallback } from "react";
import { loadData, saveData } from "../db";

const TABS = ["Dashboard", "Banks", "Crypto", "Investments", "Analytics", "Notes"];
const COLORS_LIST = ["#3B82F6","#10B981","#F59E0B","#8B5CF6","#EC4899","#06B6D4","#F97316","#84CC16"];
const AI_COLOR = "#EC4899";
const UNALLOC_ID = "__unallocated__";
const MAX_HISTORY = 50;

const CURRENCY_SYMBOLS = { PHP:"₱", SGD:"S$", USD:"$", KRW:"₩", JPY:"¥", EUR:"€", GBP:"£", AUD:"A$", HKD:"HK$", MYR:"RM", IDR:"Rp", THB:"฿" };
const CURRENCY_LIST = Object.keys(CURRENCY_SYMBOLS);

function getCurrencyColor(currency) {
  const idx = CURRENCY_LIST.indexOf(currency) % COLORS_LIST.length;
  return COLORS_LIST[Math.max(0,idx)];
}
function sym(currency) { return CURRENCY_SYMBOLS[currency] || currency+" "; }
const fmt = (n, currency="") => `${sym(currency)}${Number(n||0).toLocaleString("en-US",{minimumFractionDigits:2,maximumFractionDigits:2})}`;
const fmtNum = n => Number(n||0).toLocaleString("en-US",{minimumFractionDigits:2,maximumFractionDigits:2});

function useUndoable(init) {
  const [history, setHistory] = useState([init]);
  const [idx, setIdx] = useState(0);
  const val = history[idx];
  const set = useCallback((fn) => {
    setHistory(h => {
      const next = typeof fn === "function" ? fn(h[idx]) : fn;
      return [...h.slice(0, idx+1), next].slice(-MAX_HISTORY);
    });
    setIdx(i => Math.min(i+1, MAX_HISTORY-1));
  }, [idx]);
  const undo = useCallback(() => setIdx(i => Math.max(0,i-1)), []);
  const redo = useCallback(() => setIdx(i => Math.min(history.length-1,i+1)), [history.length]);
  return [val, set, undo, redo, idx>0, idx<history.length-1];
}

function Modal({ title, onClose, children }) {
  return (
    <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.6)",zIndex:100,display:"flex",alignItems:"center",justifyContent:"center"}}>
      <div style={{background:"#1e2130",borderRadius:12,padding:24,minWidth:340,maxWidth:480,width:"90%",maxHeight:"85vh",overflowY:"auto"}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16}}>
          <strong style={{fontSize:16,color:"#f1f5f9"}}>{title}</strong>
          <button onClick={onClose} style={{background:"none",border:"none",color:"#94a3b8",cursor:"pointer",fontSize:22,lineHeight:1}}>×</button>
        </div>
        {children}
      </div>
    </div>
  );
}

function ConfirmDelete({ name, onConfirm, onClose }) {
  const [val, setVal] = useState("");
  return (
    <Modal title="Confirm Delete" onClose={onClose}>
      <p style={{color:"#f1f5f9",fontSize:14,marginBottom:8}}>Delete <strong style={{color:"#ef4444"}}>{name}</strong>?</p>
      <p style={{color:"#94a3b8",fontSize:13,marginBottom:12}}>Type <strong style={{color:"#ef4444",letterSpacing:2}}>DEL</strong> to confirm.</p>
      <input value={val} onChange={e=>setVal(e.target.value)} placeholder="Type DEL here" autoFocus
        style={{width:"100%",background:"#0f1117",border:`1px solid ${val==="DEL"?"#ef4444":"#334155"}`,borderRadius:8,padding:"8px 10px",color:"#f1f5f9",fontSize:14,boxSizing:"border-box",marginBottom:12,letterSpacing:2}}/>
      <div style={{display:"flex",gap:8}}>
        <button onClick={onClose} style={{flex:1,background:"transparent",border:"1px solid #334155",color:"#94a3b8",borderRadius:8,padding:"8px",cursor:"pointer",fontSize:14}}>Cancel</button>
        <button onClick={()=>val==="DEL"&&onConfirm()} disabled={val!=="DEL"} style={{flex:1,background:val==="DEL"?"#ef4444":"#2d1f1f",border:"1px solid #ef4444",color:val==="DEL"?"#fff":"#7f3f3f",borderRadius:8,padding:"8px",cursor:val==="DEL"?"pointer":"not-allowed",fontSize:14,fontWeight:600}}>Delete</button>
      </div>
    </Modal>
  );
}

function Inp({ label, ...p }) {
  return (
    <div style={{marginBottom:12}}>
      {label && <div style={{fontSize:12,color:"#94a3b8",marginBottom:4}}>{label}</div>}
      <input {...p} style={{width:"100%",background:"#0f1117",border:"1px solid #334155",borderRadius:8,padding:"8px 10px",color:"#f1f5f9",fontSize:14,boxSizing:"border-box",...p.style}}/>
    </div>
  );
}

function Sel({ label, children, ...p }) {
  return (
    <div style={{marginBottom:12}}>
      {label && <div style={{fontSize:12,color:"#94a3b8",marginBottom:4}}>{label}</div>}
      <select {...p} style={{width:"100%",background:"#0f1117",border:"1px solid #334155",borderRadius:8,padding:"8px 10px",color:"#f1f5f9",fontSize:14,...p.style}}>{children}</select>
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
      <button onClick={undo} disabled={!canUndo} style={{background:canUndo?"#1e2130":"#0f1117",border:"1px solid #334155",color:canUndo?"#f1f5f9":"#334155",borderRadius:8,padding:"5px 12px",cursor:canUndo?"pointer":"not-allowed",fontSize:13}}>↩ Undo</button>
      <button onClick={redo} disabled={!canRedo} style={{background:canRedo?"#1e2130":"#0f1117",border:"1px solid #334155",color:canRedo?"#f1f5f9":"#334155",borderRadius:8,padding:"5px 12px",cursor:canRedo?"pointer":"not-allowed",fontSize:13}}>↪ Redo</button>
    </div>
  );
}

function SyncBar({ status }) {
  const colors={idle:"#475569",saving:"#F59E0B",saved:"#10B981",error:"#ef4444",loading:"#3B82F6"};
  const icons={idle:"☁️",saving:"⏳",saved:"✓",error:"⚠️",loading:"⏳"};
  const labels={idle:"Ready",saving:"Saving…",saved:"Saved",error:"Failed",loading:"Loading…"};
  return (
    <div style={{display:"flex",alignItems:"center",gap:6,fontSize:12,color:colors[status],padding:"4px 10px",background:"#1e2130",borderRadius:8}}>
      <span>{icons[status]}</span><span>{labels[status]}</span>
    </div>
  );
}

function makeBank(name, currency, balance) {
  return { id:Date.now(), name, currency, balance, envelopes:[{id:UNALLOC_ID,name:"Unallocated",balance,transactions:[],isUnalloc:true}] };
}
function bankTotal(bank) { return (bank.envelopes||[]).reduce((s,e)=>s+e.balance,0); }

// ── Exchange Rate ──
async function fetchRate(from, to) {
  try {
    const res = await fetch(`https://api.frankfurter.app/latest?from=${from}&to=${to}`);
    const data = await res.json();
    return data.rates?.[to] || null;
  } catch { return null; }
}

function ConversionBadge({ amount, fromCurrency, toCurrency }) {
  const [rate, setRate] = useState(null);
  useEffect(() => {
    if (fromCurrency === toCurrency) return;
    fetchRate(fromCurrency, toCurrency).then(setRate);
  }, [fromCurrency, toCurrency]);
  if (!rate || fromCurrency === toCurrency) return null;
  return (
    <span style={{fontSize:11,color:"#64748b",marginLeft:8}}>≈ {sym(toCurrency)}{fmtNum(amount*rate)} {toCurrency}</span>
  );
}

function TransferModal({ bank, onClose, onTransfer }) {
  const envs = bank.envelopes||[];
  const color = getCurrencyColor(bank.currency);
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

function EnvelopeView({ bank, bankId, setBanks, tags }) {
  const color = getCurrencyColor(bank.currency);
  const currency = bank.currency;
  const [showAdd,setShowAdd]=useState(false);
  const [showTx,setShowTx]=useState(null);
  const [showHist,setShowHist]=useState(null);
  const [showTransfer,setShowTransfer]=useState(false);
  const [editGoal,setEditGoal]=useState(null);
  const [goalVal,setGoalVal]=useState("");
  const [envName,setEnvName]=useState("");
  const [envBal,setEnvBal]=useState("");
  const [envGoal,setEnvGoal]=useState("");
  const [confirmDel,setConfirmDel]=useState(null);
  const [convCurrency,setConvCurrency]=useState("");
  const [tx,setTx]=useState({type:"expense",desc:"",amount:"",tag:"",note:"",date:new Date().toISOString().slice(0,10)});
  const envelopes=bank.envelopes||[];
  const unallocEnv=envelopes.find(e=>e.id===UNALLOC_ID);
  const updateBank=fn=>setBanks(bs=>bs.map(b=>b.id!==bankId?b:fn(b)));

  const addEnvelope=()=>{
    if(!envName.trim())return;
    const amt=parseFloat(envBal)||0;
    if(unallocEnv&&amt>unallocEnv.balance+0.001){alert("Not enough in Unallocated!");return;}
    updateBank(b=>({...b,envelopes:b.envelopes.map(e=>e.id!==UNALLOC_ID?e:{...e,balance:e.balance-amt}).concat([{id:Date.now(),name:envName.trim(),balance:amt,goal:parseFloat(envGoal)||null,transactions:[]}])}));
    setEnvName("");setEnvBal("");setEnvGoal("");setShowAdd(false);
  };
  const delEnvelope=envId=>{
    updateBank(b=>{const env=b.envelopes.find(e=>e.id===envId);return{...b,envelopes:b.envelopes.filter(e=>e.id!==envId).map(e=>e.id===UNALLOC_ID?{...e,balance:e.balance+(env?.balance||0)}:e)};});
    setConfirmDel(null);
  };
  const addTx=()=>{
    if(!tx.desc||!tx.amount)return;
    const amt=parseFloat(tx.amount);const isIncome=tx.type==="income";
    const newTx={id:Date.now(),...tx,amount:amt};
    updateBank(b=>({...b,balance:b.balance+(isIncome?amt:-amt),envelopes:b.envelopes.map(e=>e.id!==showTx?e:{...e,balance:e.balance+(isIncome?amt:-amt),transactions:[newTx,...e.transactions]})}));
    setTx({type:"expense",desc:"",amount:"",tag:"",note:"",date:new Date().toISOString().slice(0,10)});setShowTx(null);
  };
  const delTx=(envId,txId)=>{
    updateBank(b=>{const env=b.envelopes.find(e=>e.id===envId);const t=env?.transactions.find(x=>x.id===txId);if(!t)return b;const delta=t.type==="income"?-t.amount:t.amount;return{...b,balance:b.balance+delta,envelopes:b.envelopes.map(e=>e.id!==envId?e:{...e,balance:e.balance+delta,transactions:e.transactions.filter(x=>x.id!==txId)})};});
  };
  const doTransfer=(fromId,toId,amt)=>updateBank(b=>({...b,envelopes:b.envelopes.map(e=>e.id===fromId?{...e,balance:e.balance-amt}:e.id===toId?{...e,balance:e.balance+amt}:e)}));
  const saveGoal=()=>{updateBank(b=>({...b,envelopes:b.envelopes.map(e=>e.id!==editGoal?e:{...e,goal:parseFloat(goalVal)||null})}));setEditGoal(null);setGoalVal("");};
  const histEnv=envelopes.find(e=>e.id===showHist);

  return (
    <div style={{marginTop:12}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
        <div style={{display:"flex",alignItems:"center",gap:8}}>
          <span style={{fontSize:13,color:"#94a3b8"}}>Envelopes</span>
          <select value={convCurrency} onChange={e=>setConvCurrency(e.target.value)} style={{background:"#0f1117",border:"1px solid #334155",borderRadius:6,padding:"2px 6px",color:"#64748b",fontSize:11}}>
            <option value="">+ Convert to</option>
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
          <div key={e.id} style={{background:"#0f1117",borderRadius:8,padding:"10px 12px",border:`1px solid ${e.isUnalloc?"#334155":color}33`,display:"flex",justifyContent:"space-between",alignItems:"center",gap:8}}>
            <div style={{display:"flex",alignItems:"center",gap:8,flex:1,minWidth:0}}>
              <span>{e.isUnalloc?"📂":"🗂️"}</span>
              <div style={{flex:1,minWidth:0}}>
                <div style={{fontSize:13,color:e.isUnalloc?"#64748b":"#cbd5e1",fontStyle:e.isUnalloc?"italic":"normal"}}>
                  {e.name}{e.goal?<span style={{fontSize:11,color:"#64748b",marginLeft:6}}>Goal: {sym(currency)}{fmtNum(e.goal)}</span>:null}
                </div>
                {e.goal&&!e.isUnalloc&&(()=>{const pct=Math.min(100,Math.round((e.balance/e.goal)*100));const rem=e.goal-e.balance;return(<div style={{marginTop:4}}><div style={{background:"#1e2130",borderRadius:99,height:5,width:"100%",overflow:"hidden"}}><div style={{width:`${pct}%`,height:"100%",background:pct>=100?"#10B981":color,borderRadius:99}}/></div><div style={{fontSize:10,color:pct>=100?"#10B981":"#64748b",marginTop:2}}>{pct}%{pct>=100?" ✓":<span style={{marginLeft:4,color:"#94a3b8"}}>· {sym(currency)}{fmtNum(rem)} remaining</span>}</div></div>);})()}
                {!e.goal&&<div style={{fontSize:11,color:"#475569"}}>{e.transactions.length} tx</div>}
              </div>
            </div>
            <div style={{display:"flex",gap:4,alignItems:"center",flexShrink:0}}>
              <div style={{textAlign:"right"}}>
                <div style={{color:e.balance<0?"#ef4444":e.isUnalloc?"#64748b":color,fontWeight:600,fontSize:13}}>{sym(currency)}{fmtNum(e.balance)}</div>
                {convCurrency&&<ConversionBadge amount={e.balance} fromCurrency={currency} toCurrency={convCurrency}/>}
              </div>
              <Btn small color={color} onClick={()=>setShowTx(e.id)}>+Tx</Btn>
              <Btn small outline color={color} onClick={()=>setShowHist(e.id)}>↗</Btn>
              {!e.isUnalloc&&<Btn small outline color="#94a3b8" onClick={()=>{setEditGoal(e.id);setGoalVal(e.goal||"");}}>🎯</Btn>}
              {!e.isUnalloc&&<Btn small outline color="#ef4444" onClick={()=>setConfirmDel({id:e.id,name:e.name})}>🗑</Btn>}
            </div>
          </div>
        ))}
      </div>

      {confirmDel&&<ConfirmDelete name={confirmDel.name} onClose={()=>setConfirmDel(null)} onConfirm={()=>delEnvelope(confirmDel.id)}/>}

      {showAdd&&<Modal title="New Envelope" onClose={()=>setShowAdd(false)}>
        <div style={{fontSize:13,color:"#94a3b8",marginBottom:12}}>Available: <strong style={{color}}>{sym(currency)}{fmtNum(unallocEnv?.balance||0)}</strong></div>
        <Inp label="Name" value={envName} onChange={e=>setEnvName(e.target.value)} placeholder="e.g. Rent, Emergency"/>
        <Inp label="Allocate Amount" type="number" value={envBal} onChange={e=>setEnvBal(e.target.value)} placeholder="0.00"/>
        <Inp label="Savings Goal (optional)" type="number" value={envGoal} onChange={e=>setEnvGoal(e.target.value)} placeholder="e.g. 10000"/>
        <Btn color={color} onClick={addEnvelope} style={{width:"100%"}}>Create Envelope</Btn>
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
        {histEnv?.transactions.length===0&&<div style={{color:"#475569",textAlign:"center",padding:16}}>No transactions yet.</div>}
        <div style={{display:"flex",flexDirection:"column",gap:8,maxHeight:360,overflowY:"auto"}}>
          {histEnv?.transactions.map(t=>(
            <div key={t.id} style={{background:"#0f1117",borderRadius:8,padding:"8px 12px"}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                <div>
                  <div style={{fontSize:13,color:"#f1f5f9"}}>{t.desc}</div>
                  <div style={{fontSize:11,color:"#64748b"}}>{t.date}{t.tag?<span style={{marginLeft:6,background:"#1e2130",borderRadius:4,padding:"1px 6px"}}>{t.tag}</span>:null}</div>
                  {t.note&&<div style={{fontSize:11,color:"#475569",marginTop:2,fontStyle:"italic"}}>{t.note}</div>}
                </div>
                <div style={{display:"flex",gap:8,alignItems:"center"}}>
                  <span style={{color:t.type==="income"?"#10B981":"#ef4444",fontWeight:600}}>{t.type==="income"?"+":"-"}{sym(currency)}{fmtNum(t.amount)}</span>
                  <button onClick={()=>delTx(showHist,t.id)} style={{background:"none",border:"none",color:"#ef4444",cursor:"pointer"}}>✕</button>
                </div>
              </div>
            </div>
          ))}
        </div>
      </Modal>}

      {editGoal&&<Modal title={`Edit Goal · ${envelopes.find(e=>e.id===editGoal)?.name}`} onClose={()=>setEditGoal(null)}>
        <Inp label="Goal (blank to remove)" type="number" value={goalVal} onChange={e=>setGoalVal(e.target.value)} placeholder="e.g. 10000"/>
        <Btn color={color} onClick={saveGoal} style={{width:"100%"}}>Save Goal</Btn>
      </Modal>}

      {showTransfer&&<TransferModal bank={bank} onClose={()=>setShowTransfer(false)} onTransfer={doTransfer}/>}
    </div>
  );
}

function BanksSection({ banks, setBanks, tags, undoProps }) {
  const [showBank,setShowBank]=useState(false);
  const [expanded,setExpanded]=useState(null);
  const [bankName,setBankName]=useState("");
  const [bankCurrency,setBankCurrency]=useState("PHP");
  const [bankBal,setBankBal]=useState("");
  const [confirmDel,setConfirmDel]=useState(null);
  const [globalConv,setGlobalConv]=useState("");

  const grouped = banks.reduce((acc,b)=>{
    if(!acc[b.currency])acc[b.currency]=[];
    acc[b.currency].push(b);
    return acc;
  },{});

  const addBank=()=>{
    if(!bankName.trim())return;
    setBanks(b=>[...b,makeBank(bankName.trim(),bankCurrency,parseFloat(bankBal)||0)]);
    setBankName("");setBankBal("");setShowBank(false);
  };
  const delBank=id=>{setBanks(b=>b.filter(x=>x.id!==id));setConfirmDel(null);};

  return (
    <div>
      <UndoBar {...undoProps}/>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16}}>
        <div style={{display:"flex",alignItems:"center",gap:8}}>
          <span style={{fontSize:18,fontWeight:700,color:"#f1f5f9"}}>All Banks</span>
          <select value={globalConv} onChange={e=>setGlobalConv(e.target.value)} style={{background:"#1e2130",border:"1px solid #334155",borderRadius:6,padding:"3px 8px",color:"#64748b",fontSize:12}}>
            <option value="">Global convert →</option>
            {CURRENCY_LIST.map(c=><option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        <Btn color="#3B82F6" onClick={()=>setShowBank(true)}>+ Add Bank</Btn>
      </div>

      {banks.length===0&&<div style={{color:"#475569",textAlign:"center",padding:32}}>No banks yet.</div>}

      {Object.entries(grouped).map(([currency, cBanks])=>{
        const color = getCurrencyColor(currency);
        const total = cBanks.reduce((s,b)=>s+bankTotal(b),0);
        return (
          <div key={currency} style={{marginBottom:24}}>
            <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:10}}>
              <div style={{fontSize:13,fontWeight:600,color}}>{currency} Banks</div>
              <div style={{fontSize:13,color}}>{sym(currency)}{fmtNum(total)}</div>
              {globalConv&&globalConv!==currency&&<ConversionBadge amount={total} fromCurrency={currency} toCurrency={globalConv}/>}
            </div>
            <div style={{display:"flex",flexDirection:"column",gap:10}}>
              {cBanks.map(bk=>(
                <div key={bk.id} style={{background:"#1e2130",borderRadius:12,border:"1px solid #334155",overflow:"hidden"}}>
                  <div style={{padding:"14px 16px",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                    <div>
                      <div style={{fontWeight:600,fontSize:15,color:"#f1f5f9"}}>{bk.name}</div>
                      <div style={{fontSize:20,fontWeight:700,color,marginTop:2}}>
                        {sym(bk.currency)}{fmtNum(bankTotal(bk))}
                        {globalConv&&globalConv!==bk.currency&&<ConversionBadge amount={bankTotal(bk)} fromCurrency={bk.currency} toCurrency={globalConv}/>}
                      </div>
                      <div style={{fontSize:11,color:"#475569",marginTop:2}}>{(bk.envelopes||[]).length} envelopes</div>
                    </div>
                    <div style={{display:"flex",gap:6}}>
                      <Btn small outline color={color} onClick={()=>setExpanded(expanded===bk.id?null:bk.id)}>{expanded===bk.id?"▲":"▼ Envelopes"}</Btn>
                      <Btn small outline color="#ef4444" onClick={()=>setConfirmDel({id:bk.id,name:bk.name})}>🗑</Btn>
                    </div>
                  </div>
                  {expanded===bk.id&&<div style={{borderTop:"1px solid #334155",padding:"12px 16px"}}>
                    <EnvelopeView bank={bk} bankId={bk.id} setBanks={setBanks} tags={tags}/>
                  </div>}
                </div>
              ))}
            </div>
          </div>
        );
      })}

      {confirmDel&&<ConfirmDelete name={confirmDel.name} onClose={()=>setConfirmDel(null)} onConfirm={()=>delBank(confirmDel.id)}/>}

      {showBank&&<Modal title="Add Bank" onClose={()=>setShowBank(false)}>
        <Inp label="Bank Name" value={bankName} onChange={e=>setBankName(e.target.value)} placeholder="e.g. BDO, DBS, Chase"/>
        <Sel label="Currency" value={bankCurrency} onChange={e=>setBankCurrency(e.target.value)}>
          {CURRENCY_LIST.map(c=><option key={c} value={c}>{c} — {CURRENCY_SYMBOLS[c]}</option>)}
        </Sel>
        <Inp label="Starting Balance" type="number" value={bankBal} onChange={e=>setBankBal(e.target.value)} placeholder="0.00"/>
        <Btn color="#3B82F6" onClick={addBank} style={{width:"100%"}}>Add Bank</Btn>
      </Modal>}
    </div>
  );
}

function CryptoSection({ holdings, setHoldings }) {
  const [showAdd,setShowAdd]=useState(false);
  const [confirmDel,setConfirmDel]=useState(null);
  const [form,setForm]=useState({coin:"",amount:"",value:"",notes:""});
  const total=holdings.reduce((s,h)=>s+(parseFloat(h.value)||0),0);
  const add=()=>{if(!form.coin)return;setHoldings(h=>[...h,{id:Date.now(),...form}]);setForm({coin:"",amount:"",value:"",notes:""});setShowAdd(false);};
  const del=id=>{setHoldings(h=>h.filter(x=>x.id!==id));setConfirmDel(null);};
  return (
    <div>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16}}>
        <div><div style={{fontSize:13,color:"#94a3b8"}}>Total (USD)</div><div style={{fontSize:26,fontWeight:700,color:"#F59E0B"}}>${fmtNum(total)}</div></div>
        <Btn color="#F59E0B" onClick={()=>setShowAdd(true)}>+ Add Holding</Btn>
      </div>
      {holdings.length===0&&<div style={{color:"#475569",textAlign:"center",padding:32}}>No crypto yet.</div>}
      <div style={{display:"flex",flexDirection:"column",gap:10}}>
        {holdings.map(h=>(
          <div key={h.id} style={{background:"#1e2130",borderRadius:10,padding:14,border:"1px solid #334155",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
            <div><div style={{fontWeight:600,color:"#f1f5f9"}}>{h.coin}</div><div style={{fontSize:13,color:"#94a3b8"}}>{h.amount} tokens{h.notes?` · ${h.notes}`:""}</div></div>
            <div style={{display:"flex",gap:8,alignItems:"center"}}>
              <span style={{color:"#F59E0B",fontWeight:700}}>${fmtNum(h.value)}</span>
              <button onClick={()=>setConfirmDel({id:h.id,name:h.coin})} style={{background:"none",border:"none",color:"#ef4444",cursor:"pointer"}}>🗑</button>
            </div>
          </div>
        ))}
      </div>
      {confirmDel&&<ConfirmDelete name={confirmDel.name} onClose={()=>setConfirmDel(null)} onConfirm={()=>del(confirmDel.id)}/>}
      {showAdd&&<Modal title="Add Crypto" onClose={()=>setShowAdd(false)}>
        <Inp label="Coin" value={form.coin} onChange={e=>setForm(f=>({...f,coin:e.target.value}))} placeholder="e.g. BTC, ETH"/>
        <Inp label="Amount" type="number" value={form.amount} onChange={e=>setForm(f=>({...f,amount:e.target.value}))} placeholder="0.00"/>
        <Inp label="Value (USD)" type="number" value={form.value} onChange={e=>setForm(f=>({...f,value:e.target.value}))} placeholder="0.00"/>
        <Inp label="Notes" value={form.notes} onChange={e=>setForm(f=>({...f,notes:e.target.value}))} placeholder="e.g. held on Binance"/>
        <Btn color="#F59E0B" onClick={add} style={{width:"100%"}}>Add</Btn>
      </Modal>}
    </div>
  );
}

function InvestSection({ investments, setInvestments }) {
  const [showAdd,setShowAdd]=useState(false);
  const [confirmDel,setConfirmDel]=useState(null);
  const [form,setForm]=useState({name:"",type:"",value:"",notes:""});
  const total=investments.reduce((s,i)=>s+(parseFloat(i.value)||0),0);
  const add=()=>{if(!form.name)return;setInvestments(i=>[...i,{id:Date.now(),...form}]);setForm({name:"",type:"",value:"",notes:""});setShowAdd(false);};
  const del=id=>{setInvestments(i=>i.filter(x=>x.id!==id));setConfirmDel(null);};
  return (
    <div>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16}}>
        <div><div style={{fontSize:13,color:"#94a3b8"}}>Total (USD)</div><div style={{fontSize:26,fontWeight:700,color:"#8B5CF6"}}>${fmtNum(total)}</div></div>
        <Btn color="#8B5CF6" onClick={()=>setShowAdd(true)}>+ Add Investment</Btn>
      </div>
      {investments.length===0&&<div style={{color:"#475569",textAlign:"center",padding:32}}>No investments yet.</div>}
      <div style={{display:"flex",flexDirection:"column",gap:10}}>
        {investments.map(inv=>(
          <div key={inv.id} style={{background:"#1e2130",borderRadius:10,padding:14,border:"1px solid #334155",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
            <div><div style={{fontWeight:600,color:"#f1f5f9"}}>{inv.name}</div><div style={{fontSize:13,color:"#94a3b8"}}>{inv.type}{inv.notes?` · ${inv.notes}`:""}</div></div>
            <div style={{display:"flex",gap:8,alignItems:"center"}}>
              <span style={{color:"#8B5CF6",fontWeight:700}}>${fmtNum(inv.value)}</span>
              <button onClick={()=>setConfirmDel({id:inv.id,name:inv.name})} style={{background:"none",border:"none",color:"#ef4444",cursor:"pointer"}}>🗑</button>
            </div>
          </div>
        ))}
      </div>
      {confirmDel&&<ConfirmDelete name={confirmDel.name} onClose={()=>setConfirmDel(null)} onConfirm={()=>del(confirmDel.id)}/>}
      {showAdd&&<Modal title="Add Investment" onClose={()=>setShowAdd(false)}>
        <Inp label="Name" value={form.name} onChange={e=>setForm(f=>({...f,name:e.target.value}))} placeholder="e.g. MSFT, S&P500 ETF"/>
        <Inp label="Type" value={form.type} onChange={e=>setForm(f=>({...f,type:e.target.value}))} placeholder="e.g. Stock, ETF, UITF"/>
        <Inp label="Value (USD)" type="number" value={form.value} onChange={e=>setForm(f=>({...f,value:e.target.value}))} placeholder="0.00"/>
        <Inp label="Notes" value={form.notes} onChange={e=>setForm(f=>({...f,notes:e.target.value}))} placeholder="e.g. held on Tiger Brokers"/>
        <Btn color="#8B5CF6" onClick={add} style={{width:"100%"}}>Add</Btn>
      </Modal>}
    </div>
  );
}

// ── Analytics ──
function PieChart({ data }) {
  const total = data.reduce((s,d)=>s+d.value,0);
  if(!total) return <div style={{color:"#475569",textAlign:"center",padding:24}}>No expense data yet.</div>;
  let angle = 0;
  const slices = data.map((d,i)=>{
    const pct = d.value/total;
    const start = angle;
    angle += pct*360;
    return {...d,start,end:angle,pct,color:COLORS_LIST[i%COLORS_LIST.length]};
  });
  const polarToXY=(deg,r)=>[50+r*Math.cos((deg-90)*Math.PI/180),50+r*Math.sin((deg-90)*Math.PI/180)];
  const describeArc=(start,end,r)=>{
    if(end-start>=360)end=359.99;
    const [x1,y1]=polarToXY(start,r);
    const [x2,y2]=polarToXY(end,r);
    const large=end-start>180?1:0;
    return `M 50 50 L ${x1} ${y1} A ${r} ${r} 0 ${large} 1 ${x2} ${y2} Z`;
  };
  return (
    <div style={{display:"flex",gap:24,alignItems:"center",flexWrap:"wrap"}}>
      <svg viewBox="0 0 100 100" style={{width:160,height:160,flexShrink:0}}>
        {slices.map((s,i)=><path key={i} d={describeArc(s.start,s.end,45)} fill={s.color} stroke="#0f1117" strokeWidth="0.5"/>)}
        <circle cx="50" cy="50" r="25" fill="#0f1117"/>
      </svg>
      <div style={{display:"flex",flexDirection:"column",gap:6,flex:1}}>
        {slices.map((s,i)=>(
          <div key={i} style={{display:"flex",justifyContent:"space-between",alignItems:"center",gap:12}}>
            <div style={{display:"flex",alignItems:"center",gap:6}}>
              <div style={{width:10,height:10,borderRadius:2,background:s.color,flexShrink:0}}/>
              <span style={{fontSize:13,color:"#cbd5e1"}}>{s.label}</span>
            </div>
            <div style={{textAlign:"right"}}>
              <span style={{fontSize:13,color:s.color,fontWeight:600}}>{Math.round(s.pct*100)}%</span>
              <span style={{fontSize:11,color:"#475569",marginLeft:6}}>{s.currency}{fmtNum(s.value)}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function BarChart({ data }) {
  if(!data.length) return <div style={{color:"#475569",textAlign:"center",padding:24}}>No data yet.</div>;
  const max = Math.max(...data.map(d=>d.value),1);
  return (
    <div style={{display:"flex",alignItems:"flex-end",gap:6,height:120,marginTop:8}}>
      {data.map((d,i)=>(
        <div key={i} style={{flex:1,display:"flex",flexDirection:"column",alignItems:"center",gap:4}}>
          <div style={{fontSize:10,color:"#64748b"}}>{d.currency}{fmtNum(d.value)}</div>
          <div style={{width:"100%",background:COLORS_LIST[i%COLORS_LIST.length],borderRadius:"4px 4px 0 0",height:`${Math.max(4,(d.value/max)*80)}px`}}/>
          <div style={{fontSize:10,color:"#64748b",whiteSpace:"nowrap"}}>{d.label}</div>
        </div>
      ))}
    </div>
  );
}

function AnalyticsSection({ banks, tags }) {
  const [filterBank,setFilterBank]=useState("all");
  const [filterCurrency,setFilterCurrency]=useState("all");

  const allTx = banks.flatMap(b=>
    b.envelopes.flatMap(e=>
      e.transactions.filter(t=>t.type==="expense").map(t=>({...t,bankId:b.id,bankName:b.name,currency:b.currency}))
    )
  ).filter(t=>(filterBank==="all"||t.bankId===filterBank)&&(filterCurrency==="all"||t.currency===filterCurrency));

  // Pie by tag
  const tagTotals = {};
  allTx.forEach(t=>{
    const key = t.tag||"Untagged";
    if(!tagTotals[key])tagTotals[key]={value:0,currency:t.currency};
    tagTotals[key].value+=t.amount;
  });
  const pieData = Object.entries(tagTotals).map(([label,v])=>({label,value:v.value,currency:sym(v.currency)}));

  // Bar by month
  const monthTotals = {};
  allTx.forEach(t=>{
    const key = t.date?.slice(0,7)||"Unknown";
    if(!monthTotals[key])monthTotals[key]={value:0,currency:t.currency};
    monthTotals[key].value+=t.amount;
  });
  const barData = Object.entries(monthTotals).sort(([a],[b])=>a.localeCompare(b)).slice(-6).map(([label,v])=>({label:label.slice(5),value:v.value,currency:sym(v.currency)}));

  return (
    <div>
      <div style={{display:"flex",gap:8,marginBottom:16,flexWrap:"wrap"}}>
        <select value={filterBank} onChange={e=>setFilterBank(e.target.value)} style={{background:"#1e2130",border:"1px solid #334155",borderRadius:8,padding:"6px 10px",color:"#f1f5f9",fontSize:13}}>
          <option value="all">All Banks</option>
          {banks.map(b=><option key={b.id} value={b.id}>{b.name}</option>)}
        </select>
        <select value={filterCurrency} onChange={e=>setFilterCurrency(e.target.value)} style={{background:"#1e2130",border:"1px solid #334155",borderRadius:8,padding:"6px 10px",color:"#f1f5f9",fontSize:13}}>
          <option value="all">All Currencies</option>
          {[...new Set(banks.map(b=>b.currency))].map(c=><option key={c} value={c}>{c}</option>)}
        </select>
      </div>

      <div style={{background:"#1e2130",borderRadius:12,padding:16,marginBottom:16}}>
        <div style={{fontSize:13,fontWeight:600,color:"#f1f5f9",marginBottom:12}}>💸 Spending by Tag</div>
        <PieChart data={pieData}/>
      </div>

      <div style={{background:"#1e2130",borderRadius:12,padding:16}}>
        <div style={{fontSize:13,fontWeight:600,color:"#f1f5f9",marginBottom:4}}>📅 Monthly Spending (last 6 months)</div>
        <BarChart data={barData}/>
      </div>
    </div>
  );
}

// ── Backup (Export / Import) ──
function BackupBar({ getData, onImport }) {
  const fileRef = useRef(null);

  const exportData = () => {
    const blob = new Blob([JSON.stringify(getData(), null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `finance-backup-${new Date().toISOString().slice(0,10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const importData = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const parsed = JSON.parse(ev.target.result);
        if (!confirm("This will replace your current data with the backup. Continue?")) return;
        onImport(parsed);
      } catch {
        alert("Invalid backup file.");
      }
    };
    reader.readAsText(file);
    e.target.value = "";
  };

  return (
    <div style={{display:"flex",gap:8,marginBottom:16}}>
      <Btn small outline color="#10B981" onClick={exportData}>⬇ Download Backup</Btn>
      <Btn small outline color="#3B82F6" onClick={()=>fileRef.current?.click()}>⬆ Restore Backup</Btn>
      <input ref={fileRef} type="file" accept="application/json" onChange={importData} style={{display:"none"}}/>
    </div>
  );
}

// ── Notes ──
function NotesSection({ notes, setNotes }) {
  return (
    <div>
      <div style={{fontSize:13,color:"#94a3b8",marginBottom:8}}>Global finance notes — auto-saved</div>
      <textarea
        value={notes}
        onChange={e=>setNotes(e.target.value)}
        placeholder="Write anything here — goals, reminders, plans..."
        style={{width:"100%",minHeight:400,background:"#1e2130",border:"1px solid #334155",borderRadius:12,padding:16,color:"#f1f5f9",fontSize:14,lineHeight:1.7,resize:"vertical",boxSizing:"border-box",fontFamily:"system-ui"}}
      />
    </div>
  );
}

// ── Tags Manager ──
function TagsManager({ tags, setTags }) {
  const [newTag,setNewTag]=useState("");
  const add=()=>{if(!newTag.trim()||tags.includes(newTag.trim()))return;setTags(t=>[...t,newTag.trim()]);setNewTag("");};
  const del=tag=>setTags(t=>t.filter(x=>x!==tag));
  return (
    <div style={{background:"#1e2130",borderRadius:12,padding:16,marginBottom:20}}>
      <div style={{fontSize:13,fontWeight:600,color:"#f1f5f9",marginBottom:10}}>🏷️ Manage Tags</div>
      <div style={{display:"flex",gap:8,marginBottom:10}}>
        <input value={newTag} onChange={e=>setNewTag(e.target.value)} onKeyDown={e=>e.key==="Enter"&&add()} placeholder="New tag..." style={{flex:1,background:"#0f1117",border:"1px solid #334155",borderRadius:8,padding:"6px 10px",color:"#f1f5f9",fontSize:13}}/>
        <Btn small color="#3B82F6" onClick={add}>Add</Btn>
      </div>
      <div style={{display:"flex",flexWrap:"wrap",gap:6}}>
        {tags.map((t,i)=>(
          <div key={t} style={{background:`${COLORS_LIST[i%COLORS_LIST.length]}22`,border:`1px solid ${COLORS_LIST[i%COLORS_LIST.length]}44`,borderRadius:6,padding:"3px 10px",fontSize:12,color:COLORS_LIST[i%COLORS_LIST.length],display:"flex",alignItems:"center",gap:6}}>
            {t}
            <button onClick={()=>del(t)} style={{background:"none",border:"none",color:"#ef4444",cursor:"pointer",fontSize:12,padding:0}}>×</button>
          </div>
        ))}
        {tags.length===0&&<span style={{fontSize:12,color:"#475569"}}>No tags yet — add some above</span>}
      </div>
    </div>
  );
}

// ── Dashboard ──
function Dashboard({ banks, crypto, investments }) {
  const byCurrency = banks.reduce((acc,b)=>{
    if(!acc[b.currency])acc[b.currency]=0;
    acc[b.currency]+=bankTotal(b);
    return acc;
  },{});
  const cryptoTotal=crypto.reduce((s,h)=>s+(parseFloat(h.value)||0),0);
  const investTotal=investments.reduce((s,i)=>s+(parseFloat(i.value)||0),0);
  return (
    <div>
      <div style={{fontSize:13,color:"#94a3b8",marginBottom:16}}>Overview</div>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12,marginBottom:24}}>
        {Object.entries(byCurrency).map(([currency,total])=>(
          <div key={currency} style={{background:"#1e2130",borderRadius:12,padding:18,border:`1px solid ${getCurrencyColor(currency)}33`}}>
            <div style={{fontSize:12,color:"#94a3b8",marginBottom:4}}>{currency} Banks</div>
            <div style={{fontSize:20,fontWeight:700,color:getCurrencyColor(currency)}}>{sym(currency)}{fmtNum(total)}</div>
            <div style={{fontSize:12,color:"#475569",marginTop:2}}>{banks.filter(b=>b.currency===currency).length} accounts</div>
          </div>
        ))}
        <div style={{background:"#1e2130",borderRadius:12,padding:18,border:"1px solid #F59E0B33"}}>
          <div style={{fontSize:12,color:"#94a3b8",marginBottom:4}}>Crypto</div>
          <div style={{fontSize:20,fontWeight:700,color:"#F59E0B"}}>${fmtNum(cryptoTotal)}</div>
          <div style={{fontSize:12,color:"#475569",marginTop:2}}>{crypto.length} holdings</div>
        </div>
        <div style={{background:"#1e2130",borderRadius:12,padding:18,border:"1px solid #8B5CF633"}}>
          <div style={{fontSize:12,color:"#94a3b8",marginBottom:4}}>Investments</div>
          <div style={{fontSize:20,fontWeight:700,color:"#8B5CF6"}}>${fmtNum(investTotal)}</div>
          <div style={{fontSize:12,color:"#475569",marginTop:2}}>{investments.length} positions</div>
        </div>
      </div>

      {Object.entries(banks.reduce((acc,b)=>{if(!acc[b.currency])acc[b.currency]=[];acc[b.currency].push(b);return acc;},{})).map(([currency,cBanks])=>(
        <div key={currency} style={{marginBottom:20}}>
          <div style={{fontSize:13,fontWeight:600,color:getCurrencyColor(currency),marginBottom:8}}>{currency} Accounts</div>
          {cBanks.map(b=>(
            <div key={b.id} style={{marginBottom:8}}>
              <div style={{display:"flex",justifyContent:"space-between",padding:"6px 0",borderBottom:"1px solid #334155",fontSize:14,color:"#cbd5e1",fontWeight:600}}>
                <span>{b.name}</span><span style={{color:getCurrencyColor(currency)}}>{sym(currency)}{fmtNum(bankTotal(b))}</span>
              </div>
              {(b.envelopes||[]).map(e=>(
                <div key={e.id} style={{display:"flex",justifyContent:"space-between",padding:"4px 0 4px 14px",fontSize:12,color:e.isUnalloc?"#475569":"#94a3b8",fontStyle:e.isUnalloc?"italic":"normal"}}>
                  <span>{e.isUnalloc?"📂":"🗂️"} {e.name}{e.goal?` (${Math.min(100,Math.round((e.balance/e.goal)*100))}% of goal)`:""}</span>
                  <span style={{color:e.isUnalloc?"#475569":getCurrencyColor(currency)}}>{sym(currency)}{fmtNum(e.balance)}</span>
                </div>
              ))}
            </div>
          ))}
        </div>
      ))}

      {crypto.length>0&&<div style={{marginBottom:20}}>
        <div style={{fontSize:13,fontWeight:600,color:"#F59E0B",marginBottom:8}}>Crypto</div>
        {crypto.map(h=><div key={h.id} style={{display:"flex",justifyContent:"space-between",padding:"6px 0",borderBottom:"1px solid #1e2130",fontSize:14,color:"#cbd5e1"}}><span>{h.coin} <span style={{color:"#475569"}}>({h.amount})</span></span><span style={{color:"#F59E0B"}}>${fmtNum(h.value)}</span></div>)}
      </div>}
      {investments.length>0&&<div>
        <div style={{fontSize:13,fontWeight:600,color:"#8B5CF6",marginBottom:8}}>Investments</div>
        {investments.map(i=><div key={i.id} style={{display:"flex",justifyContent:"space-between",padding:"6px 0",borderBottom:"1px solid #1e2130",fontSize:14,color:"#cbd5e1"}}><span>{i.name} <span style={{color:"#475569"}}>({i.type})</span></span><span style={{color:"#8B5CF6"}}>${fmtNum(i.value)}</span></div>)}
      </div>}
    </div>
  );
}

// ── Root ──
export default function FinanceTracker({ userId, userEmail, onSignOut }) {
  const [tab,setTab]=useState(0);
  const [banks,setBanks,undoBanks,redoBanks,canUndo,canRedo]=useUndoable([]);
  const [crypto,setCrypto]=useState([]);
  const [investments,setInvestments]=useState([]);
  const [tags,setTags]=useState(["Food","Transport","Rent","Entertainment","Health","Shopping","Utilities","Salary"]);
  const [notes,setNotes]=useState("");
  const [syncStatus,setSyncStatus]=useState("loading");
  const saveTimerRef=useRef(null);
  const initialLoadDone=useRef(false);

  useEffect(()=>{
    (async()=>{
      setSyncStatus("loading");
      const data=await loadData(userId);
      if(data){
        if(data.banks)setBanks(data.banks);
        else if(data.phpBanks||data.sgdBanks){
          // Migrate old format
          const migrated=[
            ...(data.phpBanks||[]).map(b=>({...b,currency:"PHP"})),
            ...(data.sgdBanks||[]).map(b=>({...b,currency:"SGD"}))
          ];
          setBanks(migrated);
        }
        if(data.crypto)setCrypto(data.crypto);
        if(data.investments)setInvestments(data.investments);
        if(data.tags)setTags(data.tags);
        if(data.notes)setNotes(data.notes);
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
      await saveData(userId,{banks,crypto,investments,tags,notes});
      setSyncStatus("saved");
    },2000);
    return()=>clearTimeout(saveTimerRef.current);
  },[banks,crypto,investments,tags,notes,userId]);

  const undoProps={undo:undoBanks,redo:redoBanks,canUndo,canRedo};

  const importBackup = (parsed) => {
    if (parsed.banks) setBanks(parsed.banks);
    else if (parsed.phpBanks || parsed.sgdBanks) {
      setBanks([
        ...(parsed.phpBanks||[]).map(b=>({...b,currency:"PHP"})),
        ...(parsed.sgdBanks||[]).map(b=>({...b,currency:"SGD"}))
      ]);
    }
    if (parsed.crypto) setCrypto(parsed.crypto);
    if (parsed.investments) setInvestments(parsed.investments);
    if (parsed.tags) setTags(parsed.tags);
    if (parsed.notes !== undefined) setNotes(parsed.notes);
  };

  const TAB_COLORS=["#3B82F6","#3B82F6","#F59E0B","#8B5CF6","#06B6D4","#10B981"];

  return (
    <div style={{minHeight:"100vh",background:"#0f1117",color:"#f1f5f9",fontFamily:"system-ui,sans-serif"}}>
      <div style={{maxWidth:680,margin:"0 auto",padding:"0 16px 40px"}}>
        <div style={{padding:"20px 0 12px",borderBottom:"1px solid #1e2130",marginBottom:16,display:"flex",justifyContent:"space-between",alignItems:"flex-end"}}>
          <div>
            <div style={{fontSize:22,fontWeight:700}}>💰 Finance Tracker</div>
            <div style={{fontSize:13,color:"#475569"}}>{userEmail}</div>
          </div>
          <div style={{display:"flex",alignItems:"center",gap:10}}>
            <SyncBar status={syncStatus}/>
            <button onClick={onSignOut} style={{background:"transparent",border:"1px solid #334155",color:"#94a3b8",borderRadius:8,padding:"5px 12px",cursor:"pointer",fontSize:12}}>Sign out</button>
          </div>
        </div>

        <TagsManager tags={tags} setTags={setTags}/>

        <BackupBar getData={()=>({banks,crypto,investments,tags,notes})} onImport={importBackup}/>

        <div style={{display:"flex",gap:6,overflowX:"auto",marginBottom:24,paddingBottom:4}}>
          {TABS.map((t,i)=>(
            <button key={t} onClick={()=>setTab(i)} style={{background:tab===i?TAB_COLORS[i]:"#1e2130",color:tab===i?"#fff":"#94a3b8",border:"none",borderRadius:8,padding:"7px 14px",cursor:"pointer",fontSize:13,fontWeight:500,whiteSpace:"nowrap"}}>{t}</button>
          ))}
        </div>

        {tab===0&&<Dashboard banks={banks} crypto={crypto} investments={investments}/>}
        {tab===1&&<BanksSection banks={banks} setBanks={setBanks} tags={tags} undoProps={undoProps}/>}
        {tab===2&&<CryptoSection holdings={crypto} setHoldings={setCrypto}/>}
        {tab===3&&<InvestSection investments={investments} setInvestments={setInvestments}/>}
        {tab===4&&<AnalyticsSection banks={banks} tags={tags}/>}
        {tab===5&&<NotesSection notes={notes} setNotes={setNotes}/>}
      </div>
    </div>
  );
}
