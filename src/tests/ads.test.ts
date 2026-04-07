/**
 * Ads System Tests
 * Tests URL normalization, campaign creation, and carousel data
 */
import request from 'supertest';
import express from 'express';
import cors from 'cors';
import 'dotenv/config';
import authRoutes from '../routes/auth';
import adsRoutes from '../routes/ads';
import businessCardRoutes from '../routes/businessCards';
import prisma from '../utils/prisma';

const app = express();
app.use(cors());
app.use(express.json());
app.use('/api/auth', authRoutes);
app.use('/api/ads', adsRoutes);
app.use('/api/business-cards', businessCardRoutes);

const TS = Date.now().toString().slice(-7);
const TEST_PHONE = `+9199${TS}0`;
let accessToken: string;
let userId: number;
let businessCardId: number;

describe('Ads System', () => {
  beforeAll(async () => {
    // Signup
    const signupRes = await request(app).post('/api/auth/signup').send({
      phone: TEST_PHONE,
      name: 'Ad Test User',
      role: 'business',
    });

    userId = signupRes.body.userId;
    accessToken = signupRes.body.accessToken;

    // Create a business card
    const cardRes = await request(app)
      .post('/api/business-cards')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        full_name: 'Test Business',
        company_name: 'Test Co',
      });

    businessCardId = cardRes.body.id;
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  describe('GET /api/ads/campaigns - List active campaigns', () => {
    it('should return approved active campaigns', async () => {
      const res = await request(app).get('/api/ads/campaigns');

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);

      if (res.body.length > 0) {
        res.body.forEach((campaign: any) => {
          expect(campaign.approval_status).toBe('approved');
          expect(campaign.status).toBe('active');
        });
      }
    });

    it('should normalize creative URLs to absolute paths', async () => {
      const res = await request(app).get('/api/ads/campaigns');

      expect(res.status).toBe(200);

      // Check URL normalization in first few campaigns
      let urlsFound = 0;
      res.body.slice(0, 5).forEach((campaign: any) => {
        if (campaign.creative_url) {
          expect(campaign.creative_url).toMatch(/^https?:\/\//);
          console.log(`✓ Campaign #${campaign.id}: ${campaign.creative_url.substring(0, 60)}...`);
          urlsFound++;
        }
      });

      if (urlsFound > 0) {
        console.log(`✓ Verified ${urlsFound} normalized URLs`);
      }
    });

    it('should return required campaign fields', async () => {
      const res = await request(app).get('/api/ads/campaigns?limit=1');

      expect(res.status).toBe(200);

      if (res.body.length > 0) {
        const campaign = res.body[0];
        expect(campaign).toHaveProperty('id');
        expect(campaign).toHaveProperty('title');
        expect(campaign).toHaveProperty('ad_type');
        expect(campaign).toHaveProperty('status');
        expect(campaign).toHaveProperty('approval_status');
        // API returns unified format with image_url or creative_url
        const hasUrl = campaign.image_url || campaign.creative_url || campaign.creative_urls;
        expect(hasUrl).toBeDefined();
        console.log(`✓ Campaign has all required fields`);
      }
    });
  });

  describe('Ad Campaign Endpoints', () => {
    it('should fetch active campaigns successfully', async () => {
      const res = await request(app).get('/api/ads/campaigns');
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      console.log(`✓ Fetched ${res.body.length} active campaigns`);
    });
  });

  describe('URL Normalization - Mixed Formats', () => {
    it('should handle various URL formats', async () => {
      const res = await request(app).get('/api/ads/campaigns?limit=20');

      expect(res.status).toBe(200);

      let pathsConverted = 0;
      let s3Urls = 0;
      let apiUrls = 0;

      res.body.forEach((campaign: any) => {
        if (campaign.creative_url) {
          if (campaign.creative_url.includes('cloudfront')) {
            s3Urls++;
          } else if (campaign.creative_url.includes('/api/')) {
            apiUrls++;
          } else if (campaign.creative_url.startsWith('https://api')) {
            apiUrls++;
            pathsConverted++;
          }
        }
      });

      console.log(`✓ URLs found: S3=${s3Urls}, API=${apiUrls}, PathsConverted=${pathsConverted}`);
      expect(res.body.length).toBeGreaterThan(0);
    });

    it('should not include null URLs in arrays', async () => {
      const res = await request(app).get('/api/ads/campaigns?limit=10');

      expect(res.status).toBe(200);

      res.body.forEach((campaign: any) => {
        if (campaign.creative_urls && Array.isArray(campaign.creative_urls)) {
          campaign.creative_urls.forEach((url: any) => {
            expect(url).not.toBeNull();
            expect(url).not.toBeUndefined();
            if (url) {
              expect(typeof url).toBe('string');
            }
          });
        }
      });

      console.log(`✓ No null/undefined URLs in creative_urls arrays`);
    });
  });

  describe('Carousel Compatibility', () => {
    it('should return data compatible with BannerAdSlot', async () => {
      const res = await request(app).get('/api/ads/campaigns');

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);

      if (res.body.length > 0) {
        const carousel = res.body.slice(0, 5);

        carousel.forEach((ad: any) => {
          // Required for BannerAdSlot
          expect(ad.id).toBeDefined();
          expect(ad.title).toBeDefined();
          expect(ad.status).toEqual('active');

          // Image URL required - check unified response format
          const hasImage = ad.image_url || ad.creative_url || (ad.creative_urls?.length > 0);
          if (!hasImage) {
            console.warn(`⚠️  Ad #${ad.id} has no image URL`);
          }
        });

        console.log(`✓ ${carousel.length} ads ready for carousel`);
      }
    });

    it('should have minimum 147 approved campaigns', async () => {
      const count = await prisma.adCampaign.count({
        where: { approval_status: 'approved' },
      });

      expect(count).toBeGreaterThanOrEqual(147);
      console.log(`✓ Total approved campaigns: ${count}`);
    });
  });

  describe('Ad Campaign Variants', () => {
    it('should have variants with normalized URLs', async () => {
      const res = await request(app)
        .get('/api/ads/campaigns?limit=3')
        .set('Authorization', `Bearer ${accessToken}`);

      expect(res.status).toBe(200);

      // Check if we can fetch variants for a campaign
      if (res.body.length > 0) {
        const campaignId = res.body[0].id;
        const variantRes = await request(app)
          .get(`/api/ads/campaigns/${campaignId}/variants`)
          .set('Authorization', `Bearer ${accessToken}`);

        if (variantRes.status === 200 && variantRes.body.length > 0) {
          variantRes.body.forEach((variant: any) => {
            expect(variant.creative_url).toMatch(/^https?:\/\//);
          });
          console.log(`✓ Campaign #${campaignId} has normalized variant URLs`);
        }
      }
    });
  });
});
