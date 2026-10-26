import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// RUNT API on Render
const RUNT_API = "https://api-licencia.onrender.com";
const RUNT_API_KEY = Deno.env.get("RUNT_API_KEY")!;

// OCR.space free API key
const OCR_SPACE_KEY = Deno.env.get("OCR_SPACE_KEY")!;

const MAX_OCR_RETRIES = 5;

const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// ─── OCR via OCR.space ───

async function ocrCaptcha(base64Image: string): Promise<string | null> {
  const imageData = base64Image.startsWith("data:")
    ? base64Image
    : `data:image/png;base64,${base64Image}`;

  const form = new FormData();
  form.append("base64Image", imageData);
  form.append("OCREngine", "2");
  form.append("isTable", "false");
  form.append("scale", "true");

  const res = await fetch("https://api.ocr.space/parse/image", {
    method: "POST",
    headers: { apikey: OCR_SPACE_KEY },
    body: form,
  });

  if (!res.ok) {
    console.warn(`OCR.space HTTP ${res.status}`);
    return null;
  }

  const data = await res.json();
  const parsed = data?.ParsedResults?.[0]?.ParsedText?.trim();
  if (!parsed) {
    console.warn("OCR.space: no text parsed");
    return null;
  }

  const clean = parsed.replace(/[^a-zA-Z0-9]/g, "");
  console.log(`OCR result: "${parsed}" -> clean: "${clean}"`);
  return clean || null;
}

// ─── RUNT Licencia flow ───

async function enrichLicencia(cedula: string, apellido: string): Promise<any> {
  const headers = {
    "X-API-Key": RUNT_API_KEY,
    "Content-Type": "application/json",
  };

  for (let i = 0; i < MAX_OCR_RETRIES; i++) {
    console.log(`Licencia attempt ${i + 1}/${MAX_OCR_RETRIES} for cedula ${cedula}, apellido "${apellido}"`);

    const captchaRes = await fetch(
      `${RUNT_API}/api/v1/licencia/captcha/${cedula}`,
      { headers: { "X-API-Key": RUNT_API_KEY } }
    );
    if (!captchaRes.ok) {
      console.warn(`Captcha endpoint failed: ${captchaRes.status}`);
      continue;
    }
    const captcha = await captchaRes.json();

    const texto = await ocrCaptcha(captcha.captcha_imagen);
    if (!texto) continue;

    const consultaRes = await fetch(`${RUNT_API}/api/v1/licencia/consultar`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        cedula,
        primer_apellido: apellido,
        captcha_texto: texto,
        captcha_id: captcha.captcha_id,
      }),
    });

    if (consultaRes.status === 400) {
      const err = await consultaRes.json().catch(() => null);
      console.warn(`Consultar rejected (400): ${JSON.stringify(err)}`);
      continue;
    }

    if (!consultaRes.ok) {
      console.warn(`Consultar HTTP ${consultaRes.status}`);
      continue;
    }

    const result = await consultaRes.json();
    console.log(`Consultar response: success=${result.success}, nombre=${result.nombre}, estado=${result.estado_conductor}`);
    if (result.success) {
      result.metodo = "edge_ocr_space";
      return result;
    }
    console.warn(`Consultar not success: ${result.error}`);
  }

  return { success: false, error: `OCR failed after ${MAX_OCR_RETRIES} attempts` };
}

async function saveLicencia(cedula: string, data: any) {
  const lic = data.licencias?.[0] || {};
  const cat = lic.categorias?.[0] || {};

  const row = {
    cedula,
    tipo_documento: data.tipo_documento || null,
    nombre: data.nombre || null,
    apellidos: data.apellidos || null,
    fecha_inscripcion: data.fecha_inscripcion || null,
    estado_conductor: data.estado_conductor || null,
    estado_persona: data.estado_persona || null,
    numero_licencia: lic.numero_licencia || null,
    organismo_transito: lic.organismo_transito || null,
    estado_licencia: lic.estado || null,
    restricciones: lic.restricciones || null,
    categoria: cat.categoria || null,
    fecha_expedicion_cat: cat.fecha_expedicion || null,
    fecha_vencimiento_cat: cat.fecha_vencimiento || null,
    licencias_json: data.licencias || [],
    metodo: data.metodo || "edge_ocr_space",
    success: data.success ?? false,
    error: data.error || null,
  };

  console.log(`Saving runt_licencias: cedula=${cedula}, nombre=${row.nombre}, estado=${row.estado_conductor}`);
  const { error } = await sb.from("runt_licencias").insert(row);
  if (error) console.error(`Insert runt_licencias failed: ${error.message}`);
  else console.log(`runt_licencias: saved for cedula ${cedula}`);
}

// ─── RUNT Vehiculo flow ───

async function enrichVehiculo(placa: string, cedula: string): Promise<any> {
  const headers = {
    "X-API-Key": RUNT_API_KEY,
    "Content-Type": "application/json",
  };

  for (let i = 0; i < MAX_OCR_RETRIES; i++) {
    console.log(`Vehiculo attempt ${i + 1}/${MAX_OCR_RETRIES} for placa ${placa}`);

    const captchaRes = await fetch(
      `${RUNT_API}/api/v1/vehiculo/captcha/${placa}`,
      { headers: { "X-API-Key": RUNT_API_KEY } }
    );
    if (!captchaRes.ok) {
      console.warn(`Vehiculo captcha failed: ${captchaRes.status}`);
      continue;
    }
    const captcha = await captchaRes.json();

    const texto = await ocrCaptcha(captcha.captcha_imagen);
    if (!texto) continue;

    const consultaRes = await fetch(`${RUNT_API}/api/v1/vehiculo/consultar`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        placa,
        cedula,
        captcha_texto: texto,
        captcha_id: captcha.captcha_id,
      }),
    });

    if (consultaRes.status === 400) {
      const err = await consultaRes.json().catch(() => null);
      console.warn(`Vehiculo consultar rejected: ${JSON.stringify(err)}`);
      continue;
    }

    if (!consultaRes.ok) {
      console.warn(`Vehiculo consultar HTTP ${consultaRes.status}`);
      continue;
    }

    const result = await consultaRes.json();
    console.log(`Vehiculo response: success=${result.success}, marca=${result.vehiculo?.marca}`);
    if (result.success) {
      result.metodo = "edge_ocr_space";
      return result;
    }
    console.warn(`Vehiculo consultar not success: ${result.error}`);
  }

  return { success: false, error: `OCR failed after ${MAX_OCR_RETRIES} attempts` };
}

async function saveVehiculo(placa: string, cedula: string, data: any) {
  const v = data.vehiculo || {};
  const soat0 = data.soat?.[0] || {};

  const row = {
    placa: placa.toUpperCase(),
    cedula,
    estado: v.estado || null,
    tipo_servicio: v.tipo_servicio || null,
    clase: v.clase || null,
    marca: v.marca || null,
    linea: v.linea || null,
    modelo: v.modelo || null,
    color: v.color || null,
    cilindraje: v.cilindraje || null,
    tipo_carroceria: v.tipo_carroceria || null,
    tipo_combustible: v.tipo_combustible || null,
    num_serie: v.num_serie || null,
    num_motor: v.num_motor || null,
    num_chasis: v.num_chasis || null,
    vin: v.vin || null,
    fecha_registro: v.fecha_registro || null,
    organismo_transito: v.organismo_transito || null,
    num_licencia_transito: v.num_licencia_transito || null,
    gravamenes: v.gravamenes || null,
    prendas: v.prendas || null,
    capacidad_carga: v.capacidad_carga || null,
    peso_bruto: v.peso_bruto || null,
    numero_ejes: v.numero_ejes || null,
    soat_poliza: soat0.numero_poliza || null,
    soat_aseguradora: soat0.aseguradora || null,
    soat_vencimiento: soat0.fecha_vencimiento || null,
    soat_estado: soat0.estado || null,
    datos_tecnicos_json: data.datos_tecnicos || null,
    vehiculo_json: data.vehiculo || null,
    soat_json: data.soat || null,
    metodo: data.metodo || "edge_ocr_space",
    success: data.success ?? false,
    error: data.error || null,
  };

  const { error } = await sb.from("runt_vehiculos").insert(row);
  if (error) console.error(`Insert runt_vehiculos failed: ${error.message}`);
  else console.log(`runt_vehiculos: saved for placa ${placa}`);
}

// ─── Main handler ───

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST",
        "Access-Control-Allow-Headers": "Content-Type, Authorization",
      },
    });
  }

  try {
    const body = await req.json();
    const { tabla, datos } = body;

    if (!tabla || !datos) {
      return new Response(JSON.stringify({ error: "Missing tabla or datos" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    console.log(`enrich-runt: tabla=${tabla}, datos keys: ${Object.keys(datos).join(",")}`);

    if (tabla === "conductores") {
      const cedula = datos.cedula;
      const apellido = datos.primer_apellido;

      if (!cedula || !apellido) {
        return new Response(
          JSON.stringify({ error: "Conductor missing cedula or primer_apellido" }),
          { status: 400, headers: { "Content-Type": "application/json" } }
        );
      }

      console.log(`Enriching licencia: cedula=${cedula}, primer_apellido="${apellido}"`);

      const result = await enrichLicencia(cedula, apellido);
      await saveLicencia(cedula, result);

      return new Response(
        JSON.stringify({ ok: true, tabla: "runt_licencias", success: result.success, apellido_usado: apellido }),
        { headers: { "Content-Type": "application/json" } }
      );
    }

    if (tabla === "vehiculos") {
      const placa = datos.placa;
      if (!placa) {
        return new Response(
          JSON.stringify({ error: "Vehiculo missing placa" }),
          { status: 400, headers: { "Content-Type": "application/json" } }
        );
      }

      const { data: prop } = await sb
        .from("propietarios")
        .select("cedula")
        .eq("vehiculo_placa", placa)
        .order("created_at", { ascending: false })
        .limit(1)
        .single();

      if (!prop?.cedula) {
        const { data: cond } = await sb
          .from("conductores")
          .select("cedula")
          .eq("vehiculo_placa", placa)
          .order("created_at", { ascending: false })
          .limit(1)
          .single();

        if (!cond?.cedula) {
          return new Response(
            JSON.stringify({ error: `No cedula found for placa ${placa}` }),
            { status: 400, headers: { "Content-Type": "application/json" } }
          );
        }

        const result = await enrichVehiculo(placa, cond.cedula);
        await saveVehiculo(placa, cond.cedula, result);

        return new Response(
          JSON.stringify({ ok: true, tabla: "runt_vehiculos", success: result.success }),
          { headers: { "Content-Type": "application/json" } }
        );
      }

      const result = await enrichVehiculo(placa, prop.cedula);
      await saveVehiculo(placa, prop.cedula, result);

      return new Response(
        JSON.stringify({ ok: true, tabla: "runt_vehiculos", success: result.success }),
        { headers: { "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({ ok: true, skipped: true, reason: `tabla ${tabla} not handled` }),
      { headers: { "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error(`enrich-runt error: ${(err as Error).message}`);
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
});
