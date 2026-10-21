import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import Ajv from "ajv";
import addFormats from "ajv-formats";
import { parse } from "yaml";
import { config } from "./config";

// Tipos del dominio
export interface GreetingPayload {
  readonly name: string;
  readonly message: string;
  readonly sentAt: string;
}
export type Result<T, E extends Error = Error> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: E };

export class ContractViolationError extends Error {
  constructor(
    message: string,
    readonly details?: string,
  ) {
    super(message);
    this.name = "ContractViolationError";
  }
}

// Payload del contrato
interface AsyncApiDocument {
  readonly channels: { readonly greetings: { readonly address: string } };
  readonly components: {
    readonly schemas: { readonly GreetingPayload: object };
  };
}
function loadContract(path: string): AsyncApiDocument {
  const doc = parse(
    readFileSync(resolve(path), "utf8"),
  ) as AsyncApiDocument | null;

  if (typeof doc?.channels?.greetings?.address !== "string") {
    throw new Error(
      `El contrato "${path}" no define channels.greetings.address`,
    );
  }
  if (typeof doc?.components?.schemas?.GreetingPayload !== "object") {
    throw new Error(
      `El contrato "${path}" no define components.schemas.GreetingPayload`,
    );
  }
  return doc;
}

const contract = loadContract(config.ASYNCAPI_PATH);

export const GREETING_TOPIC: string = contract.channels.greetings.address;

// Validación

const ajv = new Ajv({ allErrors: true });
addFormats(ajv);

const validate = ajv.compile<GreetingPayload>(
  contract.components.schemas.GreetingPayload,
);

export function validateGreeting(
  data: unknown,
): Result<GreetingPayload, ContractViolationError> {
  if (validate(data)) {
    return { ok: true, value: data };
  }
  return {
    ok: false,
    error: new ContractViolationError(
      "El mensaje no cumple el contrato AsyncAPI",
      ajv.errorsText(validate.errors),
    ),
  };
}
export function parseGreeting(
  raw: Buffer | string,
): Result<GreetingPayload, ContractViolationError> {
  let json: unknown;
  try {
    json = JSON.parse(raw.toString());
  } catch {
    return {
      ok: false,
      error: new ContractViolationError("El mensaje no es un JSON válido"),
    };
  }
  return validateGreeting(json);
}
