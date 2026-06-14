# EQS Checador

Control de asistencia (entrada/salida) mobile-first.  
Stack: HTML/CSS/JS Vanilla · Supabase (Postgres + Storage + Edge Functions) · Vercel.

---

## A) Crear proyecto en Supabase

1. Ve a [supabase.com](https://supabase.com) → New Project.
2. Anota tres valores desde **Project Settings → API**:
   - `Project URL` → `SUPABASE_URL`
   - `anon public` key → `SUPABASE_ANON_KEY`
   - `service_role` key → úsala solo en el entorno de funciones, **nunca en el repo**.

---

## B) Desplegar base de datos y funciones

### 1. Instalar Supabase CLI y vincular el proyecto

```bash
npm install -g supabase
supabase login
supabase link --project-ref <TU_PROJECT_REF>
```

`PROJECT_REF` es el identificador corto de la URL de tu proyecto (`https://app.supabase.com/project/<ref>`).

### 2. Aplicar migraciones y seed

```bash
supabase db push
# Aplica supabase/migrations/0001_init.sql

supabase db seed
# Inserta empleados de prueba desde supabase/seed.sql
# (PIN de María López: 1234, Carlos Pérez: 5678)
```

Para agregar más empleados directamente en el SQL Editor de Supabase:
```sql
insert into empleados (nombre, pin_hash, activo)
values ('Nombre Completo', crypt('<PIN>', gen_salt('bf')), true);
```

### 3. Configurar secretos de las Edge Functions

Genera un secreto largo y aleatorio para el token HMAC:

```bash
# Genera un secreto de 64 caracteres
openssl rand -base64 48

# Configura el secreto en Supabase
supabase secrets set TOKEN_SECRET=<el_valor_generado>
```

### 4. Desplegar las Edge Functions

```bash
supabase functions deploy verificar-pin
supabase functions deploy guardar-registro
supabase functions deploy obtener-historial
```

---

## C) Configurar el frontend

Edita `assets/js/config.js` y reemplaza los placeholders:

```js
export const SUPABASE_URL      = 'https://XXXXXXXXXX.supabase.co';
export const SUPABASE_ANON_KEY = 'eyJ...';
```

La `anon key` es pública y puede commitearse sin problema.  
El `service_role` y `TOKEN_SECRET` **nunca deben estar en este archivo ni en el repo**.

---

## D) Desplegar en Vercel

1. Conecta este repositorio en [vercel.com](https://vercel.com) → New Project.
2. Framework preset: **Other** (sitio estático, sin build).
3. Output Directory: `.` (raíz del repo).
4. Deploy. Vercel asigna HTTPS automáticamente.

La cámara y la geolocalización del navegador **requieren HTTPS**; no funcionarán en `http://`.

---

## E) Checklist de pruebas en el teléfono

Abre la URL de Vercel en el navegador del teléfono (Chrome/Safari).

- [ ] **Permisos**: al cargar aparecen "Cámara: Pendiente / Ubicación: Pendiente" → acepta ambos → cambian a "Activa" y avanza al PIN automáticamente.
- [ ] **Permiso denegado**: deniega uno → muestra "Bloqueada" → botón "Reintentar permisos" vuelve a pedir.
- [ ] **Login PIN correcto**: ingresa `1234` → saluda "Hola, María López" → menú.
- [ ] **Login PIN incorrecto**: ingresa `0000` → error "PIN no reconocido" sin salir de la pantalla.
- [ ] **Checada de Entrada**: Menú → Checar → Entrada → firma con el dedo → Continuar → aparece cámara frontal → Tomar foto → preview → Confirmar → overlay verde "¡Entrada registrada!" ~2.5 s → vuelve al menú.
- [ ] **Checada de Salida**: igual pero overlay naranja "¡Salida registrada!".
- [ ] **Historial**: menú → Historial → tabla con fecha/hora, badge entrada/salida, link "Ver mapa" (abre Google Maps) y miniatura → toca miniatura → lightbox ampliado → toca fuera para cerrar.
- [ ] **Verificar en Supabase**: Table Editor → tabla `registros` → debe existir la fila con `latitud`, `longitud`, `ruta_foto` y `ruta_firma`. Storage → buckets `fotos` y `firmas` → deben existir los archivos.

---

## Seguridad relevante

| Qué | Dónde |
|-----|-------|
| `service_role` key | Solo en env vars de Supabase Functions |
| `TOKEN_SECRET` | Solo en env vars de Supabase Functions (`supabase secrets set`) |
| `anon key` | `assets/js/config.js` (pública, OK commitear) |
| RLS | Activo en `empleados` y `registros`, sin policies para anon |
| Buckets | Privados; el historial usa signed URLs de 1 hora |
| CORS | `Access-Control-Allow-Origin: *` en el MVP; restringe a tu dominio Vercel en producción editando `_shared/cors.ts` |
