/**
 * Fiches & Cloud — Firestore data service.
 *
 * Single entry point for every database operation grouped by domain:
 *   • Notes      — Markdown study cards      (collection `notes`)
 *   • Links      — external bookmarks         (collection `links`)
 *   • Folders    — explorer hierarchy          (collection `folders`)
 *   • Shares     — folder grants inherited by descendants
 *   • Directory  — lightweight user list for the sharing picker
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
  DIRECTORY: 'directory',
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
 * Grant list, owner name and public branch flag inherited from a parent folder,
 * so content created inside a shared or public folder stays visible the same way.
 * @param {string|null} parentId
 * @returns {Promise<{sharedWith:string[], ownerName:string, hasPublic:boolean}>}
 */
async function inheritedShares(parentId) {
  if (!db || !parentId) return { sharedWith: [], ownerName: '', hasPublic: false };
  try {
    const doc = await db.collection(COLLECTIONS.FOLDERS).doc(parentId).get();
    const data = doc.exists ? (doc.data() || {}) : {};
    return {
      sharedWith: Array.isArray(data.sharedWith) ? data.sharedWith : [],
      ownerName: data.ownerName || '',
      hasPublic: data.hasPublic === true
    };
  } catch (err) {
    console.warn('[Firestore] inherit shares failed:', err.message);
    return { sharedWith: [], ownerName: '', hasPublic: false };
  }
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
    const { sharedWith, ownerName } = await inheritedShares(parentId);

    const ref = await db.collection(COLLECTIONS.NOTES).add({
      uid,
      title: title?.trim() || 'Sans titre',
      content: content || '',
      subject: subject?.trim() || 'Général',
      topic: topic?.trim() || '',
      isPublic: Boolean(isPublic),
      parentId: parentId || null,
      sharedWith,
      ownerName,
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
    const { sharedWith, ownerName } = await inheritedShares(parentId);

    const ref = await db.collection(COLLECTIONS.LINKS).add({
      uid,
      title: title?.trim() || 'Sans titre',
      url: url?.trim() || '',
      description: description?.trim() || '',
      subject: subject?.trim() || 'Général',
      parentId: parentId || null,
      isPublic: Boolean(isPublic),
      sharedWith,
      ownerName,
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
    const { sharedWith, ownerName, hasPublic } = await inheritedShares(parentId);

    const ref = await db.collection(COLLECTIONS.FOLDERS).add({
      uid,
      name: name?.trim() || 'Nouveau dossier',
      parentId: parentId || null,
      sharedWith,
      ownerName,
      hasPublic,
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
  // Sharing — folder-scoped grants, inherited by the whole subtree
  // ==========================================================================

  /**
   * Folders shared *with* a user (owned by someone else), including every
   * descendant folder of a shared subtree.
   * @param {string} uid
   * @returns {Promise<Array<Object>>}
   */
  async getSharedFolders(uid) {
    if (!db || !uid) return [];
    const snap = await db.collection(COLLECTIONS.FOLDERS).where('sharedWith', 'array-contains', uid).get();
    return sortBy(snap.docs.map(d => ({ id: d.id, ...d.data() })), 'name', 'asc');
  },

  /** Fiches shared *with* a user. @param {string} uid @returns {Promise<Array<Object>>} */
  async getSharedNotes(uid) {
    if (!db || !uid) return [];
    const snap = await db.collection(COLLECTIONS.NOTES).where('sharedWith', 'array-contains', uid).get();
    return sortBy(snap.docs.map(d => ({ id: d.id, ...d.data() })), 'updatedAt', 'desc');
  },

  /** Links shared *with* a user. @param {string} uid @returns {Promise<Array<Object>>} */
  async getSharedLinks(uid) {
    if (!db || !uid) return [];
    const snap = await db.collection(COLLECTIONS.LINKS).where('sharedWith', 'array-contains', uid).get();
    return sortBy(snap.docs.map(d => ({ id: d.id, ...d.data() })), 'updatedAt', 'desc');
  },

  /**
   * Every folder that leads to public content, across all users — the branches
   * the public browser can open. Readable by any signed-in account.
   * @returns {Promise<Array<Object>>}
   */
  async getPublicFolders() {
    if (!db) return [];
    const snap = await db.collection(COLLECTIONS.FOLDERS).where('hasPublic', '==', true).get();
    return sortBy(snap.docs.map(d => ({ id: d.id, ...d.data() })), 'name', 'asc');
  },

  /**
   * Best-effort re-sync of an owner's tree flags (`sharedWith`, `hasPublic`)
   * after a publish/unpublish or a delete. Never throws.
   * @param {string} ownerUid
   * @param {string} [ownerName]
   * @returns {Promise<void>}
   */
  async syncTreeFlags(ownerUid, ownerName = '') {
    if (!db || !ownerUid) return;
    try {
      await this.syncShares({ ownerUid, ownerName });
    } catch (err) {
      console.warn('[Firestore] tree flag sync skipped:', err.message);
    }
  },

  /**
   * Replace the explicit recipient list of a folder, then re-propagate the
   * inherited grants across the owner's whole tree.
   *
   * @param {{folderId:string, sharedWith:string[], ownerUid?:string, ownerName?:string}} p
   * @returns {Promise<{updated:number}>} documents rewritten by the re-sync
   */
  async setFolderShares({ folderId, sharedWith = [], ownerUid = '', ownerName = '' }) {
    if (!db) throw new Error("Firestore n'est pas initialisé.");
    if (!folderId) throw new Error('Identifiant de dossier requis.');

    const folder = await this.getFolder(folderId);
    if (!folder) throw new Error('Dossier introuvable.');

    const owner = ownerUid || folder.uid;
    if (!owner) throw new Error('Propriétaire du dossier introuvable.');

    const list = [...new Set(sharedWith.filter(u => u && u !== owner))];
    const name = ownerName || folder.ownerName || '';

    await db.collection(COLLECTIONS.FOLDERS).doc(folderId).update({
      sharedWith: list,
      ownerName: name,
      updatedAt: serverTimestamp()
    });

    return this.syncShares({ ownerUid: owner, ownerName: name });
  },

  /**
   * Recompute the denormalised tree flags for every folder, fiche and link
   * owned by `ownerUid` and persist only the documents that actually change.
   *
   * Two flags are derived from the owner's whole tree:
   *   • `sharedWith` / `ownerName` — grants. A folder carries an explicit
   *     recipient list and every descendant inherits the union of its
   *     ancestors' lists.
   *   • `hasPublic` (folders only) — true when the folder is explicitly public
   *     (`isPublic`, set by an admin) or when the folder or one of its
   *     descendants holds a public fiche or link, so the public browser can list
   *     exactly the branches that lead to public content.
   *
   * The function is idempotent, so it is also the right thing to run after a
   * move, a publish/unpublish or a delete — no stale grant or branch survives.
   *
   * @param {{ownerUid:string, ownerName?:string, folders?:Array, notes?:Array, links?:Array}} [p]
   * @returns {Promise<{updated:number}>}
   */
  async syncShares({ ownerUid, ownerName = '', folders, notes, links } = {}) {
    if (!db || !ownerUid) return { updated: 0 };

    const [allFolders, allNotes, allLinks] = await Promise.all([
      folders || this.getUserFolders(ownerUid),
      notes || this.getUserNotes(ownerUid),
      links || this.getUserLinks(ownerUid)
    ]);

    // Resolve each folder's effective grant set by walking up its parent chain
    // (memoised). A folder whose parent is missing is treated as a root, so an
    // explicit grant is never wiped just because its parent vanished.
    const byId = new Map(allFolders.map(f => [f.id, f]));
    const effective = new Map(); // folderId -> string[]
    const resolve = (folder, guard = new Set()) => {
      if (effective.has(folder.id)) return effective.get(folder.id);
      if (guard.has(folder.id)) return []; // defensive: broken parent cycle
      guard.add(folder.id);

      const own = Array.isArray(folder.sharedWith) ? folder.sharedWith : [];
      const parent = folder.parentId ? byId.get(folder.parentId) : null;
      const inherited = parent ? resolve(parent, guard) : [];
      const next = [...new Set([...inherited, ...own])];
      effective.set(folder.id, next);
      return next;
    };
    allFolders.forEach(f => resolve(f));

    // Mark every folder on the path from a public item up to the root. A folder
    // explicitly published by an admin (`isPublic`, cascade-published with all
    // its content) marks itself and its ancestors, so an empty published folder
    // still shows in the public browser.
    const publicFolders = new Set();
    const markPublic = id => {
      let guard = 0;
      while (id && byId.has(id) && !publicFolders.has(id) && guard++ < 1000) {
        publicFolders.add(id);
        id = byId.get(id).parentId || null;
      }
    };
    allNotes.forEach(n => { if (n.isPublic === true) markPublic(n.parentId); });
    allLinks.forEach(l => { if (l.isPublic === true) markPublic(l.parentId); });
    allFolders.forEach(f => { if (f.isPublic === true) markPublic(f.id); });

    const changes = [];
    const sameSet = (a, b) => a.length === b.length && b.every(x => a.includes(x));

    /** `nextPublic` is only defined for folders. */
    const consider = (collection, doc, nextShared, nextPublic) => {
      const current = Array.isArray(doc.sharedWith) ? doc.sharedWith : [];
      // Never blank an existing owner name: a caller that doesn't know it (an
      // admin acting on someone else's tree) passes an empty string.
      const nextName = nextShared.length ? (ownerName || doc.ownerName || '') : (doc.ownerName || '');

      const data = { sharedWith: nextShared, ownerName: nextName };
      if (nextPublic !== undefined) data.hasPublic = nextPublic;

      const sharedSame = sameSet(current, nextShared) && (doc.ownerName || '') === nextName;
      const publicSame = nextPublic === undefined || (doc.hasPublic === true) === nextPublic;
      if (sharedSame && publicSame) return;

      changes.push({ collection, id: doc.id, data });
    };

    allFolders.forEach(f => consider(COLLECTIONS.FOLDERS, f, effective.get(f.id) || [], publicFolders.has(f.id)));
    allNotes.forEach(n => consider(COLLECTIONS.NOTES, n, effective.get(n.parentId) || []));
    allLinks.forEach(l => consider(COLLECTIONS.LINKS, l, effective.get(l.parentId) || []));

    if (!changes.length) return { updated: 0 };

    // 400 writes per batch — well under Firestore's 500-op batch limit.
    for (let i = 0; i < changes.length; i += 400) {
      const batch = db.batch();
      changes.slice(i, i + 400).forEach(change => {
        batch.update(db.collection(change.collection).doc(change.id), change.data);
      });
      await batch.commit();
    }

    return { updated: changes.length };
  },

  /**
   * Publish or unpublish a folder **and everything it contains** — the folder,
   * every descendant folder and every fiche and link inside it get the same
   * `isPublic` value. The owner's tree flags are then recomputed so the public
   * browser lists (or drops) the whole branch.
   *
   * Admin-only in practice: only `isAdmin()` may write another user's folders,
   * fiches and links.
   *
   * @param {string} folderId
   * @param {boolean} isPublic
   * @param {{ownerUid?:string, ownerName?:string}} [p]
   * @returns {Promise<{updated:number}>}
   */
  async setFolderPublic(folderId, isPublic, { ownerUid, ownerName = '' } = {}) {
    if (!db || !folderId) return { updated: 0 };

    const folder = await this.getFolder(folderId);
    if (!folder) throw new Error('Dossier introuvable.');
    const owner = ownerUid || folder.uid;

    const [folders, notes, links] = await Promise.all([
      this.getUserFolders(owner),
      this.getUserNotes(owner),
      this.getUserLinks(owner)
    ]);

    // The subtree: the folder plus everything reachable through `parentId`.
    const ids = new Set([folderId]);
    let grew = true;
    while (grew) {
      grew = false;
      folders.forEach(f => {
        if (f.parentId && ids.has(f.parentId) && !ids.has(f.id)) { ids.add(f.id); grew = true; }
      });
    }

    const changes = [];
    folders.filter(f => ids.has(f.id) && (f.isPublic === true) !== isPublic)
      .forEach(f => changes.push({ collection: COLLECTIONS.FOLDERS, id: f.id }));
    notes.filter(n => ids.has(n.parentId) && n.isPublic !== isPublic)
      .forEach(n => changes.push({ collection: COLLECTIONS.NOTES, id: n.id }));
    links.filter(l => ids.has(l.parentId) && l.isPublic !== isPublic)
      .forEach(l => changes.push({ collection: COLLECTIONS.LINKS, id: l.id }));

    // 400 writes per batch — well under Firestore's 500-op batch limit.
    for (let i = 0; i < changes.length; i += 400) {
      const batch = db.batch();
      changes.slice(i, i + 400).forEach(change => {
        batch.update(db.collection(change.collection).doc(change.id), {
          isPublic,
          updatedAt: serverTimestamp()
        });
      });
      await batch.commit();
    }

    await this.syncShares({ ownerUid: owner, ownerName });
    return { updated: changes.length };
  },

  // ==========================================================================
  // Directory — minimal, readable list of accounts (for the share picker)
  // ==========================================================================

  /**
   * Create or refresh this account's directory entry.
   * @param {{uid:string, displayName?:string, email?:string}} p
   * @returns {Promise<void>}
   */
  async upsertDirectoryEntry({ uid, displayName = '', email = '' }) {
    if (!db || !uid) return;
    try {
      await db.collection(COLLECTIONS.DIRECTORY).doc(uid).set(
        {
          uid,
          displayName: displayName || '',
          email: email || '',
          updatedAt: serverTimestamp()
        },
        { merge: true }
      );
    } catch (err) {
      console.warn('[Firestore] directory entry skipped:', err.message);
    }
  },

  /** Every directory entry, readable by any signed-in user. @returns {Promise<Array<Object>>} */
  async getDirectory() {
    if (!db) throw new Error("Firestore n'est pas initialisé.");
    const snap = await db.collection(COLLECTIONS.DIRECTORY).get();
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  },

  /**
   * Backfill `directory` from the full user profiles (admin only) — needed for
   * accounts that predate the sharing feature.
   * @param {Array<Object>} [users]
   * @returns {Promise<{count:number}>}
   */
  async syncDirectory(users) {
    if (!db) throw new Error("Firestore n'est pas initialisé.");
    const list = users || await this.getAllUsers();

    let count = 0;
    for (let i = 0; i < list.length; i += 400) {
      const batch = db.batch();
      list.slice(i, i + 400).forEach(u => {
        const uid = u.id || u.uid;
        if (!uid) return;
        batch.set(
          db.collection(COLLECTIONS.DIRECTORY).doc(uid),
          {
            uid,
            displayName: u.displayName || u.email?.split('@')[0] || '',
            email: u.email || '',
            updatedAt: serverTimestamp()
          },
          { merge: true }
        );
        count += 1;
      });
      await batch.commit();
    }
    return { count };
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
