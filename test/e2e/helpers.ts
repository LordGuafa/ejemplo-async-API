import { spawn } from "node:child_process";
import { createServer } from "node:net";

export interface RunResult {
  readonly code: number | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly combined: string;
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function countOccurrences(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

/** Reserva un puerto libre de host para publicarlo desde Compose. */
export function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.unref();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (address === null || typeof address === "string") {
        server.close(() => reject(new Error("No se pudo obtener un puerto libre")));
        return;
      }
      const { port } = address;
      server.close(() => resolve(port));
    });
  });
}

/** Ejecuta un proceso y nunca rechaza: devuelve siempre el código de salida. */
export function runProcess(
  command: string,
  args: string[],
  env: NodeJS.ProcessEnv,
  timeoutMs: number,
): Promise<RunResult> {
  return new Promise((resolve) => {
    const child = spawn(command, args, { env, windowsHide: true });
    let stdout = "";
    let stderr = "";
    let timedOut = false;

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, timeoutMs);

    child.on("error", (error) => {
      clearTimeout(timer);
      resolve({
        code: null,
        stdout,
        stderr: `${stderr}\n${error.message}`,
        combined: `${stdout}\n${stderr}\n${error.message}`,
      });
    });

    child.on("close", (code) => {
      clearTimeout(timer);
      const timeoutNote = timedOut ? `\n[proceso killed tras ${timeoutMs} ms]` : "";
      resolve({
        code,
        stdout,
        stderr: `${stderr}${timeoutNote}`,
        combined: `${stdout}\n${stderr}${timeoutNote}`,
      });
    });
  });
}

interface ContainerState {
  readonly State: {
    readonly Status: string;
    readonly ExitCode: number;
    readonly RestartCount: number;
    readonly StartedAt: string;
  };
}

/**
 * Orquesta un stack de Docker Compose con nombre de proyecto único.
 * Todas las operaciones pasan por `docker compose -p <proyecto> ...`.
 */
export class ComposeStack {
  constructor(
    readonly project: string,
    private readonly extraEnv: NodeJS.ProcessEnv = {},
    private readonly defaultTimeoutMs = 120_000,
  ) {}

  private get env(): NodeJS.ProcessEnv {
    return { ...process.env, ...this.extraEnv };
  }

  compose(args: string[], timeoutMs = this.defaultTimeoutMs): Promise<RunResult> {
    return runProcess(
      "docker",
      ["compose", "-p", this.project, ...args],
      this.env,
      timeoutMs,
    );
  }

  async logs(service: string): Promise<string> {
    const result = await this.compose(["logs", "--no-color", service]);
    return result.combined;
  }

  /**
   * Hace polling de `docker compose logs <servicio>` hasta que el texto
   * aparece al menos `minCount` veces. Falla con un mensaje claro al agotar
   * el timeout. Nunca usa sleeps fijos como sincronización.
   */
  async waitForLog(
    service: string,
    text: string,
    timeoutMs = 60_000,
    minCount = 1,
  ): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    let lastLogs = "";
    while (Date.now() < deadline) {
      lastLogs = await this.logs(service);
      if (countOccurrences(lastLogs, text) >= minCount) {
        return;
      }
      await sleep(500);
    }
    throw new Error(
      `Timeout de ${timeoutMs} ms esperando "${text}" (x${minCount}) ` +
        `en los logs del servicio "${service}". Últimos logs:\n` +
        lastLogs.slice(-4000),
    );
  }

  /** Estado del contenedor de un servicio (primero que encuentre). */
  async inspect(service: string): Promise<ContainerState> {
    const idResult = await this.compose(["ps", "-aq", service]);
    const id = idResult.stdout.trim().split(/\r?\n/)[0];
    if (!id) {
      throw new Error(`No se encontró contenedor para el servicio "${service}"`);
    }
    const result = await runProcess("docker", ["inspect", id], this.env, 60_000);
    const parsed = JSON.parse(result.stdout) as ContainerState[];
    const container = parsed[0];
    if (!container) {
      throw new Error(`docker inspect no devolvió datos para "${service}"`);
    }
    return container;
  }
}
