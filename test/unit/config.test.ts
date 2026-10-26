import { describe, expect, it } from "vitest";
import { loadConfig } from "../../src/config";

describe("loadConfig", () => {
  it("aplica los valores por defecto cuando no hay variables de entorno", () => {
    const config = loadConfig({});

    expect(config.NODE_ENV).toBe("development");
    expect(config.MQTT_URL).toBe("mqtt://localhost:1883");
    expect(config.MQTT_QOS).toBe(1);
    expect(config.MQTT_CLIENT_ID_PREFIX).toBe("greeting");
    expect(config.ASYNCAPI_PATH).toBe("asyncapi.yaml");
    expect(config.PUBLISHER_NAME).toBe("Ana");
    expect(config.MQTT_USERNAME).toBeUndefined();
    expect(config.MQTT_PASSWORD).toBeUndefined();
  });

  it("rechaza MQTT_QOS=7 y el mensaje menciona MQTT_QOS", () => {
    expect(() => loadConfig({ MQTT_QOS: "7" })).toThrow("Configuración inválida");
    expect(() => loadConfig({ MQTT_QOS: "7" })).toThrow(/MQTT_QOS/);
  });

  it.each(["0", "1", "2"] as const)(
    "convierte MQTT_QOS=%s a número",
    (qos) => {
      // QoS 0 no es compatible con la sesión persistente (el caso nuevo lo
      // cubre), pero la conversión de texto a número sigue siendo válida.
      const config = loadConfig({
        MQTT_QOS: qos,
        ...(qos === "0" ? { MQTT_PERSISTENT_SESSION: "false" } : {}),
      });
      expect(typeof config.MQTT_QOS).toBe("number");
      expect(config.MQTT_QOS).toBe(Number(qos));
    },
  );

  it("rechaza MQTT_URL con un protocolo inválido", () => {
    expect(() => loadConfig({ MQTT_URL: "http://x" })).toThrow(/MQTT_URL/);
  });

  it("exige mqtts:// cuando NODE_ENV=production", () => {
    expect(() =>
      loadConfig({ NODE_ENV: "production", MQTT_URL: "mqtt://x" }),
    ).toThrow(/mqtts:\/\//);
  });

  it("acepta mqtts:// en producción", () => {
    const config = loadConfig({
      NODE_ENV: "production",
      MQTT_URL: "mqtts://x",
    });
    expect(config.NODE_ENV).toBe("production");
    expect(config.MQTT_URL).toBe("mqtts://x");
  });

  it("rechaza MQTT_USERNAME vacío", () => {
    expect(() => loadConfig({ MQTT_USERNAME: "" })).toThrow(/MQTT_USERNAME/);
  });

  it("acepta credenciales ausentes (son opcionales)", () => {
    const config = loadConfig({});
    expect(config.MQTT_USERNAME).toBeUndefined();
    expect(config.MQTT_PASSWORD).toBeUndefined();
  });

  it("devuelve un objeto congelado", () => {
    expect(Object.isFrozen(loadConfig({}))).toBe(true);
  });

  it("lista todos los problemas cuando hay varias variables inválidas", () => {
    let message = "";
    try {
      loadConfig({ MQTT_QOS: "7", MQTT_URL: "http://x", MQTT_USERNAME: "" });
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    expect(message).toContain("MQTT_QOS");
    expect(message).toContain("MQTT_URL");
    expect(message).toContain("MQTT_USERNAME");
  });
});

describe("loadConfig: sesión persistente", () => {
  it("activa la sesión persistente por defecto y deriva el clientId del prefijo", () => {
    const config = loadConfig({});

    expect(config.MQTT_PERSISTENT_SESSION).toBe(true);
    expect(config.MQTT_SUBSCRIBER_CLIENT_ID).toBe("greeting-subscriber");
    expect(config.MQTT_SESSION_EXPIRY_SECONDS).toBeUndefined();
  });

  it("interpreta la cadena 'false' como false (no como true)", () => {
    const config = loadConfig({ MQTT_PERSISTENT_SESSION: "false" });

    expect(config.MQTT_PERSISTENT_SESSION).toBe(false);
  });

  it.each(["yes", "1", "TRUE", "on"])(
    "rechaza MQTT_PERSISTENT_SESSION=%s",
    (value) => {
      expect(() =>
        loadConfig({ MQTT_PERSISTENT_SESSION: value }),
      ).toThrow(/MQTT_PERSISTENT_SESSION/);
    },
  );

  it("rechaza sesión persistente con MQTT_QOS=0 y menciona el QoS 0", () => {
    expect(() =>
      loadConfig({ MQTT_PERSISTENT_SESSION: "true", MQTT_QOS: "0" }),
    ).toThrow(/QoS 0/);
  });

  it("rechaza MQTT_SESSION_EXPIRY_SECONDS si la sesión no es persistente", () => {
    expect(() =>
      loadConfig({
        MQTT_PERSISTENT_SESSION: "false",
        MQTT_SESSION_EXPIRY_SECONDS: "60",
      }),
    ).toThrow(/MQTT_SESSION_EXPIRY_SECONDS/);
  });

  it.each(["-5", "abc", "0", "1.5"])(
    "rechaza MQTT_SESSION_EXPIRY_SECONDS=%s",
    (value) => {
      expect(() =>
        loadConfig({ MQTT_SESSION_EXPIRY_SECONDS: value }),
      ).toThrow(/MQTT_SESSION_EXPIRY_SECONDS/);
    },
  );

  it("acepta un MQTT_SESSION_EXPIRY_SECONDS entero positivo", () => {
    const config = loadConfig({ MQTT_SESSION_EXPIRY_SECONDS: "604800" });

    expect(config.MQTT_SESSION_EXPIRY_SECONDS).toBe(604800);
  });

  it("trata MQTT_SESSION_EXPIRY_SECONDS vacío como no definido", () => {
    const config = loadConfig({ MQTT_SESSION_EXPIRY_SECONDS: "" });

    expect(config.MQTT_SESSION_EXPIRY_SECONDS).toBeUndefined();
  });

  it("respeta un MQTT_SUBSCRIBER_CLIENT_ID personalizado", () => {
    const config = loadConfig({
      MQTT_CLIENT_ID_PREFIX: "otro",
      MQTT_SUBSCRIBER_CLIENT_ID: "mi-suscriptor",
    });

    expect(config.MQTT_SUBSCRIBER_CLIENT_ID).toBe("mi-suscriptor");
  });

  it("cambia el clientId por defecto cuando cambia MQTT_CLIENT_ID_PREFIX", () => {
    const config = loadConfig({ MQTT_CLIENT_ID_PREFIX: "equipo-a" });

    expect(config.MQTT_SUBSCRIBER_CLIENT_ID).toBe("equipo-a-subscriber");
  });
});
