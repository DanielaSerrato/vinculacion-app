/*
 * Ejecuta de forma controlada la primera etapa de vinculacion: crear o
 * actualizar el conductor en Systram desde la cola de Supabase.
 *
 * Por defecto NO crea registros. Para permitir envios reales se requieren
 * simultaneamente:
 *   SYSTRAM_VINCULACION_APPLY=1 en vinculacion.env
 *   node sincronizar_conductores_systram.js --apply
 *
 * Los documentos se validan y quedan en Supabase antes de llegar aqui. La
 * carga de documentos y anexos en las pestanas de Systram permanece como una
 * etapa pendiente y verificable: nunca se marca como sincronizado hasta que
 * esa etapa exista y se compruebe.
 */
const fs = require('fs');
const path = require('path');
const https = require('https');
const { chromium } = require('playwright');

const ROOT = __dirname;
const SYSTRAM_BASE = 'https://capitalcargocolombia.systram.com.co';
const APPLY = process.argv.includes('--apply') && /^(1|true|si|yes)$/i.test(process.env.SYSTRAM_VINCULACION_APPLY || '');
const LIMIT = Math.max(1, Math.min(Number(process.env.SYSTRAM_VINCULACION_LIMIT || 5), 20));
const PROFILE = path.join(ROOT, '.systram-browser-profile');

function loadEnv(file) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const value = line.trim();
    if (!value || value.startsWith('#')) continue;
    const at = value.indexOf('=');
    if (at < 1) continue;
    const key = value.slice(0, at).trim();
    let item = value.slice(at + 1).trim();
    if ((item.startsWith('"') && item.endsWith('"')) || (item.startsWith("'") && item.endsWith("'"))) item = item.slice(1, -1);
    if (process.env[key] === undefined) process.env[key] = item;
  }
}

loadEnv(path.join(ROOT, 'vinculacion.env'));
loadEnv(path.join(ROOT, 'systram.env'));

const SUPABASE_URL = String(process.env.SUPABASE_URL || '').replace(/\/$/, '');
const SUPABASE_KEY = String(process.env.SUPABASE_SERVICE_ROLE_KEY || '');

function clean(value) { return String(value || '').trim().replace(/\s+/g, ' '); }
function shortError(error) { return clean(error && (error.message || error)).slice(0, 900); }
function supabase(method, endpoint, body, prefer) {
  return new Promise((resolve, reject) => {
    const target = new URL(endpoint, SUPABASE_URL);
    const payload = body === undefined ? null : Buffer.from(JSON.stringify(body));
    const request = https.request(target, {
      method,
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`,
        Accept: 'application/json',
        ...(prefer ? { Prefer: prefer } : {}),
        ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': payload.length } : {}),
      },
    }, (response) => {
      const parts = [];
      response.on('data', (part) => parts.push(part));
      response.on('end', () => {
        const text = Buffer.concat(parts).toString('utf8');
        if (response.statusCode < 200 || response.statusCode >= 300) return reject(new Error(`Supabase ${response.statusCode}: ${text.slice(0, 500)}`));
        try { resolve(text ? JSON.parse(text) : null); } catch { resolve(null); }
      });
    });
    request.on('error', reject);
    if (payload) request.write(payload);
    request.end();
  });
}

function appendHistory(previous, entry) {
  const list = Array.isArray(previous) ? previous : [];
  return [...list.slice(-19), entry];
}

async function updateRow(row, patch, historyEntry) {
  const history = appendHistory(row.systram_historial, historyEntry);
  const allowed = ['systram_estado','systram_id','systram_error','systram_ultimo_intento_en','systram_etapa','systram_verificado_en'];
  await supabase('PATCH', `/rest/v1/persona_vehiculo?id=eq.${encodeURIComponent(row.id)}`, Object.fromEntries(Object.entries(patch).filter(([k]) => allowed.includes(k))), 'return=minimal');
  Object.assign(row, patch);
}

// Solo valida lo necesario para crear/actualizar la ficha principal. Los
// documentos y datos de pestañas se verifican en la etapa de anexos.
function validateBase(row) {
  const missing = [];
  for (const field of ['cedula', 'primer_nombre', 'primer_apellido', 'direccion', 'ciudad']) if (!clean(row[field])) missing.push(field);
  if (clean(row.cedula) && !/^\d{5,12}$/.test(clean(row.cedula))) missing.push('cedula_invalida');
  return missing;
}

async function ensureSession(page) {
  await page.goto(`${SYSTRAM_BASE}/formularios/Conductor.aspx?page=1&busq=1`, { waitUntil: 'domcontentloaded' });
  const hasForm = await page.locator('#ctl00_ContentPlaceHolder1_btnuevo').count().catch(() => 0);
  if (!hasForm) throw new Error('Systram no tiene una sesión iniciada. Inicia sesión en la ventana de Chrome que se abrió y vuelve a ejecutar.');
}

async function selectText(page, selector, text) {
  const matched = await page.locator(selector).evaluate((element, wanted) => {
    const normalized = (v) => String(v || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toUpperCase();
    const option = Array.from(element.options).find((item) => normalized(item.textContent).includes(normalized(wanted)));
    if (!option) return null;
    element.value = option.value;
    element.dispatchEvent(new Event('change', { bubbles: true }));
    return { value: option.value, text: option.textContent.trim() };
  }, text);
  if (!matched) throw new Error(`Systram no ofreció la opción: ${text}`);
  return matched;
}

async function setValue(page, selector, value) {
  const locator = page.locator(selector);
  await locator.waitFor({ state: 'visible', timeout: 10000 });
  await locator.fill(clean(value));
}

async function chooseCity(page, city) {
  await page.locator('#ctl00_ContentPlaceHolder1_btpobtercero').click();
  const frame = page.frameLocator('#TB_iframeContent');
  const search = frame.locator('#texto');
  await search.waitFor({ state: 'visible', timeout: 10000 });
  await search.fill(clean(city));
  await search.press('Enter');
  await page.waitForTimeout(800);
  const result = frame.locator('a, input[type="button"], input[type="submit"]').filter({ hasText: city }).first();
  if (!await result.count()) throw new Error(`No encontré una población que coincida con “${city}”.`);
  await result.click();
  await page.locator('#TB_iframeContent').waitFor({ state: 'hidden', timeout: 10000 }).catch(() => {});
  const selected = await page.locator('#ctl00_ContentPlaceHolder1_txtpoblaciontercero').inputValue();
  if (!clean(selected)) throw new Error(`Systram no confirmó la población “${city}”.`);
}

async function findDriverInSystram(page, cedula) {
  await page.goto(`${SYSTRAM_BASE}/formularios/Conductor.aspx?page=1&busq=1`, { waitUntil: 'domcontentloaded' });
  const search = page.locator('#ctl00_ContentPlaceHolder1_txtbuscar');
  await search.waitFor({ state: 'visible', timeout: 10000 });
  await search.fill(clean(cedula));
  await page.locator('#ctl00_ContentPlaceHolder1_imbus').click();
  await page.waitForTimeout(900);
  return page.locator('body').evaluate((documentId) => {
    const rowWithDocument = Array.from(document.querySelectorAll('tr')).find((row) => row.innerText.includes(documentId));
    if (!rowWithDocument) return null;
    const link = rowWithDocument.querySelector('a[href*="ConductorDetalle.aspx"], a[onclick*="ConductorDetalle"]');
    const source = link && (link.getAttribute('href') || link.getAttribute('onclick'));
    const match = source && /(?:[?&]id=|id[',=])([^&'"\s)]+)/i.exec(source);
    if (match) return { id: decodeURIComponent(match[1]) };
    // Algunas versiones usan una fila clicable. En ese caso, la ficha se
    // encuentra por el vínculo de edición que existe dentro de la celda.
    const all = Array.from(rowWithDocument.querySelectorAll('input,a'));
    const candidate = all.find((node) => /editar|detalle|consultar/i.test(`${node.title || ''} ${node.value || ''} ${node.innerText || ''}`));
    const handler = candidate && candidate.getAttribute('onclick');
    const handlerMatch = handler && /(?:[?&]id=|id[',=])([^&'"\s)]+)/i.exec(handler);
    return handlerMatch ? { id: decodeURIComponent(handlerMatch[1]) } : null;
  }, clean(cedula));
}

async function fillDriverForm(page, row, mode) {
  if (mode === 'create') await page.goto(`${SYSTRAM_BASE}/formularios/ConductorDetalle.aspx?act=n`, { waitUntil: 'domcontentloaded' });
  await page.locator('#ctl00_ContentPlaceHolder1_txtdocumento').waitFor({ state: 'visible', timeout: 15000 });
  if (mode === 'create') {
    await selectText(page, '#ctl00_ContentPlaceHolder1_cmbtipodocumento', 'CEDULA DE CIUDADANIA');
    await setValue(page, '#ctl00_ContentPlaceHolder1_txtdocumento', row.cedula);
  }
  await setValue(page, '#ctl00_ContentPlaceHolder1_txtnombre1', row.primer_nombre);
  await setValue(page, '#ctl00_ContentPlaceHolder1_txtnombre2', row.segundo_nombre);
  await setValue(page, '#ctl00_ContentPlaceHolder1_txtapellido', row.primer_apellido);
  await setValue(page, '#ctl00_ContentPlaceHolder1_txtapellido2', row.segundo_apellido);
  await setValue(page, '#ctl00_ContentPlaceHolder1_txtdireccion', row.direccion);
  await selectText(page, '#ctl00_ContentPlaceHolder1_cmbnaturaleza', 'NATURAL');
  await selectText(page, '#ctl00_ContentPlaceHolder1_cmbtiporegimen', process.env.SYSTRAM_CONDUCTOR_REGIMEN || 'SIMPLIFICADO');
  await selectText(page, '#ctl00_ContentPlaceHolder1_cmbsucursal', process.env.SYSTRAM_CONDUCTOR_SUCURSAL || 'PRINCIPAL');
  await selectText(page, '#ctl00_ContentPlaceHolder1_cmbtipo', process.env.SYSTRAM_CONDUCTOR_TIPO || 'CONDUCTOR EXTERNO');
  if (clean(row.telefono)) await setValue(page, '#ctl00_ContentPlaceHolder1_txttelefono', row.telefono).catch(() => {});
  await chooseCity(page, row.ciudad);
  await page.locator('#ctl00_ContentPlaceHolder1_btconductor').click();
  await page.waitForTimeout(1500);
  const result = await page.locator('body').innerText();
  if (/error|obligatorio|invalido|inválido/i.test(result) && !/Detalles del Conductor/i.test(result)) throw new Error(result.slice(-600));
  const url = page.url();
  const idMatch = /(?:[?&]id|conductor)=([^&]+)/i.exec(url);
  return { systramId: idMatch ? decodeURIComponent(idMatch[1]) : null };
}

async function verifyDriver(page, row) {
  const actual = await page.locator('body').evaluate(() => ({
    cedula: document.querySelector('#ctl00_ContentPlaceHolder1_txtdocumento')?.value,
    primer_nombre: document.querySelector('#ctl00_ContentPlaceHolder1_txtnombre1')?.value,
    primer_apellido: document.querySelector('#ctl00_ContentPlaceHolder1_txtapellido')?.value,
    direccion: document.querySelector('#ctl00_ContentPlaceHolder1_txtdireccion')?.value,
    ciudad: document.querySelector('#ctl00_ContentPlaceHolder1_txtpoblaciontercero')?.value,
  }));
  const normalized = (value) => clean(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase();
  const expected = {
    cedula: row.cedula,
    primer_nombre: row.primer_nombre,
    primer_apellido: row.primer_apellido,
    direccion: row.direccion,
    ciudad: row.ciudad,
  };
  const mismatches = Object.keys(expected).filter((key) => !normalized(actual[key]).includes(normalized(expected[key])));
  if (mismatches.length) throw new Error(`Systram no confirmó los campos: ${mismatches.join(', ')}`);
  return actual;
}

async function main() {
  if (!APPLY) {
    console.log('Modo seguro: no se creó ningún conductor. Para ejecutar de verdad use SYSTRAM_VINCULACION_APPLY=1 y --apply.');
    return;
  }
  if (!SUPABASE_URL || !SUPABASE_KEY) throw new Error('Faltan SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY en vinculacion.env.');
  const fields = 'id,rol,systram_estado,systram_etapa,systram_id,systram_error,systram_ultimo_intento_en,licencia_categoria,licencia_vencimiento,personas!inner(*),vehiculos!inner(*)';
  const rawRows = await supabase('GET', `/rest/v1/persona_vehiculo?select=${encodeURIComponent(fields)}&rol=eq.conductor&or=(systram_estado.eq.pendiente,and(systram_estado.eq.requiere_revision,systram_etapa.eq.validacion_previa))&limit=${LIMIT}`);
  const rows = rawRows.map(r => ({...r.personas, ...r, vehiculo_placa:r.vehiculos.placa}));
  if (!rows.length) { console.log('No hay conductores pendientes.'); return; }
  const context = await chromium.launchPersistentContext(PROFILE, { channel: 'chrome', headless: false, ignoreDefaultArgs: ['--no-sandbox'] });
  const page = context.pages()[0] || await context.newPage();
  try {
    await ensureSession(page);
    for (const row of rows) {
      const now = new Date().toISOString();
      const missing = validateBase(row);
      if (missing.length) {
        await updateRow(row, { systram_estado: 'requiere_revision', systram_error: `Faltan o son inválidos: ${missing.join(', ')}`, systram_etapa: 'validacion_previa' }, { at: now, etapa: 'validacion_previa', resultado: 'requiere_revision', detalle: missing });
        console.log(`${row.cedula}: requiere revisión (${missing.join(', ')}).`);
        continue;
      }
      await updateRow(row, { systram_estado: 'validando', systram_intentos: Number(row.systram_intentos || 0) + 1, systram_ultimo_intento_en: now, systram_error: null, systram_etapa: 'creando_conductor' }, { at: now, etapa: 'creando_conductor', resultado: 'iniciado' });
      try {
        const existing = await findDriverInSystram(page, row.cedula);
        const action = existing ? 'actualizando_conductor' : 'creando_conductor';
        await updateRow(row, { systram_etapa: action }, { at: new Date().toISOString(), etapa: action, resultado: 'iniciado', systram_id: existing?.id || null });
        if (existing?.id) await page.goto(`${SYSTRAM_BASE}/formularios/ConductorDetalle.aspx?id=${encodeURIComponent(existing.id)}`, { waitUntil: 'domcontentloaded' });
        const saved = await fillDriverForm(page, row, existing ? 'update' : 'create');
        const confirmed = await verifyDriver(page, row);
        const systramId = existing?.id || saved.systramId;
        await updateRow(row, { systram_estado: 'requiere_revision', systram_id: systramId, systram_error: 'Datos base verificados. Pendiente cargar y verificar fotografías, teléfonos, referencias, emergencias, licencia y documentos en las pestañas de Systram.', systram_etapa: 'anexos_pendientes' }, { at: new Date().toISOString(), etapa: action, resultado: existing ? 'actualizado_y_verificado_pendiente_anexos' : 'creado_y_verificado_pendiente_anexos', systram_id: systramId, verificado: Object.keys(confirmed) });
        console.log(`${row.cedula}: ${existing ? 'actualizado' : 'creado'} y datos base verificados; anexos pendientes.`);
      } catch (error) {
        const detail = shortError(error);
        await updateRow(row, { systram_estado: 'requiere_revision', systram_error: detail, systram_etapa: 'creando_conductor' }, { at: new Date().toISOString(), etapa: 'creando_conductor', resultado: 'requiere_revision', detalle: detail });
        console.error(`${row.cedula}: ${detail}`);
      }
    }
  } finally {
    await context.close().catch(() => {});
  }
}

main().catch((error) => { console.error(`ERROR: ${shortError(error)}`); process.exitCode = 1; });
