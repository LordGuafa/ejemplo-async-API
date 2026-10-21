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
  );

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
