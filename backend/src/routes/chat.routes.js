const express = require('express');
const router  = express.Router();
const {
  getUsers,
  getFriendRequests,
  sendFriendRequest,
  acceptFriendRequest,
  rejectFriendRequest,
  getFriends,
  getChats,
  createPrivateChat,
  createGroupChat,
  getMessages,
  sendMessage,
  markChatRead,
  searchMessages,
  editMessage,
  deleteMessage,
  getChatDetails,
  renameGroupChat,
  addGroupParticipant,
  removeGroupParticipant,
  leaveGroupChat,
  blockUser,
  unblockUser,
  getBlockList,
  searchAllMessages,
} = require('../controllers/chat.controller');
const { verifyToken } = require('../middleware/auth.middleware');
const { validate }    = require('../middleware/validate.middleware');
const { schemas }     = require('../validation/schemas');
const { chatMessageLimiter, friendRequestLimiter } = require('../middleware/rateLimit.middleware');

// User discovery
router.get('/users', verifyToken, getUsers);

// Friend requests — POST is rate limited per user to prevent spam enumeration (LOW-6)
router.get('/friend-requests', verifyToken, getFriendRequests);
router.post('/friend-requests', verifyToken, friendRequestLimiter, validate(schemas.sendFriendRequest), sendFriendRequest);
router.patch('/friend-requests/:id/accept', verifyToken, validate(schemas.acceptFriendRequest), acceptFriendRequest);
router.patch('/friend-requests/:id/reject', verifyToken, validate(schemas.rejectFriendRequest), rejectFriendRequest);
router.get('/friends', verifyToken, getFriends);

// Chats — list + create
router.get('/chats', verifyToken, getChats);
router.post('/private/:friendId', verifyToken, validate(schemas.createPrivateChat), createPrivateChat);
router.post('/group', verifyToken, validate(schemas.createGroupChat), createGroupChat);

// Chat details — full participant list (used by group manage page)
router.get('/chats/:chatId', verifyToken, getChatDetails);

// Messages — rate limited per user (10 messages per 10s) to prevent flooding
router.get('/chats/:chatId/messages', verifyToken, validate(schemas.getMessages), getMessages);
router.post('/chats/:chatId/messages', verifyToken, chatMessageLimiter, validate(schemas.sendMessage), sendMessage);
router.get('/chats/:chatId/search', verifyToken, searchMessages);

// Mark chat as read — updates lastReadAt on ChatParticipant for unread count tracking
router.patch('/chats/:chatId/read', verifyToken, markChatRead);

// Message edit & delete — sender only
router.patch('/messages/:messageId', verifyToken, editMessage);
router.delete('/messages/:messageId', verifyToken, deleteMessage);

// ── Group chat management ──────────────────────────────────────────────────────
// All group management routes require the user to be a participant of the chat.
// Additional authz (creator-only) is enforced inside each controller function.
router.patch('/chats/:chatId/name',                   verifyToken, renameGroupChat);
router.post('/chats/:chatId/participants',             verifyToken, addGroupParticipant);
router.delete('/chats/:chatId/participants/:userId',   verifyToken, removeGroupParticipant);
router.post('/chats/:chatId/leave',                   verifyToken, leaveGroupChat);

// ── Block / unblock (FEAT-S2) ─────────────────────────────────────────────────
router.get('/blocks',          verifyToken, getBlockList);
router.post('/blocks/:userId', verifyToken, blockUser);
router.delete('/blocks/:userId', verifyToken, unblockUser);

// ── Cross-conversation search (FEAT-S3) ───────────────────────────────────────
router.get('/search', verifyToken, searchAllMessages);

module.exports = router;
