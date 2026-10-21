import { describe, expect, it } from "vitest";
import {
  ContractViolationError,
  GREETING_TOPIC,
  parseGreeting,
  validateGreeting,
  type GreetingPayload,
} from "../../src/contract";

const validGreeting: GreetingPayload = {
  name: "Ana",
  message: "¡Hola mundo!",
  sentAt: "2026-10-19T12:00:00Z",
};

describe("GREETING_TOPIC", () => {
  it("es exactamente greetings/hello según el contrato", () => {
    expect(GREETING_TOPIC).toBe("greetings/hello");
  });
});

describe("validateGreeting", () => {
  it("acepta un saludo válido y devuelve el mismo objeto", () => {
    const result = validateGreeting(validGreeting);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toBe(validGreeting);
    }
  });

  it.each(["name", "message", "sentAt"] as const)(
    "rechaza un saludo sin el campo %s",
    (field) => {
      const partial: Record<string, unknown> = { ...validGreeting };
      delete partial[field];
      expect(validateGreeting(partial).ok).toBe(false);
    },
  );

  it("rechaza un campo extra no declarado (additionalProperties: false)", () => {
    const result = validateGreeting({ ...validGreeting, extra: "sorpresa" });
    expect(result.ok).toBe(false);
  });

  it.each([
    ["name", ""],
    ["message", ""],
  ] as const)("rechaza %s vacío", (field, value) => {
    expect(validateGreeting({ ...validGreeting, [field]: value }).ok).toBe(
      false,
    );
  });

  it.each(["ayer", "2026-10-20"] as const)(
    "rechaza sentAt=%s que no es date-time ISO 8601",
    (sentAt) => {
      expect(validateGreeting({ ...validGreeting, sentAt }).ok).toBe(false);
    },
  );

  it("rechaza tipos incorrectos (name: 123)", () => {
    expect(
      validateGreeting({ ...validGreeting, name: 123 }).ok,
    ).toBe(false);
  });

  it.each([null, [], "texto", 42])(
    "rechaza entradas que no son objeto (%p)",
    (input) => {
      expect(validateGreeting(input).ok).toBe(false);
    },
  );

  it("todos los errores son instancias de ContractViolationError", () => {
    const inputs: unknown[] = [
      { ...validGreeting, name: 123 },
      { ...validGreeting, extra: true },
      { name: "X" },
      null,
      "texto",
    ];
    for (const input of inputs) {
      const result = validateGreeting(input);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toBeInstanceOf(ContractViolationError);
      }
    }
  });
});

describe("parseGreeting", () => {
  it("acepta un Buffer JSON válido", () => {
    const result = parseGreeting(Buffer.from(JSON.stringify(validGreeting)));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual(validGreeting);
    }
  });

  it("rechaza texto que no es JSON", () => {
    const result = parseGreeting("hola");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBeInstanceOf(ContractViolationError);
      expect(result.error.message).toMatch(/no es un JSON válido/);
    }
  });

  it("rechaza JSON válido pero fuera de contrato y detalla el error", () => {
    const result = parseGreeting(
      Buffer.from(JSON.stringify({ foo: 1, bar: "dos" })),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBeInstanceOf(ContractViolationError);
      expect(result.error.details).toBeTruthy();
      expect(result.error.details).toMatch(/\w/);
    }
  });
});
