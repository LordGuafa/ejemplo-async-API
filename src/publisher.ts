import { config } from "./config";
import {
  GREETING_TOPIC,
  validateGreeting,
  type GreetingPayload,
} from "./contract";
import { createClient } from "./mqtt-client";

const draft: GreetingPayload = {
  name: config.PUBLISHER_NAME,
  message: "Por la gloria del Omnissiah, ¡saludos desde el Zar-Quaesitor!",
  sentAt: new Date().toISOString(),
};
const validation = validateGreeting(draft);
if (!validation.ok) {
  console.error(
    `${validation.error.message}: ${validation.error.details ?? ""}`,
  );
  process.exit(1);
}

const client = createClient("publisher");

client.on("connect", () => {
  client.publish(
    GREETING_TOPIC,
    JSON.stringify(validation.value),
    { qos: config.MQTT_QOS },
    (error) => {
      if (error) {
        console.error(`Error al publicar: ${error.message}`);
        process.exitCode = 1;
      } else {
        console.log(`Publicado en "${GREETING_TOPIC}":`, validation.value);
      }
      client.end();
    },
  );
});

client.on("error", (error) => {
  console.error("Error de conexión", error.message);
  process.exitCode = 1;
  client.end();
});
