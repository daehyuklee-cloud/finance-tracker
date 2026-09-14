// App-lock: a device-local gate (Face ID / Touch ID / Windows Hello via
// WebAuthn, or a PIN as fallback) shown before the app's data is rendered.
//
// This is deliberately NOT a server-verified auth factor — there's no
// backend to check a WebAuthn signature against, and that's fine: the job
// here isn't to prove identity to Supabase, it's to gate the *screen* the
// same way "Face ID to open this app" works in native apps. The OS/browser
// itself refuses to resolve the credential prompt without the correct
// biometric or device passcode, which is what actually stops a casual
// shoulder-surfer or someone picking up an unlocked phone. Supabase's own
// session is still what governs whether data can actually sync.

const LS_ENABLED = "lock_enabled";
const LS_CRED_ID = "lock_cred_id";
const LS_PIN_HASH = "lock_pin_hash";
const LS_PIN_SALT = "lock_pin_salt";

export function isWebAuthnSupported() {
  return typeof window !== "undefined" && !!window.PublicKeyCredential;
}

export function isLockEnabled() {
  try { return localStorage.getItem(LS_ENABLED) === "1"; } catch { return false; }
}

export function hasPin() {
  try { return !!localStorage.getItem(LS_PIN_HASH); } catch { return false; }
}

export function hasWebAuthnCredential() {
  try { return !!localStorage.getItem(LS_CRED_ID); } catch { return false; }
}

function randomBytes(n) {
  const a = new Uint8Array(n);
  crypto.getRandomValues(a);
  return a;
}
function toB64(buf) { return btoa(String.fromCharCode(...new Uint8Array(buf))); }
function fromB64(str) { return Uint8Array.from(atob(str), c => c.charCodeAt(0)); }

// ── WebAuthn (Face ID / Touch ID / Windows Hello) ──
export async function enrollWebAuthn(userId, userEmail) {
  const challenge = randomBytes(32);
  const cred = await navigator.credentials.create({
    publicKey: {
      challenge,
      rp: { name: "acountee" },
      user: { id: new TextEncoder().encode(userId || "acountee-user"), name: userEmail || "acountee", displayName: userEmail || "acountee" },
      pubKeyCredParams: [{ type: "public-key", alg: -7 }, { type: "public-key", alg: -257 }],
      authenticatorSelection: { authenticatorAttachment: "platform", userVerification: "required" },
      timeout: 60000,
    },
  });
  if (!cred) throw new Error("Enrollment cancelled");
  localStorage.setItem(LS_CRED_ID, toB64(cred.rawId));
  localStorage.setItem(LS_ENABLED, "1");
  return true;
}

export async function verifyWebAuthn() {
  const credId = localStorage.getItem(LS_CRED_ID);
  if (!credId) throw new Error("No credential enrolled");
  const challenge = randomBytes(32);
  const assertion = await navigator.credentials.get({
    publicKey: {
      challenge,
      allowCredentials: [{ id: fromB64(credId), type: "public-key" }],
      userVerification: "required",
      timeout: 60000,
    },
  });
  return !!assertion;
}

// ── PIN fallback (for browsers/devices without a platform authenticator) ──
async function sha256Hex(text) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, "0")).join("");
}
export async function setPin(pin) {
  const salt = toB64(randomBytes(16));
  const hash = await sha256Hex(salt + pin);
  localStorage.setItem(LS_PIN_SALT, salt);
  localStorage.setItem(LS_PIN_HASH, hash);
  localStorage.setItem(LS_ENABLED, "1");
}
export async function verifyPin(pin) {
  const salt = localStorage.getItem(LS_PIN_SALT) || "";
  const hash = localStorage.getItem(LS_PIN_HASH);
  if (!hash) return false;
  return (await sha256Hex(salt + pin)) === hash;
}

export function disableLock() {
  localStorage.removeItem(LS_ENABLED);
  localStorage.removeItem(LS_CRED_ID);
  localStorage.removeItem(LS_PIN_HASH);
  localStorage.removeItem(LS_PIN_SALT);
}

// ── Offline-friendly identity cache ──
// Supabase's own getSession() can fail to resolve when the access token has
// expired and there's no network to refresh it — leaving an otherwise
// legitimate, already-signed-in user stuck on a Google sign-in screen they
// can't complete offline. We cache just enough of the last good session to
// keep the app usable (against locally-cached data) until connectivity is
// back, gated behind the same app lock when one is set up.
const LS_CACHED_USER = "cached_user";
export function cacheUser(user) {
  try { localStorage.setItem(LS_CACHED_USER, JSON.stringify({ ...user, cachedAt: Date.now() })); } catch {}
}
export function getCachedUser() {
  try {
    const raw = JSON.parse(localStorage.getItem(LS_CACHED_USER) || "null");
    if (!raw) return null;
    // Don't trust a cache older than 30 days as a login stand-in.
    if (Date.now() - (raw.cachedAt || 0) > 30 * 24 * 60 * 60 * 1000) return null;
    return raw;
  } catch { return null; }
}
export function clearCachedUser() {
  try { localStorage.removeItem(LS_CACHED_USER); } catch {}
}
