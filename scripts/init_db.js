/**
 * Initialize PostgreSQL database on Render with schema + seed data.
 * Usage: node scripts/init_db.js
 */
const { Pool } = require("pg");

const pool = new Pool({
  host: "dpg-d7ib2ajbc2fs73dqvl2g-a.frankfurt-postgres.render.com",
  port: 5432,
  database: "enms",
  user: "enms",
  password: "PL03RHzWEaibhGSMMZ5eTE9Qzj5VM2BA",
  ssl: { rejectUnauthorized: false },
  connectionTimeoutMillis: 15000,
});

async function main() {
  console.log("Connecting to Render PostgreSQL...");
  const client = await pool.connect();
  console.log("Connected!");

  try {
    // 1. Create table
    console.log("\n1. Creating machine_telemetry table...");
    await client.query(`
      CREATE TABLE IF NOT EXISTS machine_telemetry (
        timestamp TIMESTAMPTZ NOT NULL,
        machine_id TEXT NOT NULL,
        kwh DOUBLE PRECISION NOT NULL,
        kva DOUBLE PRECISION NOT NULL,
        cos_phi DOUBLE PRECISION NOT NULL,
        thd_v DOUBLE PRECISION NOT NULL,
        thd_i DOUBLE PRECISION NOT NULL,
        harm_3 DOUBLE PRECISION NOT NULL,
        harm_5 DOUBLE PRECISION NOT NULL,
        harm_7 DOUBLE PRECISION NOT NULL,
        output_pieces INTEGER NOT NULL DEFAULT 0,
        output_tonnage DOUBLE PRECISION NOT NULL DEFAULT 0,
        etat INTEGER NOT NULL DEFAULT 1,
        oee DOUBLE PRECISION NOT NULL DEFAULT 0,
        label_anomalie INTEGER NOT NULL DEFAULT 0
      )
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_mt_ts ON machine_telemetry(timestamp DESC)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_mt_m_ts ON machine_telemetry(machine_id, timestamp DESC)`);
    console.log("   Table + indexes created!");

    // 2. Seed 15 machines x 60 minutes of data
    console.log("\n2. Seeding 15 machines x 60 minutes...");
    const now = new Date();
    let inserted = 0;
    let anomalies = 0;

    for (let m = 1; m <= 15; m++) {
      const values = [];
      const placeholders = [];

      for (let i = 0; i < 60; i++) {
        const ts = new Date(now.getTime() - (60 - i) * 60000);
        const kwh = 0.1 + Math.random() * 0.3;
        const cos = 0.78 + Math.random() * 0.18;
        const kva = kwh / cos;
        const isAnomaly = (m === 6 && i > 50) || (m === 13 && i > 55) ? 1 : 0;
        const etat = isAnomaly ? 0 : (Math.random() > 0.9 ? 2 : 1);
        const oee = isAnomaly ? 0 : 60 + Math.random() * 35;

        const base = values.length;
        values.push(
          ts.toISOString(), String(m),
          kwh.toFixed(4), kva.toFixed(4), cos.toFixed(4),
          (3 + Math.random() * 3).toFixed(2),
          (6 + Math.random() * 10).toFixed(2),
          (0.01 + Math.random() * 0.02).toFixed(4),
          (0.03 + Math.random() * 0.05).toFixed(4),
          (0.01 + Math.random() * 0.04).toFixed(4),
          Math.floor(Math.random() * 100),
          (Math.random() * 5).toFixed(2),
          etat, oee.toFixed(1), isAnomaly
        );

        const p = Array.from({ length: 15 }, (_, j) => `$${base + j + 1}`);
        placeholders.push(`(${p.join(",")})`);
        inserted++;
        if (isAnomaly) anomalies++;
      }

      await client.query(
        `INSERT INTO machine_telemetry(timestamp,machine_id,kwh,kva,cos_phi,thd_v,thd_i,harm_3,harm_5,harm_7,output_pieces,output_tonnage,etat,oee,label_anomalie) VALUES ${placeholders.join(",")}`,
        values
      );
      process.stdout.write(`   Machine ${m}/15\r`);
    }
    console.log(`   Done: ${inserted} rows, ${anomalies} anomalies`);

    // 3. Verify
    console.log("\n3. Verification:");
    const count = await client.query("SELECT count(*) FROM machine_telemetry");
    console.log(`   Total rows: ${count.rows[0].count}`);

    const summary = await client.query(`
      SELECT machine_id, count(*) as rows,
             min(timestamp) as first_ts, max(timestamp) as last_ts,
             avg(kwh)::numeric(6,4) as avg_kwh,
             sum(label_anomalie) as anomalies
      FROM machine_telemetry
      GROUP BY machine_id
      ORDER BY machine_id::int
    `);
    console.log("\n   Machine | Rows | Anomalies | Avg kWh");
    console.log("   --------|------|-----------|--------");
    for (const r of summary.rows) {
      console.log(`   M${r.machine_id.padStart(2)}     | ${r.rows}   | ${r.anomalies}         | ${r.avg_kwh}`);
    }

    console.log("\n✅ Database initialized successfully!");
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch(e => {
  console.error("ERROR:", e.message);
  process.exit(1);
});
