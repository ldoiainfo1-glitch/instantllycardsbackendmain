import { Request, Response } from 'express';
import prisma from '../utils/prisma';
import { AuthRequest } from '../middleware/auth';
import { paramInt, queryInt, queryStr } from '../utils/params';
import { getIO } from '../services/socketService';
import { sendExpoPushNotification } from '../utils/push';

/** Whitelisted fields for card create/update — prevents arbitrary field injection. */
const CARD_FIELDS = [
  'full_name', 'birthdate', 'anniversary', 'gender', 'phone', 'whatsapp', 'telegram',
  'email', 'location', 'maps_link', 'company_name', 'job_title', 'company_phone',
  'company_email', 'website', 'company_address', 'company_maps_link', 'logo_url',
  'description', 'business_hours', 'category', 'established_year', 'instagram',
  'facebook', 'linkedin', 'youtube', 'twitter', 'keywords', 'offer', 'services',
  'personal_country_code', 'company_country_code', 'company_photo', 'about_business',
  'is_default', 'company_website', 'message', 'services_offered',
  'is_live', 'latitude', 'longitude', 'service_mode', 'home_service',
  'pincode', 'gst_number', 'pan_number', 'state',
] as const;

function pickCardFields(body: Record<string, any>): Record<string, any> {
  const result: Record<string, any> = {};
  for (const key of CARD_FIELDS) {
    if (key in body) result[key] = body[key];
  }
  // Coerce date strings to Date objects for Prisma DateTime fields
  for (const dateField of ['birthdate', 'anniversary'] as const) {
    if (result[dateField] && typeof result[dateField] === 'string') {
      const d = new Date(result[dateField]);
      result[dateField] = isNaN(d.getTime()) ? null : d;
    }
  }
  return result;
}

export async function listCards(req: Request, res: Response): Promise<void> {
  try {
    const page = queryInt(req.query.page, 1);
    const limit = queryInt(req.query.limit, 20);
    const search = queryStr(req.query.search);
    const category = queryStr(req.query.category);
    const approvalStatus = queryStr(req.query.approval_status);
    const isLive = req.query.is_live;

    const where: any = {};

    // Only show approved + live cards by default (public listing)
    if (approvalStatus) {
      where.approval_status = approvalStatus;
    } else {
      where.approval_status = 'approved';
    }
    if (isLive === 'true') {
      where.is_live = true;
    } else if (isLive === 'false') {
      where.is_live = false;
    } else {
      where.is_live = true; // Default: only show live cards
    }

    if (category) {
      where.category = { contains: category, mode: 'insensitive' };
    }

    if (search) {
      where.OR = [
        { full_name: { contains: search, mode: 'insensitive' as const } },
        { company_name: { contains: search, mode: 'insensitive' as const } },
        { category: { contains: search, mode: 'insensitive' as const } },
      ];
    }

    const [cards, total] = await Promise.all([
      prisma.businessCard.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { created_at: 'desc' },
        select: {
          id: true,
          user_id: true,
          full_name: true,
          phone: true,
          email: true,
          company_name: true,
          job_title: true,
          logo_url: true,
          description: true,
          category: true,
          services: true,
          offer: true,
          website: true,
          business_hours: true,
          location: true,
          maps_link: true,
          whatsapp: true,
          telegram: true,
          instagram: true,
          facebook: true,
          linkedin: true,
          youtube: true,
          twitter: true,
          company_phone: true,
          company_email: true,
          company_address: true,
          company_maps_link: true,
          keywords: true,
          established_year: true,
          gender: true,
          birthdate: true,
          anniversary: true,
          personal_country_code: true,
          company_country_code: true,
          company_photo: true,
          about_business: true,
          is_default: true,
          approval_status: true,
          is_live: true,
          latitude: true,
          longitude: true,
          service_mode: true,
          company_website: true,
          services_offered: true,
          message: true,
          pincode: true,
          state: true,
          created_at: true,
          updated_at: true,
        },
      }),
      prisma.businessCard.count({ where }),
    ]);
    res.json({ data: cards, page, limit, total });
  } catch (err) {
    console.error('[LIST-CARDS] Failed', err);
    res.status(500).json({ error: 'Failed to list cards' });
  }
}

export async function getCard(req: Request, res: Response): Promise<void> {
  try {
    const id = paramInt(req.params.id);
    const card = await prisma.businessCard.findUnique({
      where: { id },
      include: {
        user: { select: { id: true, name: true, profile_picture: true } },
        reviews: { take: 5, orderBy: { created_at: 'desc' } },
        vouchers: { where: { status: 'active' }, take: 5 },
      },
    });
    if (!card) { res.status(404).json({ error: 'Not found' }); return; }
    res.json(card);
  } catch (err) {
    console.error('[GET-CARD] Failed', err);
    res.status(500).json({ error: 'Failed to get card' });
  }
}

export async function createCard(req: AuthRequest, res: Response): Promise<void> {
  try {
    const data = pickCardFields(req.body);
    const card = await prisma.businessCard.create({
      data: { ...data, user_id: req.user!.userId, approval_status: 'pending' } as any,
    });

    // Business role is granted only via premium promotion payment (see promotionController).

    res.status(201).json(card);
  } catch (err) {
    console.error('[CREATE-CARD] Failed', err);
    res.status(500).json({ error: 'Failed to create card' });
  }
}

export async function updateCard(req: AuthRequest, res: Response): Promise<void> {
  try {
    const id = paramInt(req.params.id);
    const card = await prisma.businessCard.findUnique({ where: { id } });
    if (!card) { res.status(404).json({ error: 'Not found' }); return; }
    if (card.user_id !== req.user!.userId && !req.user!.roles.includes('admin')) {
      res.status(403).json({ error: 'Forbidden' }); return;
    }
    const data = pickCardFields(req.body);
    const updated = await prisma.businessCard.update({ where: { id }, data });
    res.json(updated);
  } catch (err) {
    console.error('[UPDATE-CARD] Failed', err);
    res.status(500).json({ error: 'Failed to update card' });
  }
}

export async function deleteCard(req: AuthRequest, res: Response): Promise<void> {
  try {
    const id = paramInt(req.params.id);
    const card = await prisma.businessCard.findUnique({ where: { id } });
    if (!card) { res.status(404).json({ error: 'Not found' }); return; }
    if (card.user_id !== req.user!.userId && !req.user!.roles.includes('admin')) {
      res.status(403).json({ error: 'Forbidden' }); return;
    }
    await prisma.businessCard.delete({ where: { id } });
    res.json({ message: 'Deleted' });
  } catch (err) {
    console.error('[DELETE-CARD] Failed', err);
    res.status(500).json({ error: 'Failed to delete card' });
  }
}

export async function getMyCards(req: AuthRequest, res: Response): Promise<void> {
  console.log(`[getMyCards] userId: ${req.user!.userId}`);
  const cards = await prisma.businessCard.findMany({
    where: { user_id: req.user!.userId },
    orderBy: { created_at: 'desc' },
  });
  console.log(`[getMyCards] Found ${cards.length} cards for user ${req.user!.userId}`);
  console.log(`[getMyCards] Card IDs: ${cards.map(c => c.id).join(', ')}`);
  res.json(cards);
}

export async function shareCard(req: AuthRequest, res: Response): Promise<void> {
  try {
    const { card_id, recipient_user_id, message } = req.body;
    const sender = await prisma.user.findUnique({ where: { id: req.user!.userId } });
    const card = await prisma.businessCard.findUnique({ where: { id: parseInt(card_id) } });
    if (!card || !sender) { res.status(404).json({ error: 'Card or sender not found' }); return; }

    const recipient = recipient_user_id
      ? await prisma.user.findUnique({ where: { id: parseInt(recipient_user_id) } })
      : null;

    // Prevent duplicate shares of the same card to the same recipient
    const existing = await prisma.sharedCard.findFirst({
      where: {
        card_id: card.id,
        sender_id: String(sender.id),
        recipient_id: recipient ? String(recipient.id) : '0',
      },
    });
    if (existing) {
      res.status(200).json({ ...existing, alreadyShared: true });
      return;
    }

    const share = await prisma.sharedCard.create({
      data: {
        card_id: card.id,
        sender_id: String(sender.id),
        recipient_id: recipient ? String(recipient.id) : '0',
        message: message || null,
        card_title: card.company_name || card.full_name,
        sender_name: sender.name || sender.phone,
        recipient_name: recipient?.name || recipient?.phone || 'Unknown',
        card_photo: card.company_photo || card.logo_url,
        sender_profile_picture: sender.profile_picture,
      },
    });
    // Notify recipient in real-time via socket
    if (recipient) {
      try {
        const io = getIO();
        if (io) {
          io.to(`user:${recipient.id}`).emit('card:shared', {
            id: share.id,
            card_id: share.card_id,
            card_title: share.card_title,
            card_photo: share.card_photo,
            sender_id: share.sender_id,
            sender_name: share.sender_name,
            recipient_id: share.recipient_id,
            sent_at: share.sent_at || share.created_at,
          });
        }
        // FCM push for when app is closed
        const recipientUser = await prisma.user.findUnique({ where: { id: recipient.id }, select: { push_token: true } });
        if (recipientUser?.push_token) {
          sendExpoPushNotification(recipientUser.push_token, 'New Business Card', `${share.sender_name} shared their card with you`, { screen: 'Messaging', tab: 'Received' });
        }
      } catch { /* non-blocking */ }
    }

    res.status(201).json(share);
  } catch (err) {
    console.error('[SHARE-CARD] Failed', err);
    res.status(500).json({ error: 'Failed to share card' });
  }
}

/**
 * POST /api/cards/exchange
 * Records a mutual card exchange triggered by scanning a QR.
 * Creates two SharedCard rows so both users see entries in their
 * Sent and Received tabs:
 *   1. scanner's card → scanned user (scanner is sender)
 *   2. scanned user's card → scanner (scanned user is sender)
 *
 * Body: { my_card_id: number, scanned_card_id: number }
 *   my_card_id      - card the scanner wants to share (must be owned by scanner)
 *   scanned_card_id - card whose QR was scanned
 */
export async function exchangeCards(req: AuthRequest, res: Response): Promise<void> {
  try {
    const scannerId = req.user!.userId;
    const { my_card_id, scanned_card_id } = req.body as {
      my_card_id: number | string;
      scanned_card_id: number | string;
    };

    const myCardId = parseInt(String(my_card_id), 10);
    const scannedCardId = parseInt(String(scanned_card_id), 10);
    if (!myCardId || !scannedCardId) {
      res.status(400).json({ error: 'my_card_id and scanned_card_id required' });
      return;
    }

    const [myCard, scannedCard, scanner] = await Promise.all([
      prisma.businessCard.findUnique({ where: { id: myCardId } }),
      prisma.businessCard.findUnique({ where: { id: scannedCardId } }),
      prisma.user.findUnique({ where: { id: scannerId } }),
    ]);

    if (!myCard || !scannedCard || !scanner) {
      res.status(404).json({ error: 'Card or user not found' });
      return;
    }
    if (myCard.user_id !== scannerId) {
      res.status(403).json({ error: 'You can only share cards you own' });
      return;
    }
    if (scannedCard.user_id === scannerId) {
      res.status(400).json({ error: 'Cannot exchange with your own card' });
      return;
    }

    const scannedUser = await prisma.user.findUnique({ where: { id: scannedCard.user_id } });
    if (!scannedUser) {
      res.status(404).json({ error: 'Scanned card owner not found' });
      return;
    }

    const scannerIdStr = String(scannerId);
    const scannedIdStr = String(scannedUser.id);

    // Helper: idempotent insert
    const upsertShare = async (
      cardId: number,
      senderIdStr: string,
      recipientIdStr: string,
      cardObj: any,
      senderObj: any,
      recipientObj: any
    ) => {
      const existing = await prisma.sharedCard.findFirst({
        where: { card_id: cardId, sender_id: senderIdStr, recipient_id: recipientIdStr },
      });
      if (existing) return { share: existing, alreadyExists: true };
      const share = await prisma.sharedCard.create({
        data: {
          card_id: cardId,
          sender_id: senderIdStr,
          recipient_id: recipientIdStr,
          message: 'Exchanged via QR scan',
          card_title: cardObj.company_name || cardObj.full_name,
          sender_name: senderObj.name || senderObj.phone,
          recipient_name: recipientObj.name || recipientObj.phone || 'Unknown',
          card_photo: cardObj.company_photo || cardObj.logo_url,
          sender_profile_picture: senderObj.profile_picture,
        },
      });
      return { share, alreadyExists: false };
    };

    const [outgoing, incoming] = await Promise.all([
      // 1. Scanner shares their card with the scanned user
      upsertShare(myCard.id, scannerIdStr, scannedIdStr, myCard, scanner, scannedUser),
      // 2. Scanned user implicitly "shared" their card with the scanner (QR exposure)
      upsertShare(scannedCard.id, scannedIdStr, scannerIdStr, scannedCard, scannedUser, scanner),
    ]);

    // Emit socket + push to scanned user about the new incoming share
    try {
      const io = getIO();
      if (io && !outgoing.alreadyExists) {
        io.to(`user:${scannedUser.id}`).emit('card:shared', {
          id: outgoing.share.id,
          card_id: outgoing.share.card_id,
          card_title: outgoing.share.card_title,
          card_photo: outgoing.share.card_photo,
          sender_id: outgoing.share.sender_id,
          sender_name: outgoing.share.sender_name,
          recipient_id: outgoing.share.recipient_id,
          sent_at: outgoing.share.sent_at || outgoing.share.created_at,
        });
      }
      if (!outgoing.alreadyExists && scannedUser.push_token) {
        sendExpoPushNotification(
          scannedUser.push_token,
          'New Card Received',
          `${outgoing.share.sender_name} exchanged cards with you`,
          { screen: 'Messaging', tab: 'Received' }
        );
      }
      if (!incoming.alreadyExists && scanner.push_token) {
        sendExpoPushNotification(
          scanner.push_token,
          'New Card Received',
          `You received ${incoming.share.sender_name}'s card`,
          { screen: 'Messaging', tab: 'Received' }
        );
      }
      // DB notifications (in-app bell)
      if (!outgoing.alreadyExists) {
        prisma.notification.create({
          data: {
            user_id: scannedUser.id,
            type: 'card_received',
            title: 'New Card Received',
            description: `${outgoing.share.sender_name} exchanged cards with you`,
          },
        }).catch(() => {});
      }
      if (!incoming.alreadyExists) {
        prisma.notification.create({
          data: {
            user_id: scanner.id,
            type: 'card_received',
            title: 'New Card Received',
            description: `You received ${incoming.share.sender_name}'s card`,
          },
        }).catch(() => {});
      }
    } catch { /* non-blocking */ }

    res.status(201).json({
      outgoing: outgoing.share,
      incoming: incoming.share,
      alreadyExists: outgoing.alreadyExists && incoming.alreadyExists,
    });
  } catch (err) {
    console.error('[EXCHANGE-CARDS] Failed', err);
    res.status(500).json({ error: 'Failed to exchange cards' });
  }
}

/**
 * POST /api/cards/save-received
 * Records that the scanner has "received" a scanned card without sending
 * their own card back. Creates a single SharedCard row where:
 *   - sender_id   = scanned card's owner
 *   - recipient_id = scanner (current user)
 * This makes the scanned card show up in the scanner's Received tab.
 *
 * Body: { scanned_card_id: number }
 */
export async function saveReceivedCard(req: AuthRequest, res: Response): Promise<void> {
  try {
    const scannerId = req.user!.userId;
    const { scanned_card_id } = req.body as { scanned_card_id: number | string };
    const cardId = parseInt(String(scanned_card_id), 10);
    if (!cardId) {
      res.status(400).json({ error: 'scanned_card_id required' });
      return;
    }

    const card = await prisma.businessCard.findUnique({ where: { id: cardId } });
    if (!card) { res.status(404).json({ error: 'Card not found' }); return; }
    if (card.user_id === scannerId) {
      res.status(400).json({ error: 'Cannot save your own card' });
      return;
    }

    const [scanner, owner] = await Promise.all([
      prisma.user.findUnique({ where: { id: scannerId } }),
      prisma.user.findUnique({ where: { id: card.user_id } }),
    ]);
    if (!scanner || !owner) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    const senderIdStr = String(owner.id);
    const recipientIdStr = String(scanner.id);

    const existing = await prisma.sharedCard.findFirst({
      where: { card_id: card.id, sender_id: senderIdStr, recipient_id: recipientIdStr },
    });
    if (existing) {
      res.status(200).json({ ...existing, alreadyExists: true });
      return;
    }

    const share = await prisma.sharedCard.create({
      data: {
        card_id: card.id,
        sender_id: senderIdStr,
        recipient_id: recipientIdStr,
        message: 'Saved via QR scan',
        card_title: card.company_name || card.full_name,
        sender_name: owner.name || owner.phone,
        recipient_name: scanner.name || scanner.phone || 'Unknown',
        card_photo: card.company_photo || card.logo_url,
        sender_profile_picture: owner.profile_picture,
      },
    });

    // Real-time + push notifications + DB notifications
    try {
      const io = getIO();
      if (io) {
        io.to(`user:${scanner.id}`).emit('card:shared', {
          id: share.id,
          card_id: share.card_id,
          card_title: share.card_title,
          card_photo: share.card_photo,
          sender_id: share.sender_id,
          sender_name: share.sender_name,
          recipient_id: share.recipient_id,
          sent_at: share.sent_at || share.created_at,
        });
      }
      if (scanner.push_token) {
        sendExpoPushNotification(
          scanner.push_token,
          'Card Saved',
          `You saved ${share.sender_name}'s card`,
          { screen: 'Messaging', tab: 'Received' }
        );
      }
      if (owner.push_token) {
        sendExpoPushNotification(
          owner.push_token,
          'Someone Saved Your Card',
          `${scanner.name || scanner.phone || 'Someone'} saved your card`,
          { screen: 'Messaging', tab: 'Received' }
        );
      }
      prisma.notification.create({
        data: {
          user_id: scanner.id,
          type: 'card_received',
          title: 'Card Saved',
          description: `You saved ${share.sender_name}'s card`,
        },
      }).catch(() => {});
      prisma.notification.create({
        data: {
          user_id: owner.id,
          type: 'card_saved_by_other',
          title: 'Someone Saved Your Card',
          description: `${scanner.name || scanner.phone || 'Someone'} saved your card`,
        },
      }).catch(() => {});
    } catch { /* non-blocking */ }

    res.status(201).json(share);
  } catch (err) {
    console.error('[SAVE-RECEIVED] Failed', err);
    res.status(500).json({ error: 'Failed to save card' });
  }
}

export async function getSharedCards(req: AuthRequest, res: Response): Promise<void> {
  try {
    const userId = String(req.user!.userId);
    const shares = await prisma.sharedCard.findMany({
      where: { OR: [{ recipient_id: userId }, { sender_id: userId }] },
      include: { card: true },
      orderBy: { created_at: 'desc' },
    });
    res.json(shares);
  } catch (err) {
    console.error('[SHARED-CARDS] Failed', err);
    res.status(500).json({ error: 'Failed to get shared cards' });
  }
}

/**
 * POST /api/cards/bulk-send
 * Sends a business card to every user who has an approved, live card
 * in the specified category (or subcategory). Skips the sender themselves
 * and skips any duplicate (same card → same recipient) within the last 30 days.
 */
export async function bulkSendCard(req: AuthRequest, res: Response): Promise<void> {
  try {
    const senderId = req.user!.userId;
    const { card_id, audience, audience_type, level } = req.body as {
      card_id: number | string;
      audience: string;          // category or subcategory name
      audience_type: 'category' | 'subcategory';
      level: string;             // zone | state | division | pincode | village
    };

    if (!card_id || !audience || !level) {
      res.status(400).json({ error: 'card_id, audience and level are required' });
      return;
    }

    const cardId = parseInt(String(card_id), 10);

    // Verify the sender owns this card
    const senderCard = await prisma.businessCard.findUnique({ where: { id: cardId } });
    if (!senderCard || senderCard.user_id !== senderId) {
      res.status(403).json({ error: 'Card not found or not owned by you' });
      return;
    }

    const sender = await prisma.user.findUnique({ where: { id: senderId } });
    if (!sender) { res.status(404).json({ error: 'Sender not found' }); return; }

    // Find all users who have approved+live cards in that category
    const recipientCards = await prisma.businessCard.findMany({
      where: {
        approval_status: 'approved',
        is_live: true,
        category: { contains: audience, mode: 'insensitive' },
        user_id: { not: senderId },  // exclude sender
      },
      select: {
        id: true,
        user_id: true,
        user: { select: { id: true, name: true, phone: true } },
      },
    });

    if (recipientCards.length === 0) {
      res.json({ sent: 0, message: 'No recipients found in this category yet' });
      return;
    }

    // Deduplicate by user_id (one user may have multiple cards in same category)
    const seenUsers = new Set<number>();
    const uniqueRecipients = recipientCards.filter((rc) => {
      if (seenUsers.has(rc.user_id)) return false;
      seenUsers.add(rc.user_id);
      return true;
    });

    // Guard against re-sending same card to same recipient within 30 days
    const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const existingSends = await prisma.sharedCard.findMany({
      where: {
        card_id: cardId,
        sender_id: String(senderId),
        sent_at: { gte: cutoff },
      },
      select: { recipient_id: true },
    });
    const alreadySentTo = new Set(existingSends.map((s) => s.recipient_id));

    const newRecipients = uniqueRecipients.filter(
      (r) => !alreadySentTo.has(String(r.user_id))
    );

    if (newRecipients.length === 0) {
      res.json({ sent: 0, message: 'Card already sent to all recipients in this category recently' });
      return;
    }

    // Batch create SharedCard rows
    await prisma.sharedCard.createMany({
      data: newRecipients.map((r) => ({
        card_id: cardId,
        sender_id: String(senderId),
        recipient_id: String(r.user_id),
        card_title: senderCard.company_name || senderCard.full_name,
        sender_name: sender.name || sender.phone,
        recipient_name: r.user?.name || r.user?.phone || 'User',
        card_photo: senderCard.company_photo || senderCard.logo_url || null,
        sender_profile_picture: sender.profile_picture ?? null,
        message: `Bulk send · ${audience} · ${level}`,
      })),
      skipDuplicates: true,
    });

    // Notify each recipient via socket + FCM
    try {
      const io = getIO();
      const recipientUsers = await prisma.user.findMany({
        where: { id: { in: newRecipients.map((r) => r.user_id) } },
        select: { id: true, push_token: true },
      });
      for (const u of recipientUsers) {
        if (io) {
          io.to(`user:${u.id}`).emit('card:shared', {
            card_id: cardId,
            card_title: senderCard.company_name || senderCard.full_name,
            sender_name: sender.name || sender.phone,
          });
        }
        if (u.push_token) {
          sendExpoPushNotification(u.push_token, 'New Business Card', `${sender.name || sender.phone} shared their card with you`, { screen: 'Messaging', tab: 'Received' });
        }
      }
    } catch { /* non-blocking */ }

    res.status(201).json({
      sent: newRecipients.length,
      audience,
      level,
      message: `Card sent to ${newRecipients.length} recipient(s) in "${audience}"`,
    });
  } catch (err) {
    console.error('[BULK-SEND] Failed', err);
    res.status(500).json({ error: 'Failed to bulk send card' });
  }
}
