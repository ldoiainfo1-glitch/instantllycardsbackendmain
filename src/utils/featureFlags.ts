/**
 * Feature Flags
 *
 * Set a flag to `true` to enable the feature, `false` to disable its API route.
 * Disabled features return 404.
 */
export const FEATURES = {
  /** Bulk Send — send a business card to a whole category/zone. Not ready for production. */
  BULK_SEND: false,
} as const;
