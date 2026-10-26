import { describe, expect, it } from "vitest";
import { loadConfig } from "../../src/config";
import { buildClientOptions } from "../../src/mqtt-client";

describe("buildClientOptions: sesión persistente", () => {
  it("el suscriptor persistente usa clean=false y un clientId fijo entre llamadas", () => {
    const config = loadConfig({});

    const first = buildClientOptions("subscriber", config);
    const second = buildClientOptions("subscriber", config);

    expect(first.clean).toBe(false);
    expect(first.clientId).toBe("greeting-subscriber");
    expect(second.clientId).toBe(first.clientId);
  });

  it("sin persistencia el suscriptor usa clean=true y un clientId aleatorio", () => {
    const config = loadConfig({ MQTT_PERSISTENT_SESSION: "false" });

    const first = buildClientOptions("subscriber", config);
    const second = buildClientOptions("subscriber", config);

    expect(first.clean).toBe(true);
    expect(second.clean).toBe(true);
    expect(first.clientId).not.toBe(second.clientId);
  });

  it("el publicador siempre usa clean=true y clientId aleatorio", () => {
    const config = loadConfig({ MQTT_PERSISTENT_SESSION: "true" });

    const first = buildClientOptions("publisher", config);
    const second = buildClientOptions("publisher", config);

    expect(first.clean).toBe(true);
    expect(second.clean).toBe(true);
    expect(first.clientId).toMatch(/^greeting-publisher-[0-9a-f]{8}$/);
    expect(first.clientId).not.toBe(second.clientId);
  });

  it("con MQTT_SESSION_EXPIRY_SECONDS usa MQTT 5 y sessionExpiryInterval", () => {
    const config = loadConfig({ MQTT_SESSION_EXPIRY_SECONDS: "3600" });

    const options = buildClientOptions("subscriber", config);

    expect(options.protocolVersion).toBe(5);
    expect(options.properties?.sessionExpiryInterval).toBe(3600);
  });

  it("sin MQTT_SESSION_EXPIRY_SECONDS no fuerza MQTT 5 ni propiedades", () => {
    const config = loadConfig({});

    const options = buildClientOptions("subscriber", config);

    expect(options.protocolVersion).toBeUndefined();
    expect(options.properties).toBeUndefined();
  });

  it("no incluye credenciales si no están definidas", () => {
    const options = buildClientOptions("subscriber", loadConfig({}));

    expect(options.username).toBeUndefined();
    expect(options.password).toBeUndefined();
    expect("username" in options).toBe(false);
    expect("password" in options).toBe(false);
  });

  it("incluye las credenciales cuando están definidas", () => {
    const config = loadConfig({
      MQTT_USERNAME: "usuario",
      MQTT_PASSWORD: "secreto",
    });

    const options = buildClientOptions("subscriber", config);

    expect(options.username).toBe("usuario");
    expect(options.password).toBe("secreto");
  });
});
