/**
 * Fiches & Cloud — Firebase Configuration & Initialization Service
 * 
 * Imports base64-encoded credentials from env-config.js, decodes them,
 * and initializes the Firebase Compat SDK (loaded from CDN into window.firebase).
 */

import { FIREBASE_CONFIG_ENCODED } from '../env-config.js';

/**
 * Safely decodes a base64-encoded ASCII or UTF-8 string.
 * @param {string} str 
 * @returns {string}
 */
function decodeBase64(str) {
  if (!str) return '';
  try {
    if (typeof atob === 'function') {
      return atob(str.trim());
    }
    if (typeof Buffer !== 'undefined') {
      return Buffer.from(str.trim(), 'base64').toString('utf-8');
    }
  } catch (error) {
    console.warn('[FirebaseConfig] Base64 decoding failed for a config parameter:', error);
  }
  return str;
}

/**
 * Decoded Firebase configuration object
 */
export const firebaseConfig = {
  apiKey: decodeBase64(FIREBASE_CONFIG_ENCODED?.apiKey),
  authDomain: decodeBase64(FIREBASE_CONFIG_ENCODED?.authDomain),
  projectId: decodeBase64(FIREBASE_CONFIG_ENCODED?.projectId),
  storageBucket: decodeBase64(FIREBASE_CONFIG_ENCODED?.storageBucket),
  messagingSenderId: decodeBase64(FIREBASE_CONFIG_ENCODED?.messagingSenderId),
  appId: decodeBase64(FIREBASE_CONFIG_ENCODED?.appId)
};

// Access the global Firebase compat object provided by CDN in index.html
const firebase = typeof window !== 'undefined' ? window.firebase : null;

let initializedApp = null;
let initializedAuth = null;
let initializedDb = null;

if (firebase) {
  try {
    if (firebase.apps && firebase.apps.length > 0) {
      initializedApp = firebase.app();
    } else {
      initializedApp = firebase.initializeApp(firebaseConfig);
    }
    
    if (typeof firebase.auth === 'function') {
      initializedAuth = firebase.auth();
    }
    
    if (typeof firebase.firestore === 'function') {
      initializedDb = firebase.firestore();
    }
  } catch (initError) {
    console.error('[FirebaseConfig] Error during Firebase initialization:', initError);
  }
} else {
  console.warn('[FirebaseConfig] window.firebase is not available. Ensure Firebase CDN scripts are included in index.html.');
}

export const app = initializedApp;
export const auth = initializedAuth;
export const db = initializedDb;
