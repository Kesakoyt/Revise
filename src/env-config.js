/**
 * Fiches & Cloud — Active Environment Configuration
 *
 * This local file holds Base64-encoded Firebase credentials and is git-ignored.
 * The values below decode (via `atob`) to the plain Firebase Web App config for
 * the `revise-61c6b` project.
 *
 * NOTE ON SECURITY: Firebase Web App config values are *public by design* — they
 * identify the project, they do not authorise anything. Access control lives in
 * the Firestore Security Rules and Firebase Auth. The Base64 layer here is
 * obfuscation only (it keeps keys out of casual greps/forks), not encryption.
 * See README.md → "Firebase configuration".
 */

export const FIREBASE_CONFIG_ENCODED = {
  apiKey:            'QUl6YVN5RDBKMjdvQnhVYlpHNHVjVkpHOGtQTHVHMjFuUDdtQWNr', // "AIza…mAck"
  authDomain:        'cmV2aXNlLTYxYzZiLmZpcmViYXNlYXBwLmNvbQ==',             // "revise-61c6b.firebaseapp.com"
  projectId:         'cmV2aXNlLTYxYzZi',                                     // "revise-61c6b"
  storageBucket:     'cmV2aXNlLTYxYzZiLmZpcmViYXNlc3RvcmFnZS5hcHA=',        // "revise-61c6b.firebasestorage.app"
  messagingSenderId: 'NDEyMDUwMTgxNzY4',                                     // "412050181768"
  appId:             'MTo0MTIwNTAxODE3Njg6d2ViOjdmZmZiN2UwMzA2YzJkMmIxMWQ5M2Q=', // "1:412050181768:web:…"
  measurementId:     'Ry1SVFhDWk1YWDVZ'                                      // "G-RTXCZMXX5Y"
};
