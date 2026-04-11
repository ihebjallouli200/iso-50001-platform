/**
 * OPC-UA Connector for ISO 50001 Energy Management
 * --------------------------------------------------
 * Connects to PLC/MES/SCADA via OPC-UA and feeds measurements
 * into the ingestion pipeline (TimescaleDB + InfluxDB).
 *
 * Configuration via environment variables:
 *   OPCUA_ENDPOINT_URL   - OPC-UA server endpoint (default: opc.tcp://localhost:4840)
 *   OPCUA_NAMESPACE_INDEX - Namespace index for energy nodes (default: 2)
 *   OPCUA_POLL_INTERVAL_MS - Polling interval in ms (default: 5000)
 *   OPCUA_SECURITY_MODE  - Security mode: None, Sign, SignAndEncrypt (default: None)
 *
 * Usage:
 *   const { startOpcuaConnector } = require('./opcua_connector');
 *   startOpcuaConnector(store);
 */

const ENDPOINT_URL = process.env.OPCUA_ENDPOINT_URL || "opc.tcp://localhost:4840";
const NAMESPACE_INDEX = Number(process.env.OPCUA_NAMESPACE_INDEX || 2);
const POLL_INTERVAL_MS = Number(process.env.OPCUA_POLL_INTERVAL_MS || 5000);
const SECURITY_MODE = process.env.OPCUA_SECURITY_MODE || "None";

const { pushEvent } = require("./ingestion_health");

let opcuaModule = null;
try {
  opcuaModule = require("node-opcua");
} catch {
  opcuaModule = null;
}

/**
 * Default node mapping: maps OPC-UA node IDs to measurement fields.
 * Override with OPCUA_NODE_MAP env var (JSON string) for custom installations.
 */
const DEFAULT_NODE_MAP = [
  {
    machineId: 1,
    nodes: {
      powerKw:     `ns=${NAMESPACE_INDEX};s=Machine1.PowerKw`,
      enpi:        `ns=${NAMESPACE_INDEX};s=Machine1.EnPI`,
      loadPct:     `ns=${NAMESPACE_INDEX};s=Machine1.LoadPercent`,
      kva:         `ns=${NAMESPACE_INDEX};s=Machine1.ApparentPower`,
      cosPhi:      `ns=${NAMESPACE_INDEX};s=Machine1.PowerFactor`,
      thdVoltage:  `ns=${NAMESPACE_INDEX};s=Machine1.THD_Voltage`,
      thdCurrent:  `ns=${NAMESPACE_INDEX};s=Machine1.THD_Current`,
      oee:         `ns=${NAMESPACE_INDEX};s=Machine1.OEE`,
      outputPieces:`ns=${NAMESPACE_INDEX};s=Machine1.OutputPieces`,
    },
  },
  {
    machineId: 2,
    nodes: {
      powerKw:     `ns=${NAMESPACE_INDEX};s=Machine2.PowerKw`,
      enpi:        `ns=${NAMESPACE_INDEX};s=Machine2.EnPI`,
      loadPct:     `ns=${NAMESPACE_INDEX};s=Machine2.LoadPercent`,
      kva:         `ns=${NAMESPACE_INDEX};s=Machine2.ApparentPower`,
      cosPhi:      `ns=${NAMESPACE_INDEX};s=Machine2.PowerFactor`,
      thdVoltage:  `ns=${NAMESPACE_INDEX};s=Machine2.THD_Voltage`,
      thdCurrent:  `ns=${NAMESPACE_INDEX};s=Machine2.THD_Current`,
      oee:         `ns=${NAMESPACE_INDEX};s=Machine2.OEE`,
      outputPieces:`ns=${NAMESPACE_INDEX};s=Machine2.OutputPieces`,
    },
  },
];

function getNodeMap() {
  try {
    const envMap = process.env.OPCUA_NODE_MAP;
    if (envMap) return JSON.parse(envMap);
  } catch (error) {
    console.error("[opcua] Failed to parse OPCUA_NODE_MAP:", error.message);
  }
  return DEFAULT_NODE_MAP;
}

/**
 * Read a single value from an OPC-UA node.
 */
async function readNode(session, nodeId) {
  try {
    const dataValue = await session.read({
      nodeId,
      attributeId: opcuaModule.AttributeIds.Value,
    });
    return dataValue.value?.value ?? null;
  } catch (error) {
    console.warn(`[opcua] read_error node=${nodeId}: ${error.message}`);
    return null;
  }
}

/**
 * Poll all configured machines and return measurement rows.
 */
async function pollAllMachines(session) {
  const nodeMap = getNodeMap();
  const measurements = [];

  for (const machine of nodeMap) {
    const row = {
      machineId: machine.machineId,
      timestamp: new Date().toISOString(),
      sourceType: "opcua",
    };

    for (const [field, nodeId] of Object.entries(machine.nodes)) {
      const value = await readNode(session, nodeId);
      if (value !== null && value !== undefined) {
        row[field] = Number(value);
      }
    }

    measurements.push(row);

    pushEvent("opcua_read", {
      machineId: machine.machineId,
      fieldsRead: Object.keys(machine.nodes).length,
      sourceType: "opcua",
    });
  }

  return measurements;
}

/**
 * Start the OPC-UA connector loop.
 * @param {object} store - The runtime store for writing measurements
 */
async function startOpcuaConnector(store) {
  if (!opcuaModule || typeof opcuaModule.OPCUAClient !== "function") {
    console.error("[opcua] node-opcua package not available. Install with: npm install node-opcua");
    console.log("[opcua] Connector not started — running in offline mode.");
    return null;
  }

  const securityModeMap = {
    None: opcuaModule.MessageSecurityMode.None,
    Sign: opcuaModule.MessageSecurityMode.Sign,
    SignAndEncrypt: opcuaModule.MessageSecurityMode.SignAndEncrypt,
  };

  const client = opcuaModule.OPCUAClient.create({
    applicationName: "EnMS-ISO50001-OpcuaConnector",
    connectionStrategy: {
      initialDelay: 2000,
      maxRetry: 10,
      maxDelay: 30000,
    },
    securityMode: securityModeMap[SECURITY_MODE] || opcuaModule.MessageSecurityMode.None,
    endpointMustExist: false,
  });

  console.log(`[opcua] Connecting to ${ENDPOINT_URL} (security=${SECURITY_MODE})...`);

  try {
    await client.connect(ENDPOINT_URL);
    console.log(`[opcua] Connected to ${ENDPOINT_URL}`);

    const session = await client.createSession();
    console.log(`[opcua] Session created. Polling every ${POLL_INTERVAL_MS}ms`);

    pushEvent("opcua_connected", {
      endpoint: ENDPOINT_URL,
      security: SECURITY_MODE,
      sourceType: "opcua",
    });

    // Polling loop
    const pollInterval = setInterval(async () => {
      try {
        const measurements = await pollAllMachines(session);

        for (const measurement of measurements) {
          // Write to runtime store (same pattern as MQTT consumer)
          if (store && typeof store.ingestMeasurement === "function") {
            store.ingestMeasurement(measurement);
          }

          // Update machineLive snapshot
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

        pushEvent("opcua_poll_success", {
          machineCount: measurements.length,
          sourceType: "opcua",
        });
      } catch (error) {
        console.error(`[opcua] poll_error: ${error.message}`);
        pushEvent("opcua_poll_error", {
          error: error.message,
          sourceType: "opcua",
        });
      }
    }, POLL_INTERVAL_MS);

    // Graceful shutdown
    process.on("SIGINT", async () => {
      console.log("[opcua] Shutting down...");
      clearInterval(pollInterval);
      await session.close();
      await client.disconnect();
      console.log("[opcua] Disconnected.");
    });

    return { client, session, pollInterval };
  } catch (error) {
    console.error(`[opcua] connection_failed: ${error.message}`);
    pushEvent("opcua_connection_failed", {
      error: error.message,
      endpoint: ENDPOINT_URL,
      sourceType: "opcua",
    });
    return null;
  }
}

module.exports = {
  startOpcuaConnector,
  pollAllMachines,
  readNode,
  getNodeMap,
  ENDPOINT_URL,
  POLL_INTERVAL_MS,
};
