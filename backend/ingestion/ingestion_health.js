const HEALTH_EVENT_LIMIT = Number(process.env.INGESTION_HEALTH_EVENT_LIMIT || 100);

const state = {
  startedAt: new Date().toISOString(),
  lastBatchRunAt: null,
  lastMqttMessageAt: null,
  batchRuns: 0,
  mqttMessages: 0,
  fallbackWrites: 0,
  timescaleSuccessWrites: 0,
  timescaleFailedWrites: 0,
  influxMirrorSuccessWrites: 0,
  influxMirrorFailedWrites: 0,
  recentEvents: [],
};

function pushEvent(type, payload = {}) {
  const event = {
    id: `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    type,
    payload,
    at: new Date().toISOString(),
  };

  state.recentEvents.unshift(event);
  if (state.recentEvents.length > HEALTH_EVENT_LIMIT) {
    state.recentEvents.length = HEALTH_EVENT_LIMIT;
  }

  if (type === "batch_run") {
    state.lastBatchRunAt = event.at;
    state.batchRuns += 1;
  }
  if (type === "mqtt_message") {
    state.lastMqttMessageAt = event.at;
    state.mqttMessages += 1;
  }
  if (type === "timescale_write_success") {
    state.timescaleSuccessWrites += 1;
  }
  if (type === "timescale_write_failed") {
    state.timescaleFailedWrites += 1;
  }
  if (type === "json_fallback_write") {
    state.fallbackWrites += 1;
  }
  if (type === "influx_mirror_write_success") {
    state.influxMirrorSuccessWrites += 1;
  }
  if (type === "influx_mirror_write_failed") {
    state.influxMirrorFailedWrites += 1;
  }

  return event;
}

function getIngestionHealthSnapshot(limit = 20) {
  const safeLimit = Math.max(1, Math.min(200, Number(limit) || 20));
  return {
    startedAt: state.startedAt,
    lastBatchRunAt: state.lastBatchRunAt,
    lastMqttMessageAt: state.lastMqttMessageAt,
    counters: {
      batchRuns: state.batchRuns,
      mqttMessages: state.mqttMessages,
      fallbackWrites: state.fallbackWrites,
      timescaleSuccessWrites: state.timescaleSuccessWrites,
      timescaleFailedWrites: state.timescaleFailedWrites,
      influxMirrorSuccessWrites: state.influxMirrorSuccessWrites,
      influxMirrorFailedWrites: state.influxMirrorFailedWrites,
    },
    recentEvents: state.recentEvents.slice(0, safeLimit),
  };
}

module.exports = {
  pushEvent,
  getIngestionHealthSnapshot,
};
