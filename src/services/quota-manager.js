/**
 * Fiches & Cloud — Quota Management Service
 * 
 * Enforces per-user character limits (default 500,000 characters) across stored notes,
 * provides live usage statistics, and audits user character consumption.
 */

import { db } from './firebase-config.js';

const DEFAULT_LIMIT = 500000;

export const QuotaManager = {
  /**
   * Recalculate and synchronize a user's total character count by querying all their notes.
   * Updates `quotaUsed` in `users/{uid}` in Firestore.
   * 
   * @param {string} uid - User identifier
   * @returns {Promise<{ used: number, limit: number }>}
   */
  async recalculateQuota(uid) {
    if (!db) throw new Error('Firestore is not initialized');
    if (!uid) throw new Error('User ID is required to recalculate quota');

    const notesSnapshot = await db.collection('notes').where('uid', '==', uid).get();
    let totalChars = 0;

    notesSnapshot.forEach(doc => {
      const data = doc.data();
      const count = typeof data.charCount === 'number'
        ? data.charCount
        : (data.content ? data.content.length : 0);
      totalChars += count;
    });

    const userRef = db.collection('users').doc(uid);
    const userDoc = await userRef.get();
    let limit = DEFAULT_LIMIT;

    if (userDoc.exists) {
      const userData = userDoc.data();
      if (typeof userData.quotaLimit === 'number') {
        limit = userData.quotaLimit;
      }
      await userRef.update({ quotaUsed: totalChars });
    }

    return { used: totalChars, limit };
  },

  /**
   * Retrieve the current quota consumption and capacity for a user.
   * 
   * @param {string} uid - User identifier
   * @returns {Promise<{ used: number, limit: number, percentage: number }>}
   */
  async getQuotaInfo(uid) {
    if (!db || !uid) {
      return { used: 0, limit: DEFAULT_LIMIT, percentage: 0 };
    }

    const userRef = db.collection('users').doc(uid);
    const userDoc = await userRef.get();

    let used = 0;
    let limit = DEFAULT_LIMIT;

    if (userDoc.exists) {
      const data = userDoc.data();
      if (typeof data.quotaLimit === 'number') {
        limit = data.quotaLimit;
      }

      if (typeof data.quotaUsed === 'number') {
        used = data.quotaUsed;
      } else {
        // Automatically compute and persist if quotaUsed is not set
        const res = await this.recalculateQuota(uid);
        used = res.used;
        limit = res.limit;
      }
    }

    const percentage = limit > 0 ? Math.min(100, Math.round((used / limit) * 100)) : 0;
    return { used, limit, percentage };
  },

  /**
   * Check if a proposed addition of characters would fit within the user's quota.
   * 
   * @param {string} uid - User identifier
   * @param {number} [additionalChars=0] - Number of new characters to check
   * @returns {Promise<{ allowed: boolean, remaining: number }>}
   */
  async checkQuota(uid, additionalChars = 0) {
    const { used, limit } = await this.getQuotaInfo(uid);
    const proposedTotal = used + Math.max(0, additionalChars);
    const allowed = proposedTotal <= limit;
    const remaining = Math.max(0, limit - proposedTotal);

    return {
      allowed,
      remaining
    };
  },

  /**
   * Format numeric quota values into user-friendly strings with localization.
   * 
   * @param {number} [used=0] - Characters currently used
   * @param {number} [limit=500000] - Total character allowance
   * @returns {{ percentage: number, usedFormatted: string, limitFormatted: string }}
   */
  formatQuota(used = 0, limit = DEFAULT_LIMIT) {
    const safeUsed = Math.max(0, Number(used) || 0);
    const safeLimit = Math.max(1, Number(limit) || DEFAULT_LIMIT);
    const percentage = Math.min(100, Math.round((safeUsed / safeLimit) * 100));

    const formatter = new Intl.NumberFormat('fr-FR');
    const usedFormatted = formatter.format(safeUsed);
    const limitFormatted = formatter.format(safeLimit);

    return {
      percentage,
      usedFormatted,
      limitFormatted
    };
  }
};
