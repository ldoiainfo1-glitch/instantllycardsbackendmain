-- CreateEnum
CREATE TYPE "Role" AS ENUM ('customer', 'business', 'admin');

-- CreateEnum
CREATE TYPE "BookingMode" AS ENUM ('visit', 'call', 'video');

-- CreateEnum
CREATE TYPE "BookingStatus" AS ENUM ('pending', 'confirmed', 'completed', 'cancelled');

-- CreateEnum
CREATE TYPE "AdType" AS ENUM ('banner', 'featured', 'inline');

-- CreateEnum
CREATE TYPE "LeadStatus" AS ENUM ('new', 'contacted', 'converted', 'stale');

-- CreateEnum
CREATE TYPE "Severity" AS ENUM ('critical', 'medium', 'low');

-- CreateEnum
CREATE TYPE "InviteStatus" AS ENUM ('pending', 'accepted', 'expired');

-- CreateEnum
CREATE TYPE "MessageType" AS ENUM ('text', 'image', 'file', 'location');

-- CreateTable
CREATE TABLE "User" (
    "id" SERIAL NOT NULL,
    "legacy_id" TEXT,
    "email" TEXT,
    "phone" TEXT NOT NULL,
    "password_hash" TEXT,
    "name" TEXT,
    "profile_picture" TEXT,
    "about" TEXT,
    "gender" TEXT,
    "birthdate" TIMESTAMP(3),
    "anniversary" TIMESTAMP(3),
    "push_token" TEXT,
    "platform" TEXT,
    "push_token_updated_at" TIMESTAMP(3),
    "credits" INTEGER DEFAULT 0,
    "credits_expiry_date" TIMESTAMP(3),
    "referral_code" TEXT,
    "referred_by_id" INTEGER,
    "service_type" TEXT,
    "quiz_progress" JSONB,
    "parent_id" INTEGER,
    "level" INTEGER NOT NULL DEFAULT 0,
    "direct_count" INTEGER NOT NULL DEFAULT 0,
    "downline_count" INTEGER NOT NULL DEFAULT 0,
    "special_credits" JSONB,
    "is_voucher_admin" BOOLEAN NOT NULL DEFAULT false,
    "voucher_balance" INTEGER NOT NULL DEFAULT 0,
    "voucher_balances" JSONB,
    "ancestors" JSONB,
    "needs_email" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Profile" (
    "id" SERIAL NOT NULL,
    "legacy_id" TEXT,
    "user_id" INTEGER NOT NULL,
    "full_name" TEXT,
    "phone" TEXT,
    "avatar_url" TEXT,
    "location" TEXT,
    "bio" TEXT,

    CONSTRAINT "Profile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserRole" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "role" "Role" NOT NULL,

    CONSTRAINT "UserRole_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BusinessCard" (
    "id" SERIAL NOT NULL,
    "legacy_id" TEXT,
    "user_id" INTEGER NOT NULL,
    "full_name" TEXT NOT NULL,
    "gender" TEXT,
    "birthdate" TIMESTAMP(3),
    "anniversary" TIMESTAMP(3),
    "personal_country_code" TEXT,
    "personal_phone" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "company_name" TEXT,
    "job_title" TEXT,
    "logo_url" TEXT,
    "description" TEXT,
    "category" TEXT,
    "services" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "services_offered" TEXT,
    "instagram" TEXT,
    "facebook" TEXT,
    "linkedin" TEXT,
    "youtube" TEXT,
    "twitter" TEXT,
    "whatsapp" TEXT,
    "telegram" TEXT,
    "website" TEXT,
    "business_hours" TEXT,
    "location" TEXT,
    "maps_link" TEXT,
    "company_country_code" TEXT,
    "company_phone" TEXT,
    "company_email" TEXT,
    "company_website" TEXT,
    "company_address" TEXT,
    "company_maps_link" TEXT,
    "message" TEXT,
    "company_photo" TEXT,
    "about_business" TEXT,
    "offer" TEXT,
    "keywords" TEXT,
    "established_year" TEXT,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BusinessCard_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Booking" (
    "id" SERIAL NOT NULL,
    "legacy_id" TEXT,
    "user_id" INTEGER NOT NULL,
    "business_id" INTEGER NOT NULL,
    "business_name" TEXT NOT NULL,
    "mode" "BookingMode" NOT NULL,
    "booking_date" TIMESTAMP(3) NOT NULL,
    "booking_time" TEXT NOT NULL,
    "customer_name" TEXT NOT NULL,
    "customer_phone" TEXT NOT NULL,
    "notes" TEXT,
    "status" "BookingStatus" NOT NULL DEFAULT 'pending',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Booking_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Review" (
    "id" SERIAL NOT NULL,
    "legacy_id" TEXT,
    "user_id" INTEGER NOT NULL,
    "business_id" INTEGER NOT NULL,
    "rating" INTEGER NOT NULL,
    "comment" TEXT,
    "photo_url" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Review_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Voucher" (
    "id" SERIAL NOT NULL,
    "legacy_id" TEXT,
    "business_id" INTEGER,
    "business_name" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "discount_type" TEXT NOT NULL,
    "discount_value" DOUBLE PRECISION NOT NULL,
    "code" TEXT,
    "max_claims" INTEGER,
    "claimed_count" INTEGER NOT NULL DEFAULT 0,
    "expires_at" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "owner_user_id" INTEGER,
    "original_owner_id" INTEGER,
    "voucher_number" TEXT,
    "mrp" DOUBLE PRECISION,
    "issue_date" TIMESTAMP(3),
    "expiry_date" TIMESTAMP(3),
    "redeemed_status" TEXT,
    "voucher_images" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "product_video_link" TEXT,
    "redeemed_at" TIMESTAMP(3),
    "max_uses" INTEGER,
    "remaining_uses" INTEGER,
    "company_logo" TEXT,
    "company_name" TEXT,
    "phone_number" TEXT,
    "address" TEXT,
    "amount" DOUBLE PRECISION,
    "discount_percentage" DOUBLE PRECISION,
    "validity" TEXT,
    "voucher_image" TEXT,
    "min_vouchers_required" INTEGER,
    "template_id" INTEGER,
    "is_published" BOOLEAN,
    "published_at" TIMESTAMP(3),
    "created_by_admin_id" INTEGER,
    "source" TEXT,
    "transferred_from_id" INTEGER,
    "transferred_at" TIMESTAMP(3),

    CONSTRAINT "Voucher_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VoucherClaim" (
    "id" SERIAL NOT NULL,
    "legacy_id" TEXT,
    "voucher_id" INTEGER NOT NULL,
    "user_id" INTEGER NOT NULL,
    "claimed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "redeemed_at" TIMESTAMP(3),

    CONSTRAINT "VoucherClaim_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VoucherTransfer" (
    "id" SERIAL NOT NULL,
    "legacy_id" TEXT,
    "voucher_id" INTEGER NOT NULL,
    "sender_id" INTEGER NOT NULL,
    "recipient_id" INTEGER NOT NULL,
    "sender_phone" TEXT NOT NULL,
    "recipient_phone" TEXT NOT NULL,
    "transferred_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VoucherTransfer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Event" (
    "id" SERIAL NOT NULL,
    "legacy_id" TEXT,
    "business_id" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "date" TIMESTAMP(3) NOT NULL,
    "time" TEXT NOT NULL,
    "location" TEXT,
    "image_url" TEXT,
    "ticket_price" DOUBLE PRECISION,
    "max_attendees" INTEGER,
    "attendee_count" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Event_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EventRegistration" (
    "id" SERIAL NOT NULL,
    "legacy_id" TEXT,
    "event_id" INTEGER NOT NULL,
    "user_id" INTEGER NOT NULL,
    "ticket_count" INTEGER NOT NULL DEFAULT 1,
    "registered_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EventRegistration_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" SERIAL NOT NULL,
    "legacy_id" TEXT,
    "user_id" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "type" TEXT,
    "is_read" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Message" (
    "id" SERIAL NOT NULL,
    "legacy_id" TEXT,
    "sender_id" INTEGER NOT NULL,
    "receiver_id" INTEGER,
    "chat_id" INTEGER,
    "group_id" INTEGER,
    "content" TEXT NOT NULL,
    "message_type" "MessageType" NOT NULL DEFAULT 'text',
    "is_read" BOOLEAN NOT NULL DEFAULT false,
    "read_at" TIMESTAMP(3),
    "is_delivered" BOOLEAN NOT NULL DEFAULT false,
    "delivered_at" TIMESTAMP(3),
    "is_pending_delivery" BOOLEAN NOT NULL DEFAULT false,
    "local_message_id" TEXT,
    "conversation_id" TEXT,
    "metadata" JSONB,
    "is_deleted" BOOLEAN NOT NULL DEFAULT false,
    "deleted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Message_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Favorite" (
    "id" SERIAL NOT NULL,
    "legacy_id" TEXT,
    "user_id" INTEGER NOT NULL,
    "card_id" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Favorite_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Ad" (
    "id" SERIAL NOT NULL,
    "legacy_id" TEXT,
    "business_id" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "image_url" TEXT,
    "cta_url" TEXT,
    "ad_type" "AdType" NOT NULL,
    "budget" DOUBLE PRECISION,
    "spent" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "impressions" INTEGER NOT NULL DEFAULT 0,
    "clicks" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'active',
    "start_date" TIMESTAMP(3),
    "end_date" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "bottom_image" TEXT,
    "bottom_image_gridfs" TEXT,
    "fullscreen_image" TEXT,
    "fullscreen_image_gridfs" TEXT,
    "bottom_media_type" TEXT,
    "fullscreen_media_type" TEXT,
    "bottom_video_url" TEXT,
    "fullscreen_video_url" TEXT,
    "bottom_image_s3_url" TEXT,
    "bottom_image_s3_key" TEXT,
    "fullscreen_image_s3_url" TEXT,
    "fullscreen_image_s3_key" TEXT,
    "bottom_video_s3_url" TEXT,
    "bottom_video_s3_key" TEXT,
    "fullscreen_video_s3_url" TEXT,
    "fullscreen_video_s3_key" TEXT,
    "bottom_video" TEXT,
    "bottom_video_gridfs" TEXT,
    "fullscreen_video" TEXT,
    "fullscreen_video_gridfs" TEXT,
    "ad_type_legacy" TEXT,
    "phone_number" TEXT,
    "priority" INTEGER DEFAULT 5,
    "approval_status" TEXT,
    "uploaded_by" TEXT,
    "uploader_name" TEXT,
    "approved_by" TEXT,
    "approval_date" TIMESTAMP(3),
    "rejection_reason" TEXT,
    "payment_status" TEXT,
    "payment_order_id" INTEGER,

    CONSTRAINT "Ad_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdImpression" (
    "id" SERIAL NOT NULL,
    "legacy_id" TEXT,
    "ad_id" INTEGER NOT NULL,
    "user_id" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AdImpression_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdClick" (
    "id" SERIAL NOT NULL,
    "legacy_id" TEXT,
    "ad_id" INTEGER NOT NULL,
    "user_id" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AdClick_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Lead" (
    "id" SERIAL NOT NULL,
    "legacy_id" TEXT,
    "business_id" INTEGER NOT NULL,
    "customer_name" TEXT NOT NULL,
    "customer_phone" TEXT,
    "customer_email" TEXT,
    "message" TEXT,
    "status" "LeadStatus" NOT NULL DEFAULT 'new',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Lead_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LoyaltyPoint" (
    "id" SERIAL NOT NULL,
    "legacy_id" TEXT,
    "user_id" INTEGER NOT NULL,
    "points" INTEGER NOT NULL,
    "action" TEXT NOT NULL,
    "description" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LoyaltyPoint_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Referral" (
    "id" SERIAL NOT NULL,
    "legacy_id" TEXT,
    "referrer_id" INTEGER NOT NULL,
    "referred_id" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "reward_given" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Referral_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Campaign" (
    "id" SERIAL NOT NULL,
    "legacy_id" TEXT,
    "admin_id" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT,
    "campaign_type" TEXT,
    "target_audience" TEXT,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "sent_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Campaign_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ActivityLog" (
    "id" SERIAL NOT NULL,
    "legacy_id" TEXT,
    "event_type" TEXT NOT NULL,
    "entity_type" TEXT,
    "entity_id" INTEGER,
    "metadata" JSONB,
    "admin_id" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ActivityLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdminAlert" (
    "id" SERIAL NOT NULL,
    "legacy_id" TEXT,
    "alert_type" TEXT NOT NULL,
    "severity" "Severity" NOT NULL,
    "title" TEXT NOT NULL,
    "message" TEXT,
    "entity_id" INTEGER,
    "is_resolved" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AdminAlert_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdminMetricDaily" (
    "id" SERIAL NOT NULL,
    "metric_date" TIMESTAMP(3) NOT NULL,
    "total_users" INTEGER NOT NULL DEFAULT 0,
    "total_businesses" INTEGER NOT NULL DEFAULT 0,
    "total_bookings" INTEGER NOT NULL DEFAULT 0,
    "total_revenue" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "pending_approvals" INTEGER NOT NULL DEFAULT 0,
    "active_ads" INTEGER NOT NULL DEFAULT 0,
    "new_signups_7d" INTEGER NOT NULL DEFAULT 0,
    "computed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AdminMetricDaily_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SpamFlag" (
    "id" SERIAL NOT NULL,
    "legacy_id" TEXT,
    "flag_type" TEXT NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" INTEGER NOT NULL,
    "reason" TEXT,
    "is_resolved" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SpamFlag_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SyncedContact" (
    "id" SERIAL NOT NULL,
    "legacy_id" TEXT,
    "user_id" INTEGER NOT NULL,
    "phone_number" TEXT NOT NULL,
    "contact_name" TEXT,
    "is_app_user" BOOLEAN NOT NULL DEFAULT false,
    "app_user_id" INTEGER,
    "last_synced" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SyncedContact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CardAnalytic" (
    "id" SERIAL NOT NULL,
    "legacy_id" TEXT,
    "card_id" INTEGER NOT NULL,
    "views" INTEGER NOT NULL DEFAULT 0,
    "shares" INTEGER NOT NULL DEFAULT 0,
    "saves" INTEGER NOT NULL DEFAULT 0,
    "whatsapp_clicks" INTEGER NOT NULL DEFAULT 0,
    "call_clicks" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CardAnalytic_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BusinessLocation" (
    "id" SERIAL NOT NULL,
    "legacy_id" TEXT,
    "business_id" INTEGER NOT NULL,
    "label" TEXT,
    "address" TEXT NOT NULL,
    "lat" DOUBLE PRECISION,
    "lng" DOUBLE PRECISION,
    "is_primary" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "BusinessLocation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BusinessStaff" (
    "id" SERIAL NOT NULL,
    "legacy_id" TEXT,
    "business_id" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "role" TEXT,
    "phone" TEXT,
    "email" TEXT,

    CONSTRAINT "BusinessStaff_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BusinessPhoto" (
    "id" SERIAL NOT NULL,
    "legacy_id" TEXT,
    "business_id" INTEGER NOT NULL,
    "photo_url" TEXT NOT NULL,
    "caption" TEXT,
    "sort_order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "BusinessPhoto_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdminPermission" (
    "id" SERIAL NOT NULL,
    "legacy_id" TEXT,
    "admin_user_id" INTEGER NOT NULL,
    "permission_category" TEXT NOT NULL,
    "can_view" BOOLEAN NOT NULL DEFAULT false,
    "can_edit" BOOLEAN NOT NULL DEFAULT false,
    "can_delete" BOOLEAN NOT NULL DEFAULT false,
    "can_approve" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "AdminPermission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdminAccessInvite" (
    "id" SERIAL NOT NULL,
    "legacy_id" TEXT,
    "invited_email" TEXT NOT NULL,
    "access_level" TEXT NOT NULL,
    "invited_by" INTEGER NOT NULL,
    "status" "InviteStatus" NOT NULL DEFAULT 'pending',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AdminAccessInvite_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Category" (
    "id" SERIAL NOT NULL,
    "legacy_id" TEXT,
    "name" TEXT NOT NULL,
    "icon" TEXT,
    "parent_id" INTEGER,
    "level" INTEGER NOT NULL DEFAULT 0,
    "subcategories" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Category_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BusinessCardCategory" (
    "id" SERIAL NOT NULL,
    "business_card_id" INTEGER NOT NULL,
    "category_id" INTEGER NOT NULL,

    CONSTRAINT "BusinessCardCategory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BusinessCardPhone" (
    "id" SERIAL NOT NULL,
    "business_card_id" INTEGER NOT NULL,
    "country_code" TEXT,
    "phone" TEXT,

    CONSTRAINT "BusinessCardPhone_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Contact" (
    "id" SERIAL NOT NULL,
    "legacy_id" TEXT,
    "user_id" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "phone_number" TEXT NOT NULL,
    "is_app_user" BOOLEAN NOT NULL DEFAULT false,
    "app_user_id" INTEGER,
    "last_synced" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Contact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Chat" (
    "id" SERIAL NOT NULL,
    "legacy_id" TEXT,
    "is_group" BOOLEAN NOT NULL DEFAULT false,
    "group_id" INTEGER,
    "last_message_id" INTEGER,
    "last_message_time" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Chat_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChatParticipant" (
    "id" SERIAL NOT NULL,
    "chat_id" INTEGER NOT NULL,
    "user_id" INTEGER NOT NULL,
    "unread_count" INTEGER NOT NULL DEFAULT 0,
    "is_muted" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ChatParticipant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Group" (
    "id" SERIAL NOT NULL,
    "legacy_id" TEXT,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "icon" TEXT,
    "admin_id" INTEGER NOT NULL,
    "join_code" TEXT,
    "last_message_id" INTEGER,
    "last_message_time" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Group_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GroupMember" (
    "id" SERIAL NOT NULL,
    "group_id" INTEGER NOT NULL,
    "user_id" INTEGER NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'member',
    "is_muted" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GroupMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GroupCall" (
    "id" SERIAL NOT NULL,
    "legacy_id" TEXT,
    "call_id" TEXT NOT NULL,
    "group_id" INTEGER NOT NULL,
    "initiator_id" INTEGER NOT NULL,
    "call_type" TEXT NOT NULL DEFAULT 'audio',
    "start_time" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "end_time" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'ringing',
    "duration" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GroupCall_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GroupCallParticipant" (
    "id" SERIAL NOT NULL,
    "group_call_id" INTEGER NOT NULL,
    "user_id" INTEGER NOT NULL,
    "joined_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "left_at" TIMESTAMP(3),
    "is_initiator" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "GroupCallParticipant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GroupSession" (
    "id" SERIAL NOT NULL,
    "legacy_id" TEXT,
    "code" TEXT NOT NULL,
    "admin_id" TEXT NOT NULL,
    "admin_name" TEXT NOT NULL,
    "admin_phone" TEXT NOT NULL,
    "admin_photo" TEXT,
    "status" TEXT NOT NULL DEFAULT 'waiting',
    "allow_participant_sharing" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "GroupSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GroupSessionParticipant" (
    "id" SERIAL NOT NULL,
    "group_session_id" INTEGER NOT NULL,
    "user_id" TEXT NOT NULL,
    "user_name" TEXT NOT NULL,
    "user_phone" TEXT NOT NULL,
    "photo" TEXT,
    "joined_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "cards_to_share" JSONB,
    "default_card_legacy_id" TEXT,
    "is_online" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "GroupSessionParticipant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CardShare" (
    "id" SERIAL NOT NULL,
    "legacy_id" TEXT,
    "session_id" INTEGER NOT NULL,
    "from_user_id" TEXT NOT NULL,
    "to_user_id" TEXT NOT NULL,
    "card_id" INTEGER,
    "shared_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CardShare_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SharedCard" (
    "id" SERIAL NOT NULL,
    "legacy_id" TEXT,
    "card_id" INTEGER NOT NULL,
    "sender_id" TEXT NOT NULL,
    "recipient_id" TEXT NOT NULL,
    "message" TEXT,
    "status" TEXT NOT NULL DEFAULT 'sent',
    "sent_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "viewed_at" TIMESTAMP(3),
    "card_title" TEXT NOT NULL,
    "sender_name" TEXT NOT NULL,
    "recipient_name" TEXT NOT NULL,
    "card_photo" TEXT,
    "sender_profile_picture" TEXT,
    "recipient_profile_picture" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SharedCard_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GroupSharedCard" (
    "id" SERIAL NOT NULL,
    "legacy_id" TEXT,
    "card_id" INTEGER NOT NULL,
    "sender_id" TEXT NOT NULL,
    "group_id" INTEGER NOT NULL,
    "message" TEXT,
    "sent_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "card_title" TEXT NOT NULL,
    "sender_name" TEXT NOT NULL,
    "group_name" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GroupSharedCard_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BusinessPromotion" (
    "id" SERIAL NOT NULL,
    "legacy_id" TEXT,
    "user_id" INTEGER NOT NULL,
    "business_card_id" INTEGER,
    "business_name" TEXT NOT NULL,
    "owner_name" TEXT NOT NULL,
    "description" TEXT,
    "category" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "email" TEXT,
    "phone" TEXT,
    "whatsapp" TEXT,
    "website" TEXT,
    "business_hours" JSONB,
    "area" TEXT,
    "pincode" TEXT,
    "plot_no" TEXT,
    "building_name" TEXT,
    "street_name" TEXT,
    "landmark" TEXT,
    "city" TEXT,
    "state" TEXT,
    "gst_number" TEXT,
    "pan_number" TEXT,
    "listing_type" TEXT NOT NULL DEFAULT 'free',
    "listing_intent" TEXT NOT NULL DEFAULT 'free',
    "status" TEXT NOT NULL DEFAULT 'draft',
    "current_step" TEXT,
    "progress" INTEGER NOT NULL DEFAULT 0,
    "step_index" INTEGER NOT NULL DEFAULT 1,
    "plan_name" TEXT,
    "plan_price" DOUBLE PRECISION,
    "plan_duration_days" INTEGER,
    "plan_activated_at" TIMESTAMP(3),
    "payment_status" TEXT NOT NULL DEFAULT 'not_required',
    "payment_id" TEXT,
    "visibility_priority_score" INTEGER NOT NULL DEFAULT 10,
    "visibility_impressions" INTEGER NOT NULL DEFAULT 0,
    "visibility_clicks" INTEGER NOT NULL DEFAULT 0,
    "visibility_leads" INTEGER NOT NULL DEFAULT 0,
    "visibility_call_clicks" INTEGER NOT NULL DEFAULT 0,
    "visibility_whatsapp_clicks" INTEGER NOT NULL DEFAULT 0,
    "media" JSONB,
    "is_active" BOOLEAN NOT NULL DEFAULT false,
    "expiry_date" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BusinessPromotion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PromotionPricingPlan" (
    "id" SERIAL NOT NULL,
    "legacy_id" TEXT,
    "code" TEXT NOT NULL,
    "area_type" TEXT NOT NULL,
    "rank" INTEGER NOT NULL,
    "rank_label" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "duration_days" INTEGER NOT NULL DEFAULT 30,
    "priority_score" INTEGER NOT NULL DEFAULT 10,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PromotionPricingPlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PromotionOrder" (
    "id" SERIAL NOT NULL,
    "legacy_id" TEXT,
    "user_id" INTEGER NOT NULL,
    "business_promotion_id" INTEGER NOT NULL,
    "pricing_plan_id" INTEGER NOT NULL,
    "area_type" TEXT NOT NULL,
    "rank" INTEGER NOT NULL,
    "rank_label" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "voucher_id" INTEGER,
    "voucher_qty_applied" INTEGER NOT NULL DEFAULT 0,
    "voucher_value_per_unit" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "voucher_amount_applied" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "payable_amount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "voucher_status" TEXT NOT NULL DEFAULT 'none',
    "voucher_applied_at" TIMESTAMP(3),
    "voucher_released_at" TIMESTAMP(3),
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "duration_days" INTEGER NOT NULL,
    "priority_score" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'created',
    "payment_provider" TEXT,
    "payment_order_id" TEXT,
    "payment_id" TEXT,
    "paid_at" TIMESTAMP(3),
    "activated_at" TIMESTAMP(3),
    "expires_at" TIMESTAMP(3),
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PromotionOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdPaymentOrder" (
    "id" SERIAL NOT NULL,
    "legacy_id" TEXT,
    "user_id" INTEGER NOT NULL,
    "design_request_id" INTEGER,
    "ad_id" INTEGER,
    "order_type" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "payable_amount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "status" TEXT NOT NULL DEFAULT 'created',
    "payment_provider" TEXT,
    "payment_order_id" TEXT,
    "payment_id" TEXT,
    "paid_at" TIMESTAMP(3),
    "voucher_id" INTEGER,
    "voucher_qty_applied" INTEGER NOT NULL DEFAULT 0,
    "voucher_value_per_unit" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "voucher_amount_applied" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "voucher_status" TEXT NOT NULL DEFAULT 'none',
    "voucher_applied_at" TIMESTAMP(3),
    "voucher_released_at" TIMESTAMP(3),
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AdPaymentOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CustomService" (
    "id" SERIAL NOT NULL,
    "legacy_id" TEXT,
    "service_name" TEXT NOT NULL,
    "added_by" TEXT NOT NULL,
    "user_name" TEXT,
    "card_legacy_id" TEXT,
    "parent_category" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "approved_as" TEXT,
    "approved_category_name" TEXT,
    "approved_at" TIMESTAMP(3),
    "approved_by_admin" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CustomService_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CreditConfig" (
    "id" SERIAL NOT NULL,
    "legacy_id" TEXT,
    "signup_bonus" INTEGER NOT NULL DEFAULT 200,
    "referral_reward" INTEGER NOT NULL DEFAULT 300,
    "last_updated_by" TEXT,
    "last_updated_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CreditConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Enquiry" (
    "id" SERIAL NOT NULL,
    "legacy_id" TEXT,
    "business_promotion_id" INTEGER NOT NULL,
    "user_id" INTEGER NOT NULL,
    "user_phone" TEXT NOT NULL,
    "user_name" TEXT,
    "user_email" TEXT,
    "subject" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'new',
    "priority" TEXT NOT NULL DEFAULT 'low',
    "responses" JSONB,
    "last_response_at" TIMESTAMP(3),
    "last_responded_by" INTEGER,
    "assigned_to" INTEGER,
    "converted_to_lead" BOOLEAN NOT NULL DEFAULT false,
    "lead_value" DOUBLE PRECISION,
    "notification_sent" BOOLEAN NOT NULL DEFAULT false,
    "notification_sent_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Enquiry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Feedback" (
    "id" SERIAL NOT NULL,
    "legacy_id" TEXT,
    "user_id" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "email" TEXT,
    "subject" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "rating" INTEGER,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "admin_response" TEXT,
    "responded_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Feedback_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReviewSuggestion" (
    "id" SERIAL NOT NULL,
    "legacy_id" TEXT,
    "rating" INTEGER NOT NULL,
    "category" TEXT,
    "suggestions" JSONB,
    "prompt" TEXT,
    "emoji" TEXT,
    "label" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReviewSuggestion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserLocation" (
    "id" SERIAL NOT NULL,
    "legacy_id" TEXT,
    "user_id" INTEGER NOT NULL,
    "current_location" JSONB,
    "address" JSONB,
    "accuracy" DOUBLE PRECISION,
    "last_updated" TIMESTAMP(3),
    "radius" INTEGER DEFAULT 5000,
    "previous_locations" JSONB,
    "is_location_enabled" BOOLEAN NOT NULL DEFAULT true,
    "share_location_with" TEXT NOT NULL DEFAULT 'private',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserLocation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Transaction" (
    "id" SERIAL NOT NULL,
    "legacy_id" TEXT,
    "type" TEXT NOT NULL,
    "transaction_id" TEXT,
    "from_user_id" INTEGER,
    "to_user_id" INTEGER,
    "amount" DOUBLE PRECISION NOT NULL,
    "description" TEXT NOT NULL,
    "note" TEXT,
    "balance_before" DOUBLE PRECISION,
    "balance_after" DOUBLE PRECISION,
    "related_ad_id" INTEGER,
    "status" TEXT NOT NULL DEFAULT 'completed',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Transaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MlmWallet" (
    "id" SERIAL NOT NULL,
    "legacy_id" TEXT,
    "user_id" INTEGER NOT NULL,
    "credit_balance" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MlmWallet_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MlmCredit" (
    "id" SERIAL NOT NULL,
    "legacy_id" TEXT,
    "sender_id" INTEGER NOT NULL,
    "receiver_id" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "payment_status" TEXT NOT NULL DEFAULT 'pending',
    "payment_confirmed_by_receiver" BOOLEAN NOT NULL DEFAULT false,
    "payment_confirmed_at" TIMESTAMP(3),
    "admin_approved_by" INTEGER,
    "admin_approved_at" TIMESTAMP(3),
    "admin_note" TEXT,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "activated_at" TIMESTAMP(3),
    "transfer_expires_at" TIMESTAMP(3),
    "quantity" INTEGER NOT NULL DEFAULT 5,
    "transferred_count" INTEGER NOT NULL DEFAULT 0,
    "reverted_count" INTEGER NOT NULL DEFAULT 0,
    "source_credit_id" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MlmCredit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MlmTransfer" (
    "id" SERIAL NOT NULL,
    "legacy_id" TEXT,
    "sender_id" INTEGER NOT NULL,
    "receiver_id" INTEGER NOT NULL,
    "voucher_id" INTEGER,
    "source_slot_id" INTEGER,
    "amount" DOUBLE PRECISION NOT NULL,
    "slot_count" INTEGER NOT NULL DEFAULT 5,
    "slot_amount" DOUBLE PRECISION NOT NULL,
    "slots" JSONB,
    "required_voucher_count" INTEGER NOT NULL DEFAULT 5,
    "baseline_voucher_count" INTEGER NOT NULL DEFAULT 0,
    "current_voucher_count" INTEGER NOT NULL DEFAULT 0,
    "unlocked_slots" INTEGER NOT NULL DEFAULT 0,
    "timer_started_at" TIMESTAMP(3) NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "unlocked_at" TIMESTAMP(3),
    "returned_at" TIMESTAMP(3),
    "return_reason" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending_unlock',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MlmTransfer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SpecialCredit" (
    "id" SERIAL NOT NULL,
    "legacy_id" TEXT,
    "owner_id" INTEGER NOT NULL,
    "voucher_id" INTEGER,
    "slot_number" INTEGER NOT NULL,
    "credit_amount" DOUBLE PRECISION NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'available',
    "recipient_id" INTEGER,
    "recipient_name" TEXT,
    "recipient_phone" TEXT,
    "sent_at" TIMESTAMP(3),
    "expires_at" TIMESTAMP(3),
    "is_locked" BOOLEAN NOT NULL DEFAULT false,
    "lock_reason" TEXT,
    "lock_expires_at" TIMESTAMP(3),
    "unlocked_at" TIMESTAMP(3),
    "transfer_id" INTEGER,
    "source_slot_id" INTEGER,
    "level" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SpecialCredit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NetworkEvent" (
    "id" SERIAL NOT NULL,
    "legacy_id" TEXT,
    "user_id" INTEGER,
    "event_type" TEXT NOT NULL,
    "payload" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NetworkEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NetworkRules" (
    "id" SERIAL NOT NULL,
    "legacy_id" TEXT,
    "rules" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NetworkRules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SlotEvent" (
    "id" SERIAL NOT NULL,
    "legacy_id" TEXT,
    "user_id" INTEGER,
    "event_type" TEXT NOT NULL,
    "payload" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SlotEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TempMessage" (
    "id" SERIAL NOT NULL,
    "legacy_id" TEXT,
    "payload" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TempMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Designer" (
    "id" SERIAL NOT NULL,
    "legacy_id" TEXT,
    "username" TEXT NOT NULL,
    "password" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Designer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DesignRequest" (
    "id" SERIAL NOT NULL,
    "legacy_id" TEXT,
    "business_name" TEXT,
    "email" TEXT,
    "web_links" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "phone_number" TEXT,
    "ad_text" TEXT,
    "business_address" TEXT,
    "ad_type" TEXT NOT NULL,
    "channel_type" TEXT NOT NULL DEFAULT 'withoutChannel',
    "reference_images_gridfs" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "reference_videos_gridfs" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "reference_images_s3" JSONB,
    "reference_videos_s3" JSONB,
    "uploader_phone" TEXT NOT NULL,
    "uploader_name" TEXT,
    "user_legacy_id" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "admin_notes" TEXT,
    "assigned_designer_id" INTEGER,
    "assigned_designer_name" TEXT,
    "assigned_at" TIMESTAMP(3),
    "completed_ad_id" INTEGER,
    "payment_status" TEXT NOT NULL DEFAULT 'pending',
    "payment_order_id" INTEGER,
    "paid_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DesignRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DesignerUpload" (
    "id" SERIAL NOT NULL,
    "legacy_id" TEXT,
    "design_request_id" INTEGER NOT NULL,
    "designer_id" INTEGER NOT NULL,
    "designer_name" TEXT NOT NULL,
    "files_s3" JSONB,
    "notes" TEXT,
    "status" TEXT NOT NULL DEFAULT 'uploaded',
    "admin_notes" TEXT,
    "user_feedback" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DesignerUpload_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VoucherRedemption" (
    "id" SERIAL NOT NULL,
    "legacy_id" TEXT,
    "voucher_id" INTEGER NOT NULL,
    "used_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "used_by_id" INTEGER,

    CONSTRAINT "VoucherRedemption_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VoucherTransferLog" (
    "id" SERIAL NOT NULL,
    "legacy_id" TEXT,
    "voucher_id" INTEGER NOT NULL,
    "from_user_id" INTEGER,
    "to_user_id" INTEGER,
    "transferred_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VoucherTransferLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_legacy_id_key" ON "User"("legacy_id");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "User_phone_key" ON "User"("phone");

-- CreateIndex
CREATE UNIQUE INDEX "User_referral_code_key" ON "User"("referral_code");

-- CreateIndex
CREATE UNIQUE INDEX "Profile_legacy_id_key" ON "Profile"("legacy_id");

-- CreateIndex
CREATE UNIQUE INDEX "Profile_user_id_key" ON "Profile"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "BusinessCard_legacy_id_key" ON "BusinessCard"("legacy_id");

-- CreateIndex
CREATE UNIQUE INDEX "Booking_legacy_id_key" ON "Booking"("legacy_id");

-- CreateIndex
CREATE UNIQUE INDEX "Review_legacy_id_key" ON "Review"("legacy_id");

-- CreateIndex
CREATE UNIQUE INDEX "Voucher_legacy_id_key" ON "Voucher"("legacy_id");

-- CreateIndex
CREATE UNIQUE INDEX "Voucher_code_key" ON "Voucher"("code");

-- CreateIndex
CREATE UNIQUE INDEX "VoucherClaim_legacy_id_key" ON "VoucherClaim"("legacy_id");

-- CreateIndex
CREATE UNIQUE INDEX "VoucherTransfer_legacy_id_key" ON "VoucherTransfer"("legacy_id");

-- CreateIndex
CREATE UNIQUE INDEX "Event_legacy_id_key" ON "Event"("legacy_id");

-- CreateIndex
CREATE UNIQUE INDEX "EventRegistration_legacy_id_key" ON "EventRegistration"("legacy_id");

-- CreateIndex
CREATE UNIQUE INDEX "Notification_legacy_id_key" ON "Notification"("legacy_id");

-- CreateIndex
CREATE UNIQUE INDEX "Message_legacy_id_key" ON "Message"("legacy_id");

-- CreateIndex
CREATE UNIQUE INDEX "Favorite_legacy_id_key" ON "Favorite"("legacy_id");

-- CreateIndex
CREATE UNIQUE INDEX "Favorite_user_id_card_id_key" ON "Favorite"("user_id", "card_id");

-- CreateIndex
CREATE UNIQUE INDEX "Ad_legacy_id_key" ON "Ad"("legacy_id");

-- CreateIndex
CREATE UNIQUE INDEX "AdImpression_legacy_id_key" ON "AdImpression"("legacy_id");

-- CreateIndex
CREATE UNIQUE INDEX "AdClick_legacy_id_key" ON "AdClick"("legacy_id");

-- CreateIndex
CREATE UNIQUE INDEX "Lead_legacy_id_key" ON "Lead"("legacy_id");

-- CreateIndex
CREATE UNIQUE INDEX "LoyaltyPoint_legacy_id_key" ON "LoyaltyPoint"("legacy_id");

-- CreateIndex
CREATE UNIQUE INDEX "Referral_legacy_id_key" ON "Referral"("legacy_id");

-- CreateIndex
CREATE UNIQUE INDEX "Campaign_legacy_id_key" ON "Campaign"("legacy_id");

-- CreateIndex
CREATE UNIQUE INDEX "ActivityLog_legacy_id_key" ON "ActivityLog"("legacy_id");

-- CreateIndex
CREATE UNIQUE INDEX "AdminAlert_legacy_id_key" ON "AdminAlert"("legacy_id");

-- CreateIndex
CREATE UNIQUE INDEX "AdminMetricDaily_metric_date_key" ON "AdminMetricDaily"("metric_date");

-- CreateIndex
CREATE UNIQUE INDEX "SpamFlag_legacy_id_key" ON "SpamFlag"("legacy_id");

-- CreateIndex
CREATE UNIQUE INDEX "SyncedContact_legacy_id_key" ON "SyncedContact"("legacy_id");

-- CreateIndex
CREATE UNIQUE INDEX "SyncedContact_user_id_phone_number_key" ON "SyncedContact"("user_id", "phone_number");

-- CreateIndex
CREATE UNIQUE INDEX "CardAnalytic_legacy_id_key" ON "CardAnalytic"("legacy_id");

-- CreateIndex
CREATE UNIQUE INDEX "BusinessLocation_legacy_id_key" ON "BusinessLocation"("legacy_id");

-- CreateIndex
CREATE UNIQUE INDEX "BusinessStaff_legacy_id_key" ON "BusinessStaff"("legacy_id");

-- CreateIndex
CREATE UNIQUE INDEX "BusinessPhoto_legacy_id_key" ON "BusinessPhoto"("legacy_id");

-- CreateIndex
CREATE UNIQUE INDEX "AdminPermission_legacy_id_key" ON "AdminPermission"("legacy_id");

-- CreateIndex
CREATE UNIQUE INDEX "AdminAccessInvite_legacy_id_key" ON "AdminAccessInvite"("legacy_id");

-- CreateIndex
CREATE UNIQUE INDEX "Category_legacy_id_key" ON "Category"("legacy_id");

-- CreateIndex
CREATE UNIQUE INDEX "BusinessCardCategory_business_card_id_category_id_key" ON "BusinessCardCategory"("business_card_id", "category_id");

-- CreateIndex
CREATE UNIQUE INDEX "Contact_legacy_id_key" ON "Contact"("legacy_id");

-- CreateIndex
CREATE UNIQUE INDEX "Contact_user_id_phone_number_key" ON "Contact"("user_id", "phone_number");

-- CreateIndex
CREATE UNIQUE INDEX "Chat_legacy_id_key" ON "Chat"("legacy_id");

-- CreateIndex
CREATE UNIQUE INDEX "Chat_last_message_id_key" ON "Chat"("last_message_id");

-- CreateIndex
CREATE UNIQUE INDEX "ChatParticipant_chat_id_user_id_key" ON "ChatParticipant"("chat_id", "user_id");

-- CreateIndex
CREATE UNIQUE INDEX "Group_legacy_id_key" ON "Group"("legacy_id");

-- CreateIndex
CREATE UNIQUE INDEX "Group_join_code_key" ON "Group"("join_code");

-- CreateIndex
CREATE UNIQUE INDEX "Group_last_message_id_key" ON "Group"("last_message_id");

-- CreateIndex
CREATE UNIQUE INDEX "GroupMember_group_id_user_id_key" ON "GroupMember"("group_id", "user_id");

-- CreateIndex
CREATE UNIQUE INDEX "GroupCall_legacy_id_key" ON "GroupCall"("legacy_id");

-- CreateIndex
CREATE UNIQUE INDEX "GroupCall_call_id_key" ON "GroupCall"("call_id");

-- CreateIndex
CREATE UNIQUE INDEX "GroupSession_legacy_id_key" ON "GroupSession"("legacy_id");

-- CreateIndex
CREATE UNIQUE INDEX "GroupSession_code_key" ON "GroupSession"("code");

-- CreateIndex
CREATE UNIQUE INDEX "CardShare_legacy_id_key" ON "CardShare"("legacy_id");

-- CreateIndex
CREATE UNIQUE INDEX "SharedCard_legacy_id_key" ON "SharedCard"("legacy_id");

-- CreateIndex
CREATE UNIQUE INDEX "GroupSharedCard_legacy_id_key" ON "GroupSharedCard"("legacy_id");

-- CreateIndex
CREATE UNIQUE INDEX "BusinessPromotion_legacy_id_key" ON "BusinessPromotion"("legacy_id");

-- CreateIndex
CREATE UNIQUE INDEX "PromotionPricingPlan_legacy_id_key" ON "PromotionPricingPlan"("legacy_id");

-- CreateIndex
CREATE UNIQUE INDEX "PromotionPricingPlan_code_key" ON "PromotionPricingPlan"("code");

-- CreateIndex
CREATE UNIQUE INDEX "PromotionOrder_legacy_id_key" ON "PromotionOrder"("legacy_id");

-- CreateIndex
CREATE UNIQUE INDEX "AdPaymentOrder_legacy_id_key" ON "AdPaymentOrder"("legacy_id");

-- CreateIndex
CREATE UNIQUE INDEX "CustomService_legacy_id_key" ON "CustomService"("legacy_id");

-- CreateIndex
CREATE UNIQUE INDEX "CreditConfig_legacy_id_key" ON "CreditConfig"("legacy_id");

-- CreateIndex
CREATE UNIQUE INDEX "Enquiry_legacy_id_key" ON "Enquiry"("legacy_id");

-- CreateIndex
CREATE UNIQUE INDEX "Feedback_legacy_id_key" ON "Feedback"("legacy_id");

-- CreateIndex
CREATE UNIQUE INDEX "ReviewSuggestion_legacy_id_key" ON "ReviewSuggestion"("legacy_id");

-- CreateIndex
CREATE UNIQUE INDEX "UserLocation_legacy_id_key" ON "UserLocation"("legacy_id");

-- CreateIndex
CREATE UNIQUE INDEX "UserLocation_user_id_key" ON "UserLocation"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "Transaction_legacy_id_key" ON "Transaction"("legacy_id");

-- CreateIndex
CREATE UNIQUE INDEX "MlmWallet_legacy_id_key" ON "MlmWallet"("legacy_id");

-- CreateIndex
CREATE UNIQUE INDEX "MlmWallet_user_id_key" ON "MlmWallet"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "MlmCredit_legacy_id_key" ON "MlmCredit"("legacy_id");

-- CreateIndex
CREATE UNIQUE INDEX "MlmTransfer_legacy_id_key" ON "MlmTransfer"("legacy_id");

-- CreateIndex
CREATE UNIQUE INDEX "SpecialCredit_legacy_id_key" ON "SpecialCredit"("legacy_id");

-- CreateIndex
CREATE UNIQUE INDEX "NetworkEvent_legacy_id_key" ON "NetworkEvent"("legacy_id");

-- CreateIndex
CREATE UNIQUE INDEX "NetworkRules_legacy_id_key" ON "NetworkRules"("legacy_id");

-- CreateIndex
CREATE UNIQUE INDEX "SlotEvent_legacy_id_key" ON "SlotEvent"("legacy_id");

-- CreateIndex
CREATE UNIQUE INDEX "TempMessage_legacy_id_key" ON "TempMessage"("legacy_id");

-- CreateIndex
CREATE UNIQUE INDEX "Designer_legacy_id_key" ON "Designer"("legacy_id");

-- CreateIndex
CREATE UNIQUE INDEX "Designer_username_key" ON "Designer"("username");

-- CreateIndex
CREATE UNIQUE INDEX "DesignRequest_legacy_id_key" ON "DesignRequest"("legacy_id");

-- CreateIndex
CREATE UNIQUE INDEX "DesignerUpload_legacy_id_key" ON "DesignerUpload"("legacy_id");

-- CreateIndex
CREATE UNIQUE INDEX "VoucherRedemption_legacy_id_key" ON "VoucherRedemption"("legacy_id");

-- CreateIndex
CREATE UNIQUE INDEX "VoucherTransferLog_legacy_id_key" ON "VoucherTransferLog"("legacy_id");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_referred_by_id_fkey" FOREIGN KEY ("referred_by_id") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Profile" ADD CONSTRAINT "Profile_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserRole" ADD CONSTRAINT "UserRole_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BusinessCard" ADD CONSTRAINT "BusinessCard_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Booking" ADD CONSTRAINT "Booking_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Booking" ADD CONSTRAINT "Booking_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "BusinessCard"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Review" ADD CONSTRAINT "Review_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Review" ADD CONSTRAINT "Review_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "BusinessCard"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Voucher" ADD CONSTRAINT "Voucher_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "BusinessCard"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Voucher" ADD CONSTRAINT "Voucher_owner_user_id_fkey" FOREIGN KEY ("owner_user_id") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Voucher" ADD CONSTRAINT "Voucher_original_owner_id_fkey" FOREIGN KEY ("original_owner_id") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Voucher" ADD CONSTRAINT "Voucher_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "Voucher"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Voucher" ADD CONSTRAINT "Voucher_created_by_admin_id_fkey" FOREIGN KEY ("created_by_admin_id") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Voucher" ADD CONSTRAINT "Voucher_transferred_from_id_fkey" FOREIGN KEY ("transferred_from_id") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VoucherClaim" ADD CONSTRAINT "VoucherClaim_voucher_id_fkey" FOREIGN KEY ("voucher_id") REFERENCES "Voucher"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VoucherClaim" ADD CONSTRAINT "VoucherClaim_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VoucherTransfer" ADD CONSTRAINT "VoucherTransfer_voucher_id_fkey" FOREIGN KEY ("voucher_id") REFERENCES "Voucher"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VoucherTransfer" ADD CONSTRAINT "VoucherTransfer_sender_id_fkey" FOREIGN KEY ("sender_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VoucherTransfer" ADD CONSTRAINT "VoucherTransfer_recipient_id_fkey" FOREIGN KEY ("recipient_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Event" ADD CONSTRAINT "Event_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "BusinessCard"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventRegistration" ADD CONSTRAINT "EventRegistration_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventRegistration" ADD CONSTRAINT "EventRegistration_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_sender_id_fkey" FOREIGN KEY ("sender_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_receiver_id_fkey" FOREIGN KEY ("receiver_id") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_chat_id_fkey" FOREIGN KEY ("chat_id") REFERENCES "Chat"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "Group"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Favorite" ADD CONSTRAINT "Favorite_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Favorite" ADD CONSTRAINT "Favorite_card_id_fkey" FOREIGN KEY ("card_id") REFERENCES "BusinessCard"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Ad" ADD CONSTRAINT "Ad_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "BusinessCard"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdImpression" ADD CONSTRAINT "AdImpression_ad_id_fkey" FOREIGN KEY ("ad_id") REFERENCES "Ad"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdImpression" ADD CONSTRAINT "AdImpression_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdClick" ADD CONSTRAINT "AdClick_ad_id_fkey" FOREIGN KEY ("ad_id") REFERENCES "Ad"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdClick" ADD CONSTRAINT "AdClick_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Lead" ADD CONSTRAINT "Lead_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "BusinessCard"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LoyaltyPoint" ADD CONSTRAINT "LoyaltyPoint_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Referral" ADD CONSTRAINT "Referral_referrer_id_fkey" FOREIGN KEY ("referrer_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Referral" ADD CONSTRAINT "Referral_referred_id_fkey" FOREIGN KEY ("referred_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Campaign" ADD CONSTRAINT "Campaign_admin_id_fkey" FOREIGN KEY ("admin_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActivityLog" ADD CONSTRAINT "ActivityLog_admin_id_fkey" FOREIGN KEY ("admin_id") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SyncedContact" ADD CONSTRAINT "SyncedContact_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SyncedContact" ADD CONSTRAINT "SyncedContact_app_user_id_fkey" FOREIGN KEY ("app_user_id") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CardAnalytic" ADD CONSTRAINT "CardAnalytic_card_id_fkey" FOREIGN KEY ("card_id") REFERENCES "BusinessCard"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BusinessLocation" ADD CONSTRAINT "BusinessLocation_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "BusinessCard"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BusinessStaff" ADD CONSTRAINT "BusinessStaff_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "BusinessCard"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BusinessPhoto" ADD CONSTRAINT "BusinessPhoto_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "BusinessCard"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdminPermission" ADD CONSTRAINT "AdminPermission_admin_user_id_fkey" FOREIGN KEY ("admin_user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdminAccessInvite" ADD CONSTRAINT "AdminAccessInvite_invited_by_fkey" FOREIGN KEY ("invited_by") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Category" ADD CONSTRAINT "Category_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "Category"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BusinessCardCategory" ADD CONSTRAINT "BusinessCardCategory_business_card_id_fkey" FOREIGN KEY ("business_card_id") REFERENCES "BusinessCard"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BusinessCardCategory" ADD CONSTRAINT "BusinessCardCategory_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "Category"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BusinessCardPhone" ADD CONSTRAINT "BusinessCardPhone_business_card_id_fkey" FOREIGN KEY ("business_card_id") REFERENCES "BusinessCard"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Contact" ADD CONSTRAINT "Contact_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Contact" ADD CONSTRAINT "Contact_app_user_id_fkey" FOREIGN KEY ("app_user_id") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Chat" ADD CONSTRAINT "Chat_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "Group"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Chat" ADD CONSTRAINT "Chat_last_message_id_fkey" FOREIGN KEY ("last_message_id") REFERENCES "Message"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChatParticipant" ADD CONSTRAINT "ChatParticipant_chat_id_fkey" FOREIGN KEY ("chat_id") REFERENCES "Chat"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChatParticipant" ADD CONSTRAINT "ChatParticipant_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Group" ADD CONSTRAINT "Group_admin_id_fkey" FOREIGN KEY ("admin_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Group" ADD CONSTRAINT "Group_last_message_id_fkey" FOREIGN KEY ("last_message_id") REFERENCES "Message"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GroupMember" ADD CONSTRAINT "GroupMember_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "Group"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GroupMember" ADD CONSTRAINT "GroupMember_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GroupCall" ADD CONSTRAINT "GroupCall_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "Group"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GroupCall" ADD CONSTRAINT "GroupCall_initiator_id_fkey" FOREIGN KEY ("initiator_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GroupCallParticipant" ADD CONSTRAINT "GroupCallParticipant_group_call_id_fkey" FOREIGN KEY ("group_call_id") REFERENCES "GroupCall"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GroupCallParticipant" ADD CONSTRAINT "GroupCallParticipant_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GroupSessionParticipant" ADD CONSTRAINT "GroupSessionParticipant_group_session_id_fkey" FOREIGN KEY ("group_session_id") REFERENCES "GroupSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CardShare" ADD CONSTRAINT "CardShare_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "GroupSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CardShare" ADD CONSTRAINT "CardShare_card_id_fkey" FOREIGN KEY ("card_id") REFERENCES "BusinessCard"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SharedCard" ADD CONSTRAINT "SharedCard_card_id_fkey" FOREIGN KEY ("card_id") REFERENCES "BusinessCard"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GroupSharedCard" ADD CONSTRAINT "GroupSharedCard_card_id_fkey" FOREIGN KEY ("card_id") REFERENCES "BusinessCard"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GroupSharedCard" ADD CONSTRAINT "GroupSharedCard_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "Group"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BusinessPromotion" ADD CONSTRAINT "BusinessPromotion_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BusinessPromotion" ADD CONSTRAINT "BusinessPromotion_business_card_id_fkey" FOREIGN KEY ("business_card_id") REFERENCES "BusinessCard"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PromotionOrder" ADD CONSTRAINT "PromotionOrder_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PromotionOrder" ADD CONSTRAINT "PromotionOrder_business_promotion_id_fkey" FOREIGN KEY ("business_promotion_id") REFERENCES "BusinessPromotion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PromotionOrder" ADD CONSTRAINT "PromotionOrder_pricing_plan_id_fkey" FOREIGN KEY ("pricing_plan_id") REFERENCES "PromotionPricingPlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PromotionOrder" ADD CONSTRAINT "PromotionOrder_voucher_id_fkey" FOREIGN KEY ("voucher_id") REFERENCES "Voucher"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdPaymentOrder" ADD CONSTRAINT "AdPaymentOrder_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdPaymentOrder" ADD CONSTRAINT "AdPaymentOrder_design_request_id_fkey" FOREIGN KEY ("design_request_id") REFERENCES "DesignRequest"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdPaymentOrder" ADD CONSTRAINT "AdPaymentOrder_ad_id_fkey" FOREIGN KEY ("ad_id") REFERENCES "Ad"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdPaymentOrder" ADD CONSTRAINT "AdPaymentOrder_voucher_id_fkey" FOREIGN KEY ("voucher_id") REFERENCES "Voucher"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Enquiry" ADD CONSTRAINT "Enquiry_business_promotion_id_fkey" FOREIGN KEY ("business_promotion_id") REFERENCES "BusinessPromotion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Enquiry" ADD CONSTRAINT "Enquiry_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Feedback" ADD CONSTRAINT "Feedback_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserLocation" ADD CONSTRAINT "UserLocation_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_from_user_id_fkey" FOREIGN KEY ("from_user_id") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_to_user_id_fkey" FOREIGN KEY ("to_user_id") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_related_ad_id_fkey" FOREIGN KEY ("related_ad_id") REFERENCES "Ad"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MlmWallet" ADD CONSTRAINT "MlmWallet_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MlmCredit" ADD CONSTRAINT "MlmCredit_sender_id_fkey" FOREIGN KEY ("sender_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MlmCredit" ADD CONSTRAINT "MlmCredit_receiver_id_fkey" FOREIGN KEY ("receiver_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MlmCredit" ADD CONSTRAINT "MlmCredit_source_credit_id_fkey" FOREIGN KEY ("source_credit_id") REFERENCES "MlmCredit"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MlmTransfer" ADD CONSTRAINT "MlmTransfer_sender_id_fkey" FOREIGN KEY ("sender_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MlmTransfer" ADD CONSTRAINT "MlmTransfer_receiver_id_fkey" FOREIGN KEY ("receiver_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MlmTransfer" ADD CONSTRAINT "MlmTransfer_voucher_id_fkey" FOREIGN KEY ("voucher_id") REFERENCES "Voucher"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MlmTransfer" ADD CONSTRAINT "MlmTransfer_source_slot_id_fkey" FOREIGN KEY ("source_slot_id") REFERENCES "SpecialCredit"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SpecialCredit" ADD CONSTRAINT "SpecialCredit_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SpecialCredit" ADD CONSTRAINT "SpecialCredit_voucher_id_fkey" FOREIGN KEY ("voucher_id") REFERENCES "Voucher"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SpecialCredit" ADD CONSTRAINT "SpecialCredit_transfer_id_fkey" FOREIGN KEY ("transfer_id") REFERENCES "MlmTransfer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SpecialCredit" ADD CONSTRAINT "SpecialCredit_source_slot_id_fkey" FOREIGN KEY ("source_slot_id") REFERENCES "SpecialCredit"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NetworkEvent" ADD CONSTRAINT "NetworkEvent_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SlotEvent" ADD CONSTRAINT "SlotEvent_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DesignRequest" ADD CONSTRAINT "DesignRequest_assigned_designer_id_fkey" FOREIGN KEY ("assigned_designer_id") REFERENCES "Designer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DesignRequest" ADD CONSTRAINT "DesignRequest_completed_ad_id_fkey" FOREIGN KEY ("completed_ad_id") REFERENCES "Ad"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DesignerUpload" ADD CONSTRAINT "DesignerUpload_design_request_id_fkey" FOREIGN KEY ("design_request_id") REFERENCES "DesignRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DesignerUpload" ADD CONSTRAINT "DesignerUpload_designer_id_fkey" FOREIGN KEY ("designer_id") REFERENCES "Designer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VoucherRedemption" ADD CONSTRAINT "VoucherRedemption_voucher_id_fkey" FOREIGN KEY ("voucher_id") REFERENCES "Voucher"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VoucherRedemption" ADD CONSTRAINT "VoucherRedemption_used_by_id_fkey" FOREIGN KEY ("used_by_id") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VoucherTransferLog" ADD CONSTRAINT "VoucherTransferLog_voucher_id_fkey" FOREIGN KEY ("voucher_id") REFERENCES "Voucher"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VoucherTransferLog" ADD CONSTRAINT "VoucherTransferLog_from_user_id_fkey" FOREIGN KEY ("from_user_id") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VoucherTransferLog" ADD CONSTRAINT "VoucherTransferLog_to_user_id_fkey" FOREIGN KEY ("to_user_id") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
