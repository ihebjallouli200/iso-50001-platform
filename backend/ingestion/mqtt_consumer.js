/**
 * MQTT Consumer — HiveMQ Cloud + JSON Store.
 * Subscribes to energy/machine/+ and updates the store via
 * updateMachineLiveFromMqtt() for each incoming message.
 */

const BROKER_URL = process.env.MQTT_BROKER_URL || "mqtt://localhost:1883";
const MQTT_USERNAME = process.env.MQTT_USERNAME || "";
const MQTT_PASSWORD = process.env.MQTT_PASSWORD || "";
const TOPIC = process.env.MQTT_TOPIC_MEASUREMENTS || "energy/machine/+";
const CLIENT_ID = process.env.MQTT_CLIENT_ID || "enms-mqtt-consumer";

const { pushEvent } = require("./ingestion_health");

let mqttModule = null;
try {
  mqttModule = require("mqtt");
} catch (_) {
  mqttModule = null;
}

// Reference to the store update function
let _updateFn = null;

function setUpdateFunction(fn) {
  _updateFn = fn;
}

function toMessagePayload(payloadText) {
  const parsed = JSON.parse(payloadText);
  if (Array.isArray(parsed)) return parsed;
  if (parsed && typeof parsed === "object") return [parsed];
  return [];
}

let _messageCount = 0;

async function processMqttMessage(topic, payloadBuffer) {
  const payloadText = payloadBuffer.toString("utf8");
  let rows;

  try {
    rows = toMessagePayload(payloadText);
  } catch (error) {
    pushEvent("mqtt_parse_error", {
      topic,
      reason: "invalid_json_payload",
      detail: error instanceof Error ? error.message : String(error),
    });
    return;
  }

  _messageCount += rows.length;

  // Log every 50 messages
  if (_messageCount % 50 === 0) {
    console.log(`[mqtt] received ${_messageCount} messages total`);
  }

  pushEvent("mqtt_message", { topic, rowCount: rows.length });

  // Update store for each row
  for (const row of rows) {
    if (typeof _updateFn === "function") {
      try {
        _updateFn(row);
      } catch (err) {
        console.error(`[mqtt] store update error: ${err.message}`);
      }
    }
  }
}

function run(updateFn) {
  if (typeof updateFn === "function") {
    setUpdateFunction(updateFn);
  }

  if (!mqttModule || typeof mqttModule.connect !== "function") {
    console.log("[mqtt] mqtt package not available — skipping");
    return null;
  }

  const isSecure = BROKER_URL.startsWith("mqtts://") || BROKER_URL.startsWith("wss://");
  const connectOptions = {
    clientId: CLIENT_ID,
    reconnectPeriod: 5000,
    connectTimeout: 10000,
  };

  if (MQTT_USERNAME) connectOptions.username = MQTT_USERNAME;
  if (MQTT_PASSWORD) connectOptions.password = MQTT_PASSWORD;
  if (isSecure) {
    connectOptions.rejectUnauthorized = true;
    connectOptions.protocol = "mqtts";
  }

  console.log(`[mqtt] connecting to ${BROKER_URL} (tls=${isSecure})...`);
  const client = mqttModule.connect(BROKER_URL, connectOptions);

  client.on("connect", () => {
    console.log(`[mqtt] connected to ${BROKER_URL}`);
    client.subscribe(TOPIC, err => {
      if (err) {
        console.error(`[mqtt] subscribe failed: ${err.message}`);
        return;
      }
      console.log(`[mqtt] subscribed to ${TOPIC}`);
    });
  });

  client.on("message", (topic, payloadBuffer) => {
    processMqttMessage(topic, payloadBuffer).catch(err => {
      console.error(`[mqtt] message error: ${err.message}`);
    });
  });

  client.on("reconnect", () => console.warn("[mqtt] reconnecting..."));
  client.on("error", err => console.error(`[mqtt] error: ${err.message}`));

  return client;
}

module.exports = { run, setUpdateFunction, processMqttMessage };
