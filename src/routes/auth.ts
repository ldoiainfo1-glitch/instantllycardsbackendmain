import { Router, RequestHandler } from "express";
import { body } from "express-validator";
import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import { validate } from "../middleware/validate";
import { authenticate } from "../middleware/auth";
import {
  signup,
  login,
  refresh,
  logout,
  me,
  changePassword,
  sendPasswordResetOTP,
  verifyPasswordResetOTP,
  resetPassword,
  updateServiceType,
} from "../controllers/authController";

const router = Router();
const h = (fn: Function) => fn as RequestHandler;

// Rate limit keyed by phone/email (falls back to IP). This way 100 users
// behind the same office NAT are not throttled together — each account
// gets its own counter.
const loginKeyGen = (req: any): string => {
  const id = (req.body?.phone || req.body?.email || "")
    .toString()
    .trim()
    .toLowerCase();
  return id ? `acct:${id}` : `ip:${ipKeyGenerator(req)}`;
};

// Per-account login/signup limiter. Failed attempts count; successful ones
// are skipped so normal users never hit the limit.
const authRateLimit =
  process.env.NODE_ENV === "test"
    ? (_req: any, _res: any, next: any) => next()
    : rateLimit({
        windowMs: 15 * 60 * 1000,
        max: 20,
        message: { error: "Too many attempts, please try again later" },
        standardHeaders: true,
        legacyHeaders: false,
        skipSuccessfulRequests: true,
        keyGenerator: loginKeyGen,
      });

// IP-level safety net — only kicks in on abuse (e.g. bot trying many
// different accounts from one IP). Set high enough that a 100-person
// office doing legitimate logins is never affected.
// 100 users × 2 attempts each = 200, so 500 gives comfortable headroom.
const authIpSafetyNet =
  process.env.NODE_ENV === "test"
    ? (_req: any, _res: any, next: any) => next()
    : rateLimit({
        windowMs: 15 * 60 * 1000,
        max: 500,
        message: { error: "Too many attempts from this network" },
        standardHeaders: true,
        legacyHeaders: false,
        skipSuccessfulRequests: true,
      });

// Refresh limiter keyed by the refresh token itself (one counter per session,
// not per IP). A shared NAT with 100 active users is fine because each
// session has its own unique token.
const refreshRateLimit =
  process.env.NODE_ENV === "test"
    ? (_req: any, _res: any, next: any) => next()
    : rateLimit({
        windowMs: 15 * 60 * 1000,
        max: 60,
        message: { error: "Too many refresh attempts" },
        standardHeaders: true,
        legacyHeaders: false,
        skipSuccessfulRequests: true,
        keyGenerator: (req: any) => {
          const t = (
            req.body?.refreshToken ||
            req.headers["x-refresh-token"] ||
            ""
          ).toString();
          return t ? `rt:${t.slice(-32)}` : `ip:${ipKeyGenerator(req)}`;
        },
      });

router.post(
  "/signup",
  authIpSafetyNet,
  authRateLimit,
  [
    body("phone").notEmpty().withMessage("Phone is required"),
    body("password").isLength({ min: 6 }).withMessage("Password min 6 chars"),
    body("role")
      .optional()
      .isIn(["customer", "business"])
      .withMessage("Role must be customer or business"),
  ],
  validate,
  h(signup),
);

router.post(
  "/login",
  authIpSafetyNet,
  authRateLimit,
  [
    body().custom((_, { req }) => {
      if (!req.body.phone && !req.body.email)
        throw new Error("phone or email required");
      return true;
    }),
    body("password").notEmpty().withMessage("Password required"),
    body("loginType")
      .optional()
      .isIn(["customer", "business"])
      .withMessage("loginType must be customer or business"),
  ],
  validate,
  h(login),
);

router.post("/refresh", refreshRateLimit, h(refresh));
router.post("/logout", authenticate, h(logout));
router.get("/me", authenticate, h(me));
router.post(
  "/change-password",
  authenticate,
  [
    body("currentPassword").notEmpty().withMessage("Current password required"),
    body("newPassword")
      .isLength({ min: 6 })
      .withMessage("New password must be at least 6 characters"),
  ],
  validate,
  h(changePassword),
);

router.post(
  "/forgot-password/send-otp",
  authIpSafetyNet,
  authRateLimit,
  [body("phone").notEmpty().withMessage("Phone number is required")],
  validate,
  h(sendPasswordResetOTP),
);

router.post(
  "/forgot-password/verify-otp",
  authIpSafetyNet,
  authRateLimit,
  [
    body("phone").notEmpty().withMessage("Phone number is required"),
    body("otp").notEmpty().withMessage("OTP is required"),
  ],
  validate,
  h(verifyPasswordResetOTP),
);

router.post(
  "/forgot-password/reset-password",
  authIpSafetyNet,
  authRateLimit,
  [
    body("phone").notEmpty().withMessage("Phone number is required"),
    body("otp").notEmpty().withMessage("OTP is required"),
    body("newPassword")
      .isLength({ min: 6 })
      .withMessage("New password must be at least 6 characters"),
  ],
  validate,
  h(resetPassword),
);

router.post(
  "/update-service-type",
  authenticate,
  [body("serviceType").notEmpty().withMessage("serviceType is required")],
  validate,
  h(updateServiceType),
);

export default router;
