export const SUPABASE_URL = 'https://aintwcicbjxvyyjnypiq.supabase.co';
export const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFpbnR3Y2ljYmp4dnl5am55cGlxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODE0NzYwMDMsImV4cCI6MjA5NzA1MjAwM30.ehpcNmzbthjJBzlve3-fVIzFHcbMGil_wuXw1L2H_aA';
export const REST_BASE = `${SUPABASE_URL}/rest/v1`;

// Detecta el prefijo por la ruta (no por hostname): funciona en github.io, forks,
// previews y dominios propios. Vacío cuando el sitio se sirve desde la raíz.
export const BASE = location.pathname.startsWith('/ChecadorGLOBAL/') ? '/ChecadorGLOBAL' : '';

// Marca del producto: cambia el nombre y el logo en toda la app desde aquí.
// (El membrete de los REPORTES es aparte: vive en config_global, lo lee reporte-cabecera.js.)
export const MARCA = 'EQS Checador';
export const MARCA_LOGO = 'assets/imgs/logo_.png';

// Paso de seguridad por plaza: si está activo, antes del PIN se pide (una sola
// vez por dispositivo) el token de la plaza que el admin generó y repartió.
// Queda guardado en localStorage hasta que se reinicie el token.
// ⚠️ Actívalo SOLO después de generar y repartir los tokens, o nadie podrá entrar.
export const TOKEN_PLAZA_REQUERIDO = false;
