/**
 * Fiches & Cloud — Authentication Service
 * 
 * Manages user authentication (sign-in, sign-up, sign-out, session state),
 * user profile synchronization with Firestore, and role-based access control.
 */

import { auth, db } from './firebase-config.js';

/**
 * Returns a server timestamp or current Date fallback.
 */
function getServerTimestamp() {
  const firebase = typeof window !== 'undefined' ? window.firebase : null;
  if (firebase?.firestore?.FieldValue?.serverTimestamp) {
    return firebase.firestore.FieldValue.serverTimestamp();
  }
  return new Date();
}

export const AuthService = {
  /**
   * Sign in an existing user with email and password.
   * Updates lastLogin in Firestore upon successful login.
   * 
   * @param {string} email 
   * @param {string} password 
   * @returns {Promise<firebase.auth.UserCredential>}
   */
  async signIn(email, password) {
    if (!auth) {
      throw new Error('Firebase Auth is not initialized');
    }

    const credential = await auth.signInWithEmailAndPassword(email.trim(), password);
    const user = credential.user;

    // Update lastLogin in Firestore user profile
    if (db && user) {
      try {
        const userRef = db.collection('users').doc(user.uid);
        const docSnap = await userRef.get();
        const timestamp = getServerTimestamp();

        if (docSnap.exists) {
          await userRef.update({
            lastLogin: timestamp
          });
        } else {
          // If the profile document doesn't exist yet, create default profile
          await userRef.set({
            email: user.email,
            displayName: user.displayName || user.email.split('@')[0],
            role: 'user',
            createdAt: timestamp,
            lastLogin: timestamp,
            quotaUsed: 0,
            quotaLimit: 500000,
            shortcuts: [
              { icon: 'folder', label: 'Fiches', action: 'file-explorer' },
              { icon: 'link', label: 'Liens', action: 'link-manager' }
            ]
          });
        }
      } catch (err) {
        console.warn('[AuthService] Could not update lastLogin profile in Firestore:', err);
      }
    }

    return credential;
  },

  /**
   * Register a new user with email, password, and displayName.
   * Creates a user profile document in Firestore.
   * 
   * @param {string} email 
   * @param {string} password 
   * @param {string} displayName 
   * @returns {Promise<firebase.auth.UserCredential>}
   */
  async signUp(email, password, displayName = '') {
    if (!auth) {
      throw new Error('Firebase Auth is not initialized');
    }

    const trimmedEmail = email.trim();
    const finalDisplayName = displayName.trim() || trimmedEmail.split('@')[0];

    const credential = await auth.createUserWithEmailAndPassword(trimmedEmail, password);
    const user = credential.user;

    // Set displayName on Firebase Auth user object
    if (user && typeof user.updateProfile === 'function') {
      try {
        await user.updateProfile({
          displayName: finalDisplayName
        });
      } catch (profileErr) {
        console.warn('[AuthService] Failed to set auth displayName:', profileErr);
      }
    }

    // Create user profile document in Firestore `users/{uid}`
    if (db && user) {
      const timestamp = getServerTimestamp();
      const profileData = {
        email: trimmedEmail,
        displayName: finalDisplayName,
        role: 'user',
        createdAt: timestamp,
        lastLogin: timestamp,
        quotaUsed: 0,
        quotaLimit: 500000,
        shortcuts: [
          { icon: 'folder', label: 'Fiches', action: 'file-explorer' },
          { icon: 'link', label: 'Liens', action: 'link-manager' }
        ]
      };

      await db.collection('users').doc(user.uid).set(profileData);
    }

    return credential;
  },

  /**
   * Sign out the currently authenticated user.
   * @returns {Promise<void>}
   */
  async signOut() {
    if (!auth) {
      throw new Error('Firebase Auth is not initialized');
    }
    await auth.signOut();
  },

  /**
   * Get the currently authenticated Firebase user or null.
   * @returns {firebase.User|null}
   */
  getCurrentUser() {
    return auth ? auth.currentUser : null;
  },

  /**
   * Listen to Firebase Auth state changes.
   * @param {(user: firebase.User|null) => void} callback 
   * @returns {() => void} Unsubscribe function
   */
  onAuthStateChanged(callback) {
    if (!auth) {
      console.warn('[AuthService] onAuthStateChanged called but auth is not initialized');
      return () => {};
    }
    return auth.onAuthStateChanged(callback);
  },

  /**
   * Fetch a user's Firestore profile document.
   * Defaults to current user if uid is omitted.
   * 
   * @param {string} [uid] 
   * @returns {Promise<Object|null>}
   */
  async getUserProfile(uid) {
    const targetUid = uid || (auth?.currentUser ? auth.currentUser.uid : null);
    if (!targetUid) return null;
    if (!db) {
      throw new Error('Firestore is not initialized');
    }

    const docSnap = await db.collection('users').doc(targetUid).get();
    if (docSnap.exists) {
      return { id: docSnap.id, ...docSnap.data() };
    }
    return null;
  },

  /**
   * Update fields on a user's Firestore profile document.
   * Defaults to current user if uid is omitted.
   * 
   * @param {string} uid 
   * @param {Object} data 
   * @returns {Promise<void>}
   */
  async updateUserProfile(uid, data) {
    const targetUid = uid || (auth?.currentUser ? auth.currentUser.uid : null);
    if (!targetUid) {
      throw new Error('No user specified or authenticated to update profile');
    }
    if (!db) {
      throw new Error('Firestore is not initialized');
    }

    await db.collection('users').doc(targetUid).update(data);
  },

  /**
   * Check if a given user (or currently logged in user) has the 'admin' role.
   * 
   * @param {string} [uid] 
   * @returns {Promise<boolean>}
   */
  async isAdmin(uid) {
    try {
      const targetUid = uid || (auth?.currentUser ? auth.currentUser.uid : null);
      if (!targetUid) return false;

      const profile = await this.getUserProfile(targetUid);
      return profile?.role === 'admin';
    } catch (err) {
      console.error('[AuthService] Error checking admin status:', err);
      return false;
    }
  }
};
