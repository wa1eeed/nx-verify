-- 0061: value added tax, as a period rather than a switch.
--
-- The platform is not registered for VAT today. The providers we buy from are, so what they
-- bill us already includes it and we cannot reclaim it: their VAT is simply part of our cost.
-- At some point we will register, and from that day the price quoted to a subscriber is a
-- final price with VAT in it, and the VAT we pay providers becomes reclaimable rather than a
-- cost. Both sides of the margin change on the same date.
--
-- A boolean setting would be wrong, and not by a little. Turn it on in March and every
-- invoice ever issued recomputes with VAT that did not apply when it was charged; turn it on
-- and a February invoice reprinted in April is a different document from the one the customer
-- received. What a tax authority asks for is the rule that was in force on the date of
-- supply, which is why this is a table of periods and every calculation takes a date.
--
-- Rule 6 in spirit: a figure with no date is a figure you cannot defend two years later.
--
-- The rate is in basis points because a percentage in a numeric column invites somebody to
-- store 0.15 where the row beside it holds 15.

SET LOCAL ROLE nx_migrator;

CREATE TABLE vat_periods (
  -- The day this rule starts. The row with the latest date on or before a given day is the
  -- rule for that day, and there is no end column: a period ends when the next one begins.
  effective_from      date PRIMARY KEY,
  -- Whether the platform is registered, which is the fact everything else follows from.
  registered          boolean NOT NULL,
  -- 1500 is 15%. Kept even for an unregistered period so the panel can show what a price
  -- would become, which is the question somebody asks in the month before registering.
  rate_bps            integer NOT NULL CHECK (rate_bps >= 0 AND rate_bps <= 10000),
  -- Shown on every invoice of the period. A registered seller must print it.
  registration_number text CHECK (registration_number IS NULL OR registration_number ~ '^[0-9]{15}$'),
  note                text CHECK (note IS NULL OR length(note) <= 200),
  set_by              text,
  set_at              timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_vat_number_when_registered CHECK (
    NOT registered OR registration_number IS NOT NULL
  )
);

COMMENT ON TABLE vat_periods IS
  'The VAT rule in force from a date. A calculation takes a date and reads the row in force then, so an invoice reprinted years later says what it said.';

REVOKE ALL ON vat_periods FROM PUBLIC;
-- Every screen that shows a price needs to read it. Only the panel writes it.
GRANT SELECT ON vat_periods TO nx_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON vat_periods TO nx_operator;

-- The VAT already inside what a provider bills us.
--
-- Their invoice is one number, and today that number is our cost entire. The moment we are
-- registered the tax part of it stops being a cost, so the platform has to know how much of
-- it was tax. Recorded per cost row, because providers differ and one of them may not charge
-- it at all.
ALTER TABLE cost_book
  ADD COLUMN vat_bps integer NOT NULL DEFAULT 1500
    CHECK (vat_bps >= 0 AND vat_bps <= 10000);

COMMENT ON COLUMN cost_book.vat_bps IS
  'How much of unit_cost is tax the provider charged us. Reclaimable once we are registered, a plain cost until then.';

/**
 * The rule in force on a day.
 *
 * Returns a row even when the table is empty, because a platform with no VAT row is an
 * unregistered platform and that is a perfectly good answer: the alternative is every caller
 * writing the same null check, and one of them getting it wrong on an invoice.
 */
CREATE FUNCTION app.vat_on(p_day date)
  RETURNS TABLE (registered boolean, rate_bps integer, registration_number text)
  LANGUAGE sql
  STABLE
  SET search_path = pg_catalog, public
AS $$
  SELECT COALESCE(v.registered, false),
         COALESCE(v.rate_bps, 0),
         v.registration_number
    FROM (SELECT 1) AS anchor
    LEFT JOIN LATERAL (
      SELECT p.registered, p.rate_bps, p.registration_number
        FROM vat_periods p
       WHERE p.effective_from <= p_day
       ORDER BY p.effective_from DESC
       LIMIT 1
    ) v ON true;
$$;

GRANT EXECUTE ON FUNCTION app.vat_on(date) TO nx_app;
GRANT EXECUTE ON FUNCTION app.vat_on(date) TO nx_operator;

-- Today's rule, stated rather than left to be inferred from an empty table. The rate is the
-- Saudi standard rate, carried so the panel can answer «what would our prices become» before
-- anybody commits to a date.
INSERT INTO vat_periods (effective_from, registered, rate_bps, note, set_by)
VALUES (
  DATE '2020-07-01',
  false,
  1500,
  'المنصة غير مسجّلة في ضريبة القيمة المضافة. أسعار المزودين تشملها وتُحتسب تكلفةً علينا.',
  'migration'
)
ON CONFLICT (effective_from) DO NOTHING;
