# 🎫 EntradasJujuy

Plataforma de venta de entradas para eventos en Jujuy, Argentina. Sistema completo con backend API, integración de pagos con MercadoPago, generación de códigos QR y app móvil para validar entradas en la puerta.

---

## ✨ Características

- **Venta de entradas online** con múltiples tipos (General, VIP, Platea, etc.)
- **Pagos seguros** con MercadoPago (tarjeta, transferencia, efectivo)
- **QR único por entrada** — generado automáticamente al confirmar el pago
- **Email de confirmación** con los QR adjuntos
- **App escáner** — validación en puerta con cámara del celular
- **Anti-fraude** — QR firmados con JWT, detección de entradas ya usadas o falsas
- **Webhook de MercadoPago** — confirmación automática de pagos

---

## 🏗️ Arquitectura

```
entradasjujuy/
├── backend/           # API REST (Express + PostgreSQL)
│   ├── server.js      # Servidor principal
│   ├── schema.sql     # Esquema de base de datos
│   ├── .env           # Variables de entorno (NO commitear)
│   ├── .env.example   # Template de variables
│   └── package.json
│
├── scanner-app/       # App escáner (React Native + Expo)
│   ├── App.js         # App completa
│   ├── app.json       # Config de Expo
│   └── package.json
│
└── .gitignore
```

---

## 🚀 Instalación

### Requisitos previos

- **Node.js** v18+
- **PostgreSQL** v14+
- **Expo CLI** (para la app escáner): `npm install -g expo-cli`
- Cuenta en **MercadoPago Developers**

### 1. Base de datos

```bash
# Crear la base de datos
psql -U postgres -c "CREATE DATABASE entradasjujuy;"

# Ejecutar el esquema
psql -U postgres -d entradasjujuy -f backend/schema.sql
```

### 2. Backend

```bash
cd backend

# Instalar dependencias
npm install

# Configurar variables de entorno
cp .env.example .env
# Editar .env con tus credenciales

# Iniciar en desarrollo
npm run dev

# O en producción
npm start
```

El backend corre en `http://localhost:3001` por defecto.

### 3. App Escáner

```bash
cd scanner-app

# Instalar dependencias
npm install

# Editar la IP del backend en App.js (línea ~22)
# const API_URL = 'http://TU_IP_LOCAL:3001';

# Iniciar
npx expo start
```

> **Nota:** Para Expo Go, la app debe poder alcanzar el backend por red local. Asegurate de poner tu IP local (no `localhost`).

---

## 📡 API Endpoints

| Método | Ruta | Descripción |
|--------|------|-------------|
| `GET` | `/health` | Health check |
| `GET` | `/api/eventos` | Listar eventos activos |
| `GET` | `/api/eventos/:id` | Detalle de un evento |
| `POST` | `/api/compra/iniciar` | Crear orden + preferencia MP |
| `POST` | `/api/compra/verificar` | Verificar estado de pago |
| `POST` | `/api/webhook/mp` | Webhook de MercadoPago |
| `GET` | `/api/orden/:id` | Estado de una orden |
| `POST` | `/api/validar-qr` | Validar QR (usado por la app) |

### Ejemplo: Iniciar compra

```json
POST /api/compra/iniciar
{
  "evento_id": "uuid-del-evento",
  "items": [
    { "tipo_entrada_id": "uuid-tipo", "cantidad": 2 }
  ],
  "comprador": {
    "nombre": "Juan Pérez",
    "email": "juan@email.com",
    "dni": "12345678"
  }
}
```

---

## 🔒 Seguridad

- **Helmet** — Headers HTTP seguros
- **CORS** configurable por entorno
- **JWT** — QR firmados criptográficamente
- **Validación de input** — Email, datos requeridos
- **Credenciales en `.env`** — Nunca hardcodeadas en el código

---

## 🛠️ Stack Tecnológico

| Componente | Tecnología |
|---|---|
| Backend | Node.js, Express |
| Base de datos | PostgreSQL |
| Pagos | MercadoPago SDK v2 |
| QR | `qrcode` (generación) + JWT (firma) |
| Email | Nodemailer + SMTP |
| App móvil | React Native + Expo |
| Cámara/QR | expo-camera |

---

## 📋 Variables de entorno

Ver [`backend/.env.example`](backend/.env.example) para la lista completa.

| Variable | Descripción | Requerida |
|---|---|---|
| `DATABASE_URL` | URL de PostgreSQL | ✅ |
| `MP_ACCESS_TOKEN` | Token de MercadoPago | ✅ |
| `MP_CLIENT_ID/MP_CLIENT_SECRET` | OAuth de MercadoPago para vendedores | ✅ |
| `MP_REDIRECT_URI` | Callback OAuth del backend | ✅ |
| `MP_MARKETPLACE_FEE_PERCENT` | Comision de plataforma, default 10 | Opcional |
| `JWT_SECRET` | Secret para firmar QR | ✅ |
| `SMTP_HOST/USER/PASS` | Credenciales de email | Opcional |
| `CORS_ORIGIN` | Dominio permitido | Opcional |

---

## 📄 Licencia

Este proyecto es privado. Todos los derechos reservados.
