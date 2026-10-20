import pg from "pg";

// int8 (bigint) chega como string por padrão; valores em centavos cabem com folga em Number.
pg.types.setTypeParser(20, (v) => Number(v));

export type Db = pg.Pool;

export function createPool(connectionString: string): Db {
  return new pg.Pool({ connectionString, max: 10 });
}
