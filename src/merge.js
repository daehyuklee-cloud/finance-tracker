// Three-way merge for the app's synced payload.
//
// Every save used to upload the whole document and replace whatever was in
// the cloud, so a device holding stale data silently erased what another
// device had added. merge3 combines two diverged copies instead:
//
//   base   = the last state this device knew was identical to the cloud
//   local  = what this device has now
//   remote = what the cloud has now
//
// Rule of thumb everywhere: if only one side changed a thing, take that
// side's version; if both changed it, merge the parts (transactions are
// unioned by id, balances re-derived from the union), and where it truly
// can't be merged, this device's version wins. Nothing is ever dropped
// just because the other side didn't know about it.
//
// With no base (first sync after this feature shipped) everything counts as
// "added on both sides", i.e. a union — safe against loss, at worst it can
// bring back something that was deleted.

const J = v => JSON.stringify(v);
const changed = (a, b) => J(a) !== J(b);
const idOf = x => String(x.id);
const r2 = n => Math.round((n + Number.EPSILON) * 100) / 100;
const signed = t => (t.type === "income" ? t.amount : -t.amount);
const sumTx = txs => (txs || []).reduce((s, t) => s + signed(t), 0);
const sumEnv = es => (es || []).reduce((s, e) => s + e.balance, 0);
const asList = v => (Array.isArray(v) ? v : []);

// Merge two lists of {id,...} items against a common base.
// addAt: where items that exist only locally go ("front" for transaction
// lists, which are newest-first; "end" for banks/envelopes/etc).
export function mergeList(base, local, remote, mergeItem, addAt = "end") {
  base = asList(base); local = asList(local); remote = asList(remote);
  const bm = new Map(base.map(x => [idOf(x), x]));
  const lm = new Map(local.map(x => [idOf(x), x]));
  const rm = new Map(remote.map(x => [idOf(x), x]));
  const out = [];
  for (const r of remote) {
    const id = idOf(r), l = lm.get(id), b = bm.get(id);
    if (l === undefined) {
      // not here: either added remotely (keep) or deleted here (stays
      // deleted unless the other side edited it since)
      if (b !== undefined && !changed(r, b)) continue;
      out.push(r);
    } else if (b === undefined) out.push(mergeItem(undefined, l, r));
    else if (!changed(l, b)) out.push(r);
    else if (!changed(r, b)) out.push(l);
    else out.push(mergeItem(b, l, r));
  }
  const added = [];
  for (const l of local) {
    if (rm.has(idOf(l))) continue;
    const b = bm.get(idOf(l));
    if (b !== undefined && !changed(l, b)) continue; // deleted remotely, untouched here
    added.push(l);
  }
  return addAt === "front" ? [...added, ...out] : [...out, ...added];
}

// Per-field pick for the non-list fields of an object: if this side didn't
// change the field take the other side's, otherwise ours.
function mergeFields(b, l, r, skip) {
  const out = {};
  for (const k of new Set([...Object.keys(l), ...Object.keys(r)])) {
    if (skip.includes(k)) continue;
    const v = b ? (changed(l[k], b[k]) ? l[k] : r[k]) : (l[k] !== undefined ? l[k] : r[k]);
    if (v !== undefined) out[k] = v;
  }
  return out;
}

const keepLocal = (_b, l) => l;

function mergeEnvelope(b, l, r) {
  const txs = mergeList(b?.transactions, l.transactions, r.transactions, keepLocal, "front");
  // balance changes that no transaction explains (a manual bank-total edit)
  const unexplained = b ? (l.balance - b.balance) - (sumTx(l.transactions) - sumTx(b.transactions)) : 0;
  const balance = r2(r.balance + (sumTx(txs) - sumTx(r.transactions)) + unexplained);
  return { ...mergeFields(b, l, r, ["transactions", "balance"]), balance, transactions: txs };
}

function mergeBank(b, l, r) {
  const envelopes = mergeList(b?.envelopes, l.envelopes, r.envelopes, mergeEnvelope, "end");
  const unexplained = b ? (l.balance - b.balance) - (sumEnv(l.envelopes) - sumEnv(b.envelopes)) : 0;
  const balance = r2(r.balance + (sumEnv(envelopes) - sumEnv(r.envelopes)) + unexplained);
  return { ...mergeFields(b, l, r, ["envelopes", "balance"]), balance, envelopes };
}

function mergeInvestment(b, l, r) {
  const items = mergeList(b?.items, l.items, r.items, keepLocal, "end");
  return { ...mergeFields(b, l, r, ["items"]), items };
}

const listOfIds = v => Array.isArray(v) && v.every(x => x && typeof x === "object" && x.id !== undefined);

function mergeValue(key, b, l, r) {
  if (key === "banks" && Array.isArray(l) && Array.isArray(r)) return mergeList(b, l, r, mergeBank, "end");
  if (key === "investments" && Array.isArray(l) && Array.isArray(r)) return mergeList(b, l, r, mergeInvestment, "end");
  if (key === "notes" && listOfIds(l) && listOfIds(r) && (b === undefined || listOfIds(b))) return mergeList(b, l, r, keepLocal, "end");
  if (key === "tags" && Array.isArray(l) && Array.isArray(r)) {
    const deletedHere = asList(b).filter(t => !l.includes(t));
    return [...r.filter(t => !deletedHere.includes(t)), ...l.filter(t => !r.includes(t))];
  }
  return l; // settings and other scalars: this device wins a true conflict
}

export function merge3(base, local, remote) {
  const hasBase = base && typeof base === "object";
  const out = {};
  for (const k of new Set([...Object.keys(local || {}), ...Object.keys(remote || {})])) {
    const l = local?.[k], r = remote?.[k];
    let v;
    if (!hasBase || !(k in base)) {
      v = l === undefined ? r : r === undefined ? l : mergeValue(k, undefined, l, r);
    } else {
      const b = base[k];
      v = !changed(l, b) ? r : !changed(r, b) ? l : mergeValue(k, b, l, r);
    }
    if (v !== undefined) out[k] = v;
  }
  return out;
}
