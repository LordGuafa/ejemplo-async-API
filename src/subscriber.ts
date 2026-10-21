import { config } from "./config";
import { GREETING_TOPIC, parseGreeting } from "./contract";
import { createClient } from "./mqtt-client";

const client = createClient("subscriber");
client.on("connect", () => {
  client.subscribe(GREETING_TOPIC, { qos: config.MQTT_QOS }, (error) => {
    if (error) {
      console.error("Error al suscribirse al tema:", error.message);
      process.exitCode = 1;
    }
    console.log(`Suscrito a "${GREETING_TOPIC}" con QoS ${config.MQTT_QOS}`);
  });
});

client.on("message", (topic: string, payload: Buffer) => {
  const result = parseGreeting(payload);
  if (!result.ok) {
    console.error(
      `Mensaje descartado en "${topic}": ${result.error.message}: ${result.error.details ?? ""}`,
    );
    return;
  }
  const { name, message, sentAt } = result.value;
  console.log(`Hola ${name}, dice: "${message}" (enviado a las ${sentAt})`);
});

client.on("error", (error) =>
  console.error("Error de conexión", error.message),
);

const shutdown = (): void => {
  console.log("\nCerrando conexión");
  client.end(false, {}, () => process.exit(0));
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
