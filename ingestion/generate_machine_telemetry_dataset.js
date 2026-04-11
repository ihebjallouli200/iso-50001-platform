const fs = require("fs");
const path = require("path");

function parseArgs() {
  const args = process.argv.slice(2);
  const out = {
    input: "data/raw/synthetic_measurements.csv",
    output: "data/processed/machine_telemetry_1min_12m.csv",
    machineCount: 10,
    totalMinutes: 525600,
    start: "2025-01-01T00:00:00Z",
    anomalyRate: 0.05,
  };

  for (let i = 0; i < args.length; i += 1) {
    const a = args[i];
    const next = args[i + 1];
    if (a === "--input" && next) out.input = next;
    if (a === "--output" && next) out.output = next;
    if (a === "--machine-count" && next) out.machineCount = Number(next);
    if (a === "--total-minutes" && next) out.totalMinutes = Number(next);
    if (a === "--start" && next) out.start = next;
    if (a === "--anomaly-rate" && next) out.anomalyRate = Number(next);
  }

  return out;
}

function gcd(a, b) {
  let x = Math.abs(a);
  let y = Math.abs(b);
  while (y !== 0) {
    const tmp = x % y;
    x = y;
    y = tmp;
  }
  return x;
}

function buildAnomalyPlan(totalMinutes, machineSeed, targetAnomalies) {
  const flags = new Uint8Array(totalMinutes);
  const types = new Uint8Array(totalMinutes);
  let anomalyCount = 0;

  const blockLength = 45;
  const idleBlockBudget = Math.max(1, Math.floor(targetAnomalies * 0.2 / blockLength));

  for (let block = 0; block < idleBlockBudget; block += 1) {
    let start = (machineSeed * 9973 + block * 10007) % Math.max(1, totalMinutes - blockLength - 1);
    let guard = 0;
    while (guard < totalMinutes) {
      let occupied = false;
      for (let offset = 0; offset < blockLength; offset += 1) {
        if (flags[start + offset] === 1) {
          occupied = true;
          break;
        }
      }
      if (!occupied) break;
      start = (start + 53) % Math.max(1, totalMinutes - blockLength - 1);
      guard += 1;
    }

    for (let offset = 0; offset < blockLength; offset += 1) {
      const idx = start + offset;
      if (flags[idx] === 0) {
        flags[idx] = 1;
        types[idx] = 7;
        anomalyCount += 1;
      }
    }
  }

  let step = 7919;
  if (gcd(step, totalMinutes) !== 1) {
    step = 7917;
    while (gcd(step, totalMinutes) !== 1) {
      step += 2;
    }
  }

  let cursor = (machineSeed * 1871) % totalMinutes;
  let typeCursor = 0;
  const typeCycle = [1, 2, 3, 4, 5, 6];

  while (anomalyCount < targetAnomalies) {
    if (flags[cursor] === 0) {
      flags[cursor] = 1;
      types[cursor] = typeCycle[typeCursor % typeCycle.length];
      typeCursor += 1;
      anomalyCount += 1;
    }
    cursor = (cursor + step) % totalMinutes;
  }

  return { flags, types, anomalyCount };
}

function parseCsvLine(line) {
  return line.split(",");
}

function toNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function boolLike(value) {
  const s = String(value || "").trim().toLowerCase();
  return s === "true" || s === "1" || s === "yes";
}

function machineStateToEtat(value) {
  const s = String(value || "").trim().toLowerCase();
  if (s === "running" || s === "run" || s === "marche") return 1;
  if (s === "idle") return 2;
  return 0;
}

function seededNoise(seed) {
  let x = Math.sin(seed * 12.9898) * 43758.5453;
  x = x - Math.floor(x);
  return (x - 0.5) * 2;
}

function fmtNsUtc(dateObj) {
  const iso = dateObj.toISOString();
  return iso.replace(".000Z", ".000000000Z");
}

function interpolate(a, b, t) {
  return a + (b - a) * t;
}

function main() {
  const cfg = parseArgs();
  const inputPath = path.resolve(cfg.input);
  const outputPath = path.resolve(cfg.output);

  if (!fs.existsSync(inputPath)) {
    throw new Error(`Input file not found: ${inputPath}`);
  }

  const raw = fs.readFileSync(inputPath, "utf8").trim();
  const lines = raw.split(/\r?\n/);
  if (lines.length < 2) {
    throw new Error("Input CSV is empty");
  }

  const headers = parseCsvLine(lines[0]).map((s) => s.trim());
  const idx = Object.fromEntries(headers.map((h, i) => [h, i]));

  const requiredSourceColumns = [
    "timestamp",
    "kWh",
    "kVA",
    "cosPhiVoltage",
    "cosPhiCurrent",
    "thdVoltage",
    "thdCurrent",
    "oee",
    "outputPieces",
    "outputTonnage",
    "machineState",
    "isAnomaly",
    "anomalyLabel",
    "machineId",
  ];

  for (const col of requiredSourceColumns) {
    if (!(col in idx)) {
      throw new Error(`Missing expected source column: ${col}`);
    }
  }

  const machineMap = new Map();

  for (let i = 1; i < lines.length; i += 1) {
    const cols = parseCsvLine(lines[i]);
    const machineId = String(cols[idx.machineId] || "").trim();
    if (!machineId) continue;

    const point = {
      tsMs: Date.parse(String(cols[idx.timestamp] || "").trim()),
      kwh: toNumber(cols[idx.kWh]),
      kva: toNumber(cols[idx.kVA]),
      cosV: toNumber(cols[idx.cosPhiVoltage]),
      cosI: toNumber(cols[idx.cosPhiCurrent]),
      thdV: toNumber(cols[idx.thdVoltage]),
      thdI: toNumber(cols[idx.thdCurrent]),
      oeeRaw: toNumber(cols[idx.oee]),
      outputPieces: toNumber(cols[idx.outputPieces]),
      outputTonnage: toNumber(cols[idx.outputTonnage]),
      etat: machineStateToEtat(cols[idx.machineState]),
      isAnomaly: boolLike(cols[idx.isAnomaly]) || String(cols[idx.anomalyLabel] || "").trim().length > 0 ? 1 : 0,
    };

    if (!Number.isFinite(point.tsMs)) continue;

    if (!machineMap.has(machineId)) machineMap.set(machineId, []);
    machineMap.get(machineId).push(point);
  }

  const selectedMachines = [...machineMap.keys()]
    .sort((a, b) => String(a).localeCompare(String(b), undefined, { numeric: true }))
    .slice(0, cfg.machineCount);

  if (selectedMachines.length < 10) {
    throw new Error(`Not enough machines in source: found ${selectedMachines.length}, required at least 10.`);
  }

  for (const machineId of selectedMachines) {
    machineMap.get(machineId).sort((a, b) => a.tsMs - b.tsMs);
  }

  const startMs = Date.parse(cfg.start);
  if (!Number.isFinite(startMs)) {
    throw new Error(`Invalid start timestamp: ${cfg.start}`);
  }

  if (!Number.isFinite(cfg.anomalyRate) || cfg.anomalyRate < 0.03 || cfg.anomalyRate > 0.08) {
    throw new Error(`anomaly-rate must be between 0.03 and 0.08, got: ${cfg.anomalyRate}`);
  }

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  const ws = fs.createWriteStream(outputPath, { encoding: "utf8" });

  ws.write(
    "timestamp,machine_id,kwh,kva,cos_phi,thd_v,thd_i,harm_3,harm_5,harm_7,output_pieces,output_tonnage,etat,oee,label_anomalie\n"
  );

  const templateMinutes = 17280 * 15;
  const machineSummaries = [];
  let totalAnomalies = 0;

  for (const machineId of selectedMachines) {
    const arr = machineMap.get(machineId);
    const machineSeed = Number(machineId) || 1;
    const targetAnomalies = Math.round(cfg.totalMinutes * cfg.anomalyRate);
    const anomalyPlan = buildAnomalyPlan(cfg.totalMinutes, machineSeed, targetAnomalies);

    const avgKva = arr.reduce((acc, row) => acc + row.kva, 0) / arr.length;
    const avgKwh = arr.reduce((acc, row) => acc + row.kwh, 0) / arr.length;
    const perType = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0, 7: 0 };

    for (let minute = 0; minute < cfg.totalMinutes; minute += 1) {
      const ts = new Date(startMs + minute * 60000);
      const tsStr = fmtNsUtc(ts);

      const srcMinute = minute % templateMinutes;
      const lowIndex = Math.floor(srcMinute / 15) % arr.length;
      const highIndex = (lowIndex + 1) % arr.length;
      const frac = (srcMinute % 15) / 15;

      const low = arr[lowIndex];
      const high = arr[highIndex];

      let kwh = interpolate(low.kwh, high.kwh, frac);
      let kva = interpolate(low.kva, high.kva, frac);
      let cosPhi = clamp(interpolate((low.cosV + low.cosI) / 2, (high.cosV + high.cosI) / 2, frac), 0, 1);
      let thdV = Math.max(0, interpolate(low.thdV, high.thdV, frac));
      let thdI = Math.max(0, interpolate(low.thdI, high.thdI, frac));

      const noise = seededNoise((Number(machineId) || 1) * 1000003 + minute);
      let harm3 = Math.max(0, thdV * 0.45 + noise * 0.08);
      let harm5 = Math.max(0, thdV * 0.30 + noise * 0.06);
      let harm7 = Math.max(0, thdV * 0.20 + noise * 0.05);

      let outputPieces = Math.max(0, Math.round(interpolate(low.outputPieces, high.outputPieces, frac)));
      let outputTonnage = Math.max(0, interpolate(low.outputTonnage, high.outputTonnage, frac));

      let etat = frac < 0.5 ? low.etat : high.etat;
      let oeePct = clamp(interpolate(low.oeeRaw * 100, high.oeeRaw * 100, frac), 0, 100);

      let anomaly = 0;
      const anomalyType = anomalyPlan.types[minute];
      if (anomalyPlan.flags[minute] === 1 && anomalyType > 0) {
        anomaly = 1;
        perType[anomalyType] += 1;

        if (anomalyType === 1) {
          if (etat === 0) etat = 2;
          thdV = Math.max(8.5, thdV * 2.2);
          thdI = Math.max(8.5, thdI * 2.2);
        } else if (anomalyType === 2) {
          cosPhi = Math.min(cosPhi, 0.82);
        } else if (anomalyType === 3) {
          harm5 = Math.max(harm5, 5.6);
          harm7 = Math.max(harm7, 5.2);
        } else if (anomalyType === 4) {
          kva = Math.max(kva, avgKva * 1.25);
        } else if (anomalyType === 5) {
          kwh = kwh * 1.25;
        } else if (anomalyType === 6) {
          oeePct = Math.min(oeePct, 55);
        } else if (anomalyType === 7) {
          etat = 2;
          kwh = Math.max(kwh, avgKwh * 0.35, 1);
        }
      }

      oeePct = clamp(oeePct, 0, 100);
      etat = clamp(Math.round(etat), 0, 2);

      const row = [
        tsStr,
        String(machineId),
        kwh.toFixed(6),
        kva.toFixed(6),
        cosPhi.toFixed(6),
        thdV.toFixed(6),
        thdI.toFixed(6),
        harm3.toFixed(6),
        harm5.toFixed(6),
        harm7.toFixed(6),
        String(outputPieces),
        outputTonnage.toFixed(6),
        String(etat),
        oeePct.toFixed(4),
        String(anomaly),
      ].join(",");

      ws.write(`${row}\n`);
    }

    totalAnomalies += anomalyPlan.anomalyCount;
    machineSummaries.push({
      machineId,
      totalRows: cfg.totalMinutes,
      anomalyRows: anomalyPlan.anomalyCount,
      anomalyRate: Number((anomalyPlan.anomalyCount / cfg.totalMinutes).toFixed(6)),
      anomalyTypeDistribution: {
        electrical_thd_over_8: perType[1],
        electrical_cos_phi_low: perType[2],
        electrical_harmonics_over_5: perType[3],
        electrical_kva_spike_without_output: perType[4],
        productive_kwh_drift_no_oee_drop: perType[5],
        productive_oee_below_60_normal_kwh: perType[6],
        productive_idle_over_30min_with_kwh: perType[7],
      },
    });
  }

  ws.end();

  ws.on("finish", () => {
    const totalRows = selectedMachines.length * cfg.totalMinutes;
    console.log(
      JSON.stringify(
        {
          ok: true,
          input: cfg.input,
          output: cfg.output,
          machines: selectedMachines,
          machineCount: selectedMachines.length,
          totalMinutesPerMachine: cfg.totalMinutes,
          totalRows,
          anomalyRows: totalAnomalies,
          globalAnomalyRate: Number((totalAnomalies / totalRows).toFixed(6)),
          start: cfg.start,
          end: fmtNsUtc(new Date(startMs + (cfg.totalMinutes - 1) * 60000)),
          machineSummaries,
        },
        null,
        2
      )
    );
  });
}

main();
