/**
 * Fiches & Cloud — Character quota service.
 *
 * Every account has a character allowance (default 500 000). Storage is the
 * sum of the `charCount` of the user's notes. This service recalculates that
 * total, persists it on `users/{uid}.quotaUsed`, and validates writes.
 */

import { db } from './firebase-config.js';

const DEFAULT_LIMIT = 500000;

export const QuotaManager = {
  /**
   * Recompute a user's used characters from their notes and persist it.
   * @param {string} uid
   * @returns {Promise<{ used: number, limit: number }>}
   */
  async recalculateQuota(uid) {
    if (!db) throw new Error("Firestore n'est pas initialisé.");
    if (!uid) throw new Error('Identifiant utilisateur requis.');

    const snapshot = await db.collection('notes').where('uid', '==', uid).get();
    let used = 0;

    snapshot.forEach(doc => {
      const data = doc.data();
      used += typeof data.charCount === 'number'
        ? data.charCount
        : (data.content ? data.content.length : 0);
    });

    const ref = db.collection('users').doc(uid);
    const userDoc = await ref.get();
    let limit = DEFAULT_LIMIT;

    if (userDoc.exists) {
      const data = userDoc.data();
      if (typeof data.quotaLimit === 'number') limit = data.quotaLimit;
      await ref.update({ quotaUsed: used });
    }

    return { used, limit };
  },

  /**
   * Read a user's quota consumption, computing it on first access.
   * @param {string} uid
   * @returns {Promise<{ used: number, limit: number, percentage: number }>}
   */
  async getQuotaInfo(uid) {
    if (!db || !uid) return { used: 0, limit: DEFAULT_LIMIT, percentage: 0 };

    const doc = await db.collection('users').doc(uid).get();
    let used = 0;
    let limit = DEFAULT_LIMIT;

    if (doc.exists) {
      const data = doc.data();
      if (typeof data.quotaLimit === 'number') limit = data.quotaLimit;

      if (typeof data.quotaUsed === 'number') {
        used = data.quotaUsed;
      } else {
        const res = await this.recalculateQuota(uid);
        used = res.used;
        limit = res.limit;
      }
    }

    const percentage = limit > 0 ? Math.min(100, Math.round((used / limit) * 100)) : 0;
    return { used, limit, percentage };
  },

  /**
   * Test whether `additionalChars` still fits inside the allowance.
   * @param {string} uid
   * @param {number} [additionalChars=0]
   * @returns {Promise<{ allowed: boolean, remaining: number }>}
   */
  async checkQuota(uid, additionalChars = 0) {
    const { used, limit } = await this.getQuotaInfo(uid);
    const proposed = used + Math.max(0, additionalChars);
    return {
      allowed: proposed <= limit,
      remaining: Math.max(0, limit - proposed)
    };
  },

  /**
   * Format raw quota numbers for display (fr-FR thousands separators).
   * @param {number} [used=0]
   * @param {number} [limit=DEFAULT_LIMIT]
   * @returns {{ percentage: number, usedFormatted: string, limitFormatted: string }}
   */
  formatQuota(used = 0, limit = DEFAULT_LIMIT) {
    const safeUsed = Math.max(0, Number(used) || 0);
    const safeLimit = Math.max(1, Number(limit) || DEFAULT_LIMIT);
    const formatter = new Intl.NumberFormat('fr-FR');
    return {
      percentage: Math.min(100, Math.round((safeUsed / safeLimit) * 100)),
      usedFormatted: formatter.format(safeUsed),
      limitFormatted: formatter.format(safeLimit)
    };
  }
};
