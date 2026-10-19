/**
 * Fiches & Cloud — Firestore data service.
 *
 * Single entry point for every database operation grouped by domain:
 *   • Notes      — Markdown study cards      (collection `notes`)
 *   • Links      — external bookmarks         (collection `links`)
 *   • Folders    — explorer hierarchy          (collection `folders`)
 *   • Shortcuts  — nav-bar quick actions      (collection `shortcuts`)
 *   • Logs       — audit trail                (collection `accessLogs`)
 *   • Admin      — cross-user reads, roles, statistics
 *
 * All ordered queries degrade gracefully to a client-side sort when a
 * composite Firestore index is missing, so the app never hard-fails.
 */

import { db } from './firebase-config.js';

export const COLLECTIONS = Object.freeze({
  NOTES: 'notes',
  LINKS: 'links',
  FOLDERS: 'folders',
  SHORTCUTS: 'shortcuts',
  USERS: 'users',
  LOGS: 'accessLogs'
});

/** Firestore server timestamp, falling back to a client Date. */
function serverTimestamp() {
  const firebase = typeof window !== 'undefined' ? window.firebase : null;
  if (firebase?.firestore?.FieldValue?.serverTimestamp) {
    return firebase.firestore.FieldValue.serverTimestamp();
  }
  return new Date();
}

/** Current authenticated uid, if any. */
function currentUid() {
  return (typeof window !== 'undefined' && window.firebase?.auth?.()?.currentUser?.uid) || null;
}

/**
 * Client-side sort tolerant of strings, numbers, Dates and Firestore Timestamps.
 * @param {Array<Object>} items
 * @param {string} key
 * @param {'asc'|'desc'} dir
 * @returns {Array<Object>}
 */
function sortBy(items, key = 'updatedAt', dir = 'desc') {
  return [...items].sort((a, b) => {
    let x = a[key];
    let y = b[key];

    if (x && typeof x.toDate === 'function') x = x.toDate().getTime();
    if (y && typeof y.toDate === 'function') y = y.toDate().getTime();
    if (x instanceof Date) x = x.getTime();
    if (y instanceof Date) y = y.getTime();
    if (typeof x === 'string') x = x.toLowerCase();
    if (typeof y === 'string') y = y.toLowerCase();
    if (x === undefined || x === null) x = '';
    if (y === undefined || y === null) y = '';

    if (x < y) return dir === 'asc' ? -1 : 1;
    if (x > y) return dir === 'asc' ? 1 : -1;
    return 0;
  });
}

export const FirestoreService = {
  // ==========================================================================
  // Notes
  // ==========================================================================

  /**
   * Create a note.
   * @param {{uid:string,title:string,content?:string,subject?:string,topic?:string,isPublic?:boolean,parentId?:string|null}} p
   * @returns {Promise<string>} new document id
   */
  async createNote({ uid, title, content = '', subject = 'Général', topic = '', isPublic = false, parentId = null }) {
    if (!db) throw new Error("Firestore n'est pas initialisé.");
    const timestamp = serverTimestamp();

    const ref = await db.collection(COLLECTIONS.NOTES).add({
      uid,
      title: title?.trim() || 'Sans titre',
      content: content || '',
      subject: subject?.trim() || 'Général',
      topic: topic?.trim() || '',
      isPublic: Boolean(isPublic),
      parentId: parentId || null,
      charCount: (content || '').length,
      createdAt: timestamp,
      updatedAt: timestamp
    });

    return ref.id;
  },

  /** @param {string} noteId @returns {Promise<Object|null>} */
  async getNote(noteId) {
    if (!db || !noteId) return null;
    const doc = await db.collection(COLLECTIONS.NOTES).doc(noteId).get();
    return doc.exists ? { id: doc.id, ...doc.data() } : null;
  },

  /**
   * Patch a note; `updatedAt` and `charCount` are kept in sync automatically.
   * @param {string} noteId
   * @param {Object} data
   */
  async updateNote(noteId, data) {
    if (!db) throw new Error("Firestore n'est pas initialisé.");
    if (!noteId) throw new Error('Identifiant de fiche requis.');

    const payload = { ...data, updatedAt: serverTimestamp() };
    if (typeof data.content === 'string') payload.charCount = data.content.length;

    await db.collection(COLLECTIONS.NOTES).doc(noteId).update(payload);
  },

  /** Delete a note by id. */
  async deleteNote(noteId) {
    if (!db || !noteId) return;
    await db.collection(COLLECTIONS.NOTES).doc(noteId).delete();
  },

  /**
   * Notes owned by a user.
   * @param {string} uid
   * @param {{subject?:string,topic?:string,sortBy?:string,sortDir?:'asc'|'desc'}} [filters]
   * @returns {Promise<Array<Object>>}
   */
  async getUserNotes(uid, { subject, topic, sortBy: key = 'updatedAt', sortDir = 'desc' } = {}) {
    if (!db || !uid) return [];

    let query = db.collection(COLLECTIONS.NOTES).where('uid', '==', uid);
    if (subject && subject !== 'all') query = query.where('subject', '==', subject);
    if (topic && topic !== 'all') query = query.where('topic', '==', topic);

    let snapshot;
    try {
      snapshot = await query.orderBy(key, sortDir).get();
    } catch (err) {
      console.warn('[Firestore] getUserNotes fallback (no index):', err.message);
      snapshot = await query.get();
    }

    return sortBy(snapshot.docs.map(d => ({ id: d.id, ...d.data() })), key, sortDir);
  },

  /**
   * Every public note across all users.
   * @param {{subject?:string,sortBy?:string,sortDir?:'asc'|'desc'}} [filters]
   * @returns {Promise<Array<Object>>}
   */
  async getPublicNotes({ subject, sortBy: key = 'updatedAt', sortDir = 'desc' } = {}) {
    if (!db) throw new Error("Firestore n'est pas initialisé.");

    let query = db.collection(COLLECTIONS.NOTES).where('isPublic', '==', true);
    if (subject && subject !== 'all') query = query.where('subject', '==', subject);

    let snapshot;
    try {
      snapshot = await query.orderBy(key, sortDir).get();
    } catch (err) {
      console.warn('[Firestore] getPublicNotes fallback (no index):', err.message);
      snapshot = await query.get();
    }

    return sortBy(snapshot.docs.map(d => ({ id: d.id, ...d.data() })), key, sortDir);
  },

  // ==========================================================================
  // Links
  // ==========================================================================

  /**
   * Create a bookmark.
   * @param {{uid:string,title:string,url:string,description?:string,subject?:string,parentId?:string|null,isPublic?:boolean}} p
   * @returns {Promise<string>} new document id
   */
  async createLink({ uid, title, url, description = '', subject = 'Général', parentId = null, isPublic = false }) {
    if (!db) throw new Error("Firestore n'est pas initialisé.");
    const timestamp = serverTimestamp();

    const ref = await db.collection(COLLECTIONS.LINKS).add({
      uid,
      title: title?.trim() || 'Sans titre',
      url: url?.trim() || '',
      description: description?.trim() || '',
      subject: subject?.trim() || 'Général',
      parentId: parentId || null,
      isPublic: Boolean(isPublic),
      createdAt: timestamp,
      updatedAt: timestamp
    });

    return ref.id;
  },

  /** @param {string} linkId @returns {Promise<Object|null>} */
  async getLink(linkId) {
    if (!db || !linkId) return null;
    const doc = await db.collection(COLLECTIONS.LINKS).doc(linkId).get();
    return doc.exists ? { id: doc.id, ...doc.data() } : null;
  },

  /** Patch a bookmark. */
  async updateLink(linkId, data) {
    if (!db) throw new Error("Firestore n'est pas initialisé.");
    if (!linkId) throw new Error('Identifiant de lien requis.');
    await db.collection(COLLECTIONS.LINKS).doc(linkId).update({ ...data, updatedAt: serverTimestamp() });
  },

  /** Delete a bookmark. */
  async deleteLink(linkId) {
    if (!db || !linkId) return;
    await db.collection(COLLECTIONS.LINKS).doc(linkId).delete();
  },

  /**
   * Links owned by a user.
   * @param {string} uid
   * @param {{subject?:string}} [filters]
   * @returns {Promise<Array<Object>>}
   */
  async getUserLinks(uid, { subject } = {}) {
    if (!db || !uid) return [];

    let query = db.collection(COLLECTIONS.LINKS).where('uid', '==', uid);
    if (subject && subject !== 'all') query = query.where('subject', '==', subject);

    let snapshot;
    try {
      snapshot = await query.orderBy('updatedAt', 'desc').get();
    } catch (err) {
      console.warn('[Firestore] getUserLinks fallback (no index):', err.message);
      snapshot = await query.get();
    }

    return sortBy(snapshot.docs.map(d => ({ id: d.id, ...d.data() })), 'updatedAt', 'desc');
  },

  /**
   * Every public link across all users.
   * @param {{subject?:string,sortBy?:string,sortDir?:'asc'|'desc'}} [filters]
   * @returns {Promise<Array<Object>>}
   */
  async getPublicLinks({ subject, sortBy: key = 'updatedAt', sortDir = 'desc' } = {}) {
    if (!db) throw new Error("Firestore n'est pas initialisé.");

    let query = db.collection(COLLECTIONS.LINKS).where('isPublic', '==', true);
    if (subject && subject !== 'all') query = query.where('subject', '==', subject);

    let snapshot;
    try {
      snapshot = await query.orderBy(key, sortDir).get();
    } catch (err) {
      console.warn('[Firestore] getPublicLinks fallback (no index):', err.message);
      snapshot = await query.get();
    }

    return sortBy(snapshot.docs.map(d => ({ id: d.id, ...d.data() })), key, sortDir);
  },

  // ==========================================================================
  // Folders (file-explorer hierarchy)
  // ==========================================================================

  /**
   * Create a folder.
   * @param {{uid:string,name:string,parentId?:string|null}} p
   * @returns {Promise<string>} new document id
   */
  async createFolder({ uid, name, parentId = null }) {
    if (!db) throw new Error("Firestore n'est pas initialisé.");
    const timestamp = serverTimestamp();

    const ref = await db.collection(COLLECTIONS.FOLDERS).add({
      uid,
      name: name?.trim() || 'Nouveau dossier',
      parentId: parentId || null,
      createdAt: timestamp,
      updatedAt: timestamp
    });

    return ref.id;
  },

  /** @param {string} folderId @returns {Promise<Object|null>} */
  async getFolder(folderId) {
    if (!db || !folderId) return null;
    const doc = await db.collection(COLLECTIONS.FOLDERS).doc(folderId).get();
    return doc.exists ? { id: doc.id, ...doc.data() } : null;
  },

  /**
   * Every folder owned by a user (flat list; build the tree client-side).
   * @param {string} uid
   * @returns {Promise<Array<Object>>}
   */
  async getUserFolders(uid) {
    if (!db || !uid) return [];

    let snapshot;
    try {
      snapshot = await db.collection(COLLECTIONS.FOLDERS).where('uid', '==', uid).orderBy('name', 'asc').get();
    } catch (err) {
      console.warn('[Firestore] getUserFolders fallback (no index):', err.message);
      snapshot = await db.collection(COLLECTIONS.FOLDERS).where('uid', '==', uid).get();
    }

    return sortBy(snapshot.docs.map(d => ({ id: d.id, ...d.data() })), 'name', 'asc');
  },

  /** Patch a folder (rename or move); `updatedAt` is refreshed. */
  async updateFolder(folderId, data) {
    if (!db) throw new Error("Firestore n'est pas initialisé.");
    if (!folderId) throw new Error('Identifiant de dossier requis.');
    await db.collection(COLLECTIONS.FOLDERS).doc(folderId).update({ ...data, updatedAt: serverTimestamp() });
  },

  /** Delete a folder document (its contents are handled by the caller). */
  async deleteFolder(folderId) {
    if (!db || !folderId) return;
    await db.collection(COLLECTIONS.FOLDERS).doc(folderId).delete();
  },

  // ==========================================================================
  // Shortcuts (nav-bar quick actions)
  // ==========================================================================

  /**
   * Create a shortcut for the navigation bar.
   * @param {{uid:string,label:string,icon?:string,action:string,order?:number}} p
   * @returns {Promise<string>} new document id
   */
  async createShortcut({ uid, label, icon = 'star', action, order = 0 }) {
    if (!db) throw new Error("Firestore n'est pas initialisé.");
    const ref = await db.collection(COLLECTIONS.SHORTCUTS).add({
      uid,
      label: label?.trim() || 'Raccourci',
      icon: icon?.trim() || 'star',
      action: action?.trim() || '',
      order: Number(order) || 0,
      createdAt: serverTimestamp()
    });
    return ref.id;
  },

  /** Patch a shortcut (used by the admin inspector). */
  async updateShortcut(id, data) {
    if (!db || !id) return;
    await db.collection(COLLECTIONS.SHORTCUTS).doc(id).update({ ...data, updatedAt: serverTimestamp() });
  },

  /** Delete a shortcut. */
  async deleteShortcut(id) {
    if (!db || !id) return;
    await db.collection(COLLECTIONS.SHORTCUTS).doc(id).delete();
  },

  /**
   * Shortcuts owned by a user, ordered.
   * @param {string} uid
   * @returns {Promise<Array<Object>>}
   */
  async getUserShortcuts(uid) {
    if (!db || !uid) return [];

    let snapshot;
    try {
      snapshot = await db.collection(COLLECTIONS.SHORTCUTS).where('uid', '==', uid).orderBy('order', 'asc').get();
    } catch (err) {
      console.warn('[Firestore] getUserShortcuts fallback (no index):', err.message);
      snapshot = await db.collection(COLLECTIONS.SHORTCUTS).where('uid', '==', uid).get();
    }

    return sortBy(snapshot.docs.map(d => ({ id: d.id, ...d.data() })), 'order', 'asc');
  },

  // ==========================================================================
  // Audit log
  // ==========================================================================

  /**
   * Append an activity event to `accessLogs` (best-effort, never throws).
   * @param {{uid?:string,documentId?:string,documentType?:string,action?:string}} entry
   */
  async logAccess({ uid, documentId, documentType, action }) {
    if (!db) return;
    try {
      await db.collection(COLLECTIONS.LOGS).add({
        uid: uid || 'anonymous',
        documentId: documentId || '',
        documentType: documentType || 'note',
        action: action || 'view',
        timestamp: serverTimestamp()
      });
    } catch (err) {
      console.warn('[Firestore] logAccess failed:', err);
    }
  },

  /**
   * Recent audit entries, optionally for a single user.
   * @param {{uid?:string,limit?:number}} [options]
   * @returns {Promise<Array<Object>>}
   */
  async getAccessLogs({ uid, limit = 50 } = {}) {
    if (!db) throw new Error("Firestore n'est pas initialisé.");

    let query = db.collection(COLLECTIONS.LOGS);
    if (uid) query = query.where('uid', '==', uid);

    let snapshot;
    try {
      snapshot = await query.orderBy('timestamp', 'desc').limit(limit).get();
    } catch (err) {
      console.warn('[Firestore] getAccessLogs fallback (no index):', err.message);
      snapshot = await query.get();
    }

    const logs = sortBy(snapshot.docs.map(d => ({ id: d.id, ...d.data() })), 'timestamp', 'desc');
    return logs.slice(0, limit);
  },

  // ==========================================================================
  // Admin
  // ==========================================================================

  /** @returns {Promise<Array<Object>>} every user profile */
  async getAllUsers() {
    if (!db) throw new Error("Firestore n'est pas initialisé.");
    const snap = await db.collection(COLLECTIONS.USERS).get();
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  },

  /** @returns {Promise<Array<Object>>} every note */
  async getAllNotes() {
    if (!db) throw new Error("Firestore n'est pas initialisé.");
    const snap = await db.collection(COLLECTIONS.NOTES).get();
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  },

  /** @returns {Promise<Array<Object>>} every link */
  async getAllLinks() {
    if (!db) throw new Error("Firestore n'est pas initialisé.");
    const snap = await db.collection(COLLECTIONS.LINKS).get();
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  },

  /** @returns {Promise<Array<Object>>} every shortcut */
  async getAllShortcuts() {
    if (!db) throw new Error("Firestore n'est pas initialisé.");
    const snap = await db.collection(COLLECTIONS.SHORTCUTS).get();
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  },

  /** @returns {Promise<Array<Object>>} every folder */
  async getAllFolders() {
    if (!db) throw new Error("Firestore n'est pas initialisé.");
    const snap = await db.collection(COLLECTIONS.FOLDERS).get();
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  },

  /**
   * Update a user's role.
   * @param {string} uid
   * @param {'user'|'admin'} role
   */
  async updateUserRole(uid, role) {
    if (!db) throw new Error("Firestore n'est pas initialisé.");
    if (!uid) throw new Error('Identifiant utilisateur requis.');
    if (!['user', 'admin'].includes(role)) {
      throw new Error(`Rôle invalide « ${role} ». Attendu : « user » ou « admin ».`);
    }
    await db.collection(COLLECTIONS.USERS).doc(uid).update({ role });
  },

  /**
   * Aggregate application-wide metrics for the Statistics dashboard.
   * @returns {Promise<{totalNotes:number,totalLinks:number,totalShortcuts:number,totalChars:number,activeUsers:number,subjectBreakdown:Record<string,number>}>}
   */
  async getStats() {
    if (!db) throw new Error("Firestore n'est pas initialisé.");

    const [notes, links, shortcuts, users] = await Promise.all([
      db.collection(COLLECTIONS.NOTES).get(),
      db.collection(COLLECTIONS.LINKS).get(),
      db.collection(COLLECTIONS.SHORTCUTS).get(),
      db.collection(COLLECTIONS.USERS).get()
    ]);

    let totalChars = 0;
    const subjectBreakdown = {};

    notes.docs.forEach(doc => {
      const data = doc.data();
      totalChars += typeof data.charCount === 'number'
        ? data.charCount
        : (data.content ? data.content.length : 0);

      const subject = data.subject || 'Non classé';
      subjectBreakdown[subject] = (subjectBreakdown[subject] || 0) + 1;
    });

    const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
    let activeUsers = 0;

    users.docs.forEach(doc => {
      const { lastLogin } = doc.data();
      let time = 0;
      if (lastLogin?.toDate) time = lastLogin.toDate().getTime();
      else if (lastLogin instanceof Date) time = lastLogin.getTime();
      else if (typeof lastLogin === 'number') time = lastLogin;
      if (time >= thirtyDaysAgo) activeUsers += 1;
    });

    if (activeUsers === 0 && users.size > 0) activeUsers = users.size;

    return {
      totalNotes: notes.size,
      totalLinks: links.size,
      totalShortcuts: shortcuts.size,
      totalChars,
      activeUsers,
      subjectBreakdown
    };
  }
};
