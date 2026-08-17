import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';

export const BOT_COLLECTION = 'keuangan_v2';

function getCredential() {
  const projectId = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKey = process.env.FIREBASE_PRIVATE_KEY;
  if (!projectId || !clientEmail || !privateKey) return null;
  return { projectId, clientEmail, privateKey: privateKey.replace(/\\n/g, '\n') };
}

let db = null;

export function getDb() {
  if (!db) {
    const cred = getCredential();
    if (!cred) {
      throw new Error('Env Firebase belum di-set (FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY)');
    }
    if (getApps().length === 0) {
      initializeApp({ credential: cert(cred) });
    }
    db = getFirestore();
  }
  return db;
}

export { FieldValue };