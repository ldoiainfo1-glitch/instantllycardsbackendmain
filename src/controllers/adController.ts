import { Request, Response } from 'express';
import prisma from '../utils/prisma';
import { AuthRequest } from '../middleware/auth';
import { paramInt } from '../utils/params';
import { queryInt, queryStr } from '../utils/params';
import {
  normalizeAdCampaignResponse,
  normalizeAdCampaignsResponse,
  normalizeCreativeUrl,
} from '../utils/urlNormalizer';

// ─── Helpers ────────────────────────────────────────────────────────────────

const CAMPAIGN_FIELDS = [
  'title', 'description', 'ad_type', 'cta', 'creative_url', 'creative_urls',
  'target_city', 'target_age', 'target_interests', 'daily_budget',
  'duration_days', 'business_card_id',
] as const;

function pickCampaignFields(body: Record<string, any>) {
  const out: Record<string, any> = {};
  for (const key of CAMPAIGN_FIELDS) {
    if (body[key] !== undefined) out[key] = body[key];
  }
  return out;
}

// ─── Unified Ad Response (works for both Ad and AdCampaign) ────────────────

interface UnifiedAdResponse {
  id: number;
  title: string;
  description?: string;
  image_url?: string;
  cta_url?: string;
  ad_type: string;
  status: string;
  approval_status?: string;
  phone_number?: string;
  priority?: number;
  start_date?: Date | null;
  end_date?: Date | null;
  business?: { id: number; company_name: string; logo_url?: string };
  impressions?: number;
  clicks?: number;
  source: 'legacy' | 'campaign'; // Track which table it came from
}

/**
 * Normalize Ad table record to unified format
 */
function normalizeLeacyAd(ad: any): UnifiedAdResponse {
  return {
    id: ad.id,
    title: ad.title,
    description: ad.description,
    image_url: ad.bottom_image || ad.bottom_image_s3_url,
    cta_url: ad.cta_url,
    ad_type: ad.ad_type_legacy || ad.ad_type || 'banner',
    status: ad.status,
    approval_status: ad.approval_status,
    phone_number: ad.phone_number,
    priority: ad.priority,
    start_date: ad.start_date,
    end_date: ad.end_date,
    business: ad.business,
    impressions: ad.impressions,
    clicks: ad.clicks,
    source: 'legacy',
  };
}

/**
 * Normalize AdCampaign table record to unified format
 */
function normalizeCampaign(campaign: any): UnifiedAdResponse {
  return {
    id: campaign.id,
    title: campaign.title,
    description: campaign.description,
    image_url: campaign.creative_url,
    cta_url: campaign.cta,
    ad_type: campaign.ad_type,
    status: campaign.status,
    approval_status: campaign.approval_status,
    start_date: campaign.start_date,
    end_date: campaign.end_date,
    business: campaign.business,
    impressions: campaign.impressions,
    clicks: campaign.clicks,
    source: 'campaign',
  };
}

// ─── List ads (unified: campaigns + legacy fallback) ──────────────────────

export async function listAds(req: Request, res: Response): Promise<void> {
  try {
    const adType = queryStr(req.query.ad_type);
    const city = queryStr(req.query.city);
    const limit = queryInt(req.query.limit, 50);

    // Get campaigns (new system)
    const campaignWhere: any = {
      status: 'active',
      approval_status: 'approved',
      OR: [
        { end_date: null },
        { end_date: { gte: new Date() } },
      ],
    };
    if (adType) campaignWhere.ad_type = adType;
    if (city) campaignWhere.target_city = { contains: city, mode: 'insensitive' };

    const campaigns = await prisma.adCampaign.findMany({
      where: campaignWhere,
      orderBy: [{ daily_budget: 'desc' }, { created_at: 'desc' }],
      include: { business: { select: { id: true, company_name: true, logo_url: true } } },
      take: limit,
    });

    // If no campaigns, fall back to legacy ads
    let results: UnifiedAdResponse[] = campaigns.map(normalizeCampaign);

    if (results.length === 0) {
      console.log('[listAds] No campaigns found, falling back to legacy Ad table');
      const legacyWhere: any = {
        status: 'active',
        OR: [
          { end_date: null },
          { end_date: { gte: new Date() } },
        ],
      };
      if (adType) legacyWhere.ad_type_legacy = adType;

      const legacyAds = await prisma.ad.findMany({
        where: legacyWhere,
        orderBy: [{ priority: 'desc' }, { created_at: 'desc' }],
        include: { business: { select: { id: true, company_name: true, logo_url: true } } },
        take: limit,
      });

      results = legacyAds.map(normalizeLeacyAd);
    }

    // Normalize all URLs before returning
    const normalizedResults = results.map((ad) => ({
      ...ad,
      image_url: normalizeCreativeUrl(ad.image_url),
      cta_url: normalizeCreativeUrl(ad.cta_url),
    }));

    res.json(normalizedResults);
  } catch (err: any) {
    console.error('[listAds] error:', err);
    res.status(500).json({ error: 'Failed to list ads' });
  }
}

// ─── Get my ads (unified: campaigns + legacy fallback) ────────────────────

export async function getMyAds(req: AuthRequest, res: Response): Promise<void> {
  try {
    // NEW SYSTEM: Get my campaigns
    const campaigns = await prisma.adCampaign.findMany({
      where: { user_id: req.user!.userId },
      include: {
        business: { select: { id: true, company_name: true, logo_url: true } },
        variants: true,
      },
      orderBy: { created_at: 'desc' },
    });

    // LEGACY: Get my ads (fallback)
    const cards = await prisma.businessCard.findMany({
      where: { user_id: req.user!.userId },
      select: { id: true },
    });
    const cardIds = cards.map((c) => c.id);

    const legacyAds = await prisma.ad.findMany({
      where: { business_id: { in: cardIds } },
      include: { business: { select: { id: true, company_name: true, logo_url: true } } },
      orderBy: { created_at: 'desc' },
    });

    // Combine and normalize
    const results = [
      ...campaigns.map(normalizeCampaign),
      ...legacyAds.map(normalizeLeacyAd),
    ].sort((a, b) => {
      const aDate = a.start_date || new Date(0);
      const bDate = b.start_date || new Date(0);
      return bDate.getTime() - aDate.getTime();
    });

    // Normalize all URLs
    const normalized = results.map((ad) => ({
      ...ad,
      image_url: normalizeCreativeUrl(ad.image_url),
      cta_url: normalizeCreativeUrl(ad.cta_url),
    }));

    res.json(normalized);
  } catch (err: any) {
    console.error('[getMyAds] error:', err);
    res.status(500).json({ error: 'Failed to fetch ads' });
  }
}

// ─── Get my campaigns (new system only) ───────────────────────────────────

export async function getMyCampaigns(req: AuthRequest, res: Response): Promise<void> {
  try {
    // Auto-pause expired ads
    await prisma.adCampaign.updateMany({
      where: {
        user_id: req.user!.userId,
        status: 'active',
        end_date: { lt: new Date() }
      },
      data: { status: 'completed' }
    });

    const campaigns = await prisma.adCampaign.findMany({
      where: { user_id: req.user!.userId },
      include: {
        business: { select: { id: true, company_name: true, logo_url: true } },
        variants: true,
      },
      orderBy: { created_at: 'desc' },
    });

    // Normalize URLs before returning
    const normalized = normalizeAdCampaignsResponse(campaigns);
    res.json(normalized);
  } catch (err: any) {
    console.error('[getMyCampaigns] error:', err);
    res.status(500).json({ error: 'Failed to fetch campaigns' });
  }
}

// ─── Get single campaign ────────────────────────────────────────────────────

export async function getCampaign(req: AuthRequest, res: Response): Promise<void> {
  try {
    const id = paramInt(req.params.id);
    const campaign = await prisma.adCampaign.findUnique({
      where: { id },
      include: {
        business: { select: { id: true, company_name: true, logo_url: true } },
        variants: true,
      },
    });
    if (!campaign) { res.status(404).json({ error: 'Campaign not found' }); return; }

    // Normalize URLs
    const normalized = normalizeAdCampaignResponse(campaign);
    res.json(normalized);
  } catch (err: any) {
    console.error('[getCampaign] error:', err);
    res.status(500).json({ error: 'Failed to fetch campaign' });
  }
}

// ─── Create campaign ────────────────────────────────────────────────────────

export async function createCampaign(req: AuthRequest, res: Response): Promise<void> {
  try {
    const fields = pickCampaignFields(req.body);
    if (!fields.title) { res.status(422).json({ error: 'title is required' }); return; }
    if (!fields.ad_type) { res.status(422).json({ error: 'ad_type is required' }); return; }

    const dailyBudget = fields.daily_budget || 100;
    const durationDays = fields.duration_days || 7;
    const totalBudget = dailyBudget * durationDays;
    const endDate = new Date();
    endDate.setDate(endDate.getDate() + durationDays);

    const campaign = await prisma.adCampaign.create({
      data: {
        user_id: req.user!.userId,
        title: fields.title,
        description: fields.description || null,
        ad_type: fields.ad_type,
        cta: fields.cta || null,
        creative_url: fields.creative_url || null,
        creative_urls: fields.creative_urls || [],
        target_city: fields.target_city || null,
        target_age: fields.target_age || null,
        target_interests: fields.target_interests || null,
        daily_budget: dailyBudget,
        duration_days: durationDays,
        total_budget: totalBudget,
        business_card_id: fields.business_card_id ? parseInt(String(fields.business_card_id), 10) : null,
        end_date: endDate,
        status: 'active',
        approval_status: 'pending',
      },
      include: { variants: true },
    });

    // Create A/B variants if multiple creatives provided
    const urls = fields.creative_urls || [];
    if (urls.length > 1) {
      const variants = urls.map((url: string, i: number) => ({
        campaign_id: campaign.id,
        creative_url: url,
        label: String.fromCharCode(65 + i),
      }));
      await prisma.adVariant.createMany({ data: variants });
    }

    const result = await prisma.adCampaign.findUnique({
      where: { id: campaign.id },
      include: { variants: true },
    });

    res.status(201).json(result);
  } catch (err: any) {
    console.error('[createCampaign] error:', err);
    res.status(500).json({ error: 'Failed to create campaign' });
  }
}

// ─── Update campaign ────────────────────────────────────────────────────────

export async function updateCampaign(req: AuthRequest, res: Response): Promise<void> {
  try {
    const id = paramInt(req.params.id);
    const existing = await prisma.adCampaign.findUnique({ where: { id } });
    if (!existing) { res.status(404).json({ error: 'Campaign not found' }); return; }

    // Only owner or admin can update
    const roles = await prisma.userRole.findMany({ where: { user_id: req.user!.userId } });
    const isAdmin = roles.some((r) => r.role === 'admin');
    if (existing.user_id !== req.user!.userId && !isAdmin) {
      res.status(403).json({ error: 'Not authorized' });
      return;
    }

    const allowed = ['title', 'description', 'cta', 'target_city', 'target_age', 'target_interests', 'status', 'daily_budget', 'duration_days'];
    const updates: Record<string, any> = {};
    for (const key of allowed) {
      if (req.body[key] !== undefined) updates[key] = req.body[key];
    }

    // Recalculate total_budget if budget/duration changed
    if (updates.daily_budget || updates.duration_days) {
      const db = updates.daily_budget || existing.daily_budget;
      const dd = updates.duration_days || existing.duration_days;
      updates.total_budget = db * dd;
    }

    const campaign = await prisma.adCampaign.update({
      where: { id },
      data: updates,
      include: { variants: true },
    });
    res.json(campaign);
  } catch (err: any) {
    console.error('[updateCampaign] error:', err);
    res.status(500).json({ error: 'Failed to update campaign' });
  }
}

// ─── Delete campaign ────────────────────────────────────────────────────────

export async function deleteCampaign(req: AuthRequest, res: Response): Promise<void> {
  try {
    const id = paramInt(req.params.id);
    const existing = await prisma.adCampaign.findUnique({ where: { id } });
    if (!existing) { res.status(404).json({ error: 'Campaign not found' }); return; }

    const roles = await prisma.userRole.findMany({ where: { user_id: req.user!.userId } });
    const isAdmin = roles.some((r) => r.role === 'admin');
    if (existing.user_id !== req.user!.userId && !isAdmin) {
      res.status(403).json({ error: 'Not authorized' });
      return;
    }

    await prisma.adCampaign.delete({ where: { id } });
    res.json({ ok: true });
  } catch (err: any) {
    console.error('[deleteCampaign] error:', err);
    res.status(500).json({ error: 'Failed to delete campaign' });
  }
}

// ─── Track impression ───────────────────────────────────────────────────────

export async function trackImpression(req: AuthRequest, res: Response): Promise<void> {
  try {
    const id = paramInt(req.params.id);
    const variantId = req.body.variant_id ? parseInt(String(req.body.variant_id), 10) : undefined;

    const campaign = await prisma.adCampaign.findUnique({ where: { id } });
    if (!campaign) { res.status(404).json({ error: 'Campaign not found' }); return; }

    // Deduct from budget (CPM model: cost per 1000 impressions)
    const cpmRate = campaign.daily_budget / 1000; // simplified
    const txns: any[] = [
      prisma.adCampaign.update({
        where: { id },
        data: {
          impressions: { increment: 1 },
          spent: { increment: cpmRate },
        },
      }),
    ];

    if (variantId) {
      txns.push(
        prisma.adVariant.update({
          where: { id: variantId },
          data: { impressions: { increment: 1 } },
        })
      );
    }

    await prisma.$transaction(txns);

    // Pause campaign if budget exhausted
    if (campaign.total_budget && campaign.spent + cpmRate >= campaign.total_budget) {
      await prisma.adCampaign.update({
        where: { id },
        data: { status: 'completed' },
      });
    }

    res.json({ ok: true });
  } catch (err: any) {
    console.error('[trackImpression] error:', err);
    res.status(500).json({ error: 'Failed to track impression' });
  }
}

// ─── Track click ────────────────────────────────────────────────────────────

export async function trackClick(req: AuthRequest, res: Response): Promise<void> {
  try {
    const id = paramInt(req.params.id);
    const variantId = req.body.variant_id ? parseInt(String(req.body.variant_id), 10) : undefined;

    const txns: any[] = [
      prisma.adCampaign.update({
        where: { id },
        data: { clicks: { increment: 1 } },
      }),
    ];

    if (variantId) {
      txns.push(
        prisma.adVariant.update({
          where: { id: variantId },
          data: { clicks: { increment: 1 } },
        })
      );
    }

    await prisma.$transaction(txns);
    res.json({ ok: true });
  } catch (err: any) {
    console.error('[trackClick] error:', err);
    res.status(500).json({ error: 'Failed to track click' });
  }
}

// ─── Campaign analytics ─────────────────────────────────────────────────────

export async function getCampaignAnalytics(req: AuthRequest, res: Response): Promise<void> {
  try {
    const id = paramInt(req.params.id);
    const campaign = await prisma.adCampaign.findUnique({
      where: { id },
      include: { variants: true },
    });
    if (!campaign) { res.status(404).json({ error: 'Campaign not found' }); return; }
    if (campaign.user_id !== req.user!.userId) {
      res.status(403).json({ error: 'Not authorized' });
      return;
    }

    const ctr = campaign.impressions > 0 ? (campaign.clicks / campaign.impressions) * 100 : 0;
    const cpc = campaign.clicks > 0 ? campaign.spent / campaign.clicks : 0;
    const budgetUsed = campaign.total_budget ? (campaign.spent / campaign.total_budget) * 100 : 0;

    // Normalize campaign and variants
    const normalizedCampaign = normalizeAdCampaignResponse(campaign);

    res.json({
      campaign: normalizedCampaign,
      analytics: {
        impressions: campaign.impressions,
        clicks: campaign.clicks,
        ctr: parseFloat(ctr.toFixed(2)),
        cpc: parseFloat(cpc.toFixed(2)),
        spent: campaign.spent,
        total_budget: campaign.total_budget,
        budget_used_pct: parseFloat(budgetUsed.toFixed(1)),
        variants: campaign.variants.map((v) => ({
          id: v.id,
          label: v.label,
          creative_url: normalizeCreativeUrl(v.creative_url),
          impressions: v.impressions,
          clicks: v.clicks,
          ctr: v.impressions > 0 ? parseFloat(((v.clicks / v.impressions) * 100).toFixed(2)) : 0,
        })),
      },
    });
  } catch (err: any) {
    console.error('[getCampaignAnalytics] error:', err);
    res.status(500).json({ error: 'Failed to fetch analytics' });
  }
}

// ─── Get variants for a campaign ────────────────────────────────────────────

export async function getCampaignVariants(req: AuthRequest, res: Response): Promise<void> {
  try {
    const id = paramInt(req.params.id);
    const variants = await prisma.adVariant.findMany({
      where: { campaign_id: id },
      orderBy: { label: 'asc' },
    });

    // Normalize all creative_urls
    const normalized = variants.map((v) => ({
      ...v,
      creative_url: normalizeCreativeUrl(v.creative_url),
    }));

    res.json(normalized);
  } catch (err: any) {
    console.error('[getCampaignVariants] error:', err);
    res.status(500).json({ error: 'Failed to fetch variants' });
  }
}

// ─── Legacy: list old Ad model (DEPRECATED - use listAds) ────────────────────

export async function listLegacyAds(_req: Request, res: Response): Promise<void> {
  try {
    console.warn('[DEPRECATED] listLegacyAds() called. Use listAds() instead');
    const ads = await prisma.ad.findMany({
      where: { status: 'active' },
      orderBy: [{ priority: 'desc' }, { created_at: 'desc' }],
      include: { business: { select: { id: true, company_name: true, logo_url: true } } },
      take: 50,
    });
    res.json(ads);
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to list ads' });
  }
}
