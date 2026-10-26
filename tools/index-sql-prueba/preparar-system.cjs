const fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'../..');
let source=fs.readFileSync(path.join(root,'corralon-system.js'),'utf8');
function replace(before,after){if(!source.includes(before))throw Error('Cambió el punto de integración: '+before.slice(0,80));source=source.replace(before,after);}
// Reutilizar el editor, cálculos y ventanas exactos del original. Solo cambiar sus datos.
replace("    async function fetchBudgets(queryText, fromDate = '', toDate = '') {","    async function fetchBudgets(queryText, fromDate = '', toDate = '') {\n      return window.IndexSqlApi.searchBudgets(queryText,fromDate,toDate);\n      /* recorrido oficial deshabilitado en esta copia */");
// Aislar las cachés internas del sistema que podrían usarse desde el editor.
for(const key of ['corralon_catalogo_articulos_v1','corralon_index_lista_articulos_cache_v1','corralon_image_generator_catalog_v1','corralon_image_generator_payload_v1','corralon_cache_grande_v1','corralon_catalogo_editor_session_v1','corralon_catalogo_editor_session_temp_v1','corralon_aridos_config_v1','corralon_aridos_freight_v1'])source=source.split("'"+key+"'").join("'"+key+"_sql_prueba'");
replace("  if (!globalThis.CORRALON_DISABLE_CATALOG_REALTIME) CATALOG_REALTIME.start();","  if (!globalThis.CORRALON_DISABLE_CATALOG_REALTIME) CATALOG_REALTIME.start();");
fs.writeFileSync(path.join(root,'corralon-system-sql-prueba.js'),'// Copia de integración generada por preparar-system.cjs; no editar el sistema oficial.\n'+source);
console.log('Sistema compartido de prueba preparado.');
