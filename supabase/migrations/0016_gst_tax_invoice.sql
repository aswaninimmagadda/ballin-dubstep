-- ============================================================================
-- 0016 — GST: settable rate, snapshotted tax, tax invoice
--
-- The pricing engine already computed tax correctly (packages/core/pricing.ts,
-- with tests) and the schema already stored a rate per plan version, but
-- nothing joined the two up: the plan form hard-coded taxRateBps = 0, no tax
-- amount was ever persisted, and the receipt printed a single total. A gym
-- registered under GST — every gym above the turnover threshold — could not
-- issue a valid tax invoice at all.
--
-- The important part is the SNAPSHOT. Tax has to be frozen onto the
-- membership at the moment of sale, exactly like plan_name_snapshot. Deriving
-- it from the plan version at print time would mean that raising a plan's rate
-- silently rewrote every receipt already issued under the old one, which is
-- the immutable-financial-history rule this product is built on.
-- ============================================================================

-- The gym's own registration. Absent = not GST-registered, and the receipt
-- stays the plain acknowledgement it is today; a gym below the threshold must
-- NOT print a tax invoice.
ALTER TABLE gym_settings
  ADD COLUMN IF NOT EXISTS gstin text,
  ADD COLUMN IF NOT EXISTS tax_sac_code text NOT NULL DEFAULT '999723',
  ADD COLUMN IF NOT EXISTS tax_state_name text;

-- 15 characters: 2 state code, 10 PAN, 1 entity, 1 'Z', 1 checksum.
ALTER TABLE gym_settings DROP CONSTRAINT IF EXISTS gym_settings_gstin_check;
ALTER TABLE gym_settings ADD CONSTRAINT gym_settings_gstin_check
  CHECK (gstin IS NULL OR gstin ~ '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][0-9A-Z]Z[0-9A-Z]$');

-- SAC 999723 is "physical well-being including health club & fitness centre".
ALTER TABLE gym_settings DROP CONSTRAINT IF EXISTS gym_settings_sac_check;
ALTER TABLE gym_settings ADD CONSTRAINT gym_settings_sac_check
  CHECK (tax_sac_code ~ '^[0-9]{4,8}$');

-- Snapshots. tax_amount is the tax component already contained in (inclusive)
-- or added to (exclusive) total_amount — total_amount stays the amount the
-- member owes, so nothing about dues, allocations or refunds changes.
ALTER TABLE memberships
  ADD COLUMN IF NOT EXISTS tax_amount bigint NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS tax_rate_bps int NOT NULL DEFAULT 0;
ALTER TABLE memberships DROP CONSTRAINT IF EXISTS memberships_tax_amount_check;
ALTER TABLE memberships ADD CONSTRAINT memberships_tax_amount_check
  CHECK (tax_amount >= 0 AND tax_amount <= total_amount);
ALTER TABLE memberships DROP CONSTRAINT IF EXISTS memberships_tax_rate_check;
ALTER TABLE memberships ADD CONSTRAINT memberships_tax_rate_check
  CHECK (tax_rate_bps BETWEEN 0 AND 10000);

-- PT and other add-on packages are the same supply and need the same
-- treatment, otherwise a gym's invoice totals would not reconcile.
ALTER TABLE addon_packages
  ADD COLUMN IF NOT EXISTS tax_rate_bps int NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS tax_inclusive boolean NOT NULL DEFAULT true;
ALTER TABLE addon_packages DROP CONSTRAINT IF EXISTS addon_packages_tax_rate_check;
ALTER TABLE addon_packages ADD CONSTRAINT addon_packages_tax_rate_check
  CHECK (tax_rate_bps BETWEEN 0 AND 10000);

ALTER TABLE member_addons
  ADD COLUMN IF NOT EXISTS tax_amount bigint NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS tax_rate_bps int NOT NULL DEFAULT 0;
ALTER TABLE member_addons DROP CONSTRAINT IF EXISTS member_addons_tax_amount_check;
ALTER TABLE member_addons ADD CONSTRAINT member_addons_tax_amount_check
  CHECK (tax_amount >= 0 AND tax_amount <= price_snapshot);
