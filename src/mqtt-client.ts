import { randomUUID } from "node:crypto";
import { connect, type IClientOptions, type MqttClient } from "mqtt";
import { config } from "./config";

export type ClientRole = "publisher" | "subscriber";

export function createClient(role: ClientRole): MqttClient {
  const options: IClientOptions = {
    clientId: `${config.MQTT_CLIENT_ID_PREFIX}-${role}-${randomUUID().slice(0, 8)}`,
    clean: true,
    connectTimeout: 10_000,
    // El suscriptor es de larga vida y reconecta; el publicador falla rápido.
    reconnectPeriod: role === "subscriber" ? 2_000 : 0,
    ...(config.MQTT_USERNAME ? { username: config.MQTT_USERNAME } : {}),
    ...(config.MQTT_PASSWORD ? { password: config.MQTT_PASSWORD } : {}),
  };
  return connect(config.MQTT_URL, options);
}
