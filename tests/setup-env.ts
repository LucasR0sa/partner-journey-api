// Valores padrão para os testes. No CI o DATABASE_URL vem do serviço Postgres do workflow.
process.env.NODE_ENV = "test";
process.env.LOG_LEVEL ??= "silent";
process.env.WEBHOOK_SECRET ??= "segredo-de-teste-com-32-caracteres!";
process.env.DATABASE_URL ??= process.env.TEST_DATABASE_URL ?? "postgres://journey:journey@localhost:5433/journey_test";
