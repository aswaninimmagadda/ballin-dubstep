-- ============================================================================
-- 0020 — a dropped response must not lock a member out
--
-- The rotation was: consume the old token, then (in a second statement) create
-- the new one, and hand both back to the app. Two problems follow from that
-- shape, and the second one strands real members.
--
--  1. There is a window where the old token is spent and the new one does not
--     exist yet. A crash there loses the session outright.
--
--  2. If the RESPONSE is dropped — patchy mobile data at the gym door, which
--     is the normal case, not the exotic one — the server has rotated and the
--     app has not. The app still holds the old token, retries with it, and the
--     replay defence revokes the entire family. The member is locked out
--     permanently and has to go to reception. The defence fires on the exact
--     failure it should tolerate.
--
-- Fixed by making rotation ONE atomic call that links each token to its
-- successor, plus a short grace window:
--
--   * old token unused                      -> normal rotation
--   * old token used within the grace window,
--     and its successor was never used      -> the response was lost. Revoke
--                                              the undelivered successor and
--                                              issue a fresh pair.
--   * old token used, successor already used -> a genuine replay: someone else
--     or used outside the window               has the token. Revoke the family.
--
-- The middle case is safe precisely because of the successor check: if the
-- legitimate client had received the new token it would have moved on and the
-- successor would be used, so a reuse can only be the retry it looks like.
-- ============================================================================

ALTER TABLE refresh_tokens
  ADD COLUMN IF NOT EXISTS replaced_by uuid REFERENCES refresh_tokens(id);

CREATE INDEX IF NOT EXISTS refresh_tokens_replaced_by_idx
  ON refresh_tokens(replaced_by) WHERE replaced_by IS NOT NULL;

/*
 * Consume p_old_hash and issue p_new_hash in one transaction.
 * Returns the user when rotation is allowed, nothing when it is not.
 */
CREATE OR REPLACE FUNCTION app.refresh_rotate(
  p_old_hash text,
  p_new_hash text,
  p_expires timestamptz,
  p_grace interval DEFAULT interval '60 seconds'
)
RETURNS TABLE (user_id uuid, tenant_id uuid, kind text, is_active boolean, tenant_status text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  tok refresh_tokens%ROWTYPE;
  successor refresh_tokens%ROWTYPE;
  new_id uuid;
BEGIN
  SELECT * INTO tok FROM refresh_tokens WHERE token_hash = p_old_hash FOR UPDATE;
  IF NOT FOUND THEN RETURN; END IF;
  IF tok.revoked_at IS NOT NULL OR tok.expires_at <= now() THEN RETURN; END IF;

  IF tok.used_at IS NOT NULL THEN
    SELECT * INTO successor FROM refresh_tokens WHERE id = tok.replaced_by FOR UPDATE;
    IF NOT FOUND
       OR now() - tok.used_at > p_grace
       OR successor.used_at IS NOT NULL
       OR successor.revoked_at IS NOT NULL THEN
      -- Genuine replay: the holder is not the client we rotated for.
      UPDATE refresh_tokens SET revoked_at = now()
        WHERE refresh_tokens.user_id = tok.user_id AND revoked_at IS NULL;
      RETURN;
    END IF;
    -- The successor was minted and never reached anyone. Retire it and mint
    -- again, so the chain stays exactly one token long.
    UPDATE refresh_tokens SET revoked_at = now() WHERE id = successor.id;
  END IF;

  INSERT INTO refresh_tokens (user_id, token_hash, expires_at)
  VALUES (tok.user_id, p_new_hash, p_expires)
  RETURNING id INTO new_id;

  UPDATE refresh_tokens
     SET used_at = coalesce(used_at, now()), replaced_by = new_id
   WHERE id = tok.id;

  RETURN QUERY
    SELECT u.id, u.tenant_id, u.kind, u.is_active, t.status
      FROM users u LEFT JOIN tenants t ON t.id = u.tenant_id
     WHERE u.id = tok.user_id;
END $$;

REVOKE ALL ON FUNCTION app.refresh_rotate(text, text, timestamptz, interval) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.refresh_rotate(text, text, timestamptz, interval) TO gymflow_app;
