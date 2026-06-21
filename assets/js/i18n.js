// i18n EQS — bilingüe ES/EN sin framework.
// ponytail: diccionario keyed por el texto ESPAÑOL de origen. No se inventan
// claves: t('Guardar') -> 'Save'. Si falta la traducción, cae a español.
// Upgrade path: si crece mucho, partir EN en archivos por sección y fusionar.

const KEY = 'eqs_lang';

// Traducciones ES -> EN. La clave es el string español exacto que aparece en
// la UI (HTML data-i18n o t() en JS).
export const EN = {
  // —— Genéricos / acciones ——
  'Guardar': 'Save', 'Guardar cambios': 'Save changes', 'Cancelar': 'Cancel',
  'Eliminar': 'Delete', 'Editar': 'Edit', 'Crear': 'Create', 'Cerrar': 'Close',
  'Aceptar': 'OK', 'Confirmar': 'Confirm', 'Volver': 'Back', 'Continuar': 'Continue',
  'Buscar': 'Search', 'Buscar…': 'Search…', 'Cargando…': 'Loading…',
  'Sí': 'Yes', 'No': 'No', 'Activo': 'Active', 'Inactivo': 'Inactive',
  'Activar': 'Activate', 'Desactivar': 'Deactivate', 'Todos': 'All',
  'Cerrar sesión': 'Log out', 'Acceso seguro': 'Secure access',
  'Sesión activa': 'Active session', 'Admin': 'Admin',
  'Acceso administrativo': 'Admin access', 'Idioma / Language': 'Language',
  'Español': 'Spanish', 'English': 'English',
  'Cambiar modo claro u oscuro': 'Toggle light or dark mode',

  // —— Login / menú empleado ——
  'EQS Checador': 'EQS Checador', 'Control de asistencia': 'Attendance control',
  'Ingresa tu PIN': 'Enter your PIN', 'Mostrar PIN': 'Show PIN', 'Ocultar PIN': 'Hide PIN',
  'PIN incorrecto. Intenta de nuevo.': 'Incorrect PIN. Try again.',
  'Ingresa tu PIN de 4 dígitos.': 'Enter your 4-digit PIN.',
  'Verificando…': 'Verifying…', 'Bienvenido': 'Welcome',
  'Buenos días': 'Good morning', 'Buenas tardes': 'Good afternoon', 'Buenas noches': 'Good evening',
  'Checar asistencia': 'Clock in / out', 'Ver historial': 'View history', 'Mi turno': 'My shift',
  'Mi horario': 'My schedule', 'Turnos de tu plaza': 'Your location shifts',

  // —— Checador ——
  'Entrada': 'Check-in', 'Salida': 'Check-out', 'Registrar entrada': 'Register check-in',
  'Registrar salida': 'Register check-out', '¿Qué deseas registrar?': 'What do you want to register?',
  'Firma': 'Signature', 'Firma aquí': 'Sign here', 'Limpiar': 'Clear', 'Limpiar firma': 'Clear signature',
  'Foto': 'Photo', 'Tomar foto': 'Take photo', 'Repetir': 'Retake', 'Confirmar foto': 'Confirm photo',
  'Tu firma': 'Your signature', 'Toma una foto': 'Take a photo',
  'Guardando…': 'Saving…', 'Guardando registro…': 'Saving record…',
  '¡Registro guardado!': 'Record saved!', 'Registro exitoso': 'Successfully registered',
  'Entrada registrada': 'Check-in registered', 'Salida registrada': 'Check-out registered',
  'Debes firmar antes de continuar.': 'You must sign before continuing.',
  'Debes tomar una foto.': 'You must take a photo.',
  'No se pudo guardar el registro.': 'Could not save the record.',

  // —— Permisos ——
  'Permisos necesarios': 'Permissions needed',
  'Necesitamos acceso a tu cámara y ubicación.': 'We need access to your camera and location.',
  'Cámara': 'Camera', 'Ubicación': 'Location', 'Conceder permisos': 'Grant permissions',
  'Permiso bloqueado': 'Permission blocked',
  'Activa la cámara y la ubicación desde los ajustes del navegador.':
    'Enable camera and location from your browser settings.',

  // —— Historial empleado ——
  'Historial': 'History', 'Mi historial': 'My history', 'Fecha': 'Date', 'Hora': 'Time',
  'Tipo': 'Type', 'Sin registros': 'No records', 'No hay registros todavía.': 'No records yet.',

  // —— Admin: navegación / header ——
  'Resumen': 'Overview', 'Asistencia': 'Attendance', 'Principal': 'Main',
  'Configuración': 'Settings', 'Plazas': 'Locations', 'Puestos': 'Positions',
  'Gestión': 'Management', 'Turnos': 'Shifts', 'Empleados': 'Employees',
  'Log de Auditoría': 'Audit Log', 'Auditoría': 'Audit', 'Ajustes': 'Settings',
  'Seleccionar Plaza': 'Select Location', 'Todas las plazas': 'All locations',
  'Recursos Humanos': 'Human Resources', 'Jefe de Plaza': 'Location Manager',
  'Abrir menú': 'Open menu', 'Colapsar menú': 'Collapse menu', 'Expandir menú': 'Expand menu',

  // —— Admin: común ——
  'Nuevo Turno': 'New Shift', 'Nuevo': 'New', 'Nueva Plaza': 'New Location',
  'Nuevo Empleado': 'New Employee', 'Nuevo Puesto': 'New Position',
  'Asignación semanal': 'Weekly assignment',
  'Elige el turno de cada empleado por día. Se guarda al instante.':
    'Choose each employee\'s shift per day. Saved instantly.',
  'Empleado': 'Employee', 'Descanso': 'Day off', 'Horario actualizado.': 'Schedule updated.',
  'Nombre': 'Name', 'Nombre completo': 'Full name', 'Correo': 'Email', 'Teléfono': 'Phone',
  'Puesto': 'Position', 'Plaza': 'Location', 'Estado': 'Status', 'Acciones': 'Actions',
  'Rol': 'Role', 'PIN': 'PIN', 'Número de empleado': 'Employee number',
  'Fecha de ingreso': 'Start date', 'Hora de entrada': 'Start time', 'Hora de salida': 'End time',
  'Días de la semana': 'Days of the week', 'Tolerancia': 'Tolerance',
  'No hay turnos en esta plaza. Crea el primero.': 'No shifts at this location. Create the first one.',
  'No hay empleados activos.': 'No active employees.',
  'Turno creado.': 'Shift created.', 'Turno actualizado.': 'Shift updated.',
  'Turno eliminado.': 'Shift deleted.', 'Completa todos los campos obligatorios.': 'Complete all required fields.',
  'Activos': 'Active', 'Inactivos': 'Inactive', 'En vivo': 'Live',

  // —— Días (abreviados) ——
  'Lun': 'Mon', 'Mar': 'Tue', 'Mié': 'Wed', 'Jue': 'Thu', 'Vie': 'Fri', 'Sáb': 'Sat', 'Dom': 'Sun',

  // —— Turnos empleado ——
  'Aún no hay turnos asignados en tu plaza.': 'No shifts assigned at your location yet.',
  'PIN incorrecto.': 'Incorrect PIN.', 'Ingresa tu PIN.': 'Enter your PIN.',

  // —— Admin: overview / resumen ——
  'Hola': 'Hello', 'Resumen del día': "Today's summary",
  'Actividad de hoy': "Today's activity", 'Distribución de hoy': "Today's breakdown",
  'Accesos rápidos': 'Quick links',
  'Empleados activos': 'Active employees', 'Presentes ahora': 'Present now',
  'Registros hoy': 'Records today', 'Incidencias hoy': 'Incidents today',
  'fuera de geocerca': 'outside geofence', 'todo en orden': 'all in order',
  'Sin registros hoy.': 'No records today.', 'Sin actividad hoy.': 'No activity today.',
  'Entradas': 'Check-ins', 'Salidas': 'Check-outs', 'Incidencias': 'Incidents',
  'Ver asistencia': 'View attendance', 'Historial por empleado': 'History by employee',
  'Asistencia en tiempo real': 'Real-time attendance',

  // —— Admin: ajustes ——
  'Apariencia': 'Appearance', 'Tema': 'Theme',
  'Elige claro, oscuro o seguir el sistema.': 'Choose light, dark or follow the system.',
  'Claro': 'Light', 'Oscuro': 'Dark', 'Sistema': 'System',
  'Ver KPIs fijos': 'Show fixed KPIs',
  'Muestra las estadísticas siempre en el historial, no solo al pulsar el icono.':
    'Always show stats in history, not only when pressing the icon.',
  'Cuenta': 'Account', 'Sesión': 'Session',
  'Saldrás del panel administrativo.': 'You will exit the admin panel.',

  // —— Admin: auditoría ——
  'Sin registros.': 'No records.', 'Ver detalle': 'View detail',
  'Se': '', 'de': 'for', 'Creó': 'Created', 'Modificó': 'Modified', 'Eliminó': 'Deleted',
  'el horario del usuario': "the user's schedule", 'un turno': 'a shift',
  'una plaza': 'a location', 'un registro de asistencia': 'an attendance record',
  'una nota': 'a note', 'un administrador': 'an administrator',
  'Día': 'Day', 'N° empleado': 'Emp. number', 'Radio (m)': 'Radius (m)',
  'Latitud': 'Latitude', 'Longitud': 'Longitude', 'Dirección': 'Address',
  'Descripción': 'Description', 'Ingreso': 'Start date', 'Turno': 'Shift', 'Email': 'Email',

  // —— Admin: empleados ——
  'Buscar empleado…': 'Search employee…', 'Resetear PIN': 'Reset PIN',
  'Nuevo PIN (solo números)': 'New PIN (numbers only)',
  'Ingresa un PIN numérico válido.': 'Enter a valid numeric PIN.',
  'PIN actualizado correctamente.': 'PIN updated successfully.', 'Guardar PIN': 'Save PIN',
  'Sin puesto': 'No position', 'Sin plaza': 'No location', '– Sin puesto –': '– No position –',
  'Reactivar': 'Reactivate', 'Ver historial': 'View history',
  'No hay empleados que coincidan.': 'No matching employees.',
  'Editar perfil de empleado': 'Edit employee profile', 'Cambiar foto': 'Change photo',
  'N.º empleado': 'Emp. number', 'Se asigna automáticamente': 'Assigned automatically',
  'Selecciona': 'Select', 'PIN inicial (solo números)': 'Initial PIN (numbers only)',
  'Nombre y Plaza son obligatorios.': 'Name and Location are required.',
  'El PIN debe ser numérico.': 'PIN must be numeric.',
  'Empleado actualizado.': 'Employee updated.', 'Empleado creado.': 'Employee created.',
  'Empleado desactivado.': 'Employee deactivated.', 'Empleado reactivado.': 'Employee reactivated.',
  'Crear empleado': 'Create employee',

  // —— Admin: turnos ——
  'Sin días': 'No days', 'Tol.': 'Tol.', 'Nombre del turno': 'Shift name',
  'Ej: Turno Matutino': 'e.g. Morning Shift',
  'Tol. entrada (min)': 'Check-in tol. (min)', 'Tol. salida (min)': 'Check-out tol. (min)',
  'Pausa (min)': 'Break (min)', '¿Eliminar turno?': 'Delete shift?',

  // —— Admin: plazas ——
  'Activa': 'Active', 'Inactiva': 'Inactive', 'Ver mapa': 'View map', 'Ciudad': 'City',
  'Radio': 'Radius', 'Mapa': 'Map', 'Nombre de la Plaza': 'Location name',
  'Ubicación (mueve el pin o haz clic en el mapa)': 'Location (drag the pin or click the map)',
  'Radio de tolerancia (metros)': 'Tolerance radius (meters)',
  'Calle, número, colonia, C.P.': 'Street, number, neighborhood, ZIP',
  'Responsable': 'Manager', 'Nombre del encargado': "Manager's name", 'Notas': 'Notes',
  'Observaciones, horarios especiales, etc.': 'Notes, special hours, etc.',
  'Plaza activa': 'Active location', 'Coordenadas fuera de rango válido.': 'Coordinates out of valid range.',
  '¿Eliminar plaza?': 'Delete location?', 'Esta acción no se puede deshacer.': 'This action cannot be undone.',
  'Plaza eliminada': 'Location deleted', 'Plaza actualizada.': 'Location updated.',
  'Plaza creada.': 'Location created.', 'No se pudo cargar el mapa.': 'Could not load the map.',

  // —— Admin: puestos ——
  'Nuevo puesto': 'New position',
  'Los puestos definidos aquí son las opciones disponibles al crear o editar un empleado.':
    'Positions defined here are the options available when creating or editing an employee.',
  '¿Eliminar el puesto?': 'Delete position?',
  'Los empleados que ya lo tengan no se modifican.': 'Employees who already have it are not modified.',
  'Puesto eliminado.': 'Position deleted.', 'Puesto creado.': 'Position created.',
  'Nombre del puesto': 'Position name', 'Cajero': 'Cashier',
  'Escribe un nombre.': 'Enter a name.', 'Ese puesto ya existe.': 'That position already exists.',
  'Crear puesto': 'Create position',

  // —— Admin: tablero de asistencia ——
  'Tablero de Asistencia': 'Attendance Board', 'Actualizar': 'Refresh',
  'Mes anterior': 'Previous month', 'Mes siguiente': 'Next month',
  'Cargando asistencia…': 'Loading attendance…',
  'No hay empleados activos en esta plaza.': 'No active employees at this location.',
  'Ver historial completo': 'View full history',
  'Presente': 'Present', 'Retardo': 'Late', 'Falta': 'Absence', 'Permiso': 'Leave',
  'Justificada': 'Justified', 'Vacaciones': 'Vacation', 'Festivo': 'Holiday',

  // —— Admin: historial por empleado ——
  'Selecciona un empleado y pulsa “Ver historial”.': 'Select an employee and press “View history”.',
  'Asistencia y notas en calendario, por persona y rango de fechas.':
    'Attendance and notes in a calendar, by person and date range.',
  'Filtros': 'Filters', 'Tipo de empleado': 'Employee type',
  'Fecha inicio': 'Start date', 'Fecha final': 'End date', 'Hoy': 'Today',
  'Usar fecha de hoy': "Use today's date", 'Resetear': 'Reset',
  'Seleccionar (todas)': 'Select (all)', 'Seleccionar (todos)': 'Select (all)',
  'Supervisor': 'Supervisor', 'Gerente': 'Manager', 'Selecciona empleado…': 'Select employee…',
  'Checadas': 'Clock-ins', 'Retardos': 'Late arrivals', 'Horas trabajadas': 'Hours worked',
  'Notas': 'Notes', 'Nota': 'Note', 'Estadísticas del rango': 'Range statistics',
  'Estadísticas': 'Statistics', 'Ver estadísticas': 'View statistics',
  'Sin turno asignado — no se evalúan retardos.': 'No shift assigned — late arrivals are not evaluated.',
  'DÍA DE INICIO': 'START DAY',
  'Abrir día · click derecho: alternar asistencia/falta': 'Open day · right-click: toggle attendance/absence',
  'Fuera': 'Outside', 'Sin entrada': 'No check-in', 'Sin salida': 'No check-out',
  'Sin checadas este día.': 'No clock-ins this day.', 'Editada por': 'Edited by', 'Por': 'By',
  'Adjunto': 'Attachment', 'Sin notas este día.': 'No notes this day.',
  'Vista ampliada': 'Enlarged view', 'Detalle (opcional)': 'Detail (optional)',
  'Imagen adjunta': 'Attached image', 'Actual': 'Current',
  'Fecha y tipo son obligatorios.': 'Date and type are required.',
  'Editar nota': 'Edit note', 'Nueva nota': 'New note',
  'asistencia': 'attendance', 'falta': 'absence', 'permiso': 'leave',
  'justificacion': 'justification', 'vacaciones': 'vacation', 'festivo': 'holiday',
  // toasts
  'Selecciona un empleado.': 'Select an employee.',
  'Ese día tiene checada real; no se puede marcar a mano.':
    'That day has a real clock-in; it cannot be set manually.',
  'Marcado como falta.': 'Marked as absence.', 'Marcado como asistencia.': 'Marked as present.',
  '¿Eliminar esta nota?': 'Delete this note?', 'Nota eliminada.': 'Note deleted.',
  'Nota actualizada.': 'Note updated.', 'Nota registrada.': 'Note saved.',

  // —— Checador (flujo) ——
  'Solicitando permisos…': 'Requesting permissions…',
  'Registrar asistencia': 'Register attendance', 'Foto de verificación': 'Verification photo',
  '¿Qué vas a registrar hoy?': 'What are you registering today?',
  'Inicio de jornada': 'Start of shift', 'Fin de jornada': 'End of shift',
  'Usa tu dedo o lápiz para firmar en el recuadro': 'Use your finger or stylus to sign in the box',
  'Mira directo a la cámara': 'Look straight at the camera',
  'Confirma que tu foto es clara': 'Confirm your photo is clear',
  'Subiendo registro…': 'Uploading record…', 'Obteniendo ubicación…': 'Getting location…',
  'Vista previa': 'Preview', 'Dibuja tu firma antes de continuar.': 'Draw your signature before continuing.',
  'Error de red. Intenta de nuevo.': 'Network error. Try again.',
  'No se pudo guardar. Intenta de nuevo.': 'Could not save. Try again.',
  '¡Entrada registrada!': 'Check-in registered!', '¡Salida registrada!': 'Check-out registered!',
  'Tu foto de registro': 'Your record photo', 'Turno de': 'Shift of',

  // —— Historial (lista) ——
  'Sin registros aún.': 'No records yet.', 'Cargando ubicación…': 'Loading location…',
  'Ubicación no registrada': 'Location not recorded',
  'Foto del registro': 'Record photo', 'Firma del registro': 'Record signature',
  'Firma ampliada': 'Enlarged signature', 'Foto ampliada': 'Enlarged photo',
  'Error al cargar el historial.': 'Could not load the history.',

  // —— Login admin ——
  'Panel Administrativo': 'Admin Panel',
  'Gestiona tu fuerza laboral con claridad.': 'Manage your workforce with clarity.',
  'Geocercas y turnos por plaza': 'Geofences and shifts per location',
  'Reportes e historial por empleado': 'Reports and history by employee',
  'Acceso restringido a personal autorizado': 'Restricted to authorized personnel',
  'Volver al checador': 'Back to time clock', 'Iniciar sesión': 'Sign in',
  'Ingresa con tu cuenta de administrador.': 'Sign in with your administrator account.',
  'Correo electrónico': 'Email address', 'Contraseña': 'Password',
  'Mostrar contraseña': 'Show password', 'Ocultar contraseña': 'Hide password',
  'No se pudo iniciar sesión.': 'Could not sign in.', 'Error inesperado.': 'Unexpected error.',

  // —— Sin permisos / 404 ——
  'Permisos requeridos': 'Permissions required',
  'Para checar tu asistencia necesitamos acceso a tu <strong>cámara</strong> y <strong>ubicación</strong>. Sin estos permisos no es posible continuar.':
    "To clock in we need access to your <strong>camera</strong> and <strong>location</strong>. Without these permissions you can't continue.",
  'Toca el ícono de candado o <strong>ⓘ</strong> junto a la URL en tu navegador':
    'Tap the padlock or <strong>ⓘ</strong> icon next to the URL in your browser',
  'Ve a <strong>Configuración del sitio</strong> o <strong>Permisos</strong>':
    'Go to <strong>Site settings</strong> or <strong>Permissions</strong>',
  'Activa <strong>Cámara</strong> y <strong>Ubicación</strong> en <em>Permitir</em>':
    'Enable <strong>Camera</strong> and <strong>Location</strong> under <em>Allow</em>',
  'Regresa aquí y toca <strong>Reintentar</strong>': 'Come back here and tap <strong>Retry</strong>',
  'Reintentar': 'Retry', 'Volver al inicio': 'Back to home',
  'Página no encontrada': 'Page not found',
  'La dirección que escribiste no existe o fue movida.': 'The address you entered does not exist or was moved.',
  'Ir al inicio': 'Go home',
};

export const getLang = () => {
  try { return localStorage.getItem(KEY) || 'es'; } catch { return 'es'; }
};

export const t = (es) => (getLang() === 'en' ? (EN[es] ?? es) : es);

// Traduce el DOM. La fuente ES se captura una vez en el atributo para que
// alternar ida y vuelta sea estable.
export function applyI18n(root = document) {
  const en = getLang() === 'en';
  const tr = (src) => (en ? (EN[src] ?? src) : src);

  root.querySelectorAll('[data-i18n]').forEach(el => {
    let src = el.getAttribute('data-i18n');
    if (!src) { src = el.textContent.trim(); el.setAttribute('data-i18n', src); }
    el.textContent = tr(src);
  });
  // data-i18n-html: para frases con markup inline (<strong>, <em>). Clave =
  // innerHTML de una línea. ponytail: solo strings estáticos del dict, sin input de usuario.
  root.querySelectorAll('[data-i18n-html]').forEach(el => {
    let src = el.getAttribute('data-i18n-html');
    if (!src) { src = el.innerHTML.trim(); el.setAttribute('data-i18n-html', src); }
    el.innerHTML = tr(src);
  });
  root.querySelectorAll('[data-i18n-ph]').forEach(el => {
    let src = el.getAttribute('data-i18n-ph') || el.getAttribute('placeholder') || '';
    el.setAttribute('data-i18n-ph', src);
    el.setAttribute('placeholder', tr(src));
  });
  root.querySelectorAll('[data-i18n-title]').forEach(el => {
    let src = el.getAttribute('data-i18n-title') || el.getAttribute('title') || '';
    el.setAttribute('data-i18n-title', src);
    el.setAttribute('title', tr(src));
    if (el.hasAttribute('aria-label')) el.setAttribute('aria-label', tr(src));
  });
  document.documentElement.lang = getLang();
}

export function setLang(lang) {
  try { localStorage.setItem(KEY, lang); } catch {}
  applyI18n(document);
  window.dispatchEvent(new CustomEvent('langchange', { detail: { lang } }));
}

const FLAG_ES = `<svg viewBox="0 0 3 2" class="lang-flag" aria-hidden="true"><rect width="3" height="2" fill="#c60b1e"/><rect y=".5" width="3" height="1" fill="#ffc400"/></svg>`;
const FLAG_EN = `<svg viewBox="0 0 60 30" class="lang-flag" aria-hidden="true"><clipPath id="ukf"><rect width="60" height="30"/></clipPath><g clip-path="url(#ukf)"><rect width="60" height="30" fill="#012169"/><path d="M0,0 60,30M60,0 0,30" stroke="#fff" stroke-width="6"/><path d="M0,0 60,30M60,0 0,30" stroke="#C8102E" stroke-width="4"/><path d="M30,0V30M0,15H60" stroke="#fff" stroke-width="10"/><path d="M30,0V30M0,15H60" stroke="#C8102E" stroke-width="6"/></g></svg>`;

// Inyecta el control de banderas (segmentado ES | EN) en un contenedor y lo cablea.
export function mountLangToggle(container) {
  if (!container || container.querySelector('.lang-toggle')) return;
  const lang = getLang();
  const box = document.createElement('div');
  box.className = 'lang-toggle';
  box.setAttribute('role', 'group');
  box.setAttribute('aria-label', 'Idioma / Language');
  box.innerHTML = `
    <button type="button" class="lang-toggle__btn ${lang === 'es' ? 'is-active' : ''}" data-lang="es" aria-pressed="${lang === 'es'}" aria-label="Español" title="Español">${FLAG_ES}</button>
    <button type="button" class="lang-toggle__btn ${lang === 'en' ? 'is-active' : ''}" data-lang="en" aria-pressed="${lang === 'en'}" aria-label="English" title="English">${FLAG_EN}</button>`;
  box.addEventListener('click', (e) => {
    const btn = e.target.closest('.lang-toggle__btn');
    if (!btn || btn.dataset.lang === getLang()) return;
    setLang(btn.dataset.lang);
    box.querySelectorAll('.lang-toggle__btn').forEach(b => {
      const on = b.dataset.lang === btn.dataset.lang;
      b.classList.toggle('is-active', on);
      b.setAttribute('aria-pressed', on);
    });
  });
  container.appendChild(box);
}
