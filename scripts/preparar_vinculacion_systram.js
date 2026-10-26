/*
 * Primera etapa del proceso de vinculación: prepara y valida la cola
 * Supabase -> Systram sin transmitir datos a Systram.
 *
 * Uso:
 *   1. Copie vinculacion.env.example como vinculacion.env y ponga las claves.
 *   2. Ejecute la migración SQL en Supabase.
 *   3. node preparar_vinculacion_systram.js
 *
 * El resultado queda en outputs/vinculacion_systram/cola_preparada.json.
 * La ejecución posterior crea o actualiza la ficha base y la verifica.
 */
const fs = require('fs');
const path = require('path');
const https = require('https');

const ROOT = __dirname;

function loadEnv(file) {
  if (!fs.existsSync(file)) return;
  for (const raw of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const equals = line.indexOf('=');
    if (equals < 1) continue;
    const key = line.slice(0, equals).trim();
    let value = line.slice(equals + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

loadEnv(path.join(ROOT, 'vinculacion.env'));

const url = String(process.env.SUPABASE_URL || '').replace(/\/$/, '');
const key = String(process.env.SUPABASE_SERVICE_ROLE_KEY || '');
const limit = Math.max(1, Math.min(Number(process.env.SYSTRAM_VINCULACION_LIMIT || 10), 100));
const nameSearchArg = process.argv.find((arg) => arg.startsWith('--nombre='));
const nameSearch = nameSearchArg ? nameSearchArg.slice('--nombre='.length).trim() : '';

function request(method, endpoint, body) {
  return new Promise((resolve, reject) => {
    const target = new URL(endpoint, url);
    const payload = body ? Buffer.from(JSON.stringify(body)) : null;
    const req = https.request(target, {
      method,
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        Accept: 'application/json',
        ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': payload.length } : {}),
      },
    }, (res) => {
      const parts = [];
      res.on('data', (part) => parts.push(part));
      res.on('end', () => {
        const text = Buffer.concat(parts).toString('utf8');
        if (res.statusCode < 200 || res.statusCode >= 300) return reject(new Error(`Supabase ${res.statusCode}: ${text.slice(0, 500)}`));
        try { resolve(text ? JSON.parse(text) : null); } catch { reject(new Error('Supabase respondió un JSON inválido.')); }
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

function clean(value) { return String(value || '').trim().replace(/\s+/g, ' '); }

function splitNames(value) {
  const parts = clean(value).split(' ').filter(Boolean);
  return [parts[0] || '', parts.slice(1).join(' ')];
}

// Systram exige registrar cada requisito y luego adjuntar su soporte. La
// vigencia se calcula el día de la creación, para no reutilizar fechas viejas
// de una cola preparada antes.
function addMonthsIso(date, months) {
  const copy = new Date(date.getFullYear(), date.getMonth() + months, date.getDate());
  return copy.toISOString().slice(0, 10);
}

function documentosObligatorios(row, createdAt = new Date()) {
  const inicio = createdAt.toISOString().slice(0, 10);
  const vencimiento = addMonthsIso(createdAt, 3);
  const requeridos = [
    { tipo_systram: 'CEDULA', campos_soporte: ['cedula_pdf'] },
    { tipo_systram: 'CERTIFICADO DE ANTECEDENTES PROCURADURIA', campos_soporte: ['antecedentes_procuraduria'] },
    { tipo_systram: 'ANTECEDENTES POLICIA NACIONAL', campos_soporte: ['antecedentes_policia'] },
    { tipo_systram: 'REGISTRO UNICO NACIONAL DE TRANSITO', campos_soporte: ['runt'] },
    { tipo_systram: 'CONSULTA DE COMPARENDOS', campos_soporte: ['comparendos'] },
    { tipo_systram: 'LISTA CLINTON', campos_soporte: ['lista_clinton'] },
    { tipo_systram: 'CONSULTA DE ANTECEDENTES FISCALES', campos_soporte: ['antecedentes_fiscales'] },
    { tipo_systram: 'SEGURIDAD', campos_soporte: ['estudio_seguridad'] },
  ];
  return requeridos.map(({ tipo_systram, campos_soporte = [] }) => ({
    tipo_systram,
    fecha_inicio: inicio,
    fecha_vencimiento: vencimiento,
    soportes_vinculacion: campos_soporte
      .filter((campo) => clean(row[campo]))
      .map((campo) => ({ campo, ruta: row[campo] })),
    pendiente_soporte: campos_soporte.some((campo) => !clean(row[campo])) || campos_soporte.length === 0,
  }));
}

function validateBase(row) {
  const missing = [];
  for (const field of ['cedula', 'primer_nombre', 'primer_apellido', 'direccion', 'ciudad']) if (!clean(row[field])) missing.push(field);
  if (clean(row.cedula) && !/^\d{5,12}$/.test(clean(row.cedula))) missing.push('cedula_invalida');
  return missing;
}

// Estos datos se completan en las pestañas de anexos de Systram. No deben
// bloquear la creación de la ficha principal.
function validateAnnexes(row) {
  const missing = [];
  for (const field of ['cedula_pdf','pase_pdf','foto_rostro','licencia_categoria','licencia_vencimiento','emergencia_nombre','emergencia_parentesco','emergencia_telefono','antecedentes_procuraduria','antecedentes_policia','runt','comparendos','lista_clinton','antecedentes_fiscales','estudio_seguridad']) if (!clean(row[field])) missing.push(field);
  return missing;
}

function prepare(row) {
  const baseMissing = validateBase(row);
  const annexMissing = validateAnnexes(row);
  return {
    supabase_id: row.id || null,
    cedula: clean(row.cedula),
    estado: baseMissing.length ? 'requiere_revision' : 'lista_para_sincronizacion',
    faltantes: [...baseMissing, ...annexMissing],
    faltantes_base: baseMissing,
    faltantes_anexos: annexMissing,
    systram: {
      tipo_identificacion: 'CEDULA DE CIUDADANIA',
      identificacion: clean(row.cedula),
      primer_nombre: clean(row.primer_nombre),
      segundo_nombre: clean(row.segundo_nombre),
      primer_apellido: clean(row.primer_apellido),
      segundo_apellido: clean(row.segundo_apellido),
      direccion: clean(row.direccion),
      poblacion_busqueda: clean(row.ciudad),
      contribuyente: 'NATURAL',
      regimen: 'SIMPLIFICADO',
      sucursal: 'PRINCIPAL',
      tipo_conductor: 'CONDUCTOR EXTERNO',
      telefono: clean(row.telefono),
      telefono_alterno: clean(row.telefono_alterno),
      licencia: { categoria: clean(row.licencia_categoria), vencimiento: clean(row.licencia_vencimiento) },
    },
    posteriores: {
      placa: clean(row.vehiculo_placa),
      referencias: [
        { tipo: 'FAMILIAR', nombre: clean(row.ref_familiar_nombre), telefono: clean(row.ref_familiar_telefono) },
        { tipo: 'EMPRESARIAL', nombre: clean(row.ref_empresa_nombre), telefono: clean(row.ref_empresa_telefono) },
      ],
      emergencias: [{ nombre: clean(row.emergencia_nombre), parentesco: clean(row.emergencia_parentesco), telefono: clean(row.emergencia_telefono) }],
      documentos: ['foto_rostro','cedula_pdf', 'pase_pdf', 'cert_bancaria','antecedentes_procuraduria','antecedentes_policia','runt','comparendos','lista_clinton','antecedentes_fiscales','estudio_seguridad']
        .filter((field) => clean(row[field])).map((field) => ({ campo: field, ruta: row[field] })),
      documentos_obligatorios: documentosObligatorios(row),
    },
  };
}

async function main() {
  if (!url || !key) throw new Error('Faltan SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY en vinculacion.env.');
  const fields = 'id,rol,systram_estado,systram_etapa,licencia_categoria,licencia_vencimiento,personas!inner(*),vehiculos!inner(*)';
  const filters = nameSearch ? `&personas.primer_nombre=ilike.*${encodeURIComponent(nameSearch)}*` : '&or=(systram_estado.eq.pendiente,and(systram_estado.eq.requiere_revision,systram_etapa.eq.validacion_previa))';
  const rawRows = await request('GET', `/rest/v1/persona_vehiculo?select=${encodeURIComponent(fields)}&rol=eq.conductor${filters}&limit=${limit}`);
  const rows = rawRows.map(r => ({...r.personas, ...r, vehiculo_placa:r.vehiculos.placa}));
  const prepared = rows.map(prepare);
  const outDir = path.join(ROOT, 'outputs', 'vinculacion_systram');
  fs.mkdirSync(outDir, { recursive: true });
  const outFile = path.join(outDir, 'cola_preparada.json');
  fs.writeFileSync(outFile, JSON.stringify({ generated_at: new Date().toISOString(), total: prepared.length, records: prepared }, null, 2));
  const ready = prepared.filter((item) => item.estado === 'lista_para_sincronizacion').length;
  const review = prepared.length - ready;
  console.log(`${nameSearch ? `Búsqueda por nombre (${nameSearch})` : 'Preparados'}: ${prepared.length}; listos: ${ready}; requieren revisión: ${review}.`);
  console.log(`Resultado: ${outFile}`);
}

main().catch((error) => { console.error(`Error: ${error.message}`); process.exitCode = 1; });
