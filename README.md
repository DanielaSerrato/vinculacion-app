# Vinculación — Capital Cargo Colombia

Formularios web para vinculación de conductores, propietarios y vehículos. Los datos alimentan el pipeline de enriquecimiento RUNT y la creación de hojas de vida en Systram.

**Producción:** https://vinculacion-app.vercel.app  
**Admin:** https://vinculacion-app.vercel.app/admin.html

---

## Flujo

```
Conductor/Propietario recibe link por WhatsApp
  │
  └─► Llena formulario (datos + documentos)
        │
        ├─► Archivos suben a Supabase Storage (vinculacion-docs)
        ├─► Datos se insertan en tabla conductores/propietarios/vehiculos
        │
        └─► Trigger automático:
              ├─► Edge Function enrich-runt → consulta RUNT → guarda en runt_licencias
              └─► Edge Function sync-sharepoint → sincroniza Excel
```

---

## Stack

- **Frontend:** HTML self-contained (CSS + JS inline, sin framework)
- **Backend:** Supabase (PostgreSQL + Storage + Edge Functions)
- **Deploy:** Vercel (static hosting)
- **RUNT API:** api-licencia en Render (proxy al RUNT)
- **OCR:** OCR.space (resuelve captchas RUNT desde Edge Function)

---

## Páginas

| Archivo           | Descripción                                    |
|-------------------|------------------------------------------------|
| `index.html`      | Página principal — selección de formulario     |
| `conductor.html`  | Formulario de datos del conductor              |
| `propietario.html`| Formulario de datos del propietario            |
| `vehiculo.html`   | Formulario de datos del vehículo               |
| `trailer.html`    | Formulario de datos del trailer                |
| `admin.html`      | Panel admin — ver registros y estado (password) |

---

## Supabase

- **Proyecto:** kidvrjpelcyjrvonpimf (sa-east-1)
- **Storage:** bucket `vinculacion-docs` (10MB max por archivo)
- **RLS:** anon puede insertar registros y subir archivos

### Tablas principales

| Tabla            | Descripción                                         |
|------------------|-----------------------------------------------------|
| `conductores`    | Datos personales, docs, banking, referencias        |
| `propietarios`   | Datos personales, docs, banking                     |
| `vehiculos`      | Placa, tipo, docs, satelital                        |
| `trailers`       | Placa trailer, docs                                 |
| `runt_licencias` | Resultado enriquecimiento RUNT (licencias)          |
| `runt_vehiculos` | Resultado enriquecimiento RUNT (vehículos)          |
| `simit_multas`   | Resultado consulta SIMIT                            |

### Edge Functions

| Función        | Trigger                          | Descripción                              |
|----------------|----------------------------------|------------------------------------------|
| `enrich-runt`  | INSERT en conductores/vehiculos  | Consulta RUNT vía OCR.space + API Render |
| `sync-sharepoint` | INSERT en conductores/propietarios | Sincroniza datos a Excel SharePoint   |

---

## Deploy

```bash
cd vinculacion-app
npx vercel deploy --prod
```

---

## Admin

Panel en `/admin.html`. Password: consultar con gerencia.

Muestra:
- Todos los registros de conductores, propietarios, vehículos
- Estado de enriquecimiento RUNT (success/fail, datos de licencia)
- Documentos subidos (links a Storage)
- Licencias vencidas resaltadas
