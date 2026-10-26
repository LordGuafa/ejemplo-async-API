# API asíncrona con AsyncAPI, MQTT, Node.js y TypeScript

Explicación completa del programa: qué hace, cómo está organizado, qué hace cada archivo, cada método de las librerías y cómo está estructurado el contrato `asyncapi.yaml`.

---

## Índice

1. [Qué hace el programa](#1-qué-hace-el-programa)
2. [Conceptos clave](#2-conceptos-clave)
3. [Arquitectura y flujo de un mensaje](#3-arquitectura-y-flujo-de-un-mensaje)
4. [Estructura del proyecto](#4-estructura-del-proyecto)
5. [El contrato `asyncapi.yaml` en detalle](#5-el-contrato-asyncapiyaml-en-detalle)
6. [Herramientas externas](#6-herramientas-externas)
7. [El código, archivo por archivo](#7-el-código-archivo-por-archivo)
8. [Línea de tiempo de una ejecución](#8-línea-de-tiempo-de-una-ejecución)
9. [Qué pasa cuando algo falla](#9-qué-pasa-cuando-algo-falla)
10. [Cómo ejecutar el ejemplo](#10-cómo-ejecutar-el-ejemplo)
11. [Buenas prácticas aplicadas](#11-buenas-prácticas-aplicadas)
12. [Preguntas frecuentes para la exposición](#12-preguntas-frecuentes-para-la-exposición)
13. [Guion sugerido](#13-guion-sugerido-unos-10-minutos)

---

## 1. Qué hace el programa

Es un sistema de **mensajería asíncrona** con tres piezas:

- Un **publicador** que envía un saludo (un JSON con nombre, mensaje y fecha).
- Un **suscriptor** que escucha y muestra los saludos.
- Un **broker** (Mosquitto) que está en medio y reparte los mensajes.

Publicador y suscriptor **no se conocen entre sí**. Solo comparten dos cosas: el nombre de un canal (*topic*) y la forma que debe tener el mensaje. Ambas están escritas en un **contrato AsyncAPI** (`asyncapi.yaml`), y el código lo lee para obedecerlo.

> **Idea central:** el contrato es la fuente de verdad, y el código lo hace cumplir en tiempo de ejecución.

---

## 2. Conceptos clave

| Concepto | Explicación |
|---|---|
| **Comunicación asíncrona** | Quien envía no espera respuesta ni necesita que el receptor esté listo en ese instante. |
| **Publish/Subscribe (pub/sub)** | Los emisores publican en un canal y los receptores se suscriben a él. Nadie habla directamente con nadie. |
| **Broker** | Servidor intermediario que recibe los mensajes y los reenvía a los suscriptores. Aquí es Mosquitto. |
| **MQTT** | Protocolo ligero de mensajería pub/sub sobre TCP, muy usado en IoT. |
| **Topic** | Nombre jerárquico del canal, separado por `/`, por ejemplo `greetings/hello`. |
| **Payload** | El contenido del mensaje. Aquí es JSON convertido a bytes. |
| **QoS** (Quality of Service) | Garantía de entrega: **0** como máximo una vez, **1** al menos una vez, **2** exactamente una vez. |
| **AsyncAPI** | Estándar para describir APIs basadas en eventos. Es el equivalente de OpenAPI/Swagger, pero para mensajería. |
| **Contrato** | Acuerdo formal y verificable entre quien produce y quien consume los mensajes. |
| **JSON Schema** | Lenguaje para describir la forma válida de un JSON. AsyncAPI lo usa para los payloads. |
| **Frontera de confianza** | Punto donde entran datos de fuera (entorno, red, archivos). Ahí hay que validar. |
| **Fail fast** | Si algo está mal, fallar al instante y con un mensaje claro, en lugar de romperse más tarde. |
| **Idempotencia** | Procesar el mismo mensaje dos veces produce el mismo resultado que procesarlo una vez. Importa con QoS 1. |

---

## 3. Arquitectura y flujo de un mensaje

```
              asyncapi.yaml  (contrato)
               topic + schema del mensaje
                  │                │
          lo lee  ▼                ▼  lo lee
        ┌──────────────┐    ┌───────────────┐
        │ publisher.ts │    │ subscriber.ts │
        └──────┬───────┘    └───────▲───────┘
               │ PUBLISH            │ MESSAGE
               ▼                    │
          ┌──────────────────────────────┐
          │   Mosquitto (broker MQTT)    │
          │     topic: greetings/hello   │
          └──────────────────────────────┘
```

**Recorrido de un mensaje:**

1. El publicador arma el objeto.
2. Lo valida contra el schema del contrato.
3. Lo convierte a texto con `JSON.stringify`.
4. Lo envía por MQTT como bytes.
5. El broker lo recibe y lo reenvía a los suscriptores del topic.
6. El suscriptor recibe un `Buffer`, lo convierte a texto, hace `JSON.parse` y lo valida contra el mismo schema.
7. Solo entonces lo usa.

---

## 4. Estructura del proyecto

```
.
├── .env.example
├── .gitignore
├── asyncapi.yaml          ← contrato
├── package.json
├── tsconfig.json
└── src/
    ├── config.ts          ← variables de entorno (zod)
    ├── contract.ts        ← carga del contrato y validación (Ajv)
    ├── mqtt-client.ts     ← fábrica de clientes MQTT
    ├── publisher.ts       ← publica un saludo
    └── subscriber.ts      ← escucha saludos
```

---

## 5. El contrato `asyncapi.yaml` en detalle

### 5.1 Qué es y para qué sirve

Un documento AsyncAPI describe **qué canales existen, qué mensajes viajan por ellos y qué operaciones realiza una aplicación**. Cumple tres funciones:

1. **Documentar**: genera una página HTML legible por humanos.
2. **Acordar**: publicador y suscriptor se ponen de acuerdo sin hablar entre sí.
3. **Validar**: el código puede usar el schema del contrato para rechazar mensajes incorrectos (es lo que hace este ejemplo).

Se usa la versión **AsyncAPI 3.0.0**.

### 5.2 Mapa de la estructura

```
asyncapi.yaml
├── asyncapi        → versión de la especificación
├── info            → metadatos del servicio (título, versión, descripción)
├── servers         → dónde está el broker
│   └── mosquitto
├── channels        → los canales (topics) y los mensajes que admiten
│   └── greetings
│       ├── address     → topic real: "greetings/hello"
│       └── messages
│           └── greeting  → referencia a components/messages/Greeting
├── operations      → qué hace la aplicación con cada canal
│   ├── sendGreeting      (action: send)
│   └── receiveGreeting   (action: receive)
└── components      → piezas reutilizables
    ├── messages
    │   └── Greeting      → nombre, tipo de contenido, payload, ejemplos
    └── schemas
        └── GreetingPayload  → JSON Schema del cuerpo del mensaje
```

Las secciones `channels` y `operations` **referencian** lo que está en `components` mediante `$ref`. La idea es definir cada cosa una sola vez y reutilizarla.

### 5.3 El documento completo

```yaml
asyncapi: 3.0.0

info:
  title: Greeting Service
  version: 1.0.0
  description: Servicio mínimo que publica y recibe saludos sobre MQTT.

servers:
  mosquitto:
    host: localhost:1883
    protocol: mqtt
    description: Broker Mosquitto local

channels:
  greetings:
    address: greetings/hello
    description: Canal donde se publican los saludos.
    messages:
      greeting:
        $ref: '#/components/messages/Greeting'

operations:
  sendGreeting:
    action: send
    channel:
      $ref: '#/channels/greetings'
    summary: Publica un saludo.
    messages:
      - $ref: '#/channels/greetings/messages/greeting'

  receiveGreeting:
    action: receive
    channel:
      $ref: '#/channels/greetings'
    summary: Recibe saludos.
    messages:
      - $ref: '#/channels/greetings/messages/greeting'

components:
  messages:
    Greeting:
      name: Greeting
      title: Mensaje de saludo
      contentType: application/json
      payload:
        $ref: '#/components/schemas/GreetingPayload'
      examples:
        - payload:
            name: Ana
            message: ¡Hola mundo!
            sentAt: '2026-10-19T12:00:00Z'

  schemas:
    GreetingPayload:
      type: object
      additionalProperties: false
      required: [name, message, sentAt]
      properties:
        name:
          type: string
          minLength: 1
          description: Quién envía el saludo.
        message:
          type: string
          minLength: 1
          description: Texto del saludo.
        sentAt:
          type: string
          format: date-time
          description: Fecha de envío en ISO 8601.
```

### 5.4 Sección por sección

#### `asyncapi: 3.0.0`

Declara **qué versión de la especificación** sigue el documento. Las herramientas (CLI, Studio, generadores) la leen primero para saber cómo interpretar el resto. Es obligatoria y va siempre al inicio.

#### `info`

Metadatos del servicio.

| Campo | Obligatorio | Descripción |
|---|---|---|
| `title` | Sí | Nombre del servicio. Aparece como título de la documentación. |
| `version` | Sí | Versión **del contrato** (no de AsyncAPI). Súbela cuando cambie el contrato. |
| `description` | No | Texto explicativo. Admite Markdown. |

También existen `contact`, `license`, `tags` y `externalDocs`, que aquí no se usan.

#### `servers`

Describe **a qué broker o servidor se conectan las aplicaciones**. Es un mapa: la clave (`mosquitto`) es un nombre interno libre.

| Campo | Obligatorio | Descripción |
|---|---|---|
| `host` | Sí | Dirección y, opcionalmente, puerto: `localhost:1883`. |
| `protocol` | Sí | Protocolo de comunicación: `mqtt`, `amqp`, `kafka`, `ws`, etc. |
| `description` | No | Texto descriptivo. |

También admite `protocolVersion`, `pathname`, `variables`, `security` y `bindings`.

> **En este proyecto** esta sección es **informativa** (aparece en la documentación). La URL real del broker sale de la variable de entorno `MQTT_URL`, y eso permite usar el mismo contrato en local, staging y producción.

#### `channels`

Define **por dónde viajan los mensajes**. También es un mapa: la clave (`greetings`) es un **identificador interno** del canal, usado para referenciarlo.

| Campo | Descripción |
|---|---|
| `address` | El **nombre real** del canal en el broker. En MQTT es el *topic*: `greetings/hello`. |
| `description` | Texto descriptivo. |
| `messages` | Mapa de los mensajes que pueden circular por este canal. |

**Detalle importante de la versión 3.0:** la clave del canal (`greetings`) y su `address` (`greetings/hello`) son cosas distintas. En la versión 2.x la clave *era* el topic, y por eso en 3.0 se separaron: el identificador sirve para referenciar y el `address` es lo que realmente viaja por la red. **El código lee el `address`** para saber a qué topic publicar o suscribirse.

Dentro de `messages`, la clave `greeting` es un identificador local, y su valor es un `$ref` al mensaje definido en `components`.

#### `operations`

Describe **qué hace la aplicación** con cada canal. Cada operación tiene:

| Campo | Obligatorio | Descripción |
|---|---|---|
| `action` | Sí | `send` (la aplicación **envía**) o `receive` (la aplicación **recibe**). |
| `channel` | Sí | Referencia (`$ref`) al canal sobre el que opera. |
| `summary` | No | Resumen corto. |
| `messages` | No | Lista de mensajes que maneja la operación, referenciados desde el canal. |

**Punto delicado:** en AsyncAPI 3.0 la acción se expresa **desde el punto de vista de la aplicación que describe el documento**. En la versión 2.x `publish` y `subscribe` se interpretaban desde la perspectiva del *usuario* del API, lo que generaba confusión. Ahora `send` significa "mi aplicación envía" y `receive` "mi aplicación recibe".

**Nota de diseño:** aquí se ponen `sendGreeting` y `receiveGreeting` en el mismo documento por simplicidad. En un sistema real, el publicador y el suscriptor suelen ser servicios distintos y **cada uno tiene su propio documento**, donde solo aparece la operación que le corresponde.

**Regla de la versión 3.0:** los mensajes de una operación deben referenciar los definidos **dentro del canal** (`#/channels/greetings/messages/greeting`), no directamente los de `components`. Por eso hay un salto de referencias: operación → canal → componente.

#### `components`

Es el **almacén de piezas reutilizables**. No describe nada por sí mismo: solo define elementos que otras secciones referencian. Admite `messages`, `schemas`, `servers`, `channels`, `operations`, `securitySchemes`, `parameters` y más. Aquí se usan dos.

##### `components.messages.Greeting`

Define el mensaje como entidad.

| Campo | Descripción |
|---|---|
| `name` | Nombre técnico del mensaje. |
| `title` | Nombre legible, usado en la documentación. |
| `contentType` | Formato de serialización del cuerpo. `application/json` indica que el payload es JSON. |
| `payload` | La forma del cuerpo. Aquí es una referencia al schema `GreetingPayload`. |
| `examples` | Ejemplos de mensajes válidos, que se muestran en la documentación. |

El mensaje también podría llevar `headers` (metadatos del mensaje), `correlationId`, `tags` y `bindings`, que no se usan aquí.

##### `components.schemas.GreetingPayload`

Es el **JSON Schema** que describe el cuerpo. Es la parte que **el código usa en tiempo de ejecución** para validar. Palabras clave utilizadas:

| Palabra clave | Qué hace |
|---|---|
| `type: object` | El mensaje debe ser un objeto JSON (no un arreglo, texto ni número). |
| `required: [name, message, sentAt]` | Los tres campos son obligatorios. |
| `additionalProperties: false` | Prohíbe cualquier campo que no esté declarado en `properties`. Hace el contrato **estricto**. |
| `properties` | Define cada campo permitido y sus reglas. |
| `type: string` | El valor debe ser texto. |
| `minLength: 1` | El texto no puede estar vacío. |
| `format: date-time` | El texto debe ser una fecha y hora ISO 8601 (por ejemplo `2026-10-20T12:00:00Z`). |
| `description` | Explicación del campo. No valida nada, pero aparece en la documentación. |

> AsyncAPI define sus schemas como un **superconjunto de JSON Schema draft-07**. Por eso Ajv (que usa draft-07 por defecto) puede validarlos directamente.

#### `$ref`: las referencias

`$ref` es un **puntero** a otra parte del mismo documento. La sintaxis es `#/ruta/dentro/del/documento`, donde `#` representa la raíz y cada `/` baja un nivel.

| Referencia | Apunta a |
|---|---|
| `#/components/messages/Greeting` | El mensaje `Greeting` en `components`. |
| `#/components/schemas/GreetingPayload` | El schema del payload. |
| `#/channels/greetings` | El canal `greetings`. |
| `#/channels/greetings/messages/greeting` | El mensaje `greeting` declarado dentro del canal. |

Cadena completa de referencias:

```
operations.sendGreeting
   └─ channel     → #/channels/greetings
   └─ messages[0] → #/channels/greetings/messages/greeting
                          └─ $ref → #/components/messages/Greeting
                                          └─ payload → #/components/schemas/GreetingPayload
```

Ventajas: se define cada cosa **una sola vez**, se evita la duplicación y los cambios se propagan solos.

### 5.5 Qué parte del contrato usa cada herramienta

| Parte del YAML | Quién la usa | Para qué |
|---|---|---|
| `channels.greetings.address` | `contract.ts` | Obtiene el topic al que publicar o suscribirse (`GREETING_TOPIC`). |
| `components.schemas.GreetingPayload` | `contract.ts` (Ajv) | Valida los mensajes antes de enviarlos y al recibirlos. |
| `info`, `servers`, `operations`, `examples`, `description` | Generador de HTML y Studio | Documentación legible. |
| Toda la estructura | AsyncAPI CLI (`validate`) | Verifica que el documento cumple la especificación. |

### 5.6 Herramientas de AsyncAPI usadas

| Comando | Qué hace |
|---|---|
| `asyncapi validate asyncapi.yaml` | Comprueba que el YAML cumple la especificación 3.0 y que las referencias (`$ref`) resuelven. |
| `asyncapi generate fromTemplate asyncapi.yaml @asyncapi/html-template@3 -o docs` | Genera la documentación HTML en `docs/`. |
| `asyncapi start studio asyncapi.yaml` | Abre AsyncAPI Studio, un editor visual con vista previa en vivo y validación. |

### 5.7 Errores frecuentes al escribir el contrato

- **Indentación incorrecta**: YAML es sensible a los espacios. Usa siempre 2 espacios y nunca tabuladores.
- **`$ref` que apunta a algo inexistente**: `validate` lo detecta.
- **Mensajes de `operations` referenciando `components` directamente**: en 3.0 deben referenciar los del canal.
- **Confundir la clave del canal con su `address`**: el topic real es `address`.
- **Olvidar `additionalProperties: false`**: el contrato dejaría pasar campos que nadie declaró.
- **Fechas sin comillas en los ejemplos**: `2026-10-19T12:00:00Z` sin comillas puede ser interpretado como fecha por el parser YAML en lugar de texto. Por eso va entre comillas simples.

---

## 6. Herramientas externas

- **Mosquitto**: el broker MQTT. Corre en Docker con la configuración sin autenticación (solo desarrollo).
- **AsyncAPI CLI**: herramienta de línea de comandos para validar, generar documentación y abrir Studio.
- **AsyncAPI Studio**: editor visual en el navegador.
- **tsx**: ejecuta archivos `.ts` directamente, sin compilar. **No comprueba tipos**; por eso existe el script `typecheck` (`tsc --noEmit`).
- **pnpm**: gestor de paquetes.

---

## 7. El código, archivo por archivo

### 7.1 `config.ts`: configuración con zod

Lee las **variables de entorno**, las valida y las expone como un objeto tipado.

```ts
export type QoS = 0 | 1 | 2;
```

Es un *tipo unión literal*: solo admite esos tres valores. Así `5` ni siquiera compila.

**Métodos de zod:**

| Método | Qué hace |
|---|---|
| `z.object({...})` | Define un objeto con campos validables. |
| `z.string()` | Exige un texto. |
| `.regex(patrón, mensaje)` | El texto debe cumplir la expresión regular. Aquí exige `mqtt://` o `mqtts://`. |
| `.min(1)` | Longitud mínima 1, o sea no vacío. |
| `.optional()` | El campo puede no existir (`undefined`). |
| `.default(valor)` | Si el campo no existe, usa este valor. |
| `z.enum([...])` | Solo admite uno de los valores listados. |
| `.transform(fn)` | Convierte el valor ya validado. Aquí pasa `'1'` (texto) a `1` (número). |
| `.refine(fn, {message, path})` | Regla personalizada que puede mirar varios campos a la vez. |
| `.safeParse(datos)` | Valida **sin lanzar excepción** y devuelve `{success: true, data}` o `{success: false, error}`. |
| `z.infer<typeof schema>` | Extrae el tipo TypeScript a partir del schema. |

**Por qué `z.enum(['0','1','2'])` y luego `transform`:** todas las variables de entorno son texto. Primero se valida que sea `'0'`, `'1'` o `'2'`, y luego se convierte a número.

**Por qué `default` va antes de `transform`:** el default se aplica sobre el valor de entrada (texto `'1'`), y el transform lo convierte después.

**El `refine` final:** si `NODE_ENV` es `production`, la URL debe ser `mqtts://` (TLS). Es una regla entre dos campos, y por eso va sobre el objeto completo y no sobre un solo campo.

**La función `loadConfig(env)`:**

1. Llama a `safeParse(env)`.
2. Si falla, recorre `parsed.error.issues`. Cada *issue* tiene `path` (qué campo) y `message` (qué pasó).
3. Los une con `.map(...).join('\n')` y lanza un `Error` con la lista.
4. Si funciona, devuelve `Object.freeze(parsed.data)`, que hace el objeto **inmutable en tiempo de ejecución** (de forma superficial).

Recibe `env` por parámetro en lugar de leer `process.env` dentro, lo que facilita probarla con entornos falsos.

**La última línea**, `export const config = loadConfig(process.env)`, se ejecuta **al importar el módulo**. Node cachea los módulos, así que se ejecuta una sola vez y todos comparten el mismo objeto (*singleton*).

**Tipos usados:** `Readonly<...>` marca todas las propiedades como de solo lectura, y `NodeJS.ProcessEnv` es el tipo de `process.env`, un diccionario de texto o `undefined`.

### 7.2 `contract.ts`: puente entre el contrato y el código

**Tipos del dominio:**

- `GreetingPayload` describe el mensaje. Es `readonly` para que nadie lo mute.
- `Result<T, E>` es una **unión discriminada**: o `{ok: true, value}` o `{ok: false, error}`. La propiedad `ok` permite a TypeScript saber qué forma tiene el objeto. Es una alternativa a lanzar excepciones para errores *esperables*, como un mensaje inválido. `E extends Error = Error` restringe el genérico y le da un valor por defecto.
- `ContractViolationError` extiende `Error`. El `readonly details?` en el constructor es un **parameter property**: declara y asigna la propiedad en una sola línea. `this.name` ayuda a identificar el error en los logs.

**`loadContract(path)`:**

1. `resolve(path)` convierte la ruta relativa en absoluta, **tomando como base la carpeta desde donde ejecutas el comando**. Por eso hay que correr los scripts desde la raíz del proyecto.
2. `readFileSync(..., 'utf8')` lee el archivo de forma síncrona. Es aceptable porque ocurre **una sola vez al arrancar**.
3. `parse` (de la librería `yaml`) convierte el texto YAML en un objeto JavaScript.
4. `as AsyncApiDocument | null` es una **aserción de tipo**: le dice a TypeScript qué esperamos, pero **no verifica nada**.
5. Por eso viene la verificación real, con **encadenamiento opcional** (`doc?.channels?.greetings?.address`) y `typeof`. Si falta algo, lanza un error con un mensaje claro.

`AsyncApiDocument` modela solo lo que usamos. No intenta describir toda la especificación (*tipado estructural*).

**Ajv (validación de JSON Schema):**

| Método | Qué hace |
|---|---|
| `new Ajv({allErrors: true})` | Crea el validador. `allErrors` reporta **todos** los errores, no solo el primero. |
| `addFormats(ajv)` | Agrega soporte para formatos como `date-time`. Sin esto, Ajv rechazaría el schema. |
| `ajv.compile<T>(schema)` | Convierte el schema en una **función de validación** optimizada. Se hace una vez y se reutiliza. |
| `validate(data)` | Devuelve `true` o `false`, y deja los errores en `validate.errors`. |
| `ajv.errorsText(errores)` | Convierte la lista de errores en un texto legible. |

La función que devuelve `compile` es un **type guard** (`data is GreetingPayload`): si devuelve `true`, TypeScript trata `data` como `GreetingPayload` dentro de ese `if`.

**`validateGreeting(data: unknown)`:** recibe `unknown` y no `any`. Con `unknown` TypeScript **obliga a comprobar** antes de usar el dato, y con `any` se saltaría esa protección.

**`parseGreeting(raw)`:**

1. `raw.toString()` convierte el `Buffer` (bytes) en texto UTF-8.
2. `JSON.parse` **lanza excepción** si el texto no es JSON, por eso va en `try/catch`. Se usa `catch {}` sin variable porque no necesitamos el error.
3. El resultado se guarda en `let json: unknown` y se valida.

Así hay **dos niveles de fallo** distintos: JSON mal formado, y JSON bien formado que no cumple el schema.

### 7.3 `mqtt-client.ts`: fábrica de clientes

`buildClientOptions(role, config)` construye las opciones sin conectarse (así se
prueban en unitarias) y `createClient(role)` evita duplicar código entre
publicador y suscriptor.

| Opción | Significado |
|---|---|
| `clientId` | Identificador único ante el broker. Con sesión persistente el suscriptor usa uno fijo (`greeting-subscriber`); en el resto de casos se arma como prefijo + rol + 8 caracteres de `randomUUID()`. **Dos clientes con el mismo ID se expulsan entre sí.** |
| `clean` | `false` para el suscriptor con `MQTT_PERSISTENT_SESSION=true`: el broker conserva su suscripción y encola mensajes. En el resto de casos es `true` (sesión limpia), como antes. |
| `protocolVersion` / `sessionExpiryInterval` | Si se define `MQTT_SESSION_EXPIRY_SECONDS`, se usa MQTT 5 con esa caducidad de sesión. En MQTT 5 ambos van juntos: sin `sessionExpiryInterval` la sesión expira al desconectarse. |
| `connectTimeout: 10_000` | Espera máxima de 10 segundos al conectar. El `_` es solo un separador visual. |
| `reconnectPeriod` | Milisegundos entre reintentos. El suscriptor (proceso de larga vida) reintenta cada 2 s. El publicador usa `0`, que desactiva la reconexión y falla rápido. |
| `username` / `password` | Credenciales opcionales. |

**El spread condicional** `...(config.MQTT_USERNAME ? { username: ... } : {})` agrega la propiedad **solo si existe**, para no enviar `username: undefined`.

**`connect(url, options)`:**

- Devuelve el cliente **inmediatamente**, pero la conexión es **asíncrona**. Por eso todo se hace con eventos.
- El protocolo de la URL decide el transporte: `mqtt://` es TCP, `mqtts://` es TCP con TLS y `ws://` es WebSocket.

### 7.4 `publisher.ts`

1. Arma el objeto `draft` con el nombre (de `PUBLISHER_NAME`), el mensaje y la fecha (`new Date().toISOString()`, que genera formato ISO 8601).
2. Lo valida **antes de conectarse**. Si no cumple el contrato, `process.exit(1)` termina con código de error.
3. Tras ese `if`, TypeScript sabe que `validation.ok` es `true`, porque `process.exit` devuelve `never` (no retorna).
4. Crea el cliente y espera el evento **`connect`**, que se dispara cuando el broker acepta la conexión.
5. Dentro llama a `client.publish(topic, mensaje, opciones, callback)`:
   - `JSON.stringify(...)` convierte el objeto en texto.
   - `{ qos: config.MQTT_QOS }` fija la garantía de entrega.
   - El callback recibe un `error` si algo falló. Con QoS 1 se llama cuando el broker **confirma** la recepción.
6. Llama a `client.end()` para cerrar la conexión. Sin esto el proceso quedaría abierto.
7. Usa `process.exitCode = 1` en lugar de `process.exit(1)` para **dejar que Node termine ordenadamente** lo que tenga pendiente.
8. El evento **`error`** captura fallos de conexión, como un broker apagado.

### 7.5 `subscriber.ts`

1. Crea el cliente con rol `subscriber`.
2. En **`connect`** llama a `client.subscribe(topic, {qos}, callback)`. El callback avisa si la suscripción falló.
3. El evento **`message`** se dispara por cada mensaje recibido, con `(topic, payload)`. El payload llega como `Buffer`.
4. Aplica `parseGreeting(payload)`:
   - Si `!result.ok`, **descarta** el mensaje, lo registra y hace `return`. Un mensaje malo no tumba el proceso.
   - Si es válido, desestructura `{ name, message, sentAt }` y lo muestra.
5. **Cierre ordenado:** escucha `SIGINT` (Ctrl+C) y `SIGTERM` (el que envían `docker stop` o Kubernetes). Llama a `client.end(false, {}, callback)`:
   - `false` significa no forzar: espera a que terminen los mensajes en vuelo.
   - `{}` son las opciones.
   - El callback se ejecuta al cerrar y termina el proceso con `process.exit(0)`.
   - Esto envía un `DISCONNECT` limpio al broker.

### 7.6 Archivos de configuración

**`.env`** (valores de despliegue, no van a Git):

```bash
NODE_ENV=development
MQTT_URL=mqtt://localhost:1883
MQTT_QOS=1
MQTT_CLIENT_ID_PREFIX=greeting
ASYNCAPI_PATH=asyncapi.yaml
PUBLISHER_NAME=Ana
```

**`package.json` (scripts):**

| Script | Qué hace |
|---|---|
| `start:sub` | Ejecuta el suscriptor con `tsx`, cargando `.env` con `--env-file`. |
| `start:pub` | Ejecuta el publicador. |
| `typecheck` | `tsc --noEmit`: comprueba tipos sin generar archivos. |
| `docs:validate` | Valida el contrato con AsyncAPI CLI. |
| `docs:build` | Genera la documentación HTML en `docs/`. |
| `docs:studio` | Abre AsyncAPI Studio. |

No se llama `publish` al script del publicador porque chocaría con el comando `pnpm publish`.

**`tsconfig.json` (opciones relevantes):**

| Opción | Efecto |
|---|---|
| `"module": "nodenext"` | Resolución de módulos moderna para Node. Reemplaza a `moduleResolution: node` (deprecado en TypeScript 6). |
| `"strict": true` | Activa todas las comprobaciones estrictas. |
| `"noUncheckedIndexedAccess": true` | Accesos por índice devuelven `T o undefined`. |
| `"noUnusedLocals"` / `"noUnusedParameters"` | Error si hay variables o parámetros sin usar. |
| `"types": ["node"]` | Carga explícitamente los tipos de Node (necesario en TypeScript 6). |

---

## 8. Línea de tiempo de una ejecución

1. `pnpm start:sub` arranca Node con `--env-file=.env`, que carga las variables.
2. Se importa `config.ts`, que valida el entorno. Si algo falla, el programa termina aquí.
3. `contract.ts` lee y valida el YAML, y compila el schema.
4. El suscriptor se conecta a Mosquitto y se suscribe a `greetings/hello`.
5. `pnpm start:pub` repite los pasos 1 a 3, valida el saludo y se conecta.
6. El publicador envía y el broker reenvía al suscriptor.
7. El suscriptor valida y muestra el mensaje.
8. El publicador cierra la conexión y su proceso termina. El suscriptor sigue escuchando.

---

## 9. Qué pasa cuando algo falla

| Situación | Resultado |
|---|---|
| Falta una variable con default | Se usa el default. |
| `MQTT_QOS=7` | Error al arrancar: valor no permitido. |
| `NODE_ENV=production` con `mqtt://` | Error al arrancar: se exige `mqtts://`. |
| Broker apagado | El publicador falla por el evento `error`. El suscriptor reintenta cada 2 s. |
| Publicador con un mensaje sin `name` | Falla la validación **antes de enviar**. |
| Alguien externo publica JSON roto | El suscriptor lo descarta con `Mensaje descartado`. |
| Alguien publica un campo extra | Se descarta por `additionalProperties: false`. |

Para probar los dos últimos casos con Mosquitto:

```bash
docker exec mosquitto mosquitto_pub -t greetings/hello -m '{"name":"X"}'
docker exec mosquitto mosquitto_pub -t greetings/hello -m 'hola'
```

---

## 10. Cómo ejecutar el ejemplo

**Requisitos:** Node.js 20.6 o superior, pnpm y Docker.

```bash
# 1) Proyecto y dependencias
mkdir asyncapi-greeting && cd asyncapi-greeting
pnpm init
pnpm add mqtt ajv ajv-formats yaml zod
pnpm add -D typescript tsx @types/node
mkdir src
cp .env.example .env

# 2) Broker Mosquitto (terminal 1, déjala abierta)
docker run --rm --name mosquitto -p 1883:1883 \
  eclipse-mosquitto:2 mosquitto -c /mosquitto-no-auth.conf

# 3) Comprobar tipos (opcional)
pnpm typecheck

# 4) Suscriptor (terminal 2)
pnpm start:sub

# 5) Publicador (terminal 3)
pnpm start:pub
PUBLISHER_NAME=Carlos pnpm start:pub

# 6) Documentación
pnpm docs:validate
pnpm docs:build
pnpm docs:studio
```

**Problemas frecuentes:**

| Síntoma | Causa y solución |
|---|---|
| `Configuración inválida: ...` | Alguna variable del `.env` tiene un valor no permitido. El mensaje indica cuál. |
| `ECONNREFUSED 127.0.0.1:1883` | Mosquitto no está corriendo o el puerto está ocupado. |
| `ENOENT ... asyncapi.yaml` | Ejecutas desde otra carpeta. Corre los scripts **desde la raíz del proyecto**. |
| `node: bad option: --env-file` | Tu Node es anterior a 20.6. |
| El suscriptor no recibe nada | Verifica que ambos usen el mismo `MQTT_URL` y que el suscriptor haya impreso `Escuchando...` **antes** de publicar. |

---

## 11. Buenas prácticas aplicadas

1. **Contrato primero** (*contract-first*): el YAML manda y el código lo consume.
2. **Validación en ambos extremos**: el publicador no emite basura y el suscriptor no confía en nadie.
3. **Configuración por entorno**: el mismo código corre en local, staging y producción.
4. **Fail fast**: el programa no arranca con configuración inválida.
5. **`unknown` en las fronteras** y `Result` en lugar de excepciones para errores esperables.
6. **Inmutabilidad**: `readonly`, `Readonly<>` y `Object.freeze`.
7. **Cierre ordenado** de conexiones.
8. **Seguridad por defecto**: TLS obligatorio en producción.

---

## 12. Preguntas frecuentes para la exposición

**¿Por qué no usar HTTP?**
HTTP exige que ambos extremos estén disponibles a la vez y la comunicación es punto a punto. Con un broker hay desacoplamiento, y es fácil que varios suscriptores reciban el mismo mensaje.

**¿Qué pasa si el suscriptor está apagado cuando se publica?**
Con la configuración por defecto (`MQTT_PERSISTENT_SESSION=true`, `clean: false`, `clientId` fijo y QoS 1) el broker **encola** los mensajes y los entrega al volver. Para que funcione, la suscripción debe haber existido antes y el broker debe tener persistencia activada. Con `MQTT_PERSISTENT_SESSION=false` se mantiene el comportamiento anterior (`clean: true` y `clientId` aleatorio) y el mensaje se pierde.

**¿Por qué usar zod y Ajv a la vez?**
Ajv valida contra el JSON Schema del contrato, que es un estándar y viene del YAML. Zod valida la configuración interna, definida en TypeScript. Cada uno encaja mejor en su caso.

**¿AsyncAPI genera código?**
En este ejemplo no: genera **documentación**, y el contrato se usa en tiempo de ejecución. La herramienta sí podría generar modelos de código, pero no se usa aquí.

**¿Qué diferencia hay entre QoS 1 y 2?**
Con QoS 1 el mensaje puede llegar duplicado, así que el receptor debería ser idempotente. Con QoS 2 llega exactamente una vez, a costa de más intercambio de paquetes y más latencia.

**¿Por qué `tsx` y no `tsc`?**
`tsx` ejecuta TypeScript sin paso de compilación, que es cómodo para desarrollo. Los tipos se comprueban por separado con `pnpm typecheck`.

**¿Qué diferencia hay entre `channels` y `operations`?**
`channels` describe **dónde** viajan los mensajes y cuáles son. `operations` describe **qué hace la aplicación** con ellos (enviar o recibir).

**¿Por qué el contrato tiene `servers` si la URL sale del entorno?**
Para documentar. Un lector del contrato sabe qué tipo de broker se espera, pero la dirección concreta cambia entre entornos y por eso se configura con `MQTT_URL`.

**¿Qué ocurre si cambio el schema del contrato?**
El publicador y el suscriptor lo leen al arrancar, así que ambos adoptan el cambio al reiniciarse. Si el cambio rompe la compatibilidad, conviene subir `info.version` y coordinar el despliegue.

---