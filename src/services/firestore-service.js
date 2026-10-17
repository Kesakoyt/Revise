/**
 * Fiches & Cloud — Firestore Database Service
 * 
 * Provides unified CRUD operations for Notes, Links, Access Logs,
 * Administration (User Management, Collection Inspection), and Statistics Aggregation.
 */

import { db } from './firebase-config.js';

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

/**
 * Robust in-memory sorting utility supporting strings, numbers, and Firestore Timestamps.
 * Used directly or as fallback when Firestore compound indexes are missing.
 * 
 * @param {Array<Object>} items 
 * @param {string} sortBy 
 * @param {'asc'|'desc'} sortDir 
 * @returns {Array<Object>}
 */
function sortItems(items, sortBy = 'updatedAt', sortDir = 'desc') {
  return [...items].sort((a, b) => {
    let valA = a[sortBy];
    let valB = b[sortBy];

    // Normalize Firestore Timestamps or Date objects to epoch milliseconds
    if (valA && typeof valA.toDate === 'function') valA = valA.toDate().getTime();
    if (valB && typeof valB.toDate === 'function') valB = valB.toDate().getTime();
    if (valA instanceof Date) valA = valA.getTime();
    if (valB instanceof Date) valB = valB.getTime();

    if (typeof valA === 'string') valA = valA.toLowerCase();
    if (typeof valB === 'string') valB = valB.toLowerCase();

    if (valA === undefined || valA === null) valA = '';
    if (valB === undefined || valB === null) valB = '';

    if (valA < valB) return sortDir === 'asc' ? -1 : 1;
    if (valA > valB) return sortDir === 'asc' ? 1 : -1;
    return 0;
  });
}

export const FirestoreService = {
  // ==========================================
  // Notes CRUD
  // ==========================================

  /**
   * Create a new note document in `notes/{noteId}`.
   * 
   * @param {Object} params
   * @param {string} params.uid - Owner user ID
   * @param {string} params.title - Note title
   * @param {string} params.content - Note markdown content
   * @param {string} [params.subject] - Subject classification
   * @param {string} [params.topic] - Topic or chapter
   * @param {boolean} [params.isPublic] - Public visibility flag
   * @returns {Promise<string>} The generated note ID
   */
  async createNote({ uid, title, content = '', subject = 'Général', topic = '', isPublic = false }) {
    if (!db) throw new Error('Firestore is not initialized');

    const timestamp = getServerTimestamp();
    const charCount = typeof content === 'string' ? content.length : 0;

    const noteData = {
      uid,
      title: title?.trim() || 'Sans titre',
      content: content || '',
      subject: subject?.trim() || 'Général',
      topic: topic?.trim() || '',
      isPublic: Boolean(isPublic),
      charCount,
      createdAt: timestamp,
      updatedAt: timestamp
    };

    const docRef = await db.collection('notes').add(noteData);

    try {
      await this.logAccess({
        uid,
        documentId: docRef.id,
        documentType: 'note',
        action: 'create'
      });
    } catch (logErr) {
      console.warn('[FirestoreService] Note creation access log failed:', logErr);
    }

    return docRef.id;
  },

  /**
   * Get a single note by ID.
   * 
   * @param {string} noteId 
   * @returns {Promise<Object|null>} Note data with id or null
   */
  async getNote(noteId) {
    if (!db) throw new Error('Firestore is not initialized');
    if (!noteId) return null;

    const doc = await db.collection('notes').doc(noteId).get();
    if (!doc.exists) return null;

    return { id: doc.id, ...doc.data() };
  },

  /**
   * Update an existing note document. Automatically updates `updatedAt` and `charCount`.
   * 
   * @param {string} noteId 
   * @param {Object} data 
   * @returns {Promise<void>}
   */
  async updateNote(noteId, data) {
    if (!db) throw new Error('Firestore is not initialized');
    if (!noteId) throw new Error('Note ID is required to update');

    const timestamp = getServerTimestamp();
    const updatePayload = {
      ...data,
      updatedAt: timestamp
    };

    if (typeof data.content === 'string') {
      updatePayload.charCount = data.content.length;
    }

    await db.collection('notes').doc(noteId).update(updatePayload);

    try {
      const currentUid = data.uid || (typeof window !== 'undefined' && window.firebase?.auth()?.currentUser?.uid);
      if (currentUid) {
        await this.logAccess({
          uid: currentUid,
          documentId: noteId,
          documentType: 'note',
          action: 'edit'
        });
      }
    } catch (logErr) {
      // Non-blocking
    }
  },

  /**
   * Delete a note document by ID.
   * 
   * @param {string} noteId 
   * @returns {Promise<void>}
   */
  async deleteNote(noteId) {
    if (!db) throw new Error('Firestore is not initialized');
    if (!noteId) return;

    try {
      const currentUid = typeof window !== 'undefined' && window.firebase?.auth()?.currentUser?.uid;
      if (currentUid) {
        await this.logAccess({
          uid: currentUid,
          documentId: noteId,
          documentType: 'note',
          action: 'delete'
        });
      }
    } catch (logErr) {
      // Non-blocking
    }

    await db.collection('notes').doc(noteId).delete();
  },

  /**
   * Fetch all notes owned by a specific user with optional filters and sorting.
   * 
   * @param {string} uid 
   * @param {Object} [filters]
   * @param {string} [filters.subject]
   * @param {string} [filters.topic]
   * @param {string} [filters.sortBy='updatedAt']
   * @param {'asc'|'desc'} [filters.sortDir='desc']
   * @returns {Promise<Array<Object>>}
   */
  async getUserNotes(uid, { subject, topic, sortBy = 'updatedAt', sortDir = 'desc' } = {}) {
    if (!db) throw new Error('Firestore is not initialized');
    if (!uid) return [];

    let query = db.collection('notes').where('uid', '==', uid);

    if (subject && subject !== 'all') {
      query = query.where('subject', '==', subject);
    }
    if (topic && topic !== 'all') {
      query = query.where('topic', '==', topic);
    }

    let snapshot;
    try {
      // Attempt server-side index ordering
      snapshot = await query.orderBy(sortBy, sortDir).get();
    } catch (queryErr) {
      // Fallback without orderBy to prevent index errors
      console.warn('[FirestoreService] getUserNotes query fallback without server ordering:', queryErr.message);
      snapshot = await query.get();
    }

    const notes = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    return sortItems(notes, sortBy, sortDir);
  },

  /**
   * Fetch all public notes across all users with optional subject filter and sorting.
   * 
   * @param {Object} [filters]
   * @param {string} [filters.subject]
   * @param {string} [filters.sortBy='updatedAt']
   * @param {'asc'|'desc'} [filters.sortDir='desc']
   * @returns {Promise<Array<Object>>}
   */
  async getPublicNotes({ subject, sortBy = 'updatedAt', sortDir = 'desc' } = {}) {
    if (!db) throw new Error('Firestore is not initialized');

    let query = db.collection('notes').where('isPublic', '==', true);

    if (subject && subject !== 'all') {
      query = query.where('subject', '==', subject);
    }

    let snapshot;
    try {
      snapshot = await query.orderBy(sortBy, sortDir).get();
    } catch (queryErr) {
      console.warn('[FirestoreService] getPublicNotes query fallback without server ordering:', queryErr.message);
      snapshot = await query.get();
    }

    const notes = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    return sortItems(notes, sortBy, sortDir);
  },

  // ==========================================
  // Links CRUD
  // ==========================================

  /**
   * Create a new link bookmark in `links/{linkId}`.
   * 
   * @param {Object} params
   * @param {string} params.uid - Owner user ID
   * @param {string} params.title - Link title
   * @param {string} params.url - Web URL
   * @param {string} [params.description] - Additional context/notes
   * @param {string} [params.subject] - Subject classification
   * @returns {Promise<string>} The generated link ID
   */
  async createLink({ uid, title, url, description = '', subject = 'Général' }) {
    if (!db) throw new Error('Firestore is not initialized');

    const timestamp = getServerTimestamp();
    const linkData = {
      uid,
      title: title?.trim() || 'Sans titre',
      url: url?.trim() || '',
      description: description?.trim() || '',
      subject: subject?.trim() || 'Général',
      createdAt: timestamp,
      updatedAt: timestamp
    };

    const docRef = await db.collection('links').add(linkData);

    try {
      await this.logAccess({
        uid,
        documentId: docRef.id,
        documentType: 'link',
        action: 'create'
      });
    } catch (logErr) {
      // Non-blocking
    }

    return docRef.id;
  },

  /**
   * Get a single link by ID.
   * 
   * @param {string} linkId 
   * @returns {Promise<Object|null>} Link data with id or null
   */
  async getLink(linkId) {
    if (!db) throw new Error('Firestore is not initialized');
    if (!linkId) return null;

    const doc = await db.collection('links').doc(linkId).get();
    if (!doc.exists) return null;

    return { id: doc.id, ...doc.data() };
  },

  /**
   * Update an existing link document.
   * 
   * @param {string} linkId 
   * @param {Object} data 
   * @returns {Promise<void>}
   */
  async updateLink(linkId, data) {
    if (!db) throw new Error('Firestore is not initialized');
    if (!linkId) throw new Error('Link ID is required to update');

    const timestamp = getServerTimestamp();
    await db.collection('links').doc(linkId).update({
      ...data,
      updatedAt: timestamp
    });

    try {
      const currentUid = data.uid || (typeof window !== 'undefined' && window.firebase?.auth()?.currentUser?.uid);
      if (currentUid) {
        await this.logAccess({
          uid: currentUid,
          documentId: linkId,
          documentType: 'link',
          action: 'edit'
        });
      }
    } catch (logErr) {
      // Non-blocking
    }
  },

  /**
   * Delete a link document by ID.
   * 
   * @param {string} linkId 
   * @returns {Promise<void>}
   */
  async deleteLink(linkId) {
    if (!db) throw new Error('Firestore is not initialized');
    if (!linkId) return;

    try {
      const currentUid = typeof window !== 'undefined' && window.firebase?.auth()?.currentUser?.uid;
      if (currentUid) {
        await this.logAccess({
          uid: currentUid,
          documentId: linkId,
          documentType: 'link',
          action: 'delete'
        });
      }
    } catch (logErr) {
      // Non-blocking
    }

    await db.collection('links').doc(linkId).delete();
  },

  /**
   * Fetch links owned by a specific user with optional subject filter.
   * 
   * @param {string} uid 
   * @param {Object} [filters]
   * @param {string} [filters.subject]
   * @returns {Promise<Array<Object>>}
   */
  async getUserLinks(uid, { subject } = {}) {
    if (!db) throw new Error('Firestore is not initialized');
    if (!uid) return [];

    let query = db.collection('links').where('uid', '==', uid);

    if (subject && subject !== 'all') {
      query = query.where('subject', '==', subject);
    }

    let snapshot;
    try {
      snapshot = await query.orderBy('updatedAt', 'desc').get();
    } catch (err) {
      console.warn('[FirestoreService] getUserLinks fallback without server ordering:', err.message);
      snapshot = await query.get();
    }

    const links = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    return sortItems(links, 'updatedAt', 'desc');
  },

  // ==========================================
  // Admin Operations
  // ==========================================

  /**
   * Fetch all user documents across the application (Admin).
   * 
   * @returns {Promise<Array<Object>>}
   */
  async getAllUsers() {
    if (!db) throw new Error('Firestore is not initialized');
    const snap = await db.collection('users').get();
    return snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
  },

  /**
   * Fetch all note documents across all users (Admin).
   * 
   * @returns {Promise<Array<Object>>}
   */
  async getAllNotes() {
    if (!db) throw new Error('Firestore is not initialized');
    const snap = await db.collection('notes').get();
    return snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
  },

  /**
   * Fetch all link bookmarks across all users (Admin).
   * 
   * @returns {Promise<Array<Object>>}
   */
  async getAllLinks() {
    if (!db) throw new Error('Firestore is not initialized');
    const snap = await db.collection('links').get();
    return snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
  },

  /**
   * Fetch audit access logs with optional user filtering and limit.
   * 
   * @param {Object} [options]
   * @param {string} [options.uid]
   * @param {number} [options.limit=50]
   * @returns {Promise<Array<Object>>}
   */
  async getAccessLogs({ uid, limit = 50 } = {}) {
    if (!db) throw new Error('Firestore is not initialized');

    let query = db.collection('accessLogs');

    if (uid) {
      query = query.where('uid', '==', uid);
    }

    let snapshot;
    try {
      snapshot = await query.orderBy('timestamp', 'desc').limit(limit).get();
    } catch (err) {
      console.warn('[FirestoreService] getAccessLogs fallback without server ordering:', err.message);
      snapshot = await query.get();
    }

    let logs = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    logs = sortItems(logs, 'timestamp', 'desc');
    return logs.slice(0, limit);
  },

  /**
   * Record an activity event in `accessLogs`.
   * 
   * @param {Object} log
   * @param {string} log.uid - Performing user ID
   * @param {string} log.documentId - Note or link ID
   * @param {'note'|'link'} log.documentType - Document type
   * @param {'view'|'edit'|'create'|'delete'} log.action - Action executed
   * @returns {Promise<void>}
   */
  async logAccess({ uid, documentId, documentType, action }) {
    if (!db) return;

    try {
      const timestamp = getServerTimestamp();
      await db.collection('accessLogs').add({
        uid: uid || 'anonymous',
        documentId: documentId || '',
        documentType: documentType || 'note',
        action: action || 'view',
        timestamp
      });
    } catch (err) {
      console.warn('[FirestoreService] logAccess failed:', err);
    }
  },

  /**
   * Update a user's role (e.g. promote to 'admin' or demote to 'user').
   * 
   * @param {string} uid 
   * @param {'user'|'admin'} role 
   * @returns {Promise<void>}
   */
  async updateUserRole(uid, role) {
    if (!db) throw new Error('Firestore is not initialized');
    if (!uid) throw new Error('User ID is required to update role');
    if (!['user', 'admin'].includes(role)) {
      throw new Error(`Invalid role '${role}'. Role must be 'user' or 'admin'.`);
    }

    await db.collection('users').doc(uid).update({ role });
  },

  // ==========================================
  // Statistics Aggregation
  // ==========================================

  /**
   * Aggregate application-wide metrics for the Admin Dashboard.
   * 
   * @returns {Promise<{
   *   totalNotes: number,
   *   totalLinks: number,
   *   totalChars: number,
   *   activeUsers: number,
   *   subjectBreakdown: Record<string, number>
   * }>}
   */
  async getStats() {
    if (!db) throw new Error('Firestore is not initialized');

    const [notesSnap, linksSnap, usersSnap] = await Promise.all([
      db.collection('notes').get(),
      db.collection('links').get(),
      db.collection('users').get()
    ]);

    const totalNotes = notesSnap.size;
    const totalLinks = linksSnap.size;

    let totalChars = 0;
    const subjectBreakdown = {};

    notesSnap.docs.forEach(doc => {
      const data = doc.data();
      const chars = typeof data.charCount === 'number'
        ? data.charCount
        : (data.content ? data.content.length : 0);
      totalChars += chars;

      const subject = data.subject || 'Non classé';
      subjectBreakdown[subject] = (subjectBreakdown[subject] || 0) + 1;
    });

    const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
    let activeUsers = 0;

    usersSnap.docs.forEach(doc => {
      const data = doc.data();
      let lastLoginTime = 0;

      if (data.lastLogin) {
        if (typeof data.lastLogin.toDate === 'function') {
          lastLoginTime = data.lastLogin.toDate().getTime();
        } else if (data.lastLogin instanceof Date) {
          lastLoginTime = data.lastLogin.getTime();
        } else if (typeof data.lastLogin === 'number') {
          lastLoginTime = data.lastLogin;
        }
      }

      if (lastLoginTime >= thirtyDaysAgo) {
        activeUsers++;
      }
    });

    // If active count is 0 but users exist, fallback to total user count
    if (activeUsers === 0 && usersSnap.size > 0) {
      activeUsers = usersSnap.size;
    }

    return {
      totalNotes,
      totalLinks,
      totalChars,
      activeUsers,
      subjectBreakdown
    };
  }
};
