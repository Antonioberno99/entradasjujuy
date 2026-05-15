import React, { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  SafeAreaView,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  Vibration,
  View,
} from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';

const API_URL = 'https://entradasjujuy-backend.onrender.com';

const C = {
  bg: '#0A0704',
  panel: '#14100A',
  panel2: '#1C1508',
  border: 'rgba(234,224,208,0.12)',
  text: '#EAE0D0',
  muted: '#9A8670',
  weak: '#5C4E3C',
  copper: '#C4692B',
  blue: '#3A6FA0',
  green: '#3DAA6A',
  red: '#C44040',
  white: '#FFFFFF',
};

export default function App() {
  const [permission, requestPermission] = useCameraPermissions();
  const [token, setToken] = useState('');
  const [user, setUser] = useState(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loginBusy, setLoginBusy] = useState(false);
  const [loginError, setLoginError] = useState('');
  const [scanning, setScanning] = useState(false);
  const [validating, setValidating] = useState(false);
  const [cooldown, setCooldown] = useState(false);
  const [result, setResult] = useState(null);

  const canScan = useMemo(() => user && token && !validating && !cooldown, [user, token, validating, cooldown]);

  async function login() {
    setLoginError('');
    if (!email.trim() || !password) {
      setLoginError('Ingresa email y contrasena.');
      return;
    }
    setLoginBusy(true);
    try {
      const res = await fetch(`${API_URL}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim(), password }),
      });
      const json = await res.json();
      if (!json.ok) throw new Error(json.error || 'No se pudo ingresar.');
      const authUser = json.usuario || json.user;
      if (!['organizador', 'admin'].includes(authUser?.rol)) {
        throw new Error('Solo organizadores y administradores pueden validar entradas.');
      }
      setToken(json.token);
      setUser(authUser);
      setPassword('');
    } catch (err) {
      setLoginError(err.message || 'No se pudo conectar con EntradasJujuy.');
    } finally {
      setLoginBusy(false);
    }
  }

  function logout() {
    setToken('');
    setUser(null);
    setResult(null);
    setScanning(false);
  }

  async function onScan({ data }) {
    if (!canScan || !data) return;
    setCooldown(true);
    setValidating(true);
    setResult(null);
    try {
      const res = await fetch(`${API_URL}/api/validar-qr`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ token: data }),
      });
      const json = await res.json();
      if (json.valida) Vibration.vibrate(180);
      else Vibration.vibrate([0, 180, 90, 180]);
      setResult(json);
      setScanning(false);
    } catch {
      Vibration.vibrate([0, 120, 80, 120, 80, 120]);
      setResult({ ok: false, valida: false, motivo: 'Sin conexion con el servidor.' });
      setScanning(false);
    } finally {
      setValidating(false);
      setTimeout(() => setCooldown(false), 1800);
    }
  }

  if (!permission) {
    return <SafeAreaView style={s.container} />;
  }

  if (!permission.granted) {
    return (
      <SafeAreaView style={s.container}>
        <StatusBar barStyle="light-content" backgroundColor={C.bg} />
        <View style={s.center}>
          <Text style={s.brand}><Text style={s.brandCopper}>Entradas</Text><Text style={s.brandBlue}>Jujuy</Text></Text>
          <Text style={s.title}>Escaner oficial</Text>
          <Text style={s.copy}>La app necesita camara para leer los QR de las entradas en puerta.</Text>
          <TouchableOpacity style={s.primaryButton} onPress={requestPermission}>
            <Text style={s.primaryText}>Permitir camara</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  if (!user) {
    return (
      <SafeAreaView style={s.container}>
        <StatusBar barStyle="light-content" backgroundColor={C.bg} />
        <ScrollView contentContainerStyle={s.loginWrap} keyboardShouldPersistTaps="handled">
          <Text style={s.brand}><Text style={s.brandCopper}>Entradas</Text><Text style={s.brandBlue}>Jujuy</Text></Text>
          <Text style={s.title}>Escaner oficial</Text>
          <Text style={s.copy}>Ingresa con una cuenta organizadora para validar entradas.</Text>
          <View style={s.card}>
            <Text style={s.label}>Email</Text>
            <TextInput
              value={email}
              onChangeText={setEmail}
              autoCapitalize="none"
              keyboardType="email-address"
              autoComplete="email"
              placeholder="organizador@email.com"
              placeholderTextColor={C.weak}
              style={s.input}
            />
            <Text style={s.label}>Contrasena</Text>
            <TextInput
              value={password}
              onChangeText={setPassword}
              secureTextEntry
              autoComplete="password"
              placeholder="Tu contrasena"
              placeholderTextColor={C.weak}
              style={s.input}
            />
            {!!loginError && <Text style={s.error}>{loginError}</Text>}
            <TouchableOpacity style={s.primaryButton} onPress={login} disabled={loginBusy}>
              {loginBusy ? <ActivityIndicator color={C.bg} /> : <Text style={s.primaryText}>Ingresar</Text>}
            </TouchableOpacity>
          </View>
        </ScrollView>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={s.container}>
      <StatusBar barStyle="light-content" backgroundColor={C.bg} />
      <View style={s.header}>
        <View>
          <Text style={s.brandSmall}><Text style={s.brandCopper}>Entradas</Text><Text style={s.brandBlue}>Jujuy</Text></Text>
          <Text style={s.headerSub}>Validador QR</Text>
        </View>
        <TouchableOpacity style={s.secondaryButton} onPress={logout}>
          <Text style={s.secondaryText}>Salir</Text>
        </TouchableOpacity>
      </View>

      {scanning ? (
        <View style={s.cameraWrap}>
          <CameraView
            style={s.camera}
            facing="back"
            barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
            onBarcodeScanned={canScan ? onScan : undefined}
          />
          <View style={s.scanOverlay}>
            <View style={s.scanFrame} />
            <Text style={s.scanHint}>Apunta al QR de la entrada</Text>
          </View>
          {validating && (
            <View style={s.loadingOverlay}>
              <ActivityIndicator color={C.copper} size="large" />
              <Text style={s.copy}>Validando entrada...</Text>
            </View>
          )}
          <TouchableOpacity style={s.cancelButton} onPress={() => setScanning(false)}>
            <Text style={s.secondaryText}>Cancelar</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <ScrollView contentContainerStyle={s.content}>
          <View style={s.card}>
            <Text style={s.kicker}>Sesion activa</Text>
            <Text style={s.titleSmall}>{user.nombre || 'Organizador'}</Text>
            <Text style={s.copy}>{user.email}</Text>
          </View>

          {result && <ResultCard result={result} />}

          <TouchableOpacity style={s.primaryButton} onPress={() => { setResult(null); setScanning(true); }}>
            <Text style={s.primaryText}>Abrir escaner QR</Text>
          </TouchableOpacity>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

function ResultCard({ result }) {
  const entrada = result.entrada || {};
  const valid = !!result.valida;
  return (
    <View style={[s.resultCard, valid ? s.validCard : s.invalidCard]}>
      <View style={[s.resultIcon, valid ? s.validIcon : s.invalidIcon]}>
        <Text style={[s.resultIconText, { color: valid ? C.green : C.red }]}>{valid ? '✓' : '×'}</Text>
      </View>
      <Text style={[s.resultTitle, { color: valid ? C.green : C.red }]}>
        {valid ? 'Entrada valida' : 'Acceso denegado'}
      </Text>
      {!valid && <Text style={s.resultReason}>{result.motivo || 'Entrada no valida'}</Text>}
      {!!entrada.evento && <Info label="Evento" value={entrada.evento} />}
      {!!entrada.tipo && <Info label="Tipo" value={entrada.tipo} />}
      {!!entrada.comprador_nombre && <Info label="Titular" value={entrada.comprador_nombre} />}
      {!!entrada.comprador_dni && <Info label="DNI" value={entrada.comprador_dni} />}
      {!!entrada.lugar && <Info label="Lugar" value={entrada.lugar} />}
    </View>
  );
}

function Info({ label, value }) {
  return (
    <View style={s.infoRow}>
      <Text style={s.infoLabel}>{label}</Text>
      <Text style={s.infoValue}>{String(value || '-')}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.bg },
  center: { flex: 1, padding: 24, alignItems: 'center', justifyContent: 'center' },
  loginWrap: { flexGrow: 1, padding: 22, justifyContent: 'center' },
  content: { padding: 18, gap: 16 },
  header: { minHeight: 72, paddingHorizontal: 18, borderBottomWidth: 1, borderBottomColor: C.border, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  brand: { fontSize: 34, fontWeight: '900', marginBottom: 8 },
  brandSmall: { fontSize: 24, fontWeight: '900' },
  brandCopper: { color: C.copper },
  brandBlue: { color: C.blue },
  headerSub: { color: C.muted, fontSize: 12, marginTop: 2 },
  title: { color: C.text, fontSize: 28, fontWeight: '800', marginBottom: 10 },
  titleSmall: { color: C.text, fontSize: 22, fontWeight: '800', marginBottom: 4 },
  kicker: { color: C.copper, fontSize: 11, letterSpacing: 2, textTransform: 'uppercase', marginBottom: 8 },
  copy: { color: C.muted, fontSize: 14, lineHeight: 20, marginBottom: 18 },
  card: { backgroundColor: C.panel, borderColor: C.border, borderWidth: 1, borderRadius: 16, padding: 16 },
  label: { color: C.muted, fontSize: 12, marginBottom: 7, marginTop: 10 },
  input: { height: 48, borderRadius: 12, borderWidth: 1, borderColor: C.border, backgroundColor: C.panel2, color: C.text, paddingHorizontal: 14, fontSize: 16 },
  error: { color: C.red, backgroundColor: 'rgba(196,64,64,0.10)', borderRadius: 10, padding: 10, marginTop: 12, fontSize: 13 },
  primaryButton: { minHeight: 52, borderRadius: 14, backgroundColor: C.copper, alignItems: 'center', justifyContent: 'center', marginTop: 16, paddingHorizontal: 18 },
  primaryText: { color: C.bg, fontSize: 16, fontWeight: '800' },
  secondaryButton: { minHeight: 42, borderRadius: 12, borderWidth: 1, borderColor: C.border, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 14 },
  secondaryText: { color: C.text, fontSize: 14, fontWeight: '700' },
  cameraWrap: { flex: 1, backgroundColor: '#000' },
  camera: { flex: 1 },
  scanOverlay: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center' },
  scanFrame: { width: 248, height: 248, borderRadius: 24, borderWidth: 3, borderColor: C.copper, backgroundColor: 'transparent' },
  scanHint: { color: C.white, backgroundColor: 'rgba(0,0,0,0.55)', paddingHorizontal: 14, paddingVertical: 9, borderRadius: 999, overflow: 'hidden', marginTop: 18 },
  loadingOverlay: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.72)', alignItems: 'center', justifyContent: 'center' },
  cancelButton: { position: 'absolute', left: 18, right: 18, bottom: 28, minHeight: 50, borderRadius: 14, borderWidth: 1, borderColor: C.border, backgroundColor: 'rgba(10,7,4,0.88)', alignItems: 'center', justifyContent: 'center' },
  resultCard: { borderRadius: 18, borderWidth: 1, padding: 18, gap: 10, alignItems: 'stretch' },
  validCard: { backgroundColor: 'rgba(61,170,106,0.10)', borderColor: 'rgba(61,170,106,0.35)' },
  invalidCard: { backgroundColor: 'rgba(196,64,64,0.10)', borderColor: 'rgba(196,64,64,0.35)' },
  resultIcon: { width: 92, height: 92, borderRadius: 46, alignSelf: 'center', alignItems: 'center', justifyContent: 'center', borderWidth: 3, marginBottom: 6 },
  validIcon: { backgroundColor: 'rgba(61,170,106,0.16)', borderColor: 'rgba(61,170,106,0.55)' },
  invalidIcon: { backgroundColor: 'rgba(196,64,64,0.14)', borderColor: 'rgba(196,64,64,0.55)' },
  resultIconText: { fontSize: 54, lineHeight: 62, fontWeight: '900' },
  resultTitle: { fontSize: 26, fontWeight: '900', marginBottom: 2, textAlign: 'center' },
  resultReason: { color: C.muted, fontSize: 14, lineHeight: 20, textAlign: 'center', marginBottom: 4 },
  infoRow: { borderTopWidth: 1, borderTopColor: C.border, paddingTop: 10 },
  infoLabel: { color: C.muted, fontSize: 11, textTransform: 'uppercase', letterSpacing: 1.2 },
  infoValue: { color: C.text, fontSize: 16, fontWeight: '700', marginTop: 3 },
});
