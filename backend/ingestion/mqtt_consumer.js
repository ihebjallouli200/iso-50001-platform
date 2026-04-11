const BROKER_URL = process.env.MQTT_BROKER_URL || "mqtt://localhost:1883";
const TOPIC = process.env.MQTT_TOPIC_MEASUREMENTS || "energy/machine/+";
const CLIENT_ID = process.env.MQTT_CLIENT_ID || "enms-mqtt-consumer";

const { writeMeasurements } = require("./timescale_writer");
const { pushEvent } = require("./ingestion_health");

let mqttModule = null;
try {
  mqttModule = require("mqtt");
} catch (_) {
  mqttModule = null;
}

function toMessagePayload(payloadText) {
  const parsed = JSON.parse(payloadText);
  if (Array.isArray(parsed)) {
    return parsed;
  }
  if (parsed && typeof parsed === "object") {
    return [parsed];
  }
  return [];
}

async function processMqttMessage(topic, payloadBuffer) {
  const payloadText = payloadBuffer.toString("utf8");
  let rows;

  try {
    rows = toMessagePayload(payloadText);
  } catch (error) {
    pushEvent("timescale_write_failed", {
      sourceType: "synthetic_mqtt",
      sourceName: topic,
      reason: "invalid_json_payload",
      detail: error instanceof Error ? error.message : String(error),
    });
    return;
  }

  pushEvent("mqtt_message", {
    topic,
    rowCount: rows.length,
  });

  const writeResult = await writeMeasurements(rows, {
    sourceType: "synthetic_mqtt",
    sourceName: topic,
  });

  if (writeResult.ok) {
    pushEvent("timescale_write_success", {
      sourceType: "synthetic_mqtt",
      sourceName: topic,
      insertedRows: writeResult.insertedRows,
      rejectedRows: writeResult.rejectedRows,
      ingestionId: writeResult.ingestionId,
    });
    return;
  }

  pushEvent("timescale_write_failed", {
    sourceType: "synthetic_mqtt",
    sourceName: topic,
    reason: writeResult.error,
    detail: writeResult.message || null,
  });
}

function run() {
  if (!mqttModule || typeof mqttModule.connect !== "function") {
    console.error("[ingestion] mqtt package missing. Install with: npm install mqtt");
    return null;
  }

  const client = mqttModule.connect(BROKER_URL, {
    clientId: CLIENT_ID,
    reconnectPeriod: 2500,
  });

  client.on("connect", () => {
    console.log(`[ingestion] mqtt consumer connected broker=${BROKER_URL}`);
    client.subscribe(TOPIC, error => {
      if (error) {
        console.error(`[ingestion] subscribe_failed topic=${TOPIC} error=${error.message}`);
        return;
      }
      console.log(`[ingestion] subscribed topic=${TOPIC}`);
    });
  });

  client.on("message", (topic, payloadBuffer) => {
    processMqttMessage(topic, payloadBuffer).catch(error => {
      pushEvent("timescale_write_failed", {
        sourceType: "synthetic_mqtt",
        sourceName: topic,
        reason: "unhandled_message_error",
        detail: error instanceof Error ? error.message : String(error),
      });
    });
  });

  client.on("reconnect", () => {
    console.warn("[ingestion] mqtt reconnecting...");
  });

  client.on("error", error => {
    console.error(`[ingestion] mqtt_error ${error.message}`);
  });

  return client;
}

if (require.main === module) {
  run();
}

module.exports = {
  run,
  processMqttMessage,
};
