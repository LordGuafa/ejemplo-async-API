import { randomUUID } from "node:crypto";
import { connect, type IClientOptions, type MqttClient } from "mqtt";
import { config, type Config } from "./config";

export type ClientRole = "publisher" | "subscriber";

/**
 * Construye las opciones del cliente sin abrir conexiones. Es una función pura
 * para poder probar la política de sesiones (clean/clientId/MQTT 5) en unitarias.
 */
export function buildClientOptions(
  role: ClientRole,
  cfg: Config,
): IClientOptions {
  const persistentSubscriber =
    role === "subscriber" && cfg.MQTT_PERSISTENT_SESSION;

  return {
    // La sesión persistente exige un clientId estable: con uno aleatorio el
    // broker nunca reconoce al mismo cliente y no puede entregarle su cola.
    clientId: persistentSubscriber
      ? cfg.MQTT_SUBSCRIBER_CLIENT_ID
      : `${cfg.MQTT_CLIENT_ID_PREFIX}-${role}-${randomUUID().slice(0, 8)}`,
    clean: !persistentSubscriber,
    connectTimeout: 10_000,
    // El suscriptor es de larga vida y reconecta; el publicador falla rápido.
    reconnectPeriod: role === "subscriber" ? 2_000 : 0,
    // En MQTT 5 una sesión sin sessionExpiryInterval expira al desconectarse,
    // por eso la versión de protocolo y la propiedad van siempre juntas.
    ...(cfg.MQTT_SESSION_EXPIRY_SECONDS !== undefined
      ? {
          protocolVersion: 5 as const,
          properties: {
            sessionExpiryInterval: cfg.MQTT_SESSION_EXPIRY_SECONDS,
          },
        }
      : {}),
    ...(cfg.MQTT_USERNAME ? { username: cfg.MQTT_USERNAME } : {}),
    ...(cfg.MQTT_PASSWORD ? { password: cfg.MQTT_PASSWORD } : {}),
  };
}

export function createClient(role: ClientRole): MqttClient {
  return connect(config.MQTT_URL, buildClientOptions(role, config));
}
