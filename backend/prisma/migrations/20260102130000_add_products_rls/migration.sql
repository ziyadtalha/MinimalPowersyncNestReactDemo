-- Create PostgreSQL publication for PowerSync replication
-- This enables logical replication for all tables
CREATE PUBLICATION powersync FOR ALL TABLES;

-- Enable Row Level Security on Product and add owner-only policy for Powersync
ALTER TABLE IF EXISTS public."Product" ENABLE ROW LEVEL SECURITY;

-- Ensure policy is replaced if it already exists, then create it.
DROP POLICY IF EXISTS products_owner ON public."Product";
CREATE POLICY products_owner
  ON public."Product"
  USING (("ownerId" = current_setting('app.user_id')::uuid));
