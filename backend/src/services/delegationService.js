'use strict';

/**
 * delegationService.js — Core Admin Delegation
 *
 * Stores a list of user IDs that have been granted effective CORE_ADMIN powers
 * by the actual CORE_ADMIN. Their DB role does NOT change — delegation is a
 * runtime overlay stored in the Config table.
 *
 * Storage: Config table, key = "core_admin_delegates", value = string[] of userId
 */

const configStore = require('./configStore');

const DELEGATE_KEY = 'core_admin_delegates';

/**
 * Returns the current set of delegated user IDs.
 * @returns {Promise<Set<string>>}
 */
async function getDelegateSet() {
  const list = (await configStore.get(DELEGATE_KEY, [])) || [];
  return new Set(Array.isArray(list) ? list : []);
}

/**
 * Returns true if userId is currently a CORE_ADMIN delegate.
 * @param {string} userId
 * @returns {Promise<boolean>}
 */
async function isDelegate(userId) {
  const set = await getDelegateSet();
  return set.has(userId);
}

/**
 * Returns the full list of delegated user IDs.
 * @returns {Promise<string[]>}
 */
async function listDelegates() {
  const list = (await configStore.get(DELEGATE_KEY, [])) || [];
  return Array.isArray(list) ? list : [];
}

/**
 * Grant CORE_ADMIN delegation to a user.
 * @param {string} userId
 * @returns {Promise<string[]>} updated list
 */
async function addDelegate(userId) {
  const current = await listDelegates();
  if (!current.includes(userId)) {
    const updated = [...current, userId];
    await configStore.set(DELEGATE_KEY, updated);
    return updated;
  }
  return current;
}

/**
 * Revoke CORE_ADMIN delegation from a user.
 * @param {string} userId
 * @returns {Promise<string[]>} updated list
 */
async function removeDelegate(userId) {
  const current = await listDelegates();
  const updated = current.filter(id => id !== userId);
  await configStore.set(DELEGATE_KEY, updated);
  return updated;
}

module.exports = { getDelegateSet, isDelegate, listDelegates, addDelegate, removeDelegate };
