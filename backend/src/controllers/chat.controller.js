const prisma = require('../utils/prisma');
const { ok, notFound, forbidden, validationError } = require('../utils/respond');
const logger = require('../utils/logger');

/**
 * GET /chat/users
 * Search users for chat discovery.
 *
 * SEC-5 fix: interns previously saw the full active user directory (name, email,
 * role of every admin and lead). This is now scoped to:
 *   - Existing friends (ACCEPTED friend requests in either direction)
 *   - Members of any team the current user belongs to
 *   - Search results are filtered to only those two groups
 *
 * Admins/leads retain the broader view since they need to initiate chats
 * across the organisation.
 */
async function getUsers(req, res, next) {
  try {
    const { q } = req.query;
    const { ROLES } = require('../constants/roles');

    const ADMIN_ROLES = new Set([
      ROLES.CORE_ADMIN,
      ROLES.TECHNICAL_LEAD,
      ROLES.OPERATIONS_LEAD,
      ROLES.RESEARCH_LEAD,
      ROLES.OPERATIONS_PROGRAM_MANAGER,
      ROLES.OBSERVER_TEAM_LEAD,
      ROLES.COLLABORATOR_LEAD,
    ]);

    const isAdmin = ADMIN_ROLES.has(req.user.role);

    let allowedUserIds = null; // null = no restriction (admin path)

    if (!isAdmin) {
      // Build the set of user IDs this user is allowed to discover:
      // 1. Accepted friends
      const friendships = await prisma.friendRequest.findMany({
        where: {
          status: 'ACCEPTED',
          OR: [
            { senderId: req.user.id },
            { receiverId: req.user.id },
          ],
        },
        select: { senderId: true, receiverId: true },
      });
      const friendIds = friendships.map(f =>
        f.senderId === req.user.id ? f.receiverId : f.senderId
      );

      // 2. Teammates — users in any team the current user belongs to
      const userTeams = await prisma.userTeam.findMany({
        where: { userId: req.user.id, leftAt: null },
        select: { teamId: true },
      });
      const teamIds = userTeams.map(t => t.teamId);

      let teammateIds = [];
      if (teamIds.length > 0) {
        const teammates = await prisma.userTeam.findMany({
          where: { teamId: { in: teamIds }, leftAt: null, userId: { not: req.user.id } },
          select: { userId: true },
        });
        teammateIds = teammates.map(t => t.userId);
      }

      allowedUserIds = [...new Set([...friendIds, ...teammateIds])];
    }

    const idFilter = allowedUserIds !== null
      ? { in: allowedUserIds.filter(id => id !== req.user.id) }
      : { not: req.user.id };

    const baseWhere = {
      id: idFilter,
      status: 'active',
    };

    const where = q
      ? {
          ...baseWhere,
          OR: [
            { name:  { contains: q, mode: 'insensitive' } },
            { email: { contains: q, mode: 'insensitive' } },
          ],
        }
      : baseWhere;

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
        // MED-4 fix: instead of loading every participant's full user record for
        // every chat (O(participants × chats) rows), we fetch only the minimum
        // needed for each chat type:
        //   PRIVATE → we need the other participant's user details (name/email)
        //   GROUP   → we only need a count to display "N members"
        // We always need the current user's own participant record for lastReadAt.
        // Fetching all participants but selecting only id+userId+user(id/name/email)
        // is still leaner than the previous full-user include, and avoids a
        // separate query. The take: 2 cap means at most 2 rows per PRIVATE chat,
        // while GROUP chats only expose a _count, not the full list.
        participants: {
          select: {
            userId:     true,
            lastReadAt: true,
            user: {
              select: {
                id:    true,
                name:  true,
                email: true,
              },
            },
          },
        },
        _count: {
          select: { participants: true },
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

    // ── HIGH-3 fix: replace N+1 unread count loop with a single raw query ────
    // Previously: one prisma.message.count() per chat inside Promise.all → N+1.
    // Now: one SQL query that counts unread messages per chatId for this user,
    // respecting each chat's individual lastReadAt cutoff from ChatParticipant.
    //
    // The query joins Message → ChatParticipant (for this user) and counts rows
    // where senderId ≠ userId AND createdAt > lastReadAt (or lastReadAt IS NULL).
    const chatIds = chats.map(c => c.id);
    let unreadCountMap = {};

    if (chatIds.length > 0) {
      // Build a VALUES list of (chatId::uuid) to safely pass the id array.
      // prisma.$queryRaw uses tagged-template parameterisation — Prisma expands
      // the Prisma.join() helper into $1, $2, … bound parameters, never raw strings.
      const { Prisma } = require('@prisma/client');
      const rows = await prisma.$queryRaw`
        SELECT
          m."chatId",
          COUNT(*)::int AS "unreadCount"
        FROM "Message" m
        JOIN "ChatParticipant" cp
          ON cp."chatId" = m."chatId"
         AND cp."userId" = ${req.user.id}
        WHERE
          m."chatId" IN (${Prisma.join(chatIds)})
          AND m."senderId" != ${req.user.id}
          AND m."isDeleted" = false
          AND (cp."lastReadAt" IS NULL OR m."createdAt" > cp."lastReadAt")
        GROUP BY m."chatId"
      `;
      for (const row of rows) {
        unreadCountMap[row.chatId] = row.unreadCount;
      }
    }

    // Build response and sort by most recent activity:
    //   - chats with messages → sorted by last message createdAt desc
    //   - chats with no messages → sorted by chat createdAt desc, after messaged chats
    const chatsWithLastMessage = chats.map(chat => {
      const lastMessage = chat.messages[0];

      // For PRIVATE chats: resolve the other participant's name so the frontend
      // can display it instead of the generic "Private Chat" label (BUG-M2).
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
        unreadCount: unreadCountMap[chat.id] ?? 0,
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

    // FEAT-S4: attach the set of currently-online participant userIds so the
    // frontend can render presence dots without a separate API call.
    const allParticipantIds = [...new Set(chats.flatMap(c => c.participants.map(p => p.userId)))];
    const { getOnlineUserIds } = require('../services/realtimeEngine');
    const onlineUserIds = getOnlineUserIds(allParticipantIds);

    return ok(res, { chats: chatsWithLastMessage, onlineUserIds }, 'Chats retrieved');
  } catch (err) {
    next(err);
  }
}

/**
 * POST /chat/private/:friendId
 * Create a private chat with a friend.
 *
 * MED-1 fix: the existence-check and creation are now inside a serializable
 * transaction. Without this, two concurrent requests (both users clicking
 * "Chat" at the same moment) could both pass the existence check and both
 * create a PRIVATE chat, leaving a duplicate room.
 *
 * The transaction re-runs the existence check under a write lock so only
 * one request wins; the second sees the chat created by the first and
 * returns it instead of creating another.
 */
async function createPrivateChat(req, res, next) {
  try {
    const { friendId } = req.params;

    // Verify friendship exists — this read can stay outside the transaction
    // because the friendship status is not modified by this endpoint.
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

    // Wrap check + create in a transaction so concurrent requests are serialised.
    // isolationLevel: Serializable ensures the SELECT inside sees a consistent
    // snapshot and the subsequent INSERT is atomic with respect to it.
    const chat = await prisma.$transaction(async (tx) => {
      // Re-check inside the transaction — this is the authoritative check.
      const existingChat = await tx.chat.findFirst({
        where: {
          type: 'PRIVATE',
          participants: { some: { userId: req.user.id } },
          AND: { participants: { some: { userId: friendId } } },
        },
        include: { _count: { select: { participants: true } } },
      });

      if (existingChat && existingChat._count.participants === 2) {
        return existingChat;
      }

      // Create new private chat — only one transaction will reach this point.
      return tx.chat.create({
        data: {
          type:        'PRIVATE',
          // LOW-2: record who initiated the private chat. Previously always null
          // for PRIVATE chats, making audit queries on Chat.createdById unreliable.
          createdById: req.user.id,
          participants: {
            create: [
              { userId: req.user.id },
              { userId: friendId },
            ],
          },
        },
        include: {
          _count: { select: { participants: true } },
        },
      });
    }, { isolationLevel: 'Serializable' });

    return ok(res, chat, chat.createdAt ? 'Private chat created' : 'Chat already exists');
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

    // Deduplicate and exclude self — current user is added automatically
    const otherParticipantIds = [...new Set(participantIds.filter(id => id !== req.user.id))];

    // Verify the creator is friends with every participant they are adding (BUG-H3 fix).
    // A user should not be able to silently add someone who has not connected with them.
    const friendships = await prisma.friendRequest.findMany({
      where: {
        status: 'ACCEPTED',
        OR: [
          { senderId: req.user.id, receiverId: { in: otherParticipantIds } },
          { senderId: { in: otherParticipantIds }, receiverId: req.user.id },
        ],
      },
      select: { senderId: true, receiverId: true },
    });

    // Build the set of user IDs the creator is actually friends with
    const friendIds = new Set(
      friendships.map(f => f.senderId === req.user.id ? f.receiverId : f.senderId)
    );

    const nonFriends = otherParticipantIds.filter(id => !friendIds.has(id));
    if (nonFriends.length > 0) {
      return validationError(res, 'You can only add friends to a group chat');
    }

    const allParticipantIds = [...otherParticipantIds, req.user.id];

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

    const [messages, total, participants] = await Promise.all([
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
        // Dual sort: createdAt desc as primary, id desc as stable tiebreaker.
        // This prevents page drift when new messages arrive mid-pagination (BUG-H5).
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip,
        take: parseInt(limit),
      }),
      prisma.message.count({ where: { chatId } }),
      // Fetch all participants' lastReadAt for read receipt computation
      prisma.chatParticipant.findMany({
        where:  { chatId },
        select: { userId: true, lastReadAt: true },
      }),
    ]);

    // Build userId → lastReadAt map for the frontend tick logic
    const participantReadMap = Object.fromEntries(
      participants.map(p => [p.userId, p.lastReadAt ? p.lastReadAt.toISOString() : null])
    );

    return ok(res, {
      messages,
      pagination: { total, page: parseInt(page), limit: parseInt(limit), pages: Math.ceil(total / parseInt(limit)) },
      // Per-participant lastReadAt map — keyed by userId.
      // The frontend uses this to determine the seen-by status of each message:
      // a message is seen by participant X if message.createdAt <= lastReadAt[X].
      participantReadMap,
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

    // FEAT-S2: reject the message if any participant in this chat has blocked the sender
    const blockExists = await prisma.userBlock.findFirst({
      where: {
        blockedId:  req.user.id,           // sender is the blocked party
        blocker: {
          chats: { some: { chatId } },     // and the blocker is in this chat
        },
      },
    });
    if (blockExists) {
      return forbidden(res, 'You cannot send messages in this conversation');
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
    const { getIO, getOfflineParticipants } = require('../services/realtimeEngine');
    const io = getIO();
    if (io) {
      io.to(`chat:${chatId}`).emit('newMessage', {
        message,
        chatId,
      });
    }

    // FEAT-1: Email notification for offline participants.
    // We fire-and-forget (void) so the HTTP response is not held up by email.
    // Only participants who have NO active socket in the chat room are emailed —
    // online users already received the message via the socket above.
    void (async () => {
      try {
        const { notifyNewChatMessage } = require('../services/notification.service');

        // Fetch all participants except the sender, with their user email + name
        const participants = await prisma.chatParticipant.findMany({
          where: {
            chatId,
            userId: { not: req.user.id },
          },
          select: {
            userId: true,
            user: { select: { id: true, name: true, email: true } },
          },
        });

        const participantIds = participants.map(p => p.userId);
        const offlineIds = getOfflineParticipants(chatId, participantIds, req.user.id);

        if (offlineIds.length === 0) return;

        // Determine the chat display name: for PRIVATE chats it's the sender's name;
        // for GROUP chats it's the group name.
        const chatRecord = await prisma.chat.findUnique({
          where: { id: chatId },
          select: { type: true, name: true },
        });
        const chatDisplayName = chatRecord?.type === 'GROUP'
          ? (chatRecord.name ?? 'Group Chat')
          : (message.sender?.name ?? 'Someone');

        const senderName = message.sender?.name ?? 'Someone';
        const preview    = message.content;

        for (const offlineId of offlineIds) {
          const participant = participants.find(p => p.userId === offlineId);
          if (!participant?.user?.email) continue;
          void notifyNewChatMessage(
            participant.user.email,
            participant.user.name || 'User',
            senderName,
            chatDisplayName,
            preview,
            chatId,
          );
        }
      } catch (err) {
        logger.warn({ err: err.message, chatId }, 'Failed to send offline message notifications');
      }
    })();

    return ok(res, message, 'Message sent');
  } catch (err) {
    next(err);
  }
}

/**
 * GET /chat/chats/:chatId/search
 * Search messages within a chat by keyword.
 * Returns up to 50 matching messages ordered by newest first.
 * Only accessible to participants of the chat.
 */
async function searchMessages(req, res, next) {
  try {
    const { chatId } = req.params;
    const { q } = req.query;

    if (!q || !q.trim()) {
      return validationError(res, 'Search query is required');
    }

    // Verify participant access
    const participant = await prisma.chatParticipant.findUnique({
      where: { chatId_userId: { chatId, userId: req.user.id } },
      select: { id: true },
    });
    if (!participant) {
      return notFound(res, 'Chat not found or access denied');
    }

    const messages = await prisma.message.findMany({
      where: {
        chatId,
        isDeleted: false,
        content: { contains: q.trim(), mode: 'insensitive' },
      },
      include: {
        sender: {
          select: { id: true, name: true, email: true, role: true },
        },
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 50,
    });

    return ok(res, { messages, query: q.trim(), count: messages.length }, 'Search results');
  } catch (err) {
    next(err);
  }
}

/**
 * PATCH /chat/messages/:messageId
 * Edit a message. Only the sender can edit their own messages.
 * Sets editedAt to now and updates content.
 * Broadcasts messageEdited socket event to the chat room.
 */
async function editMessage(req, res, next) {
  try {
    const { messageId } = req.params;
    const { content } = req.body;

    if (!content || !content.trim()) {
      return validationError(res, 'Content is required');
    }

    const message = await prisma.message.findUnique({
      where: { id: messageId },
      select: { id: true, chatId: true, senderId: true, isDeleted: true },
    });

    if (!message) return notFound(res, 'Message not found');
    if (message.senderId !== req.user.id) return forbidden(res, 'You can only edit your own messages');
    if (message.isDeleted) return validationError(res, 'Cannot edit a deleted message');

    const updated = await prisma.message.update({
      where: { id: messageId },
      data:  { content: content.trim(), editedAt: new Date() },
      include: {
        sender: { select: { id: true, name: true, email: true, role: true } },
      },
    });

    // Broadcast edit to all chat participants in real-time
    const io = require('../services/realtimeEngine').getIO();
    if (io) {
      io.to(`chat:${message.chatId}`).emit('messageEdited', { message: updated, chatId: message.chatId });
    }

    return ok(res, updated, 'Message updated');
  } catch (err) {
    next(err);
  }
}

/**
 * DELETE /chat/messages/:messageId
 * Soft-delete a message. Only the sender can delete their own messages.
 * Sets isDeleted=true, deletedAt=now. Content is preserved in DB but
 * the frontend replaces it with a tombstone "Message deleted".
 * Broadcasts messageDeleted socket event to the chat room.
 */
async function deleteMessage(req, res, next) {
  try {
    const { messageId } = req.params;

    const message = await prisma.message.findUnique({
      where: { id: messageId },
      select: { id: true, chatId: true, senderId: true, isDeleted: true },
    });

    if (!message) return notFound(res, 'Message not found');
    if (message.senderId !== req.user.id) return forbidden(res, 'You can only delete your own messages');
    if (message.isDeleted) return validationError(res, 'Message already deleted');

    const updated = await prisma.message.update({
      where: { id: messageId },
      data:  { isDeleted: true, deletedAt: new Date() },
      select: { id: true, chatId: true, isDeleted: true, deletedAt: true },
    });

    // Broadcast deletion to all chat participants in real-time
    const io = require('../services/realtimeEngine').getIO();
    if (io) {
      io.to(`chat:${message.chatId}`).emit('messageDeleted', { messageId, chatId: message.chatId });
    }

    return ok(res, updated, 'Message deleted');
  } catch (err) {
    next(err);
  }
}

/**
 * PATCH /chat/chats/:chatId/read
 * Mark a chat as read by updating the current user's lastReadAt timestamp.
 * Called when the user opens a conversation. Resets the unread badge.
 * Broadcasts chat:read to the room so other participants' tick indicators update.
 */
async function markChatRead(req, res, next) {
  try {
    const { chatId } = req.params;

    // Verify the user is a participant — do not allow marking chats they can't see
    const participant = await prisma.chatParticipant.findUnique({
      where: { chatId_userId: { chatId, userId: req.user.id } },
      select: { id: true },
    });

    if (!participant) {
      return notFound(res, 'Chat not found or access denied');
    }

    const now = new Date();
    await prisma.chatParticipant.update({
      where: { chatId_userId: { chatId, userId: req.user.id } },
      data:  { lastReadAt: now },
    });

    // Broadcast so senders in the room see their tick update to "seen"
    const io = require('../services/realtimeEngine').getIO();
    if (io) {
      io.to(`chat:${chatId}`).emit('chat:read', {
        chatId,
        userId:     req.user.id,
        lastReadAt: now.toISOString(),
      });
    }

    return ok(res, null, 'Chat marked as read');
  } catch (err) {
    next(err);
  }
}

// ── Group Chat Management ──────────────────────────────────────────────────────

/**
 * GET /chat/chats/:chatId
 * Return full chat details including all participants with user info.
 * Available to any participant of the chat (private or group).
 */
async function getChatDetails(req, res, next) {
  try {
    const { chatId } = req.params;

    const chat = await prisma.chat.findFirst({
      where: {
        id: chatId,
        participants: { some: { userId: req.user.id } },
      },
      include: {
        participants: {
          orderBy: { joinedAt: 'asc' },
          include: {
            user: {
              select: { id: true, name: true, email: true, role: true },
            },
          },
        },
      },
    });

    if (!chat) return notFound(res, 'Chat not found or access denied');

    return ok(res, {
      id:          chat.id,
      type:        chat.type,
      name:        chat.name,
      createdById: chat.createdById,
      createdAt:   chat.createdAt,
      participants: chat.participants.map(p => ({
        userId:   p.userId,
        joinedAt: p.joinedAt,
        user:     p.user,
      })),
    }, 'Chat details retrieved');
  } catch (err) {
    next(err);
  }
}

/**
 * PATCH /chat/chats/:chatId/name
 * Rename a group chat. Only the chat creator may rename it.
 */
async function renameGroupChat(req, res, next) {
  try {
    const { chatId } = req.params;
    const { name } = req.body;

    if (!name || !name.trim()) {
      return validationError(res, 'Name is required');
    }

    const chat = await prisma.chat.findFirst({
      where: { id: chatId, participants: { some: { userId: req.user.id } } },
      select: { id: true, type: true, createdById: true },
    });

    if (!chat) return notFound(res, 'Chat not found or access denied');
    if (chat.type !== 'GROUP') return validationError(res, 'Only group chats can be renamed');
    if (chat.createdById !== req.user.id) return forbidden(res, 'Only the group creator can rename this chat');

    const updated = await prisma.chat.update({
      where: { id: chatId },
      data:  { name: name.trim() },
      select: { id: true, name: true },
    });

    // Broadcast the rename to everyone in the room so the header updates live
    const { getIO } = require('../services/realtimeEngine');
    const io = getIO();
    if (io) {
      io.to(`chat:${chatId}`).emit('chat:renamed', { chatId, name: updated.name });
    }

    logger.info({ chatId, newName: updated.name, userId: req.user.id }, 'Group chat renamed');
    return ok(res, updated, 'Group chat renamed');
  } catch (err) {
    next(err);
  }
}

/**
 * POST /chat/chats/:chatId/participants
 * Add a participant to a group chat.
 * Restricted to the group creator. The new member must be a friend of the creator.
 */
async function addGroupParticipant(req, res, next) {
  try {
    const { chatId } = req.params;
    const { userId: newUserId } = req.body;

    if (!newUserId) return validationError(res, 'userId is required');

    const chat = await prisma.chat.findFirst({
      where: { id: chatId, participants: { some: { userId: req.user.id } } },
      select: { id: true, type: true, createdById: true },
    });

    if (!chat) return notFound(res, 'Chat not found or access denied');
    if (chat.type !== 'GROUP') return validationError(res, 'Can only add participants to group chats');
    if (chat.createdById !== req.user.id) return forbidden(res, 'Only the group creator can add participants');

    // New member must already be a friend of the creator
    const friendship = await prisma.friendRequest.findFirst({
      where: {
        status: 'ACCEPTED',
        OR: [
          { senderId: req.user.id, receiverId: newUserId },
          { senderId: newUserId,   receiverId: req.user.id },
        ],
      },
    });
    if (!friendship) return validationError(res, 'You can only add friends to a group chat');

    // Check they are not already a participant
    const existing = await prisma.chatParticipant.findUnique({
      where: { chatId_userId: { chatId, userId: newUserId } },
    });
    if (existing) return validationError(res, 'User is already in this chat');

    const participant = await prisma.chatParticipant.create({
      data: { chatId, userId: newUserId },
      include: { user: { select: { id: true, name: true, email: true, role: true } } },
    });

    // Notify room members in real-time
    const { getIO } = require('../services/realtimeEngine');
    const io = getIO();
    if (io) {
      io.to(`chat:${chatId}`).emit('chat:participant_added', {
        chatId,
        user: participant.user,
      });
    }

    logger.info({ chatId, newUserId, addedBy: req.user.id }, 'Participant added to group chat');
    return ok(res, participant, 'Participant added');
  } catch (err) {
    next(err);
  }
}

/**
 * DELETE /chat/chats/:chatId/participants/:userId
 * Remove a participant from a group chat.
 * - The group creator can remove anyone.
 * - A participant can remove themselves (same as leaveGroupChat but explicit).
 */
async function removeGroupParticipant(req, res, next) {
  try {
    const { chatId, userId: targetUserId } = req.params;

    const chat = await prisma.chat.findFirst({
      where: { id: chatId, participants: { some: { userId: req.user.id } } },
      select: { id: true, type: true, createdById: true },
    });

    if (!chat) return notFound(res, 'Chat not found or access denied');
    if (chat.type !== 'GROUP') return validationError(res, 'Can only remove participants from group chats');

    const isSelf    = targetUserId === req.user.id;
    const isCreator = chat.createdById === req.user.id;

    if (!isSelf && !isCreator) {
      return forbidden(res, 'Only the group creator can remove other participants');
    }

    // Prevent the creator from removing themselves via this endpoint — use leaveGroupChat
    if (isSelf && isCreator) {
      return validationError(res, 'Creators must use the leave endpoint, which transfers ownership first');
    }

    const target = await prisma.chatParticipant.findUnique({
      where: { chatId_userId: { chatId, userId: targetUserId } },
    });
    if (!target) return notFound(res, 'Participant not found in this chat');

    await prisma.chatParticipant.delete({
      where: { chatId_userId: { chatId, userId: targetUserId } },
    });

    const { getIO } = require('../services/realtimeEngine');
    const io = getIO();
    if (io) {
      io.to(`chat:${chatId}`).emit('chat:participant_removed', { chatId, userId: targetUserId });
    }

    logger.info({ chatId, targetUserId, removedBy: req.user.id }, 'Participant removed from group chat');
    return ok(res, null, 'Participant removed');
  } catch (err) {
    next(err);
  }
}

/**
 * POST /chat/chats/:chatId/leave
 * Leave a group chat.
 * If the leaving user is the creator, ownership transfers to the next oldest
 * participant (by joinedAt). If no other participants remain, the chat is deleted.
 */
async function leaveGroupChat(req, res, next) {
  try {
    const { chatId } = req.params;

    const chat = await prisma.chat.findFirst({
      where: { id: chatId, participants: { some: { userId: req.user.id } } },
      select: { id: true, type: true, createdById: true },
    });

    if (!chat) return notFound(res, 'Chat not found or access denied');
    if (chat.type !== 'GROUP') return validationError(res, 'Can only leave group chats');

    const isCreator = chat.createdById === req.user.id;

    // Find all other participants ordered by joinedAt to determine successor
    const others = await prisma.chatParticipant.findMany({
      where:   { chatId, userId: { not: req.user.id } },
      orderBy: { joinedAt: 'asc' },
      select:  { userId: true },
    });

    if (others.length === 0) {
      // Last person — delete the entire chat (cascades to messages + participants)
      await prisma.chat.delete({ where: { id: chatId } });
      logger.info({ chatId, userId: req.user.id }, 'Group chat deleted — last member left');
      return ok(res, null, 'You were the last member. The group has been deleted.');
    }

    await prisma.$transaction(async (tx) => {
      // Remove the leaving user
      await tx.chatParticipant.delete({
        where: { chatId_userId: { chatId, userId: req.user.id } },
      });

      // Transfer ownership if the creator is leaving
      if (isCreator) {
        await tx.chat.update({
          where: { id: chatId },
          data:  { createdById: others[0].userId },
        });
      }
    });

    const { getIO } = require('../services/realtimeEngine');
    const io = getIO();
    if (io) {
      io.to(`chat:${chatId}`).emit('chat:participant_removed', {
        chatId,
        userId:          req.user.id,
        newCreatorId:    isCreator ? others[0].userId : undefined,
      });
    }

    logger.info({ chatId, userId: req.user.id, ownershipTransferred: isCreator }, 'User left group chat');
    return ok(res, null, 'You have left the group chat');
  } catch (err) {
    next(err);
  }
}

// ── Block / Unblock ────────────────────────────────────────────────────────────

/**
 * POST /chat/blocks/:userId
 * Block a user. Idempotent — blocking an already-blocked user is a no-op.
 * Once blocked:
 *   - Their messages are hidden in the sender's view (frontend filters them)
 *   - sendMessage rejects any message from a blocked user into this chat
 */
async function blockUser(req, res, next) {
  try {
    const { userId: blockedId } = req.params;

    if (blockedId === req.user.id) {
      return validationError(res, 'Cannot block yourself');
    }

    // Verify target user exists
    const target = await prisma.user.findUnique({
      where: { id: blockedId },
      select: { id: true },
    });
    if (!target) return notFound(res, 'User not found');

    // Upsert — if already blocked, this is a no-op
    await prisma.userBlock.upsert({
      where:  { blockerId_blockedId: { blockerId: req.user.id, blockedId } },
      update: {},
      create: { blockerId: req.user.id, blockedId },
    });

    logger.info({ blockerId: req.user.id, blockedId }, 'User blocked');
    return ok(res, null, 'User blocked');
  } catch (err) {
    next(err);
  }
}

/**
 * DELETE /chat/blocks/:userId
 * Unblock a user.
 */
async function unblockUser(req, res, next) {
  try {
    const { userId: blockedId } = req.params;

    await prisma.userBlock.deleteMany({
      where: { blockerId: req.user.id, blockedId },
    });

    logger.info({ blockerId: req.user.id, blockedId }, 'User unblocked');
    return ok(res, null, 'User unblocked');
  } catch (err) {
    next(err);
  }
}

/**
 * GET /chat/blocks
 * Get the current user's block list (IDs they have blocked).
 */
async function getBlockList(req, res, next) {
  try {
    const blocks = await prisma.userBlock.findMany({
      where: { blockerId: req.user.id },
      select: {
        blockedId: true,
        createdAt: true,
        blocked: { select: { id: true, name: true, email: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    return ok(res, blocks, 'Block list retrieved');
  } catch (err) {
    next(err);
  }
}

// ── Cross-conversation search ──────────────────────────────────────────────────

/**
 * GET /chat/search?q=keyword
 * Search messages across ALL chats the current user participates in.
 * Returns up to 50 results ordered by most recent, grouped by chat.
 */
async function searchAllMessages(req, res, next) {
  try {
    const { q } = req.query;

    if (!q || !q.trim()) {
      return validationError(res, 'Search query is required');
    }

    // Get all chat IDs this user participates in
    const participations = await prisma.chatParticipant.findMany({
      where:  { userId: req.user.id },
      select: { chatId: true },
    });
    const chatIds = participations.map(p => p.chatId);

    if (chatIds.length === 0) {
      return ok(res, { results: [], query: q.trim(), count: 0 }, 'No chats to search');
    }

    const messages = await prisma.message.findMany({
      where: {
        chatId:    { in: chatIds },
        isDeleted: false,
        content:   { contains: q.trim(), mode: 'insensitive' },
      },
      include: {
        sender: { select: { id: true, name: true } },
        chat:   { select: { id: true, type: true, name: true } },
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 50,
    });

    return ok(res, { results: messages, query: q.trim(), count: messages.length }, 'Search results');
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
};
