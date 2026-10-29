"""Browser regression tests. Run: python tests/test_conductor_propietario.py

Requires Python Playwright and installed Chrome. All HTTP(S) requests are blocked;
Supabase and PDF generation are simulated. No production data is read or written.
"""

import base64
from pathlib import Path
import unittest

from playwright.sync_api import expect, sync_playwright


ROOT = Path(__file__).resolve().parents[1]
PNG = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aD1sAAAAASUVORK5CYII="
)
MOCK = """
window.__testDb = {
  persons: [], relations: [], documents: [], uploads: [], calls: [], pdfs: [],
  failOnceTable: null, uploadDelay: 0, vehicleExists: true
};
class TestQuery {
  constructor(table) { this.table = table; this.filters = []; this.action = 'select'; }
  select() { return this; }
  eq(field, value) { this.filters.push([field, value]); return this; }
  limit() { return this; }
  upsert(rows, options) { this.action = 'upsert'; this.rows = rows; this.options = options; return this; }
  insert(rows) { this.action = 'insert'; this.rows = rows; return this; }
  execute() {
    const db = window.__testDb;
    if (this.action === 'select') {
      let data = this.table === 'vehiculos'
        ? (db.vehicleExists ? [{id:'vehicle-1', placa:'ABC123'}] : [])
        : this.table === 'persona_vehiculo' ? db.relations : db.persons;
      data = data.filter(row => this.filters.every(([field, value]) =>
        field === 'vehiculos.placa' ? value === 'ABC123' : row[field] === value));
      return {data, error:null};
    }
    const rows = Array.isArray(this.rows) ? this.rows : [this.rows];
    db.calls.push({table:this.table, action:this.action, rows, options:this.options});
    if (db.failOnceTable === this.table) {
      db.failOnceTable = null;
      return {data:null, error:{message:'Fallo simulado de ' + this.table}};
    }
    if (this.table === 'documentos') {
      if (rows.some(row => row.estado !== 'recibido')) {
        return {data:null, error:{message:'documentos_estado_check'}};
      }
      db.documents.push(...rows);
      return {data:rows, error:null};
    }
    const collection = this.table === 'personas' ? db.persons : db.relations;
    const result = rows.map(row => {
      const existing = collection.find(item => this.table === 'personas'
        ? item.cedula === row.cedula
        : item.persona_id === row.persona_id && item.vehiculo_id === row.vehiculo_id && item.rol === row.rol);
      if (existing) { Object.assign(existing, row); return existing; }
      const created = {...row, id:this.table + '-' + (collection.length + 1)};
      collection.push(created);
      return created;
    });
    return {data:result, error:null};
  }
  async single() { const result = this.execute(); return {...result, data:result.data?.[0] || null}; }
  async maybeSingle() { return this.single(); }
  then(resolve, reject) { return Promise.resolve(this.execute()).then(resolve, reject); }
}
window.supabase = {createClient:() => ({
  from:table => new TestQuery(table),
  storage:{from:() => ({upload:async (path, file) => {
    if (window.__testDb.uploadDelay) await new Promise(r => setTimeout(r, window.__testDb.uploadDelay));
    window.__testDb.uploads.push({path, name:file.name || 'generado.pdf'});
    return {error:null};
  }})}
})};
"""


class ConductorPropietarioTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.playwright = sync_playwright().start()
        cls.browser = cls.playwright.chromium.launch(channel="chrome", headless=True)

    @classmethod
    def tearDownClass(cls):
        cls.browser.close()
        cls.playwright.stop()

    def setUp(self):
        self.context = self.browser.new_context(viewport={"width": 1280, "height": 900})
        self.context.route("http://**/*", lambda route: route.abort())
        self.context.route("https://**/*", lambda route: route.abort())
        self.context.add_init_script(MOCK)
        self.page = self.context.new_page()
        self.errors = []
        self.dialogs = []
        self.page.on("pageerror", lambda error: self.errors.append(str(error)))
        self.page.on("dialog", self.handle_dialog)
        self.page.goto((ROOT / getattr(self, "PAGE", "conductor.html")).as_uri() + "?placa=ABC123")
        self.page.wait_for_load_state("networkidle")
        self.page.evaluate("""() => {
          DocumentValidation.createPdf = async (front, back, title) => {
            window.__testDb.pdfs.push({front:front.name, back:back.name, title});
            return new Blob(['pdf simulado'], {type:'application/pdf'});
          };
        }""")

    def tearDown(self):
        try:
            self.assertEqual(self.errors, [])
        finally:
            self.context.close()

    def handle_dialog(self, dialog):
        self.dialogs.append(dialog.message)
        dialog.dismiss()

    def choose(self, radio_id):
        self.page.locator(f'label[for="{radio_id}"]').click()

    def upload(self, field, pdf=False):
        self.page.locator(f"#file_{field}").set_input_files({
            "name": field + (".pdf" if pdf else ".png"),
            "mimeType": "application/pdf" if pdf else "image/png",
            "buffer": b"%PDF-1.4\nsoporte simulado" if pdf else PNG,
        })

    def fill_driver(self):
        self.choose("autoriza_si")
        values = {
            "primer_nombre": "Prueba", "primer_apellido": "Conductor",
            "cedula": "12345678", "direccion": "Direccion de prueba", "ciudad": "Bogota",
            "telefono": "3111234567", "telefono_alterno": "3117654321",
            "numero_cuenta": "123456789", "banco": "Banco de prueba",
            "ref_empresa_nombre": "Empresa de prueba", "ref_empresa_telefono": "3111111111",
            "emergencia_nombre": "Contacto de prueba", "emergencia_parentesco": "Hermana",
            "emergencia_telefono": "3112222222",
        }
        for field, value in values.items():
            self.page.locator(f"#{field}").fill(value)
        self.choose("tipo_ahorros")
        for field in ("cedula_frente", "cedula_reverso", "pase_frente", "pase_reverso", "foto_rostro"):
            self.upload(field)
        self.choose("sensibles_si")

    def fill_owner(self, invoice="factura_no"):
        self.choose("propietario_si")
        self.choose(invoice)
        self.upload("rut", pdf=True)
        self.upload("cert_bancaria", pdf=True)

    def submit(self):
        self.page.locator("#btnSubmit").click()

    def db(self):
        return self.page.evaluate("window.__testDb")

    def test_driver_only_keeps_optional_certificate_and_owner_link(self):
        self.fill_driver()
        self.choose("propietario_no")
        expect(self.page.locator("#ownerExtras")).to_be_hidden()
        expect(self.page.locator("#file_rut")).to_be_disabled()
        self.assertFalse(self.page.locator("#file_cert_bancaria").evaluate("el => el.required"))
        self.submit()
        expect(self.page.locator("#successCard")).to_be_visible()
        db = self.db()
        self.assertEqual([r["rol"] for r in db["relations"]], ["conductor"])
        self.assertNotIn("factura_electronica", db["persons"][0])
        self.assertEqual({d["tipo"] for d in db["documents"]}, {"cedula_pdf", "pase_pdf", "foto_rostro"})
        expect(self.page.locator('#navButtons a[href^="propietario.html"]')).to_be_visible()

    def test_owner_question_and_account_are_required_even_with_key(self):
        self.fill_driver()
        self.submit()
        expect(self.page.locator("#err_es_propietario")).to_be_visible()
        self.assertEqual(self.db()["calls"], [])
        self.choose("propietario_no")
        self.page.locator("#numero_cuenta").fill("")
        self.page.locator("#llave_pago").fill("llave@example.com")
        self.submit()
        expect(self.page.locator("#err_numero_cuenta")).to_be_visible()
        self.assertEqual(self.db()["calls"], [])

    def test_owner_extras_are_required_and_removed_certificate_blocks(self):
        self.fill_driver()
        self.choose("propietario_si")
        self.submit()
        for field in ("rut", "cert_bancaria", "factura_electronica"):
            expect(self.page.locator(f"#err_{field}")).to_be_visible()
        self.assertEqual(self.db()["calls"], [])
        self.choose("factura_si")
        self.upload("rut", pdf=True)
        self.upload("cert_bancaria", pdf=True)
        self.page.locator("#preview_cert_bancaria .remove-btn").click()
        self.submit()
        expect(self.page.locator("#err_cert_bancaria")).to_be_visible()
        self.assertEqual(self.db()["calls"], [])

    def test_same_owner_reuses_identity_bank_and_certificate(self):
        self.fill_driver()
        self.upload("cert_bancaria", pdf=True)
        self.choose("propietario_si")
        expect(self.page.locator("#ownerCertBancaria #preview_cert_bancaria")).to_be_visible()
        expect(self.page.locator("#certBancariaHint")).to_contain_text("ya adjuntaste")
        self.choose("factura_no")
        self.upload("rut", pdf=True)
        self.submit()
        expect(self.page.locator("#successTitle")).to_have_text("¡Conductor y propietario registrados!")
        db = self.db()
        self.assertEqual(len(db["persons"]), 1)
        self.assertEqual({r["rol"] for r in db["relations"]}, {"conductor", "propietario"})
        self.assertEqual({r["persona_id"] for r in db["relations"]}, {db["persons"][0]["id"]})
        self.assertEqual(db["persons"][0]["numero_cuenta"], "123456789")
        self.assertEqual(db["persons"][0]["telefono_alterno"], "3117654321")
        self.assertEqual(db["persons"][0]["emergencia_nombre"], "Contacto de prueba")
        self.assertEqual(db["persons"][0]["ref_empresa_nombre"], "Empresa de prueba")
        self.assertIs(db["persons"][0]["factura_electronica"], False)
        self.assertEqual(len(db["pdfs"]), 2)
        for field in ("cert_bancaria", "rut", "cedula_pdf", "pase_pdf", "foto_rostro"):
            self.assertEqual(sum(d["tipo"] == field for d in db["documents"]), 1)
        self.assertEqual(sum(u["name"] == "cert_bancaria.pdf" for u in db["uploads"]), 1)
        expect(self.page.locator('#navButtons a[href^="propietario.html"]')).to_have_count(0)
        expect(self.page.locator("#dotConductor")).to_have_class("dot done")
        expect(self.page.locator("#dotPropietario")).to_have_class("dot done")

    def test_switching_to_other_owner_preserves_existing_records(self):
        self.fill_driver()
        self.fill_owner(invoice="factura_si")
        self.page.evaluate("""() => {
          __testDb.persons.push({id:'existing-person', cedula:'12345678', factura_electronica:false});
          __testDb.relations.push({id:'existing-owner', persona_id:'existing-person', vehiculo_id:'vehicle-1', rol:'propietario', estado:'aprobado'});
        }""")
        self.choose("propietario_no")
        expect(self.page.locator("#certBancariaHome #preview_cert_bancaria")).to_be_visible()
        self.submit()
        expect(self.page.locator("#successCard")).to_be_visible()
        db = self.db()
        self.assertEqual(len(db["persons"]), 1)
        self.assertIs(db["persons"][0]["factura_electronica"], False)
        self.assertEqual(next(r for r in db["relations"] if r["rol"] == "propietario")["estado"], "aprobado")
        self.assertFalse(any(d["tipo"] == "rut" for d in db["documents"]))

    def test_retry_after_document_error_does_not_create_roles_prematurely(self):
        self.fill_driver()
        self.fill_owner()
        self.page.evaluate("window.__testDb.failOnceTable = 'documentos'")
        self.submit()
        expect(self.page.locator("#btnSubmit")).to_be_enabled()
        self.page.wait_for_function("__testDb.calls.some(c => c.table === 'documentos')")
        self.assertEqual(len(self.dialogs), 1)
        self.assertEqual(self.db()["relations"], [])
        expect(self.page.locator("#ownerExtras")).to_be_visible()
        expect(self.page.locator("#preview_rut")).to_be_visible()
        self.submit()
        expect(self.page.locator("#successCard")).to_be_visible()
        db = self.db()
        self.assertEqual(len(db["persons"]), 1)
        self.assertEqual(len(db["relations"]), 2)
        self.assertEqual(sum(d["tipo"] == "rut" for d in db["documents"]), 1)

    def test_double_submission_is_ignored(self):
        self.fill_driver()
        self.fill_owner()
        self.page.evaluate("""() => {
          __testDb.uploadDelay = 40;
          document.getElementById('conductorForm').requestSubmit();
          document.getElementById('conductorForm').requestSubmit();
        }""")
        expect(self.page.locator("#successCard")).to_be_visible()
        db = self.db()
        self.assertEqual(sum(c["table"] == "personas" for c in db["calls"]), 1)
        self.assertEqual(len(db["relations"]), 2)

    def test_auth_and_mobile_layout_keep_conditional_controls_consistent(self):
        self.fill_driver()
        self.choose("propietario_si")
        self.choose("autoriza_no")
        expect(self.page.locator("#file_rut")).to_be_disabled()
        expect(self.page.locator("#file_cert_bancaria")).to_be_disabled()
        expect(self.page.locator("#btnSubmit")).to_be_disabled()
        self.choose("autoriza_si")
        expect(self.page.locator("#file_rut")).to_be_enabled()
        self.choose("propietario_no")
        expect(self.page.locator("#file_rut")).to_be_disabled()
        expect(self.page.locator("#file_cert_bancaria")).to_be_enabled()
        self.choose("propietario_si")
        self.page.set_viewport_size({"width": 390, "height": 844})
        self.assertTrue(self.page.evaluate("document.documentElement.scrollWidth <= window.innerWidth"))
        expect(self.page.locator("#ownerExtras")).to_be_visible()
        self.assertEqual(self.page.locator("#file_cert_bancaria").count(), 1)


class PropietarioConductorTests(unittest.TestCase):
    PAGE = "propietario.html"
    setUpClass = classmethod(ConductorPropietarioTests.setUpClass.__func__)
    tearDownClass = classmethod(ConductorPropietarioTests.tearDownClass.__func__)
    setUp = ConductorPropietarioTests.setUp
    tearDown = ConductorPropietarioTests.tearDown
    handle_dialog = ConductorPropietarioTests.handle_dialog
    db = ConductorPropietarioTests.db

    def choose(self, name, value):
        self.page.locator(f'input[name="{name}"][value="{value}"]').check()

    def upload(self, field, pdf=False):
        self.page.locator(f'.file-drop[data-field="{field}"] input').set_input_files({
            "name": field + (".pdf" if pdf else ".png"),
            "mimeType": "application/pdf" if pdf else "image/png",
            "buffer": b"%PDF-1.4\nsoporte simulado" if pdf else PNG,
        })
        expect(self.page.locator(f'[data-upload="{field}"] .fname')).to_be_visible()

    def fill_owner(self):
        for field, value in {
            "primer_nombre": "Prueba", "primer_apellido": "Propietario", "cedula": "12345678",
            "direccion": "Direccion de prueba", "ciudad": "Bogota", "telefono": "3111234567",
            "banco": "Banco de prueba", "numero_cuenta": "123456789",
        }.items():
            self.page.locator(f"#{field}").fill(value)
        self.choose("factura_electronica", "Si")
        self.choose("tipo_cuenta", "Ahorros")
        self.choose("autoriza_sensibles", "si")
        self.upload("rut", pdf=True)
        self.upload("cert_bancaria", pdf=True)

    def fill_driver_extras(self):
        self.choose("es_conductor", "si")
        for field in ("cedula_frente", "cedula_reverso", "pase_frente", "pase_reverso", "foto_rostro"):
            self.upload(field)
        for field, value in {
            "telefono_alterno": "3117654321", "ref_empresa_nombre": "Empresa de prueba",
            "ref_empresa_telefono": "3111111111", "emergencia_nombre": "Contacto de prueba",
            "emergencia_parentesco": "Hermana", "emergencia_telefono": "3112222222",
        }.items():
            self.page.locator(f"#{field}").fill(value)

    def submit(self):
        self.page.locator("#btnSubmit").click()

    def test_owner_only_retains_requirements_and_separate_driver_link(self):
        self.fill_owner()
        self.choose("es_conductor", "no")
        expect(self.page.locator("#driverExtras")).to_be_hidden()
        self.submit()
        expect(self.page.locator("#successScreen")).to_be_visible()
        db = self.db()
        self.assertEqual([r["rol"] for r in db["relations"]], ["propietario"])
        self.assertEqual({d["tipo"] for d in db["documents"]}, {"rut", "cert_bancaria"})
        expect(self.page.locator('#navButtons a[href^="conductor.html"]')).to_be_visible()

    def test_driver_question_and_shared_certificate_remain_required(self):
        self.fill_owner()
        self.submit()
        expect(self.page.locator("#err_es_conductor")).to_be_visible()
        self.assertEqual(self.db()["calls"], [])
        self.choose("es_conductor", "no")
        self.page.locator('[data-upload="cert_bancaria"] .remove-file').click()
        self.submit()
        expect(self.page.locator('[data-upload="cert_bancaria"] .error-msg')).to_be_visible()
        self.assertEqual(self.db()["calls"], [])

    def test_driver_requires_documents_photo_references_and_consent(self):
        self.fill_owner()
        self.choose("es_conductor", "si")
        self.submit()
        for field in ("cedula_frente", "cedula_reverso", "pase_frente", "pase_reverso", "foto_rostro"):
            expect(self.page.locator(f'[data-upload="{field}"] .error-msg')).to_be_visible()
        self.assertEqual(self.db()["calls"], [])
        self.fill_driver_extras()
        self.choose("autoriza_sensibles", "no")
        self.submit()
        expect(self.page.locator("#errConsent")).to_be_visible()
        self.assertEqual(self.db()["calls"], [])

    def test_same_driver_reuses_person_account_and_all_shared_documents(self):
        self.fill_owner()
        self.upload("foto_rostro")
        self.fill_driver_extras()
        self.page.locator("#llave_pago").fill("llave@example.com")
        self.submit()
        expect(self.page.locator("#successTitle")).to_have_text("¡Propietario y conductor registrados!")
        db = self.db()
        self.assertEqual(len(db["persons"]), 1)
        self.assertEqual({r["rol"] for r in db["relations"]}, {"propietario", "conductor"})
        self.assertEqual({r["persona_id"] for r in db["relations"]}, {db["persons"][0]["id"]})
        self.assertEqual(db["persons"][0]["numero_cuenta"], "123456789")
        self.assertEqual(db["persons"][0]["emergencia_nombre"], "Contacto de prueba")
        self.assertEqual(db["persons"][0]["ref_empresa_nombre"], "Empresa de prueba")
        self.assertIs(db["persons"][0]["autoriza_datos"], True)
        self.assertEqual(len(db["pdfs"]), 2)
        for field in ("cert_bancaria", "rut", "cedula_pdf", "pase_pdf", "foto_rostro", "llave_pago"):
            self.assertEqual(sum(d["tipo"] == field for d in db["documents"]), 1)
        self.assertEqual(sum(u["name"] == "cert_bancaria.pdf" for u in db["uploads"]), 1)
        expect(self.page.locator('#navButtons a[href^="conductor.html"]')).to_have_count(0)
        expect(self.page.locator("#dotConductor")).to_have_class("dot done")
        expect(self.page.locator("#dotPropietario")).to_have_class("dot done")

    def test_switching_to_other_driver_preserves_existing_driver_details(self):
        self.fill_owner()
        self.fill_driver_extras()
        self.upload("seguridad_social", pdf=True)
        self.page.evaluate("""() => {
          __testDb.persons.push({id:'existing-person', cedula:'12345678', emergencia_nombre:'Contacto existente', ref_empresa_nombre:'Empresa existente', telefono_alterno:'3110000000'});
          __testDb.relations.push({id:'existing-driver', persona_id:'existing-person', vehiculo_id:'vehicle-1', rol:'conductor', estado:'aprobado'});
        }""")
        self.choose("es_conductor", "no")
        expect(self.page.locator('#ownerPhotoHome [data-field="foto_rostro"]')).to_be_visible()
        self.submit()
        expect(self.page.locator("#successScreen")).to_be_visible()
        db = self.db()
        self.assertEqual(len(db["persons"]), 1)
        self.assertEqual(db["persons"][0]["emergencia_nombre"], "Contacto existente")
        self.assertEqual(db["persons"][0]["ref_empresa_nombre"], "Empresa existente")
        self.assertEqual(db["persons"][0]["telefono_alterno"], "3110000000")
        self.assertEqual(next(r for r in db["relations"] if r["rol"] == "conductor")["estado"], "aprobado")
        self.assertFalse(any(d["tipo"] in ("pase_pdf", "seguridad_social") for d in db["documents"]))

    def test_retry_after_document_error_preserves_extras_and_roles(self):
        self.fill_owner()
        self.fill_driver_extras()
        self.page.evaluate("window.__testDb.failOnceTable = 'documentos'")
        self.submit()
        expect(self.page.locator("#btnSubmit")).to_be_enabled()
        self.page.wait_for_function("__testDb.calls.some(c => c.table === 'documentos')")
        self.assertEqual(len(self.dialogs), 1)
        self.assertEqual(self.db()["relations"], [])
        expect(self.page.locator('[data-upload="pase_frente"] .fname')).to_be_visible()
        self.submit()
        expect(self.page.locator("#successScreen")).to_be_visible()
        self.assertEqual(len(self.db()["persons"]), 1)
        self.assertEqual(len(self.db()["relations"]), 2)
        self.assertEqual(sum(d["tipo"] == "cert_bancaria" for d in self.db()["documents"]), 1)

    def test_mobile_and_double_submit_do_not_duplicate_records(self):
        self.fill_owner()
        self.fill_driver_extras()
        self.page.set_viewport_size({"width": 390, "height": 844})
        self.assertTrue(self.page.evaluate("document.documentElement.scrollWidth <= window.innerWidth"))
        self.assertEqual(self.page.locator('[data-field="foto_rostro"]').count(), 1)
        self.page.evaluate("""() => {
          __testDb.uploadDelay = 40;
          window.submitForm();
          window.submitForm();
        }""")
        expect(self.page.locator("#successScreen")).to_be_visible()
        self.assertEqual(sum(c["table"] == "personas" for c in self.db()["calls"]), 1)
        self.assertEqual(len(self.db()["relations"]), 2)


if __name__ == "__main__":
    unittest.main(verbosity=2)
