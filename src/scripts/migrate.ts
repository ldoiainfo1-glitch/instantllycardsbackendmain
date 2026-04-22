import "dotenv/config";
import { MongoClient, ObjectId } from "mongodb";
import { Prisma, PrismaClient, Role, AdType, MessageType } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { existsSync, mkdirSync, writeFileSync } from "fs";
import { join } from "path";

type AnyDoc = Record<string, any>;

type MigrationOptions = {
  dryRun: boolean;
  force: boolean;
  limit?: number;
  only: Set<string>;
  skip: Set<string>;
};

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("DATABASE_URL is required for PrismaClient.");
}
const adapter = new PrismaPg({ connectionString: databaseUrl });
const prisma = new PrismaClient({ adapter });

const log = {
  info: (msg: string) => console.log(`[INFO] ${msg}`),
  warn: (msg: string) => console.warn(`[WARN] ${msg}`),
  error: (msg: string) => console.error(`[ERROR] ${msg}`),
};

const auditDir = join(process.cwd(), "migration_logs");
const ensureAuditDir = () => {
  if (!existsSync(auditDir)) {
    mkdirSync(auditDir, { recursive: true });
  }
};

const auditLog = (name: string, payload: AnyDoc) => {
  ensureAuditDir();
  const file = join(auditDir, `${name}.jsonl`);
  const line = JSON.stringify(payload);
  writeFileSync(file, `${line}\n`, { encoding: "utf8", flag: "a" });
};

const parseArgs = (): MigrationOptions => {
  const args: string[] = process.argv.slice(2);
  const getArg = (key: string) => {
    const idx = args.findIndex((a: string) => a === key || a.startsWith(`${key}=`));
    if (idx === -1) return undefined;
    const val = args[idx].includes("=") ? args[idx].split("=").slice(1).join("=") : args[idx + 1];
    return val;
  };

  const listArg = (key: string) => {
    const val = getArg(key);
    if (!val) return new Set<string>();
    const items = val
      .split(",")
      .map((v: string) => v.trim())
      .filter((v): v is string => v.length > 0);
    return new Set<string>(items);
  };

  const dryRun = args.includes("--dry-run") || process.env.MIGRATION_DRY_RUN === "1";
  const force = args.includes("--force") || process.env.MIGRATION_FORCE === "1";
  const limitRaw = getArg("--limit");
  const limit = limitRaw ? Number(limitRaw) : undefined;
  const only = listArg("--only");
  const skip = listArg("--skip");

  return { dryRun, force, limit, only, skip };
};

const logEvery = (() => {
  const raw = process.env.MIGRATION_LOG_EVERY;
  const parsed = raw ? Number(raw) : 500;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 500;
})();

const shouldRun = (name: string, options: MigrationOptions) => {
  if (options.only.size > 0 && !options.only.has(name)) return false;
  if (options.skip.size > 0 && options.skip.has(name)) return false;
  return true;
};

const idToString = (value: any): string | null => {
  if (!value) return null;
  if (typeof value === "string") return value;
  if (value instanceof ObjectId) return value.toHexString();
  if (value?.$oid) return String(value.$oid);
  try {
    return String(value);
  } catch {
    return null;
  }
};

const toDate = (value: any): Date | undefined => {
  if (!value) return undefined;
  if (value instanceof Date) return value;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return undefined;
  return d;
};

const toNumber = (value: any, fallback?: number): number | undefined => {
  if (value === null || value === undefined || value === "") return fallback;
  const n = Number(value);
  return Number.isNaN(n) ? fallback : n;
};

const toBigInt = (value: any, fallback: bigint = 0n): bigint => {
  if (value === null || value === undefined || value === "") return fallback;
  try {
    if (typeof value === "bigint") return value;
    if (typeof value === "number") return BigInt(Math.trunc(value));
    if (typeof value === "string") return BigInt(value);
    return fallback;
  } catch {
    return fallback;
  }
};

const toBoolean = (value: any, fallback = false): boolean => {
  if (typeof value === "boolean") return value;
  if (value === "true") return true;
  if (value === "false") return false;
  if (value === 1) return true;
  if (value === 0) return false;
  return fallback;
};

const sanitizeString = (value: any): string | undefined => {
  if (value === null || value === undefined) return undefined;
  const str = String(value);
  if (!str) return undefined;
  return str.replace(/\u0000/g, "");
};

const normalizePhone = (value: any): string | null => {
  if (!value) return null;
  const raw = String(value).trim();
  if (!raw) return null;
  const digits = raw.replace(/[^\d+]/g, "");
  return digits.length >= 10 ? digits : raw;
};

const normalizeEmail = (value: any): string | null => {
  if (!value) return null;
  const email = String(value).trim();
  return email || null;
};

const pickCollection = (collections: Set<string>, names: string[]): string | null => {
  for (const name of names) {
    if (collections.has(name)) return name;
  }
  return null;
};

const mapByLegacyId = new Map<string, number>();
const userIdMap = new Map<string, number>();
const cardIdMap = new Map<string, number>();
const categoryIdMap = new Map<string, number>();
const voucherIdMap = new Map<string, number>();
const chatIdMap = new Map<string, number>();
const messageIdMap = new Map<string, number>();
const groupIdMap = new Map<string, number>();
const groupSessionIdMap = new Map<string, number>();
const promotionIdMap = new Map<string, number>();
const promotionCardIdMap = new Map<string, number>();
const adIdMap = new Map<string, number>();
const designRequestIdMap = new Map<string, number>();

const getMappedId = (map: Map<string, number>, legacyId?: string | null) => {
  if (!legacyId) return undefined;
  return map.get(legacyId);
};

let systemUserId: number | null = null;
const SYSTEM_USER_LEGACY_ID = "system-placeholder-user";
const SYSTEM_USER_PHONE_BASE = "+910000000000";
const SYSTEM_USER_NAME = "Instantlly Official";
const PROMO_CARD_PREFIX = "promo:";

const ensureSystemUser = async (options: MigrationOptions) => {
  if (options.dryRun) return -1;
  if (systemUserId) return systemUserId;

  const existing = await prisma.user.findFirst({
    where: { legacy_id: SYSTEM_USER_LEGACY_ID },
  });
  if (existing) {
    systemUserId = existing.id;
    return existing.id;
  }

  for (let i = 0; i < 5; i += 1) {
    const phone = i === 0 ? SYSTEM_USER_PHONE_BASE : `${SYSTEM_USER_PHONE_BASE.slice(0, -1)}${i}`;
    try {
      const created = await prisma.user.create({
        data: {
          legacy_id: SYSTEM_USER_LEGACY_ID,
          name: SYSTEM_USER_NAME,
          phone,
          email: "official@instantlly.local",
          about: "Auto-created official user for demo/seeded listings.",
          credits: 0n,
          voucher_balance: 0n,
          needs_email: true,
        },
      });
      systemUserId = created.id;
      return created.id;
    } catch (err: any) {
      if (i === 4) throw err;
    }
  }

  throw new Error("Unable to create system placeholder user.");
};

const ensureEmptyDatabase = async (options: MigrationOptions) => {
  if (options.dryRun) return;
  if (options.force) return;
  const userCount = await prisma.user.count();
  if (userCount > 0) {
    throw new Error("Postgres is not empty. Use --force or set MIGRATION_FORCE=1 to proceed.");
  }
};

const preloadUserMapFromPostgres = async () => {
  const existing = await prisma.user.findMany({
    where: { legacy_id: { not: null } },
    select: { id: true, legacy_id: true },
  });
  for (const row of existing) {
    if (row.legacy_id) userIdMap.set(row.legacy_id, row.id);
  }
  if (existing.length > 0) {
    log.info(`Preloaded ${existing.length} users from Postgres for mapping.`);
  } else {
    log.warn("No users found in Postgres for mapping.");
  }
};

const preloadUserMapFromMongoForDryRun = async (db: any, collections: Set<string>) => {
  const name = pickCollection(collections, ["users", "user"]);
  if (!name) return;
  const col = db.collection(name);
  const cursor = col.find({}, { projection: { _id: 1 } });
  let idx = 0;
  for await (const doc of cursor) {
    const legacyId = idToString(doc._id);
    if (!legacyId) continue;
    idx += 1;
    userIdMap.set(legacyId, -idx);
  }
  if (idx > 0) {
    log.info(`Preloaded ${idx} users from Mongo for dry-run mapping.`);
  }
};

const preloadCardMapFromPostgres = async () => {
  const existing = await prisma.businessCard.findMany({
    where: { legacy_id: { not: null } },
    select: { id: true, legacy_id: true },
  });
  for (const row of existing) {
    if (row.legacy_id) cardIdMap.set(row.legacy_id, row.id);
  }
  if (existing.length > 0) {
    log.info(`Preloaded ${existing.length} business cards from Postgres for mapping.`);
  }
};

const preloadVoucherMapFromPostgres = async () => {
  const existing = await prisma.voucher.findMany({
    where: { legacy_id: { not: null } },
    select: { id: true, legacy_id: true },
  });
  for (const row of existing) {
    if (row.legacy_id) voucherIdMap.set(row.legacy_id, row.id);
  }
  if (existing.length > 0) {
    log.info(`Preloaded ${existing.length} vouchers from Postgres for mapping.`);
  }
};

const preloadVoucherMapFromMongoForDryRun = async (db: any, collections: Set<string>) => {
  const name = pickCollection(collections, ["vouchers", "voucher"]);
  if (!name) return;
  const col = db.collection(name);
  const cursor = col.find({}, { projection: { _id: 1 } });
  let idx = 0;
  for await (const doc of cursor) {
    const legacyId = idToString(doc._id);
    if (!legacyId) continue;
    idx += 1;
    voucherIdMap.set(legacyId, -idx);
  }
  if (idx > 0) {
    log.info(`Preloaded ${idx} vouchers from Mongo for dry-run mapping.`);
  }
};

const preloadGroupMapFromPostgres = async () => {
  const existing = await prisma.group.findMany({
    where: { legacy_id: { not: null } },
    select: { id: true, legacy_id: true },
  });
  for (const row of existing) {
    if (row.legacy_id) groupIdMap.set(row.legacy_id, row.id);
  }
  if (existing.length > 0) {
    log.info(`Preloaded ${existing.length} groups from Postgres for mapping.`);
  }
};

const preloadGroupMapFromMongoForDryRun = async (db: any, collections: Set<string>) => {
  const name = pickCollection(collections, ["groups", "group"]);
  if (!name) return;
  const col = db.collection(name);
  const cursor = col.find({}, { projection: { _id: 1 } });
  let idx = 0;
  for await (const doc of cursor) {
    const legacyId = idToString(doc._id);
    if (!legacyId) continue;
    idx += 1;
    groupIdMap.set(legacyId, -idx);
  }
  if (idx > 0) {
    log.info(`Preloaded ${idx} groups from Mongo for dry-run mapping.`);
  }
};

const preloadGroupSessionMapFromPostgres = async () => {
  const existing = await prisma.groupSession.findMany({
    where: { legacy_id: { not: null } },
    select: { id: true, legacy_id: true },
  });
  for (const row of existing) {
    if (row.legacy_id) groupSessionIdMap.set(row.legacy_id, row.id);
  }
  if (existing.length > 0) {
    log.info(`Preloaded ${existing.length} group sessions from Postgres for mapping.`);
  }
};

const preloadGroupSessionMapFromMongoForDryRun = async (db: any, collections: Set<string>) => {
  const name = pickCollection(collections, ["groupsessions", "groupSession", "group_sessions"]);
  if (!name) return;
  const col = db.collection(name);
  const cursor = col.find({}, { projection: { _id: 1 } });
  let idx = 0;
  for await (const doc of cursor) {
    const legacyId = idToString(doc._id);
    if (!legacyId) continue;
    idx += 1;
    groupSessionIdMap.set(legacyId, -idx);
  }
  if (idx > 0) {
    log.info(`Preloaded ${idx} group sessions from Mongo for dry-run mapping.`);
  }
};

const preloadPromotionCardMapFromPostgres = async () => {
  const existing = await prisma.businessPromotion.findMany({
    where: { legacy_id: { not: null }, business_card_id: { not: null } },
    select: { legacy_id: true, business_card_id: true },
  });
  for (const row of existing) {
    if (row.legacy_id && row.business_card_id) {
      promotionCardIdMap.set(row.legacy_id, row.business_card_id);
    }
  }
  if (existing.length > 0) {
    log.info(`Preloaded ${existing.length} business promotions for review mapping.`);
  }
};

const preloadPromotionCardMapFromMongoForDryRun = async (db: any, collections: Set<string>) => {
  const name = pickCollection(collections, ["businesspromotions", "businesspromotion"]);
  if (!name) return;
  const col = db.collection(name);
  const cursor = col.find({}, { projection: { _id: 1, businessCardId: 1 } });
  let idx = 0;
  for await (const doc of cursor) {
    const promoLegacyId = idToString(doc._id);
    const cardLegacyId = idToString(doc.businessCardId);
    const cardId = getMappedId(cardIdMap, cardLegacyId);
    if (promoLegacyId && cardId) {
      promotionCardIdMap.set(promoLegacyId, cardId);
      idx += 1;
    }
  }
  if (idx > 0) {
    log.info(`Preloaded ${idx} business promotions from Mongo for dry-run mapping.`);
  }
};

let promoDryRunCounter = -100000;
const ensurePromotionCardFromDoc = async (doc: AnyDoc, options: MigrationOptions) => {
  const promotionLegacyId = idToString(doc._id);
  if (!promotionLegacyId) return undefined;
  const cached = promotionCardIdMap.get(promotionLegacyId);
  if (cached) return cached;

  const mappedBusinessCardId = getMappedId(cardIdMap, idToString(doc.businessCardId));
  if (mappedBusinessCardId) {
    promotionCardIdMap.set(promotionLegacyId, mappedBusinessCardId);
    return mappedBusinessCardId;
  }

  if (options.dryRun) {
    promoDryRunCounter -= 1;
    promotionCardIdMap.set(promotionLegacyId, promoDryRunCounter);
    return promoDryRunCounter;
  }

  const legacyId = `${PROMO_CARD_PREFIX}${promotionLegacyId}`;
  const existing = await prisma.businessCard.findUnique({ where: { legacy_id: legacyId } });
  if (existing) {
    promotionCardIdMap.set(promotionLegacyId, existing.id);
    return existing.id;
  }

  let userId = getMappedId(userIdMap, idToString(doc.userId));
  if (!userId) {
    userId = await ensureSystemUser(options);
  }

  const created = await prisma.businessCard.create({
    data: {
      legacy_id: legacyId,
      user_id: userId,
      full_name: doc.ownerName || doc.owner || doc.businessName || "Promotion",
      company_name: doc.businessName || undefined,
      description: doc.description || undefined,
      phone: doc.phone || undefined,
      whatsapp: doc.whatsapp || undefined,
      email: doc.email || undefined,
      website: doc.website || undefined,
      location: doc.area || doc.city || undefined,
      company_address: [doc.plotNo, doc.buildingName, doc.streetName, doc.landmark, doc.city, doc.state, doc.pincode]
        .filter(Boolean)
        .join(", ") || undefined,
      business_hours: doc.businessHours ? JSON.stringify(doc.businessHours) : undefined,
      is_default: false,
    },
  });

  promotionCardIdMap.set(promotionLegacyId, created.id);
  return created.id;
};

let groupSessionDryRunCounter = -200000;
const ensureGroupSessionFromDoc = async (
  doc: AnyDoc,
  options: MigrationOptions,
  legacyIdOverride?: string | null
) => {
  const legacyId = legacyIdOverride ?? idToString(doc._id);
  if (!legacyId) return undefined;
  const cached = groupSessionIdMap.get(legacyId);
  if (cached) return cached;

  if (options.dryRun) {
    groupSessionDryRunCounter -= 1;
    groupSessionIdMap.set(legacyId, groupSessionDryRunCounter);
    return groupSessionDryRunCounter;
  }

  const existing = await prisma.groupSession.findUnique({ where: { legacy_id: legacyId } });
  if (existing) {
    groupSessionIdMap.set(legacyId, existing.id);
    return existing.id;
  }

  const code = sanitizeString(doc.code) || `legacy-${legacyId}`;
  const adminId =
    sanitizeString(doc.adminId || doc.admin_id || doc.admin || doc.fromUserId || doc.senderId) || "unknown";
  const adminName =
    sanitizeString(doc.adminName || doc.admin_name || doc.adminUserName || doc.senderName) || "Unknown";
  const adminPhone =
    sanitizeString(doc.adminPhone || doc.admin_phone || doc.senderPhone) || "NA";
  const createdAt = toDate(doc.createdAt) ?? new Date();
  const expiresAt = toDate(doc.expiresAt) ?? new Date(createdAt.getTime() + 24 * 60 * 60 * 1000);

  const created = await prisma.groupSession.create({
    data: {
      legacy_id: legacyId,
      code,
      admin_id: adminId,
      admin_name: adminName,
      admin_phone: adminPhone,
      admin_photo: doc.adminPhoto || undefined,
      status: doc.status || "waiting",
      allow_participant_sharing: toBoolean(doc.allowParticipantSharing, false),
      created_at: createdAt,
      expires_at: expiresAt,
      is_active: toBoolean(doc.isActive, true),
    },
  });

  groupSessionIdMap.set(legacyId, created.id);
  return created.id;
};

const migrateUsers = async (db: any, collections: Set<string>, options: MigrationOptions) => {
  if (!shouldRun("users", options)) return;
  const name = pickCollection(collections, ["users", "user"]);
  if (!name) {
    log.warn("users collection not found. Skipping users migration.");
    return;
  }
  const col = db.collection(name);
  const cursor = col.find({});
  let count = 0;
  let skippedExisting = 0;
  const deferredRefs: Array<{ legacyId: string; referredBy?: string | null; parentId?: string | null }> = [];

  for await (const doc of cursor) {
    if (options.limit && count >= options.limit) break;
    const legacyId = idToString(doc._id);
    const phone = normalizePhone(doc.phone || doc.phoneNumber || doc.mobileNumber || doc.phone_number);
    if (!phone) {
      log.warn(`User ${legacyId} missing phone. Skipping.`);
      continue;
    }
    const email = normalizeEmail(doc.email || doc.emailId || doc.email_id);
    const data = {
      legacy_id: legacyId ?? undefined,
      email: email ?? undefined,
      phone,
      password_hash: doc.password || doc.passwordHash || doc.hash || doc.password_hash || undefined,
      name: doc.name || doc.fullName || doc.full_name || undefined,
      profile_picture: doc.profilePicture || doc.avatar || undefined,
      about: doc.about || undefined,
      gender: doc.gender || undefined,
      birthdate: toDate(doc.birthdate),
      anniversary: toDate(doc.anniversary),
      push_token: doc.pushToken || doc.push_token || undefined,
      platform: doc.platform || undefined,
      push_token_updated_at: toDate(doc.pushTokenUpdatedAt),
      credits: toBigInt(doc.credits, 0n),
      credits_expiry_date: toDate(doc.creditsExpiryDate),
      referral_code: doc.referralCode || undefined,
      service_type: doc.serviceType || undefined,
      quiz_progress: doc.quizProgress || undefined,
      level: toNumber(doc.level, 0),
      direct_count: toNumber(doc.directCount, 0),
      downline_count: toNumber(doc.downlineCount, 0),
      special_credits: doc.specialCredits || undefined,
      is_voucher_admin: toBoolean(doc.isVoucherAdmin, false),
      voucher_balance: toBigInt(doc.voucherBalance, 0n),
      voucher_balances: doc.voucherBalances || undefined,
      ancestors: Array.isArray(doc.ancestors) ? doc.ancestors.map(idToString).filter(Boolean) : undefined,
      needs_email: !email,
      created_at: toDate(doc.createdAt),
      updated_at: toDate(doc.updatedAt),
    } as const;

    if (!options.dryRun && legacyId) {
      const existing = await prisma.user.findUnique({ where: { legacy_id: legacyId } });
      if (existing) {
        userIdMap.set(legacyId, existing.id);
        skippedExisting += 1;
        continue;
      }
    }

    if (options.dryRun) {
      if (legacyId) userIdMap.set(legacyId, -(count + 1));
      count += 1;
      continue;
    }

    try {
      const created = await prisma.user.create({ data });
      if (legacyId) userIdMap.set(legacyId, created.id);
      count += 1;
      deferredRefs.push({
        legacyId: legacyId ?? String(created.id),
        referredBy: idToString(doc.referredBy),
        parentId: idToString(doc.parentId),
      });
    } catch (err: any) {
      log.warn(`User insert failed (${legacyId}): ${err?.message ?? err}`);
    }
  }

  if (!options.dryRun && deferredRefs.length > 0) {
    for (const ref of deferredRefs) {
      const userId = getMappedId(userIdMap, ref.legacyId);
      if (!userId) continue;
      const referredById = getMappedId(userIdMap, ref.referredBy);
      const parentId = getMappedId(userIdMap, ref.parentId);
      if (!referredById && !parentId) continue;
      try {
        await prisma.user.update({
          where: { id: userId },
          data: {
            referred_by_id: referredById ?? undefined,
            parent_id: parentId ?? undefined,
          },
        });
      } catch (err: any) {
        log.warn(`User relation update failed (${ref.legacyId}): ${err?.message ?? err}`);
      }
    }
  }

  log.info(`Users migrated: ${count} (skipped existing: ${skippedExisting})`);
};

const migrateProfiles = async (db: any, collections: Set<string>, options: MigrationOptions) => {
  if (!shouldRun("profiles", options)) return;
  const name = pickCollection(collections, ["users", "user"]);
  if (!name) return;
  const col = db.collection(name);
  const cursor = col.find({});
  let count = 0;

  for await (const doc of cursor) {
    if (options.limit && count >= options.limit) break;
    const legacyId = idToString(doc._id);
    const userId = getMappedId(userIdMap, legacyId);
    if (!userId) continue;

    const data = {
      legacy_id: legacyId ?? undefined,
      user_id: userId,
      full_name: doc.name || doc.fullName || undefined,
      phone: normalizePhone(doc.phone || doc.phoneNumber || doc.mobileNumber) ?? undefined,
      avatar_url: doc.profilePicture || undefined,
      location: doc.location || undefined,
      bio: doc.about || undefined,
    };

    const hasAny =
      data.full_name || data.phone || data.avatar_url || data.location || data.bio;
    if (!hasAny) continue;

    if (options.dryRun) {
      count += 1;
      continue;
    }

    try {
      await prisma.profile.create({ data });
      count += 1;
    } catch (err: any) {
      log.warn(`Profile insert failed (${legacyId}): ${err?.message ?? err}`);
    }
  }

  log.info(`Profiles migrated: ${count}`);
};

const migrateUserRoles = async (db: any, collections: Set<string>, options: MigrationOptions) => {
  if (!shouldRun("user_roles", options)) return;
  const name = pickCollection(collections, ["users", "user"]);
  if (!name) return;
  const col = db.collection(name);
  const cursor = col.find({});
  let count = 0;

  for await (const doc of cursor) {
    if (options.limit && count >= options.limit) break;
    const legacyId = idToString(doc._id);
    const userId = getMappedId(userIdMap, legacyId);
    if (!userId) continue;

    const roleValue = String(doc.role || doc.userType || doc.accountType || "").toLowerCase();
    let role: Role = Role.customer;
    if (roleValue.includes("admin") || toBoolean(doc.isVoucherAdmin, false)) role = Role.admin;
    if (roleValue.includes("business")) role = Role.business;

    if (options.dryRun) {
      count += 1;
      continue;
    }

    try {
      await prisma.userRole.create({
        data: { user_id: userId, role },
      });
      count += 1;
    } catch (err: any) {
      log.warn(`UserRole insert failed (${legacyId}): ${err?.message ?? err}`);
    }
  }

  log.info(`UserRoles migrated: ${count}`);
};

const migrateCategories = async (db: any, collections: Set<string>, options: MigrationOptions) => {
  if (!shouldRun("categories", options)) return;
  const name = pickCollection(collections, ["categories", "category"]);
  if (!name) {
    log.warn("categories collection not found. Skipping categories migration.");
    return;
  }
  const col = db.collection(name);
  const docs = await col.find({}).toArray();
  let count = 0;
  const pendingParents: Array<{ legacyId: string; parentLegacyId?: string | null }> = [];

  for (const doc of docs) {
    if (options.limit && count >= options.limit) break;
    const legacyId = idToString(doc._id);
    const data = {
      legacy_id: legacyId ?? undefined,
      name: doc.name,
      icon: doc.icon || undefined,
      level: toNumber(doc.level, 0),
      subcategories: Array.isArray(doc.subcategories) ? doc.subcategories : [],
      is_active: toBoolean(doc.isActive, true),
      sort_order: toNumber(doc.order, 0),
      created_at: toDate(doc.createdAt),
      updated_at: toDate(doc.updatedAt),
    } as const;

    if (!data.name) {
      log.warn(`Category missing name (${legacyId}). Skipping.`);
      continue;
    }

    if (!options.dryRun && legacyId) {
      const existing = await prisma.category.findUnique({ where: { legacy_id: legacyId } });
      if (existing) {
        categoryIdMap.set(legacyId, existing.id);
        continue;
      }
    }

    if (options.dryRun) {
      count += 1;
      continue;
    }

    try {
      const created = await prisma.category.create({ data });
      if (legacyId) categoryIdMap.set(legacyId, created.id);
      count += 1;
      pendingParents.push({
        legacyId: legacyId ?? String(created.id),
        parentLegacyId: idToString(doc.parent_id),
      });
    } catch (err: any) {
      log.warn(`Category insert failed (${legacyId}): ${err?.message ?? err}`);
    }
  }

  if (!options.dryRun && pendingParents.length > 0) {
    for (const pending of pendingParents) {
      const categoryId = getMappedId(categoryIdMap, pending.legacyId);
      const parentId = getMappedId(categoryIdMap, pending.parentLegacyId);
      if (!categoryId || !parentId) continue;
      try {
        await prisma.category.update({
          where: { id: categoryId },
          data: { parent_id: parentId },
        });
      } catch (err: any) {
        log.warn(`Category parent update failed (${pending.legacyId}): ${err?.message ?? err}`);
      }
    }
  }

  log.info(`Categories migrated: ${count}`);
};

const migrateCards = async (db: any, collections: Set<string>, options: MigrationOptions) => {
  if (!shouldRun("cards", options)) return;
  const name = pickCollection(collections, ["cards", "card"]);
  if (!name) {
    log.warn("cards collection not found. Skipping cards migration.");
    return;
  }
  const col = db.collection(name);
  const cursor = col.find({});
  let count = 0;

  for await (const doc of cursor) {
    if (options.limit && count >= options.limit) break;
    const legacyId = idToString(doc._id);
    let userId = getMappedId(userIdMap, idToString(doc.userId));
    if (!userId) {
      userId = await ensureSystemUser(options);
      auditLog("card_missing_user", {
        card_id: legacyId,
        missing_user_id: idToString(doc.userId),
        fallback_user_id: userId,
      });
      log.warn(`Card ${legacyId} missing user reference. Using system user.`);
    }

    if (!options.dryRun && legacyId) {
      const existing = await prisma.businessCard.findUnique({ where: { legacy_id: legacyId } });
      if (existing) {
        cardIdMap.set(legacyId, existing.id);
        continue;
      }
    }

    const data = {
      legacy_id: legacyId ?? undefined,
      user_id: userId,
      full_name: doc.name || "Unknown",
      gender: doc.gender || undefined,
      birthdate: toDate(doc.birthdate),
      anniversary: toDate(doc.anniversary),
      personal_country_code: doc.personalCountryCode || undefined,
      personal_phone: doc.personalPhone || undefined,
      phone: doc.phone || undefined,
      email: doc.email || undefined,
      company_name: doc.companyName || undefined,
      job_title: doc.designation || undefined,
      logo_url: doc.logoUrl || undefined,
      description: doc.description || undefined,
      category: doc.category || undefined,
      services: Array.isArray(doc.services) ? doc.services : [],
      services_offered: doc.servicesOffered || undefined,
      instagram: doc.instagram || undefined,
      facebook: doc.facebook || undefined,
      linkedin: doc.linkedin || undefined,
      youtube: doc.youtube || undefined,
      twitter: doc.twitter || undefined,
      whatsapp: doc.whatsapp || undefined,
      telegram: doc.telegram || undefined,
      website: doc.website || undefined,
      business_hours: doc.businessHours || undefined,
      location: doc.location || undefined,
      maps_link: doc.mapsLink || undefined,
      company_country_code: doc.companyCountryCode || undefined,
      company_phone: doc.companyPhone || undefined,
      company_email: doc.companyEmail || undefined,
      company_website: doc.companyWebsite || undefined,
      company_address: doc.companyAddress || undefined,
      company_maps_link: doc.companyMapsLink || undefined,
      message: doc.message || undefined,
      company_photo: doc.companyPhoto || undefined,
      about_business: doc.aboutBusiness || undefined,
      offer: doc.offer || undefined,
      keywords: doc.keywords || undefined,
      established_year: doc.establishedYear || undefined,
      is_default: toBoolean(doc.isDefault, false),
      created_at: toDate(doc.createdAt),
      updated_at: toDate(doc.updatedAt),
    } as const;

    if (options.dryRun) {
      count += 1;
      continue;
    }

    try {
      const created = await prisma.businessCard.create({ data });
      if (legacyId) cardIdMap.set(legacyId, created.id);

      if (Array.isArray(doc.companyPhones)) {
        for (const phone of doc.companyPhones) {
          try {
            await prisma.businessCardPhone.create({
              data: {
                business_card_id: created.id,
                country_code: phone?.countryCode || undefined,
                phone: phone?.phone || undefined,
              },
            });
          } catch (err: any) {
            log.warn(`Company phone insert failed (${legacyId}): ${err?.message ?? err}`);
          }
        }
      }

      count += 1;
    } catch (err: any) {
      log.warn(`Card insert failed (${legacyId}): ${err?.message ?? err}`);
    }
  }

  log.info(`Cards migrated: ${count}`);
};

const migrateBusinessPromotions = async (db: any, collections: Set<string>, options: MigrationOptions) => {
  if (!shouldRun("business_promotions", options)) return;
  const name = pickCollection(collections, ["businesspromotions", "businesspromotion"]);
  if (!name) {
    log.warn("business promotions collection not found. Skipping.");
    return;
  }
  const col = db.collection(name);
  const total = await col.estimatedDocumentCount();
  log.info(`BusinessPromotions collection: ${total} docs`);
  const cursor = col.find({});
  let count = 0;
  let processed = 0;
  let missingUser = 0;
  const batchSize = Number(process.env.MIGRATION_BATCH_SIZE || 1000);
  const batch: Prisma.BusinessPromotionCreateManyInput[] = [];

  for await (const doc of cursor) {
    if (options.limit && count >= options.limit) break;
    processed += 1;
    const legacyId = idToString(doc._id);
    let userId = getMappedId(userIdMap, idToString(doc.userId));
    let isSystemOwner = false;
    if (!userId) {
      missingUser += 1;
      userId = await ensureSystemUser(options);
      isSystemOwner = true;
      auditLog("businesspromotion_missing_user", {
        promotion_id: legacyId,
        missing_user_id: idToString(doc.userId),
        fallback_user_id: userId,
      });
      if (missingUser <= 5) {
        log.warn(
          `BusinessPromotion ${legacyId} missing user. userId=${idToString(doc.userId)} Using system user.`
        );
      }
    }

    const data = {
      legacy_id: legacyId ?? undefined,
      user_id: userId,
      business_card_id: getMappedId(cardIdMap, idToString(doc.businessCardId)),
      business_name: doc.businessName || "Unknown Business",
      owner_name: doc.ownerName || doc.owner || "Unknown",
      description: doc.description || undefined,
      category: Array.isArray(doc.category) ? doc.category : [],
      email: doc.email || undefined,
      phone: doc.phone || undefined,
      whatsapp: doc.whatsapp || undefined,
      website: doc.website || undefined,
      business_hours: doc.businessHours || undefined,
      area: doc.area || undefined,
      pincode: doc.pincode || undefined,
      plot_no: doc.plotNo || undefined,
      building_name: doc.buildingName || undefined,
      street_name: doc.streetName || undefined,
      landmark: doc.landmark || undefined,
      city: doc.city || undefined,
      state: doc.state || undefined,
      gst_number: doc.gstNumber || undefined,
      pan_number: doc.panNumber || undefined,
      listing_type: isSystemOwner ? "official" : doc.listingType || "free",
      listing_intent: doc.listingIntent || "free",
      status: doc.status || "draft",
      current_step: doc.currentStep || undefined,
      progress: toNumber(doc.progress, 0),
      step_index: toNumber(doc.stepIndex, 1),
      plan_name: doc.plan?.name || undefined,
      plan_price: toNumber(doc.plan?.price, undefined),
      plan_duration_days: toNumber(doc.plan?.durationDays, undefined),
      plan_activated_at: toDate(doc.plan?.activatedAt),
      payment_status: doc.paymentStatus || "not_required",
      payment_id: doc.paymentId || undefined,
      visibility_priority_score: toNumber(doc.visibility?.priorityScore, 10),
      visibility_impressions: toNumber(doc.visibility?.impressions, 0),
      visibility_clicks: toNumber(doc.visibility?.clicks, 0),
      visibility_leads: toNumber(doc.visibility?.leads, 0),
      visibility_call_clicks: toNumber(doc.visibility?.callClicks, 0),
      visibility_whatsapp_clicks: toNumber(doc.visibility?.whatsappClicks, 0),
      media: doc.media || undefined,
      is_active: toBoolean(doc.isActive, false),
      expiry_date: toDate(doc.expiryDate),
      created_at: toDate(doc.createdAt),
      updated_at: toDate(doc.updatedAt),
    } as const;

    if (legacyId && data.business_card_id) {
      promotionCardIdMap.set(legacyId, data.business_card_id);
    }

    if (options.dryRun) {
      count += 1;
      if (processed % logEvery === 0) {
        log.info(`BusinessPromotions processed ${processed}/${total} (dry-run).`);
      }
      continue;
    }

    batch.push(data);
    if (batch.length >= batchSize) {
      try {
        const result = await prisma.businessPromotion.createMany({
          data: batch,
          skipDuplicates: true,
        });
        count += result.count;
      } catch (err: any) {
        log.warn(`BusinessPromotions batch insert failed: ${err?.message ?? err}`);
      } finally {
        batch.length = 0;
      }
    }

    if (processed % logEvery === 0) {
      log.info(`BusinessPromotions processed ${processed}/${total}.`);
    }
  }

  if (!options.dryRun && batch.length > 0) {
    try {
      const result = await prisma.businessPromotion.createMany({
        data: batch,
        skipDuplicates: true,
      });
      count += result.count;
    } catch (err: any) {
      log.warn(`BusinessPromotions final batch insert failed: ${err?.message ?? err}`);
    } finally {
      batch.length = 0;
    }
  }

  log.info(`BusinessPromotions migrated: ${count} (missing user: ${missingUser})`);
};

const migrateVouchers = async (db: any, collections: Set<string>, options: MigrationOptions) => {
  if (!shouldRun("vouchers", options)) return;
  const name = pickCollection(collections, ["vouchers", "voucher"]);
  if (!name) {
    log.warn("vouchers collection not found. Skipping vouchers migration.");
    return;
  }
  const col = db.collection(name);
  const total = await col.estimatedDocumentCount();
  log.info(`Vouchers collection: ${total} docs`);
  const cursor = col.find({});
  let count = 0;
  let processed = 0;
  const pendingTemplates: Array<{ legacyId: string; templateLegacyId?: string | null }> = [];

  for await (const doc of cursor) {
    if (options.limit && count >= options.limit) break;
    processed += 1;
    const legacyId = idToString(doc._id);
    const ownerUserId = getMappedId(userIdMap, idToString(doc.userId));
    const originalOwnerId = getMappedId(userIdMap, idToString(doc.originalOwner));
    const createdByAdmin = getMappedId(userIdMap, idToString(doc.createdByAdmin));
    const transferredFrom = getMappedId(userIdMap, idToString(doc.transferredFrom));
    const promotionLegacyId = idToString(
      doc.businessPromotionId || doc.promotionId || doc.businessPromotion || doc.promotion || doc.businessId
    );
    const businessPromotionId = getMappedId(promotionIdMap, promotionLegacyId);

    if (!businessPromotionId) {
      auditLog("voucher_missing_promotion", {
        voucher_id: legacyId,
        promotion_legacy_id: promotionLegacyId,
        business_id_legacy: idToString(doc.businessId),
      });
      continue;
    }

    const data: Prisma.VoucherUncheckedCreateInput = {
      legacy_id: legacyId ?? undefined,
      business_id: getMappedId(cardIdMap, idToString(doc.businessId)),
      // business_promotion_id set via cast below — column added in a later migration not yet merged to main
      ...( { business_promotion_id: businessPromotionId } as any ),
      business_name: doc.businessName || doc.companyName || "Instantlly",
      title: doc.title || doc.voucherNumber || "Voucher",
      description: doc.description || undefined,
      discount_type: doc.discountPercentage ? "percent" : "flat",
      discount_value: toNumber(doc.discountPercentage ?? doc.amount, 0) ?? 0,
      code: doc.voucherNumber || doc.code || undefined,
      max_claims: toNumber(doc.maxUses, undefined),
      claimed_count: toNumber(doc.maxUses, 0) ? toNumber(doc.maxUses, 0)! - (toNumber(doc.remainingUses, 0) ?? 0) : 0,
      expires_at: toDate(doc.expiryDate),
      status: doc.redeemedStatus || doc.status || "active",
      created_at: toDate(doc.createdAt),
      updated_at: toDate(doc.updatedAt),
      owner_user_id: ownerUserId,
      original_owner_id: originalOwnerId,
      voucher_number: doc.voucherNumber || undefined,
      mrp: toNumber(doc.MRP, undefined),
      issue_date: toDate(doc.issueDate),
      expiry_date: toDate(doc.expiryDate),
      redeemed_status: doc.redeemedStatus || undefined,
      voucher_images: Array.isArray(doc.voucherImages) ? doc.voucherImages : [],
      product_video_link: doc.productVideoLink || undefined,
      redeemed_at: toDate(doc.redeemedAt),
      max_uses: toNumber(doc.maxUses, undefined),
      remaining_uses: toNumber(doc.remainingUses, undefined),
      company_logo: doc.companyLogo || undefined,
      company_name: doc.companyName || undefined,
      phone_number: doc.phoneNumber || undefined,
      address: doc.address || undefined,
      amount: toNumber(doc.amount, undefined),
      discount_percentage: toNumber(doc.discountPercentage, undefined),
      validity: doc.validity || undefined,
      voucher_image: doc.voucherImage || undefined,
      min_vouchers_required: toNumber(doc.minVouchersRequired, undefined),
      template_id: undefined,
      is_published: doc.isPublished,
      published_at: toDate(doc.publishedAt),
      created_by_admin_id: createdByAdmin,
      source: doc.source || undefined,
      transferred_from_id: transferredFrom,
      transferred_at: toDate(doc.transferredAt),
    };

    if (options.dryRun) {
      count += 1;
      if (processed % logEvery === 0) {
        log.info(`Vouchers processed ${processed}/${total} (dry-run).`);
      }
      continue;
    }

    try {
      const created = await prisma.voucher.create({ data });
      if (legacyId) voucherIdMap.set(legacyId, created.id);
      pendingTemplates.push({
        legacyId: legacyId ?? String(created.id),
        templateLegacyId: idToString(doc.templateId),
      });

      if (Array.isArray(doc.transferHistory)) {
        for (const entry of doc.transferHistory) {
          const fromUser = getMappedId(userIdMap, idToString(entry.from));
          const toUser = getMappedId(userIdMap, idToString(entry.to));
          try {
            await prisma.voucherTransferLog.create({
              data: {
                voucher_id: created.id,
                from_user_id: fromUser,
                to_user_id: toUser,
                transferred_at: toDate(entry.transferredAt),
              },
            });
          } catch (err: any) {
            log.warn(`VoucherTransferLog failed (${legacyId}): ${err?.message ?? err}`);
          }
        }
      }

      if (Array.isArray(doc.usageHistory)) {
        for (const entry of doc.usageHistory) {
          const usedBy = getMappedId(userIdMap, idToString(entry.usedBy));
          try {
            await prisma.voucherRedemption.create({
              data: {
                voucher_id: created.id,
                used_by_id: usedBy,
                used_at: toDate(entry.usedAt),
              },
            });
          } catch (err: any) {
            log.warn(`VoucherRedemption failed (${legacyId}): ${err?.message ?? err}`);
          }
        }
      }

      count += 1;
    } catch (err: any) {
      log.warn(`Voucher insert failed (${legacyId}): ${err?.message ?? err}`);
    }

    if (processed % logEvery === 0) {
      log.info(`Vouchers processed ${processed}/${total}.`);
    }
  }

  if (!options.dryRun && pendingTemplates.length > 0) {
    for (const item of pendingTemplates) {
      const voucherId = getMappedId(voucherIdMap, item.legacyId);
      const templateId = getMappedId(voucherIdMap, item.templateLegacyId);
      if (!voucherId || !templateId) continue;
      try {
        await prisma.voucher.update({
          where: { id: voucherId },
          data: { template_id: templateId },
        });
      } catch (err: any) {
        log.warn(`Voucher template update failed (${item.legacyId}): ${err?.message ?? err}`);
      }
    }
  }

  log.info(`Vouchers migrated: ${count}`);
};

const migrateVoucherRedemptions = async (db: any, collections: Set<string>, options: MigrationOptions) => {
  if (!shouldRun("voucherredemptions", options)) return;
  const name = pickCollection(collections, ["voucherredemptions", "voucherredemption"]);
  if (!name) {
    log.warn("voucherredemptions collection not found. Skipping.");
    return;
  }
  const col = db.collection(name);
  const total = await col.estimatedDocumentCount();
  log.info(`VoucherRedemptions collection: ${total} docs`);
  const cursor = col.find({});
  let count = 0;
  let processed = 0;

  for await (const doc of cursor) {
    if (options.limit && count >= options.limit) break;
    processed += 1;
    const legacyId = idToString(doc._id);

    if (!options.dryRun && legacyId) {
      const existing = await prisma.voucherRedemption.findUnique({ where: { legacy_id: legacyId } });
      if (existing) {
        continue;
      }
    }

    const voucherLegacy = idToString(doc.voucherId || doc.voucher);
    const voucherId = getMappedId(voucherIdMap, voucherLegacy);
    if (!voucherId) {
      auditLog("voucherredemption_missing_voucher", {
        redemption_id: legacyId,
        missing_voucher_id: voucherLegacy,
      });
      continue;
    }

    const usedBy = getMappedId(userIdMap, idToString(doc.usedBy || doc.userId));
    const data = {
      legacy_id: legacyId ?? undefined,
      voucher_id: voucherId,
      used_by_id: usedBy,
      used_at: toDate(doc.usedAt || doc.redeemedAt || doc.createdAt),
    };

    if (options.dryRun) {
      count += 1;
      if (processed % logEvery === 0) {
        log.info(`VoucherRedemptions processed ${processed}/${total} (dry-run).`);
      }
      continue;
    }

    try {
      await prisma.voucherRedemption.create({ data });
      count += 1;
    } catch (err: any) {
      log.warn(`VoucherRedemption insert failed (${legacyId}): ${err?.message ?? err}`);
    }

    if (processed % logEvery === 0) {
      log.info(`VoucherRedemptions processed ${processed}/${total}.`);
    }
  }

  log.info(`VoucherRedemptions migrated: ${count}`);
};

const migrateVoucherTransferLogs = async (db: any, collections: Set<string>, options: MigrationOptions) => {
  if (!shouldRun("vouchertransferlogs", options)) return;
  const name = pickCollection(collections, ["vouchertransferlogs", "vouchertransferlog"]);
  if (!name) {
    log.warn("vouchertransferlogs collection not found. Skipping.");
    return;
  }
  const col = db.collection(name);
  const total = await col.estimatedDocumentCount();
  log.info(`VoucherTransferLogs collection: ${total} docs`);
  const cursor = col.find({});
  let count = 0;
  let processed = 0;

  for await (const doc of cursor) {
    if (options.limit && count >= options.limit) break;
    processed += 1;
    const legacyId = idToString(doc._id);

    if (!options.dryRun && legacyId) {
      const existing = await prisma.voucherTransferLog.findUnique({ where: { legacy_id: legacyId } });
      if (existing) {
        continue;
      }
    }

    const voucherLegacy = idToString(doc.voucherId || doc.voucher);
    const voucherId = getMappedId(voucherIdMap, voucherLegacy);
    if (!voucherId) {
      auditLog("vouchertransferlog_missing_voucher", {
        transfer_id: legacyId,
        missing_voucher_id: voucherLegacy,
      });
      continue;
    }

    const fromUser = getMappedId(userIdMap, idToString(doc.fromUser || doc.from));
    const toUser = getMappedId(userIdMap, idToString(doc.toUser || doc.to));
    const data = {
      legacy_id: legacyId ?? undefined,
      voucher_id: voucherId,
      from_user_id: fromUser,
      to_user_id: toUser,
      transferred_at: toDate(doc.transferredAt || doc.createdAt),
    };

    if (options.dryRun) {
      count += 1;
      if (processed % logEvery === 0) {
        log.info(`VoucherTransferLogs processed ${processed}/${total} (dry-run).`);
      }
      continue;
    }

    try {
      await prisma.voucherTransferLog.create({ data });
      count += 1;
    } catch (err: any) {
      log.warn(`VoucherTransferLog insert failed (${legacyId}): ${err?.message ?? err}`);
    }

    if (processed % logEvery === 0) {
      log.info(`VoucherTransferLogs processed ${processed}/${total}.`);
    }
  }

  log.info(`VoucherTransferLogs migrated: ${count}`);
};

const migrateContacts = async (db: any, collections: Set<string>, options: MigrationOptions) => {
  if (!shouldRun("contacts", options)) return;
  const name = pickCollection(collections, ["contacts", "contact"]);
  if (!name) {
    log.warn("contacts collection not found. Skipping contacts migration.");
    return;
  }
  const col = db.collection(name);
  const total = await col.estimatedDocumentCount();
  const cursor = col.find({});
  let count = 0;
  let processed = 0;
  let missingUser = 0;
  const batchSize = Number(process.env.MIGRATION_BATCH_SIZE || 1000);
  const batch: Prisma.ContactCreateManyInput[] = [];

  for await (const doc of cursor) {
    if (options.limit && count >= options.limit) break;
    processed += 1;
    const legacyId = idToString(doc._id);
    const userId = getMappedId(userIdMap, idToString(doc.userId));
    if (!userId) {
      missingUser += 1;
      if (missingUser <= 5) {
        log.warn(`Contact ${legacyId} missing user. Skipping.`);
      }
      continue;
    }
    const appUserId = getMappedId(userIdMap, idToString(doc.appUserId));

    const data = {
      legacy_id: legacyId ?? undefined,
      user_id: userId,
      name: sanitizeString(doc.name) || "Unknown",
      phone_number: sanitizeString(doc.phoneNumber || doc.phone) || "NA",
      is_app_user: toBoolean(doc.isAppUser, false),
      app_user_id: appUserId,
      last_synced: toDate(doc.lastSynced),
      created_at: toDate(doc.createdAt),
    } as const;

    if (options.dryRun) {
      count += 1;
      if (processed % logEvery === 0) {
        log.info(`Contacts processed ${processed}/${total} (dry-run).`);
      }
      continue;
    }

    batch.push(data);
    if (batch.length >= batchSize) {
      try {
        const result = await prisma.contact.createMany({
          data: batch,
          skipDuplicates: true,
        });
        count += result.count;
      } catch (err: any) {
        log.warn(`Contacts batch insert failed: ${err?.message ?? err}`);
        for (const row of batch) {
          try {
            await prisma.contact.create({ data: row });
            count += 1;
          } catch (innerErr: any) {
            log.warn(`Contact insert failed (${row.legacy_id}): ${innerErr?.message ?? innerErr}`);
          }
        }
      } finally {
        batch.length = 0;
      }
    }

    if (processed % logEvery === 0) {
      log.info(`Contacts processed ${processed}/${total}.`);
    }
  }

  if (!options.dryRun && batch.length > 0) {
    try {
      const result = await prisma.contact.createMany({
        data: batch,
        skipDuplicates: true,
      });
      count += result.count;
    } catch (err: any) {
      log.warn(`Contacts final batch insert failed: ${err?.message ?? err}`);
      for (const row of batch) {
        try {
          await prisma.contact.create({ data: row });
          count += 1;
        } catch (innerErr: any) {
          log.warn(`Contact insert failed (${row.legacy_id}): ${innerErr?.message ?? innerErr}`);
        }
      }
    } finally {
      batch.length = 0;
    }
  }

  log.info(`Contacts migrated: ${count}${missingUser ? ` (missing user: ${missingUser})` : ""}`);
};

const migrateNotifications = async (db: any, collections: Set<string>, options: MigrationOptions) => {
  if (!shouldRun("notifications", options)) return;
  const name = pickCollection(collections, ["notifications", "notification"]);
  if (!name) return;
  const col = db.collection(name);
  const cursor = col.find({});
  let count = 0;

  for await (const doc of cursor) {
    if (options.limit && count >= options.limit) break;
    const legacyId = idToString(doc._id);
    const userId = getMappedId(userIdMap, idToString(doc.userId));
    if (!userId) continue;

    const data = {
      legacy_id: legacyId ?? undefined,
      user_id: userId,
      title: doc.title || "Notification",
      description: doc.message || doc.description || "",
      type: doc.type || "GENERAL",
      is_read: toBoolean(doc.read, false),
      created_at: toDate(doc.createdAt),
    } as const;

    if (options.dryRun) {
      count += 1;
      continue;
    }
    try {
      await prisma.notification.create({ data });
      count += 1;
    } catch (err: any) {
      log.warn(`Notification insert failed (${legacyId}): ${err?.message ?? err}`);
    }
  }

  log.info(`Notifications migrated: ${count}`);
};

const migrateGroupSessions = async (db: any, collections: Set<string>, options: MigrationOptions) => {
  if (!shouldRun("groupsessions", options)) return;
  const name = pickCollection(collections, ["groupsessions", "groupSession", "group_sessions"]);
  if (!name) {
    log.warn("group sessions collection not found. Skipping group sessions migration.");
    return;
  }
  const col = db.collection(name);
  const cursor = col.find({});
  let count = 0;

  for await (const doc of cursor) {
    if (options.limit && count >= options.limit) break;
    const legacyId = idToString(doc._id);
    if (!options.dryRun && legacyId) {
      const existing = await prisma.groupSession.findUnique({ where: { legacy_id: legacyId } });
      if (existing) {
        groupSessionIdMap.set(legacyId, existing.id);
        continue;
      }
    }

    const createdAt = toDate(doc.createdAt) ?? new Date();
    const expiresAt = toDate(doc.expiresAt) ?? new Date(createdAt.getTime() + 24 * 60 * 60 * 1000);

    const data = {
      legacy_id: legacyId ?? undefined,
      code: sanitizeString(doc.code || doc.joinCode) || `legacy-${legacyId ?? Math.random().toString(36).slice(2, 8)}`,
      admin_id: sanitizeString(doc.adminId || doc.admin_id || doc.admin) || "unknown",
      admin_name: sanitizeString(doc.adminName || doc.admin_name || doc.adminUserName) || "Unknown",
      admin_phone: sanitizeString(doc.adminPhone || doc.admin_phone) || "NA",
      admin_photo: doc.adminPhoto || undefined,
      status: doc.status || "waiting",
      allow_participant_sharing: toBoolean(doc.allowParticipantSharing, false),
      created_at: createdAt,
      expires_at: expiresAt,
      is_active: toBoolean(doc.isActive, true),
    } as const;

    if (options.dryRun) {
      count += 1;
      continue;
    }

    try {
      const created = await prisma.groupSession.create({ data });
      if (legacyId) groupSessionIdMap.set(legacyId, created.id);
      count += 1;
    } catch (err: any) {
      log.warn(`GroupSession insert failed (${legacyId}): ${err?.message ?? err}`);
    }
  }

  log.info(`GroupSessions migrated: ${count}`);
};

const migrateCardShares = async (db: any, collections: Set<string>, options: MigrationOptions) => {
  if (!shouldRun("cardshares", options)) return;
  const name = pickCollection(collections, ["cardshares", "cardshare", "card_shares"]);
  if (!name) {
    log.warn("card shares collection not found. Skipping card shares migration.");
    return;
  }
  const col = db.collection(name);
  const sessionCollectionName = pickCollection(collections, ["groupsessions", "groupSession", "group_sessions"]);
  const sessionCollection = sessionCollectionName ? db.collection(sessionCollectionName) : null;
  const cursor = col.find({});
  let count = 0;

  for await (const doc of cursor) {
    if (options.limit && count >= options.limit) break;
    const legacyId = idToString(doc._id);

    const sessionLegacyId = idToString(
      doc.sessionId || doc.groupSessionId || doc.session || doc.groupSession
    ) || `cardshare-${legacyId ?? Math.random().toString(36).slice(2, 8)}`;

    let sessionId = getMappedId(groupSessionIdMap, sessionLegacyId);
    if (!sessionId) {
      let sessionDoc: AnyDoc | null = null;
      if (sessionCollection && ObjectId.isValid(sessionLegacyId)) {
        sessionDoc = await sessionCollection.findOne({ _id: new ObjectId(sessionLegacyId) });
      }
      sessionId = await ensureGroupSessionFromDoc(
        sessionDoc ?? {
          _id: sessionLegacyId,
          adminId: doc.fromUserId || doc.senderId || doc.userId,
          adminName: doc.fromUserName || doc.senderName || doc.userName,
          adminPhone: doc.fromUserPhone || doc.senderPhone || doc.userPhone,
          createdAt: doc.createdAt,
        },
        options,
        sessionLegacyId
      );
    }

    if (!sessionId) continue;

    const data = {
      legacy_id: legacyId ?? undefined,
      session_id: sessionId,
      from_user_id: idToString(doc.fromUserId || doc.senderId || doc.from || doc.userId) || "unknown",
      to_user_id: idToString(doc.toUserId || doc.recipientId || doc.to || doc.receiverId) || "unknown",
      card_id: getMappedId(cardIdMap, idToString(doc.cardId || doc.card || doc.businessCardId)),
      shared_at: toDate(doc.sharedAt || doc.createdAt) ?? new Date(),
    } as const;

    if (!options.dryRun && legacyId) {
      const existing = await prisma.cardShare.findUnique({ where: { legacy_id: legacyId } });
      if (existing) continue;
    }

    if (options.dryRun) {
      count += 1;
      continue;
    }

    try {
      await prisma.cardShare.create({ data });
      count += 1;
    } catch (err: any) {
      log.warn(`CardShare insert failed (${legacyId}): ${err?.message ?? err}`);
    }
  }

  log.info(`CardShares migrated: ${count}`);
};

const migrateSharedCards = async (db: any, collections: Set<string>, options: MigrationOptions) => {
  if (!shouldRun("sharedcards", options)) return;
  const name = pickCollection(collections, ["sharedcards", "sharedcard", "shared_cards"]);
  if (!name) {
    log.warn("shared cards collection not found. Skipping shared cards migration.");
    return;
  }
  const col = db.collection(name);
  const cursor = col.find({});
  let count = 0;
  let skipped = 0;

  for await (const doc of cursor) {
    if (options.limit && count >= options.limit) break;
    const legacyId = idToString(doc._id);
    const cardId = getMappedId(cardIdMap, idToString(doc.cardId || doc.card || doc.businessCardId));
    if (!cardId) {
      skipped += 1;
      auditLog("sharedcard_missing_card", {
        sharedcard_id: legacyId,
        missing_card_id: idToString(doc.cardId || doc.card || doc.businessCardId),
      });
      continue;
    }

    const data = {
      legacy_id: legacyId ?? undefined,
      card_id: cardId,
      sender_id: idToString(doc.senderId || doc.fromUserId || doc.sender) || "unknown",
      recipient_id: idToString(doc.recipientId || doc.toUserId || doc.recipient) || "unknown",
      message: doc.message || undefined,
      status: doc.status || "sent",
      sent_at: toDate(doc.sentAt || doc.createdAt) ?? new Date(),
      viewed_at: toDate(doc.viewedAt),
      card_title: doc.cardTitle || doc.title || doc.cardName || "Shared Card",
      sender_name: doc.senderName || doc.fromUserName || "Unknown",
      recipient_name: doc.recipientName || doc.toUserName || "Unknown",
      card_photo: doc.cardPhoto || doc.photo || undefined,
      sender_profile_picture: doc.senderProfilePicture || doc.senderPhoto || undefined,
      recipient_profile_picture: doc.recipientProfilePicture || doc.recipientPhoto || undefined,
      created_at: toDate(doc.createdAt) ?? new Date(),
      updated_at: toDate(doc.updatedAt) ?? new Date(),
    } as const;

    if (!options.dryRun && legacyId) {
      const existing = await prisma.sharedCard.findUnique({ where: { legacy_id: legacyId } });
      if (existing) continue;
    }

    if (options.dryRun) {
      count += 1;
      continue;
    }

    try {
      await prisma.sharedCard.create({ data });
      count += 1;
    } catch (err: any) {
      log.warn(`SharedCard insert failed (${legacyId}): ${err?.message ?? err}`);
    }
  }

  log.info(`SharedCards migrated: ${count}${skipped ? ` (skipped missing card: ${skipped})` : ""}`);
};

const migrateGroupSharedCards = async (db: any, collections: Set<string>, options: MigrationOptions) => {
  if (!shouldRun("groupsharedcards", options)) return;
  const name = pickCollection(collections, ["groupsharedcards", "groupsharedcard", "group_shared_cards"]);
  if (!name) {
    log.warn("group shared cards collection not found. Skipping.");
    return;
  }
  const col = db.collection(name);
  const cursor = col.find({});
  let count = 0;
  let skipped = 0;

  for await (const doc of cursor) {
    if (options.limit && count >= options.limit) break;
    const legacyId = idToString(doc._id);
    const cardId = getMappedId(cardIdMap, idToString(doc.cardId || doc.card || doc.businessCardId));
    const groupId = getMappedId(groupIdMap, idToString(doc.groupId || doc.group || doc.group_id));
    if (!cardId || !groupId) {
      skipped += 1;
      auditLog("groupsharedcard_missing_ref", {
        groupsharedcard_id: legacyId,
        missing_card_id: idToString(doc.cardId || doc.card || doc.businessCardId),
        missing_group_id: idToString(doc.groupId || doc.group || doc.group_id),
      });
      continue;
    }

    const data = {
      legacy_id: legacyId ?? undefined,
      card_id: cardId,
      sender_id: idToString(doc.senderId || doc.fromUserId || doc.sender) || "unknown",
      group_id: groupId,
      message: doc.message || undefined,
      sent_at: toDate(doc.sentAt || doc.createdAt) ?? new Date(),
      card_title: doc.cardTitle || doc.title || "Shared Card",
      sender_name: doc.senderName || doc.fromUserName || "Unknown",
      group_name: doc.groupName || doc.groupTitle || "Group",
      created_at: toDate(doc.createdAt) ?? new Date(),
      updated_at: toDate(doc.updatedAt) ?? new Date(),
    } as const;

    if (!options.dryRun && legacyId) {
      const existing = await prisma.groupSharedCard.findUnique({ where: { legacy_id: legacyId } });
      if (existing) continue;
    }

    if (options.dryRun) {
      count += 1;
      continue;
    }

    try {
      await prisma.groupSharedCard.create({ data });
      count += 1;
    } catch (err: any) {
      log.warn(`GroupSharedCard insert failed (${legacyId}): ${err?.message ?? err}`);
    }
  }

  log.info(`GroupSharedCards migrated: ${count}${skipped ? ` (skipped missing ref: ${skipped})` : ""}`);
};

const migrateFeedbacks = async (db: any, collections: Set<string>, options: MigrationOptions) => {
  if (!shouldRun("feedbacks", options)) return;
  const name = pickCollection(collections, ["feedbacks", "feedback"]);
  if (!name) {
    log.warn("feedbacks collection not found. Skipping feedbacks migration.");
    return;
  }
  const col = db.collection(name);
  const cursor = col.find({});
  let count = 0;

  for await (const doc of cursor) {
    if (options.limit && count >= options.limit) break;
    const legacyId = idToString(doc._id);
    let userId = getMappedId(userIdMap, idToString(doc.userId || doc.user || doc.user_id));
    if (!userId) {
      userId = await ensureSystemUser(options);
      auditLog("feedback_missing_user", {
        feedback_id: legacyId,
        missing_user_id: idToString(doc.userId || doc.user || doc.user_id),
        fallback_user_id: userId,
      });
    }

    const data = {
      legacy_id: legacyId ?? undefined,
      user_id: userId,
      name: sanitizeString(doc.name || doc.userName) || "Unknown",
      phone: sanitizeString(doc.phone || doc.userPhone) || "NA",
      email: sanitizeString(doc.email || doc.userEmail) || undefined,
      subject: sanitizeString(doc.subject || doc.title) || "Feedback",
      message: sanitizeString(doc.message || doc.description || doc.feedback) || "",
      rating: toNumber(doc.rating, undefined),
      status: doc.status || "pending",
      admin_response: sanitizeString(doc.adminResponse || doc.response) || undefined,
      responded_at: toDate(doc.respondedAt),
      created_at: toDate(doc.createdAt) ?? new Date(),
      updated_at: toDate(doc.updatedAt) ?? new Date(),
    } as const;

    if (!options.dryRun && legacyId) {
      const existing = await prisma.feedback.findUnique({ where: { legacy_id: legacyId } });
      if (existing) continue;
    }

    if (options.dryRun) {
      count += 1;
      continue;
    }

    try {
      await prisma.feedback.create({ data });
      count += 1;
    } catch (err: any) {
      log.warn(`Feedback insert failed (${legacyId}): ${err?.message ?? err}`);
    }
  }

  log.info(`Feedbacks migrated: ${count}`);
};

const migrateReviews = async (db: any, collections: Set<string>, options: MigrationOptions) => {
  if (!shouldRun("reviews", options)) return;
  const name = pickCollection(collections, ["reviews", "review"]);
  if (!name) {
    log.warn("reviews collection not found. Skipping reviews migration.");
    return;
  }
  const col = db.collection(name);
  const promotionCollectionName = pickCollection(collections, ["businesspromotions", "businesspromotion"]);
  const promotionCollection = promotionCollectionName ? db.collection(promotionCollectionName) : null;
  const cursor = col.find({});
  let count = 0;
  let skipped = 0;

  for await (const doc of cursor) {
    if (options.limit && count >= options.limit) break;
    const legacyId = idToString(doc._id);
    let userId = getMappedId(userIdMap, idToString(doc.userId || doc.user || doc.user_id));
    const businessLegacyId = idToString(
      doc.businessId || doc.business || doc.business_id || doc.cardId || doc.card || doc.businessCardId
    );
    let businessId = getMappedId(cardIdMap, businessLegacyId);

    if (!businessId) {
      const promotionLegacyId = idToString(
        doc.businessPromotionId || doc.promotionId || doc.businessPromotion || doc.promotion || businessLegacyId
      );
      businessId = getMappedId(promotionCardIdMap, promotionLegacyId);
      if (!businessId && promotionLegacyId && promotionCollection) {
        const promoObjectId = ObjectId.isValid(promotionLegacyId) ? new ObjectId(promotionLegacyId) : null;
        const promotionDoc = promoObjectId
          ? await promotionCollection.findOne({ _id: promoObjectId })
          : await promotionCollection.findOne({ _id: promotionLegacyId });
        if (promotionDoc) {
          businessId = await ensurePromotionCardFromDoc(promotionDoc, options);
        }
      }
      if (!businessId && promotionLegacyId) {
        auditLog("review_missing_promotion_card", {
          review_id: legacyId,
          promotion_legacy_id: promotionLegacyId,
        });
      }
    }

    if (!businessId) {
      skipped += 1;
      auditLog("review_missing_business", {
        review_id: legacyId,
        missing_business_id: businessLegacyId,
      });
      continue;
    }

    if (!userId) {
      userId = await ensureSystemUser(options);
      auditLog("review_missing_user", {
        review_id: legacyId,
        missing_user_id: idToString(doc.userId || doc.user || doc.user_id),
        fallback_user_id: userId,
      });
    }

    const ratingRaw = toNumber(doc.rating ?? doc.stars ?? doc.score, 5) ?? 5;
    const rating = Math.max(1, Math.min(5, Math.round(ratingRaw)));

    const data = {
      legacy_id: legacyId ?? undefined,
      user_id: userId,
      business_id: businessId,
      rating,
      comment: doc.comment || doc.review || doc.message || undefined,
      photo_url: doc.photo || doc.image || doc.photoUrl || undefined,
      created_at: toDate(doc.createdAt) ?? new Date(),
    } as const;

    if (!options.dryRun && legacyId) {
      const existing = await prisma.review.findUnique({ where: { legacy_id: legacyId } });
      if (existing) {
        continue;
      }
    }

    if (options.dryRun) {
      count += 1;
      continue;
    }

    try {
      await prisma.review.create({ data });
      count += 1;
    } catch (err: any) {
      log.warn(`Review insert failed (${legacyId}): ${err?.message ?? err}`);
    }
  }

  log.info(`Reviews migrated: ${count}${skipped ? ` (skipped missing business: ${skipped})` : ""}`);
};

const migrateGroups = async (db: any, collections: Set<string>, options: MigrationOptions) => {
  if (!shouldRun("groups", options)) return;
  const name = pickCollection(collections, ["groups", "group"]);
  if (!name) return;
  const col = db.collection(name);
  const total = await col.estimatedDocumentCount();
  log.info(`Groups collection: ${total} docs`);
  const cursor = col.find({});
  let count = 0;
  let processed = 0;
  let missingAdmin = 0;
  const allowAdminFallback = true;
  const pendingLastMessage: Array<{ legacyId: string; lastMessageLegacyId?: string | null }> = [];

  for await (const doc of cursor) {
    if (options.limit && count >= options.limit) break;
    processed += 1;
    const legacyId = idToString(doc._id);
    const adminLegacyId = idToString(doc.admin);
    let adminId = getMappedId(userIdMap, adminLegacyId);
    if (!adminId) {
      missingAdmin += 1;
      if (allowAdminFallback && Array.isArray(doc.members)) {
        const fallbackLegacy = doc.members.map(idToString).find((v: any) => getMappedId(userIdMap, v));
        adminId = getMappedId(userIdMap, fallbackLegacy);
      }
      if (!adminId) {
        if (missingAdmin <= 5) {
          log.warn(`Group ${legacyId} missing admin. admin=${adminLegacyId} Using fallback member/system user.`);
        }
        adminId = await ensureSystemUser(options);
        auditLog("group_admin_fallback", {
          group_id: legacyId,
          admin_legacy_id: adminLegacyId,
          members: Array.isArray(doc.members) ? doc.members.map(idToString) : [],
          fallback_user_id: adminId,
        });
      }
    }

    if (!adminId) {
      continue;
    }

    const data = {
      legacy_id: legacyId ?? undefined,
      name: doc.name || "Group",
      description: doc.description || undefined,
      icon: doc.icon || undefined,
      admin_id: adminId,
      join_code: doc.joinCode || undefined,
      last_message_time: toDate(doc.lastMessageTime),
      is_active: toBoolean(doc.isActive, true),
      created_at: toDate(doc.createdAt),
      updated_at: toDate(doc.updatedAt),
    };

    if (options.dryRun) {
      count += 1;
      if (processed % logEvery === 0) {
        log.info(`Groups processed ${processed}/${total} (dry-run).`);
      }
      continue;
    }

    try {
      const created = await prisma.group.create({ data });
      if (legacyId) groupIdMap.set(legacyId, created.id);
      pendingLastMessage.push({
        legacyId: legacyId ?? String(created.id),
        lastMessageLegacyId: idToString(doc.lastMessage),
      });

      if (Array.isArray(doc.members)) {
        for (const member of doc.members) {
          const memberLegacyId = idToString(member);
          const memberId = getMappedId(userIdMap, memberLegacyId);
          if (!memberId) continue;
          const roleValue =
            typeof doc.memberRoles?.get === "function"
              ? doc.memberRoles.get(memberLegacyId ?? "")
              : doc.memberRoles?.[memberLegacyId ?? ""];
          try {
            await prisma.groupMember.create({
              data: {
                group_id: created.id,
                user_id: memberId,
                role: roleValue || "member",
                is_muted: Array.isArray(doc.mutedBy)
                  ? doc.mutedBy.some((v: any) => idToString(v) === idToString(member))
                  : false,
              },
            });
          } catch (err: any) {
            log.warn(`GroupMember insert failed (${legacyId}): ${err?.message ?? err}`);
          }
        }
      }

      count += 1;
    } catch (err: any) {
      log.warn(`Group insert failed (${legacyId}): ${err?.message ?? err}`);
    }

    if (processed % logEvery === 0) {
      log.info(`Groups processed ${processed}/${total}.`);
    }
  }

  if (!options.dryRun && pendingLastMessage.length > 0) {
    for (const pending of pendingLastMessage) {
      const groupId = getMappedId(groupIdMap, pending.legacyId);
      const lastMessageId = getMappedId(messageIdMap, pending.lastMessageLegacyId);
      if (!groupId || !lastMessageId) continue;
      try {
        await prisma.group.update({
          where: { id: groupId },
          data: { last_message_id: lastMessageId },
        });
      } catch (err: any) {
        log.warn(`Group last message update failed (${pending.legacyId}): ${err?.message ?? err}`);
      }
    }
  }

  log.info(`Groups migrated: ${count} (missing admin: ${missingAdmin})`);
};

const migrateChats = async (db: any, collections: Set<string>, options: MigrationOptions) => {
  if (!shouldRun("chats", options)) return;
  const name = pickCollection(collections, ["chats", "chat"]);
  if (!name) return;
  const col = db.collection(name);
  const cursor = col.find({});
  let count = 0;
  const pendingLastMessage: Array<{ legacyId: string; lastMessageLegacyId?: string | null }> = [];

  for await (const doc of cursor) {
    if (options.limit && count >= options.limit) break;
    const legacyId = idToString(doc._id);
    const groupId = getMappedId(groupIdMap, idToString(doc.groupId));

    const data = {
      legacy_id: legacyId ?? undefined,
      is_group: toBoolean(doc.isGroup, false),
      group_id: groupId,
      last_message_time: toDate(doc.lastMessageTime),
      is_active: toBoolean(doc.isActive, true),
      created_at: toDate(doc.createdAt),
      updated_at: toDate(doc.updatedAt),
    } as const;

    if (options.dryRun) {
      count += 1;
      continue;
    }

    try {
      const created = await prisma.chat.create({ data });
      if (legacyId) chatIdMap.set(legacyId, created.id);
      pendingLastMessage.push({
        legacyId: legacyId ?? String(created.id),
        lastMessageLegacyId: idToString(doc.lastMessage),
      });

      if (Array.isArray(doc.participants)) {
        for (const participant of doc.participants) {
          const userId = getMappedId(userIdMap, idToString(participant));
          if (!userId) continue;
          const unreadCount = doc.unreadCount?.get?.(idToString(participant) ?? "") ?? 0;
          const isMuted = Array.isArray(doc.mutedBy)
            ? doc.mutedBy.some((v: any) => idToString(v) === idToString(participant))
            : false;
          try {
            await prisma.chatParticipant.create({
              data: {
                chat_id: created.id,
                user_id: userId,
                unread_count: toNumber(unreadCount, 0) ?? 0,
                is_muted: toBoolean(isMuted, false),
              },
            });
          } catch (err: any) {
            log.warn(`ChatParticipant insert failed (${legacyId}): ${err?.message ?? err}`);
          }
        }
      }

      count += 1;
    } catch (err: any) {
      log.warn(`Chat insert failed (${legacyId}): ${err?.message ?? err}`);
    }
  }

  if (!options.dryRun && pendingLastMessage.length > 0) {
    for (const pending of pendingLastMessage) {
      const chatId = getMappedId(chatIdMap, pending.legacyId);
      const lastMessageId = getMappedId(messageIdMap, pending.lastMessageLegacyId);
      if (!chatId || !lastMessageId) continue;
      try {
        await prisma.chat.update({
          where: { id: chatId },
          data: { last_message_id: lastMessageId },
        });
      } catch (err: any) {
        log.warn(`Chat last message update failed (${pending.legacyId}): ${err?.message ?? err}`);
      }
    }
  }

  log.info(`Chats migrated: ${count}`);
};

const migrateMessages = async (db: any, collections: Set<string>, options: MigrationOptions) => {
  if (!shouldRun("messages", options)) return;
  const name = pickCollection(collections, ["messages", "message"]);
  if (!name) return;
  const col = db.collection(name);
  const cursor = col.find({});
  let count = 0;

  for await (const doc of cursor) {
    if (options.limit && count >= options.limit) break;
    const legacyId = idToString(doc._id);
    const senderId = getMappedId(userIdMap, idToString(doc.sender));
    const receiverId = getMappedId(userIdMap, idToString(doc.receiver));
    const chatId = getMappedId(chatIdMap, idToString(doc.chatId));
    const groupId = getMappedId(groupIdMap, idToString(doc.groupId));
    if (!senderId) continue;

    const messageTypeRaw = String(doc.messageType || "text").toLowerCase() as keyof typeof MessageType;
    const messageType = MessageType[messageTypeRaw as keyof typeof MessageType] ?? MessageType.text;

    const data = {
      legacy_id: legacyId ?? undefined,
      sender_id: senderId,
      receiver_id: receiverId,
      chat_id: chatId,
      group_id: groupId,
      content: doc.content || "",
      message_type: messageType,
      is_read: toBoolean(doc.isRead, false),
      read_at: toDate(doc.readAt),
      is_delivered: toBoolean(doc.isDelivered, false),
      delivered_at: toDate(doc.deliveredAt),
      is_pending_delivery: toBoolean(doc.isPendingDelivery, false),
      local_message_id: doc.localMessageId || undefined,
      conversation_id: doc.conversationId || undefined,
      metadata: doc.metadata || undefined,
      is_deleted: toBoolean(doc.isDeleted, false),
      deleted_at: toDate(doc.deletedAt),
      created_at: toDate(doc.createdAt),
      updated_at: toDate(doc.updatedAt),
    } as const;

    if (options.dryRun) {
      count += 1;
      continue;
    }

    try {
      const created = await prisma.message.create({ data });
      if (legacyId) messageIdMap.set(legacyId, created.id);
      count += 1;
    } catch (err: any) {
      log.warn(`Message insert failed (${legacyId}): ${err?.message ?? err}`);
    }
  }

  log.info(`Messages migrated: ${count}`);
};

const migrateAds = async (db: any, collections: Set<string>, options: MigrationOptions) => {
  if (!shouldRun("ads", options)) return;
  const name = pickCollection(collections, ["ads", "ad"]);
  if (!name) return;
  const col = db.collection(name);
  const cursor = col.find({});
  let count = 0;

  const phoneToCardId = new Map<string, number>();
  for (const [, cardId] of cardIdMap.entries()) {
    const card = await prisma.businessCard.findUnique({
      where: { id: cardId },
      select: { phone: true, personal_phone: true, company_phone: true },
    });
    if (!card) continue;
    const phones = [card.phone, card.personal_phone, card.company_phone].filter(Boolean) as string[];
    for (const p of phones) phoneToCardId.set(normalizePhone(p) ?? p, cardId);
  }

  let systemAdsCardId: number | null = null;
  const ensureSystemAdsCard = async () => {
    if (options.dryRun) {
      return -1;
    }
    if (systemAdsCardId) return systemAdsCardId;
    const systemLegacyId = "system-ads-card";
    const existing = await prisma.businessCard.findFirst({
      where: { legacy_id: systemLegacyId },
    });
    if (existing) {
      systemAdsCardId = existing.id;
      return existing.id;
    }

    let adminUser = await prisma.user.findFirst({
      where: { is_voucher_admin: true },
      orderBy: { id: "asc" },
    });

    if (!adminUser) {
      adminUser = await prisma.user.findFirst({ orderBy: { id: "asc" } });
    }

    if (!adminUser) {
      throw new Error("No users found to attach system ads card.");
    }

    const created = await prisma.businessCard.create({
      data: {
        legacy_id: systemLegacyId,
        user_id: adminUser.id,
        full_name: adminUser.name || "Instantlly",
        company_name: "Instantlly Ads",
        description: "System card for ads migrated without matching business.",
        is_default: false,
      },
    });
    systemAdsCardId = created.id;
    return created.id;
  };

  for await (const doc of cursor) {
    if (options.limit && count >= options.limit) break;
    const legacyId = idToString(doc._id);
    const phone = normalizePhone(doc.phoneNumber || doc.uploadedBy);
    let businessId = phone ? phoneToCardId.get(phone) : undefined;
    if (!businessId) {
      const sysId = await ensureSystemAdsCard();
      businessId = sysId;
      auditLog("ad_fallback_system_card", {
        ad_id: legacyId,
        phone,
        reason: "No matching business card by phone.",
      });
    }

    const data = {
      legacy_id: legacyId ?? undefined,
      business_id: businessId,
      title: doc.title || "Ad",
      description: doc.description || undefined,
      image_url: doc.bottomImageS3?.url || doc.bottomImage || undefined,
      cta_url: doc.ctaUrl || undefined,
      ad_type: doc.adType === "video" ? AdType.inline : AdType.banner,
      budget: toNumber(doc.budget, undefined),
      spent: toNumber(doc.spent, 0) ?? 0,
      impressions: toNumber(doc.impressions, 0) ?? 0,
      clicks: toNumber(doc.clicks, 0) ?? 0,
      status: doc.status || "active",
      start_date: toDate(doc.startDate),
      end_date: toDate(doc.endDate),
      created_at: toDate(doc.createdAt),
      bottom_image: doc.bottomImage || undefined,
      bottom_image_gridfs: idToString(doc.bottomImageGridFS) || undefined,
      fullscreen_image: doc.fullscreenImage || undefined,
      fullscreen_image_gridfs: idToString(doc.fullscreenImageGridFS) || undefined,
      bottom_media_type: doc.bottomMediaType || undefined,
      fullscreen_media_type: doc.fullscreenMediaType || undefined,
      bottom_video_url: doc.bottomVideoUrl || undefined,
      fullscreen_video_url: doc.fullscreenVideoUrl || undefined,
      bottom_image_s3_url: doc.bottomImageS3?.url || undefined,
      bottom_image_s3_key: doc.bottomImageS3?.key || undefined,
      fullscreen_image_s3_url: doc.fullscreenImageS3?.url || undefined,
      fullscreen_image_s3_key: doc.fullscreenImageS3?.key || undefined,
      bottom_video_s3_url: doc.bottomVideoS3?.url || undefined,
      bottom_video_s3_key: doc.bottomVideoS3?.key || undefined,
      fullscreen_video_s3_url: doc.fullscreenVideoS3?.url || undefined,
      fullscreen_video_s3_key: doc.fullscreenVideoS3?.key || undefined,
      bottom_video: doc.bottomVideo || undefined,
      bottom_video_gridfs: idToString(doc.bottomVideoGridFS) || undefined,
      fullscreen_video: doc.fullscreenVideo || undefined,
      fullscreen_video_gridfs: idToString(doc.fullscreenVideoGridFS) || undefined,
      ad_type_legacy: doc.adType || undefined,
      phone_number: doc.phoneNumber || undefined,
      priority: toNumber(doc.priority, 5),
      approval_status: doc.status || undefined,
      uploaded_by: doc.uploadedBy || undefined,
      uploader_name: doc.uploaderName || undefined,
      approved_by: doc.approvedBy || undefined,
      approval_date: toDate(doc.approvalDate),
      rejection_reason: doc.rejectionReason || undefined,
      payment_status: doc.paymentStatus || undefined,
      payment_order_id: getMappedId(mapByLegacyId, idToString(doc.paymentOrderId)),
    } as const;

    if (options.dryRun) {
      count += 1;
      continue;
    }

    try {
      const created = await prisma.ad.create({ data });
      if (legacyId) adIdMap.set(legacyId, created.id);
      count += 1;
    } catch (err: any) {
      log.warn(`Ad insert failed (${legacyId}): ${err?.message ?? err}`);
    }
  }

  log.info(`Ads migrated: ${count}`);
};

const migrate = async () => {
  const options = parseArgs();
  const mongoUri = process.env.MONGODB_URI;
  if (!mongoUri) {
    throw new Error("MONGODB_URI is required.");
  }

  log.info(`Starting migration${options.dryRun ? " (dry-run)" : ""}...`);
  await ensureEmptyDatabase(options);

  const uriWithPreference = mongoUri.includes("readPreference=")
    ? mongoUri
    : `${mongoUri}${mongoUri.includes("?") ? "&" : "?"}readPreference=secondaryPreferred`;
  const client = new MongoClient(uriWithPreference);
  await client.connect();
  const db = client.db();
  const collectionList = await db.listCollections().toArray();
  const collections = new Set(collectionList.map((c) => c.name));
  log.info(`Mongo collections found: ${Array.from(collections).sort().slice(0, 50).join(", ")}${collections.size > 50 ? " ..." : ""}`);

  try {
    if (!shouldRun("users", options)) {
      if (options.dryRun) {
        await preloadUserMapFromMongoForDryRun(db, collections);
      } else {
        await preloadUserMapFromPostgres();
      }
    }
    if (!shouldRun("cards", options)) {
      await preloadCardMapFromPostgres();
    }
    if (!shouldRun("vouchers", options)) {
      if (options.dryRun) {
        await preloadVoucherMapFromMongoForDryRun(db, collections);
      } else {
        await preloadVoucherMapFromPostgres();
      }
    }
    if (!shouldRun("groups", options)) {
      if (options.dryRun) {
        await preloadGroupMapFromMongoForDryRun(db, collections);
      } else {
        await preloadGroupMapFromPostgres();
      }
    }
    if (!shouldRun("groupsessions", options)) {
      if (options.dryRun) {
        await preloadGroupSessionMapFromMongoForDryRun(db, collections);
      } else {
        await preloadGroupSessionMapFromPostgres();
      }
    }
    if (!shouldRun("business_promotions", options)) {
      if (options.dryRun) {
        await preloadPromotionCardMapFromMongoForDryRun(db, collections);
      } else {
        await preloadPromotionCardMapFromPostgres();
      }
    }

    await migrateUsers(db, collections, options);
    await migrateProfiles(db, collections, options);
    await migrateUserRoles(db, collections, options);
    await migrateCategories(db, collections, options);
    await migrateCards(db, collections, options);
    await migrateBusinessPromotions(db, collections, options);
    await migrateVouchers(db, collections, options);
    await migrateVoucherRedemptions(db, collections, options);
    await migrateVoucherTransferLogs(db, collections, options);
    await migrateContacts(db, collections, options);
    await migrateMessages(db, collections, options);
    await migrateGroups(db, collections, options);
    await migrateGroupSessions(db, collections, options);
    await migrateCardShares(db, collections, options);
    await migrateSharedCards(db, collections, options);
    await migrateGroupSharedCards(db, collections, options);
    await migrateChats(db, collections, options);
    await migrateFeedbacks(db, collections, options);
    await migrateReviews(db, collections, options);
    await migrateNotifications(db, collections, options);
    await migrateAds(db, collections, options);

    log.info("Migration completed.");
  } finally {
    await client.close();
    await prisma.$disconnect();
  }
};

migrate().catch((err) => {
  log.error(err?.message ?? String(err));
  process.exit(1);
});
