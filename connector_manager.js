/**
 * Connector Manager for Industrial Protocols (OPC-UA, Modbus TCP/RTU)
 * Simulates connections to PLC/MES/SCADA systems
 */

const CONNECTOR_TYPES = {
  OPC_UA: "OPC-UA",
  MODBUS_TCP: "Modbus TCP",
  MODBUS_RTU: "Modbus RTU",
};

const CONNECTOR_STATUSES = {
  CONNECTED: "connected",
  DISCONNECTED: "disconnected",
  ERROR: "error",
  INITIALIZING: "initializing",
};

class ConnectorConfig {
  constructor(id, type, name, host, port, config = {}) {
    this.id = id;
    this.type = type;
    this.name = name;
    this.host = host;
    this.port = port;
    this.status = CONNECTOR_STATUSES.INITIALIZING;
    this.lastConnectedAt = null;
    this.lastErrorMessage = null;
    this.pollingInterval = config.pollingInterval || 5000; // ms
    this.nodeIds = config.nodeIds || []; // For OPC-UA
    this.registers = config.registers || []; // For Modbus
    this.createdAt = new Date().toISOString();
    this.updatedAt = new Date().toISOString();
  }

  toJSON() {
    return {
      id: this.id,
      type: this.type,
      name: this.name,
      host: this.host,
      port: this.port,
      status: this.status,
      lastConnectedAt: this.lastConnectedAt,
      lastErrorMessage: this.lastErrorMessage,
      pollingInterval: this.pollingInterval,
      nodeIds: this.nodeIds,
      registers: this.registers,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
    };
  }
}

class ConnectorManager {
  constructor() {
    this.connectors = new Map();
    this.nextId = 1;
    this.initializeDefaultConnectors();
  }

  initializeDefaultConnectors() {
    // Simulated default connectors
    const defaultConnectors = [
      new ConnectorConfig(
        this.nextId++,
        CONNECTOR_TYPES.OPC_UA,
        "PLC Compresseur A",
        "192.168.1.100",
        4840,
        {
          nodeIds: ["ns=2;s=Compressor.PowerKw", "ns=2;s=Compressor.Pressure"],
          pollingInterval: 5000,
        }
      ),
      new ConnectorConfig(
        this.nextId++,
        CONNECTOR_TYPES.MODBUS_TCP,
        "MES Four Industriel C",
        "192.168.1.101",
        502,
        {
          registers: [100, 101, 102, 103],
          pollingInterval: 10000,
        }
      ),
    ];

    // Simulate random connection status
    defaultConnectors.forEach(connector => {
      connector.status = Math.random() > 0.3 ? CONNECTOR_STATUSES.CONNECTED : CONNECTOR_STATUSES.ERROR;
      if (connector.status === CONNECTOR_STATUSES.CONNECTED) {
        connector.lastConnectedAt = new Date().toISOString();
      } else {
        connector.lastErrorMessage = "Simulation: Connection timeout";
      }
      this.connectors.set(connector.id, connector);
    });
  }

  addConnector(type, name, host, port, config = {}) {
    if (!Object.values(CONNECTOR_TYPES).includes(type)) {
      throw new Error(`Invalid connector type: ${type}`);
    }

    const connector = new ConnectorConfig(this.nextId++, type, name, host, port, config);
    connector.status = CONNECTOR_STATUSES.CONNECTED;
    connector.lastConnectedAt = new Date().toISOString();
    this.connectors.set(connector.id, connector);
    return connector;
  }

  getConnector(id) {
    return this.connectors.get(Number(id)) || null;
  }

  listConnectors() {
    return Array.from(this.connectors.values());
  }

  updateConnector(id, updates) {
    const connector = this.getConnector(id);
    if (!connector) return null;

    Object.assign(connector, updates, { updatedAt: new Date().toISOString() });
    return connector;
  }

  deleteConnector(id) {
    return this.connectors.delete(Number(id));
  }

  testConnection(id) {
    const connector = this.getConnector(id);
    if (!connector) return { success: false, error: "Connector not found" };

    // Simulate connection test
    const success = Math.random() > 0.2;
    if (success) {
      connector.status = CONNECTOR_STATUSES.CONNECTED;
      connector.lastConnectedAt = new Date().toISOString();
      connector.lastErrorMessage = null;
      return { success: true, message: "Connection successful" };
    } else {
      connector.status = CONNECTOR_STATUSES.ERROR;
      connector.lastErrorMessage = "Simulation: Connection refused";
      return { success: false, error: "Connection refused" };
    }
  }

  getConnectorStatus() {
    const connectors = this.listConnectors();
    const connected = connectors.filter(c => c.status === CONNECTOR_STATUSES.CONNECTED).length;
    const disconnected = connectors.filter(c => c.status === CONNECTOR_STATUSES.DISCONNECTED).length;
    const errors = connectors.filter(c => c.status === CONNECTOR_STATUSES.ERROR).length;

    return {
      total: connectors.length,
      connected,
      disconnected,
      errors,
      connectors: connectors.map(c => c.toJSON()),
    };
  }
}

module.exports = {
  ConnectorManager,
  ConnectorConfig,
  CONNECTOR_TYPES,
  CONNECTOR_STATUSES,
};
