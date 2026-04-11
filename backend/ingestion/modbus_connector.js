/**
 * Modbus TCP Connector for ISO 50001 Energy Management
 * ------------------------------------------------------
 * Reads energy meters and PLCs via Modbus TCP protocol
 * and feeds measurements into the ingestion pipeline.
 *
 * Configuration via environment variables:
 *   MODBUS_HOST           - Modbus TCP host (default: 127.0.0.1)
 *   MODBUS_PORT           - Modbus TCP port (default: 502)
 *   MODBUS_UNIT_ID        - Modbus unit/slave ID (default: 1)
 *   MODBUS_POLL_INTERVAL_MS - Polling interval in ms (default: 5000)
 *
 * Usage:
 *   const { startModbusConnector } = require('./modbus_connector');
 *   startModbusConnector(store);
 */

const MODBUS_HOST = process.env.MODBUS_HOST || "127.0.0.1";
const MODBUS_PORT = Number(process.env.MODBUS_PORT || 502);
const MODBUS_UNIT_ID = Number(process.env.MODBUS_UNIT_ID || 1);
const POLL_INTERVAL_MS = Number(process.env.MODBUS_POLL_INTERVAL_MS || 5000);

const { pushEvent } = require("./ingestion_health");

/**
 * Default register map: maps Modbus registers to measurement fields.
 * Each entry specifies the machine, register address, length, data type, and scale factor.
 *
 * Override with MODBUS_REGISTER_MAP env var (JSON string) for custom meters.
 */
const DEFAULT_REGISTER_MAP = [
  {
    machineId: 1,
    unitId: 1,
    registers: [
      { field: "powerKw",    address: 0,  length: 2, type: "float32", scale: 1.0 },
      { field: "kva",        address: 2,  length: 2, type: "float32", scale: 1.0 },
      { field: "cosPhi",     address: 4,  length: 2, type: "float32", scale: 1.0 },
      { field: "thdVoltage", address: 6,  length: 2, type: "float32", scale: 1.0 },
      { field: "thdCurrent", address: 8,  length: 2, type: "float32", scale: 1.0 },
      { field: "loadPct",    address: 10, length: 1, type: "uint16",  scale: 0.1 },
      { field: "enpi",       address: 11, length: 2, type: "float32", scale: 1.0 },
    ],
  },
  {
    machineId: 2,
    unitId: 2,
    registers: [
      { field: "powerKw",    address: 0,  length: 2, type: "float32", scale: 1.0 },
      { field: "kva",        address: 2,  length: 2, type: "float32", scale: 1.0 },
      { field: "cosPhi",     address: 4,  length: 2, type: "float32", scale: 1.0 },
      { field: "thdVoltage", address: 6,  length: 2, type: "float32", scale: 1.0 },
      { field: "thdCurrent", address: 8,  length: 2, type: "float32", scale: 1.0 },
      { field: "loadPct",    address: 10, length: 1, type: "uint16",  scale: 0.1 },
      { field: "enpi",       address: 11, length: 2, type: "float32", scale: 1.0 },
    ],
  },
];

function getRegisterMap() {
  try {
    const envMap = process.env.MODBUS_REGISTER_MAP;
    if (envMap) return JSON.parse(envMap);
  } catch (error) {
    console.error("[modbus] Failed to parse MODBUS_REGISTER_MAP:", error.message);
  }
  return DEFAULT_REGISTER_MAP;
}

/**
 * Decode raw register values to a numeric value.
 */
function decodeRegisters(buffer, type, scale) {
  let value;
  switch (type) {
    case "float32":
      value = buffer.readFloatBE(0);
      break;
    case "int16":
      value = buffer.readInt16BE(0);
      break;
    case "uint16":
      value = buffer.readUInt16BE(0);
      break;
    case "int32":
      value = buffer.readInt32BE(0);
      break;
    case "uint32":
      value = buffer.readUInt32BE(0);
      break;
    default:
      value = buffer.readUInt16BE(0);
  }
  return Number((value * scale).toFixed(4));
}

/**
 * Create a Modbus TCP client connection.
 * Uses raw TCP sockets — no external dependency required.
 */
function createModbusTcpClient(host, port) {
  const net = require("net");

  let transactionId = 0;
  let socket = null;
  let connected = false;
  const pendingRequests = new Map();

  function connect() {
    return new Promise((resolve, reject) => {
      socket = new net.Socket();
      socket.setTimeout(5000);

      socket.connect(port, host, () => {
        connected = true;
        console.log(`[modbus] Connected to ${host}:${port}`);
        resolve();
      });

      socket.on("data", (data) => {
        if (data.length < 9) return;
        const tid = data.readUInt16BE(0);
        const pending = pendingRequests.get(tid);
        if (pending) {
          pendingRequests.delete(tid);
          const byteCount = data[8];
          const payload = data.slice(9, 9 + byteCount);
          pending.resolve(payload);
        }
      });

      socket.on("error", (err) => {
        connected = false;
        reject(err);
      });

      socket.on("close", () => {
        connected = false;
      });

      socket.on("timeout", () => {
        socket.destroy();
        connected = false;
        reject(new Error("Connection timeout"));
      });
    });
  }

  function readHoldingRegisters(unitId, address, length) {
    return new Promise((resolve, reject) => {
      if (!connected || !socket) {
        reject(new Error("Not connected"));
        return;
      }

      transactionId = (transactionId + 1) & 0xffff;
      const tid = transactionId;

      // Build Modbus TCP ADU
      const pdu = Buffer.alloc(6);
      pdu.writeUInt8(unitId, 0);        // Unit ID
      pdu.writeUInt8(0x03, 1);           // Function code: Read Holding Registers
      pdu.writeUInt16BE(address, 2);     // Start address
      pdu.writeUInt16BE(length, 4);      // Quantity

      const header = Buffer.alloc(6);
      header.writeUInt16BE(tid, 0);      // Transaction ID
      header.writeUInt16BE(0, 2);        // Protocol ID (Modbus)
      header.writeUInt16BE(pdu.length, 4); // Length

      const frame = Buffer.concat([header, pdu]);

      const timeout = setTimeout(() => {
        pendingRequests.delete(tid);
        reject(new Error("Request timeout"));
      }, 3000);

      pendingRequests.set(tid, {
        resolve: (data) => {
          clearTimeout(timeout);
          resolve(data);
        },
        reject: (err) => {
          clearTimeout(timeout);
          reject(err);
        },
      });

      socket.write(frame);
    });
  }

  function disconnect() {
    if (socket) {
      socket.destroy();
      connected = false;
    }
  }

  return { connect, readHoldingRegisters, disconnect, isConnected: () => connected };
}

/**
 * Poll all configured machines via Modbus TCP.
 */
async function pollMachines(client, registerMap) {
  const measurements = [];

  for (const machine of registerMap) {
    const row = {
      machineId: machine.machineId,
      timestamp: new Date().toISOString(),
      sourceType: "modbus",
    };

    for (const reg of machine.registers) {
      try {
        const buffer = await client.readHoldingRegisters(
          machine.unitId || MODBUS_UNIT_ID,
          reg.address,
          reg.length
        );
        row[reg.field] = decodeRegisters(buffer, reg.type, reg.scale);
      } catch (error) {
        console.warn(`[modbus] read_error machine=${machine.machineId} field=${reg.field}: ${error.message}`);
      }
    }

    measurements.push(row);
  }

  return measurements;
}

/**
 * Start the Modbus TCP connector loop.
 * @param {object} store - The runtime store for writing measurements
 */
async function startModbusConnector(store) {
  const registerMap = getRegisterMap();
  const client = createModbusTcpClient(MODBUS_HOST, MODBUS_PORT);

  console.log(`[modbus] Connecting to ${MODBUS_HOST}:${MODBUS_PORT}...`);

  try {
    await client.connect();

    pushEvent("modbus_connected", {
      host: MODBUS_HOST,
      port: MODBUS_PORT,
      sourceType: "modbus",
    });

    const pollInterval = setInterval(async () => {
      try {
        const measurements = await pollMachines(client, registerMap);

        for (const measurement of measurements) {
          if (store && typeof store.ingestMeasurement === "function") {
            store.ingestMeasurement(measurement);
          }

          if (store && store.machineLive) {
            const liveEntry = store.machineLive.find(
              (e) => Number(e.machineId) === Number(measurement.machineId)
            );
            if (liveEntry) {
              Object.assign(liveEntry, {
                powerKw: measurement.powerKw ?? liveEntry.powerKw,
                enpi: measurement.enpi ?? liveEntry.enpi,
                loadPct: measurement.loadPct ?? liveEntry.loadPct,
                updatedAt: measurement.timestamp,
              });
            }
          }
        }

        pushEvent("modbus_poll_success", {
          machineCount: measurements.length,
          sourceType: "modbus",
        });
      } catch (error) {
        console.error(`[modbus] poll_error: ${error.message}`);
        pushEvent("modbus_poll_error", {
          error: error.message,
          sourceType: "modbus",
        });
      }
    }, POLL_INTERVAL_MS);

    process.on("SIGINT", () => {
      console.log("[modbus] Shutting down...");
      clearInterval(pollInterval);
      client.disconnect();
      console.log("[modbus] Disconnected.");
    });

    return { client, pollInterval };
  } catch (error) {
    console.error(`[modbus] connection_failed: ${error.message}`);
    console.log("[modbus] Connector not started — running in offline mode.");
    pushEvent("modbus_connection_failed", {
      error: error.message,
      host: MODBUS_HOST,
      port: MODBUS_PORT,
      sourceType: "modbus",
    });
    return null;
  }
}

module.exports = {
  startModbusConnector,
  createModbusTcpClient,
  pollMachines,
  decodeRegisters,
  getRegisterMap,
  MODBUS_HOST,
  MODBUS_PORT,
  POLL_INTERVAL_MS,
};
