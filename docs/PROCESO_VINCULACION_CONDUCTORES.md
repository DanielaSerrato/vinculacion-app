# Proceso de vinculación de conductores

El proceso trabaja por etapas y conserva el estado de cada conductor en Supabase.

1. El formulario recibe datos, fotografía, documentos y consentimientos.
2. La cédula y el pase se validan visualmente y se consolidan como PDF.
3. `preparar_vinculacion_systram.js` revisa datos obligatorios y deja evidencia de faltantes.
4. `sincronizar_conductores_systram.js` busca la cédula en Systram:
   - Si no existe, crea la ficha.
   - Si existe, abre su ficha y actualiza los datos base permitidos.
   - Relee cédula, nombres, apellidos, dirección y ciudad para comprobar el resultado.
5. La ficha queda en `anexos_pendientes` hasta cargar y verificar, en las pestañas de Systram, fotografía, teléfonos, referencias, emergencias, licencia y documentos.
6. Si una validación, actualización o verificación falla, queda en `requiere_revision`, con etapa, error, número de intento e historial.
7. Solo cuando todas las etapas estén verificadas debe cambiar a `sincronizado`.

## Ejecución

Revisión local y preparación de cola (sin cambiar Systram):

```powershell
node ejecutar_vinculacion_conductores.js
```

Ejecución real de la ficha base, después de confirmar la acción:

```powershell
$env:SYSTRAM_VINCULACION_APPLY = '1'
node ejecutar_vinculacion_conductores.js --apply
```

Antes de la ejecución real, `vinculacion.env` debe incluir `SUPABASE_URL` y `SUPABASE_SERVICE_ROLE_KEY`. La sesión de Systram debe estar iniciada en el perfil `.systram-browser-profile`.
