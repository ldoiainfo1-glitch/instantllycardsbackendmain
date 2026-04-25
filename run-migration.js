const { Client } = require("pg");

const DB_URL =
  "postgresql://postgres.gbfdfydhjxreohminbco:instantlly%40db26@aws-1-ap-south-1.pooler.supabase.com:6543/postgres";

const client = new Client({
  connectionString: DB_URL,
  ssl: { rejectUnauthorized: false },
});

async function run() {
  await client.connect();
  console.log("Connected!");

  // 1. Make business_promotion_id nullable so admin can insert events without a promotion
  await client.query(
    `ALTER TABLE public."Event" ALTER COLUMN business_promotion_id DROP NOT NULL`,
  );
  console.log("Made business_promotion_id nullable");

  // 2. Add new admin-upload columns
  await client.query(`
    ALTER TABLE public."Event"
      ADD COLUMN IF NOT EXISTS sr_no INTEGER,
      ADD COLUMN IF NOT EXISTS start_date DATE,
      ADD COLUMN IF NOT EXISTS end_date DATE,
      ADD COLUMN IF NOT EXISTS days INTEGER,
      ADD COLUMN IF NOT EXISTS city TEXT,
      ADD COLUMN IF NOT EXISTS state TEXT,
      ADD COLUMN IF NOT EXISTS event_type TEXT,
      ADD COLUMN IF NOT EXISTS source_website TEXT,
      ADD COLUMN IF NOT EXISTS venue TEXT,
      ADD COLUMN IF NOT EXISTS category TEXT,
      ADD COLUMN IF NOT EXISTS is_free BOOLEAN NOT NULL DEFAULT true,
      ADD COLUMN IF NOT EXISTS price NUMERIC NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS is_featured BOOLEAN NOT NULL DEFAULT false,
      ADD COLUMN IF NOT EXISTS organizer_name TEXT,
      ADD COLUMN IF NOT EXISTS uploaded_by_admin BOOLEAN NOT NULL DEFAULT false
  `);
  console.log("Added new columns");

  // 3. Indexes
  await client.query(
    `CREATE INDEX IF NOT EXISTS idx_event_uploaded_by_admin ON public."Event"(uploaded_by_admin)`,
  );
  await client.query(
    `CREATE INDEX IF NOT EXISTS idx_event_city ON public."Event"(city)`,
  );
  await client.query(
    `CREATE INDEX IF NOT EXISTS idx_event_state ON public."Event"(state)`,
  );
  console.log("Created indexes");

  await client.end();
  console.log("Migration complete!");
}

run().catch((e) => {
  console.error("Error:", e.message);
  client.end();
});
