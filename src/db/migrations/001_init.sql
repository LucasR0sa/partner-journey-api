-- Leads que chegam do provedor de marketing (webhook)
CREATE TABLE leads (
  id              BIGSERIAL PRIMARY KEY,
  event_id        TEXT        NOT NULL,         -- id do evento no provedor: chave de idempotência
  source          TEXT        NOT NULL,         -- ex.: meta_ads, google_ads, organico
  campaign        TEXT,
  email_norm      TEXT,
  phone_norm      TEXT,
  occurred_at     TIMESTAMPTZ NOT NULL,         -- quando o lead aconteceu no provedor
  received_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT leads_event_id_uniq UNIQUE (event_id),
  CONSTRAINT leads_has_contact CHECK (email_norm IS NOT NULL OR phone_norm IS NOT NULL)
);
CREATE INDEX leads_email_idx ON leads (email_norm) WHERE email_norm IS NOT NULL;
CREATE INDEX leads_phone_idx ON leads (phone_norm) WHERE phone_norm IS NOT NULL;

-- Parceiros cadastrados no CRM, ligados (ou não) ao lead de origem
CREATE TABLE partners (
  id            BIGSERIAL PRIMARY KEY,
  crm_code      TEXT        NOT NULL UNIQUE,
  name          TEXT        NOT NULL,
  email_norm    TEXT,
  phone_norm    TEXT,
  lead_id       BIGINT REFERENCES leads (id),
  match_method  TEXT CHECK (match_method IN ('email', 'phone', 'none')),
  signed_up_at  TIMESTAMPTZ NOT NULL
);
CREATE INDEX partners_lead_idx ON partners (lead_id);

-- Produção (contratos pagos) sincronizada do CRM
CREATE TABLE production (
  id               BIGSERIAL PRIMARY KEY,
  crm_contract_id  TEXT        NOT NULL UNIQUE,  -- upsert por aqui: re-sincronizar não duplica
  partner_id       BIGINT      NOT NULL REFERENCES partners (id),
  amount_cents     BIGINT      NOT NULL CHECK (amount_cents >= 0),
  paid_at          DATE        NOT NULL,
  synced_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX production_partner_paid_idx ON production (partner_id, paid_at);

-- Estado dos jobs de sincronização (cursor incremental + último erro)
CREATE TABLE sync_state (
  job              TEXT PRIMARY KEY,
  cursor           TEXT,
  last_success_at  TIMESTAMPTZ,
  last_error       TEXT,
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
