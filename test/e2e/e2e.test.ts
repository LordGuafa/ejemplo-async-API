import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  ComposeStack,
  getFreePort,
  runProcess,
  type RunResult,
} from "./helpers";

const TIMESTAMP = Date.now();
const PROJECT = `e2e-${TIMESTAMP}`;
const IMAGE_TAG = `e2e-${TIMESTAMP}`;
const IMAGE_NAME = `ejemplo-async-api-app:${IMAGE_TAG}`;
const GREETING_TOPIC = "greetings/hello";
const TEST_TIMEOUT = 120_000;

let compose: ComposeStack;

function validPayload(name: string, message = "¡Hola mundo!"): string {
  return JSON.stringify({
    name,
    message,
    sentAt: new Date().toISOString(),
  });
}

async function publishRaw(message: string, qos = "1"): Promise<void> {
  const result = await compose.compose(
    [
      "exec",
      "-T",
      "mosquitto",
      "mosquitto_pub",
      "-q",
      qos,
      "-t",
      GREETING_TOPIC,
      "-m",
      message,
    ],
    60_000,
  );
  expect(result.code, `mosquitto_pub falló: ${result.combined}`).toBe(0);
}

/**
 * Publica reintentando hasta que el log esperado aparezca. Se usa en escenarios
 * de reconexión, donde la suscripción puede tardar en restablecerse y un único
 * publish podría perderse (sesión limpia, sin suscripción en el momento del envío).
 */
async function publishUntilLogged(
  message: string,
  expectedLog: string,
  timeoutMs: number,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await publishRaw(message);
    try {
      await compose.waitForLog("subscriber", expectedLog, 4_000);
      return;
    } catch {
      // El mensaje se perdió por la carrera de reconexión: reintentar.
    }
  }
  throw new Error(
    `Timeout de ${timeoutMs} ms publicando "${message}" hasta ver "${expectedLog}"`,
  );
}

function runPublisher(extraArgs: string[] = []): Promise<RunResult> {
  return compose.compose(["run", "--rm", ...extraArgs, "publisher"], TEST_TIMEOUT);
}

beforeAll(async () => {
  const freePort = await getFreePort();
  compose = new ComposeStack(
    PROJECT,
    {
      MQTT_HOST_PORT: String(freePort),
      IMAGE_TAG,
      // Valores base explícitos para que ni el entorno del host ni el archivo
      // .env del proyecto (que Compose lee automáticamente) alteren la
      // interpolación `${VAR:-default}` de forma no determinista.
      PUBLISHER_NAME: "Ana",
      MQTT_QOS: "1",
      MQTT_CLIENT_ID_PREFIX: "greeting",
      ASYNCAPI_PATH: "asyncapi.yaml",
    },
    180_000,
  );

  const build = await compose.compose(["build", "subscriber"], 900_000);
  expect(build.code, `Fallo al construir la imagen:\n${build.combined}`).toBe(0);

  const up = await compose.compose(["up", "-d", "mosquitto", "subscriber"], 300_000);
  expect(up.code, `Fallo al levantar el stack:\n${up.combined}`).toBe(0);

  await compose.waitForLog("subscriber", "Suscrito a", 90_000);
}, 1_200_000);

afterAll(async () => {
  if (compose) {
    await compose.compose(["down", "-v", "--remove-orphans"], 180_000);
    // Limpieza best-effort de la imagen única de esta ejecución.
    await runProcess("docker", ["image", "rm", IMAGE_NAME], process.env, 60_000);
  }
});

describe("e2e: ejemplo AsyncAPI + MQTT sobre Docker Compose", () => {
  it(
    "1: flujo feliz — el publicador termina con código 0 y el suscriptor muestra el saludo de Ana",
    async () => {
      const result = await runPublisher();
      expect(result.code, `publisher falló:\n${result.combined}`).toBe(0);
      await compose.waitForLog(
        "subscriber",
        'Hola Ana, dice: "¡Hola, mundo!"',
        30_000,
      );
    },
    TEST_TIMEOUT,
  );

  it(
    "2: el nombre del publicador se puede cambiar con PUBLISHER_NAME",
    async () => {
      const result = await runPublisher(["-e", "PUBLISHER_NAME=Carlos"]);
      expect(result.code, `publisher falló:\n${result.combined}`).toBe(0);
      await compose.waitForLog("subscriber", "Hola Carlos, dice:", 30_000);
    },
    TEST_TIMEOUT,
  );

  it(
    "3: un JSON incompleto se descarta y el suscriptor sigue en ejecución",
    async () => {
      const before = await compose.inspect("subscriber");
      await publishRaw('{"name":"X"}');
      await compose.waitForLog("subscriber", "must have required property", 30_000);
      const logs = await compose.logs("subscriber");
      expect(logs).toContain("Mensaje descartado");

      const after = await compose.inspect("subscriber");
      expect(after.State.Status).toBe("running");
      expect(after.State.RestartCount).toBe(before.State.RestartCount);
      expect(after.State.StartedAt).toBe(before.State.StartedAt);
    },
    TEST_TIMEOUT,
  );

  it(
    "4: un texto que no es JSON se descarta con el mensaje «no es un JSON válido»",
    async () => {
      await publishRaw("hola");
      await compose.waitForLog("subscriber", "no es un JSON válido", 30_000);
      const logs = await compose.logs("subscriber");
      expect(logs).toContain("Mensaje descartado");

      const after = await compose.inspect("subscriber");
      expect(after.State.Status).toBe("running");
    },
    TEST_TIMEOUT,
  );

  it(
    "5: un campo extra no declarado se descarta por contrato",
    async () => {
      await publishRaw(
        JSON.stringify({
          name: "Valeria",
          message: "Saludo",
          sentAt: new Date().toISOString(),
          extra: "sorpresa",
        }),
      );
      await compose.waitForLog(
        "subscriber",
        "must NOT have additional properties",
        30_000,
      );
      const after = await compose.inspect("subscriber");
      expect(after.State.Status).toBe("running");
    },
    TEST_TIMEOUT,
  );

  it(
    "6: tras mensajes inválidos, un saludo válido posterior se procesa correctamente",
    async () => {
      await publishRaw(validPayload("Posterior", "Todo sigue bien"));
      await compose.waitForLog("subscriber", "Hola Posterior, dice:", 30_000);
    },
    TEST_TIMEOUT,
  );

  it(
    "7: MQTT_QOS=7 hace fallar el publicador al arrancar",
    async () => {
      const result = await runPublisher(["-e", "MQTT_QOS=7"]);
      expect(result.code, "El publicador debería fallar").not.toBe(0);
      expect(result.combined).toContain("Configuración inválida");
      expect(result.combined).toContain("MQTT_QOS");
    },
    TEST_TIMEOUT,
  );

  it(
    "8: NODE_ENV=production con mqtt:// exige mqtts:// y falla",
    async () => {
      const result = await runPublisher([
        "-e",
        "NODE_ENV=production",
        "-e",
        "MQTT_URL=mqtt://mosquitto:1883",
      ]);
      expect(result.code, "El publicador debería fallar").not.toBe(0);
      expect(result.combined).toContain("mqtts://");
    },
    TEST_TIMEOUT,
  );

  it(
    "9: con el broker apagado el publicador termina con error de conexión",
    async () => {
      try {
        const stop = await compose.compose(["stop", "mosquitto"], 120_000);
        expect(stop.code).toBe(0);

        const result = await compose.compose(
          ["run", "--rm", "--no-deps", "publisher"],
          TEST_TIMEOUT,
        );
        expect(result.code, "El publicador debería fallar").not.toBe(0);
        expect(result.combined).toMatch(
          /Error de conexión|ENOTFOUND|ECONNREFUSED|Connection refused|Not found/i,
        );
      } finally {
        await compose.compose(["start", "mosquitto"], 120_000);
      }
    },
    TEST_TIMEOUT,
  );

  it(
    "10: el suscriptor se reconecta cuando el broker vuelve y recibe saludos nuevos",
    async () => {
      const stop = await compose.compose(["stop", "mosquitto"], 120_000);
      expect(stop.code).toBe(0);
      await compose.waitForLog("subscriber", "Error de conexión", 60_000);

      const start = await compose.compose(["start", "mosquitto"], 120_000);
      expect(start.code).toBe(0);

      // Tras reconectar, el manejador de "connect" vuelve a suscribirse:
      // debe aparecer una segunda línea "Suscrito a ...".
      await compose.waitForLog("subscriber", "Suscrito a", 90_000, 2);

      await publishUntilLogged(
        validPayload("Reconectado"),
        "Hola Reconectado, dice:",
        30_000,
      );
    },
    TEST_TIMEOUT,
  );

  it(
    "11: docker compose stop subscriber cierra ordenado (código 0, <10 s, log «Cerrando conexión»)",
    async () => {
      const startedAt = Date.now();
      const stop = await compose.compose(["stop", "subscriber"], 60_000);
      const elapsed = Date.now() - startedAt;

      expect(stop.code).toBe(0);
      expect(elapsed, `stop tardó ${elapsed} ms`).toBeLessThan(10_000);

      const info = await compose.inspect("subscriber");
      expect(info.State.Status).toBe("exited");
      expect(info.State.ExitCode).toBe(0);

      const logs = await compose.logs("subscriber");
      expect(logs).toContain("Cerrando conexión");
    },
    TEST_TIMEOUT,
  );

  it(
    "12: la imagen segura — el proceso no corre como root y no contiene .env",
    async () => {
      const uid = await compose.compose(
        ["run", "--rm", "--no-deps", "--entrypoint", "id", "subscriber", "-u"],
        TEST_TIMEOUT,
      );
      expect(uid.code, `id falló:\n${uid.combined}`).toBe(0);
      const uidNumber = uid.stdout.trim();
      expect(uidNumber).toMatch(/^\d+$/);
      expect(uidNumber, "El contenedor corre como root").not.toBe("0");

      const envCheck = await compose.compose(
        [
          "run",
          "--rm",
          "--no-deps",
          "--entrypoint",
          "sh",
          "subscriber",
          "-c",
          "test ! -f /app/.env && echo 'OK: sin .env'",
        ],
        TEST_TIMEOUT,
      );
      expect(envCheck.code, envCheck.combined).toBe(0);
      expect(envCheck.stdout).toContain("OK: sin .env");
    },
    TEST_TIMEOUT,
  );
});
