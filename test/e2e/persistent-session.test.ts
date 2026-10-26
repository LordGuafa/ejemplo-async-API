import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ComposeStack, getFreePort, runProcess } from "./helpers";

const TIMESTAMP = Date.now();
const PROJECT = `e2e-session-${TIMESTAMP}`;
const IMAGE_TAG = `e2e-session-${TIMESTAMP}`;
const IMAGE_NAME = `ejemplo-async-api-app:${IMAGE_TAG}`;
const GREETING_TOPIC = "greetings/hello";
const TEST_TIMEOUT = 240_000;
const RUN_TIMEOUT = 300_000;
const DEFAULT_CONF = resolve(process.cwd(), "mosquitto/mosquitto.conf");
const LIMITED_QUEUE_CONF = resolve(
  process.cwd(),
  "test/e2e/mosquitto-queue-limit.conf",
);

const BASE_ENV: NodeJS.ProcessEnv = {
  IMAGE_TAG,
  MQTT_QOS: "1",
  MQTT_CLIENT_ID_PREFIX: "greeting",
  MQTT_PERSISTENT_SESSION: "true",
  MQTT_SUBSCRIBER_CLIENT_ID: "greeting-subscriber",
  MQTT_SESSION_EXPIRY_SECONDS: "",
  ASYNCAPI_PATH: "asyncapi.yaml",
  PUBLISHER_NAME: "Ana",
  MOSQUITTO_CONF: DEFAULT_CONF,
};

const activeStacks = new Set<ComposeStack>();
let stackSequence = 0;

async function makeStack(
  overrides: NodeJS.ProcessEnv = {},
): Promise<ComposeStack> {
  const port = await getFreePort();
  stackSequence += 1;
  const stack = new ComposeStack(
    `${PROJECT}-${stackSequence}`,
    { ...BASE_ENV, MQTT_HOST_PORT: String(port), ...overrides },
    RUN_TIMEOUT,
  );
  activeStacks.add(stack);
  return stack;
}

async function downStack(stack: ComposeStack): Promise<void> {
  try {
    const result = await stack.compose(
      ["down", "-v", "--remove-orphans"],
      RUN_TIMEOUT,
    );
    if (result.code !== 0) {
      console.warn(
        `Aviso: no se pudo limpiar el stack ${stack.project}:\n${result.combined}`,
      );
    }
  } finally {
    activeStacks.delete(stack);
  }
}

async function upWithSubscriber(stack: ComposeStack): Promise<void> {
  const up = await stack.compose(
    ["up", "-d", "mosquitto", "subscriber"],
    RUN_TIMEOUT,
  );
  expect(up.code, `Fallo al levantar el stack:\n${up.combined}`).toBe(0);
  await stack.waitForLog("subscriber", "Suscrito a", 90_000);
}

function validPayload(name: string, message = "¡Hola mundo!"): string {
  return JSON.stringify({
    name,
    message,
    sentAt: "2026-10-26T12:00:00Z",
  });
}

async function publishRaw(
  stack: ComposeStack,
  message: string,
  qos = "1",
): Promise<void> {
  const result = await stack.compose(
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
  expect(result.code, `mosquitto_pub falló:\n${result.combined}`).toBe(0);
}

async function publishGreeting(
  stack: ComposeStack,
  name: string,
  message = "¡Hola mundo!",
): Promise<void> {
  await publishRaw(stack, validPayload(name, message));
}

async function startSubscriber(stack: ComposeStack): Promise<void> {
  const start = await stack.compose(["start", "subscriber"], RUN_TIMEOUT);
  expect(start.code, `Fallo al arrancar el suscriptor:\n${start.combined}`).toBe(
    0,
  );
}

async function stopSubscriber(stack: ComposeStack): Promise<void> {
  const stop = await stack.compose(["stop", "subscriber"], 60_000);
  expect(stop.code, `Fallo al detener el suscriptor:\n${stop.combined}`).toBe(
    0,
  );
}

beforeAll(async () => {
  const build = await runProcess(
    "docker",
    ["build", "-t", IMAGE_NAME, "."],
    process.env,
    900_000,
  );
  expect(build.code, `Fallo al construir la imagen:\n${build.combined}`).toBe(0);
}, 1_200_000);

afterAll(async () => {
  for (const stack of [...activeStacks]) {
    await downStack(stack);
  }
  await runProcess(
    "docker",
    ["image", "rm", "-f", IMAGE_NAME],
    process.env,
    60_000,
  );
});

describe("Q1-Q3: mensajes encolados, orden y sessionPresent", () => {
  let stack: ComposeStack;

  beforeAll(async () => {
    stack = await makeStack();
    await upWithSubscriber(stack);
    await stopSubscriber(stack);

    await publishGreeting(stack, "Q1-Alfa", "Primero");
    await publishGreeting(stack, "Q1-Bravo", "Segundo");
    await publishGreeting(stack, "Q1-Charlie", "Tercero");

    await startSubscriber(stack);
    await stack.waitForLog("subscriber", "Sesión recuperada", 90_000);
    await stack.waitForLog("subscriber", "Q1-Charlie", 90_000);
  }, TEST_TIMEOUT);

  afterAll(async () => {
    if (stack) {
      await downStack(stack);
    }
  });

  it(
    "Q1: los 3 mensajes publicados con el suscriptor apagado llegan al volver",
    async () => {
      const logs = await stack.logs("subscriber");
      expect(logs).toContain('Hola Q1-Alfa, dice: "Primero"');
      expect(logs).toContain('Hola Q1-Bravo, dice: "Segundo"');
      expect(logs).toContain('Hola Q1-Charlie, dice: "Tercero"');
    },
    TEST_TIMEOUT,
  );

  it(
    "Q2: los mensajes se entregan en el mismo orden de publicación",
    async () => {
      const logs = await stack.logs("subscriber");
      const first = logs.indexOf("Hola Q1-Alfa");
      const second = logs.indexOf("Hola Q1-Bravo");
      const third = logs.indexOf("Hola Q1-Charlie");

      expect(first).toBeGreaterThanOrEqual(0);
      expect(second).toBeGreaterThan(first);
      expect(third).toBeGreaterThan(second);
    },
    TEST_TIMEOUT,
  );

  it(
    "Q3: volumen limpio registra «Sesión nueva» y el reinicio registra «Sesión recuperada»",
    async () => {
      const logs = await stack.logs("subscriber");
      expect(logs).toContain("Sesión nueva");
      expect(logs).toContain("Sesión recuperada");
    },
    TEST_TIMEOUT,
  );
});

describe("Q4-Q10: persistencia y límites de MQTT", () => {
  it(
    "Q4: la cola sobrevive a un reinicio del broker",
    async () => {
      const stack = await makeStack();
      try {
        await upWithSubscriber(stack);
        await stopSubscriber(stack);

        await publishGreeting(stack, "Q4-Uno", "Antes del reinicio 1");
        await publishGreeting(stack, "Q4-Dos", "Antes del reinicio 2");

        const stopBroker = await stack.compose(["stop", "mosquitto"], 120_000);
        expect(
          stopBroker.code,
          `Fallo al detener el broker:\n${stopBroker.combined}`,
        ).toBe(0);

        const restartBroker = await stack.compose(
          ["up", "-d", "--wait", "mosquitto"],
          RUN_TIMEOUT,
        );
        expect(
          restartBroker.code,
          `Fallo al reiniciar el broker:\n${restartBroker.combined}`,
        ).toBe(0);

        await startSubscriber(stack);
        await stack.waitForLog("subscriber", "Sesión recuperada", 90_000);
        await stack.waitForLog("subscriber", "Q4-Dos", 90_000);

        const logs = await stack.logs("subscriber");
        expect(logs).toContain("Hola Q4-Uno");
        expect(logs).toContain("Hola Q4-Dos");
      } finally {
        await downStack(stack);
      }
    },
    TEST_TIMEOUT,
  );

  it(
    "Q5: sin suscripción previa el broker no sabe a quién encolar y el mensaje se pierde",
    async () => {
      const stack = await makeStack();
      try {
        const broker = await stack.compose(
          ["up", "-d", "--wait", "mosquitto"],
          RUN_TIMEOUT,
        );
        expect(broker.code, broker.combined).toBe(0);

        // El suscriptor nunca se ha ejecutado: no hay sesión ni suscripción.
        await publishGreeting(stack, "Q5-SinSesion", "Nadie me escucha");

        const up = await stack.compose(["up", "-d", "subscriber"], RUN_TIMEOUT);
        expect(up.code, up.combined).toBe(0);
        await stack.waitForLog("subscriber", "Sesión nueva", 90_000);
        await stack.waitForLog("subscriber", "Suscrito a", 90_000);

        // Mensaje de control para saber que el suscriptor ya está procesando.
        await publishGreeting(stack, "Q5-Control", "Control");
        await stack.waitForLog("subscriber", "Q5-Control", 90_000);

        const logs = await stack.logs("subscriber");
        expect(logs).not.toContain("Q5-SinSesion");
      } finally {
        await downStack(stack);
      }
    },
    TEST_TIMEOUT,
  );

  it(
    "Q6: con MQTT_PERSISTENT_SESSION=false no se encola nada mientras está apagado",
    async () => {
      const stack = await makeStack({ MQTT_PERSISTENT_SESSION: "false" });
      try {
        await upWithSubscriber(stack);
        await stopSubscriber(stack);

        await publishGreeting(stack, "Q6-Uno");
        await publishGreeting(stack, "Q6-Dos");
        await publishGreeting(stack, "Q6-Tres");

        await startSubscriber(stack);
        await stack.waitForLog("subscriber", "Sesión nueva", 90_000, 2);
        await stack.waitForLog("subscriber", "Suscrito a", 90_000, 2);

        await publishGreeting(stack, "Q6-Control", "Control");
        await stack.waitForLog("subscriber", "Q6-Control", 90_000);

        const logs = await stack.logs("subscriber");
        expect(logs).not.toContain("Q6-Uno");
        expect(logs).not.toContain("Q6-Dos");
        expect(logs).not.toContain("Q6-Tres");
      } finally {
        await downStack(stack);
      }
    },
    TEST_TIMEOUT,
  );

  it(
    "Q7: un mensaje inválido encolado se descarta y no bloquea a los siguientes",
    async () => {
      const stack = await makeStack();
      try {
        await upWithSubscriber(stack);
        await stopSubscriber(stack);

        await publishGreeting(stack, "Q7-Antes", "Válido anterior");
        await publishRaw(stack, '{"name":"Q7-Incompleto"}');
        await publishGreeting(stack, "Q7-Despues", "Válido posterior");

        await startSubscriber(stack);
        await stack.waitForLog("subscriber", "Sesión recuperada", 90_000);
        await stack.waitForLog("subscriber", "Q7-Despues", 90_000);
        await stack.waitForLog("subscriber", "Mensaje descartado", 90_000);
        await stack.waitForLog(
          "subscriber",
          "must have required property",
          90_000,
        );

        const logs = await stack.logs("subscriber");
        const before = logs.indexOf("Hola Q7-Antes");
        const discarded = logs.indexOf("Mensaje descartado");
        const after = logs.indexOf("Hola Q7-Despues");
        expect(before).toBeGreaterThanOrEqual(0);
        expect(discarded).toBeGreaterThan(before);
        expect(after).toBeGreaterThan(discarded);

        const state = await stack.inspect("subscriber");
        expect(state.State.Status).toBe("running");
      } finally {
        await downStack(stack);
      }
    },
    TEST_TIMEOUT,
  );

  it(
    "Q8: el cierre ordenado sale con 0 y conserva la sesión para el siguiente arranque",
    async () => {
      const stack = await makeStack();
      try {
        await upWithSubscriber(stack);

        const startedAt = Date.now();
        await stopSubscriber(stack);
        const elapsed = Date.now() - startedAt;
        expect(elapsed, `stop tardó ${elapsed} ms`).toBeLessThan(10_000);

        const stopped = await stack.inspect("subscriber");
        expect(stopped.State.Status).toBe("exited");
        expect(stopped.State.ExitCode).toBe(0);

        const logs = await stack.logs("subscriber");
        expect(logs).toContain("Cerrando conexión");

        await startSubscriber(stack);
        await stack.waitForLog(
          "subscriber",
          "Sesión recuperada",
          90_000,
        );
      } finally {
        await downStack(stack);
      }
    },
    TEST_TIMEOUT,
  );

  it(
    "Q9: con max_queued_messages=5 se conservan los 5 mensajes más antiguos",
    async () => {
      const stack = await makeStack({ MOSQUITTO_CONF: LIMITED_QUEUE_CONF });
      try {
        await upWithSubscriber(stack);
        await stopSubscriber(stack);

        for (let index = 1; index <= 8; index += 1) {
          await publishGreeting(stack, `Q9-${index}`, `Mensaje ${index}`);
        }

        await startSubscriber(stack);
        await stack.waitForLog("subscriber", "Sesión recuperada", 90_000);
        await stack.waitForLog("subscriber", "Suscrito a", 90_000, 2);

        await publishGreeting(stack, "Q9-Control", "Control");
        await stack.waitForLog("subscriber", "Q9-Control", 90_000);

        const logs = await stack.logs("subscriber");
        for (let index = 1; index <= 5; index += 1) {
          expect(logs).toContain(`Hola Q9-${index},`);
        }
        for (let index = 6; index <= 8; index += 1) {
          expect(logs).not.toContain(`Hola Q9-${index},`);
        }

        // Comportamiento real observado: Mosquitto descarta los mensajes
        // nuevos cuando la cola del cliente ya está llena.
        const brokerLogs = await stack.logs("mosquitto");
        expect(brokerLogs).toContain(
          "Outgoing messages are being dropped for client greeting-subscriber",
        );
      } finally {
        await downStack(stack);
      }
    },
    TEST_TIMEOUT,
  );

  it(
    "Q10: publicar con QoS 0 mientras el suscriptor está apagado no deja nada en cola",
    async () => {
      const stack = await makeStack({ MQTT_PERSISTENT_SESSION: "false" });
      try {
        await upWithSubscriber(stack);
        await stopSubscriber(stack);

        await publishRaw(
          stack,
          validPayload("Q10-QoS0", "No debe encolarse"),
          "0",
        );

        await startSubscriber(stack);
        await stack.waitForLog("subscriber", "Sesión nueva", 90_000, 2);
        await stack.waitForLog("subscriber", "Suscrito a", 90_000, 2);

        await publishGreeting(stack, "Q10-Control", "Control");
        await stack.waitForLog("subscriber", "Q10-Control", 90_000);

        const logs = await stack.logs("subscriber");
        expect(logs).not.toContain("Q10-QoS0");
      } finally {
        await downStack(stack);
      }
    },
    TEST_TIMEOUT,
  );
});
