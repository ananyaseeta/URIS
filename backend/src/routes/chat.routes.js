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
} = require('../controllers/chat.controller');
const { verifyToken } = require('../middleware/auth.middleware');
const { validate }    = require('../middleware/validate.middleware');
const { schemas }     = require('../validation/schemas');
const { chatMessageLimiter } = require('../middleware/rateLimit.middleware');

// User discovery
router.get('/users', verifyToken, getUsers);

// Friend requests
router.get('/friend-requests', verifyToken, getFriendRequests);
router.post('/friend-requests', verifyToken, validate(schemas.sendFriendRequest), sendFriendRequest);
router.patch('/friend-requests/:id/accept', verifyToken, validate(schemas.acceptFriendRequest), acceptFriendRequest);
router.patch('/friend-requests/:id/reject', verifyToken, validate(schemas.rejectFriendRequest), rejectFriendRequest);
router.get('/friends', verifyToken, getFriends);

// Chats
router.get('/chats', verifyToken, getChats);
router.post('/private/:friendId', verifyToken, validate(schemas.createPrivateChat), createPrivateChat);
router.post('/group', verifyToken, validate(schemas.createGroupChat), createGroupChat);

// Messages — rate limited per user (10 messages per 10s) to prevent flooding
router.get('/chats/:chatId/messages', verifyToken, validate(schemas.getMessages), getMessages);
router.post('/chats/:chatId/messages', verifyToken, chatMessageLimiter, validate(schemas.sendMessage), sendMessage);

// Mark chat as read — updates lastReadAt on ChatParticipant for unread count tracking
router.patch('/chats/:chatId/read', verifyToken, markChatRead);

module.exports = router;
