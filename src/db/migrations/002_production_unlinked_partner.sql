-- Preserva o código de origem mesmo quando o cadastro do parceiro ainda não chegou.
ALTER TABLE production ADD COLUMN partner_code TEXT;

UPDATE production AS production
SET partner_code = partner.crm_code
FROM partners AS partner
WHERE partner.id = production.partner_id;

ALTER TABLE production
  ALTER COLUMN partner_code SET NOT NULL,
  ALTER COLUMN partner_id DROP NOT NULL;

CREATE INDEX production_partner_code_idx ON production (partner_code);
CREATE INDEX production_unlinked_partner_code_idx ON production (partner_code)
  WHERE partner_id IS NULL;
