/**
 * Tier-based feature access control.
 *
 * Tiers: free < growth < boost < scale
 * Role = access (customer, business)
 * Plan = billing (free, premium)
 * Tier = features (free, growth, boost, scale)
 */

export type Tier = 'free' | 'growth' | 'boost' | 'scale';

export type Feature =
  | 'basic_listing'
  | 'analytics'
  | 'basic_ads'
  | 'ads'
  | 'voucher'
  | 'priority_listing'
  | 'max_visibility';

export const TIER_FEATURES: Record<Tier, Feature[]> = {
  free: ['basic_listing'],
  growth: ['basic_listing', 'analytics', 'basic_ads'],
  boost: ['basic_listing', 'analytics', 'basic_ads', 'ads', 'voucher', 'priority_listing'],
  scale: ['basic_listing', 'analytics', 'basic_ads', 'ads', 'voucher', 'priority_listing', 'max_visibility'],
};

/** Ordered from lowest to highest for sorting */
export const TIER_RANK: Record<Tier, number> = {
  free: 0,
  growth: 1,
  boost: 2,
  scale: 3,
};

/** Visibility priority score per tier for listing sort order */
export const TIER_SCORE: Record<Tier, number> = {
  free: 10,
  growth: 40,
  boost: 70,
  scale: 100,
};

/**
 * Get the visibility_priority_score for a tier.
 */
export function tierToScore(tier: string | null | undefined): number {
  return TIER_SCORE[(tier || 'free') as Tier] ?? TIER_SCORE.free;
}

/**
 * Compute the effective tier: active promotions keep their tier, others fall back to 'free'.
 */
export function effectiveTier(tier: string | null | undefined, status: string | null | undefined): Tier {
  return status === 'active' ? ((tier || 'free') as Tier) : 'free';
}

/**
 * Check if a tier has access to a specific feature.
 */
export function hasFeature(tier: string | null | undefined, feature: Feature): boolean {
  const t = (tier || 'free') as Tier;
  const features = TIER_FEATURES[t] ?? TIER_FEATURES.free;
  return features.includes(feature);
}

/**
 * Map a pricing plan rank_label (GROWTH, BOOST, SCALE) to a tier string.
 */
export function rankLabelToTier(rankLabel: string | null | undefined): Tier {
  if (!rankLabel) return 'free';
  const label = rankLabel.toUpperCase();
  if (label === 'GROWTH') return 'growth';
  if (label === 'BOOST') return 'boost';
  if (label === 'SCALE' || label === 'DOMINATE') return 'scale';
  return 'free';
}
