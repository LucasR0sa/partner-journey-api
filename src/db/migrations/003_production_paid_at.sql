-- A atribuição filtra por data sem um parceiro específico; o índice composto começa por partner_id.
CREATE INDEX production_paid_at_idx ON production (paid_at);
