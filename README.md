# ejemplo-async-api

## Descripción

`ejemplo-async-api` es un proyecto de ejemplo que demuestra cómo construir
mensajería asíncrona sobre **MQTT** con **Node.js + TypeScript**, usando un
**contrato AsyncAPI 3.0** como única fuente de verdad del formato de los
mensajes.

La idea central: en lugar de acoplar el formato del mensaje al código, el
contrato `asyncapi.yaml` define el tópico y el schema del payload. Tanto el
publicador como el suscriptor cargan ese contrato en tiempo de ejecución, de
modo que el contrato gobierna el comportamiento de la aplicación. El suscriptor
valida **cada** mensaje recibido contra el schema y descarta de forma segura
cualquier payload que no cumpla (JSON incompleto, campos de más, tipos
incorrectos, fechas mal formateadas, etc.) sin caerse.

### Piezas

- **Publicador**: construye un saludo (`name`, `message`, `sentAt`), lo valida
  contra el contrato y lo publica en el tópico `greetings/hello`. Es un trabajo
  de un solo disparo: publica y termina.
- **Suscriptor**: se suscribe al tópico, valida cada mensaje y registra los
  saludos válidos o los descarta con el detalle del error. Es de larga vida y
  se reconecta si el broker cae; cierra de forma ordenada ante `SIGINT`/`SIGTERM`.
- **Contrato AsyncAPI**: define el canal `greetings/hello`, el mensaje `Greeting`
  y el schema `GreetingPayload` (obligatorios: `name`, `message`, `sentAt`;
  `additionalProperties: false`).
- **Validador**: el schema del contrato se compila con **Ajv** y se usa tanto en
  el publicador (antes de enviar) como en el suscriptor (al recibir).

### Stack

Node.js 22, TypeScript estricto, [mqtt.js](https://github.com/mqttjs/MQTT.js),
[zod](https://zod.dev) para validar el entorno, [Ajv](https://ajv.js.org) +
`ajv-formats` para validar payloads, `yaml` para leer el contrato y
[Vitest](https://vitest.dev) para las pruebas. Todo se orquesta con **pnpm** y,
para el modo contenerizado, con **Docker Compose** y el broker **Eclipse
Mosquitto**.

### Comportamiento ante errores

El suscriptor nunca se cae por un mensaje inválido: lo registra como
`Mensaje descartado ...` con el motivo y continúa escuchando. Esto se cubre con
pruebas unitarias y de extremo a extremo. Consulta
[`docs/pruebas-manuales.md`](docs/pruebas-manuales.md) para reproducir los casos
a mano.

## Estructura

```
src/config.ts        Valida el entorno con Zod y congela la configuración.
src/contract.ts      Carga asyncapi.yaml, expone GREETING_TOPIC y valida payloads con Ajv.
src/mqtt-client.ts   Crea el cliente mqtt.js (reconexión para el suscriptor).
src/publisher.ts     Publica un saludo en el tópico del contrato.
src/subscriber.ts    Se suscribe, valida mensajes y cierra de forma ordenada.
asyncapi.yaml        Contrato AsyncAPI 3.0.
compose.yaml         Broker Mosquitto + servicios subscriber/publisher.
mosquitto/           Configuración del broker SOLO para desarrollo/pruebas.
```

## Uso local (sin Docker)

```bash
pnpm install
cp .env.example .env      # ajusta los valores si hace falta
pnpm start:sub            # terminal 1
pnpm start:pub            # terminal 2
```

## Docker y pruebas

Requisitos: Docker + Docker Compose y pnpm.

### Construir la imagen

```bash
docker compose build
```

### Levantar broker y suscriptor

```bash
docker compose up -d mosquitto subscriber
docker compose logs -f subscriber
```

### Lanzar el publicador

El servicio `publisher` está bajo el profile `tools`, por lo que no arranca con
`docker compose up`; se lanza a demanda:

```bash
docker compose run --rm publisher
# con otro nombre:
docker compose run --rm -e PUBLISHER_NAME=Carlos publisher
```

### Ejecutar las pruebas

```bash
pnpm typecheck     # TypeScript estricto
pnpm test:unit     # pruebas unitarias (NO requieren Docker)
pnpm test:e2e      # pruebas e2e (requieren Docker; levantan su propio stack)
pnpm test          # unit + e2e
```

### Ver logs y limpiar

```bash
docker compose logs -f subscriber
docker compose down -v --remove-orphans
```

### Notas sobre variables de entorno

Compose interpola variables con `${VAR:-valor}` y **lee automáticamente el archivo
`.env`** de la carpeta del proyecto. Por eso `docker compose run publisher` puede
mostrar el `PUBLISHER_NAME` definido en tu `.env` en lugar de `Ana`. Para forzar un
valor pásalo por la línea de comandos (`-e`).

La imagen **no** fija `NODE_ENV=production`: en este proyecto producción exige
`MQTT_URL` con `mqtts://` (TLS), y el broker de desarrollo no usa TLS.

### Servicio `docs` (opcional)

No se incluye. Generar el HTML y servirlo con nginx añadía una etapa frágil con la
AsyncAPI CLI y dependencias del sistema; para la documentación del contrato basta con:

```bash
pnpm docs:validate
pnpm docs:build
pnpm docs:studio
```

## Cobertura de pruebas

### Unitarias (`test/unit`)

| Área | Qué se cubre |
|------|--------------|
| `config` | Valores por defecto, `MQTT_QOS` inválido/convertido, protocolo de `MQTT_URL`, `mqtts://` obligatorio en producción, credenciales opcionales, objeto congelado, listado de todos los errores. |
| `contract` | Saludo válido, campos faltantes/vacíos, campo extra, `sentAt` no ISO 8601, tipos incorrectos, entradas no objeto, `parseGreeting` con Buffer/JSON inválido/fuera de contrato, `GREETING_TOPIC`, `ContractViolationError`. |

### e2e (`test/e2e`)

| # | Caso | Resultado |
|---|------|-----------|
| 1 | Flujo feliz (publisher sale 0, suscriptor muestra `Ana dice: ¡Hola mundo!`) | ✅ |
| 2 | Nombre por variable (`PUBLISHER_NAME=Carlos`) | ✅ |
| 3 | JSON incompleto → `Mensaje descartado`, contenedor sigue vivo | ✅ |
| 4 | Texto no JSON → `no es un JSON válido`, contenedor sigue vivo | ✅ |
| 5 | Campo extra no declarado → descartado por contrato | ✅ |
| 6 | Tras un mensaje inválido, uno válido se procesa | ✅ |
| 7 | `MQTT_QOS=7` en publisher → falla con `Configuración inválida` | ✅ |
| 8 | `NODE_ENV=production` con `mqtt://` → exige `mqtts://` | ✅ |
| 9 | Broker apagado → publisher falla con error de conexión | ✅ |
| 10 | Reconexión del suscriptor y recepción de un saludo nuevo | ✅ |
| 11 | `stop subscriber` cierra ordenado (<10 s, `Cerrando conexión`) | ✅ |
| 12 | Imagen segura: no corre como root y no contiene `.env` | ✅ |
