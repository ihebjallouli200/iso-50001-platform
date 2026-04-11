export type DbConnection = {
  vendor: "timescaledb";
  dsn: string;
};

let cachedDb: DbConnection | null = null;

function buildDsn(): string {
  const host = process.env.TIMESCALE_HOST || "localhost";
  const port = Number(process.env.TIMESCALE_PORT || 5432);
  const database = process.env.TIMESCALE_DB || "enms";
  const user = process.env.TIMESCALE_USER || "enms";
  const password = process.env.TIMESCALE_PASSWORD || "enms";
  const ssl = String(process.env.TIMESCALE_SSL || "false").toLowerCase() === "true" ? "require" : "disable";

  return `postgresql://${encodeURIComponent(user)}:${encodeURIComponent(password)}@${host}:${port}/${database}?sslmode=${ssl}`;
}

export async function getDb(): Promise<DbConnection | null> {
  if (cachedDb) {
    return cachedDb;
  }

  cachedDb = {
    vendor: "timescaledb",
    dsn: buildDsn(),
  };

  return cachedDb;
}
