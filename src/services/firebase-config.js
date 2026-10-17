/**
 * Fiches & Cloud — Firebase bootstrap.
 *
 * Decodes the Base64 credentials from `env-config.js`, initialises the Firebase
 * compat SDK exposed as `window.firebase` by the CDN scripts, and exports the
 * `app`, `auth` and `db` handles used by the rest of the application.
 */

import { FIREBASE_CONFIG_ENCODED } from '../env-config.js';

/**
 * Decode a Base64 string, tolerating whitespace and missing globals.
 * @param {string} [value]
 * @returns {string}
 */
function decodeBase64(value) {
  if (!value) return '';
  const trimmed = String(value).trim();
  try {
    if (typeof atob === 'function') return atob(trimmed);
    if (typeof Buffer !== 'undefined') return Buffer.from(trimmed, 'base64').toString('utf-8');
  } catch (err) {
    console.warn('[FirebaseConfig] Base64 decoding failed:', err);
  }
  return trimmed;
}

/** Decoded Firebase web configuration. */
export const firebaseConfig = {
  apiKey:            decodeBase64(FIREBASE_CONFIG_ENCODED?.apiKey),
  authDomain:        decodeBase64(FIREBASE_CONFIG_ENCODED?.authDomain),
  projectId:         decodeBase64(FIREBASE_CONFIG_ENCODED?.projectId),
  storageBucket:     decodeBase64(FIREBASE_CONFIG_ENCODED?.storageBucket),
  messagingSenderId: decodeBase64(FIREBASE_CONFIG_ENCODED?.messagingSenderId),
  appId:             decodeBase64(FIREBASE_CONFIG_ENCODED?.appId)
};

/** True when the config looks like real credentials rather than placeholders. */
export const isConfigured = Boolean(
  firebaseConfig.apiKey && !firebaseConfig.apiKey.startsWith('demo-')
);

const firebase = typeof window !== 'undefined' ? window.firebase : null;

let appRef = null;
let authRef = null;
let dbRef = null;

if (firebase) {
  try {
    appRef = (firebase.apps && firebase.apps.length > 0)
      ? firebase.app()
      : firebase.initializeApp(firebaseConfig);

    if (typeof firebase.auth === 'function') authRef = firebase.auth();
    if (typeof firebase.firestore === 'function') dbRef = firebase.firestore();
  } catch (err) {
    console.error('[FirebaseConfig] Initialisation error:', err);
  }
} else {
  console.warn('[FirebaseConfig] window.firebase unavailable — check the CDN <script> tags in index.html.');
}

export const app = appRef;
export const auth = authRef;
export const db = dbRef;
