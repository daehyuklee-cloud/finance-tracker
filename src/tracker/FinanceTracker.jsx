import { useState, useEffect, useRef, useCallback } from "react";
import { loadData, saveData } from "../db";

const TABS = ["Dashboard", "PHP Banks", "SGD Banks", "Crypto", "Investments", "✨ Ask AI"];
const COLORS = { php:"#3B82F6", sgd:"#10B981", crypto:"#F59E0B", invest:"#8B5CF6", ai:"#EC4899" };
const fmt = (n, sym="") => `${sym}${Number(n||0).toLocaleString("en-US",{minimumFractionDigits:2,maximumFractionDigits:2})}`;
const UNALLOC_ID = "__unallocated__";
const MAX_HISTORY = 50;

// ── Undo/Redo ──
function useUndoable(init) {
  const [history, setHistory] = useState([init]);
  const [idx, setIdx] = useState(0);
  const val = history[idx];
  const set = useCallback((fn) => {
    setHistory(h => {
      const next = typeof fn === "function" ? fn(h[idx]) : fn;
      const newH = [...h.slice(0, idx+1), next].slice(-MAX_HISTORY);
      return newH;
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
      <p style={{color:"#f1f5f9",fontSize:14,marginBottom:8}}>You are about to delete <strong style={{color:"#ef4444"}}>{name}</strong>.</p>
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
  const colors = { idle:"#475569", saving:"#F59E0B", saved:"#10B981", error:"#ef4444", loading:"#3B82F6" };
  const icons = { idle:"☁️", saving:"⏳", saved:"✓", error:"⚠️", loading:"⏳" };
  const labels = { idle:"Cloud sync ready", saving:"Saving…", saved:"Saved", error:"Save failed", loading:"Loading…" };
  return (
    <div style={{display:"flex",alignItems:"center",gap:6,fontSize:12,color:colors[status],padding:"4px 10px",background:"#1e2130",borderRadius:8}}>
      <span>{icons[status]}</span><span>{labels[status]}</span>
    </div>
  );
}

function makeBank(name, balance) {
  return { id:Date.now(), name, balance, envelopes:[{id:UNALLOC_ID,name:"Unallocated",balance,transactions:[],isUnalloc:true}] };
}
function bankTotal(bank) { return (bank.envelopes||[]).reduce((s,e)=>s+e.balance,0); }

function TransferModal({ bank, onClose, onTransfer, color, sym }) {
  const envs = bank.envelopes||[];
  const [from, setFrom] = useState(envs[0]?.id||"");
  const [to, setTo] = useState(envs[1]?.id||"");
  const [amt, setAmt] = useState("");
  const doTransfer = () => {
    const a=parseFloat(amt); if(!a||from===to) return;
    const src=envs.find(e=>e.id===from);
    if(!src||src.balance<a){alert("Insufficient balance!");return;}
    onTransfer(from,to,a); onClose();
  };
  return (
    <Modal title="Transfer Between Envelopes" onClose={onClose}>
      <div style={{marginBottom:12}}>
        <div style={{fontSize:12,color:"#94a3b8",marginBottom:4}}>From</div>
        <select value={from} onChange={e=>setFrom(e.target.value)} style={{width:"100%",background:"#0f1117",border:"1px solid #334155",borderRadius:8,padding:"8px 10px",color:"#f1f5f9",fontSize:14}}>
          {envs.map(e=><option key={e.id} value={e.id}>{e.name} ({sym}{fmt(e.balance)})</option>)}
        </select>
      </div>
      <div style={{marginBottom:12}}>
        <div style={{fontSize:12,color:"#94a3b8",marginBottom:4}}>To</div>
        <select value={to} onChange={e=>setTo(e.target.value)} style={{width:"100%",background:"#0f1117",border:"1px solid #334155",borderRadius:8,padding:"8px 10px",color:"#f1f5f9",fontSize:14}}>
          {envs.map(e=><option key={e.id} value={e.id}>{e.name} ({sym}{fmt(e.balance)})</option>)}
        </select>
      </div>
      <Inp label="Amount" type="number" value={amt} onChange={e=>setAmt(e.target.value)} placeholder="0.00"/>
      <Btn color={color} onClick={doTransfer} style={{width:"100%"}}>Transfer</Btn>
    </Modal>
  );
}

function EnvelopeView({ bank, bankId, setBanks, color, sym }) {
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
  const [tx,setTx]=useState({type:"expense",desc:"",amount:"",category:"",date:new Date().toISOString().slice(0,10)});
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
    setTx({type:"expense",desc:"",amount:"",category:"",date:new Date().toISOString().slice(0,10)});setShowTx(null);
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
        <span style={{fontSize:13,color:"#94a3b8"}}>Envelopes</span>
        <div style={{display:"flex",gap:6}}>
          <Btn small outline color={color} onClick={()=>setShowTransfer(true)}>⇄ Transfer</Btn>
          <Btn small color={color} onClick={()=>setShowAdd(true)}>+ Envelope</Btn>
        </div>
      </div>
      <div style={{display:"flex",flexDirection:"column",gap:6}}>
        {envelopes.map(e=>(
          <div key={e.id} style={{background:"#0f1117",borderRadius:8,padding:"10px 12px",border:`1px solid ${e.isUnalloc?"#334155":color}33`,display:"flex",justifyContent:"space-between",alignItems:"center",gap:8}}>
            <div style={{display:"flex",alignItems:"center",gap:8,flex:1,minWidth:0}}>
              <span style={{fontSize:15}}>{e.isUnalloc?"📂":"🗂️"}</span>
              <div style={{flex:1,minWidth:0}}>
                <div style={{fontSize:13,color:e.isUnalloc?"#64748b":"#cbd5e1",fontStyle:e.isUnalloc?"italic":"normal"}}>
                  {e.name}{e.goal?<span style={{fontSize:11,color:"#64748b",marginLeft:6}}>Goal: {sym}{fmt(e.goal)}</span>:null}
                </div>
                {e.goal&&!e.isUnalloc&&(()=>{const pct=Math.min(100,Math.round((e.balance/e.goal)*100));const rem=e.goal-e.balance;return(<div style={{marginTop:4}}><div style={{background:"#1e2130",borderRadius:99,height:5,width:"100%",overflow:"hidden"}}><div style={{width:`${pct}%`,height:"100%",background:pct>=100?"#10B981":color,borderRadius:99}}/></div><div style={{fontSize:10,color:pct>=100?"#10B981":"#64748b",marginTop:2}}>{pct}% of goal{pct>=100?" ✓":<span style={{marginLeft:6,color:"#94a3b8"}}>· {sym}{fmt(rem)} remaining</span>}</div></div>);})()}
                {!e.goal&&<div style={{fontSize:11,color:"#475569"}}>{e.transactions.length} tx</div>}
              </div>
            </div>
            <div style={{display:"flex",gap:4,alignItems:"center",flexShrink:0}}>
              <span style={{color:e.balance<0?"#ef4444":e.isUnalloc?"#64748b":color,fontWeight:600,fontSize:13}}>{sym}{fmt(e.balance)}</span>
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
        <div style={{fontSize:13,color:"#94a3b8",marginBottom:12}}>Available in Unallocated: <strong style={{color}}>{sym}{fmt(unallocEnv?.balance||0)}</strong></div>
        <Inp label="Envelope Name" value={envName} onChange={e=>setEnvName(e.target.value)} placeholder="e.g. Rent, Emergency, Travel"/>
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
        <Inp label="Category" value={tx.category} onChange={e=>setTx(x=>({...x,category:e.target.value}))} placeholder="e.g. Food, Transport"/>
        <Inp label="Date" type="date" value={tx.date} onChange={e=>setTx(x=>({...x,date:e.target.value}))}/>
        <Btn color={color} onClick={addTx} style={{width:"100%"}}>Add Transaction</Btn>
      </Modal>}
      {showHist&&<Modal title={`${histEnv?.name} · History`} onClose={()=>setShowHist(null)}>
        {histEnv?.transactions.length===0&&<div style={{color:"#475569",textAlign:"center",padding:16}}>No transactions yet.</div>}
        <div style={{display:"flex",flexDirection:"column",gap:8,maxHeight:320,overflowY:"auto"}}>
          {histEnv?.transactions.map(t=>(
            <div key={t.id} style={{display:"flex",justifyContent:"space-between",alignItems:"center",background:"#0f1117",borderRadius:8,padding:"8px 12px"}}>
              <div><div style={{fontSize:13,color:"#f1f5f9"}}>{t.desc}</div><div style={{fontSize:11,color:"#64748b"}}>{t.category}{t.category?" · ":""}{t.date}</div></div>
              <div style={{display:"flex",gap:8,alignItems:"center"}}>
                <span style={{color:t.type==="income"?"#10B981":"#ef4444",fontWeight:600}}>{t.type==="income"?"+":"-"}{sym}{fmt(t.amount)}</span>
                <button onClick={()=>delTx(showHist,t.id)} style={{background:"none",border:"none",color:"#ef4444",cursor:"pointer"}}>✕</button>
              </div>
            </div>
          ))}
        </div>
      </Modal>}
      {editGoal&&<Modal title={`Edit Goal · ${envelopes.find(e=>e.id===editGoal)?.name}`} onClose={()=>setEditGoal(null)}>
        <Inp label="Savings Goal (leave blank to remove)" type="number" value={goalVal} onChange={e=>setGoalVal(e.target.value)} placeholder="e.g. 10000"/>
        <Btn color={color} onClick={saveGoal} style={{width:"100%"}}>Save Goal</Btn>
      </Modal>}
      {showTransfer&&<TransferModal bank={bank} onClose={()=>setShowTransfer(false)} onTransfer={doTransfer} color={color} sym={sym}/>}
    </div>
  );
}

function BankSection({ banks, setBanks, currency, color, undoProps }) {
  const [showBank,setShowBank]=useState(false);
  const [expanded,setExpanded]=useState(null);
  const [bankName,setBankName]=useState("");
  const [bankBal,setBankBal]=useState("");
  const [confirmDel,setConfirmDel]=useState(null);
  const sym=currency==="PHP"?"₱":"S$";
  const total=banks.reduce((s,b)=>s+bankTotal(b),0);
  const addBank=()=>{if(!bankName.trim())return;setBanks(b=>[...b,makeBank(bankName.trim(),parseFloat(bankBal)||0)]);setBankName("");setBankBal("");setShowBank(false);};
  const delBank=id=>{setBanks(b=>b.filter(x=>x.id!==id));setConfirmDel(null);};
  return (
    <div>
      <UndoBar {...undoProps}/>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16}}>
        <div><div style={{fontSize:13,color:"#94a3b8"}}>Total {currency}</div><div style={{fontSize:26,fontWeight:700,color}}>{sym}{fmt(total)}</div></div>
        <Btn color={color} onClick={()=>setShowBank(true)}>+ Add Bank</Btn>
      </div>
      {banks.length===0&&<div style={{color:"#475569",textAlign:"center",padding:32}}>No banks yet.</div>}
      <div style={{display:"flex",flexDirection:"column",gap:10}}>
        {banks.map(bk=>(
          <div key={bk.id} style={{background:"#1e2130",borderRadius:12,border:"1px solid #334155",overflow:"hidden"}}>
            <div style={{padding:"14px 16px",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
              <div>
                <div style={{fontWeight:600,fontSize:15,color:"#f1f5f9"}}>{bk.name}</div>
                <div style={{fontSize:20,fontWeight:700,color,marginTop:2}}>{sym}{fmt(bankTotal(bk))}</div>
                <div style={{fontSize:11,color:"#475569",marginTop:2}}>{(bk.envelopes||[]).length} envelope{(bk.envelopes||[]).length!==1?"s":""}</div>
              </div>
              <div style={{display:"flex",gap:6}}>
                <Btn small outline color={color} onClick={()=>setExpanded(expanded===bk.id?null:bk.id)}>{expanded===bk.id?"▲ Hide":"▼ Envelopes"}</Btn>
                <Btn small outline color="#ef4444" onClick={()=>setConfirmDel({id:bk.id,name:bk.name})}>🗑</Btn>
              </div>
            </div>
            {expanded===bk.id&&<div style={{borderTop:"1px solid #334155",padding:"12px 16px"}}><EnvelopeView bank={bk} bankId={bk.id} setBanks={setBanks} color={color} sym={sym}/></div>}
          </div>
        ))}
      </div>
      {confirmDel&&<ConfirmDelete name={confirmDel.name} onClose={()=>setConfirmDel(null)} onConfirm={()=>delBank(confirmDel.id)}/>}
      {showBank&&<Modal title={`Add ${currency} Bank`} onClose={()=>setShowBank(false)}>
        <Inp label="Bank Name" value={bankName} onChange={e=>setBankName(e.target.value)} placeholder="e.g. BDO Savings"/>
        <Inp label="Starting Balance" type="number" value={bankBal} onChange={e=>setBankBal(e.target.value)} placeholder="0.00"/>
        <Btn color={color} onClick={addBank} style={{width:"100%"}}>Add Bank</Btn>
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
        <div><div style={{fontSize:13,color:"#94a3b8"}}>Total Value (USD)</div><div style={{fontSize:26,fontWeight:700,color:COLORS.crypto}}>${fmt(total)}</div></div>
        <Btn color={COLORS.crypto} onClick={()=>setShowAdd(true)}>+ Add Holding</Btn>
      </div>
      {holdings.length===0&&<div style={{color:"#475569",textAlign:"center",padding:32}}>No crypto holdings yet.</div>}
      <div style={{display:"flex",flexDirection:"column",gap:10}}>
        {holdings.map(h=>(
          <div key={h.id} style={{background:"#1e2130",borderRadius:10,padding:14,border:"1px solid #334155",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
            <div><div style={{fontWeight:600,color:"#f1f5f9"}}>{h.coin}</div><div style={{fontSize:13,color:"#94a3b8"}}>{h.amount} tokens{h.notes?` · ${h.notes}`:""}</div></div>
            <div style={{display:"flex",gap:8,alignItems:"center"}}>
              <span style={{color:COLORS.crypto,fontWeight:700}}>${fmt(h.value)}</span>
              <button onClick={()=>setConfirmDel({id:h.id,name:h.coin})} style={{background:"none",border:"none",color:"#ef4444",cursor:"pointer"}}>🗑</button>
            </div>
          </div>
        ))}
      </div>
      {confirmDel&&<ConfirmDelete name={confirmDel.name} onClose={()=>setConfirmDel(null)} onConfirm={()=>del(confirmDel.id)}/>}
      {showAdd&&<Modal title="Add Crypto Holding" onClose={()=>setShowAdd(false)}>
        <Inp label="Coin / Token" value={form.coin} onChange={e=>setForm(f=>({...f,coin:e.target.value}))} placeholder="e.g. BTC, ETH, SOL"/>
        <Inp label="Amount (tokens)" type="number" value={form.amount} onChange={e=>setForm(f=>({...f,amount:e.target.value}))} placeholder="0.00"/>
        <Inp label="Current Value (USD)" type="number" value={form.value} onChange={e=>setForm(f=>({...f,value:e.target.value}))} placeholder="0.00"/>
        <Inp label="Notes (optional)" value={form.notes} onChange={e=>setForm(f=>({...f,notes:e.target.value}))} placeholder="e.g. held on Binance"/>
        <Btn color={COLORS.crypto} onClick={add} style={{width:"100%"}}>Add Holding</Btn>
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
        <div><div style={{fontSize:13,color:"#94a3b8"}}>Total Value</div><div style={{fontSize:26,fontWeight:700,color:COLORS.invest}}>${fmt(total)}</div></div>
        <Btn color={COLORS.invest} onClick={()=>setShowAdd(true)}>+ Add Investment</Btn>
      </div>
      {investments.length===0&&<div style={{color:"#475569",textAlign:"center",padding:32}}>No investments yet.</div>}
      <div style={{display:"flex",flexDirection:"column",gap:10}}>
        {investments.map(inv=>(
          <div key={inv.id} style={{background:"#1e2130",borderRadius:10,padding:14,border:"1px solid #334155",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
            <div><div style={{fontWeight:600,color:"#f1f5f9"}}>{inv.name}</div><div style={{fontSize:13,color:"#94a3b8"}}>{inv.type}{inv.notes?` · ${inv.notes}`:""}</div></div>
            <div style={{display:"flex",gap:8,alignItems:"center"}}>
              <span style={{color:COLORS.invest,fontWeight:700}}>${fmt(inv.value)}</span>
              <button onClick={()=>setConfirmDel({id:inv.id,name:inv.name})} style={{background:"none",border:"none",color:"#ef4444",cursor:"pointer"}}>🗑</button>
            </div>
          </div>
        ))}
      </div>
      {confirmDel&&<ConfirmDelete name={confirmDel.name} onClose={()=>setConfirmDel(null)} onConfirm={()=>del(confirmDel.id)}/>}
      {showAdd&&<Modal title="Add Investment" onClose={()=>setShowAdd(false)}>
        <Inp label="Name" value={form.name} onChange={e=>setForm(f=>({...f,name:e.target.value}))} placeholder="e.g. MSFT, S&P500 ETF"/>
        <Inp label="Type" value={form.type} onChange={e=>setForm(f=>({...f,type:e.target.value}))} placeholder="e.g. Stock, ETF, UITF, Bond"/>
        <Inp label="Current Value (USD)" type="number" value={form.value} onChange={e=>setForm(f=>({...f,value:e.target.value}))} placeholder="0.00"/>
        <Inp label="Notes (optional)" value={form.notes} onChange={e=>setForm(f=>({...f,notes:e.target.value}))} placeholder="e.g. held on Tiger Brokers"/>
        <Btn color={COLORS.invest} onClick={add} style={{width:"100%"}}>Add Investment</Btn>
      </Modal>}
    </div>
  );
}

function Dashboard({ phpBanks, sgdBanks, crypto, investments }) {
  const phpTotal=phpBanks.reduce((s,b)=>s+bankTotal(b),0);
  const sgdTotal=sgdBanks.reduce((s,b)=>s+bankTotal(b),0);
  const cryptoTotal=crypto.reduce((s,h)=>s+(parseFloat(h.value)||0),0);
  const investTotal=investments.reduce((s,i)=>s+(parseFloat(i.value)||0),0);
  const cards=[
    {label:"PHP Banks",value:`₱${fmt(phpTotal)}`,color:COLORS.php,sub:`${phpBanks.length} account${phpBanks.length!==1?"s":""}`},
    {label:"SGD Banks",value:`S$${fmt(sgdTotal)}`,color:COLORS.sgd,sub:`${sgdBanks.length} account${sgdBanks.length!==1?"s":""}`},
    {label:"Crypto",value:`$${fmt(cryptoTotal)}`,color:COLORS.crypto,sub:`${crypto.length} holding${crypto.length!==1?"s":""}`},
    {label:"Investments",value:`$${fmt(investTotal)}`,color:COLORS.invest,sub:`${investments.length} position${investments.length!==1?"s":""}`},
  ];
  return (
    <div>
      <div style={{fontSize:13,color:"#94a3b8",marginBottom:16}}>Overview — all currencies shown as-is</div>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12,marginBottom:24}}>
        {cards.map(c=>(
          <div key={c.label} style={{background:"#1e2130",borderRadius:12,padding:18,border:`1px solid ${c.color}33`}}>
            <div style={{fontSize:12,color:"#94a3b8",marginBottom:4}}>{c.label}</div>
            <div style={{fontSize:22,fontWeight:700,color:c.color}}>{c.value}</div>
            <div style={{fontSize:12,color:"#475569",marginTop:2}}>{c.sub}</div>
          </div>
        ))}
      </div>
      {[{banks:phpBanks,label:"PHP Accounts",sym:"₱",color:COLORS.php},{banks:sgdBanks,label:"SGD Accounts",sym:"S$",color:COLORS.sgd}].map(({banks,label,sym,color})=>
        banks.length>0&&(
          <div key={label} style={{marginBottom:20}}>
            <div style={{fontSize:13,fontWeight:600,color,marginBottom:8}}>{label}</div>
            {banks.map(b=>(
              <div key={b.id} style={{marginBottom:8}}>
                <div style={{display:"flex",justifyContent:"space-between",padding:"6px 0",borderBottom:"1px solid #334155",fontSize:14,color:"#cbd5e1",fontWeight:600}}>
                  <span>{b.name}</span><span style={{color}}>{sym}{fmt(bankTotal(b))}</span>
                </div>
                {(b.envelopes||[]).map(e=>(
                  <div key={e.id} style={{display:"flex",justifyContent:"space-between",padding:"4px 0 4px 14px",fontSize:12,color:e.isUnalloc?"#475569":"#94a3b8",fontStyle:e.isUnalloc?"italic":"normal"}}>
                    <span>{e.isUnalloc?"📂":"🗂️"} {e.name}{e.goal?` (${Math.min(100,Math.round((e.balance/e.goal)*100))}% of goal)`:""}</span>
                    <span style={{color:e.isUnalloc?"#475569":color}}>{sym}{fmt(e.balance)}</span>
                  </div>
                ))}
              </div>
            ))}
          </div>
        )
      )}
      {crypto.length>0&&<div style={{marginBottom:20}}>
        <div style={{fontSize:13,fontWeight:600,color:COLORS.crypto,marginBottom:8}}>Crypto Holdings</div>
        {crypto.map(h=><div key={h.id} style={{display:"flex",justifyContent:"space-between",padding:"6px 0",borderBottom:"1px solid #1e2130",fontSize:14,color:"#cbd5e1"}}><span>{h.coin} <span style={{color:"#475569"}}>({h.amount})</span></span><span style={{color:COLORS.crypto}}>${fmt(h.value)}</span></div>)}
      </div>}
      {investments.length>0&&<div>
        <div style={{fontSize:13,fontWeight:600,color:COLORS.invest,marginBottom:8}}>Investments</div>
        {investments.map(i=><div key={i.id} style={{display:"flex",justifyContent:"space-between",padding:"6px 0",borderBottom:"1px solid #1e2130",fontSize:14,color:"#cbd5e1"}}><span>{i.name} <span style={{color:"#475569"}}>({i.type})</span></span><span style={{color:COLORS.invest}}>${fmt(i.value)}</span></div>)}
      </div>}
    </div>
  );
}

function buildDataSummary(phpBanks,sgdBanks,crypto,investments) {
  const lines=["=== USER FINANCIAL DATA ===",`Date: ${new Date().toLocaleDateString()}`];
  lines.push("\n-- PHP Banks --");
  phpBanks.forEach(b=>{
    lines.push(`Bank: ${b.name} | Total: ₱${fmt(b.balance)}`);
    (b.envelopes||[]).forEach(e=>{lines.push(`  Envelope: ${e.name} | Balance: ₱${fmt(e.balance)}${e.goal?` | Goal: ₱${fmt(e.goal)} (${Math.min(100,Math.round((e.balance/e.goal)*100))}%)`:""}${e.isUnalloc?" [Unallocated]":""}`);e.transactions?.slice(0,5).forEach(t=>lines.push(`    Tx: ${t.type} ₱${fmt(t.amount)} - ${t.desc} (${t.date})`));});
  });
  lines.push("\n-- SGD Banks --");
  sgdBanks.forEach(b=>{
    lines.push(`Bank: ${b.name} | Total: S$${fmt(b.balance)}`);
    (b.envelopes||[]).forEach(e=>lines.push(`  Envelope: ${e.name} | Balance: S$${fmt(e.balance)}${e.goal?` | Goal: S$${fmt(e.goal)} (${Math.min(100,Math.round((e.balance/e.goal)*100))}%)`:""}${e.isUnalloc?" [Unallocated]":""}`));
  });
  lines.push("\n-- Crypto Holdings --");
  crypto.forEach(h=>lines.push(`${h.coin}: ${h.amount} tokens | Value: $${fmt(h.value)}${h.notes?` | ${h.notes}`:""}`));
  lines.push("\n-- Other Investments --");
  investments.forEach(i=>lines.push(`${i.name} (${i.type}): $${fmt(i.value)}${i.notes?` | ${i.notes}`:""}`));
  return lines.join("\n");
}

function AIAssistant({ phpBanks,sgdBanks,crypto,investments,setPhpBanks,setSgdBanks,setCrypto,setInvestments }) {
  const [messages,setMessages]=useState([{role:"assistant",content:'Hi! I can see all your financial data. Ask me anything or tell me what to do — like "add ₱5000 income to BDO Savings > Salary envelope" or "how much is left in my Emergency fund?"'}]);
  const [input,setInput]=useState("");
  const [loading,setLoading]=useState(false);
  const bottomRef=useRef(null);
  useEffect(()=>{bottomRef.current?.scrollIntoView({behavior:"smooth"});},[messages]);

  const applyActions=actions=>{
    if(!actions?.length)return;
    actions.forEach(action=>{
      try{
        if(action.type==="add_transaction"){
          const{currency,bankName,envelopeName,txType,amount,desc,category,date}=action;
          const banks=currency==="PHP"?phpBanks:sgdBanks;
          const setBanks=currency==="PHP"?setPhpBanks:setSgdBanks;
          const bank=banks.find(b=>b.name.toLowerCase().includes(bankName.toLowerCase()));if(!bank)return;
          const envId=bank.envelopes.find(e=>e.name.toLowerCase().includes(envelopeName.toLowerCase()))?.id;if(!envId)return;
          const amt=parseFloat(amount);const isIncome=txType==="income";
          const newTx={id:Date.now(),type:txType,desc,category:category||"",amount:amt,date:date||new Date().toISOString().slice(0,10)};
          setBanks(bs=>bs.map(b=>b.id!==bank.id?b:{...b,balance:b.balance+(isIncome?amt:-amt),envelopes:b.envelopes.map(e=>e.id!==envId?e:{...e,balance:e.balance+(isIncome?amt:-amt),transactions:[newTx,...e.transactions]})}));
        }else if(action.type==="transfer"){
          const{currency,bankName,fromEnvelope,toEnvelope,amount}=action;
          const banks=currency==="PHP"?phpBanks:sgdBanks;
          const setBanks=currency==="PHP"?setPhpBanks:setSgdBanks;
          const bank=banks.find(b=>b.name.toLowerCase().includes(bankName.toLowerCase()));if(!bank)return;
          const fromId=bank.envelopes.find(e=>e.name.toLowerCase().includes(fromEnvelope.toLowerCase()))?.id;
          const toId=bank.envelopes.find(e=>e.name.toLowerCase().includes(toEnvelope.toLowerCase()))?.id;
          if(!fromId||!toId)return;const amt=parseFloat(amount);
          setBanks(bs=>bs.map(b=>b.id!==bank.id?b:{...b,envelopes:b.envelopes.map(e=>e.id===fromId?{...e,balance:e.balance-amt}:e.id===toId?{...e,balance:e.balance+amt}:e)}));
        }else if(action.type==="update_crypto"){
          setCrypto(h=>h.map(x=>x.coin.toLowerCase()===action.coin.toLowerCase()?{...x,value:parseFloat(action.value)}:x));
        }else if(action.type==="update_investment"){
          setInvestments(i=>i.map(x=>x.name.toLowerCase().includes(action.name.toLowerCase())?{...x,value:parseFloat(action.value)}:x));
        }
      }catch(e){console.error("Action error",e);}
    });
  };

  const send=async()=>{
    if(!input.trim()||loading)return;
    const userMsg={role:"user",content:input.trim()};
    const newMsgs=[...messages,userMsg];
    setMessages(newMsgs);setInput("");setLoading(true);
    const dataSummary=buildDataSummary(phpBanks,sgdBanks,crypto,investments);
    const systemPrompt=`You are a personal finance assistant embedded in a finance tracker app. You have full access to the user's financial data below.\n\n${dataSummary}\n\nYou can answer questions about their finances AND perform actions. When performing actions, always respond with a JSON block at the END of your message in this exact format:\n\`\`\`actions\n[\n  {\n    "type": "add_transaction",\n    "currency": "PHP" or "SGD",\n    "bankName": "partial bank name",\n    "envelopeName": "partial envelope name",\n    "txType": "income" or "expense",\n    "amount": 1000,\n    "desc": "description",\n    "category": "category",\n    "date": "YYYY-MM-DD"\n  }\n]\n\`\`\`\n\nOther action types:\n- transfer: { type, currency, bankName, fromEnvelope, toEnvelope, amount }\n- update_crypto: { type, coin, value }\n- update_investment: { type, name, value }\n\nAlways confirm what you did in plain English before the JSON block. If just answering, no JSON needed. Be concise and friendly.`;
    try{
      const res=await fetch("https://api.anthropic.com/v1/messages",{method:"POST",headers:{"Content-Type":"application/json","x-api-key":import.meta.env.VITE_ANTHROPIC_API_KEY,"anthropic-version":"2023-06-01"},body:JSON.stringify({model:"claude-sonnet-4-6",max_tokens:1000,system:systemPrompt,messages:newMsgs.map(m=>({role:m.role,content:m.content}))})});
      const data=await res.json();
      const raw=data.content?.[0]?.text||"Sorry, I couldn't process that.";
      const actionMatch=raw.match(/```actions\n([\s\S]*?)```/);
      if(actionMatch){try{applyActions(JSON.parse(actionMatch[1]));}catch(e){console.error(e);}}
      setMessages(m=>[...m,{role:"assistant",content:raw.replace(/```actions[\s\S]*?```/g,"").trim()}]);
    }catch(e){setMessages(m=>[...m,{role:"assistant",content:"Something went wrong. Please try again."}]);}
    setLoading(false);
  };

  return (
    <div style={{display:"flex",flexDirection:"column",height:"60vh"}}>
      <div style={{flex:1,overflowY:"auto",display:"flex",flexDirection:"column",gap:12,marginBottom:12}}>
        {messages.map((m,i)=>(
          <div key={i} style={{display:"flex",justifyContent:m.role==="user"?"flex-end":"flex-start"}}>
            <div style={{maxWidth:"80%",background:m.role==="user"?COLORS.ai:"#1e2130",borderRadius:m.role==="user"?"12px 12px 2px 12px":"12px 12px 12px 2px",padding:"10px 14px",fontSize:14,color:"#f1f5f9",lineHeight:1.5,whiteSpace:"pre-wrap"}}>{m.content}</div>
          </div>
        ))}
        {loading&&<div style={{display:"flex",justifyContent:"flex-start"}}><div style={{background:"#1e2130",borderRadius:"12px 12px 12px 2px",padding:"10px 14px",fontSize:14,color:"#64748b"}}>Thinking…</div></div>}
        <div ref={bottomRef}/>
      </div>
      <div style={{display:"flex",gap:8}}>
        <input value={input} onChange={e=>setInput(e.target.value)} onKeyDown={e=>e.key==="Enter"&&!e.shiftKey&&send()} placeholder='e.g. "Add ₱3000 expense to BDO > Groceries"' style={{flex:1,background:"#1e2130",border:"1px solid #334155",borderRadius:10,padding:"10px 14px",color:"#f1f5f9",fontSize:14}}/>
        <Btn color={COLORS.ai} onClick={send} style={{whiteSpace:"nowrap"}}>Send</Btn>
      </div>
    </div>
  );
}

export default function FinanceTracker({ userId, userEmail, onSignOut }) {
  const [tab,setTab]=useState(0);
  const [phpBanks,setPhpBanks,undoPhp,redoPhp,canUndoPhp,canRedoPhp]=useUndoable([]);
  const [sgdBanks,setSgdBanks,undoSgd,redoSgd,canUndoSgd,canRedoSgd]=useUndoable([]);
  const [crypto,setCrypto]=useState([]);
  const [investments,setInvestments]=useState([]);
  const [syncStatus,setSyncStatus]=useState("loading");
  const saveTimerRef=useRef(null);
  const initialLoadDone=useRef(false);

  useEffect(()=>{
    (async()=>{
      setSyncStatus("loading");
      const data=await loadData(userId);
      if(data){
        if(data.phpBanks)setPhpBanks(data.phpBanks);
        if(data.sgdBanks)setSgdBanks(data.sgdBanks);
        if(data.crypto)setCrypto(data.crypto);
        if(data.investments)setInvestments(data.investments);
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
      await saveData(userId,{phpBanks,sgdBanks,crypto,investments});
      setSyncStatus("saved");
    },2000);
    return()=>clearTimeout(saveTimerRef.current);
  },[phpBanks,sgdBanks,crypto,investments,userId]);

  const phpUndo={undo:undoPhp,redo:redoPhp,canUndo:canUndoPhp,canRedo:canRedoPhp};
  const sgdUndo={undo:undoSgd,redo:redoSgd,canUndo:canUndoSgd,canRedo:canRedoSgd};

  return (
    <div style={{minHeight:"100vh",background:"#0f1117",color:"#f1f5f9",fontFamily:"system-ui,sans-serif"}}>
      <div style={{maxWidth:680,margin:"0 auto",padding:"0 16px 40px"}}>
        <div style={{padding:"20px 0 12px",borderBottom:"1px solid #1e2130",marginBottom:20,display:"flex",justifyContent:"space-between",alignItems:"flex-end"}}>
          <div>
            <div style={{fontSize:22,fontWeight:700}}>💰 Finance Tracker</div>
            <div style={{fontSize:13,color:"#475569"}}>{userEmail}</div>
          </div>
          <div style={{display:"flex",alignItems:"center",gap:10}}>
            <SyncBar status={syncStatus}/>
            <button onClick={onSignOut} style={{background:"transparent",border:"1px solid #334155",color:"#94a3b8",borderRadius:8,padding:"5px 12px",cursor:"pointer",fontSize:12}}>Sign out</button>
          </div>
        </div>
        <div style={{display:"flex",gap:6,overflowX:"auto",marginBottom:24,paddingBottom:4}}>
          {TABS.map((t,i)=>(
            <button key={t} onClick={()=>setTab(i)} style={{background:tab===i?[COLORS.php,COLORS.php,COLORS.sgd,COLORS.crypto,COLORS.invest,COLORS.ai][i]:"#1e2130",color:tab===i?"#fff":"#94a3b8",border:"none",borderRadius:8,padding:"7px 14px",cursor:"pointer",fontSize:13,fontWeight:500,whiteSpace:"nowrap"}}>{t}</button>
          ))}
        </div>
        {tab===0&&<Dashboard phpBanks={phpBanks} sgdBanks={sgdBanks} crypto={crypto} investments={investments}/>}
        {tab===1&&<BankSection banks={phpBanks} setBanks={setPhpBanks} currency="PHP" color={COLORS.php} undoProps={phpUndo}/>}
        {tab===2&&<BankSection banks={sgdBanks} setBanks={setSgdBanks} currency="SGD" color={COLORS.sgd} undoProps={sgdUndo}/>}
        {tab===3&&<CryptoSection holdings={crypto} setHoldings={setCrypto}/>}
        {tab===4&&<InvestSection investments={investments} setInvestments={setInvestments}/>}
        {tab===5&&<AIAssistant phpBanks={phpBanks} sgdBanks={sgdBanks} crypto={crypto} investments={investments} setPhpBanks={setPhpBanks} setSgdBanks={setSgdBanks} setCrypto={setCrypto} setInvestments={setInvestments}/>}
      </div>
    </div>
  );
}
