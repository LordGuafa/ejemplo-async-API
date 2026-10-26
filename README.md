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
[`pruebas-manuales.md`](pruebas-manuales.md) para reproducir los casos
a mano.

## Estructura

```
src/config.ts        Valida el entorno con Zod, incluida la sesión persistente.
src/contract.ts      Carga asyncapi.yaml, expone GREETING_TOPIC y valida payloads con Ajv.
src/mqtt-client.ts   Construye opciones MQTT puras y crea el cliente mqtt.js.
src/publisher.ts     Publica un saludo en el tópico del contrato.
src/subscriber.ts    Se suscribe con sesión persistente, valida mensajes y cierra ordenadamente.
asyncapi.yaml        Contrato AsyncAPI 3.0 con bindings MQTT.
compose.yaml         Broker Mosquitto + servicios subscriber/publisher + volumen de datos.
mosquitto/           Configuración del broker SOLO para desarrollo/pruebas.
```

## Uso local (sin Docker)

```bash
pnpm install
cp .env.example .env      # ajusta los valores si hace falta
pnpm start:sub            # terminal 1
pnpm start:pub            # terminal 2
```

## Cola de mensajes con sesión persistente

### El problema

Con una sesión limpia (`clean: true`) y un `clientId` aleatorio, el broker
elimina la suscripción del suscriptor en cuanto este se desconecta. Si el
publicador envía un mensaje mientras el suscriptor está apagado, Mosquitto no
sabe a quién guardárselo y lo descarta: el mensaje se pierde.

Este proyecto activa las **sesiones persistentes de MQTT**: el broker conserva
la suscripción y encola los mensajes QoS 1/2 mientras el suscriptor está
desconectado. Cuando el suscriptor vuelve con el mismo `clientId`, recibe los
pendientes. No hace falta añadir RabbitMQ, Redis ni ninguna cola externa:
Mosquitto ya implementa esta capacidad del protocolo MQTT.

### Las cinco condiciones para que se encole un mensaje

Deben cumplirse **todas a la vez**:

1. **Sesión persistente en el suscriptor:** se conecta con `clean: false`
   (`MQTT_PERSISTENT_SESSION=true`).
2. **`clientId` fijo y estable:** el suscriptor usa siempre el mismo
   (`MQTT_SUBSCRIBER_CLIENT_ID`). Con un UUID aleatorio el broker lo ve como un
   cliente nuevo en cada arranque y no reconoce su sesión.
3. **QoS 1 o 2 en ambos extremos:** el QoS efectivo es el menor entre el del
   publicador y el de la suscripción. QoS 0 no se encola nunca.
4. **La suscripción debe existir antes:** el suscriptor tiene que haberse
   ejecutado y suscrito al menos una vez. Si el broker nunca vio esa
   suscripción, no sabe a quién guardarle los mensajes.
5. **Persistencia del broker activada:** `persistence true` en
   `mosquitto/mosquitto.conf` y su volumen `mosquitto-data`, para sobrevivir a
   reinicios del broker (las condiciones 1-4 bastan para sobrevivir a reinicios
   del suscriptor).

### Variables de entorno

| Variable | Por defecto | Descripción |
|---|---|---|
| `MQTT_PERSISTENT_SESSION` | `true` | Activa la sesión persistente del suscriptor. Solo acepta `true` o `false`. |
| `MQTT_SUBSCRIBER_CLIENT_ID` | `${MQTT_CLIENT_ID_PREFIX}-subscriber` | `clientId` fijo del suscriptor cuando la sesión es persistente. En el ejemplo: `greeting-subscriber`. |
| `MQTT_SESSION_EXPIRY_SECONDS` | sin definir | Si se define, usa MQTT 5 con `sessionExpiryInterval`. Si no, usa MQTT 3.1.1 y el broker decide cuánto conserva la sesión. |

`MQTT_PERSISTENT_SESSION=true` con `MQTT_QOS=0` se rechaza al arrancar: el QoS 0
no se encola. `MQTT_SESSION_EXPIRY_SECONDS` solo tiene sentido con sesión
persistente; la combinación con `MQTT_PERSISTENT_SESSION=false` también se
rechaza.

### Limitaciones y advertencias

- **La suscripción debe existir antes de que lleguen los mensajes:** el
  suscriptor debe haberse ejecutado al menos una vez para que el broker sepa a
  quién encolar.
- **Dos suscriptores con el mismo `clientId` se expulsan entre sí:** no escales
  horizontalmente con este diseño; la alternativa son las suscripciones
  compartidas de MQTT 5 (`$share/grupo/topic`).
- **Con QoS 1 puede haber mensajes duplicados:** el receptor debería ser
  idempotente.
- **El `PUBACK` confirma la recepción por el broker, no el procesamiento por
  parte de nadie.**
- **La cola tiene un límite por cliente (`max_queued_messages`) y las sesiones
  caducan (`persistent_client_expiration`):** en la configuración de ejemplo son
  1000 mensajes y 7 días.
- **Si se necesitan reintentos, dead letter queue, replay o confirmación de
  procesamiento, hay que pasar a RabbitMQ o Kafka:** MQTT y Mosquitto no
  ofrecen esas garantías a nivel de aplicación.

### Cómo probarlo a mano

Necesitas el broker de desarrollo levantado con persistencia:

```bash
docker compose up -d mosquitto
```

Después, desde la raíz del proyecto:

```bash
pnpm start:sub     # arranca y crea la sesión; Ctrl+C para cerrarlo
pnpm start:pub     # varias veces mientras el suscriptor está apagado
pnpm start:sub     # recibe los pendientes y muestra "Sesión recuperada"
```

La primera ejecución del suscriptor muestra `🆕 Sesión nueva.`; las siguientes
con el mismo `clientId` muestran `♻️ Sesión recuperada: recibiendo mensajes
pendientes...`. Si quieres probar también la persistencia del broker, añade un
`docker compose restart mosquitto` entre el publicador y el último arranque del
suscriptor.

### Caso de prueba → prueba automatizada

| Caso | Prueba |
|---|---|
| Mensajes encolados llegan tras reiniciar el suscriptor | e2e `Q1` |
| Orden de entrega de los mensajes encolados | e2e `Q2` |
| `sessionPresent`: sesión nueva vs. recuperada | e2e `Q3`, `Q8` |
| La cola sobrevive al reinicio del broker | e2e `Q4` |
| Sin suscripción previa no se encola nada | e2e `Q5` |
| `MQTT_PERSISTENT_SESSION=false` conserva el comportamiento anterior | e2e `Q6` |
| Un mensaje inválido encolado se descarta sin bloquear | e2e `Q7` |
| Cierre ordenado (`stop`) conserva la sesión | e2e `Q8` |
| Límite `max_queued_messages`: se conservan los más antiguos | e2e `Q9` |
| QoS 0 no se encola | e2e `Q10` |
| Booleanos, `clientId` por defecto, QoS 0 y `sessionExpiryInterval` | unitarias `config.test.ts` |
| `clean`, `clientId` fijo/aleatorio y MQTT 5 | unitarias `mqtt-client.test.ts` |

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
| `config` | Valores por defecto, `MQTT_QOS` inválido/convertido, protocolo de `MQTT_URL`, `mqtts://` obligatorio en producción, credenciales opcionales, objeto congelado, listado de todos los errores, booleanos `true`/`false`, `clientId` del suscriptor, QoS 0 con sesión persistente, `sessionExpiryInterval`. |
| `mqtt-client` | `clean` y `clientId` fijo/aleatorio por rol, publicador siempre limpio, MQTT 5 con `sessionExpiryInterval`, credenciales opcionales. |
| `contract` | Saludo válido, campos faltantes/vacíos, campo extra, `sentAt` no ISO 8601, tipos incorrectos, entradas no objeto, `parseGreeting` con Buffer/JSON inválido/fuera de contrato, `GREETING_TOPIC`, `ContractViolationError`. |

### e2e (`test/e2e`)

| # | Caso | Resultado |
|---|------|-----------|
| 1 | Flujo feliz (publisher sale 0, suscriptor muestra el saludo de Ana) | ✅ |
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
| Q1 | Mensajes encolados con el suscriptor apagado llegan al volver | ✅ |
| Q2 | Orden de entrega preservado | ✅ |
| Q3 | `Sesión nueva` en volumen limpio y `Sesión recuperada` al volver | ✅ |
| Q4 | La cola sobrevive al reinicio del broker | ✅ |
| Q5 | Sin suscripción previa el mensaje no se encola | ✅ |
| Q6 | `MQTT_PERSISTENT_SESSION=false` no encola | ✅ |
| Q7 | Mensaje inválido encolado se descarta y no bloquea | ✅ |
| Q8 | Cierre ordenado conserva la sesión | ✅ |
| Q9 | Cola llena: se conservan los 5 más antiguos | ✅ |
| Q10 | QoS 0 no se encola | ✅ |
