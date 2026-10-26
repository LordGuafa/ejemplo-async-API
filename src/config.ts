import { z } from "zod";

export type QoS = 0 | 1 | 2;

const envSchema = z
  .object({
    NODE_ENV: z
      .enum(["development", "test", "production"])
      .default("development"),

    MQTT_URL: z
      .string()
      .regex(/^mqtts?:\/\/.+/, "Debe empezar con mqtt:// o mqtts://")
      .default("mqtt://localhost:1883"),
    MQTT_USERNAME: z.string().min(1).optional(),
    MQTT_PASSWORD: z.string().min(1).optional(),
    MQTT_QOS: z
      .enum(["0", "1", "2"])
      .default("1")
      .transform((value) => Number(value) as QoS),
    MQTT_CLIENT_ID_PREFIX: z.string().min(1).default("greeting"),

    // Se valida como enum y se transforma a booleano a propósito:
    // z.coerce.boolean() convertiría la cadena "false" en true.
    MQTT_PERSISTENT_SESSION: z
      .enum(["true", "false"])
      .default("true")
      .transform((value) => value === "true"),
    // El valor por defecto depende de MQTT_CLIENT_ID_PREFIX y se resuelve
    // después del parseo, en el transform final.
    MQTT_SUBSCRIBER_CLIENT_ID: z.string().min(1).optional(),
    // Si está definido se usa MQTT 5 con sessionExpiryInterval. La cadena
    // vacía se trata como "sin definir" porque Compose la propaga así.
    MQTT_SESSION_EXPIRY_SECONDS: z.preprocess(
      (value) => (value === "" ? undefined : value),
      z.coerce.number().int().positive().optional(),
    ),

    ASYNCAPI_PATH: z.string().min(1).default("asyncapi.yaml"),
    PUBLISHER_NAME: z.string().min(1).default("Ana"),
  })
  .refine(
    (env) =>
      env.NODE_ENV !== "production" || env.MQTT_URL.startsWith("mqtts://"),
    {
      message: "En producción MQTT_URL debe usar mqtts://",
      path: ["MQTT_URL"],
    },
  )
  .superRefine((env, ctx) => {
    if (env.MQTT_PERSISTENT_SESSION && env.MQTT_QOS === 0) {
      ctx.addIssue({
        code: "custom",
        message:
          "MQTT_PERSISTENT_SESSION=true no es compatible con MQTT_QOS=0: " +
          "el QoS 0 no se encola para suscriptores desconectados",
        path: ["MQTT_QOS"],
      });
    }

    if (
      !env.MQTT_PERSISTENT_SESSION &&
      env.MQTT_SESSION_EXPIRY_SECONDS !== undefined
    ) {
      ctx.addIssue({
        code: "custom",
        message:
          "MQTT_SESSION_EXPIRY_SECONDS requiere MQTT_PERSISTENT_SESSION=true",
        path: ["MQTT_SESSION_EXPIRY_SECONDS"],
      });
    }
  })
  .transform((env) => ({
    ...env,
    MQTT_SUBSCRIBER_CLIENT_ID:
      env.MQTT_SUBSCRIBER_CLIENT_ID ??
      `${env.MQTT_CLIENT_ID_PREFIX}-subscriber`,
  }));

export type Config = Readonly<z.infer<typeof envSchema>>;

export function loadConfig(env: NodeJS.ProcessEnv): Config {
  const parsed = envSchema.safeParse(env);

  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `  - ${issue.path.join(".")}: ${issue.message}`)
      .join("\n");
    throw new Error(`Configuración inválida:\n${details}`);
  }

  return Object.freeze(parsed.data);
}

export const config: Config = loadConfig(process.env);
