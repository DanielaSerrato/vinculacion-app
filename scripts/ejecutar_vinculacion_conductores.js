/*
 * Punto de entrada único para la vinculación de conductores.
 *
 * Modo seguro (solo revisa y prepara):
 *   node ejecutar_vinculacion_conductores.js
 *
 * Modo real (crea/actualiza datos base en Systram y los verifica):
 *   SYSTRAM_VINCULACION_APPLY=1 node ejecutar_vinculacion_conductores.js --apply
 *
 * Los anexos no se omiten: quedan identificados como "anexos_pendientes"
 * hasta que el adaptador de cada pestaña los cargue y los confirme. Así se
 * evita informar una vinculación completa cuando solo se creó la ficha.
 */
const { spawnSync } = require('child_process');
const path = require('path');

const ROOT = __dirname;
const APPLY = process.argv.includes('--apply');

function run(file, args = []) {
  const result = spawnSync(process.execPath, [path.join(ROOT, file), ...args], {
    cwd: ROOT,
    encoding: 'utf8',
    env: process.env,
  });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.status !== 0) process.exit(result.status || 1);
}

console.log('1/3 Validando información y soportes en Supabase…');
run('preparar_vinculacion_systram.js');

if (!APPLY) {
  console.log('2/3 Modo seguro finalizado: no se transmitió información a Systram.');
  console.log('3/3 Para ejecutar la ficha base use --apply junto con SYSTRAM_VINCULACION_APPLY=1.');
  process.exit(0);
}

console.log('2/3 Creando o actualizando la ficha base en Systram…');
run('sincronizar_conductores_systram.js', ['--apply']);
console.log('3/3 Proceso finalizado. Revise los casos en anexos_pendientes o requiere_revision.');
