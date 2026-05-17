require('dotenv').config();
const express      = require('express');
const cors         = require('cors');
const helmet       = require('helmet');
const { Pool }     = require('pg');
const QRCode       = require('qrcode');
const nodemailer   = require('nodemailer');
const dns          = require('dns');
const { v4: uuid } = require('uuid');
const jwt          = require('jsonwebtoken');
const crypto       = require('crypto');
const { OAuth2Client } = require('google-auth-library');

try {
  dns.setDefaultResultOrder('ipv4first');
} catch {}
 
const app = express();
const PUBLIC_FRONTEND_URL = 'https://www.entradasjujuy.shop';
const LEGACY_FRONTEND_URL = 'https://entradasjujuy.vercel.app';

function envList(value = '') {
  return String(value)
    .split(',')
    .map((item) => item.trim().replace(/\/$/, ''))
    .filter(Boolean);
}
 
// Seguridad HTTP
app.use(helmet());
 
// CORS — restringir en producción
const allowedOrigins = new Set([
  ...envList(process.env.CORS_ORIGIN),
  PUBLIC_FRONTEND_URL,
  'https://entradasjujuy.shop',
  LEGACY_FRONTEND_URL,
  'http://localhost:5173',
  'http://localhost:3000',
]);

app.use(cors({
  origin(origin, callback) {
    if (!origin || allowedOrigins.has(origin.replace(/\/$/, ''))) {
      return callback(null, true);
    }
    return callback(new Error(`CORS no permitido para ${origin}`));
  },
  methods: ['GET', 'POST', 'DELETE', 'PUT'],
}));
 
// Body parsing — webhook necesita raw
app.use((req, res, next) => {
  if (req.path === '/api/webhook/mp') {
    express.raw({ type: '*/*' })(req, res, next);
  } else {
    express.json({ limit: '8mb' })(req, res, next);
  }
});
 
// Base de datos
const db = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://postgres:tupassword@localhost:5432/entradasjujuy',
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
});
db.query('SELECT NOW()').then(() => console.log('✓ DB conectada')).catch(e => console.error('✗ DB:', e.message));
 
// Mercado Pago
function firstEnvValue(names) {
  for (const name of names) {
    const value = String(process.env[name] || '').trim();
    if (value) return { name, value };
  }
  return { name: null, value: '' };
}

const mpAccessTokenEnv = firstEnvValue(['MP_ACCESS_TOKEN', 'MERCADOPAGO_ACCESS_TOKEN', 'ACCESS_TOKEN']);
const mpClientIdEnv = firstEnvValue(['MP_CLIENT_ID', 'MERCADOPAGO_CLIENT_ID', 'CLIENT_ID']);
const mpClientSecretEnv = firstEnvValue(['MP_CLIENT_SECRET', 'MERCADOPAGO_CLIENT_SECRET', 'CLIENT_SECRET', 'MP_SECRET']);
const MP_ACCESS_TOKEN = mpAccessTokenEnv.value;
const MP_CLIENT_ID = mpClientIdEnv.value;
const MP_CLIENT_SECRET = mpClientSecretEnv.value;
const MP_REDIRECT_URI = String(process.env.MP_REDIRECT_URI || '').trim() || `${process.env.BACKEND_URL || 'http://localhost:3001'}/api/mercadopago/oauth/callback`;
const MP_MARKETPLACE_FEE_PERCENT = Number(process.env.MP_MARKETPLACE_FEE_PERCENT || '6');
/* Cobertura de la comision de Mercado Pago (checkout). Se le suma al comprador
   pero NO va al marketplace_fee: queda en la unidad para que MP descuente su
   tarifa de ahi y el organizador reciba integro el precio publicado. */
const MP_CHECKOUT_FEE_PERCENT = Number(process.env.MP_CHECKOUT_FEE_PERCENT || '6.60');
const MP_OAUTH_PKCE = String(process.env.MP_OAUTH_PKCE || 'true').toLowerCase() !== 'false';
let lastMercadoPagoOAuthError = null;
let lastMercadoPagoOAuthSuccess = null;

function mpConfigStatus() {
  const missing = [];
  if (!MP_ACCESS_TOKEN) missing.push('MP_ACCESS_TOKEN');
  if (!MP_CLIENT_ID) missing.push('MP_CLIENT_ID');
  if (!MP_CLIENT_SECRET && !MP_OAUTH_PKCE) missing.push('MP_CLIENT_SECRET');
  if (!MP_REDIRECT_URI) missing.push('MP_REDIRECT_URI');
  return {
    access_token_configured: !!MP_ACCESS_TOKEN,
    oauth_configured: !!MP_CLIENT_ID && !!MP_REDIRECT_URI && (!!MP_CLIENT_SECRET || MP_OAUTH_PKCE),
    oauth_pkce_enabled: MP_OAUTH_PKCE,
    client_id_configured: !!MP_CLIENT_ID,
    client_id_last4: MP_CLIENT_ID ? String(MP_CLIENT_ID).slice(-4) : null,
    client_id_length: MP_CLIENT_ID ? String(MP_CLIENT_ID).length : 0,
    client_secret_configured: !!MP_CLIENT_SECRET,
    env_sources: {
      access_token: mpAccessTokenEnv.name,
      client_id: mpClientIdEnv.name,
      client_secret: mpClientSecretEnv.name,
    },
    known_secret_keys_present: {
      MP_CLIENT_SECRET: Object.prototype.hasOwnProperty.call(process.env, 'MP_CLIENT_SECRET'),
      MERCADOPAGO_CLIENT_SECRET: Object.prototype.hasOwnProperty.call(process.env, 'MERCADOPAGO_CLIENT_SECRET'),
      CLIENT_SECRET: Object.prototype.hasOwnProperty.call(process.env, 'CLIENT_SECRET'),
      MP_SECRET: Object.prototype.hasOwnProperty.call(process.env, 'MP_SECRET'),
    },
    redirect_uri: MP_REDIRECT_URI,
    marketplace_fee_percent: MP_MARKETPLACE_FEE_PERCENT,
    checkout_fee_percent: MP_CHECKOUT_FEE_PERCENT,
    last_oauth_error: lastMercadoPagoOAuthError,
    last_oauth_success: lastMercadoPagoOAuthSuccess,
    missing,
  };
}

if (!MP_ACCESS_TOKEN) console.warn('⚠ MP_ACCESS_TOKEN no configurado en .env');
if (!MP_CLIENT_ID || (!MP_CLIENT_SECRET && !MP_OAUTH_PKCE)) console.warn('⚠ Mercado Pago OAuth no configurado: falta MP_CLIENT_ID o MP_CLIENT_SECRET/PKCE');

async function mpRequest(path, options = {}) {
  const accessToken = options.accessToken || MP_ACCESS_TOKEN;
  if (!accessToken) throw new Error('Access Token de Mercado Pago no configurado');
  const response = await fetch(`https://api.mercadopago.com${path}`, {
    method: options.method || 'GET',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.message || data.error || `Mercado Pago HTTP ${response.status}`);
  return data;
}

async function mpOAuthToken(body) {
  const form = new URLSearchParams();
  Object.entries(body || {}).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') form.set(key, String(value));
  });
  const response = await fetch('https://api.mercadopago.com/oauth/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      ...(MP_ACCESS_TOKEN ? { Authorization: `Bearer ${MP_ACCESS_TOKEN}` } : {}),
    },
    body: form.toString(),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail = [data.message, data.error, data.error_description, data.cause && JSON.stringify(data.cause)]
      .filter(Boolean)
      .join(' - ');
    throw new Error(detail || `Mercado Pago OAuth HTTP ${response.status}`);
  }
  return data;
}

function base64Url(buffer) {
  return Buffer.from(buffer).toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function createPkcePair() {
  const verifier = base64Url(crypto.randomBytes(48));
  const challenge = base64Url(crypto.createHash('sha256').update(verifier).digest());
  return { verifier, challenge, method: 'S256' };
}

function withOptionalClientSecret(body) {
  return MP_CLIENT_SECRET ? { ...body, client_secret: MP_CLIENT_SECRET } : body;
}

function mpTokenExpiry(expiresInSeconds) {
  const seconds = Number(expiresInSeconds || 0);
  if (!Number.isFinite(seconds) || seconds <= 0) return null;
  return new Date(Date.now() + seconds * 1000);
}

async function refreshSellerMpToken(seller) {
  if (!seller.mp_refresh_token) return seller;
  const expiresAt = seller.mp_token_expires_at ? new Date(seller.mp_token_expires_at).getTime() : 0;
  const shouldRefresh = !expiresAt || expiresAt - Date.now() < 7 * 24 * 60 * 60 * 1000;
  if (!shouldRefresh) return seller;

  const data = await mpOAuthToken(withOptionalClientSecret({
    client_id: MP_CLIENT_ID,
    grant_type: 'refresh_token',
    refresh_token: seller.mp_refresh_token,
  }));

  const { rows } = await db.query(`
    UPDATE usuarios
    SET mp_access_token = $2,
        mp_refresh_token = COALESCE($3, mp_refresh_token),
        mp_public_key = COALESCE($4, mp_public_key),
        mp_user_id = COALESCE($5, mp_user_id),
        mp_scope = COALESCE($6, mp_scope),
        mp_token_expires_at = $7,
        mp_connected_at = NOW()
    WHERE id = $1
    RETURNING *
  `, [
    seller.id,
    data.access_token,
    data.refresh_token,
    data.public_key,
    data.user_id ? String(data.user_id) : null,
    data.scope || null,
    mpTokenExpiry(data.expires_in),
  ]);
  return rows[0] || seller;
}
 
// JWT
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) console.warn('⚠ JWT_SECRET no configurado en .env — se usará un valor temporal INSEGURO');
const jwtSecret = JWT_SECRET || 'dev_only_change_in_production_' + Date.now();
 
// URLs
const BACKEND_URL  = process.env.BACKEND_URL  || 'http://localhost:3001';
const configuredFrontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
const FRONTEND_URL = process.env.NODE_ENV === 'production'
  ? PUBLIC_FRONTEND_URL
  : configuredFrontendUrl;
const DEFAULT_GOOGLE_CLIENT_ID = '258196394841-1fgpfbm966tvlo87d8ilji09fmnjlejq.apps.googleusercontent.com';
const GOOGLE_CLIENT_IDS = envList(process.env.GOOGLE_CLIENT_ID || DEFAULT_GOOGLE_CLIENT_ID);
const GOOGLE_CLIENT_ID = GOOGLE_CLIENT_IDS[0];
const googleOAuthClient = new OAuth2Client(GOOGLE_CLIENT_ID);
 
// Email
const SMTP_HOST = process.env.SMTP_HOST || 'sandbox.smtp.mailtrap.io';
const SMTP_PORT = parseInt(process.env.SMTP_PORT || '587', 10);
/* SMTP_SECURE: true para SSL directo (465), false para STARTTLS (587, 2525).
   Brevo en 2525 SIEMPRE es STARTTLS, aunque el usuario haya seteado SMTP_SECURE=true. */
let SMTP_SECURE = String(process.env.SMTP_SECURE || '').toLowerCase() === 'true' || SMTP_PORT === 465;
if (SMTP_PORT === 2525) SMTP_SECURE = false;
if (SMTP_PORT === 587) SMTP_SECURE = false;
const SMTP_USER = String(process.env.SMTP_USER || '').trim();
const SMTP_PASS_RAW = String(process.env.SMTP_PASS || '').trim();
const SMTP_PASS = /gmail/i.test(SMTP_HOST) ? SMTP_PASS_RAW.replace(/\s+/g, '') : SMTP_PASS_RAW;
const SMTP_FROM = String(process.env.SMTP_FROM || SMTP_USER || '').trim();
const MAIL_FROM = SMTP_FROM.includes('<') ? SMTP_FROM : `"Entradas Jujuy" <${SMTP_FROM || SMTP_USER}>`;
let lastEmailError = null;
let lastEmailSuccess = null;

function safeSmtpInfo() {
  const userDomain = SMTP_USER.includes('@') ? SMTP_USER.split('@').pop() : '';
  return {
    configured: !!SMTP_USER && !!SMTP_PASS,
    host_configured: !!process.env.SMTP_HOST,
    host: SMTP_HOST,
    port: SMTP_PORT,
    secure: SMTP_SECURE,
    user_domain: userDomain || null,
    from_configured: !!SMTP_FROM,
    password_normalized: SMTP_PASS_RAW !== SMTP_PASS,
    brevo_api_configured: !!BREVO_API_KEY,
    active_transport: BREVO_API_KEY ? 'brevo_http_api' : 'smtp',
    last_error: lastEmailError,
    last_success: lastEmailSuccess,
  };
}

function rememberEmailError(err, context) {
  lastEmailError = {
    at: new Date().toISOString(),
    context,
    code: String(err?.code || ''),
    command: String(err?.command || ''),
    message: String(err?.message || '').slice(0, 180),
  };
}

const mailer = nodemailer.createTransport({
  host:   SMTP_HOST,
  port:   SMTP_PORT,
  secure: SMTP_SECURE,
  auth: { user: SMTP_USER, pass: SMTP_PASS },
  family: 4,
  connectionTimeout: 10000,
  greetingTimeout: 10000,
  socketTimeout: 15000,
});

function createMailerOverride(port, secure) {
  return nodemailer.createTransport({
    host: SMTP_HOST,
    port,
    secure,
    requireTLS: !secure && port === 587,
    auth: { user: SMTP_USER, pass: SMTP_PASS },
    family: 4,
    connectionTimeout: 10000,
    greetingTimeout: 10000,
    socketTimeout: 15000,
  });
}

function sendWithTimeout(transport, message, context) {
  return Promise.race([
    transport.sendMail(message),
    new Promise((_, reject) => {
      setTimeout(() => reject(Object.assign(new Error(`Timeout enviando email (${context})`), { code: 'EMAIL_TIMEOUT' })), 18000);
    }),
  ]);
}

/* === BREVO HTTP API (alternativa al SMTP) ===
   El SMTP de Brevo acepta "queued" pero descarta silenciosamente
   los emails con sender no verificado. La HTTP API te devuelve
   un error explícito (400 "sender_not_authorized") y usa puerto
   443 que nunca está bloqueado.
   Para usarla: configurar BREVO_API_KEY en Render. */
const BREVO_API_KEY = String(process.env.BREVO_API_KEY || '').trim();

async function sendViaBrevoApi(message) {
  if (!BREVO_API_KEY) throw new Error('BREVO_API_KEY no configurada');
  /* Parsear "Nombre <email>" o solo "email" del MAIL_FROM */
  let senderEmail = '', senderName = '';
  const fromStr = String(message.from || MAIL_FROM);
  const m = fromStr.match(/^"?([^"<]*)"?\s*<([^>]+)>$/);
  if (m) { senderName = m[1].trim(); senderEmail = m[2].trim(); }
  else { senderEmail = fromStr.replace(/[<>]/g, '').trim(); }

  const toList = (Array.isArray(message.to) ? message.to : [message.to])
    .filter(Boolean)
    .map(addr => ({ email: String(addr).replace(/.*<([^>]+)>.*/, '$1').trim() }));

  /* Brevo API: attachments en base64 (no Buffer) */
  const attachments = (message.attachments || []).map(att => ({
    name: att.filename,
    content: Buffer.isBuffer(att.content) ? att.content.toString('base64') : String(att.content || ''),
  }));

  const payload = {
    sender: senderName ? { email: senderEmail, name: senderName } : { email: senderEmail },
    to: toList,
    subject: message.subject || '',
    htmlContent: message.html || message.text || '',
  };
  if (message.text) payload.textContent = message.text;
  if (attachments.length) payload.attachment = attachments;

  const resp = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: {
      'api-key': BREVO_API_KEY,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    },
    body: JSON.stringify(payload),
  });
  const text = await resp.text();
  let json = null;
  try { json = JSON.parse(text); } catch {}
  if (!resp.ok) {
    const err = new Error(`Brevo API ${resp.status}: ${json?.message || text}`);
    err.code = json?.code || `HTTP_${resp.status}`;
    err.brevoResponse = json || text;
    throw err;
  }
  return { accepted: toList.map(t => t.email), rejected: [], response: `Brevo API OK msg=${json?.messageId || 'sent'}`, messageId: json?.messageId };
}

async function sendMailResilient(message, context) {
  /* Si está configurada la API HTTP de Brevo, la usamos PRIMERO porque:
     1. Funciona por HTTPS (443) — Render nunca lo bloquea
     2. Devuelve errores explícitos cuando el sender no está verificado
     3. No depende del SMTP user/pass */
  if (BREVO_API_KEY) {
    try {
      console.log(`[BREVO-API] Enviando ${context} a ${message.to}...`);
      const info = await sendViaBrevoApi(message);
      lastEmailError = null;
      lastEmailSuccess = {
        at: new Date().toISOString(),
        context,
        transport: `${context}_brevo_api`,
        to: String(message.to || '').slice(0, 80),
        accepted: info.accepted?.length || null,
        rejected: info.rejected?.length || null,
        response: String(info.response || '').slice(0, 180),
      };
      console.log(`[BREVO-API] OK ${context}: ${lastEmailSuccess.response}`);
      return info;
    } catch (err) {
      rememberEmailError(err, `${context}_brevo_api`);
      console.error(`[BREVO-API] Fallo ${context}: ${err.message}`);
      console.error('[BREVO-API] Respuesta detalle:', JSON.stringify(err.brevoResponse || {}).slice(0, 400));
      /* No hacemos fallback a SMTP si la API devolvió error porque ese error
         es la causa raíz que queremos ver (sender_not_authorized, etc.) */
      throw err;
    }
  }

  const attempts = [];

  /* Brevo en Render: el puerto 587 frecuentemente falla por bloqueos
     del proveedor; el 2525 funciona consistentemente. Lo probamos PRIMERO
     para no esperar el timeout del 587. */
  if (/brevo/i.test(SMTP_HOST) && SMTP_PORT !== 2525) {
    attempts.push({ label: `${context}_brevo_2525`, transport: createMailerOverride(2525, false) });
  }
  attempts.push({ label: `${context}_primary`, transport: mailer });
  if (/gmail/i.test(SMTP_HOST) && SMTP_PORT === 465) {
    attempts.push({ label: `${context}_gmail_587`, transport: createMailerOverride(587, false) });
  }
  /* Hostinger: probar ambos puertos seguros (465 SSL y 587 STARTTLS) si el primary falla */
  if (/hostinger/i.test(SMTP_HOST)) {
    if (SMTP_PORT !== 465) {
      attempts.push({ label: `${context}_hostinger_465`, transport: createMailerOverride(465, true) });
    }
    if (SMTP_PORT !== 587) {
      attempts.push({ label: `${context}_hostinger_587`, transport: createMailerOverride(587, false) });
    }
  }

  let lastErr = null;
  for (const attempt of attempts) {
    try {
      console.log(`[SMTP] Enviando ${attempt.label} a ${message.to}...`);
      const info = await sendWithTimeout(attempt.transport, message, attempt.label);
      lastEmailError = null;
      lastEmailSuccess = {
        at: new Date().toISOString(),
        context,
        transport: attempt.label,
        to: String(message.to || '').slice(0, 80),
        accepted: Array.isArray(info?.accepted) ? info.accepted.length : null,
        rejected: Array.isArray(info?.rejected) ? info.rejected.length : null,
        response: String(info?.response || '').slice(0, 180),
      };
      console.log(`[SMTP] OK ${attempt.label}: ${lastEmailSuccess.response}`);
      return info;
    } catch (err) {
      lastErr = err;
      rememberEmailError(err, attempt.label);
      console.warn(`[SMTP] Fallo ${attempt.label}: ${err.message} (code=${err.code || 'n/a'})`);
    }
  }
  console.error(`[SMTP] Todos los intentos fallaron para ${context} a ${message.to}`);
  throw lastErr;
}
 
// ── Health check
app.get('/health', (req, res) => res.json({
  ok: true,
  build: 'text-cleanup-delete-events-v1',
  smtp: safeSmtpInfo(),
  mercadopago: mpConfigStatus(),
}));

/* Endpoint diagnóstico: prueba conexión TCP a varios puertos SMTP comunes
   Uso: GET /api/admin/smtp-probe
   Sin auth — solo testea conectividad, no manda emails. */
app.get('/api/admin/smtp-probe', async (req, res) => {
  const net = require('net');
  const targets = [
    { host: 'smtp.hostinger.com', port: 465, label: 'hostinger_465_ssl' },
    { host: 'smtp.hostinger.com', port: 587, label: 'hostinger_587_tls' },
    { host: 'smtp-relay.brevo.com', port: 587, label: 'brevo_587' },
    { host: 'smtp-relay.brevo.com', port: 2525, label: 'brevo_2525' },
    { host: 'smtp.gmail.com', port: 465, label: 'gmail_465_ssl' },
    { host: 'smtp.gmail.com', port: 587, label: 'gmail_587_tls' },
  ];
  const probe = (host, port) => new Promise((resolve) => {
    const start = Date.now();
    const sock = new net.Socket();
    let resolved = false;
    const finish = (status, err) => {
      if (resolved) return;
      resolved = true;
      sock.destroy();
      resolve({ status, ms: Date.now() - start, error: err || null });
    };
    sock.setTimeout(6000);
    sock.on('connect', () => finish('ok'));
    sock.on('timeout', () => finish('timeout'));
    sock.on('error', (err) => finish('error', err.code || err.message));
    sock.connect(port, host);
  });
  const results = {};
  for (const t of targets) {
    results[t.label] = await probe(t.host, t.port);
  }
  res.json({ ok: true, currently_configured: { host: SMTP_HOST, port: SMTP_PORT }, results });
});

/* Endpoint diagnóstico: enviar un email de prueba a cualquier destinatario.
   Uso: GET /api/admin/email-test?to=tu@email.com&key=ADMIN_KEY
   Si ADMIN_KEY no está seteado, requiere que el destinatario sea SMTP_USER
   (es decir, te lo mandás a vos mismo) para evitar abuso. */
app.get('/api/admin/email-test', async (req, res) => {
  const to = String(req.query.to || '').trim();
  const key = String(req.query.key || '').trim();
  const adminKey = String(process.env.ADMIN_KEY || '').trim();

  if (!to) return res.status(400).json({ ok: false, error: 'Falta ?to=email' });
  if (adminKey) {
    if (key !== adminKey) return res.status(401).json({ ok: false, error: 'ADMIN_KEY inválida' });
  } else {
    /* Sin ADMIN_KEY configurada: solo permite enviarte a vos mismo (SMTP_USER) */
    if (to.toLowerCase() !== SMTP_USER.toLowerCase()) {
      return res.status(403).json({ ok: false, error: 'Configurá ADMIN_KEY en Render o usá ?to=' + SMTP_USER });
    }
  }
  if (!SMTP_USER || !SMTP_PASS) {
    return res.status(503).json({ ok: false, error: 'SMTP no configurado (faltan SMTP_USER/SMTP_PASS)' });
  }
  try {
    const info = await sendMailResilient({
      from: MAIL_FROM,
      to,
      subject: 'Prueba de SMTP - EntradasJujuy',
      text: 'Si recibís este email, el envío desde el backend funciona correctamente.',
      html: '<div style="font-family:Arial,sans-serif;padding:20px;background:#0a0704;color:#EAE0D0;border-radius:10px;max-width:480px;margin:0 auto"><h2 style="color:#C4692B;margin:0 0 10px">Test de SMTP ✓</h2><p style="line-height:1.5">Si recibís este email, el envío desde el backend de EntradasJujuy funciona correctamente.</p><p style="font-size:12px;color:#9A8670;margin-top:18px">Enviado desde ' + SMTP_HOST + ':' + SMTP_PORT + '</p></div>',
    }, 'admin_test');
    res.json({
      ok: true,
      to,
      from: MAIL_FROM,
      host: SMTP_HOST,
      port: SMTP_PORT,
      transport: lastEmailSuccess?.transport || null,
      response: String(info?.response || '').slice(0, 200),
      tip: 'Si no llegó, revisá la carpeta de SPAM. Es lo más común con remitentes nuevos.',
    });
  } catch (err) {
    res.status(500).json({
      ok: false,
      error: err.message,
      code: err.code || null,
      command: err.command || null,
      host: SMTP_HOST,
      port: SMTP_PORT,
      from: MAIL_FROM,
    });
  }
});

// ── Auth helpers
function normalizeEmail(email = '') {
  return String(email).trim().toLowerCase();
}

function publicUser(user) {
  return {
    id: user.id,
    nombre: user.nombre,
    email: user.email,
    rol: user.rol,
    avatar_url: user.avatar_url || null,
    auth_provider: user.auth_provider || 'password',
    email_verified: !!user.email_verified,
  };
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.pbkdf2Sync(password, salt, 120000, 64, 'sha512').toString('hex');
  return `pbkdf2$120000$${salt}$${hash}`;
}

function verifyPassword(password, storedHash = '') {
  const [method, iterations, salt, hash] = storedHash.split('$');
  if (method !== 'pbkdf2' || !iterations || !salt || !hash) return false;
  const candidate = crypto.pbkdf2Sync(password, salt, Number(iterations), 64, 'sha512').toString('hex');
  if (hash.length !== candidate.length) return false;
  return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(candidate, 'hex'));
}

function passwordPolicyError(password) {
  if (password.length < 8) return 'La contraseña debe tener al menos 8 caracteres';
  if (!/[A-Z]/.test(password)) return 'La contraseña debe incluir al menos una mayúscula';
  if (!/[0-9]/.test(password)) return 'La contraseña debe incluir al menos un número';
  return '';
}

function signSession(user) {
  return jwt.sign(
    { user_id: user.id, email: user.email, rol: user.rol, type: 'session' },
    jwtSecret,
    { expiresIn: '7d' }
  );
}

function authPayload(user) {
  const usuario = publicUser(user);
  return { ok: true, token: signSession(user), user: usuario, usuario };
}

function makeEmailVerificationToken() {
  const token = crypto.randomBytes(32).toString('hex');
  return {
    token,
    hash: crypto.createHash('sha256').update(token).digest('hex'),
  };
}

async function issueEmailVerification(user) {
  const { token, hash } = makeEmailVerificationToken();
  await db.query(`
    UPDATE usuarios
    SET email_verification_token_hash = $2,
        email_verification_expires_at = NOW() + INTERVAL '24 hours'
    WHERE id = $1
  `, [user.id, hash]);
  return token;
}

async function sendVerificationEmail(user, token) {
  if (!SMTP_USER || !SMTP_PASS) {
    throw new Error('SMTP no configurado para enviar verificacion');
  }
  const verifyUrl = `${FRONTEND_URL}/?verify_email=${encodeURIComponent(token)}`;
  const message = {
    from: MAIL_FROM,
    to: user.email,
    subject: '¡Bienvenido a EntradasJujuy! Verificá tu cuenta',
    text: `Hola ${user.nombre}, bienvenido a EntradasJujuy. Verificá tu cuenta acá: ${verifyUrl}\n\nEntradasJujuy es la ticketera y guía cultural de Jujuy: comprás entradas en segundos, el QR llega a tu mail y podés explorar artistas, servicios y eventos locales.\n\nSi no creaste esta cuenta, ignorá este mensaje.`,
    html: `<div style="max-width:560px;margin:0 auto;font-family:Arial,sans-serif;color:#1f1a14">
      <div style="background:#0a0704;padding:26px;text-align:center;border-radius:12px 12px 0 0">
        <h1 style="color:#C4692B;margin:0;font-size:28px;font-weight:900;letter-spacing:-.5px">Entradas<span style="color:#3A6FA0">Jujuy</span></h1>
        <div style="color:#9A8670;font-size:11px;letter-spacing:2px;text-transform:uppercase;margin-top:6px">Ticketera y guía cultural de Jujuy</div>
      </div>
      <div style="padding:32px 28px;background:#fff;border:1px solid #eadfd3;border-top:0">
        <h2 style="margin:0 0 14px;color:#0a0704;font-size:22px">¡Bienvenido, ${user.nombre}!</h2>
        <p style="line-height:1.6;margin:0 0 18px;font-size:14px;color:#3d342a">Gracias por sumarte. Tu cuenta ya está creada — solo falta un paso: <strong>verificar que este email es tuyo</strong>. Tocá el botón:</p>
        <div style="text-align:center;margin:24px 0">
          <a href="${verifyUrl}" style="display:inline-block;background:#C4692B;color:#fff;text-decoration:none;padding:14px 32px;border-radius:10px;font-weight:700;font-size:14px;letter-spacing:.3px">Verificar mi cuenta</a>
        </div>
        <p style="font-size:11px;color:#7d7268;line-height:1.5;margin:0 0 18px;text-align:center">¿No funciona el botón? Pegá este link en tu navegador:<br><span style="color:#C4692B;word-break:break-all;font-size:10px">${verifyUrl}</span></p>
      </div>
      <div style="padding:20px 28px;background:#f9f5f0;border:1px solid #eadfd3;border-top:0;border-radius:0 0 12px 12px">
        <div style="font-size:11px;letter-spacing:1.5px;text-transform:uppercase;color:#7d6c52;margin-bottom:10px">Qué podés hacer con tu cuenta</div>
        <ul style="margin:0;padding-left:18px;font-size:13px;color:#3d342a;line-height:1.7">
          <li>Comprar entradas con QR enviado al instante a tu email</li>
          <li>Publicar eventos y cobrar con Mercado Pago al instante</li>
          <li>Descubrir artistas y servicios locales de Jujuy</li>
        </ul>
        <p style="font-size:11px;color:#9a8670;line-height:1.5;margin:18px 0 0">El enlace vence en 24 horas. Si no creaste esta cuenta, ignorá este mensaje.</p>
      </div>
    </div>`,
  };
  await sendMailResilient(message, 'verification');
}

async function respondWithVerificationEmail(res, user, statusCode, message) {
  try {
    const token = await issueEmailVerification(user);
    await sendVerificationEmail(user, token);
    return res.status(statusCode).json({
      ok: true,
      needs_verification: true,
      email: user.email,
      message,
    });
  } catch (err) {
    console.error('[AUTH VERIFY EMAIL SEND]', err.message);
    if (emailDeliveryError(err)) {
      return res.status(202).json({
        ok: true,
        needs_verification: true,
        email: user.email,
        code: 'verification_email_failed',
        message: 'Tu cuenta fue creada, pero no pudimos enviar el email de verificacion ahora. Intenta reenviarlo en unos minutos.',
      });
    }
    throw err;
  }
}

function emailDeliveryError(err) {
  const code = String(err?.code || '');
  const msg = String(err?.message || '');
  return ['EAUTH', 'ECONNECTION', 'ESOCKET', 'ETIMEDOUT', 'EMAIL_TIMEOUT'].includes(code) || /smtp|mail|auth|timeout/i.test(msg);
}

async function getSessionUser(req) {
  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!token) return null;

  const payload = jwt.verify(token, jwtSecret);
  const { rows } = await db.query(
    `SELECT id, nombre, email, rol, avatar_url, auth_provider, email_verified, activo,
            mp_user_id, mp_access_token, mp_refresh_token, mp_public_key, mp_scope,
            mp_token_expires_at, mp_connected_at
     FROM usuarios
     WHERE id = $1`,
    [payload.user_id]
  );
  if (!rows.length || !rows[0].activo) return null;
  return rows[0];
}

async function requireAuth(req, res, next) {
  try {
    const user = await getSessionUser(req);
    if (!user) return res.status(401).json({ ok: false, error: 'Inicia sesion para continuar' });
    req.user = user;
    next();
  } catch {
    res.status(401).json({ ok: false, error: 'Sesion invalida' });
  }
}

async function getUserByEmail(email) {
  const { rows } = await db.query('SELECT * FROM usuarios WHERE email = $1', [normalizeEmail(email)]);
  return rows[0];
}

async function verifyGoogleCredential(credential) {
  if (!GOOGLE_CLIENT_IDS.length) throw new Error('GOOGLE_CLIENT_ID no configurado');
  const ticket = await googleOAuthClient.verifyIdToken({
    idToken: credential,
    audience: GOOGLE_CLIENT_IDS,
  });
  const profile = ticket.getPayload();
  if (!profile?.sub || !profile?.email) throw new Error('Token de Google inválido');
  if (profile.email_verified !== true && profile.email_verified !== 'true') {
    throw new Error('Email de Google no verificado');
  }

  return {
    googleId: profile.sub,
    email: normalizeEmail(profile.email),
    nombre: profile.name || profile.email,
    avatarUrl: profile.picture || null,
  };
}

// ── Register
app.post('/api/auth/register', async (req, res) => {
  const nombre = String(req.body?.nombre || '').trim();
  const email = normalizeEmail(req.body?.email);
  const password = String(req.body?.password || '');

  if (!nombre || !email || !password) {
    return res.status(400).json({ ok: false, error: 'Completá nombre, email y contraseña' });
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ ok: false, error: 'Email inválido' });
  }
  const passwordError = passwordPolicyError(password);
  if (passwordError) return res.status(400).json({ ok: false, error: passwordError });

  try {
    const existing = await getUserByEmail(email);
    if (existing) {
      return res.status(409).json({ ok: false, error: 'Ya existe una cuenta con ese email' });
    }

    const { rows } = await db.query(`
      INSERT INTO usuarios (nombre, email, password_hash, rol, auth_provider, email_verified)
      VALUES ($1, $2, $3, 'organizador', 'password', true)
      RETURNING id, nombre, email, rol, avatar_url, auth_provider, email_verified
    `, [nombre, email, hashPassword(password)]);

    const user = rows[0];
    res.status(201).json(authPayload(user));
  } catch (err) {
    console.error('[AUTH REGISTER]', err.message);
    res.status(500).json({ ok: false, error: 'No pudimos crear la cuenta. Intenta nuevamente.' });
  }
});

// Alias usado por el HTML principal.
app.post('/api/auth/registro', async (req, res) => {
  const nombre = String(req.body?.nombre || '').trim();
  const email = normalizeEmail(req.body?.email);
  const password = String(req.body?.password || '');
  const requestedRole = String(req.body?.rol || 'comprador').trim();
  const allowedRoles = new Set(['comprador', 'organizador', 'artista', 'servicios', 'admin']);
  const rol = allowedRoles.has(requestedRole) ? requestedRole : 'comprador';

  if (!nombre || !email || !password) {
    return res.status(400).json({ ok: false, error: 'Completa nombre, email y password' });
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ ok: false, error: 'Email invalido' });
  }
  const passwordError = passwordPolicyError(password);
  if (passwordError) return res.status(400).json({ ok: false, error: passwordError });

  try {
    const existing = await getUserByEmail(email);
    if (existing) {
      return res.status(409).json({ ok: false, error: 'Ya existe una cuenta con ese email' });
    }

    /* Crear cuenta sin verificar — disparamos el email de bienvenida +
       verificación. El usuario queda autenticado pero con email_verified=false
       hasta que clickee el link. */
    const { rows } = await db.query(`
      INSERT INTO usuarios (nombre, email, password_hash, rol, auth_provider, email_verified)
      VALUES ($1, $2, $3, $4, 'password', false)
      RETURNING id, nombre, email, rol, avatar_url, auth_provider, email_verified
    `, [nombre, email, hashPassword(password), rol]);

    const user = rows[0];
    return respondWithVerificationEmail(
      res,
      user,
      201,
      'Cuenta creada. Te enviamos un email de bienvenida con el link de verificación. Revisá tu Gmail (y la carpeta de spam por las dudas).'
    );
  } catch (err) {
    console.error('[AUTH REGISTRO]', err.message);
    res.status(500).json({ ok: false, error: 'No pudimos crear la cuenta. Intenta nuevamente.' });
  }
});

// ── Login
app.post('/api/auth/login', async (req, res) => {
  const email = normalizeEmail(req.body?.email);
  const password = String(req.body?.password || '');

  if (!email || !password) return res.status(400).json({ ok: false, error: 'Completá email y contraseña' });

  try {
    let user = await getUserByEmail(email);
    if (!user || !user.activo || !verifyPassword(password, user.password_hash)) {
      return res.status(401).json({ ok: false, error: 'Email o contraseña incorrectos' });
    }
    if (!user.email_verified) {
      const { rows } = await db.query(`
        UPDATE usuarios
        SET email_verified = true,
            email_verified_at = COALESCE(email_verified_at, NOW()),
            email_verification_token_hash = NULL,
            email_verification_expires_at = NULL
        WHERE id = $1
        RETURNING id, nombre, email, rol, avatar_url, auth_provider, email_verified
      `, [user.id]);
      user = rows[0] || user;
    }

    res.json(authPayload(user));
  } catch (err) {
    console.error('[AUTH LOGIN]', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ── Login/Register con Google Identity Services
app.get('/api/auth/verificar-email', async (req, res) => {
  const token = String(req.query?.token || '').trim();
  if (!token) return res.status(400).json({ ok: false, error: 'Falta token de verificacion' });

  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  try {
    const { rows } = await db.query(`
      UPDATE usuarios
      SET email_verified = true,
          email_verified_at = NOW(),
          email_verification_token_hash = NULL,
          email_verification_expires_at = NULL
      WHERE email_verification_token_hash = $1
        AND email_verification_expires_at > NOW()
        AND email_verified = false
      RETURNING id, nombre, email, rol, avatar_url, auth_provider, email_verified
    `, [tokenHash]);

    if (!rows.length) {
      return res.status(400).json({ ok: false, error: 'El enlace vencio o ya fue usado' });
    }

    res.json({
      ...authPayload(rows[0]),
      message: 'Email verificado. Ya estas ingresado en EntradasJujuy.',
    });
  } catch (err) {
    console.error('[AUTH VERIFY EMAIL]', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

/* Polling: el frontend chequea cada 3s si el usuario ya verificó su email.
   Solo devuelve {verified:bool}, no datos sensibles ni token. */
app.get('/api/auth/verification-status', async (req, res) => {
  const email = normalizeEmail(req.query?.email || '');
  if (!email) return res.status(400).json({ ok: false, error: 'Falta email' });
  try {
    const { rows } = await db.query(
      'SELECT email_verified FROM usuarios WHERE email = $1 LIMIT 1',
      [email]
    );
    if (!rows.length) return res.json({ ok: true, verified: false, exists: false });
    res.json({ ok: true, verified: !!rows[0].email_verified, exists: true });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.post('/api/auth/reenviar-verificacion', async (req, res) => {
  const email = normalizeEmail(req.body?.email);
  if (!email) return res.status(400).json({ ok: false, error: 'Falta email' });

  try {
    const user = await getUserByEmail(email);
    if (!user) return res.status(404).json({ ok: false, error: 'No existe una cuenta con ese email' });
    if (user.email_verified) return res.json({ ok: true, message: 'La cuenta ya esta verificada' });

    const token = await issueEmailVerification(user);
    await sendVerificationEmail(user, token);
    res.json({ ok: true, message: 'Te reenviamos el email de verificacion' });
  } catch (err) {
    console.error('[AUTH RESEND VERIFY]', err.message);
    if (emailDeliveryError(err)) {
      return res.status(503).json({
        ok: false,
        code: 'verification_email_failed',
        error: 'No pudimos enviar el email de verificacion ahora. Intenta nuevamente en unos minutos.',
      });
    }
    res.status(500).json({ ok: false, error: 'No pudimos reenviar el email de verificacion' });
  }
});

app.post('/api/auth/google', async (req, res) => {
  const { credential } = req.body || {};
  const requestedRole = String(req.body?.rol || 'comprador').trim();
  const allowedRoles = new Set(['comprador', 'organizador', 'artista', 'servicios', 'admin']);
  const rol = allowedRoles.has(requestedRole) ? requestedRole : 'comprador';
  if (!credential) return res.status(400).json({ ok: false, error: 'Falta credencial de Google' });

  try {
    const profile = await verifyGoogleCredential(credential);
    const existing = await getUserByEmail(profile.email);

    if (existing) {
      /* Cuenta YA existe: actualizar datos de Google y loguear normalmente */
      const { rows } = await db.query(`
        UPDATE usuarios
        SET google_id = COALESCE(google_id, $2),
            avatar_url = COALESCE($3, avatar_url),
            auth_provider = CASE WHEN auth_provider = 'password' THEN 'password' ELSE 'google' END,
            email_verified = true,
            email_verified_at = COALESCE(email_verified_at, NOW()),
            email_verification_token_hash = NULL,
            email_verification_expires_at = NULL
        WHERE id = $1
        RETURNING id, nombre, email, rol, avatar_url, auth_provider, email_verified
      `, [existing.id, profile.googleId, profile.avatarUrl]);
      return res.json(authPayload(rows[0]));
    }

    /* Cuenta NUEVA con Google: crear sin verificar y disparar email de verificación.
       Esto previene que el botón Google en "Iniciar sesión" cree cuentas silenciosamente
       — el usuario tiene que confirmar el email antes de poder usar la cuenta. */
    const { rows: created } = await db.query(`
      INSERT INTO usuarios (nombre, email, password_hash, rol, auth_provider, google_id, avatar_url, email_verified)
      VALUES ($1, $2, '', $5, 'google', $3, $4, false)
      RETURNING id, nombre, email, rol, avatar_url, auth_provider, email_verified
    `, [profile.nombre, profile.email, profile.googleId, profile.avatarUrl, rol]);
    const newUser = created[0];

    return respondWithVerificationEmail(
      res,
      newUser,
      201,
      'Te creamos una cuenta con tu Google. Antes de empezar, confirmá tu email tocando el link que te enviamos a tu Gmail.'
    );
  } catch (err) {
    console.error('[AUTH GOOGLE]', err.message);
    res.status(401).json({ ok: false, error: err.message });
  }
});

app.get('/api/auth/perfil', async (req, res) => {
  try {
    const user = await getSessionUser(req);
    if (!user) return res.status(401).json({ ok: false, error: 'Sesion invalida' });
    const usuario = publicUser(user);
    res.json({ ok: true, usuario, user: usuario });
  } catch {
    res.status(401).json({ ok: false, error: 'Sesion invalida' });
  }
});

app.get('/api/mercadopago/status', requireAuth, async (req, res) => {
  res.json({
    ok: true,
    connected: !!req.user.mp_access_token,
    mp_user_id: req.user.mp_user_id || null,
    connected_at: req.user.mp_connected_at || null,
    marketplace_fee_percent: MP_MARKETPLACE_FEE_PERCENT,
    checkout_fee_percent: MP_CHECKOUT_FEE_PERCENT,
  });
});

app.get('/api/mercadopago/oauth/start', requireAuth, async (req, res) => {
  const mpConfig = mpConfigStatus();
  if (!mpConfig.oauth_configured) {
    return res.status(500).json({
      ok: false,
      code: 'mp_oauth_not_configured',
      error: 'Mercado Pago OAuth no esta configurado en Render',
      missing: mpConfig.missing,
      redirect_uri: mpConfig.redirect_uri,
    });
  }

  const stateId = uuid();
  const pkce = MP_OAUTH_PKCE ? createPkcePair() : null;
  if (pkce) {
    await db.query(`
      INSERT INTO mp_oauth_states (id, user_id, code_verifier, expires_at)
      VALUES ($1, $2, $3, NOW() + INTERVAL '15 minutes')
      ON CONFLICT (id) DO UPDATE
      SET user_id = EXCLUDED.user_id,
          code_verifier = EXCLUDED.code_verifier,
          expires_at = EXCLUDED.expires_at,
          created_at = NOW()
    `, [stateId, req.user.id, pkce.verifier]);
  }

  const state = jwt.sign(
    { type: 'mp_oauth', user_id: req.user.id, state_id: stateId, pkce: !!pkce },
    jwtSecret,
    { expiresIn: '15m' }
  );
  const params = new URLSearchParams({
    client_id: MP_CLIENT_ID,
    response_type: 'code',
    redirect_uri: MP_REDIRECT_URI,
    state,
  });
  if (!pkce) {
    params.set('platform_id', 'mp');
  }
  if (pkce) {
    params.set('code_challenge', pkce.challenge);
    params.set('code_challenge_method', pkce.method);
  }
  res.json({ ok: true, url: `https://auth.mercadopago.com/authorization?${params.toString()}` });
});

app.get('/api/mercadopago/oauth/callback', async (req, res) => {
  const code = String(req.query?.code || '').trim();
  const state = String(req.query?.state || '').trim();
  if (!code || !state) return res.redirect(`${FRONTEND_URL}/?mp_error=missing_oauth_data`);

  try {
    const payload = jwt.verify(state, jwtSecret);
    if (payload.type !== 'mp_oauth' || !payload.user_id) throw new Error('Estado OAuth invalido');

    let codeVerifier = null;
    if (payload.pkce) {
      const { rows } = await db.query(`
        DELETE FROM mp_oauth_states
        WHERE id = $1
          AND user_id = $2
          AND expires_at > NOW()
        RETURNING code_verifier
      `, [payload.state_id, payload.user_id]);
      codeVerifier = rows[0]?.code_verifier || null;
      if (!codeVerifier) throw new Error('Estado PKCE expirado o invalido');
    }

    const tokenBody = withOptionalClientSecret({
      client_id: MP_CLIENT_ID,
      grant_type: 'authorization_code',
      code,
      redirect_uri: MP_REDIRECT_URI,
      test_token: 'false',
      ...(codeVerifier ? { code_verifier: codeVerifier } : {}),
    });
    const data = await mpOAuthToken(tokenBody);

    await db.query(`
      UPDATE usuarios
      SET mp_access_token = $2,
          mp_refresh_token = $3,
          mp_public_key = $4,
          mp_user_id = $5,
          mp_scope = $6,
          mp_token_expires_at = $7,
          mp_connected_at = NOW()
      WHERE id = $1
    `, [
      payload.user_id,
      data.access_token,
      data.refresh_token || null,
      data.public_key || null,
      data.user_id ? String(data.user_id) : null,
      data.scope || null,
      mpTokenExpiry(data.expires_in),
    ]);

    lastMercadoPagoOAuthError = null;
    lastMercadoPagoOAuthSuccess = {
      at: new Date().toISOString(),
      user_id: String(payload.user_id),
      mp_user_id: data.user_id ? String(data.user_id) : null,
      scope: data.scope || null,
      has_refresh_token: !!data.refresh_token,
      expires_in: data.expires_in || null,
    };
    res.redirect(`${FRONTEND_URL}/?mp_connected=1`);
  } catch (err) {
    console.error('[MP OAUTH CALLBACK]', err.message);
    lastMercadoPagoOAuthError = {
      at: new Date().toISOString(),
      message: String(err?.message || '').slice(0, 240),
      has_code: !!code,
      has_state: !!state,
    };
    res.redirect(`${FRONTEND_URL}/?mp_error=oauth_failed`);
  }
});

app.post('/api/mercadopago/desconectar', requireAuth, async (req, res) => {
  await db.query(`
    UPDATE usuarios
    SET mp_access_token = NULL,
        mp_refresh_token = NULL,
        mp_public_key = NULL,
        mp_user_id = NULL,
        mp_scope = NULL,
        mp_token_expires_at = NULL,
        mp_connected_at = NULL
    WHERE id = $1
  `, [req.user.id]);
  res.json({ ok: true });
});

function parseMoney(value) {
  const clean = String(value || '').replace(/[^\d.,-]/g, '').replace(/\./g, '').replace(',', '.');
  const parsed = Number(clean);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function parseCapacity(value) {
  const parsed = parseInt(String(value || '').replace(/\D/g, ''), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 100;
}

function htmlEvent(row) {
  const tipos = row.tipos_entrada || [];
  const firstTipo = Array.isArray(tipos) ? tipos[0] : null;
  const total = firstTipo ? Number(firstTipo.precio_total || firstTipo.precio_base || 0) : 0;
  return {
    id: row.id,
    status: row.activo ? 'published' : 'draft',
    name: row.nombre,
    desc: row.descripcion || '',
    category: row.categoria || 'Evento',
    date: row.fecha ? new Date(row.fecha).toISOString().slice(0, 10) : '',
    time: row.hora ? String(row.hora).slice(0, 5) : '',
    place: row.lugar || row.ciudad || '',
    type: total > 0 ? 'pago' : 'gratis',
    capacity: row.capacidad_total || '',
    price: total > 0 ? '$' + Math.round(total).toLocaleString('es-AR') : 'Gratis',
    flyer: row.imagen_url || '',
    tipos_entrada: tipos,
  };
}

async function getEventWithTickets(eventId) {
  const { rows } = await db.query(`
    SELECT e.*,
      COALESCE(json_agg(json_build_object(
        'id', t.id, 'nombre', t.nombre,
        'precio_base', t.precio_base, 'fee_organizador', t.fee_organizador,
        'precio_total', t.precio_base + t.fee_organizador, 'capacidad', t.capacidad, 'disponibles', t.disponibles, 'hora_limite', t.hora_limite, 'promo_paga', t.promo_paga, 'promo_recibe', t.promo_recibe, 'descripcion_extra', t.descripcion_extra
      ) ORDER BY t.precio_base) FILTER (WHERE t.id IS NOT NULL), '[]') AS tipos_entrada
    FROM eventos e
    LEFT JOIN tipos_entrada t ON t.evento_id = e.id
    WHERE e.id = $1
    GROUP BY e.id
  `, [eventId]);
  return rows[0];
}

async function getMercadoPagoSellerForEvent(eventId) {
  const { rows } = await db.query(`
    SELECT u.id, u.nombre, u.email, u.mp_access_token, u.mp_refresh_token,
           u.mp_token_expires_at, u.mp_user_id
    FROM eventos e
    JOIN usuarios u ON u.id = e.organizador_id
    WHERE e.id = $1
  `, [eventId]);
  if (!rows.length) return null;
  return refreshSellerMpToken(rows[0]);
}

async function getMercadoPagoSellerForOrder(orderId) {
  const { rows } = await db.query(`
    SELECT u.id, u.nombre, u.email, u.mp_access_token, u.mp_refresh_token,
           u.mp_token_expires_at, u.mp_user_id
    FROM ordenes o
    JOIN eventos e ON e.id = o.evento_id
    JOIN usuarios u ON u.id = e.organizador_id
    WHERE o.id = $1
  `, [orderId]);
  if (!rows.length) return null;
  return refreshSellerMpToken(rows[0]);
}

/* Normaliza una entrada del array de tipos_entrada que envia el frontend */
function normalizarTipoEntrada(t, esGratis){
  const nombre = String(t?.nombre || t?.name || 'General').trim() || 'General';
  const precio = esGratis ? 0 : parseMoney(t?.precio_base ?? t?.precio ?? t?.price ?? 0);
  const cap = Math.max(1, parseInt(t?.capacidad ?? t?.capacity ?? 100, 10) || 100);
  let horaLimite = String(t?.hora_limite || '').trim();
  if(horaLimite && !/^\d{2}:\d{2}/.test(horaLimite)) horaLimite = '';
  const promoPaga = Math.max(0, parseInt(t?.promo_paga || 0, 10) || 0);
  const promoRecibe = Math.max(0, parseInt(t?.promo_recibe || 0, 10) || 0);
  /* la promo solo aplica si recibe > paga > 0 */
  const promoValida = promoPaga > 0 && promoRecibe > promoPaga;
  const desc = String(t?.descripcion || t?.descripcion_extra || '').trim();
  return {
    nombre, precio, capacidad: cap,
    hora_limite: horaLimite || null,
    promo_paga: promoValida ? promoPaga : 0,
    promo_recibe: promoValida ? promoRecibe : 0,
    descripcion_extra: desc,
  };
}

async function createOrSaveEvent(req, res, activo) {
  const body = req.body || {};
  const nombre = String(body.name || body.nombre || '').trim();
  const fecha = String(body.date || body.fecha || '').trim();
  const hora = String(body.time || body.hora || '20:00').trim() || '20:00';
  const tipoEvento = String(body.type || body.tipo || 'pago').trim();
  const esGratis = tipoEvento === 'gratis' || tipoEvento === 'reserva';
  /* Compatibilidad: si llega tipos_entrada como array, usarlo; sino, armar uno solo desde precio_base + capacity */
  let tipos = Array.isArray(body.tipos_entrada) ? body.tipos_entrada.map(t => normalizarTipoEntrada(t, esGratis)) : [];
  if (!tipos.length) {
    tipos = [normalizarTipoEntrada({
      nombre: 'General',
      precio_base: body.precio_base || body.price || 0,
      capacidad: body.capacity || body.capacidad || 100,
    }, esGratis)];
  }
  tipos = tipos.slice(0, 5); /* limite practico de 5 tipos por evento */
  const capacidad = tipos.reduce((sum, t) => sum + t.capacidad, 0) || parseCapacity(body.capacity || body.capacidad);
  const precioBase = tipos[0]?.precio || 0;
  /* El organizador ya no agrega un fee. La comision (10%) se le cobra al comprador como servicio. */
  const fee = 0;

  if (!nombre) return res.status(400).json({ ok: false, error: 'El evento necesita nombre' });
  if (!fecha) return res.status(400).json({ ok: false, error: 'El evento necesita fecha' });
  if (Number.isNaN(Date.parse(fecha))) return res.status(400).json({ ok: false, error: 'Fecha invalida' });
  if (activo && new Date(`${fecha}T23:59:59`) < new Date()) {
    return res.status(400).json({ ok: false, error: 'La fecha del evento no puede estar vencida' });
  }
  if (!esGratis && tipos.every(t => t.precio <= 0)) {
    return res.status(400).json({ ok: false, error: 'Los eventos pagos necesitan al menos un tipo de entrada con precio mayor a cero' });
  }
  if (activo && !esGratis && !req.user.mp_access_token) {
    return res.status(409).json({
      ok: false,
      code: 'seller_mp_not_connected',
      error: 'Conecta Mercado Pago antes de publicar eventos pagos',
    });
  }

  try {
    const client = await db.connect();
    try {
      await client.query('BEGIN');
      const { rows } = await client.query(`
        INSERT INTO eventos (
          organizador_id, nombre, descripcion, categoria, fecha, hora, lugar, ciudad,
          capacidad_total, capacidad_disponible, imagen_url, activo
        )
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$9,$10,$11)
        RETURNING id
      `, [
        req.user.id,
        nombre,
        body.desc || body.descripcion || '',
        body.category || body.categoria || 'Evento',
        fecha,
        hora,
        body.place || body.lugar || '',
        body.city || body.ciudad || 'Jujuy',
        capacidad,
        body.flyer || body.imagen_url || '',
        activo,
      ]);

      /* Crear todos los tipos de entrada */
      for (const t of tipos) {
        await client.query(`
          INSERT INTO tipos_entrada (
            evento_id, nombre, descripcion, precio_base, fee_organizador,
            capacidad, disponibles, hora_limite, promo_paga, promo_recibe, descripcion_extra
          )
          VALUES ($1,$2,'',$3,0,$4,$4,$5,$6,$7,$8)
        `, [rows[0].id, t.nombre, t.precio, t.capacidad, t.hora_limite, t.promo_paga, t.promo_recibe, t.descripcion_extra]);
      }

      await client.query('COMMIT');
      const event = await getEventWithTickets(rows[0].id);
      res.status(201).json({ ok: true, data: htmlEvent(event), evento: htmlEvent(event) });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    console.error('[PRODUCTOS EVENTO]', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
}

app.post('/api/productos/eventos', requireAuth, (req, res) => createOrSaveEvent(req, res, true));
app.post('/api/productos/eventos/borrador', requireAuth, (req, res) => createOrSaveEvent(req, res, false));

app.delete('/api/productos/eventos/:id', requireAuth, async (req, res) => {
  const eventId = String(req.params.id || '').trim();
  if (!eventId) return res.status(400).json({ ok: false, error: 'Falta el evento a eliminar' });

  const client = await db.connect();
  try {
    await client.query('BEGIN');

    const { rows: eventos } = await client.query(
      'SELECT id, nombre FROM eventos WHERE id = $1 AND organizador_id = $2 FOR UPDATE',
      [eventId, req.user.id]
    );
    if (!eventos.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ ok: false, error: 'No encontramos ese evento en tu cuenta' });
    }

    const { rows: bloqueos } = await client.query(`
      SELECT COUNT(*)::int AS total
      FROM ordenes
      WHERE evento_id = $1
        AND estado IN ('pagada', 'cortesia')
    `, [eventId]);

    if (Number(bloqueos[0]?.total || 0) > 0) {
      await client.query('ROLLBACK');
      return res.status(409).json({
        ok: false,
        error: 'Este evento ya tiene entradas emitidas. Por seguridad no se puede eliminar.'
      });
    }

    const { rows: ordenes } = await client.query(
      `SELECT id FROM ordenes WHERE evento_id = $1 AND COALESCE(estado, '') NOT IN ('pagada', 'cortesia')`,
      [eventId]
    );
    const ordenIds = ordenes.map(row => row.id);
    if (ordenIds.length) {
      await client.query('DELETE FROM orden_items WHERE orden_id = ANY($1::uuid[])', [ordenIds]);
      await client.query('DELETE FROM ordenes WHERE id = ANY($1::uuid[])', [ordenIds]);
    }

    await client.query('DELETE FROM tipos_entrada WHERE evento_id = $1', [eventId]);
    await client.query('DELETE FROM eventos WHERE id = $1 AND organizador_id = $2', [eventId, req.user.id]);
    await client.query('COMMIT');

    res.json({ ok: true, data: { id: eventId, deleted: true } });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('[DELETE EVENTO]', err.message);
    res.status(500).json({ ok: false, error: 'No pudimos eliminar el evento' });
  } finally {
    client.release();
  }
});

app.put('/api/productos/eventos/:id', requireAuth, async (req, res) => {
  const eventId = String(req.params.id || '').trim();
  if (!eventId) return res.status(400).json({ ok: false, error: 'Falta el ID del evento' });

  const body = req.body || {};
  const nombre = String(body.name || body.nombre || '').trim();
  const fecha = String(body.date || body.fecha || '').trim();
  const hora = String(body.time || body.hora || '20:00').trim() || '20:00';
  const tipoEvento = String(body.type || body.tipo || 'pago').trim();
  const esGratis = tipoEvento === 'gratis' || tipoEvento === 'reserva';
  let tiposNuevos = Array.isArray(body.tipos_entrada) ? body.tipos_entrada.map(t => normalizarTipoEntrada(t, esGratis)) : [];
  if (!tiposNuevos.length) {
    tiposNuevos = [normalizarTipoEntrada({
      nombre: 'General',
      precio_base: body.precio_base || body.price || 0,
      capacidad: body.capacity || body.capacidad || 100,
    }, esGratis)];
  }
  tiposNuevos = tiposNuevos.slice(0, 5);
  const capacidad = tiposNuevos.reduce((sum, t) => sum + t.capacidad, 0) || parseCapacity(body.capacity || body.capacidad);
  const activo = body.activo === true || body.activo === 'true';

  if (!nombre) return res.status(400).json({ ok: false, error: 'El evento necesita nombre' });
  if (!fecha) return res.status(400).json({ ok: false, error: 'El evento necesita fecha' });
  if (!esGratis && tiposNuevos.every(t => t.precio <= 0)) {
    return res.status(400).json({ ok: false, error: 'Los eventos pagos necesitan al menos un tipo de entrada con precio mayor a cero' });
  }
  if (activo && !esGratis && !req.user.mp_access_token) {
    return res.status(409).json({ ok: false, code: 'seller_mp_not_connected', error: 'Conecta Mercado Pago antes de publicar eventos pagos' });
  }

  const client = await db.connect();
  try {
    await client.query('BEGIN');

    const { rows: owned } = await client.query(
      'SELECT id FROM eventos WHERE id = $1 AND organizador_id = $2 FOR UPDATE',
      [eventId, req.user.id]
    );
    if (!owned.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ ok: false, error: 'Evento no encontrado o no te pertenece' });
    }

    await client.query(`
      UPDATE eventos SET
        nombre = $1, descripcion = $2, categoria = $3, fecha = $4, hora = $5,
        lugar = $6, ciudad = $7, capacidad_total = $8, imagen_url = $9, activo = $10
      WHERE id = $11
    `, [
      nombre,
      body.desc || body.descripcion || '',
      body.category || body.categoria || 'Evento',
      fecha, hora,
      body.place || body.lugar || '',
      body.city || body.ciudad || 'Jujuy',
      capacidad,
      body.flyer || body.imagen_url || '',
      activo,
      eventId,
    ]);

    /* Actualizar tipos de entrada: estrategia simple - obtener existentes,
       actualizar los que coinciden por nombre, crear nuevos, eliminar los que ya no estan */
    const { rows: tiposActuales } = await client.query(
      'SELECT id, nombre, capacidad, disponibles FROM tipos_entrada WHERE evento_id = $1',
      [eventId]
    );
    const actualesPorNombre = new Map(tiposActuales.map(t => [String(t.nombre).toLowerCase().trim(), t]));
    const nombresNuevos = new Set();

    for (const tn of tiposNuevos) {
      const key = tn.nombre.toLowerCase().trim();
      nombresNuevos.add(key);
      const existente = actualesPorNombre.get(key);
      if (existente) {
        const viejaCapacidad = Number(existente.capacidad || 0);
        const delta = tn.capacidad - viejaCapacidad;
        await client.query(`
          UPDATE tipos_entrada SET
            precio_base = $1,
            fee_organizador = 0,
            capacidad = $2,
            disponibles = GREATEST(0, disponibles + $3),
            hora_limite = $4,
            promo_paga = $5,
            promo_recibe = $6,
            descripcion_extra = $7
          WHERE id = $8
        `, [tn.precio, tn.capacidad, delta, tn.hora_limite, tn.promo_paga, tn.promo_recibe, tn.descripcion_extra, existente.id]);
      } else {
        await client.query(`
          INSERT INTO tipos_entrada (
            evento_id, nombre, descripcion, precio_base, fee_organizador,
            capacidad, disponibles, hora_limite, promo_paga, promo_recibe, descripcion_extra
          ) VALUES ($1,$2,'',$3,0,$4,$4,$5,$6,$7,$8)
        `, [eventId, tn.nombre, tn.precio, tn.capacidad, tn.hora_limite, tn.promo_paga, tn.promo_recibe, tn.descripcion_extra]);
      }
    }

    /* Eliminar tipos que ya no existen, SOLO si no tienen ventas asociadas */
    for (const t of tiposActuales) {
      const key = String(t.nombre).toLowerCase().trim();
      if (nombresNuevos.has(key)) continue;
      const { rows: usos } = await client.query(
        'SELECT 1 FROM orden_items WHERE tipo_entrada_id = $1 LIMIT 1',
        [t.id]
      );
      if (!usos.length) {
        await client.query('DELETE FROM tipos_entrada WHERE id = $1', [t.id]);
      }
    }

    await client.query('COMMIT');
    const event = await getEventWithTickets(eventId);
    res.json({ ok: true, data: htmlEvent(event), evento: htmlEvent(event) });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('[EDITAR EVENTO]', err.message);
    res.status(500).json({ ok: false, error: 'No pudimos guardar los cambios. Intentá de nuevo.' });
  } finally {
    client.release();
  }
});

app.post('/api/productos/artistas', requireAuth, async (req, res) => {
  const body = req.body || {};
  const nombre = String(body.name || body.nombre || '').trim();
  if (!nombre) return res.status(400).json({ ok: false, error: 'El perfil necesita nombre' });

  try {
    const { rows } = await db.query(`
      INSERT INTO artistas (usuario_id, nombre, tipo, descripcion, ciudad, precio_desde, whatsapp, instagram, activo)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,true)
      RETURNING *
    `, [req.user.id, nombre, body.type || body.tipo || 'Artista', body.desc || body.descripcion || '', body.city || body.ciudad || '', body.price || body.precio_desde || '', body.contacto || body.telefono || body.whatsapp || '', body.instagram || '']);
    const row = rows[0];
    res.status(201).json({ ok: true, data: { id: row.id, name: row.nombre, type: row.tipo, desc: row.descripcion, city: row.ciudad, price: row.precio_desde, contacto: row.whatsapp, instagram: row.instagram } });
  } catch (err) {
    console.error('[PRODUCTOS ARTISTA]', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.post('/api/productos/servicios', requireAuth, async (req, res) => {
  const body = req.body || {};
  const nombre = String(body.name || body.nombre || '').trim();
  if (!nombre) return res.status(400).json({ ok: false, error: 'El servicio necesita nombre' });

  try {
    const { rows } = await db.query(`
      INSERT INTO servicios (usuario_id, nombre, categoria, descripcion, ciudad, precio_desde, whatsapp, instagram, activo)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,true)
      RETURNING *
    `, [req.user.id, nombre, body.type || body.categoria || 'Servicio', body.desc || body.descripcion || '', body.city || body.ciudad || '', body.price || body.precio_desde || '', body.contacto || body.telefono || body.whatsapp || '', body.instagram || '']);
    const row = rows[0];
    res.status(201).json({ ok: true, data: { id: row.id, name: row.nombre, type: row.categoria, desc: row.descripcion, city: row.ciudad, price: row.precio_desde, contacto: row.whatsapp, instagram: row.instagram } });
  } catch (err) {
    console.error('[PRODUCTOS SERVICIO]', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.get('/api/productos/mios', requireAuth, async (req, res) => {
  try {
    const { rows: eventos } = await db.query(`
      SELECT e.*,
        COALESCE(json_agg(json_build_object(
          'id', t.id, 'nombre', t.nombre,
          'precio_base', t.precio_base, 'fee_organizador', t.fee_organizador,
          'precio_total', t.precio_base + t.fee_organizador, 'capacidad', t.capacidad, 'disponibles', t.disponibles, 'hora_limite', t.hora_limite, 'promo_paga', t.promo_paga, 'promo_recibe', t.promo_recibe, 'descripcion_extra', t.descripcion_extra
        ) ORDER BY t.precio_base) FILTER (WHERE t.id IS NOT NULL), '[]') AS tipos_entrada
      FROM eventos e
      LEFT JOIN tipos_entrada t ON t.evento_id = e.id
      WHERE e.organizador_id = $1
      GROUP BY e.id
      ORDER BY e.created_at DESC
    `, [req.user.id]);
    const { rows: artistas } = await db.query('SELECT * FROM artistas WHERE usuario_id = $1 ORDER BY created_at DESC', [req.user.id]);
    const { rows: servicios } = await db.query('SELECT * FROM servicios WHERE usuario_id = $1 ORDER BY created_at DESC', [req.user.id]);

    res.json({
      ok: true,
      data: {
        events: eventos.map(htmlEvent),
        artists: artistas.map(row => ({ id: row.id, name: row.nombre, type: row.tipo, desc: row.descripcion, city: row.ciudad, price: row.precio_desde, contacto: row.whatsapp, instagram: row.instagram })),
        services: servicios.map(row => ({ id: row.id, name: row.nombre, type: row.categoria, desc: row.descripcion, city: row.ciudad, price: row.precio_desde, contacto: row.whatsapp, instagram: row.instagram })),
        mercadopago: {
          connected: !!req.user.mp_access_token,
          mp_user_id: req.user.mp_user_id || null,
          connected_at: req.user.mp_connected_at || null,
          marketplace_fee_percent: MP_MARKETPLACE_FEE_PERCENT,
          checkout_fee_percent: MP_CHECKOUT_FEE_PERCENT,
        },
      },
    });
  } catch (err) {
    console.error('[PRODUCTOS MIOS]', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.get('/api/organizador/stats', requireAuth, async (req, res) => {
  try {
    const { rows: summaryRows } = await db.query(`
      WITH my_events AS (
        SELECT id FROM eventos WHERE organizador_id = $1
      ),
      capacity AS (
        SELECT te.evento_id,
               COALESCE(SUM(te.capacidad), 0)::int AS capacidad,
               COALESCE(SUM(te.disponibles), 0)::int AS disponibles
        FROM tipos_entrada te
        JOIN my_events e ON e.id = te.evento_id
        GROUP BY te.evento_id
      ),
      ticket_totals AS (
        SELECT e.id AS evento_id,
               COALESCE(SUM(CASE WHEN o.estado = 'pagada' THEN oi.cantidad ELSE 0 END), 0)::int AS vendidas,
               COALESCE(SUM(CASE WHEN o.estado = 'cortesia' THEN oi.cantidad ELSE 0 END), 0)::int AS cortesias,
               COALESCE(SUM(CASE WHEN o.estado = 'pagada' THEN oi.cantidad * oi.precio_unitario ELSE 0 END), 0)::numeric AS ingresos
        FROM my_events e
        LEFT JOIN ordenes o ON o.evento_id = e.id AND o.estado IN ('pagada', 'cortesia')
        LEFT JOIN orden_items oi ON oi.orden_id = o.id
        GROUP BY e.id
      ),
      validations AS (
        SELECT e.id AS evento_id, COUNT(en.id)::int AS validadas
        FROM my_events e
        JOIN tipos_entrada te ON te.evento_id = e.id
        JOIN entradas en ON en.tipo_entrada_id = te.id AND en.estado = 'usada'
        GROUP BY e.id
      )
      SELECT COUNT(e.id)::int AS eventos_total,
             COALESCE(SUM(t.vendidas), 0)::int AS entradas_vendidas,
             COALESCE(SUM(t.cortesias), 0)::int AS entradas_cortesia,
             COALESCE(SUM(t.ingresos), 0)::numeric AS ingresos_brutos,
             COALESCE(SUM(v.validadas), 0)::int AS entradas_validadas,
             COALESCE(SUM(c.capacidad), 0)::int AS capacidad_total,
             COALESCE(SUM(c.disponibles), 0)::int AS disponibles_total
      FROM my_events e
      LEFT JOIN ticket_totals t ON t.evento_id = e.id
      LEFT JOIN validations v ON v.evento_id = e.id
      LEFT JOIN capacity c ON c.evento_id = e.id
    `, [req.user.id]);

    const { rows: chartRows } = await db.query(`
      WITH days AS (
        SELECT generate_series(CURRENT_DATE - INTERVAL '13 days', CURRENT_DATE, INTERVAL '1 day')::date AS day
      ),
      sales AS (
        SELECT o.fecha_pago::date AS day,
               SUM(oi.cantidad)::int AS entradas,
               SUM(oi.cantidad * oi.precio_unitario)::numeric AS ingresos
        FROM ordenes o
        JOIN eventos e ON e.id = o.evento_id
        JOIN orden_items oi ON oi.orden_id = o.id
        WHERE e.organizador_id = $1
          AND o.estado = 'pagada'
          AND o.fecha_pago >= CURRENT_DATE - INTERVAL '13 days'
        GROUP BY o.fecha_pago::date
      )
      SELECT to_char(d.day, 'DD/MM') AS label,
             COALESCE(s.entradas, 0)::int AS entradas,
             COALESCE(s.ingresos, 0)::numeric AS ingresos
      FROM days d
      LEFT JOIN sales s ON s.day = d.day
      ORDER BY d.day
    `, [req.user.id]);

    const { rows: eventRows } = await db.query(`
      WITH ticket_totals AS (
        SELECT e.id AS evento_id,
               COALESCE(SUM(CASE WHEN o.estado = 'pagada' THEN oi.cantidad ELSE 0 END), 0)::int AS vendidas,
               COALESCE(SUM(CASE WHEN o.estado = 'cortesia' THEN oi.cantidad ELSE 0 END), 0)::int AS cortesias,
               COALESCE(SUM(CASE WHEN o.estado = 'pagada' THEN oi.cantidad * oi.precio_unitario ELSE 0 END), 0)::numeric AS ingresos
        FROM eventos e
        LEFT JOIN ordenes o ON o.evento_id = e.id AND o.estado IN ('pagada', 'cortesia')
        LEFT JOIN orden_items oi ON oi.orden_id = o.id
        WHERE e.organizador_id = $1
        GROUP BY e.id
      ),
      capacity AS (
        SELECT evento_id,
               COALESCE(SUM(capacidad), 0)::int AS capacidad,
               COALESCE(SUM(disponibles), 0)::int AS disponibles
        FROM tipos_entrada
        GROUP BY evento_id
      )
      SELECT e.id, e.nombre, e.fecha, e.activo,
             COALESCE(t.vendidas, 0)::int AS vendidas,
             COALESCE(t.cortesias, 0)::int AS cortesias,
             COALESCE(t.ingresos, 0)::numeric AS ingresos,
             COALESCE(c.capacidad, 0)::int AS capacidad,
             COALESCE(c.disponibles, 0)::int AS disponibles
      FROM eventos e
      LEFT JOIN ticket_totals t ON t.evento_id = e.id
      LEFT JOIN capacity c ON c.evento_id = e.id
      WHERE e.organizador_id = $1
      ORDER BY e.fecha DESC, e.created_at DESC
    `, [req.user.id]);

    res.json({
      ok: true,
      data: {
        summary: summaryRows[0] || {},
        chart: chartRows,
        events: eventRows,
        marketplace_fee_percent: MP_MARKETPLACE_FEE_PERCENT,
        checkout_fee_percent: MP_CHECKOUT_FEE_PERCENT,
      },
    });
  } catch (err) {
    console.error('[ORG STATS]', err.message);
    res.status(500).json({ ok: false, error: 'No pudimos cargar las estadisticas del organizador' });
  }
});

app.post('/api/organizador/entradas-regalo', requireAuth, async (req, res) => {
  const eventoId = String(req.body?.evento_id || '').trim();
  const tipoEntradaId = String(req.body?.tipo_entrada_id || '').trim();
  const nombre = String(req.body?.nombre || req.body?.comprador_nombre || '').trim();
  const email = normalizeEmail(req.body?.email || req.body?.comprador_email);
  const dni = String(req.body?.dni || '').replace(/\D/g, '').slice(0, 12);
  const cantidad = Math.min(20, Math.max(1, parseInt(req.body?.cantidad || '1', 10) || 1));
  /* Mensaje personalizado del organizador para el invitado (opcional, máx 280 chars) */
  const mensajeRaw = String(req.body?.mensaje || '').trim().slice(0, 280);

  if (!eventoId) return res.status(400).json({ ok: false, error: 'Selecciona un evento' });
  if (!nombre) return res.status(400).json({ ok: false, error: 'Ingresa el nombre del invitado' });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ ok: false, error: 'Email del invitado invalido' });

  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const { rows: tipos } = await client.query(`
      SELECT te.*, e.nombre AS evento_nombre, e.fecha, e.hora, e.lugar, e.organizador_id
      FROM tipos_entrada te
      JOIN eventos e ON e.id = te.evento_id
      WHERE e.id = $1
        AND e.organizador_id = $2
        AND ($3::text = '' OR te.id::text = $3::text)
      ORDER BY te.precio_base ASC
      LIMIT 1
      FOR UPDATE OF te
    `, [eventoId, req.user.id, tipoEntradaId]);
    if (!tipos.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ ok: false, error: 'Evento o tipo de entrada no encontrado' });
    }
    const tipo = tipos[0];
    if (Number(tipo.disponibles) < cantidad) {
      await client.query('ROLLBACK');
      return res.status(409).json({ ok: false, error: 'No hay stock suficiente para emitir esas cortesias' });
    }

    const ordenId = uuid();
    await client.query(
      `INSERT INTO ordenes (id, evento_id, comprador_email, comprador_nombre, comprador_dni, estado, fecha_pago, created_at)
       VALUES ($1,$2,$3,$4,$5,'cortesia',NOW(),NOW())`,
      [ordenId, eventoId, email, nombre, dni]
    );
    await client.query(
      `INSERT INTO orden_items (orden_id, tipo_entrada_id, cantidad, precio_unitario, fee_unitario)
       VALUES ($1,$2,$3,0,0)`,
      [ordenId, tipo.id, cantidad]
    );

    const entradas = [];
    for (let i = 0; i < cantidad; i++) {
      const entradaId = uuid();
      const token = jwt.sign({ type: 'ticket', entrada_id: entradaId, orden_id: ordenId, evento_id: eventoId }, jwtSecret);
      await client.query(
        `INSERT INTO entradas (id, orden_id, tipo_entrada_id, token_qr, estado, numero)
         VALUES ($1,$2,$3,$4,'valida',$5)`,
        [entradaId, ordenId, tipo.id, token, i + 1]
      );
      entradas.push({
        id: entradaId,
        token,
        tipo: tipo.nombre,
        evento: tipo.evento_nombre,
        fecha: tipo.fecha,
        hora: tipo.hora,
        lugar: tipo.lugar,
        numero: i + 1,
        total_tipo: cantidad,
      });
    }
    await client.query('UPDATE tipos_entrada SET disponibles = GREATEST(disponibles - $2, 0) WHERE id = $1', [tipo.id, cantidad]);
    await client.query('COMMIT');

    const entradasConQr = await Promise.all(entradas.map(async (entrada) => ({
      ...entrada,
      qrDataUrl: await makeTicketQr(entrada.token),
    })));
    const orden = {
      id: ordenId,
      comprador_email: email,
      comprador_nombre: nombre,
      comprador_dni: dni,
      estado: 'cortesia',
      mensaje_invitacion: mensajeRaw || '',
      organizador_nombre: req.user.nombre || '',
    };
    let emailSent = false;
    let emailError = null;
    if (SMTP_USER && SMTP_PASS) {
      try {
        await enviarEmail(orden, entradasConQr);
        emailSent = true;
      } catch (err) {
        emailError = 'La cortesia fue generada, pero no pudimos enviar el email ahora.';
        console.error('[CORTESIA EMAIL]', err.message);
      }
    }

    res.status(201).json({
      ok: true,
      data: {
        orden_id: ordenId,
        email_sent: emailSent,
        email_error: emailError,
        entradas: entradasConQr.map((e) => ({
          id: e.id,
          numero: e.numero,
          tipo: e.tipo,
          evento: e.evento,
          token_qr: e.token,
          qr_data_url: e.qrDataUrl,
        })),
      },
    });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('[ENTRADAS REGALO]', err.message);
    res.status(500).json({ ok: false, error: 'No pudimos generar las entradas de regalo' });
  } finally {
    client.release();
  }
});

app.get('/api/artistas', async (req, res) => {
  try {
    const { rows } = await db.query('SELECT * FROM artistas WHERE activo = true ORDER BY created_at DESC');
    res.json({ ok: true, data: rows.map(row => ({ id: row.id, name: row.nombre, type: row.tipo, desc: row.descripcion, city: row.ciudad, price: row.precio_desde, contacto: row.whatsapp, instagram: row.instagram })) });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.get('/api/servicios', async (req, res) => {
  try {
    const { rows } = await db.query('SELECT * FROM servicios WHERE activo = true ORDER BY created_at DESC');
    res.json({ ok: true, data: rows.map(row => ({ id: row.id, name: row.nombre, type: row.categoria, desc: row.descripcion, city: row.ciudad, price: row.precio_desde, contacto: row.whatsapp, instagram: row.instagram })) });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});
 
// ── Listar eventos
app.get('/api/eventos', async (req, res) => {
  try {
    const { rows } = await db.query(`
      SELECT e.*,
        COALESCE(json_agg(json_build_object(
          'id', t.id, 'nombre', t.nombre,
          'precio_base', t.precio_base, 'fee_organizador', t.fee_organizador,
          'precio_total', t.precio_base + t.fee_organizador, 'capacidad', t.capacidad, 'disponibles', t.disponibles, 'hora_limite', t.hora_limite, 'promo_paga', t.promo_paga, 'promo_recibe', t.promo_recibe, 'descripcion_extra', t.descripcion_extra
        ) ORDER BY t.precio_base) FILTER (WHERE t.id IS NOT NULL), '[]') AS tipos_entrada
      FROM eventos e
      LEFT JOIN tipos_entrada t ON t.evento_id = e.id
      WHERE e.activo = true AND e.fecha >= CURRENT_DATE
      GROUP BY e.id ORDER BY e.fecha ASC
    `);
    res.json({ ok: true, data: rows });
  } catch (err) {
    console.error('[GET /api/eventos]', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});
 
// ── Detalle evento
app.get('/api/eventos/:id', async (req, res) => {
  try {
    const { rows } = await db.query(`
      SELECT e.*,
        COALESCE(json_agg(json_build_object(
          'id', t.id, 'nombre', t.nombre,
          'precio_base', t.precio_base, 'fee_organizador', t.fee_organizador,
          'precio_total', t.precio_base + t.fee_organizador, 'capacidad', t.capacidad, 'disponibles', t.disponibles, 'hora_limite', t.hora_limite, 'promo_paga', t.promo_paga, 'promo_recibe', t.promo_recibe, 'descripcion_extra', t.descripcion_extra
        ) ORDER BY t.precio_base) FILTER (WHERE t.id IS NOT NULL), '[]') AS tipos_entrada
      FROM eventos e
      LEFT JOIN tipos_entrada t ON t.evento_id = e.id
      WHERE e.id = $1 GROUP BY e.id
    `, [req.params.id]);
    if (!rows.length) return res.status(404).json({ ok: false, error: 'No encontrado' });
    res.json({ ok: true, data: rows[0] });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});
 
// ── INICIAR COMPRA — crea preferencia en MP
app.post('/api/compra/iniciar', requireAuth, async (req, res) => {
  const { evento_id, items, comprador } = req.body || {};
 
  if (!evento_id || !items?.length)
    return res.status(400).json({ ok: false, error: 'Datos incompletos' });
  const compradorFinal = {
    nombre: req.user.nombre,
    email: req.user.email,
    dni: comprador?.dni || '',
  };
 
  // Validar formato de email
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(compradorFinal.email))
    return res.status(400).json({ ok: false, error: 'Email inválido' });
 
  try {
    const mpItems = [];
    const itemsData = [];
 
    for (const item of items) {
      if (!item.tipo_entrada_id || item.cantidad < 1) continue;
      const { rows } = await db.query(
        `SELECT t.*
         FROM tipos_entrada t
         JOIN eventos e ON e.id = t.evento_id
         WHERE t.id = $1 AND t.evento_id = $2 AND e.activo = true AND e.fecha >= CURRENT_DATE`,
        [item.tipo_entrada_id, evento_id]
      );
      if (!rows.length) return res.status(400).json({ ok: false, error: 'Tipo de entrada invalido o evento no disponible' });
      const tipo = rows[0];
      if (tipo.disponibles < item.cantidad)
        return res.status(400).json({ ok: false, error: `Sin stock para "${tipo.nombre}"` });
 
      /* precio del organizador por entrada individual */
      const precioPorEntrada = parseFloat(tipo.precio_base) + parseFloat(tipo.fee_organizador);
      /* promo: si tipo.promo_paga > 0 y promo_recibe > promo_paga, cada "unidad" que
         compra el cliente le da promo_recibe QRs al precio de promo_paga entradas */
      const promoPaga = parseInt(tipo.promo_paga || 0, 10) || 0;
      const promoRecibe = parseInt(tipo.promo_recibe || 0, 10) || 0;
      const promoActiva = promoPaga > 0 && promoRecibe > promoPaga;
      /* qrs por unidad comprada */
      const qrsPorUnidad = promoActiva ? promoRecibe : 1;
      /* precio que paga el cliente al organizador, por unidad */
      const precioOrgUnidad = promoActiva ? precioPorEntrada * promoPaga : precioPorEntrada;
      /* stock que consume cada unidad */
      const stockPorUnidad = qrsPorUnidad;
      /* validar stock real disponible */
      if (Number(tipo.disponibles) < item.cantidad * stockPorUnidad) {
        return res.status(409).json({ ok: false, error: `Sin stock suficiente para "${tipo.nombre}"` });
      }
      /* servicio EntradasJujuy (6% del precio del organizador por unidad) - marketplace_fee */
      const servicioFeeUnidad = Math.round(precioOrgUnidad * (MP_MARKETPLACE_FEE_PERCENT / 100) * 100) / 100;
      /* cobertura comision Mercado Pago (6.60%) - se suma al unit_price para que
         MP descuente su tarifa de aca y el organizador reciba integro */
      const mpFeeUnidad = Math.round(precioOrgUnidad * (MP_CHECKOUT_FEE_PERCENT / 100) * 100) / 100;
      const precioConServicio = Math.round((precioOrgUnidad + servicioFeeUnidad + mpFeeUnidad) * 100) / 100;
      mpItems.push({ id: tipo.id, title: tipo.nombre + (promoActiva ? ` (${promoRecibe}x${promoPaga})` : ''), quantity: item.cantidad, unit_price: precioConServicio, currency_id: 'ARS' });
      itemsData.push({ ...item, _tipo: tipo, _precioOrg: precioOrgUnidad, _servicioFee: servicioFeeUnidad, _mpFee: mpFeeUnidad, _precioConServicio: precioConServicio, _qrsPorUnidad: qrsPorUnidad, _stockPorUnidad: stockPorUnidad });
    }

    if (!mpItems.length) return res.status(400).json({ ok: false, error: 'Sin items válidos' });

    const seller = await getMercadoPagoSellerForEvent(evento_id);
    if (!seller || !seller.mp_access_token) {
      return res.status(409).json({
        ok: false,
        code: 'seller_mp_not_connected',
        error: 'El organizador todavia no conecto Mercado Pago. No podemos cobrar este evento.',
      });
    }
    /* grossTotal = total que paga el comprador (incluye servicio) */
    const grossTotal = itemsData.reduce((sum, it) => sum + (it._precioConServicio * it.cantidad), 0);
    /* marketplaceFee = lo que se queda EntradasJujuy (suma de servicios) */
    const marketplaceFee = Math.max(0, Math.round(itemsData.reduce((sum, it) => sum + (it._servicioFee * it.cantidad), 0) * 100) / 100);
 
    // Crear orden en DB
    const ordenId = uuid();
    await db.query(
      'INSERT INTO ordenes (id, evento_id, comprador_email, comprador_nombre, comprador_dni, estado, created_at) VALUES ($1,$2,$3,$4,$5,\'pendiente\',NOW())',
      [ordenId, evento_id, compradorFinal.email, compradorFinal.nombre, compradorFinal.dni || '']
    );
    for (const it of itemsData) {
      /* precio_unitario = lo que recibe el organizador por entrada
         fee_unitario   = servicio EntradasJujuy (10%, lo paga el comprador) */
      await db.query(
        'INSERT INTO orden_items (orden_id, tipo_entrada_id, cantidad, precio_unitario, fee_unitario) VALUES ($1,$2,$3,$4,$5)',
        [ordenId, it.tipo_entrada_id, it.cantidad, it._precioOrg, it._servicioFee]
      );
    }
 
    // Crear preferencia en MP
    const isLocalFrontend = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?/i.test(FRONTEND_URL);
    const preferenceBody = {
      items: mpItems,
      payer: { name: compradorFinal.nombre, email: compradorFinal.email },
      back_urls: {
        success: `${FRONTEND_URL}/compra/exito?orden=${encodeURIComponent(ordenId)}`,
        failure: `${FRONTEND_URL}/compra/error?orden=${encodeURIComponent(ordenId)}`,
        pending: `${FRONTEND_URL}/compra/pendiente?orden=${encodeURIComponent(ordenId)}`,
      },
      external_reference: ordenId,
      statement_descriptor: 'ENTRADASJUJUY',
    };
    if (marketplaceFee > 0) preferenceBody.marketplace_fee = marketplaceFee;

    if (!isLocalFrontend) {
      preferenceBody.auto_return = 'approved';
    }
    if (!/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?/i.test(BACKEND_URL)) {
      preferenceBody.notification_url = `${BACKEND_URL}/api/webhook/mp?orden_id=${encodeURIComponent(ordenId)}`;
    }

    const mpResp = await mpRequest('/checkout/preferences', {
      method: 'POST',
      body: preferenceBody,
      accessToken: seller.mp_access_token,
    });
 
    console.log('[MP] Preferencia creada:', mpResp.id);
 
    res.json({
      ok: true,
      orden_id: ordenId,
      mp_init_point: mpResp.init_point,
      mp_sandbox_init_point: mpResp.sandbox_init_point,
      mp_preference_id: mpResp.id,
    });
 
  } catch (err) {
    console.error('[COMPRA] ERROR:', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});
 
// ── VERIFICAR PAGO (para cuando MP redirige de vuelta)
app.post('/api/compra/verificar', async (req, res) => {
  const { orden_id, payment_id } = req.body || {};
  if (!orden_id) return res.status(400).json({ ok: false, error: 'Falta orden_id' });
 
  try {
    const { rows } = await db.query('SELECT * FROM ordenes WHERE id = $1', [orden_id]);
    if (!rows.length) return res.status(404).json({ ok: false, error: 'Orden no encontrada' });
 
    if (rows[0].estado === 'pagada') return res.json({ ok: true, estado: 'pagada' });
 
    // Verificar con MP si llegó el payment_id
    if (payment_id) {
      const seller = await getMercadoPagoSellerForOrder(orden_id);
      const pago = await mpRequest(`/v1/payments/${encodeURIComponent(String(payment_id))}`, {
        accessToken: seller?.mp_access_token,
      });
      console.log('[VERIFICAR] Estado MP:', pago.status, 'ref:', pago.external_reference);
 
      if (pago.status === 'approved' && pago.external_reference === orden_id) {
        await procesarPago(orden_id, pago);
        return res.json({ ok: true, estado: 'pagada' });
      }
      return res.json({ ok: true, estado: pago.status });
    }
 
    res.json({ ok: true, estado: rows[0].estado });
  } catch (err) {
    console.error('[VERIFICAR] ERROR:', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});
 
// ── WEBHOOK MP
app.post('/api/webhook/mp', async (req, res) => {
  res.sendStatus(200);
  try {
    let body = req.body;
    if (Buffer.isBuffer(body)) body = JSON.parse(body.toString());
    const type = body?.type || req.query?.type || req.query?.topic;
    const paymentId = body?.data?.id || req.query?.['data.id'] || req.query?.id;
    const orderId = req.query?.orden_id;
    console.log('[WEBHOOK]', type, paymentId);
    if (type !== 'payment' || !paymentId) return;

    const seller = orderId ? await getMercadoPagoSellerForOrder(orderId) : null;
    const pago = await mpRequest(`/v1/payments/${encodeURIComponent(String(paymentId))}`, {
      accessToken: seller?.mp_access_token,
    });
    console.log('[WEBHOOK] pago:', pago.status, pago.external_reference);
 
    if (pago.status === 'approved' && pago.external_reference) {
      await procesarPago(pago.external_reference, pago);
    }
  } catch (err) {
    console.error('[WEBHOOK] ERROR:', err.message);
  }
});
 
function makeTicketQr(token, width = 240) {
  return QRCode.toDataURL(token, {
    width,
    margin: 1,
    errorCorrectionLevel: 'M',
    color: {
      dark: '#0A0704',
      light: '#FFFFFF',
    },
  });
}

// ── FUNCIÓN CENTRAL: procesar pago aprobado y generar QRs
async function procesarPago(ordenId, pago) {
  const { rows } = await db.query("SELECT * FROM ordenes WHERE id = $1 AND estado = 'pendiente'", [ordenId]);
  if (!rows.length) return;
  const orden = rows[0];
 
  await db.query(
    "UPDATE ordenes SET estado = 'pagada', mp_payment_id = $2, fecha_pago = NOW() WHERE id = $1",
    [ordenId, pago.id]
  );
 
  const { rows: items } = await db.query(`
    SELECT oi.*, te.nombre AS tipo_nombre, te.hora_limite, te.promo_paga, te.promo_recibe,
           ev.id AS evento_id, ev.nombre AS evento_nombre, ev.fecha, ev.hora, ev.lugar
    FROM orden_items oi
    JOIN tipos_entrada te ON te.id = oi.tipo_entrada_id
    JOIN eventos ev ON ev.id = te.evento_id
    WHERE oi.orden_id = $1
  `, [ordenId]);

  const entradas = [];
  for (const item of items) {
    /* Si el tipo tiene promo (paga N recibe M), por cada unidad comprada generamos M QRs */
    const promoPaga = parseInt(item.promo_paga || 0, 10) || 0;
    const promoRecibe = parseInt(item.promo_recibe || 0, 10) || 0;
    const promoActiva = promoPaga > 0 && promoRecibe > promoPaga;
    const qrsPorUnidad = promoActiva ? promoRecibe : 1;
    const totalQrs = item.cantidad * qrsPorUnidad;

    for (let i = 0; i < totalQrs; i++) {
      const entradaId = uuid();
      const token = jwt.sign({ type: 'ticket', entrada_id: entradaId, orden_id: ordenId, evento_id: item.evento_id }, jwtSecret);

      await db.query(
        'INSERT INTO entradas (id, orden_id, tipo_entrada_id, token_qr, estado, numero) VALUES ($1,$2,$3,$4,\'valida\',$5) ON CONFLICT DO NOTHING',
        [entradaId, ordenId, item.tipo_entrada_id, token, i + 1]
      );
      const { rows: stockRows } = await db.query(
        'UPDATE tipos_entrada SET disponibles = GREATEST(disponibles-1,0) WHERE id=$1 RETURNING disponibles',
        [item.tipo_entrada_id]
      );
      if (stockRows[0]?.disponibles === 0) {
        console.warn(`[STOCK] Tipo entrada ${item.tipo_entrada_id} llegó a 0 (orden ${ordenId})`);
      }

      const qrDataUrl = await makeTicketQr(token);
      entradas.push({
        id: entradaId, token, qrDataUrl,
        tipo: item.tipo_nombre + (promoActiva ? ` (Pack ${promoRecibe}x${promoPaga})` : ''),
        evento: item.evento_nombre, fecha: item.fecha, hora: item.hora, lugar: item.lugar,
        hora_limite: item.hora_limite,
        fecha_compra: orden.created_at || orden.fecha_pago,
        numero: i+1, total_tipo: totalQrs,
      });
    }
  }
 
  if (SMTP_USER && SMTP_PASS && entradas.length) {
    enviarEmail(orden, entradas).catch(e => console.error('[EMAIL]', e.message));
  }
 
  console.log('[PAGO OK] Orden:', ordenId, '| Entradas:', entradas.length);
  return entradas;
}
 
// ── ESTADO DE ORDEN
app.get('/api/orden/:id', async (req, res) => {
  try {
    const { rows } = await db.query('SELECT * FROM ordenes WHERE id = $1', [req.params.id]);
    if (!rows.length) return res.status(404).json({ ok: false, error: 'No encontrada' });
    const orden = rows[0];
    if (orden.estado === 'pagada' || orden.estado === 'cortesia') {
      const { rows: entradas } = await db.query(`
        SELECT en.id, en.estado, en.numero, en.token_qr,
               te.nombre AS tipo, te.hora_limite, te.promo_paga, te.promo_recibe, te.descripcion_extra,
               ev.nombre AS evento, ev.fecha, ev.hora, ev.lugar
        FROM entradas en
        JOIN tipos_entrada te ON te.id = en.tipo_entrada_id
        JOIN eventos ev ON ev.id = te.evento_id
        WHERE en.orden_id = $1 ORDER BY en.numero
      `, [req.params.id]);
      const entradasConQr = await Promise.all(entradas.map(async (entrada) => ({
        ...entrada,
        qr_data_url: await makeTicketQr(entrada.token_qr),
      })));
      return res.json({ ok: true, data: { ...orden, entradas: entradasConQr } });
    }
    res.json({ ok: true, data: orden });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.post('/api/orden/:id/reenviar', requireAuth, async (req, res) => {
  try {
    const { rows } = await db.query('SELECT * FROM ordenes WHERE id = $1', [req.params.id]);
    if (!rows.length) return res.status(404).json({ ok: false, error: 'Orden no encontrada' });
    const orden = rows[0];
    if (orden.estado !== 'pagada' && orden.estado !== 'cortesia') return res.status(409).json({ ok: false, error: 'La orden todavia no esta pagada' });
    if (req.user.rol !== 'admin' && normalizeEmail(orden.comprador_email) !== normalizeEmail(req.user.email)) {
      return res.status(403).json({ ok: false, error: 'No tenes permiso para reenviar estas entradas' });
    }

    const { rows: entradasDb } = await db.query(`
      SELECT en.id, en.numero, en.token_qr,
             te.nombre AS tipo, te.hora_limite, te.promo_paga, te.promo_recibe,
             ev.nombre AS evento, ev.fecha, ev.hora, ev.lugar,
             COUNT(*) OVER (PARTITION BY en.tipo_entrada_id) AS total_tipo
      FROM entradas en
      JOIN tipos_entrada te ON te.id = en.tipo_entrada_id
      JOIN eventos ev ON ev.id = te.evento_id
      WHERE en.orden_id = $1 ORDER BY en.numero
    `, [req.params.id]);
    if (!entradasDb.length) return res.status(404).json({ ok: false, error: 'La orden no tiene entradas generadas' });

    const entradas = await Promise.all(entradasDb.map(async (e) => ({
      ...e,
      token: e.token_qr,
      qrDataUrl: await makeTicketQr(e.token_qr),
    })));
    await enviarEmail(orden, entradas);
    res.json({ ok: true, message: 'Entradas reenviadas por email' });
  } catch (err) {
    console.error('[REENVIAR TICKETS]', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.get('/api/mis-entradas', requireAuth, async (req, res) => {
  try {
    const { rows } = await db.query(`
      SELECT o.id AS orden_id, o.comprador_email, o.comprador_nombre, o.estado AS orden_estado,
             o.fecha_pago, o.created_at,
             en.id AS entrada_id, en.numero, en.estado AS entrada_estado, en.token_qr,
             te.nombre AS tipo, te.hora_limite, te.promo_paga, te.promo_recibe, te.descripcion_extra,
             ev.nombre AS evento, ev.fecha, ev.hora, ev.lugar
      FROM ordenes o
      JOIN entradas en ON en.orden_id = o.id
      JOIN tipos_entrada te ON te.id = en.tipo_entrada_id
      JOIN eventos ev ON ev.id = te.evento_id
      WHERE lower(o.comprador_email) = lower($1)
        AND o.estado IN ('pagada', 'cortesia')
      ORDER BY o.fecha_pago DESC NULLS LAST, o.created_at DESC, en.numero ASC
    `, [req.user.email]);

    const orders = [];
    const byId = new Map();
    for (const row of rows) {
      if (!byId.has(row.orden_id)) {
        const order = {
          id: row.orden_id,
          comprador_email: row.comprador_email,
          comprador_nombre: row.comprador_nombre,
          estado: row.orden_estado,
          fecha_pago: row.fecha_pago,
          created_at: row.created_at,
          entradas: [],
        };
        byId.set(row.orden_id, order);
        orders.push(order);
      }
      byId.get(row.orden_id).entradas.push({
        id: row.entrada_id,
        numero: row.numero,
        estado: row.entrada_estado,
        token_qr: row.token_qr,
        tipo: row.tipo,
        hora_limite: row.hora_limite,
        promo_paga: row.promo_paga,
        promo_recibe: row.promo_recibe,
        descripcion_extra: row.descripcion_extra,
        evento: row.evento,
        fecha: row.fecha,
        hora: row.hora,
        lugar: row.lugar,
        qr_data_url: await makeTicketQr(row.token_qr),
      });
    }

    res.json({ ok: true, data: orders });
  } catch (err) {
    console.error('[MIS ENTRADAS]', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});
 
// ── VALIDAR QR (app escáner)
app.post('/api/validar-qr', requireAuth, async (req, res) => {
  const { token } = req.body || {};
  if (!token) return res.status(400).json({ ok: false, error: 'Token requerido' });
  try {
    let payload;
    try { payload = jwt.verify(token, jwtSecret); }
    catch { return res.json({ ok: false, valida: false, motivo: 'QR inválido o falsificado' }); }
    if (payload.type && payload.type !== 'ticket') {
      return res.json({ ok: false, valida: false, motivo: 'QR inválido o falsificado' });
    }
    if (!payload.entrada_id) {
      return res.json({ ok: false, valida: false, motivo: 'QR incompleto o inválido' });
    }
 
    const { rows } = await db.query(`
      SELECT en.id, en.orden_id, en.estado, en.numero, en.fecha_uso,
             te.nombre AS tipo, te.hora_limite, ev.id AS evento_id, ev.nombre AS evento, ev.fecha, ev.hora, ev.lugar, ev.organizador_id,
             o.comprador_nombre, o.comprador_dni
      FROM entradas en
      JOIN tipos_entrada te ON te.id = en.tipo_entrada_id
      JOIN eventos ev ON ev.id = te.evento_id
      JOIN ordenes o ON o.id = en.orden_id
      WHERE en.id = $1
    `, [payload.entrada_id]);

    if (!rows.length) return res.json({ ok: false, valida: false, motivo: 'Entrada no encontrada' });
    const entrada = rows[0];
    if (payload.orden_id && String(payload.orden_id) !== String(entrada.orden_id)) {
      return res.json({ ok: false, valida: false, motivo: 'QR no coincide con la orden' });
    }
    if (payload.evento_id && String(payload.evento_id) !== String(entrada.evento_id)) {
      return res.json({ ok: false, valida: false, motivo: 'QR no coincide con el evento' });
    }
    if (req.user.rol !== 'admin' && String(entrada.organizador_id) !== String(req.user.id)) {
      return res.status(403).json({ ok: false, valida: false, motivo: 'No tenes permiso para validar entradas de este evento' });
    }

    if (entrada.estado === 'usada') return res.json({ ok: true, valida: false, motivo: 'Entrada ya utilizada', usada_el: entrada.fecha_uso, entrada });
    if (entrada.estado === 'cancelada') return res.json({ ok: true, valida: false, motivo: 'Entrada cancelada', entrada });

    /* Validacion de hora limite (ej: early bird hasta las 23:00) */
    if (entrada.hora_limite) {
      const now = new Date();
      const horaActual = now.toTimeString().slice(0, 5); /* HH:MM */
      const horaLimiteStr = String(entrada.hora_limite).slice(0, 5);
      if (horaActual > horaLimiteStr) {
        return res.json({
          ok: true, valida: false,
          motivo: `Esta entrada solo era valida hasta las ${horaLimiteStr}`,
          entrada,
        });
      }
    }
 
    const used = await db.query(
      "UPDATE entradas SET estado='usada', fecha_uso=NOW() WHERE id=$1 AND estado='valida' RETURNING estado, fecha_uso",
      [entrada.id]
    );
    if (!used.rows.length) {
      const latest = await db.query('SELECT estado, fecha_uso FROM entradas WHERE id=$1', [entrada.id]);
      const estado = latest.rows[0]?.estado || entrada.estado;
      const fechaUso = latest.rows[0]?.fecha_uso || entrada.fecha_uso;
      return res.json({
        ok: true,
        valida: false,
        motivo: estado === 'usada' ? 'Entrada ya utilizada' : 'Entrada no disponible',
        usada_el: fechaUso,
        entrada: { ...entrada, estado, fecha_uso: fechaUso },
      });
    }
    res.json({ ok: true, valida: true, entrada: { ...entrada, estado: 'usada', fecha_uso: used.rows[0].fecha_uso } });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});
 
// ── EMAIL
async function enviarEmail(orden, entradas) {
  const esCortesia = orden.estado === 'cortesia';
  const attachments = entradas.map(e => ({
    filename: `entrada-${e.numero}-${e.id}.png`,
    content: Buffer.from(String(e.qrDataUrl || '').split(',')[1] || '', 'base64'),
    contentType: 'image/png',
    cid: `qr-${e.id}@entradasjujuy`,
  }));
  const qrHtml = entradas.map(e => {
    const horaLim = e.hora_limite ? String(e.hora_limite).slice(0, 5) : '';
    const fechaFmt = e.fecha ? new Date(e.fecha).toLocaleDateString('es-AR',{weekday:'long',day:'numeric',month:'long',year:'numeric'}) : '';
    return `
    <div style="border:1px solid #eeeeee;border-radius:20px;padding:16px;margin-bottom:16px;background:#ffffff;box-shadow:0 8px 22px rgba(10,7,4,.06)">
      <div style="display:inline-block;background:#0a0704;color:#C4692B;border-radius:999px;padding:6px 10px;font-size:11px;font-weight:700;margin-bottom:12px">EntradasJujuy</div>
      <h3 style="color:#0a0704;margin:0 0 5px;font-size:18px;line-height:1.12">${e.evento}</h3>
      <p style="color:#776b5d;font-size:12px;line-height:1.4;margin:0 0 12px">${fechaFmt}${e.hora ? ' · ' + e.hora + ' hs' : ''}${e.lugar ? ' · ' + e.lugar : ''}</p>
      <div style="background:#fafafa;border:1px solid #eeeeee;border-radius:12px;padding:10px 12px;margin-bottom:14px">
        <div style="font-size:10px;letter-spacing:1.2px;text-transform:uppercase;color:#8b7a66;margin-bottom:3px">Tipo de entrada</div>
        <div style="font-size:14px;font-weight:700;color:#0a0704">${e.tipo}</div>
        <div style="font-size:11px;color:#776b5d;margin-top:4px">Entrada ${e.numero} de ${e.total_tipo}</div>
      </div>
      <div style="text-align:center;background:#fff;border:1px solid #f1f1f1;border-radius:18px;padding:8px;width:150px;margin:0 auto">
        <img src="cid:qr-${e.id}@entradasjujuy" style="width:132px;height:132px;display:block;margin:0 auto"/>
      </div>
      <p style="text-align:center;font-size:10px;color:#8b7a66;margin:10px 0 6px">Mostrá este QR en la puerta</p>
      ${horaLim ? `<div style="margin-top:12px;padding:8px 12px;background:#fff5e6;border:1px solid #ffd49a;border-radius:10px;text-align:center;font-size:11px;color:#a05a10;line-height:1.4"><strong>Válido hasta las ${horaLim} hs</strong> — el QR no se podrá escanear después de esa hora</div>` : ''}
    </div>
  `;
  }).join('');
 
  /* Mensaje personalizado del organizador (solo cortesía) — escape simple anti-XSS */
  const mensajeInvitacion = String(orden.mensaje_invitacion || '').trim()
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  const organizadorNombre = String(orden.organizador_nombre || '').trim()
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  const mensajeBox = esCortesia && mensajeInvitacion
    ? `<div style="background:linear-gradient(135deg,#fff5e6,#fff);border:1px solid #ffd49a;border-left:4px solid #C4692B;border-radius:10px;padding:16px;margin:0 0 20px">
         <div style="font-size:10px;letter-spacing:1.5px;text-transform:uppercase;color:#a05a10;margin-bottom:8px;font-weight:700">Mensaje${organizadorNombre ? ' de ' + organizadorNombre : ' del organizador'}</div>
         <div style="font-size:14px;line-height:1.55;color:#3d342a;font-style:italic">"${mensajeInvitacion}"</div>
       </div>`
    : '';

  const saludoCortesia = organizadorNombre
    ? `te enviaron entradas de cortesía${organizadorNombre ? ' desde ' + organizadorNombre : ''}.`
    : 'te enviaron entradas de cortesía.';

  await sendMailResilient({
    from: MAIL_FROM,
    to: orden.comprador_email,
    subject: `${esCortesia ? '🎟 Te invitaron a' : 'Tus entradas'} - ${entradas[0]?.evento}`,
    text: esCortesia
      ? `Hola ${orden.comprador_nombre}. ${saludoCortesia}${mensajeInvitacion ? `\n\nMensaje${organizadorNombre ? ' de '+organizadorNombre : ''}: "${mensajeInvitacion}"\n` : ''}\nAdjuntamos tus QR para ingresar al evento. También podés recuperarlas desde tu cuenta en ${FRONTEND_URL}.`
      : `Hola ${orden.comprador_nombre}. Tu compra fue confirmada. Adjuntamos tus QR para ingresar al evento. También podés recuperar tus entradas desde tu cuenta en ${FRONTEND_URL}.`,
    html: `<div style="max-width:520px;margin:0 auto;font-family:Arial,sans-serif">
      <div style="background:#0a0704;padding:22px;text-align:center;border-radius:10px 10px 0 0">
        <h1 style="color:#C4692B;margin:0;font-size:24px;font-weight:900;letter-spacing:-.5px">Entradas<span style="color:#3A6FA0">Jujuy</span></h1>
        ${esCortesia ? '<div style="color:#9A8670;font-size:11px;letter-spacing:2px;text-transform:uppercase;margin-top:6px">🎟 Invitación de cortesía</div>' : ''}
      </div>
      <div style="padding:24px;background:#fff;border-left:1px solid #eadfd3;border-right:1px solid #eadfd3">
        <p style="margin:0 0 14px;font-size:15px;color:#1f1a14;line-height:1.5">Hola <strong>${orden.comprador_nombre}</strong>, ${esCortesia ? saludoCortesia : 'tu compra fue confirmada.'}</p>
        ${mensajeBox}
        ${qrHtml}
      </div>
    </div>`,
    attachments,
  }, 'buyer_tickets');
  console.log('[EMAIL] Enviado a:', orden.comprador_email);
}
 
/* Migracion automatica de schema al arrancar: agrega columnas nuevas si faltan */
async function autoMigrate(){
  try {
    await db.query(`ALTER TABLE tipos_entrada ADD COLUMN IF NOT EXISTS hora_limite TIME`);
    await db.query(`ALTER TABLE tipos_entrada ADD COLUMN IF NOT EXISTS promo_paga INT DEFAULT 0`);
    await db.query(`ALTER TABLE tipos_entrada ADD COLUMN IF NOT EXISTS promo_recibe INT DEFAULT 0`);
    await db.query(`ALTER TABLE tipos_entrada ADD COLUMN IF NOT EXISTS descripcion_extra TEXT`);
    console.log('[MIGRATE] Schema actualizado');
  } catch(err){
    console.error('[MIGRATE] Error:', err.message);
  }
  /* Limpieza one-time: eliminar eventos de prueba */
  await borrarEventoDePrueba('pueblo encanto');
  await borrarEventoDePrueba('prueba 05');
  await borrarEventoDePrueba('prueba 5');
  await borrarEventoDePrueba('prueba 07');
  await borrarEventoDePrueba('prueba 7');
  await borrarEventoDePrueba('pruba 07');
  await borrarEventoDePrueba('pruba 7');
  await borrarEventoDePrueba('prueba 007');
  await borrarEventoDePrueba('pruba 007');
}

async function borrarEventoDePrueba(patron){
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const { rows: ev } = await client.query(
      `SELECT id, nombre FROM eventos WHERE LOWER(nombre) ILIKE $1`,
      [`%${patron}%`]
    );
    if (!ev.length) { await client.query('ROLLBACK'); return; }
    const evIds = ev.map(r => r.id);
    const { rows: ord } = await client.query(
      'SELECT id FROM ordenes WHERE evento_id = ANY($1::uuid[])',
      [evIds]
    );
    const ordIds = ord.map(r => r.id);
    if (ordIds.length) {
      await client.query('DELETE FROM entradas WHERE orden_id = ANY($1::uuid[])', [ordIds]);
      await client.query('DELETE FROM orden_items WHERE orden_id = ANY($1::uuid[])', [ordIds]);
      await client.query('DELETE FROM ordenes WHERE id = ANY($1::uuid[])', [ordIds]);
    }
    await client.query('DELETE FROM tipos_entrada WHERE evento_id = ANY($1::uuid[])', [evIds]);
    await client.query('DELETE FROM eventos WHERE id = ANY($1::uuid[])', [evIds]);
    await client.query('COMMIT');
    console.log(`[CLEANUP] Borrados ${ev.length} eventos de prueba: ${ev.map(e=>e.nombre).join(', ')}`);
  } catch(err){
    await client.query('ROLLBACK').catch(()=>{});
    console.error('[CLEANUP] Error:', err.message);
  } finally {
    client.release();
  }
}

const PORT = process.env.PORT || 3001;
app.listen(PORT, async () => {
  console.log(`\n✓ EntradasJujuy backend en http://localhost:${PORT}`);
  console.log(`  MP Token: ${MP_ACCESS_TOKEN ? MP_ACCESS_TOKEN.substring(0,15) + '...' : 'NO CONFIGURADO'}`);
  console.log(`  Entorno: ${process.env.NODE_ENV || 'development'}`);
  await autoMigrate();
});
 
module.exports = app;
