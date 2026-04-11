import argparse
import csv
import json
import os
import uuid
from datetime import datetime, timezone
from pathlib import Path

import psycopg
from dotenv import load_dotenv


TARGET_TABLE_DEFAULT = os.getenv("TIMESCALE_MEASUREMENTS_TABLE", "energy_measurements_synthetic")
REJECTIONS_TABLE_DEFAULT = os.getenv("TIMESCALE_REJECTIONS_TABLE", "energy_ingestion_rejections")


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def read_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Batch loader CSV synthétique vers TimescaleDB")
    parser.add_argument("--csv", required=True, help="Chemin CSV source")
    parser.add_argument("--source-name", required=True, help="Nom logique de la source")
    parser.add_argument("--source-type", default="synthetic_batch", help="Type source (default: synthetic_batch)")
    parser.add_argument("--target-table", default=TARGET_TABLE_DEFAULT)
    parser.add_argument("--rejections-table", default=REJECTIONS_TABLE_DEFAULT)
    parser.add_argument("--max-rows", type=int, default=1_000_000)
    parser.add_argument("--batch-date", default=datetime.now(timezone.utc).strftime("%Y-%m-%d"))
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--rejections-out", default="", help="Fichier JSONL de rejet (optionnel)")
    return parser.parse_args()


def validate_table_name(value: str) -> str:
    candidate = str(value or "").strip()
    if not candidate:
        raise ValueError("Table name is required")
    if not candidate.replace("_", "").isalnum() or candidate[0].isdigit():
        raise ValueError(f"Unsafe table name: {candidate}")
    return candidate


def build_dsn() -> str:
    host = os.getenv("TIMESCALE_HOST", "localhost")
    port = int(os.getenv("TIMESCALE_PORT", "5432"))
    db = os.getenv("TIMESCALE_DB", "enms")
    user = os.getenv("TIMESCALE_USER", "enms")
    pwd = os.getenv("TIMESCALE_PASSWORD", "enms")
    sslmode = "require" if os.getenv("TIMESCALE_SSL", "false").lower() == "true" else "disable"
    return f"postgresql://{user}:{pwd}@{host}:{port}/{db}?sslmode={sslmode}"


def ensure_tables(cur, target_table: str, rejections_table: str) -> None:
    cur.execute(
        f"""
        CREATE TABLE IF NOT EXISTS {target_table} (
          id BIGSERIAL PRIMARY KEY,
          ts TIMESTAMPTZ NOT NULL,
          machine_id INTEGER NOT NULL,
          machine_type TEXT NULL,
          kwh DOUBLE PRECISION NOT NULL,
          kva DOUBLE PRECISION NOT NULL,
          cos_phi_voltage DOUBLE PRECISION NULL,
          cos_phi_current DOUBLE PRECISION NULL,
          thd_voltage DOUBLE PRECISION NULL,
          thd_current DOUBLE PRECISION NULL,
          oee DOUBLE PRECISION NULL,
          production DOUBLE PRECISION NULL,
          source_type TEXT NOT NULL,
          source_name TEXT NOT NULL,
          ingestion_id TEXT NOT NULL,
          ingested_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
        CREATE INDEX IF NOT EXISTS idx_{target_table}_ts ON {target_table}(ts DESC);
        CREATE INDEX IF NOT EXISTS idx_{target_table}_machine_ts ON {target_table}(machine_id, ts DESC);
        """
    )

    cur.execute(
        f"""
        CREATE TABLE IF NOT EXISTS {rejections_table} (
          id BIGSERIAL PRIMARY KEY,
          ingestion_id TEXT NOT NULL,
          batch_date DATE NOT NULL,
          line_no BIGINT NULL,
          reason TEXT NOT NULL,
          row_payload JSONB NOT NULL,
          source_type TEXT NOT NULL,
          source_name TEXT NOT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
        CREATE INDEX IF NOT EXISTS idx_{rejections_table}_ingestion ON {rejections_table}(ingestion_id);
        CREATE INDEX IF NOT EXISTS idx_{rejections_table}_batch ON {rejections_table}(batch_date);
        """
    )


def create_temp_staging(cur) -> None:
    cur.execute(
        """
        CREATE TEMP TABLE tmp_ingestion_staging (
          line_no BIGSERIAL,
          timestamp TEXT,
          machineId TEXT,
          machineType TEXT,
          kWh TEXT,
          kVA TEXT,
          cosPhiVoltage TEXT,
          cosPhiCurrent TEXT,
          thdVoltage TEXT,
          thdCurrent TEXT,
          oee TEXT,
          production TEXT
        ) ON COMMIT DROP;
        """
    )


def run_copy(cur, csv_path: Path) -> None:
    copy_sql = """
        COPY tmp_ingestion_staging (
          timestamp,
          machineId,
          machineType,
          kWh,
          kVA,
          cosPhiVoltage,
          cosPhiCurrent,
          thdVoltage,
          thdCurrent,
          oee,
          production
        ) FROM STDIN WITH (FORMAT CSV, HEADER TRUE)
    """

    with csv_path.open("r", encoding="utf-8", newline="") as source:
        with cur.copy(copy_sql) as copy:
            while True:
                chunk = source.read(1024 * 1024)
                if not chunk:
                    break
                copy.write(chunk)


def valid_row_predicate() -> str:
    numeric = r"'^-?\\d+(\\.\\d+)?$'"
    return f"""
      timestamp IS NOT NULL AND timestamp <> ''
      AND machineId ~ '^[0-9]+$'
      AND kWh ~ {numeric}
      AND kVA ~ {numeric}
      AND (cosPhiVoltage IS NULL OR cosPhiVoltage = '' OR cosPhiVoltage ~ {numeric})
      AND (cosPhiCurrent IS NULL OR cosPhiCurrent = '' OR cosPhiCurrent ~ {numeric})
      AND (thdVoltage IS NULL OR thdVoltage = '' OR thdVoltage ~ {numeric})
      AND (thdCurrent IS NULL OR thdCurrent = '' OR thdCurrent ~ {numeric})
      AND (oee IS NULL OR oee = '' OR oee ~ {numeric})
      AND (production IS NULL OR production = '' OR production ~ {numeric})
    """


def insert_valid_rows(cur, target_table: str, source_type: str, source_name: str, ingestion_id: str) -> int:
    predicate = valid_row_predicate()
    cur.execute(
        f"""
        INSERT INTO {target_table} (
          ts,
          machine_id,
          machine_type,
          kwh,
          kva,
          cos_phi_voltage,
          cos_phi_current,
          thd_voltage,
          thd_current,
          oee,
          production,
          source_type,
          source_name,
          ingestion_id
        )
        SELECT
          timestamp::timestamptz,
          machineId::int,
          NULLIF(machineType, ''),
          kWh::double precision,
          kVA::double precision,
          NULLIF(cosPhiVoltage, '')::double precision,
          NULLIF(cosPhiCurrent, '')::double precision,
          NULLIF(thdVoltage, '')::double precision,
          NULLIF(thdCurrent, '')::double precision,
          NULLIF(oee, '')::double precision,
          NULLIF(production, '')::double precision,
          %s,
          %s,
          %s
        FROM tmp_ingestion_staging
        WHERE {predicate}
        """,
        (source_type, source_name, ingestion_id),
    )
    return int(cur.rowcount or 0)


def insert_rejections(cur, rejections_table: str, source_type: str, source_name: str, ingestion_id: str, batch_date: str) -> int:
    predicate = valid_row_predicate()
    cur.execute(
        f"""
        INSERT INTO {rejections_table} (
          ingestion_id,
          batch_date,
          line_no,
          reason,
          row_payload,
          source_type,
          source_name
        )
        SELECT
          %s,
          %s::date,
          line_no,
          CASE
            WHEN timestamp IS NULL OR timestamp = '' THEN 'timestamp_missing'
            WHEN machineId IS NULL OR machineId !~ '^[0-9]+$' THEN 'machineId_invalid'
            WHEN kWh IS NULL OR kWh !~ '^-?\\d+(\\.\\d+)?$' THEN 'kWh_invalid'
            WHEN kVA IS NULL OR kVA !~ '^-?\\d+(\\.\\d+)?$' THEN 'kVA_invalid'
            ELSE 'row_invalid'
          END,
          jsonb_build_object(
            'timestamp', timestamp,
            'machineId', machineId,
            'machineType', machineType,
            'kWh', kWh,
            'kVA', kVA,
            'cosPhiVoltage', cosPhiVoltage,
            'cosPhiCurrent', cosPhiCurrent,
            'thdVoltage', thdVoltage,
            'thdCurrent', thdCurrent,
            'oee', oee,
            'production', production
          ),
          %s,
          %s
        FROM tmp_ingestion_staging
        WHERE NOT ({predicate})
        """,
        (ingestion_id, batch_date, source_type, source_name),
    )
    return int(cur.rowcount or 0)


def count_staging_rows(cur) -> int:
    cur.execute("SELECT COUNT(*)::int FROM tmp_ingestion_staging")
    row = cur.fetchone()
    return int(row[0]) if row else 0


def export_rejections_jsonl(conn, rejections_table: str, ingestion_id: str, output_path: Path) -> None:
    with conn.cursor() as cur:
        cur.execute(
            f"""
            SELECT line_no, reason, row_payload
            FROM {rejections_table}
            WHERE ingestion_id = %s
            ORDER BY line_no ASC NULLS LAST
            """,
            (ingestion_id,),
        )
        rows = cur.fetchall()

    output_path.parent.mkdir(parents=True, exist_ok=True)
    with output_path.open("w", encoding="utf-8") as out:
        for line_no, reason, payload in rows:
            out.write(json.dumps({"lineNo": line_no, "reason": reason, "row": payload}, ensure_ascii=False) + "\n")


def ensure_csv_has_required_headers(csv_path: Path) -> None:
    with csv_path.open("r", encoding="utf-8", newline="") as f:
        reader = csv.reader(f)
        try:
            headers = next(reader)
        except StopIteration as exc:
            raise ValueError("CSV vide") from exc

    normalized = {h.strip() for h in headers}
    required = {"timestamp", "machineId", "kWh", "kVA"}
    missing = sorted(required - normalized)
    if missing:
        raise ValueError(f"Colonnes obligatoires manquantes: {', '.join(missing)}")


def main() -> None:
    load_dotenv()
    args = read_args()

    csv_path = Path(args.csv).resolve()
    if not csv_path.exists() or not csv_path.is_file():
        raise FileNotFoundError(f"CSV introuvable: {csv_path}")

    if args.max_rows < 1:
        raise ValueError("--max-rows doit être >= 1")

    target_table = validate_table_name(args.target_table)
    rejections_table = validate_table_name(args.rejections_table)

    source_name = args.source_name.strip()
    source_type = args.source_type.strip().lower()
    if "synthetic" not in source_name.lower() and source_type != "manual":
        raise ValueError("source-name doit contenir 'synthetic' (policy synthetic-only)")

    ensure_csv_has_required_headers(csv_path)
    ingestion_id = str(uuid.uuid4())

    if args.dry_run:
        result = {
            "ok": True,
            "dryRun": True,
            "ingestionId": ingestion_id,
            "csv": str(csv_path),
            "sourceName": source_name,
            "sourceType": source_type,
            "checkedAt": utc_now_iso(),
        }
        print(json.dumps(result, ensure_ascii=False))
        return

    dsn = build_dsn()
    with psycopg.connect(dsn) as conn:
        with conn.cursor() as cur:
            ensure_tables(cur, target_table, rejections_table)
            create_temp_staging(cur)
            run_copy(cur, csv_path)
            total_rows = count_staging_rows(cur)

            if total_rows > args.max_rows:
                raise ValueError(f"Lot trop volumineux: {total_rows} > max_rows={args.max_rows}")

            inserted_rows = insert_valid_rows(cur, target_table, source_type, source_name, ingestion_id)
            rejected_rows = insert_rejections(cur, rejections_table, source_type, source_name, ingestion_id, args.batch_date)

        conn.commit()

        if args.rejections_out and rejected_rows > 0:
            export_rejections_jsonl(conn, rejections_table, ingestion_id, Path(args.rejections_out).resolve())

    result = {
        "ok": True,
        "ingestionId": ingestion_id,
        "csv": str(csv_path),
        "sourceName": source_name,
        "sourceType": source_type,
        "targetTable": target_table,
        "rejectionsTable": rejections_table,
        "batchDate": args.batch_date,
        "rowCount": total_rows,
        "insertedRows": inserted_rows,
        "rejectedRows": rejected_rows,
        "startedAt": utc_now_iso(),
    }
    print(json.dumps(result, ensure_ascii=False))


if __name__ == "__main__":
    main()
