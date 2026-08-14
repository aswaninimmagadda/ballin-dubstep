-- ============================================================================
-- GymFlow initial schema. Multi-tenant from the first migration.
-- Conventions:
--   * UUID primary keys (gen_random_uuid), BIGINT money in minor units (paise)
--   * DATE for calendar dates, TIMESTAMPTZ for instants
--   * text + CHECK for enumerations (portable, extensible)
--   * every tenant-owned table carries tenant_id and is RLS-protected (0003)
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Runtime application role (non-superuser; RLS applies to it).
-- Password is set by the operator: ALTER ROLE gymflow_app PASSWORD '...'
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'gymflow_app') THEN
    CREATE ROLE gymflow_app LOGIN;
  END IF;
END $$;

CREATE SCHEMA IF NOT EXISTS app;
GRANT USAGE ON SCHEMA app TO gymflow_app;
GRANT USAGE ON SCHEMA public TO gymflow_app;

-- ----------------------------------------------------------------------------
-- Platform: tenants / brands / branches
-- ----------------------------------------------------------------------------

CREATE TABLE tenants (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug             text NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$'),
  name             text NOT NULL CHECK (length(name) BETWEEN 1 AND 200),
  status           text NOT NULL DEFAULT 'trial'
                     CHECK (status IN ('trial','active','suspended','archived')),
  subscription_tier text NOT NULL DEFAULT 'starter'
                     CHECK (subscription_tier IN ('starter','standard','premium')),
  trial_ends_at    timestamptz,
  default_currency text NOT NULL DEFAULT 'INR' CHECK (default_currency ~ '^[A-Z]{3}$'),
  default_timezone text NOT NULL DEFAULT 'Asia/Kolkata',
  default_language text NOT NULL DEFAULT 'en' CHECK (default_language IN ('en','te')),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE brands (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES tenants(id),
  name            text NOT NULL CHECK (length(name) BETWEEN 1 AND 200),
  logo_path       text,
  primary_color   text CHECK (primary_color IS NULL OR primary_color ~ '^#[0-9a-fA-F]{6}$'),
  secondary_color text CHECK (secondary_color IS NULL OR secondary_color ~ '^#[0-9a-fA-F]{6}$'),
  support_phone   text,
  support_whatsapp text,
  terms_url       text,
  privacy_url     text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX brands_tenant_idx ON brands(tenant_id);

CREATE TABLE branches (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES tenants(id),
  brand_id      uuid NOT NULL REFERENCES brands(id),
  name          text NOT NULL CHECK (length(name) BETWEEN 1 AND 200),
  code          text NOT NULL CHECK (code ~ '^[A-Z0-9-]{1,12}$'),
  address_line1 text,
  address_line2 text,
  city          text,
  district      text,
  state         text,
  pin_code      text CHECK (pin_code IS NULL OR pin_code ~ '^[1-9][0-9]{5}$'),
  phone         text,
  timezone      text NOT NULL DEFAULT 'Asia/Kolkata',
  is_active     boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, code)
);
CREATE INDEX branches_tenant_idx ON branches(tenant_id);

-- ----------------------------------------------------------------------------
-- Users, credentials, sessions, RBAC
-- ----------------------------------------------------------------------------

CREATE TABLE users (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind          text NOT NULL CHECK (kind IN ('platform_admin','staff','member')),
  tenant_id     uuid REFERENCES tenants(id),
  email         text CHECK (email IS NULL OR (email = lower(email) AND email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$')),
  phone         text CHECK (phone IS NULL OR phone ~ '^\+91[6-9][0-9]{9}$'),
  display_name  text NOT NULL CHECK (length(display_name) BETWEEN 1 AND 200),
  language      text NOT NULL DEFAULT 'en' CHECK (language IN ('en','te')),
  is_active     boolean NOT NULL DEFAULT true,
  last_login_at timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CHECK ((kind = 'platform_admin') = (tenant_id IS NULL))
);
-- Staff/platform log in by globally-unique email.
CREATE UNIQUE INDEX users_email_unique ON users (email) WHERE email IS NOT NULL AND kind <> 'member';
-- Members log in by (tenant, phone): the same person can join two gyms.
CREATE UNIQUE INDEX users_member_phone_unique ON users (tenant_id, phone)
  WHERE kind = 'member' AND phone IS NOT NULL;
CREATE INDEX users_tenant_idx ON users(tenant_id);

CREATE TABLE user_credentials (
  user_id       uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  password_hash text NOT NULL,
  must_change   boolean NOT NULL DEFAULT false,
  updated_at    timestamptz NOT NULL DEFAULT now()
);

-- Staff web sessions. Token itself is never stored — only its SHA-256 hash.
CREATE TABLE sessions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash  text NOT NULL UNIQUE,
  created_at  timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz NOT NULL,
  revoked_at  timestamptz,
  ip          text,
  user_agent  text
);
CREATE INDEX sessions_user_idx ON sessions(user_id);
CREATE INDEX sessions_expiry_idx ON sessions(expires_at);

-- Member app refresh tokens (rotating). Hash only, single-use.
CREATE TABLE refresh_tokens (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash  text NOT NULL UNIQUE,
  created_at  timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz NOT NULL,
  used_at     timestamptz,
  revoked_at  timestamptz
);
CREATE INDEX refresh_tokens_user_idx ON refresh_tokens(user_id);

-- Login throttling (per identifier and per IP), pruned periodically.
CREATE TABLE login_attempts (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  identifier   text NOT NULL, -- lowercased email or tenant:phone
  ip           text,
  succeeded    boolean NOT NULL,
  attempted_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX login_attempts_ident_idx ON login_attempts(identifier, attempted_at DESC);

CREATE TABLE roles (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  uuid REFERENCES tenants(id), -- NULL = platform template
  key        text NOT NULL CHECK (key ~ '^[a-z][a-z0-9_]{1,40}$'),
  name       text NOT NULL,
  is_system  boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, key)
);

CREATE TABLE role_permissions (
  role_id    uuid NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  permission text NOT NULL CHECK (permission ~ '^[a-z]+(\.[a-z_]+)+$'),
  PRIMARY KEY (role_id, permission)
);

CREATE TABLE user_roles (
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role_id    uuid NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  granted_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, role_id)
);

-- Restrict staff to specific branches. No rows = access to all tenant branches.
CREATE TABLE staff_branch_access (
  user_id   uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  branch_id uuid NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, branch_id)
);

-- ----------------------------------------------------------------------------
-- Members
-- ----------------------------------------------------------------------------

CREATE TABLE trainers (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          uuid NOT NULL REFERENCES tenants(id),
  branch_id          uuid NOT NULL REFERENCES branches(id),
  user_id            uuid REFERENCES users(id),
  name               text NOT NULL CHECK (length(name) BETWEEN 1 AND 200),
  mobile             text NOT NULL CHECK (mobile ~ '^\+91[6-9][0-9]{9}$'),
  photo_path         text,
  specialization     text,
  certification_note text,
  is_active          boolean NOT NULL DEFAULT true,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX trainers_tenant_idx ON trainers(tenant_id);

CREATE TABLE members (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             uuid NOT NULL REFERENCES tenants(id),
  branch_id             uuid NOT NULL REFERENCES branches(id),
  user_id               uuid REFERENCES users(id),
  membership_number     text NOT NULL,
  first_name            text NOT NULL CHECK (length(first_name) BETWEEN 1 AND 120),
  last_name             text,
  preferred_name        text,
  photo_path            text,
  gender                text CHECK (gender IS NULL OR gender IN ('male','female','other','undisclosed')),
  date_of_birth         date CHECK (date_of_birth IS NULL OR date_of_birth > date '1900-01-01'),
  mobile                text NOT NULL CHECK (mobile ~ '^\+91[6-9][0-9]{9}$'),
  alt_mobile            text CHECK (alt_mobile IS NULL OR alt_mobile ~ '^\+91[6-9][0-9]{9}$'),
  email                 text CHECK (email IS NULL OR email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  address_line1         text,
  village               text,
  district              text,
  state                 text,
  pin_code              text CHECK (pin_code IS NULL OR pin_code ~ '^[1-9][0-9]{5}$'),
  emergency_contact_name     text,
  emergency_contact_relation text,
  emergency_contact_phone    text,
  join_date             date NOT NULL DEFAULT CURRENT_DATE,
  referral_source       text,
  referred_by_member_id uuid REFERENCES members(id),
  assigned_trainer_id   uuid REFERENCES trainers(id),
  status                text NOT NULL DEFAULT 'active'
    CHECK (status IN ('lead','trial','pending_activation','active','frozen',
                      'suspended','expired','cancelled','archived')),
  notes                 text,
  tags                  text[] NOT NULL DEFAULT '{}',
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  archived_at           timestamptz,
  UNIQUE (tenant_id, membership_number)
);
-- Mobile is unique per tenant (the same person may belong to two gyms).
CREATE UNIQUE INDEX members_tenant_mobile_unique ON members(tenant_id, mobile)
  WHERE archived_at IS NULL;
CREATE INDEX members_tenant_idx ON members(tenant_id);
CREATE INDEX members_branch_idx ON members(branch_id);
CREATE INDEX members_status_idx ON members(tenant_id, status);
CREATE INDEX members_name_trgm_idx ON members USING gin (
  (first_name || ' ' || coalesce(last_name, '')) gin_trgm_ops
);
CREATE INDEX members_user_idx ON members(user_id) WHERE user_id IS NOT NULL;

CREATE TABLE member_status_history (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenants(id),
  member_id   uuid NOT NULL REFERENCES members(id),
  from_status text,
  to_status   text NOT NULL,
  reason      text,
  changed_by  uuid REFERENCES users(id),
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX msh_member_idx ON member_status_history(member_id, created_at DESC);

-- ----------------------------------------------------------------------------
-- Plans (versioned) and add-ons
-- ----------------------------------------------------------------------------

CREATE TABLE membership_plans (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id            uuid NOT NULL REFERENCES tenants(id),
  name                 text NOT NULL CHECK (length(name) BETWEEN 1 AND 120),
  public_description   text,
  internal_description text,
  is_active            boolean NOT NULL DEFAULT true,
  display_order        int NOT NULL DEFAULT 0,
  tags                 text[] NOT NULL DEFAULT '{}',
  effective_from       date,
  effective_to         date,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, name)
);
CREATE INDEX plans_tenant_idx ON membership_plans(tenant_id);

CREATE TABLE membership_plan_versions (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id            uuid NOT NULL REFERENCES tenants(id),
  plan_id              uuid NOT NULL REFERENCES membership_plans(id),
  version              int NOT NULL,
  duration_unit        text NOT NULL CHECK (duration_unit IN ('days','months')),
  duration_value       int NOT NULL CHECK (duration_value BETWEEN 1 AND 3650),
  base_price           bigint NOT NULL CHECK (base_price >= 0),
  joining_fee          bigint NOT NULL DEFAULT 0 CHECK (joining_fee >= 0),
  tax_rate_bps         int NOT NULL DEFAULT 0 CHECK (tax_rate_bps BETWEEN 0 AND 10000),
  tax_inclusive        boolean NOT NULL DEFAULT true,
  freeze_allowance_days int NOT NULL DEFAULT 0 CHECK (freeze_allowance_days BETWEEN 0 AND 365),
  max_freezes          int NOT NULL DEFAULT 0 CHECK (max_freezes BETWEEN 0 AND 12),
  grace_period_days    int NOT NULL DEFAULT 3 CHECK (grace_period_days BETWEEN 0 AND 60),
  allowed_timings      text,
  max_visits_per_month int CHECK (max_visits_per_month IS NULL OR max_visits_per_month BETWEEN 1 AND 100),
  branch_ids           uuid[],
  eligibility_note     text,
  created_at           timestamptz NOT NULL DEFAULT now(),
  UNIQUE (plan_id, version)
);
CREATE INDEX plan_versions_plan_idx ON membership_plan_versions(plan_id, version DESC);

CREATE TABLE addon_packages (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL REFERENCES tenants(id),
  kind           text NOT NULL CHECK (kind IN
                   ('personal_training','group_class','locker','towel','nutrition','other')),
  name           text NOT NULL CHECK (length(name) BETWEEN 1 AND 120),
  description    text,
  session_count  int CHECK (session_count IS NULL OR session_count BETWEEN 1 AND 500),
  validity_days  int NOT NULL CHECK (validity_days BETWEEN 1 AND 730),
  price          bigint NOT NULL CHECK (price >= 0),
  is_active      boolean NOT NULL DEFAULT true,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, name)
);

-- ----------------------------------------------------------------------------
-- Memberships (immutable commercial history) + lifecycle
-- ----------------------------------------------------------------------------

CREATE TABLE memberships (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          uuid NOT NULL REFERENCES tenants(id),
  branch_id          uuid NOT NULL REFERENCES branches(id),
  member_id          uuid NOT NULL REFERENCES members(id),
  plan_id            uuid NOT NULL REFERENCES membership_plans(id),
  plan_version_id    uuid NOT NULL REFERENCES membership_plan_versions(id),
  plan_name_snapshot text NOT NULL,
  start_date         date NOT NULL,
  base_end_date      date NOT NULL,
  end_date           date NOT NULL,
  grace_period_days  int NOT NULL DEFAULT 3,
  state              text NOT NULL DEFAULT 'active'
                       CHECK (state IN ('pending','active','frozen','cancelled','expired')),
  total_amount       bigint NOT NULL CHECK (total_amount >= 0),
  discount_amount    bigint NOT NULL DEFAULT 0 CHECK (discount_amount >= 0),
  promotion_id       uuid,
  sold_by            uuid REFERENCES users(id),
  previous_membership_id uuid REFERENCES memberships(id),
  idempotency_key    text,
  cancelled_at       timestamptz,
  cancel_reason      text,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  CHECK (end_date >= start_date),
  CHECK (base_end_date >= start_date)
);
CREATE INDEX memberships_member_idx ON memberships(member_id, start_date DESC);
CREATE INDEX memberships_tenant_state_idx ON memberships(tenant_id, state);
CREATE INDEX memberships_expiry_idx ON memberships(tenant_id, end_date) WHERE state IN ('active','frozen');
CREATE UNIQUE INDEX memberships_idem_unique ON memberships(tenant_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;
-- One live (pending/active/frozen) membership per member at a time.
CREATE UNIQUE INDEX memberships_one_live_per_member ON memberships(member_id)
  WHERE state IN ('pending','active','frozen');

CREATE TABLE membership_events (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES tenants(id),
  membership_id uuid NOT NULL REFERENCES memberships(id),
  type          text NOT NULL CHECK (type IN
                  ('sold','activated','renewed','frozen','unfrozen','cancelled',
                   'expired','extended','transferred')),
  data          jsonb NOT NULL DEFAULT '{}',
  actor_id      uuid REFERENCES users(id),
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX membership_events_idx ON membership_events(membership_id, created_at);

CREATE TABLE membership_freezes (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid NOT NULL REFERENCES tenants(id),
  membership_id    uuid NOT NULL REFERENCES memberships(id),
  start_date       date NOT NULL,
  planned_end_date date,
  actual_end_date  date,
  days             int CHECK (days IS NULL OR days >= 1),
  reason           text NOT NULL,
  note             text,
  extends_expiry   boolean NOT NULL DEFAULT true,
  authorized_by    uuid NOT NULL REFERENCES users(id),
  created_at       timestamptz NOT NULL DEFAULT now(),
  CHECK (planned_end_date IS NULL OR planned_end_date >= start_date),
  CHECK (actual_end_date IS NULL OR actual_end_date >= start_date)
);
CREATE INDEX freezes_membership_idx ON membership_freezes(membership_id);
-- Only one open freeze per membership.
CREATE UNIQUE INDEX freezes_one_open ON membership_freezes(membership_id)
  WHERE actual_end_date IS NULL;

CREATE TABLE member_addons (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid NOT NULL REFERENCES tenants(id),
  member_id        uuid NOT NULL REFERENCES members(id),
  addon_package_id uuid NOT NULL REFERENCES addon_packages(id),
  name_snapshot    text NOT NULL,
  price_snapshot   bigint NOT NULL CHECK (price_snapshot >= 0),
  trainer_id       uuid REFERENCES trainers(id),
  sessions_total   int,
  sessions_used    int NOT NULL DEFAULT 0 CHECK (sessions_used >= 0),
  start_date       date NOT NULL,
  end_date         date NOT NULL,
  state            text NOT NULL DEFAULT 'active'
                     CHECK (state IN ('active','completed','expired','cancelled')),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  CHECK (end_date >= start_date),
  CHECK (sessions_total IS NULL OR sessions_used <= sessions_total)
);
CREATE INDEX member_addons_member_idx ON member_addons(member_id);

CREATE TABLE trainer_sessions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES tenants(id),
  branch_id       uuid NOT NULL REFERENCES branches(id),
  trainer_id      uuid NOT NULL REFERENCES trainers(id),
  member_id       uuid NOT NULL REFERENCES members(id),
  member_addon_id uuid REFERENCES member_addons(id),
  session_date    date NOT NULL,
  start_time      time NOT NULL,
  end_time        time NOT NULL,
  status          text NOT NULL DEFAULT 'scheduled'
                    CHECK (status IN ('scheduled','completed','cancelled','member_no_show','trainer_no_show')),
  notes           text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CHECK (end_time > start_time)
);
CREATE INDEX trainer_sessions_trainer_idx ON trainer_sessions(trainer_id, session_date);
CREATE INDEX trainer_sessions_member_idx ON trainer_sessions(member_id, session_date);
-- Prevent obvious double-booking: same trainer, same date, same start time.
CREATE UNIQUE INDEX trainer_sessions_no_double_book
  ON trainer_sessions(trainer_id, session_date, start_time)
  WHERE status = 'scheduled';

-- ----------------------------------------------------------------------------
-- Leads
-- ----------------------------------------------------------------------------

CREATE TABLE leads (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          uuid NOT NULL REFERENCES tenants(id),
  branch_id          uuid NOT NULL REFERENCES branches(id),
  name               text NOT NULL CHECK (length(name) BETWEEN 1 AND 200),
  mobile             text NOT NULL CHECK (mobile ~ '^\+91[6-9][0-9]{9}$'),
  interested_plan_id uuid REFERENCES membership_plans(id),
  preferred_timing   text,
  source             text NOT NULL DEFAULT 'walk_in'
                       CHECK (source IN ('walk_in','phone','whatsapp','social','referral','website','other')),
  assigned_to        uuid REFERENCES users(id),
  follow_up_date     date,
  notes              text,
  status             text NOT NULL DEFAULT 'new'
                       CHECK (status IN ('new','contacted','trial_scheduled','trial_completed',
                                         'interested','follow_up','won','lost')),
  converted_member_id uuid REFERENCES members(id),
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX leads_tenant_status_idx ON leads(tenant_id, status);
CREATE INDEX leads_followup_idx ON leads(tenant_id, follow_up_date);

CREATE TABLE lead_activities (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  uuid NOT NULL REFERENCES tenants(id),
  lead_id    uuid NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  kind       text NOT NULL CHECK (kind IN ('note','call','whatsapp','visit','status_change')),
  detail     text,
  actor_id   uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX lead_activities_idx ON lead_activities(lead_id, created_at DESC);

-- ----------------------------------------------------------------------------
-- Promotions
-- ----------------------------------------------------------------------------

CREATE TABLE promotions (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           uuid NOT NULL REFERENCES tenants(id),
  code                text NOT NULL CHECK (code ~ '^[A-Z0-9-]{2,40}$'),
  name                text NOT NULL,
  auto_apply          boolean NOT NULL DEFAULT false,
  discount_kind       text NOT NULL CHECK (discount_kind IN ('percentage','flat','joining_fee_waiver')),
  discount_value      bigint NOT NULL DEFAULT 0 CHECK (discount_value >= 0),
  max_discount_amount bigint CHECK (max_discount_amount IS NULL OR max_discount_amount >= 0),
  valid_from          date NOT NULL,
  valid_to            date NOT NULL,
  plan_ids            uuid[],
  branch_ids          uuid[],
  usage_limit         int CHECK (usage_limit IS NULL OR usage_limit >= 1),
  per_member_limit    int CHECK (per_member_limit IS NULL OR per_member_limit >= 1),
  audience            text NOT NULL DEFAULT 'all'
                        CHECK (audience IN ('all','new_members','renewals','win_back')),
  is_active           boolean NOT NULL DEFAULT true,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, code),
  CHECK (valid_to >= valid_from),
  CHECK (discount_kind <> 'percentage' OR discount_value <= 10000)
);

ALTER TABLE memberships
  ADD CONSTRAINT memberships_promotion_fk FOREIGN KEY (promotion_id) REFERENCES promotions(id);

CREATE TABLE promotion_redemptions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES tenants(id),
  promotion_id    uuid NOT NULL REFERENCES promotions(id),
  member_id       uuid NOT NULL REFERENCES members(id),
  membership_id   uuid NOT NULL REFERENCES memberships(id),
  discount_amount bigint NOT NULL CHECK (discount_amount >= 0),
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX redemptions_promo_idx ON promotion_redemptions(promotion_id);
CREATE INDEX redemptions_member_idx ON promotion_redemptions(member_id, promotion_id);

-- ----------------------------------------------------------------------------
-- Payments / receipts / refunds (append-only financial records)
-- ----------------------------------------------------------------------------

CREATE TABLE payments (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          uuid NOT NULL REFERENCES tenants(id),
  branch_id          uuid NOT NULL REFERENCES branches(id),
  member_id          uuid NOT NULL REFERENCES members(id),
  amount             bigint NOT NULL CHECK (amount > 0),
  method             text NOT NULL CHECK (method IN
                       ('cash','upi','card_credit','card_debit','bank_transfer','other')),
  status             text NOT NULL DEFAULT 'completed'
                       CHECK (status IN ('completed','pending','failed','refunded','partially_refunded')),
  payment_date       date NOT NULL DEFAULT CURRENT_DATE,
  external_reference text,
  received_by        uuid REFERENCES users(id),
  notes              text,
  idempotency_key    text,
  created_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX payments_tenant_date_idx ON payments(tenant_id, payment_date DESC);
CREATE INDEX payments_member_idx ON payments(member_id, payment_date DESC);
CREATE UNIQUE INDEX payments_idem_unique ON payments(tenant_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE TABLE payment_allocations (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES tenants(id),
  payment_id      uuid NOT NULL REFERENCES payments(id),
  membership_id   uuid REFERENCES memberships(id),
  member_addon_id uuid REFERENCES member_addons(id),
  amount          bigint NOT NULL CHECK (amount > 0),
  created_at      timestamptz NOT NULL DEFAULT now(),
  CHECK (membership_id IS NOT NULL OR member_addon_id IS NOT NULL)
);
CREATE INDEX allocations_payment_idx ON payment_allocations(payment_id);
CREATE INDEX allocations_membership_idx ON payment_allocations(membership_id);

CREATE TABLE refunds (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL REFERENCES tenants(id),
  payment_id   uuid NOT NULL REFERENCES payments(id),
  amount       bigint NOT NULL CHECK (amount > 0),
  reason       text NOT NULL CHECK (length(reason) >= 3),
  approved_by  uuid NOT NULL REFERENCES users(id),
  processed_by uuid NOT NULL REFERENCES users(id),
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX refunds_payment_idx ON refunds(payment_id);

-- Per-tenant, per-fiscal-year receipt sequence (allocated atomically).
CREATE TABLE receipt_sequences (
  tenant_id   uuid NOT NULL REFERENCES tenants(id),
  fiscal_year text NOT NULL,
  next_seq    bigint NOT NULL DEFAULT 1,
  PRIMARY KEY (tenant_id, fiscal_year)
);

CREATE TABLE receipts (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL REFERENCES tenants(id),
  branch_id      uuid NOT NULL REFERENCES branches(id),
  payment_id     uuid NOT NULL UNIQUE REFERENCES payments(id),
  receipt_number text NOT NULL,
  sequence       bigint NOT NULL,
  fiscal_year    text NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, receipt_number)
);

-- ----------------------------------------------------------------------------
-- Attendance
-- ----------------------------------------------------------------------------

CREATE TABLE attendance (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES tenants(id),
  branch_id     uuid NOT NULL REFERENCES branches(id),
  member_id     uuid NOT NULL REFERENCES members(id),
  method        text NOT NULL CHECK (method IN ('reception','qr','manual')),
  checked_in_at timestamptz NOT NULL DEFAULT now(),
  checked_in_by uuid REFERENCES users(id),
  device_info   text
);
CREATE INDEX attendance_member_idx ON attendance(member_id, checked_in_at DESC);
CREATE INDEX attendance_branch_day_idx ON attendance(branch_id, checked_in_at DESC);
CREATE INDEX attendance_tenant_idx ON attendance(tenant_id, checked_in_at DESC);

-- ----------------------------------------------------------------------------
-- Notifications
-- ----------------------------------------------------------------------------

CREATE TABLE notification_templates (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  uuid NOT NULL REFERENCES tenants(id),
  event      text NOT NULL CHECK (event IN
               ('membership_expiring','membership_expired','renewal_completed',
                'payment_received','pt_session_upcoming','promotion','announcement')),
  channel    text NOT NULL CHECK (channel IN ('in_app','push','whatsapp_link','sms','email')),
  language   text NOT NULL CHECK (language IN ('en','te')),
  body       text NOT NULL,
  is_active  boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, event, channel, language)
);

CREATE TABLE notification_deliveries (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES tenants(id),
  member_id     uuid REFERENCES members(id),
  event         text NOT NULL,
  channel       text NOT NULL,
  dedupe_key    text NOT NULL,
  rendered_body text NOT NULL,
  status        text NOT NULL DEFAULT 'queued'
                  CHECK (status IN ('queued','sent','failed','skipped')),
  error         text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  sent_at       timestamptz,
  UNIQUE (tenant_id, dedupe_key)
);
CREATE INDEX deliveries_member_idx ON notification_deliveries(member_id, created_at DESC);

-- ----------------------------------------------------------------------------
-- Settings, feature flags, audit
-- ----------------------------------------------------------------------------

CREATE TABLE gym_settings (
  tenant_id                  uuid PRIMARY KEY REFERENCES tenants(id),
  receipt_prefix             text NOT NULL DEFAULT 'GYM' CHECK (receipt_prefix ~ '^[A-Z0-9]{1,8}$'),
  receipt_sequence_padding   int NOT NULL DEFAULT 6 CHECK (receipt_sequence_padding BETWEEN 3 AND 10),
  membership_number_prefix   text NOT NULL DEFAULT 'M' CHECK (membership_number_prefix ~ '^[A-Z0-9]{0,6}$'),
  membership_number_next     bigint NOT NULL DEFAULT 1001,
  expiry_reminder_days       int[] NOT NULL DEFAULT '{7,3,1}',
  default_grace_period_days  int NOT NULL DEFAULT 3 CHECK (default_grace_period_days BETWEEN 0 AND 60),
  max_freezes_per_year       int NOT NULL DEFAULT 2,
  max_freeze_days_per_year   int NOT NULL DEFAULT 30,
  allow_partial_payments     boolean NOT NULL DEFAULT false,
  discount_approval_threshold_bps int NOT NULL DEFAULT 2000,
  whatsapp_renewal_template_en text NOT NULL
    DEFAULT 'Hi {{member_first_name}}, your {{gym_name}} membership expires on {{expiry_date}}. Please contact us for renewal. Thank you!',
  whatsapp_renewal_template_te text NOT NULL
    DEFAULT 'నమస్తే {{member_first_name}} గారు, మీ {{gym_name}} సభ్యత్వం {{expiry_date}} న ముగుస్తుంది. పునరుద్ధరణ కోసం మమ్మల్ని సంప్రదించండి. ధన్యవాదాలు!',
  receipt_footer             text,
  date_format                text NOT NULL DEFAULT 'DD-MM-YYYY',
  extra                      jsonb NOT NULL DEFAULT '{}',
  updated_at                 timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE feature_flags (
  tenant_id  uuid NOT NULL REFERENCES tenants(id),
  key        text NOT NULL CHECK (key IN
               ('attendance','pt','leads','onlinePayments','merchandise',
                'classes','pushNotifications','whatsappIntegration')),
  enabled    boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, key)
);

CREATE TABLE audit_logs (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid REFERENCES tenants(id),
  actor_id    uuid,
  actor_label text NOT NULL,
  action      text NOT NULL,
  entity_type text NOT NULL,
  entity_id   uuid,
  before      jsonb,
  after       jsonb,
  ip          text,
  user_agent  text,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_tenant_idx ON audit_logs(tenant_id, created_at DESC);
CREATE INDEX audit_entity_idx ON audit_logs(entity_type, entity_id);
