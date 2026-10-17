/**
 * Fiches & Cloud — Authentication service.
 *
 * Wraps Firebase Auth (email/password) and keeps a `users/{uid}` profile
 * document in Firestore in sync with each account.
 */

import { auth, db } from './firebase-config.js';

const DEFAULT_QUOTA = 500000;
const DEFAULT_AVATAR_COLOR = '#0078d4';

/** Firestore server timestamp, falling back to a client Date. */
function serverTimestamp() {
  const firebase = typeof window !== 'undefined' ? window.firebase : null;
  if (firebase?.firestore?.FieldValue?.serverTimestamp) {
    return firebase.firestore.FieldValue.serverTimestamp();
  }
  return new Date();
}

/** Shortcut bar defaults granted to every new account. */
export const DEFAULT_SHORTCUTS = [
  { icon: 'folder',   label: 'Fiches',   action: 'file-explorer' },
  { icon: 'add',      label: 'Nouvelle', action: 'markdown-editor' },
  { icon: 'link',     label: 'Liens',    action: 'link-manager' }
];

export const AuthService = {
  /**
   * Sign an existing user in and refresh `lastLogin` on their profile.
   * @param {string} email
   * @param {string} password
   * @returns {Promise<firebase.auth.UserCredential>}
   */
  async signIn(email, password) {
    if (!auth) throw new Error("Firebase Auth n'est pas initialisé.");

    const credential = await auth.signInWithEmailAndPassword(email.trim(), password);
    const user = credential.user;

    if (db && user) {
      try {
        const ref = db.collection('users').doc(user.uid);
        const snap = await ref.get();
        const timestamp = serverTimestamp();

        if (snap.exists) {
          await ref.update({ lastLogin: timestamp });
        } else {
          await ref.set({
            email: user.email,
            displayName: user.displayName || user.email.split('@')[0],
            bio: '',
            avatarColor: DEFAULT_AVATAR_COLOR,
            role: 'user',
            createdAt: timestamp,
            lastLogin: timestamp,
            quotaUsed: 0,
            quotaLimit: DEFAULT_QUOTA,
            shortcuts: DEFAULT_SHORTCUTS
          });
        }
      } catch (err) {
        console.warn('[AuthService] lastLogin update skipped:', err);
      }
    }

    return credential;
  },

  /**
   * Register a new account and create its Firestore profile.
   * @param {string} email
   * @param {string} password
   * @param {string} [displayName]
   * @returns {Promise<firebase.auth.UserCredential>}
   */
  async signUp(email, password, displayName = '') {
    if (!auth) throw new Error("Firebase Auth n'est pas initialisé.");

    const trimmedEmail = email.trim();
    const finalName = displayName.trim() || trimmedEmail.split('@')[0];

    const credential = await auth.createUserWithEmailAndPassword(trimmedEmail, password);
    const user = credential.user;

    if (user?.updateProfile) {
      try {
        await user.updateProfile({ displayName: finalName });
      } catch (err) {
        console.warn('[AuthService] displayName update skipped:', err);
      }
    }

    if (db && user) {
      const timestamp = serverTimestamp();
      await db.collection('users').doc(user.uid).set({
        email: trimmedEmail,
        displayName: finalName,
        bio: '',
        avatarColor: DEFAULT_AVATAR_COLOR,
        role: 'user',
        createdAt: timestamp,
        lastLogin: timestamp,
        quotaUsed: 0,
        quotaLimit: DEFAULT_QUOTA,
        shortcuts: DEFAULT_SHORTCUTS
      });
    }

    return credential;
  },

  /** Sign the current user out. */
  async signOut() {
    if (!auth) throw new Error("Firebase Auth n'est pas initialisé.");
    await auth.signOut();
  },

  /** @returns {firebase.User|null} */
  getCurrentUser() {
    return auth ? auth.currentUser : null;
  },

  /**
   * Subscribe to auth state changes.
   * @param {(user: firebase.User|null) => void} callback
   * @returns {() => void} unsubscribe
   */
  onAuthStateChanged(callback) {
    if (!auth) {
      console.warn('[AuthService] onAuthStateChanged called before auth init.');
      return () => {};
    }
    return auth.onAuthStateChanged(callback);
  },

  /**
   * Fetch a user's profile document (defaults to the current user).
   * @param {string} [uid]
   * @returns {Promise<Object|null>}
   */
  async getUserProfile(uid) {
    const target = uid || auth?.currentUser?.uid;
    if (!target || !db) return null;
    const snap = await db.collection('users').doc(target).get();
    return snap.exists ? { id: snap.id, ...snap.data() } : null;
  },

  /**
   * Patch fields on a user profile document (defaults to the current user).
   * `updatedAt` is refreshed automatically.
   * @param {string} uid
   * @param {Object} data
   */
  async updateUserProfile(uid, data) {
    const target = uid || auth?.currentUser?.uid;
    if (!target) throw new Error('Aucun utilisateur à mettre à jour.');
    if (!db) throw new Error("Firestore n'est pas initialisé.");
    await db.collection('users').doc(target).update({ ...data, updatedAt: serverTimestamp() });
  },

  /**
   * Send a password-reset email (defaults to the current user's address).
   * @param {string} [email]
   * @returns {Promise<void>}
   */
  async sendPasswordReset(email) {
    if (!auth) throw new Error("Firebase Auth n'est pas initialisé.");
    const target = (email || auth.currentUser?.email || '').trim();
    if (!target) throw new Error('Aucune adresse email associée à ce compte.');
    await auth.sendPasswordResetEmail(target);
  },

  /**
   * Whether a user has the admin role (defaults to the current user).
   * @param {string} [uid]
   * @returns {Promise<boolean>}
   */
  async isAdmin(uid) {
    try {
      const profile = await this.getUserProfile(uid);
      return profile?.role === 'admin';
    } catch (err) {
      console.error('[AuthService] isAdmin check failed:', err);
      return false;
    }
  }
};
