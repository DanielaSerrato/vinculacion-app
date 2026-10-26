# Procesos operativos

Estos scripts se ejecutan desde un computador o servidor con Node.js, una sesión activa de Chrome para Systram y las variables de entorno de Supabase.

## Preparar la cola

```powershell
node scripts/preparar_vinculacion_systram.js
```

Genera la cola de conductores que cumplen las validaciones y deja el resultado en `outputs/vinculacion_systram/`.

## Sincronizar con Systram

```powershell
node scripts/sincronizar_conductores_systram.js
```

Este proceso requiere una sesión iniciada en Systram y el perfil de Chrome configurado por el proyecto.

## Variables requeridas

```text
SUPABASE_URL
SUPABASE_SERVICE_ROLE_KEY
```

No subir nunca archivos `.env`, claves `service_role`, contraseñas de Systram ni perfiles de navegador al repositorio.
