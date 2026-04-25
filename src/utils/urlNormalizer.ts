/**
 * URL Normalization Helper for Ad Creative URLs
 *
 * Handles three types of creative URLs:
 * 1. Full URLs: https://cdn.example.com/image.jpg
 * 2. S3/CloudFront: https://d1rjsfuv5lw0hw.cloudfront.net/...
 * 3. Local paths: /api/ads/image/{id}/bottom
 */

const API_BASE_URL =
  process.env.API_BASE_URL || "https://api.instantllycards.com";
const IS_PRODUCTION = process.env.NODE_ENV === "production";

/**
 * Check if URL is already absolute
 */
function isAbsoluteUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  return /^(https?:|\/\/)/.test(url);
}

/**
 * Normalize a single creative URL
 * Converts paths to full URLs, handles edge cases
 */
export function normalizeCreativeUrl(
  url: string | null | undefined,
): string | null {
  if (!url) return null;

  // Fix inconsistent LOCAL paths only: /ads/{id} → /api/ads/image/{id}
  // Do NOT touch absolute CloudFront/CDN/S3 URLs — they already have the right path
  if (
    !isAbsoluteUrl(url) &&
    url.includes("/ads/") &&
    !url.includes("/api/ads")
  ) {
    // Pattern: /ads/6908840e.../bottom → /api/ads/image/6908840e.../bottom
    url = url.replace(/\/ads\//, "/api/ads/image/");
  }

  // Already absolute URL
  if (isAbsoluteUrl(url)) {
    return url;
  }

  // Local path → convert to full URL
  if (url.startsWith("/")) {
    return `${API_BASE_URL}${url}`;
  }

  // Relative path (shouldn't happen, but handle it)
  return `${API_BASE_URL}/${url}`;
}

/**
 * Normalize creative_urls array (from migration, may have nulls)
 */
export function normalizeCreativeUrls(
  urls: (string | null | undefined)[] | null | undefined,
): string[] {
  if (!urls || urls.length === 0) return [];

  return urls
    .map((url) => normalizeCreativeUrl(url))
    .filter((url): url is string => url !== null);
}

/**
 * Normalize AdCampaign response before sending to frontend
 */
export function normalizeAdCampaignResponse(campaign: any): any {
  if (!campaign) return campaign;

  return {
    ...campaign,
    creative_url: normalizeCreativeUrl(campaign.creative_url),
    creative_urls: normalizeCreativeUrls(campaign.creative_urls),
    // Include normalized variant URLs if variants exist
    variants: campaign.variants?.map((v: any) => ({
      ...v,
      creative_url: normalizeCreativeUrl(v.creative_url),
    })),
  };
}

/**
 * Normalize array of campaigns
 */
export function normalizeAdCampaignsResponse(campaigns: any[]): any[] {
  if (!Array.isArray(campaigns)) return campaigns;
  return campaigns.map(normalizeAdCampaignResponse);
}

/**
 * Normalize legacy Ad response
 */
export function normalizeAdResponse(ad: any): any {
  if (!ad) return ad;

  return {
    ...ad,
    bottom_image: normalizeCreativeUrl(ad.bottom_image),
    fullscreen_image: normalizeCreativeUrl(ad.fullscreen_image),
    bottom_image_s3_url: normalizeCreativeUrl(ad.bottom_image_s3_url),
    fullscreen_image_s3_url: normalizeCreativeUrl(ad.fullscreen_image_s3_url),
    bottom_video: normalizeCreativeUrl(ad.bottom_video),
    fullscreen_video: normalizeCreativeUrl(ad.fullscreen_video),
    bottom_video_s3_url: normalizeCreativeUrl(ad.bottom_video_s3_url),
    fullscreen_video_s3_url: normalizeCreativeUrl(ad.fullscreen_video_s3_url),
  };
}
