import { getDb, BOT_COLLECTION } from './firebaseAdmin.js';

const BINDINGS_DOC = 'bot_bindings';
const PENDING_COLLECTION = 'bot_pending';
const CODE_TTL_MS = 10 * 60 * 1000;

export async function getBindings() {
  const doc = await getDb().collection(BOT_COLLECTION).doc(BINDINGS_DOC).get();
  return doc.exists ? (doc.data().list || []) : [];
}

export async function getBindingByChat(chatId) {
  const list = await getBindings();
  return list.find((b) => String(b.chatId) === String(chatId)) || null;
}

export async function getBindingByProfile(profileId) {
  const list = await getBindings();
  return list.find((b) => b.profileId === profileId) || null;
}

export async function setBinding(profileId, chatId, name) {
  const db = getDb();
  const list = await getBindings();
  const next = list.filter((b) => b.profileId !== profileId && String(b.chatId) !== String(chatId));
  next.push({ profileId, chatId: String(chatId), name, platform: 'telegram', boundAt: Date.now() });
  await db.collection(BOT_COLLECTION).doc(BINDINGS_DOC).set({ list: next });
  return next.find((b) => b.profileId === profileId);
}

export async function removeBinding(chatId) {
  const db = getDb();
  const list = await getBindings();
  const next = list.filter((b) => String(b.chatId) !== String(chatId));
  const removed = next.length !== list.length;
  if (removed) await db.collection(BOT_COLLECTION).doc(BINDINGS_DOC).set({ list: next });
  return removed;
}

export async function removeBindingByProfile(profileId) {
  const db = getDb();
  const list = await getBindings();
  const next = list.filter((b) => b.profileId !== profileId);
  const removed = next.length !== list.length;
  if (removed) await db.collection(BOT_COLLECTION).doc(BINDINGS_DOC).set({ list: next });
  return removed;
}

export async function createPending(profileId, name) {
  const db = getDb();
  const col = db.collection(BOT_COLLECTION).collection(PENDING_COLLECTION);
  let code = '';
  for (let i = 0; i < 10; i++) {
    code = String(Math.floor(100000 + Math.random() * 900000));
    const existing = await col.doc(code).get();
    if (!existing.exists) break;
  }
  const expiresAt = Date.now() + CODE_TTL_MS;
  await col.doc(code).set({ profileId, name, expiresAt });
  return { code, expiresAt };
}

export async function getPending(code) {
  if (!code) return null;
  const doc = await getDb().collection(BOT_COLLECTION).collection(PENDING_COLLECTION).doc(String(code)).get();
  return doc.exists ? doc.data() : null;
}

export async function deletePending(code) {
  if (!code) return;
  await getDb().collection(BOT_COLLECTION).collection(PENDING_COLLECTION).doc(String(code)).delete().catch(() => {});
}