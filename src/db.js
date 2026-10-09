import { createClient } from "@supabase/supabase-js";
import { merge3 } from "./merge";

export const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY
);

// ── IndexedDB helpers ──
const DB_NAME = "finance_tracker_db";
const DB_VERSION = 1;
const STORE_DATA = "user_data";
const STORE_QUEUE = "sync_queue";

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = e => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(STORE_DATA)) {
        db.createObjectStore(STORE_DATA, { keyPath: "userId" });
      }
      if (!db.objectStoreNames.contains(STORE_QUEUE)) {
        db.createObjectStore(STORE_QUEUE, { keyPath: "id", autoIncrement: true });
      }
    };
    req.onsuccess = e => resolve(e.target.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbGet(store, key) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, "readonly");
    const req = tx.objectStore(store).get(key);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbPut(store, value) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, "readwrite");
    const req = tx.objectStore(store).put(value);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbGetAll(store) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, "readonly");
    const req = tx.objectStore(store).getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbClear(store) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, "readwrite");
    const req = tx.objectStore(store).clear();
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

// ── Local record ──
// { userId, payload, base, remoteStamp }
//   payload     = latest local state (includes edits not yet uploaded)
//   base        = last state known to be identical to the cloud copy
//   remoteStamp = the cloud row's updated_at when base was taken
// base + remoteStamp are what let us tell "the cloud changed under me" apart
// from "only I changed", so a stale device merges instead of overwriting.
const J = v => JSON.stringify(v);
async function getRec(userId) { return (await idbGet(STORE_DATA, userId)) || null; }
async function putRec(rec) { await idbPut(STORE_DATA, { ...rec, updatedAt: Date.now() }); }

export async function saveLocalNow(userId, payload) {
  const rec = await getRec(userId);
  await putRec({ ...(rec || {}), userId, payload });
}

// The queue is now just a "something is waiting to upload" marker. It used
// to hold old snapshots that were blindly uploaded on reconnect, which
// overwrote anything another device had saved in the meantime.
async function markDirty(userId, payload) {
  await idbClear(STORE_QUEUE);
  await idbPut(STORE_QUEUE, { userId, payload, queuedAt: Date.now() });
}
async function clearDirty() { await idbClear(STORE_QUEUE); }
async function hasPending() { return (await idbGetAll(STORE_QUEUE)).length > 0; }

// ── Supabase ──
async function fetchRemote(userId) {
  const { data, error } = await supabase
    .from("finance_data")
    .select("data, updated_at")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw error;
  return data || null;
}

// Compare-and-swap: only writes if the cloud row is still the version we
// read, so two devices can't both think they're up to date and clobber
// each other. {conflict:true} means someone else wrote first.
async function writeRemote(userId, payload, expectedStamp) {
  const now = new Date().toISOString();
  if (expectedStamp === null) {
    const { data, error } = await supabase
      .from("finance_data")
      .insert({ user_id: userId, data: payload, updated_at: now })
      .select("updated_at")
      .single();
    if (error) { if (error.code === "23505") return { conflict: true }; throw error; }
    return { stamp: data.updated_at };
  }
  const { data, error } = await supabase
    .from("finance_data")
    .update({ data: payload, updated_at: now })
    .eq("user_id", userId)
    .eq("updated_at", expectedStamp)
    .select("updated_at");
  if (error) throw error;
  if (!data || !data.length) return { conflict: true };
  return { stamp: data[0].updated_at };
}

// Everything that talks to the cloud runs one at a time, so a load, a save
// and a refresh can't interleave and leave base/stamp inconsistent.
let chain = Promise.resolve();
const serial = fn => { const run = chain.then(fn); chain = run.catch(() => {}); return run; };

async function syncPushInner(userId, payload) {
  let lastToWrite = payload;
  for (let attempt = 0; attempt < 4; attempt++) {
    const rec = await getRec(userId);
    if (rec?.base && J(rec.base) === J(payload)) return { status: "synced", merged: null }; // nothing new to upload
    const remote = await fetchRemote(userId);
    let toWrite = payload, merged = false;
    if (remote && remote.updated_at !== rec?.remoteStamp) {
      if (J(remote.data) === J(payload)) {
        await putRec({ ...(rec || {}), userId, payload, base: payload, remoteStamp: remote.updated_at });
        return { status: "synced", merged: null };
      }
      toWrite = merge3(rec?.base ?? null, payload, remote.data); // another device saved since we last synced
      merged = true;
    }
    lastToWrite = toWrite;
    const res = await writeRemote(userId, toWrite, remote ? remote.updated_at : null);
    if (res.conflict) continue; // lost a race — re-read and merge again
    const fresh = await getRec(userId);
    const keep = fresh && J(fresh.payload) !== J(payload) ? fresh.payload : toWrite; // don't clobber newer local edits
    await putRec({ ...(fresh || {}), userId, payload: keep, base: toWrite, remoteStamp: res.stamp });
    return { status: "synced", merged: merged ? toWrite : null };
  }
  // Kept losing races (or the server rejects the conditional write): fall back
  // to a plain upsert of the last merged result rather than failing to save.
  const { data, error } = await supabase
    .from("finance_data")
    .upsert({ user_id: userId, data: lastToWrite, updated_at: new Date().toISOString() }, { onConflict: "user_id" })
    .select("updated_at")
    .single();
  if (error) throw error;
  await putRec({ ...((await getRec(userId)) || {}), userId, payload: lastToWrite, base: lastToWrite, remoteStamp: data.updated_at });
  return { status: "synced", merged: lastToWrite };
}
const syncPush = (userId, payload) => serial(() => syncPushInner(userId, payload));

// ── Public API ──

// Load: reconcile local and cloud. Local edits made offline (or never
// uploaded) are merged with whatever another device saved, not discarded.
export async function loadData(userId) {
  const rec = await getRec(userId);
  if (!navigator.onLine) return rec?.payload || null;
  try {
    return await serial(async () => {
      const remote = await fetchRemote(userId);
      if (!remote) return rec?.payload || null;
      if (rec?.payload && rec.remoteStamp === remote.updated_at) return rec.payload; // in sync
      const dirty = rec?.payload ? (rec.base ? J(rec.payload) !== J(rec.base) : await hasPending()) : false;
      if (!dirty) {
        await putRec({ userId, payload: remote.data, base: remote.data, remoteStamp: remote.updated_at });
        return remote.data;
      }
      const merged = merge3(rec.base ?? null, rec.payload, remote.data);
      await putRec({ userId, payload: merged, base: remote.data, remoteStamp: remote.updated_at });
      return merged;
    });
  } catch {
    return rec?.payload || null; // network error — fall back to the local copy
  }
}

// Save: local copy first, then upload (merging if the cloud moved).
// Resolves to { status, merged } — merged is the combined state the UI
// should adopt when another device's changes were folded in.
export async function saveData(userId, payload) {
  await saveLocalNow(userId, payload);
  if (!navigator.onLine) {
    await markDirty(userId, payload);
    return { status: "queued-offline", merged: null };
  }
  try {
    const r = await syncPush(userId, payload);
    await clearDirty();
    return r;
  } catch {
    await markDirty(userId, payload);
    return { status: "queued-error", merged: null };
  }
}

// Pull in other devices' changes without waiting for a save. Resolves to
// { basePayload, payload } when the UI should update, otherwise null.
export function refreshFromRemote(userId, localPayload) {
  if (!navigator.onLine) return Promise.resolve(null);
  return serial(async () => {
    const rec = await getRec(userId);
    const remote = await fetchRemote(userId);
    if (!remote || rec?.remoteStamp === remote.updated_at) return null;
    const dirty = rec?.base ? J(localPayload) !== J(rec.base) : await hasPending();
    const next = dirty ? merge3(rec?.base ?? null, localPayload, remote.data) : remote.data;
    await putRec({ ...(rec || {}), userId, payload: next, base: remote.data, remoteStamp: remote.updated_at });
    return { basePayload: localPayload, payload: next };
  });
}

// Call this when the app comes back online
export async function syncWhenOnline(userId, getCurrentPayload, onResult) {
  const flush = async () => {
    if (!navigator.onLine) return;
    const payload = getCurrentPayload();
    if (!payload) return;
    try {
      const r = await syncPush(userId, payload);
      await clearDirty();
      onResult?.("synced", r);
    } catch {
      onResult?.("error");
    }
  };
  window.addEventListener("online", flush);
  return () => window.removeEventListener("online", flush);
}
