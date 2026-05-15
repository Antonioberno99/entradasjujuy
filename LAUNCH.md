# EntradasJujuy - checklist de lanzamiento

## Frontend en Vercel

- Framework: Other
- Install Command: `echo "Sin dependencias"`
- Build Command: `echo "Sitio estatico listo"`
- Output Directory: `public`

El frontend estatico necesita conocer la URL publica del backend. Antes de subir a produccion, editar `config.js` y `public/config.js`:

```js
window.ENTRADASJUJUY_BACKEND = "https://TU-BACKEND-PUBLICO";
```

## Backend

Variables obligatorias del backend:

- `DATABASE_URL`
- `JWT_SECRET`
- `MP_ACCESS_TOKEN`
- `MP_CLIENT_ID`
- `MP_CLIENT_SECRET`
- `MP_REDIRECT_URI`
- `MP_MARKETPLACE_FEE_PERCENT`
- `GOOGLE_CLIENT_ID`
- `BACKEND_URL`
- `FRONTEND_URL`
- `CORS_ORIGIN`

Variables recomendadas:

- `SMTP_HOST`
- `SMTP_PORT`
- `SMTP_USER`
- `SMTP_PASS`

## Google Login

En Google Cloud Console, agregar:

- Origen local: `http://localhost:5173`
- Origen produccion: URL final de Vercel

## Mercado Pago

Usar el `MP_ACCESS_TOKEN` solamente en el backend. No poner tokens en HTML ni en archivos publicos.

Para que las entradas se emitan solas al aprobarse el pago:

- `BACKEND_URL` debe ser una URL publica HTTPS del backend.
- Mercado Pago recibira `notification_url=${BACKEND_URL}/api/webhook/mp?orden_id=...` en cada preferencia.
- `FRONTEND_URL` debe ser la URL publica de Vercel para volver al sitio luego del pago.

Para split automatico 90/10 con cuentas de organizadores:

- Cada organizador debe conectar su Mercado Pago por OAuth.
- La preferencia debe crearse con el access token OAuth del organizador.
- La comision de EntradasJujuy se envia como `marketplace_fee`.
- `MP_REDIRECT_URI` debe coincidir exactamente con la URL configurada en Mercado Pago Developers, por ejemplo `https://entradasjujuy-backend.onrender.com/api/mercadopago/oauth/callback`.
- No alcanza con guardar un alias o email de Mercado Pago del organizador.

## Limpieza de lanzamiento

Para dejar la base sin eventos, ordenes, entradas, artistas ni servicios:

```bash
cd backend
npm run db:clean:launch
```

Ejecutar este comando solo cuando se quiera limpiar una base intencionalmente.
