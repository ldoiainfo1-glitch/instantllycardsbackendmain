import { Router, Request, Response } from 'express';

const router = Router();

/**
 * GET /api/system/version
 *
 * Returns app version requirements for force-update checks.
 * - currentVersion:  latest version available on the Play Store
 * - minVersion:      minimum version the app must be to continue working
 * - forceUpdate:     hard kill-switch — if true, ALL versions are blocked
 * - recommendedVersion: version where a soft nudge is shown
 * - updateUrl:       Play Store deep-link
 * - message:         optional message shown in the update dialog
 *
 * Configure via env vars. Defaults are safe (no forced update).
 */
router.get('/version', (_req: Request, res: Response) => {
  const currentVersion = process.env.APP_CURRENT_VERSION || '1.0.80';
  const minVersion = process.env.APP_MIN_VERSION || '1.0.0';
  const recommendedVersion = process.env.APP_RECOMMENDED_VERSION || currentVersion;
  const forceUpdate = process.env.APP_FORCE_UPDATE === 'true';
  const updateUrl =
    process.env.APP_UPDATE_URL ||
    'https://play.google.com/store/apps/details?id=com.instantllycards.www.twa';
  const message = process.env.APP_UPDATE_MESSAGE || '';

  res.json({
    currentVersion,
    minVersion,
    recommendedVersion,
    forceUpdate,
    updateUrl,
    message,
  });
});

export default router;
