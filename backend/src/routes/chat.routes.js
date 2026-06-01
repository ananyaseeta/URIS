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
} = require('../controllers/chat.controller');
const { verifyToken } = require('../middleware/auth.middleware');
const { validate }    = require('../middleware/validate.middleware');
const { schemas }     = require('../validation/schemas');

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

// Messages
router.get('/chats/:chatId/messages', verifyToken, validate(schemas.getMessages), getMessages);
router.post('/chats/:chatId/messages', verifyToken, validate(schemas.sendMessage), sendMessage);

module.exports = router;
