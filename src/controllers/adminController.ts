import { Response } from 'express';
import prisma from '../utils/prisma';
import { AuthRequest } from '../middleware/auth';
import { paramInt, queryInt } from '../utils/params';

export async function getDashboardCounts(_req: AuthRequest, res: Response): Promise<void> {
  const [users, businessCards, promotions, vouchers, categories, reviews, feedbacks, ads, adCampaigns, bookings, events] =
    await Promise.all([
      prisma.user.count(),
      prisma.businessCard.count(),
      prisma.businessPromotion.count(),
      prisma.voucher.count(),
      prisma.category.count(),
      prisma.review.count(),
      prisma.feedback.count(),
      prisma.ad.count(),
      prisma.adCampaign.count(),
      prisma.booking.count(),
      prisma.event.count(),
    ]);

  res.json({ users, businessCards, promotions, vouchers, categories, reviews, feedbacks, ads, adCampaigns, bookings, events });
}

// ─── Promotions ──────────────────────────────────────────────────────────────

export async function getPendingPromotions(req: AuthRequest, res: Response): Promise<void> {
  const page = queryInt(req.query.page, 1);
  const limit = queryInt(req.query.limit, 20);

  const promotions = await prisma.businessPromotion.findMany({
    where: { status: 'pending' },
    skip: (page - 1) * limit,
    take: limit,
    orderBy: { created_at: 'desc' },
    include: { user: { select: { id: true, name: true, phone: true } } },
  });
  res.json({ data: promotions, page, limit });
}

export async function approvePromotion(req: AuthRequest, res: Response): Promise<void> {
  const id = paramInt(req.params.id);
  const promo = await prisma.businessPromotion.update({ where: { id }, data: { status: 'active' } });
  res.json(promo);
}

export async function rejectPromotion(req: AuthRequest, res: Response): Promise<void> {
  const id = paramInt(req.params.id);
  const { reason } = req.body;
  const promo = await prisma.businessPromotion.update({ where: { id }, data: { status: 'rejected' } });
  res.json({ ...promo, rejection_reason: reason });
}

// ─── Ad campaign management ─────────────────────────────────────────────────

export async function listAdCampaigns(req: AuthRequest, res: Response): Promise<void> {
  const status = req.query.approval_status as string | undefined;

  // Auto-pause expired ads
  await prisma.adCampaign.updateMany({
    where: {
      status: 'active',
      end_date: { lt: new Date() }
    },
    data: { status: 'completed' }
  });

  const where: any = {};
  if (status && status !== 'all') where.approval_status = status;

  const campaigns = await prisma.adCampaign.findMany({
    where,
    orderBy: { created_at: 'desc' },
    include: {
      user: { select: { id: true, name: true, phone: true } },
      business: { select: { id: true, company_name: true, logo_url: true } },
    },
    take: 200,
  });
  res.json(campaigns);
}

export async function approveAdCampaign(req: AuthRequest, res: Response): Promise<void> {
  const id = paramInt(req.params.id);
  const campaign = await prisma.adCampaign.update({
    where: { id },
    data: { approval_status: 'approved', status: 'active' },
  });
  res.json(campaign);
}

export async function rejectAdCampaign(req: AuthRequest, res: Response): Promise<void> {
  const id = paramInt(req.params.id);
  const campaign = await prisma.adCampaign.update({
    where: { id },
    data: { approval_status: 'rejected', status: 'paused' },
  });
  res.json(campaign);
}

export async function getAdCampaignDetails(req: AuthRequest, res: Response): Promise<void> {
  try {
    const id = paramInt(req.params.id);
    console.log('[getAdCampaignDetails] Fetching campaign:', id);

    const campaign = await prisma.adCampaign.findUnique({
      where: { id },
      include: {
        user: { select: { id: true, name: true, phone: true, email: true } },
        business: { select: { id: true, company_name: true, logo_url: true } },
        variants: {
          select: { id: true, creative_url: true, label: true, impressions: true, clicks: true },
        },
      },
    });

    if (!campaign) {
      res.status(404).json({ error: 'Campaign not found' });
      return;
    }

    console.log('[getAdCampaignDetails] ✅ Found campaign:', campaign.title);
    res.json(campaign);
  } catch (err: any) {
    console.error('[getAdCampaignDetails] ❌ Error:', err);
    res.status(500).json({ error: 'Failed to fetch campaign details' });
  }
}

export async function pauseAdCampaign(req: AuthRequest, res: Response): Promise<void> {
  try {
    const id = paramInt(req.params.id);
    console.log('[pauseAdCampaign] Pausing campaign:', id);

    const campaign = await prisma.adCampaign.update({
      where: { id },
      data: { status: 'paused' },
      include: { user: { select: { id: true, name: true, phone: true } } },
    });

    console.log('[pauseAdCampaign] ✅ Campaign paused:', campaign.title);
    res.json({ message: 'Campaign paused', campaign });
  } catch (err: any) {
    console.error('[pauseAdCampaign] ❌ Error:', err);
    res.status(500).json({ error: 'Failed to pause campaign' });
  }
}

export async function resumeAdCampaign(req: AuthRequest, res: Response): Promise<void> {
  try {
    const id = paramInt(req.params.id);
    console.log('[resumeAdCampaign] Resuming campaign:', id);

    const campaign = await prisma.adCampaign.update({
      where: { id },
      data: { status: 'active' },
      include: { user: { select: { id: true, name: true, phone: true } } },
    });

    console.log('[resumeAdCampaign] ✅ Campaign resumed:', campaign.title);
    res.json({ message: 'Campaign resumed', campaign });
  } catch (err: any) {
    console.error('[resumeAdCampaign] ❌ Error:', err);
    res.status(500).json({ error: 'Failed to resume campaign' });
  }
}

export async function deleteAdCampaign(req: AuthRequest, res: Response): Promise<void> {
  try {
    const id = paramInt(req.params.id);
    console.log('[deleteAdCampaign] Deleting campaign:', id);

    // Check if campaign exists
    const campaign = await prisma.adCampaign.findUnique({ where: { id } });
    if (!campaign) {
      console.log('[deleteAdCampaign] ❌ Campaign not found:', id);
      res.status(404).json({ error: 'Campaign not found' });
      return;
    }

    // Delete variants first
    const deletedVariants = await prisma.adVariant.deleteMany({ where: { campaign_id: id } });
    console.log('[deleteAdCampaign] Deleted variants:', deletedVariants.count);

    // Delete campaign
    await prisma.adCampaign.delete({ where: { id } });

    console.log('[deleteAdCampaign] ✅ Campaign deleted:', campaign.title);
    res.json({ message: 'Campaign deleted successfully', campaign_id: id, title: campaign.title });
  } catch (err: any) {
    console.error('[deleteAdCampaign] ❌ Error:', err.message, err.code);
    res.status(500).json({ error: err.message || 'Failed to delete campaign' });
  }
}

// ─── Listing endpoints ──────────────────────────────────────────────────────

export async function listUsers(req: AuthRequest, res: Response): Promise<void> {
  const page = queryInt(req.query.page, 1);
  const limit = queryInt(req.query.limit, 50);

  const users = await prisma.user.findMany({
    skip: (page - 1) * limit,
    take: limit,
    orderBy: { created_at: 'desc' },
    select: {
      id: true, name: true, phone: true, email: true,
      profile_picture: true, created_at: true,
      user_roles: true,
    },
  });
  res.json({ data: users, page, limit });
}

export async function listBusinesses(req: AuthRequest, res: Response): Promise<void> {
  const status = req.query.approval_status as string | undefined;
  const where: any = {};
  if (status && status !== 'all') where.approval_status = status;

  const cards = await prisma.businessCard.findMany({
    where,
    orderBy: { created_at: 'desc' },
    take: 200,
    include: { user: { select: { id: true, name: true, phone: true } } },
  });
  res.json(cards);
}

export async function approveBusinessCard(req: AuthRequest, res: Response): Promise<void> {
  const id = paramInt(req.params.id);
  const card = await prisma.businessCard.update({
    where: { id },
    data: { approval_status: 'approved' },
  });
  res.json(card);
}

export async function rejectBusinessCard(req: AuthRequest, res: Response): Promise<void> {
  const id = paramInt(req.params.id);
  const card = await prisma.businessCard.update({
    where: { id },
    data: { approval_status: 'rejected' },
  });
  res.json(card);
}

export async function listEvents(_req: AuthRequest, res: Response): Promise<void> {
  const events = await prisma.event.findMany({
    orderBy: { created_at: 'desc' },
    take: 200,
  });
  res.json(events);
}

export async function listVouchers(_req: AuthRequest, res: Response): Promise<void> {
  const vouchers = await prisma.voucher.findMany({
    orderBy: { created_at: 'desc' },
    take: 200,
  });
  res.json(vouchers);
}

export async function listReviews(_req: AuthRequest, res: Response): Promise<void> {
  const reviews = await prisma.review.findMany({
    orderBy: { created_at: 'desc' },
    take: 200,
    include: { user: { select: { id: true, name: true } } },
  });
  res.json(reviews);
}
