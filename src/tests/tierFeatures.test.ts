import { hasFeature, rankLabelToTier, tierToScore, effectiveTier, TIER_FEATURES, TIER_RANK, TIER_SCORE, type Tier } from '../utils/tierFeatures';

describe('tierFeatures', () => {
  describe('TIER_FEATURES', () => {
    it('free tier has only basic_listing', () => {
      expect(TIER_FEATURES.free).toEqual(['basic_listing']);
    });

    it('growth tier includes analytics and basic_ads', () => {
      expect(TIER_FEATURES.growth).toContain('analytics');
      expect(TIER_FEATURES.growth).toContain('basic_ads');
    });

    it('boost tier includes ads and priority_listing', () => {
      expect(TIER_FEATURES.boost).toContain('ads');
      expect(TIER_FEATURES.boost).toContain('priority_listing');
    });

    it('scale tier includes max_visibility', () => {
      expect(TIER_FEATURES.scale).toContain('max_visibility');
    });

    it('higher tiers have at least as many features as lower ones', () => {
      const tiers: Tier[] = ['free', 'growth', 'boost', 'scale'];
      for (let i = 1; i < tiers.length; i++) {
        expect(TIER_FEATURES[tiers[i]].length).toBeGreaterThanOrEqual(
          TIER_FEATURES[tiers[i - 1]].length
        );
      }
    });
  });

  describe('TIER_RANK', () => {
    it('free < growth < boost < scale', () => {
      expect(TIER_RANK.free).toBeLessThan(TIER_RANK.growth);
      expect(TIER_RANK.growth).toBeLessThan(TIER_RANK.boost);
      expect(TIER_RANK.boost).toBeLessThan(TIER_RANK.scale);
    });
  });

  describe('hasFeature', () => {
    it('free tier has basic_listing', () => {
      expect(hasFeature('free', 'basic_listing')).toBe(true);
    });

    it('free tier does not have analytics', () => {
      expect(hasFeature('free', 'analytics')).toBe(false);
    });

    it('scale tier has all features', () => {
      expect(hasFeature('scale', 'basic_listing')).toBe(true);
      expect(hasFeature('scale', 'analytics')).toBe(true);
      expect(hasFeature('scale', 'ads')).toBe(true);
      expect(hasFeature('scale', 'priority_listing')).toBe(true);
      expect(hasFeature('scale', 'max_visibility')).toBe(true);
    });

    it('defaults to free tier for null/undefined', () => {
      expect(hasFeature(null, 'basic_listing')).toBe(true);
      expect(hasFeature(undefined, 'analytics')).toBe(false);
      expect(hasFeature('', 'analytics')).toBe(false);
    });
  });

  describe('rankLabelToTier', () => {
    it('maps GROWTH to growth', () => {
      expect(rankLabelToTier('GROWTH')).toBe('growth');
    });

    it('maps BOOST to boost', () => {
      expect(rankLabelToTier('BOOST')).toBe('boost');
    });

    it('maps SCALE to scale', () => {
      expect(rankLabelToTier('SCALE')).toBe('scale');
    });

    it('maps DOMINATE to scale', () => {
      expect(rankLabelToTier('DOMINATE')).toBe('scale');
    });

    it('is case-insensitive', () => {
      expect(rankLabelToTier('growth')).toBe('growth');
      expect(rankLabelToTier('Boost')).toBe('boost');
    });

    it('returns free for null/undefined/unknown', () => {
      expect(rankLabelToTier(null)).toBe('free');
      expect(rankLabelToTier(undefined)).toBe('free');
      expect(rankLabelToTier('UNKNOWN')).toBe('free');
    });
  });

  describe('TIER_SCORE', () => {
    it('free=10, growth=40, boost=70, scale=100', () => {
      expect(TIER_SCORE.free).toBe(10);
      expect(TIER_SCORE.growth).toBe(40);
      expect(TIER_SCORE.boost).toBe(70);
      expect(TIER_SCORE.scale).toBe(100);
    });

    it('scores increase with tier rank', () => {
      const tiers: Tier[] = ['free', 'growth', 'boost', 'scale'];
      for (let i = 1; i < tiers.length; i++) {
        expect(TIER_SCORE[tiers[i]]).toBeGreaterThan(TIER_SCORE[tiers[i - 1]]);
      }
    });
  });

  describe('tierToScore', () => {
    it('maps each tier to its score', () => {
      expect(tierToScore('free')).toBe(10);
      expect(tierToScore('growth')).toBe(40);
      expect(tierToScore('boost')).toBe(70);
      expect(tierToScore('scale')).toBe(100);
    });

    it('defaults to free (10) for null/undefined/empty', () => {
      expect(tierToScore(null)).toBe(10);
      expect(tierToScore(undefined)).toBe(10);
      expect(tierToScore('')).toBe(10);
    });
  });

  describe('effectiveTier', () => {
    it('returns the tier when status is active', () => {
      expect(effectiveTier('growth', 'active')).toBe('growth');
      expect(effectiveTier('boost', 'active')).toBe('boost');
      expect(effectiveTier('scale', 'active')).toBe('scale');
    });

    it('returns free when status is expired', () => {
      expect(effectiveTier('scale', 'expired')).toBe('free');
      expect(effectiveTier('boost', 'expired')).toBe('free');
    });

    it('returns free when status is pending', () => {
      expect(effectiveTier('growth', 'pending')).toBe('free');
    });

    it('returns free for null/undefined status', () => {
      expect(effectiveTier('scale', null)).toBe('free');
      expect(effectiveTier('boost', undefined)).toBe('free');
    });

    it('returns free when tier is null/undefined and active', () => {
      expect(effectiveTier(null, 'active')).toBe('free');
      expect(effectiveTier(undefined, 'active')).toBe('free');
    });
  });

  describe('tier → feature access matrix', () => {
    it('free cannot access analytics', () => {
      expect(hasFeature('free', 'analytics')).toBe(false);
    });

    it('free cannot access ads', () => {
      expect(hasFeature('free', 'ads')).toBe(false);
    });

    it('growth can access analytics', () => {
      expect(hasFeature('growth', 'analytics')).toBe(true);
    });

    it('growth cannot create ads (boost+ only)', () => {
      expect(hasFeature('growth', 'ads')).toBe(false);
    });

    it('boost can access ads', () => {
      expect(hasFeature('boost', 'ads')).toBe(true);
    });

    it('scale gets highest priority (max_visibility)', () => {
      expect(hasFeature('scale', 'max_visibility')).toBe(true);
    });

    it('boost does not have max_visibility', () => {
      expect(hasFeature('boost', 'max_visibility')).toBe(false);
    });

    it('expired promotion downgrades to free features', () => {
      const tier = effectiveTier('scale', 'expired');
      expect(tier).toBe('free');
      expect(hasFeature(tier, 'analytics')).toBe(false);
      expect(hasFeature(tier, 'ads')).toBe(false);
      expect(hasFeature(tier, 'max_visibility')).toBe(false);
      expect(hasFeature(tier, 'basic_listing')).toBe(true);
    });
  });
});
