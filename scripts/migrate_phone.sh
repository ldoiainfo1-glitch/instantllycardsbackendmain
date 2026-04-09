#!/bin/bash
# Script to populate phone field in AdCampaign from BusinessCard

cd /d D:\\Instantlly\\Instantlly-Main-Project\\instantllycardsbackendmain

echo "🚀 Adding phone field to AdCampaign table..."

# Run migration
npx prisma migrate dev --name add_phone_to_ad_campaign

echo ""
echo "✅ Migration complete!"
echo ""
echo "Next: Update phone field from BusinessCard phone numbers..."

# Run seed script
npx prisma db seed
