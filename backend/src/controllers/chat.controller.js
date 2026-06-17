const prisma = require('../utils/prisma');
const { ok, notFound, forbidden, validationError } = require('../utils/respond');
const logger = require('../utils/logger');

/**
 * GET /chat/users
 * Search all users for chat discovery — available to any authenticated user
 */
async function getUsers(req, res, next) {
  try {
    const { q } = req.query;

    const where = q
      ? {
          id: { not: req.user.id },
          status: 'active',
          OR: [
            { name:  { contains: q, mode: 'insensitive' } },
            { email: { contains: q, mode: 'insensitive' } },
          ],
        }
      : {
          id: { not: req.user.id },
          status: 'active',
        };

    const users = await prisma.user.findMany({
      where,
      select: {
        id:    true,
        name:  true,
        email: true,
        role:  true,
      },
      orderBy: { name: 'asc' },
      take: 50,
    });

    return ok(res, users, 'Users retrieved');
  } catch (err) {
    next(err);
  }
}

/**
 * GET /chat/friend-requests
 * Get all friend requests (incoming) for the authenticated user — all statuses
 * so the frontend can filter by pending / accepted / rejected.
 */
async function getFriendRequests(req, res, next) {
  try {
    const requests = await prisma.friendRequest.findMany({
      where: {
        receiverId: req.user.id,
        // No status filter — return all so the UI can filter client-side
      },
      include: {
        sender: {
          select: {
            id: true,
            name: true,
            email: true,
            role: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    return ok(res, requests, 'Friend requests retrieved');
  } catch (err) {
    next(err);
  }
}

/**
 * POST /chat/friend-requests
 * Send a friend request to another user
 */
async function sendFriendRequest(req, res, next) {
  try {
    const { receiverId } = req.body;

    // Prevent self-friendship
    if (receiverId === req.user.id) {
      return validationError(res, 'Cannot send friend request to yourself');
    }

    // Check if request already exists
    const existingRequest = await prisma.friendRequest.findFirst({
      where: {
        OR: [
          { senderId: req.user.id, receiverId: receiverId },
          { senderId: receiverId, receiverId: req.user.id },
        ],
      },
    });

    if (existingRequest) {
      if (existingRequest.status === 'PENDING') {
        return validationError(res, 'Friend request already sent');
      }
      if (existingRequest.status === 'ACCEPTED') {
        return validationError(res, 'Already friends');
      }
      if (existingRequest.status === 'REJECTED') {
        // Allow resending after rejection
        await prisma.friendRequest.delete({
          where: { id: existingRequest.id },
        });
      }
    }

    const request = await prisma.friendRequest.create({
      data: {
        senderId: req.user.id,
        receiverId,
      },
      include: {
        receiver: {
          select: {
            id: true,
            name: true,
            email: true,
            role: true,
          },
        },
      },
    });

    logger.info({ friendRequestId: request.id, senderId: req.user.id, receiverId }, 'Friend request sent');

    return ok(res, request, 'Friend request sent');
  } catch (err) {
    next(err);
  }
}

/**
 * PATCH /chat/friend-requests/:id/accept
 * Accept a friend request
 */
async function acceptFriendRequest(req, res, next) {
  try {
    const { id } = req.params;

    const request = await prisma.friendRequest.findUnique({
      where: { id },
      include: {
        sender: true,
        receiver: true,
      },
    });

    if (!request) {
      return notFound(res, 'Friend request not found');
    }

    if (request.receiverId !== req.user.id) {
      return forbidden(res, 'Cannot accept this friend request');
    }

    if (request.status !== 'PENDING') {
      return validationError(res, 'Friend request is no longer pending');
    }

    const updated = await prisma.friendRequest.update({
      where: { id },
      data: { status: 'ACCEPTED' },
    });

    logger.info({ friendRequestId: id }, 'Friend request accepted');

    return ok(res, updated, 'Friend request accepted');
  } catch (err) {
    next(err);
  }
}

/**
 * PATCH /chat/friend-requests/:id/reject
 * Reject a friend request
 */
async function rejectFriendRequest(req, res, next) {
  try {
    const { id } = req.params;

    const request = await prisma.friendRequest.findUnique({
      where: { id },
      include: {
        sender: true,
        receiver: true,
      },
    });

    if (!request) {
      return notFound(res, 'Friend request not found');
    }

    if (request.receiverId !== req.user.id) {
      return forbidden(res, 'Cannot reject this friend request');
    }

    if (request.status !== 'PENDING') {
      return validationError(res, 'Friend request is no longer pending');
    }

    const updated = await prisma.friendRequest.update({
      where: { id },
      data: { status: 'REJECTED' },
    });

    logger.info({ friendRequestId: id }, 'Friend request rejected');

    return ok(res, updated, 'Friend request rejected');
  } catch (err) {
    next(err);
  }
}

/**
 * GET /chat/friends
 * Get list of accepted friends
 */
async function getFriends(req, res, next) {
  try {
    const friends = await prisma.friendRequest.findMany({
      where: {
        OR: [
          { senderId: req.user.id, status: 'ACCEPTED' },
          { receiverId: req.user.id, status: 'ACCEPTED' },
        ],
      },
      include: {
        sender: {
          select: {
            id: true,
            name: true,
            email: true,
            role: true,
          },
        },
        receiver: {
          select: {
            id: true,
            name: true,
            email: true,
            role: true,
          },
        },
      },
    });

    // Transform to get friend object (not sender/receiver based on current user)
    const friendsList = friends.map(f => {
      const isSender = f.senderId === req.user.id;
      const friend = isSender ? f.receiver : f.sender;
      return {
        id: friend.id,
        name: friend.name,
        email: friend.email,
        role: friend.role,
      };
    });

    return ok(res, friendsList, 'Friends retrieved');
  } catch (err) {
    next(err);
  }
}

/**
 * GET /chat/chats
 * Get all chats for the authenticated user
 */
async function getChats(req, res, next) {
  try {
    const chats = await prisma.chat.findMany({
      where: {
        participants: {
          some: { userId: req.user.id },
        },
      },
      include: {
        participants: {
          include: {
            user: {
              select: {
                id: true,
                name: true,
                email: true,
                role: true,
              },
            },
          },
        },
        messages: {
          orderBy: { createdAt: 'desc' },
          take: 1,
          include: {
            sender: {
              select: { id: true, name: true },
            },
          },
        },
      },
      // Prisma does not support orderBy on relation aggregates directly.
      // We fetch all chats and sort in JS by last message time so the list
      // reflects actual conversation activity, not chat creation time (BUG-C4).
    });

    // Build response and sort by most recent activity:
    //   - chats with messages → sorted by last message createdAt desc
    //   - chats with no messages → sorted by chat createdAt desc, after messaged chats
    const chatsWithLastMessage = chats.map(chat => {
      const lastMessage = chat.messages[0];

      // For PRIVATE chats: resolve the other participant's name so the frontend
      // can display it instead of the generic "Private Chat" label (BUG-M2).
      // participants is always fetched with user data included above.
      const otherParticipant = chat.type === 'PRIVATE'
        ? (chat.participants.find(p => p.userId !== req.user.id)?.user ?? null)
        : null;

      return {
        id: chat.id,
        type: chat.type,
        // For GROUP chats use the stored name; for PRIVATE chats include
        // the other person's details so the frontend can render their name.
        name: chat.name,
        otherParticipant: otherParticipant
          ? { id: otherParticipant.id, name: otherParticipant.name, email: otherParticipant.email }
          : null,
        createdAt: chat.createdAt,
        lastMessage: lastMessage
          ? {
              content: lastMessage.content,
              senderId: lastMessage.senderId,
              senderName: lastMessage.sender?.name,
              createdAt: lastMessage.createdAt,
            }
          : null,
      };
    });

    // Sort: most recently active conversation first
    chatsWithLastMessage.sort((a, b) => {
      const aTime = a.lastMessage ? new Date(a.lastMessage.createdAt).getTime() : new Date(a.createdAt).getTime();
      const bTime = b.lastMessage ? new Date(b.lastMessage.createdAt).getTime() : new Date(b.createdAt).getTime();
      return bTime - aTime;
    });

    return ok(res, chatsWithLastMessage, 'Chats retrieved');
  } catch (err) {
    next(err);
  }
}

/**
 * POST /chat/private/:friendId
 * Create a private chat with a friend
 */
async function createPrivateChat(req, res, next) {
  try {
    const { friendId } = req.params;

    // Verify friendship exists
    const friendship = await prisma.friendRequest.findFirst({
      where: {
        OR: [
          { senderId: req.user.id, receiverId: friendId, status: 'ACCEPTED' },
          { senderId: friendId, receiverId: req.user.id, status: 'ACCEPTED' },
        ],
      },
    });

    if (!friendship) {
      return validationError(res, 'You must be friends to start a private chat');
    }

    // Check if chat already exists
    const existingChat = await prisma.chat.findFirst({
      where: {
        type: 'PRIVATE',
        participants: {
          some: { userId: req.user.id },
        },
        AND: {
          participants: {
            some: { userId: friendId },
          },
        },
      },
    });

    if (existingChat) {
      return ok(res, existingChat, 'Chat already exists');
    }

    // Create new private chat
    const chat = await prisma.chat.create({
      data: {
        type: 'PRIVATE',
        participants: {
          create: [
            { userId: req.user.id },
            { userId: friendId },
          ],
        },
      },
      include: {
        participants: {
          include: {
            user: {
              select: {
                id: true,
                name: true,
                email: true,
                role: true,
              },
            },
          },
        },
      },
    });

    return ok(res, chat, 'Private chat created');
  } catch (err) {
    next(err);
  }
}

/**
 * POST /chat/group
 * Create a group chat
 */
async function createGroupChat(req, res, next) {
  try {
    const { name, participantIds } = req.body;

    if (!name || name.trim() === '') {
      return validationError(res, 'Group name is required');
    }

    if (!participantIds || !Array.isArray(participantIds) || participantIds.length < 2) {
      return validationError(res, 'Group chat must have at least 2 participants');
    }

    // Include current user in participants
    const allParticipantIds = [...new Set([...participantIds, req.user.id])];

    // Create group chat
    const chat = await prisma.chat.create({
      data: {
        type: 'GROUP',
        name: name.trim(),
        createdById: req.user.id,
        participants: {
          create: allParticipantIds.map(userId => ({ userId })),
        },
      },
      include: {
        participants: {
          include: {
            user: {
              select: {
                id: true,
                name: true,
                email: true,
                role: true,
              },
            },
          },
        },
      },
    });

    return ok(res, chat, 'Group chat created');
  } catch (err) {
    next(err);
  }
}

/**
 * GET /chat/chats/:chatId/messages
 * Get messages in a chat
 */
async function getMessages(req, res, next) {
  try {
    const { chatId } = req.params;
    const { page = 1, limit = 50 } = req.query;

    // Verify user has access to this chat
    const chat = await prisma.chat.findFirst({
      where: {
        id: chatId,
        participants: {
          some: { userId: req.user.id },
        },
      },
    });

    if (!chat) {
      return notFound(res, 'Chat not found or access denied');
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);

    const [messages, total] = await Promise.all([
      prisma.message.findMany({
        where: { chatId },
        include: {
          sender: {
            select: {
              id: true,
              name: true,
              email: true,
              role: true,
            },
          },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: parseInt(limit),
      }),
      prisma.message.count({ where: { chatId } }),
    ]);

    return ok(res, {
      messages,
      pagination: { total, page: parseInt(page), limit: parseInt(limit), pages: Math.ceil(total / parseInt(limit)) },
    }, 'Messages retrieved');
  } catch (err) {
    next(err);
  }
}

/**
 * POST /chat/chats/:chatId/messages
 * Send a message in a chat
 */
async function sendMessage(req, res, next) {
  try {
    const { chatId } = req.params;
    const { content } = req.body;

    if (!content || content.trim() === '') {
      return validationError(res, 'Message content is required');
    }

    // Verify user has access to this chat
    const chat = await prisma.chat.findFirst({
      where: {
        id: chatId,
        participants: {
          some: { userId: req.user.id },
        },
      },
    });

    if (!chat) {
      return notFound(res, 'Chat not found or access denied');
    }

    const message = await prisma.message.create({
      data: {
        chatId,
        senderId: req.user.id,
        content: content.trim(),
      },
      include: {
        sender: {
          select: {
            id: true,
            name: true,
            email: true,
            role: true,
          },
        },
      },
    });

    // Emit real-time event via Socket.IO to all sockets in the chat room.
    // Use getIO() — the module exports this function, not a raw .io property.
    const io = require('../services/realtimeEngine').getIO();
    if (io) {
      io.to(`chat:${chatId}`).emit('newMessage', {
        message,
        chatId,
      });
    }

    return ok(res, message, 'Message sent');
  } catch (err) {
    next(err);
  }
}

module.exports = {
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
};
