# Pruebas manuales del manejo de errores

Guía para probar manualmente cómo el **suscriptor** valida los mensajes contra el
contrato AsyncAPI (`asyncapi.yaml`) y descarta los que no cumplen.

## Preparación

Levanta el broker y el suscriptor, y deja los logs abiertos en una terminal:

```bash
docker compose up -d mosquitto subscriber
docker compose logs -f --no-color subscriber
```

Todos los mensajes se publican en el tópico `greetings/hello` usando
`mosquitto_pub` contra el broker del compose. Se usa `-T` (sin TTY) y `-s`
(payload por stdin) para evitar problemas de comillas en Windows/PowerShell.

Para enviar un payload, define el mensaje y grábalo por stdin:

```bash
# PowerShell
echo '{"name":"X"}' | docker compose exec -T mosquitto mosquitto_pub -t greetings/hello -s

# Bash
echo '{"name":"X"}' | docker compose exec -T mosquitto mosquitto_pub -t greetings/hello -s
```

> Alternativa: `mosquitto_pub -t greetings/hello -m '<json>'` con comillas simples.

## Casos de error

### 1. JSON incompleto — faltan campos requeridos

Faltan `message` y `sentAt`; el contrato exige `name`, `message` y `sentAt`.

```bash
echo '{"name":"X"}' | docker compose exec -T mosquitto mosquitto_pub -t greetings/hello -s
```

Esperado: `Mensaje descartado ... data must have required property 'message', data must have required property 'sentAt'`

### 2. Texto que no es JSON

```bash
echo 'hola' | docker compose exec -T mosquitto mosquitto_pub -t greetings/hello -s
```

Esperado: `Mensaje descartado ... El mensaje no es un JSON válido`

### 3. Campo extra no declarado — `additionalProperties: false`

```bash
echo '{"name":"Ana","message":"Hola","sentAt":"2026-10-21T00:00:00Z","extra":1}' \
  | docker compose exec -T mosquitto mosquitto_pub -t greetings/hello -s
```

Esperado: `Mensaje descartado ... data must NOT have additional properties`

### 4. `sentAt` que no es ISO 8601 (`date-time`)

```bash
echo '{"name":"Ana","message":"Hola","sentAt":"ayer"}' \
  | docker compose exec -T mosquitto mosquitto_pub -t greetings/hello -s
```

```bash
echo '{"name":"Ana","message":"Hola","sentAt":"2026-10-20"}' \
  | docker compose exec -T mosquitto mosquitto_pub -t greetings/hello -s
```

Esperado: `Mensaje descartado ... data/sentAt must match format "date-time"`

### 5. Campo vacío — `minLength: 1`

```bash
echo '{"name":"","message":"Hola","sentAt":"2026-10-21T00:00:00Z"}' \
  | docker compose exec -T mosquitto mosquitto_pub -t greetings/hello -s
```

Esperado: `Mensaje descartado ... data/name must NOT have fewer than 1 characters`

### 6. Tipo incorrecto — `name` numérico

```bash
echo '{"name":123,"message":"Hola","sentAt":"2026-10-21T00:00:00Z"}' \
  | docker compose exec -T mosquitto mosquitto_pub -t greetings/hello -s
```

Esperado: `Mensaje descartado ... data/name must be string`

## Caso de control (mensaje válido)

Debe mostrarse el saludo procesado, no descartado.

```bash
echo '{"name":"Ana","message":"Hola","sentAt":"2026-10-21T00:00:00Z"}' \
  | docker compose exec -T mosquitto mosquitto_pub -t greetings/hello -s
```

Esperado: `Hola Ana, dice: "Hola" (enviado a las 2026-10-21T00:00:00Z)`

## Comprobar que el suscriptor sigue vivo

Tras cualquiera de los casos de error, el contenedor **no debe reiniciarse**:

```bash
docker compose ps subscriber
docker inspect --format '{{.State.Status}} restart={{.RestartCount}}' \
  $(docker compose ps -q subscriber)
```

Esperado: `running restart=0`

## Publicar desde local (opcional)

Si prefieres publicar desde tu máquina en vez de dentro del contenedor, el broker
ya está publicado en `localhost:1883`:

```bash
pnpm exec mqtt_pub -h localhost -p 1883 -t greetings/hello -m '{"name":"X"}'
```

## Limpieza

```bash
docker compose down -v --remove-orphans
```
