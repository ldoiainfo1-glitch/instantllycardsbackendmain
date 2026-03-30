-- CreateTable
CREATE TABLE "ad_campaigns" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "business_card_id" INTEGER,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "ad_type" TEXT NOT NULL DEFAULT 'banner',
    "cta" TEXT,
    "creative_url" TEXT,
    "creative_urls" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "target_city" TEXT,
    "target_age" TEXT,
    "target_interests" TEXT,
    "daily_budget" DOUBLE PRECISION NOT NULL DEFAULT 100,
    "duration_days" INTEGER NOT NULL DEFAULT 7,
    "total_budget" DOUBLE PRECISION,
    "impressions" INTEGER NOT NULL DEFAULT 0,
    "clicks" INTEGER NOT NULL DEFAULT 0,
    "spent" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'active',
    "approval_status" TEXT NOT NULL DEFAULT 'pending',
    "start_date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "end_date" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ad_campaigns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ad_variants" (
    "id" SERIAL NOT NULL,
    "campaign_id" INTEGER NOT NULL,
    "creative_url" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "impressions" INTEGER NOT NULL DEFAULT 0,
    "clicks" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ad_variants_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "ad_campaigns" ADD CONSTRAINT "ad_campaigns_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ad_campaigns" ADD CONSTRAINT "ad_campaigns_business_card_id_fkey" FOREIGN KEY ("business_card_id") REFERENCES "BusinessCard"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ad_variants" ADD CONSTRAINT "ad_variants_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "ad_campaigns"("id") ON DELETE CASCADE ON UPDATE CASCADE;
