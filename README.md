# MercadoAlerta Backend

Backend del sistema MercadoAlerta, construido con Node.js, Express y PostgreSQL para monitorear licitaciones, compras ágiles y oportunidades de negocio en el mercado público chileno, además de gestionar usuarios, alertas, suscripciones y notificaciones.

## Descripción general

MercadoAlerta Backend sirve como API central del producto. Coordina:

- registro, autenticación y administración de usuarios y empresas
- alertas personalizadas por negocio, categoría y keywords
- sincronización de licitaciones y compras ágiles desde Mercado Público
- análisis y seguimiento de oportunidades
- recordatorios, avisos de trial y flujo de suscripción
- notificaciones por email, WhatsApp y Telegram
- administración de panel interno para operación y soporte

El proyecto se inicia desde `server.js`, monta la app de Express en `src/app.js` y delega la lógica empresarial a módulos de `routes`, `services`, `db`, `jobs`, `utils` y `middleware`.

## Stack tecnológico

- Node.js
- Express.js
- PostgreSQL
- pg (cliente PostgreSQL)
- JWT para autenticación
- bcrypt para contraseñas
- node-cron para jobs programados
- CORS, rate limiting y validaciones de seguridad
- Integraciones con Mercado Público, MercadoPago, WhatsApp, Telegram y correo

## Estructura del proyecto

```text
mercadoalertabackend/
├── .env.example                # Variables de entorno de ejemplo
├── .gitignore
├── package.json                # Dependencias y scripts
├── package-lock.json
├── server.js                   # Punto de entrada del backend
├── src/
│   ├── app.js                 # Configuración Express y montaje de rutas
│   ├── db/                    # Pool y queries de PostgreSQL
│   │   ├── migrations/
│   │   ├── schema.sql
│   │   ├── queries.js
│   │   ├── empresas.queries.js
│   │   └── ...
│   ├── jobs/                  # Cron jobs y tareas automáticas
│   │   ├── index.js
│   │   ├── poll-licitaciones.js
│   │   ├── poll-compra-agil.js
│   │   ├── recordatorio-cierre.js
│   │   └── ...
│   ├── middleware/            # Auth, admin key, rate limits, etc.
│   ├── routes/                # Endpoints HTTP
│   │   ├── auth.routes.js
│   │   ├── admin.routes.js
│   │   ├── alerts.routes.js
│   │   ├── oportunidades.routes.js
│   │   └── ...
│   ├── services/              # Lógica de negocio e integraciones
│   │   ├── alerting.service.js
│   │   ├── email.service.js
│   │   ├── telegram.service.js
│   │   ├── whatsapp.service.js
│   │   ├── mercadopublico.service.js
│   │   └── ...
│   ├── utils/                 # Helpers, validaciones, pagos, captcha, etc.
│   └── data/                  # Datos auxiliares y referencias
├── scripts/                   # Utilidades y tareas operativas puntuales
│   ├── carga-licitaciones-por-fecha.js
│   ├── seed-categorias-unspsc.js
│   ├── test-email-confirmacion.js
│   └── ...
├── test-connection.js         # Verificación básica de conexión a DB
└── README.md
```

## Requisitos

- Node.js 18+ recomendado
- PostgreSQL con base de datos creada y accesible
- Variables de entorno configuradas correctamente
- Acceso a APIs externas según integración activa:
  - Mercado Público
  - MercadoPago
  - WhatsApp/YCLOUD
  - Telegram
  - correo SMTP/Email

## Instalación

1. Clona el repositorio:

```bash
git clone https://github.com/leonelloCarrasco/mercadoalertabackend.git
cd mercadoalertabackend
```

2. Instala dependencias:

```bash
npm install
```

3. Crea un archivo `.env` basado en `.env.example`:

```bash
cp .env.example .env
```

4. Completa las variables de entorno necesarias antes de correr la app.

## Variables de entorno

El archivo `.env.example` incluye los valores base para los módulos principales. Algunas configuraciones importantes:

```env
DATABASE_URL=...
JWT_SECRET=...
ADMIN_API_KEY=...
PORT=3000
FRONTEND_URL=https://dashboard.mercadoalerta.cl

MERCADOPUBLICO_TICKET=...
COMPRAAGIL_TICKET=...
MERCADOPAGO_ACCESS_TOKEN=...
MERCADOPAGO_WEBHOOK_SECRET=...

TURNSTILE_SECRET_KEY=...
ANTHROPIC_API_KEY=...
SUPPORT_EMAIL=...

TELEGRAM_BOT_TOKEN=...
TELEGRAM_BOT_USERNAME=...
TELEGRAM_WEBHOOK_SECRET=...

YCLOUD_API_KEY=...
YCLOUD_BUSINESS_NUMBER=+56912345678
YCLOUD_WEBHOOK_SECRET=...
```

Consulta el archivo `.env.example` para ver todas las variables, plantillas y comentarios de configuración. El proyecto está pensado para trabajar con Supabase/Postgres o cualquier Postgres compatible.

## Ejecución local

Modo de desarrollo:

```bash
npm run dev
```

Modo producción:

```bash
npm start
```

Por defecto el servidor corre en:

```text
http://localhost:3000
```

## Verificación de salud

El backend expone un health check para validar que el proceso y la base de datos están funcionando:

```bash
curl http://localhost:3000/api/health
```

Respuesta esperada:

```json
{
  "status": "ok",
  "db": "connected",
  "timestamp": "2026-01-01T00:00:00.000Z"
}
```

## API principal

El backend monta varios módulos bajo `/api` en `src/app.js`.

### Autenticación y usuarios

- `/api/auth`
  - registro de usuarios
  - login
  - confirmación de cuenta
  - recuperación de contraseña
  - actualización de perfil
  - manejo de avatar

### Administración

- `/api/admin`
- `/api/admin-panel`

Incluye endpoints para tareas internas del panel administrativo, mantenimiento y sincronizaciones manuales.

### Alertas y oportunidades

- `/api/alerts`
- `/api/busquedas`
- `/api/oportunidades`
- `/api/pipeline`
- `/api/empresas`
- `/api/analisis`
- `/api/analisis-ia`
- `/api/soporte`
- `/api/planes`
- `/api/pagos`
- `/api/telegram`
- `/api/whatsapp`

Estas rutas cubren desde búsquedas personalizadas hasta análisis de licitaciones, oportunidades, flujos operativos y comunicaciones con usuarios.

## Jobs y tareas programadas

El proyecto configura cron jobs usando `node-cron` desde `src/jobs/index.js`.

Los jobs programados incluyen:

- polling de licitaciones cada 3 horas
- polling de compras ágiles cada 3 horas (con flag de habilitación)
- revisión de adjudicaciones diaria a las 03:00
- limpieza de datos antiguos diaria a las 04:00
- recordatorios de cierre cada 15 minutos
- seguimiento de estado cada 3 horas
- avisos de trial diarios a las 08:00

Los horarios están definidos en zona horaria de Chile (`America/Santiago`) para evitar desfase con la lógica de negocio local.

## Seguridad

El backend incorpora varias capas de control:

- JWT para sesión de usuario
- hashing de contraseñas con bcrypt
- rate limiting para auth y rutas sensibles
- protección de endpoints de administración con `ADMIN_API_KEY`
- validación de captcha para registro
- verificación de firmas HMAC para webhooks de WhatsApp/Telegram/MercadoPago
- CORS restringido a orígenes autorizados
- `app.set('trust proxy', 1)` para entornos detrás de proxy/CDN

## Integraciones principales

### Mercado Público

Se utilizan servicios de consulta para obtener y procesar licitaciones y compras ágiles. El backend está preparado para sincronizar datos, revisiones y seguimiento de estados.

### WhatsApp

La app integra WhatsApp con YCloud para:

- mensajes de alertas
- recordatorios de cierre
- cambios de estado
- vínculo con usuarios
- validación de webhook

### Telegram

Se usa Telegram para notificaciones y enlace de bot con usuarios.

### Email

Se envían correos para:

- confirmación de cuenta
- recuperación de contraseña
- alertas
- recordatorios y resumenes

### MercadoPago

Se gestiona suscripción y pagos, con soporte para pagos reales y simulación si no hay token configurado.

## Scripts operativos

La carpeta `scripts/` contiene tareas manuales y utilidades para mantenimiento, carga masiva y pruebas. Algunos ejemplos:

- carga de licitaciones por fecha
- carga histórica de compras ágiles
- backfill de datos
- seed de categorías UNSPSC
- validación y reparación de datos
- pruebas de notificaciones por email, Telegram y WhatsApp

Estas tareas son útiles para soporte operativo y mantenimiento de la base de datos.

## Deployment

El proyecto está listo para desplegarse en plataformas como:

- Render
- Railway
- VPS Linux
- Docker o infraestructura propia

Recomendaciones:

- configurar `DATABASE_URL` en producción
- usar un secreto fuerte para `JWT_SECRET`
- definir `ADMIN_API_KEY` y webhooks secret
- habilitar HTTPS y asegurar CORS
- mantener la zona horaria para los jobs programados

## Buenas prácticas

- Mantener todas las variables sensibles en `.env` y no versionarlas.
- No modificar `scripts/` ni cron jobs sin validar impacto en consumo de APIs externas.
- Testear primero cambios de flujos sensibles como registro, suscripción y webhooks.
- Revisar el archivo `.env.example` antes de realizar despliegues nuevos.

## Licencia

Este proyecto usa la licencia `ISC` según se declara en `package.json`.

## Autor / mantenimiento

Proyecto de MercadoAlerta.

Si necesitas ampliar la documentación con detalles de endpoints, flujos de negocio o ejemplos de requests, se puede complementar este README con una sección de API específica por módulo.
