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
      const config = loadConfig({ MQTT_QOS: qos });
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
