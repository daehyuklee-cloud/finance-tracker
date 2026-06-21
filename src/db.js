import { createClient } from "@supabase/supabase-js";

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

// ── Local cache ──
async function saveLocal(userId, payload) {
  await idbPut(STORE_DATA, { userId, payload, updatedAt: Date.now() });
}

async function loadLocal(userId) {
  const row = await idbGet(STORE_DATA, userId);
  return row?.payload || null;
}

// ── Sync queue (offline writes) ──
async function enqueueSync(userId, payload) {
  await idbPut(STORE_QUEUE, { userId, payload, queuedAt: Date.now() });
}

async function flushSyncQueue() {
  const items = await idbGetAll(STORE_QUEUE);
  if (!items.length) return;
  for (const item of items) {
    try {
      await pushToSupabase(item.userId, item.payload);
    } catch { break; } // stop if network fails mid-flush
  }
  await idbClear(STORE_QUEUE);
}

// ── Supabase operations ──
async function pushToSupabase(userId, payload) {
  const { error } = await supabase
    .from("finance_data")
    .upsert({ user_id: userId, data: payload, updated_at: new Date().toISOString() }, { onConflict: "user_id" });
  if (error) throw error;
}

async function pullFromSupabase(userId) {
  const { data, error } = await supabase
    .from("finance_data")
    .select("data")
    .eq("user_id", userId)
    .single();
  if (error) return null;
  return data?.data || null;
}

// ── Public API ──

// Load: try Supabase first, fall back to local cache
export async function loadData(userId) {
  if (navigator.onLine) {
    try {
      await flushSyncQueue(); // push any queued offline changes first
      const remote = await pullFromSupabase(userId);
      if (remote) {
        await saveLocal(userId, remote); // keep local cache fresh
        return remote;
      }
    } catch {
      // network error — fall through to local
    }
  }
  return loadLocal(userId);
}

// Save: save locally always, push to Supabase if online, queue if offline
export async function saveData(userId, payload) {
  await saveLocal(userId, payload);
  if (navigator.onLine) {
    try {
      await pushToSupabase(userId, payload);
    } catch {
      await enqueueSync(userId, payload);
    }
  } else {
    await enqueueSync(userId, payload);
  }
}

// Call this when the app comes back online
export async function syncWhenOnline(userId, getCurrentPayload) {
  const flush = async () => {
    if (!navigator.onLine) return;
    try {
      await flushSyncQueue();
      // also push current state in case queue was empty but data changed
      await pushToSupabase(userId, getCurrentPayload());
    } catch {}
  };
  window.addEventListener("online", flush);
  return () => window.removeEventListener("online", flush);
}
