# Memoria del proyecto Corralon Progreso

Ultima actualizacion de estas notas: 2026-06-04.

Carpeta actual de trabajo usada en este chat:

`C:\Users\Administrador\Downloads\Corralonprogreso-main`

El usuario suele trabajar en modo ajuste rapido: si pide un cambio concreto, ir al codigo, modificar y cerrar con un resumen corto. Si dice que no funciono o pide revisar, ahi si investigar mas profundo.

## Regla importante

Hay dos carpetas que se usaron en distintos momentos:

- `C:\Users\Administrador\Downloads\Corralonprogreso-main`
- `C:\Users\Administrador\Documents\Corralonprogreso-main`

La carpeta activa al momento de crear estas notas es la de Descargas. La de Documentos no debe tocarse salvo pedido explicito. En un momento el usuario dijo que queria mover/reemplazar carpetas, por eso dejar estas notas dentro de la carpeta de trabajo.

## Local vs web

El sistema puede abrirse de dos formas:

- Web publica: `corralonprogreso.com`
- Local: `localhost`, `127.0.0.1`, `file://`, o IP LAN tipo `192.168...`

Para detectar local se usa algo asi:

```js
location.protocol === 'file:' ||
location.hostname === 'localhost' ||
location.hostname === '127.0.0.1' ||
/^192\.168\.|^10\.|^172\.(1[6-9]|2\d|3[0-1])\./.test(location.hostname)
```

## actualizar articulos

Archivo principal:

`C:\Users\Administrador\Downloads\Corralonprogreso-main\actualizar articulos.html`

Comportamiento actual:

- En web mantiene el comportamiento normal: exporta/descarga `Articulos.xls`.
- En local debe comportarse como la version que estaba en Documentos:
  - Al tocar `Exportar`, guarda el XLS mediante backend local en `C:\Update\Articulos.xls`.
  - Llama el protocolo `corralon-access-update://actualizar-precios`.
  - Luego publica/sincroniza la lista del proveedor.

Endpoints/protocolo esperados en local:

- `POST /save-articulos-xls`
- `corralon-access-update://actualizar-precios`

No tocar la carpeta de Documentos para este flujo salvo orden directa.

## listasproveedores / Comparar listas

Archivo:

`C:\Users\Administrador\Downloads\Corralonprogreso-main\listasproveedores.html`

El boton `Importar` debe descargar todas las listas de todos los proveedores, no solamente las ultimas actualizaciones.

Decision tomada:

- Hay dos manifests separados:
  - Manifest normal/parcial: prefijo `provider_manifest:`
  - Manifest completo: prefijo `provider_full_manifest:`
- El manifest normal queda para sincronizaciones parciales.
- El boton `Importar` debe usar solamente el manifest completo.
- Si no existe manifest completo, debe bajar la base completa desde Supabase como fallback.
- Si el manifest completo baja menos articulos que Supabase, tambien hace fallback a Supabase.

Campo usado para manifest completo:

- `lista_precios_meta.reserva_json_1`

Campo usado para manifest normal:

- `lista_precios_meta.archivo_nombre`

## JSON en Cloudinary

Los JSON de proveedores se suben a Cloudinary como archivos `raw`.

Flujo:

1. Se arma JSON por proveedor.
2. Se sube a Cloudinary.
3. Cloudinary devuelve URL publica.
4. Esa URL queda en un manifest.
5. El manifest queda referenciado desde Supabase.

Script para publicar todos los proveedores como JSON:

`C:\Users\Administrador\Downloads\Corralonprogreso-main\publish-provider-jsons.js`

Comando:

```powershell
node publish-provider-jsons.js
```

Ese script toma la lista completa desde Supabase, separa por proveedor, sube JSONs a Cloudinary y publica el manifest completo en `reserva_json_1`.

Importante:

- Los cambios de manifest completo aplican hacia adelante.
- Si todavia no se corrio `publish-provider-jsons.js`, puede no existir el manifest completo inicial.
- Despues de correrlo una vez, `Importar` puede traer todo desde JSON.

## corralon-system.js

Archivo:

`C:\Users\Administrador\Downloads\Corralonprogreso-main\corralon-system.js`

Contiene funciones compartidas del sistema, entre ellas:

- Supabase URL/key/tablas.
- Cache local de proveedores.
- Publicacion de JSON por proveedor.
- `replaceProviderArticles(...)`, usado por `actualizar articulos`.
- Funciones para faltantes/pedidos/catalogos.

Decision reciente:

- `replaceProviderArticles(...)` mantiene el manifest parcial normal.
- Si ya existe manifest completo, tambien lo mantiene actualizado en `reserva_json_1`.
- No se debe romper el manifest normal porque sirve para actualizaciones parciales.

## funciones.js

Archivo:

`C:\Users\Administrador\Downloads\Corralonprogreso-main\funciones.js`

Se fue usando como modulo comun para comportamientos tipo Access:

- Navegacion con flechas, Enter, Tab.
- F2 para seleccionar/deseleccionar texto.
- Listas desplegables que se abren al escribir.
- Enter selecciona primer resultado si corresponde.
- Escape cancela.
- Pegado/seleccion de tablas.
- Ajuste de ancho de columnas.
- Formato/parseo de fechas incompletas, tomando espacios como `/`.

Cuando el usuario diga “aplica funciones”, revisar si ya existe en este archivo antes de reimplementar localmente.

## pedidos

Archivo:

`C:\Users\Administrador\Downloads\Corralonprogreso-main\pedidos.html`

Puntos importantes:

- Los pedidos se sincronizan con Firebase.
- Al editar un pedido confirmado, los cambios se guardan como pendiente en Firebase, no pisan historial hasta confirmar.
- Si hay conflicto entre localStorage y Firebase, aparece popup:
  - Continuar con pedido local: sube local a Firebase.
  - Continuar con pedido sincronizado: Firebase pisa local.
- Si no hay internet, se puede perder trabajo si solo queda local y luego Firebase pisa. Por eso quedo idea del aviso de conflicto.
- Pedidos en revision generan notificaciones para administradores en `menu.html`.
- El boton `Generar Excel` requiere usuario administrador.
- El texto visible de proveedor debe mostrar solo nombre, no `ID - nombre`, pero internamente se sigue usando ID.

## menu

Archivo:

`C:\Users\Administrador\Downloads\Corralonprogreso-main\menu.html`

Tiene campana de notificaciones para administradores.

Unifica:

- Pedidos en revision.
- Notificaciones de historial:
  - Remitos.
  - Presupuestos.
  - Garantias.

Filtro vigente:

- Solo mostrar notificaciones desde 2026-06-04 en adelante.
- No mostrar historicas anteriores.

Comportamiento:

- Pedidos: al tocar notificacion abre popup del pedido en revision y borra la notificacion de la campana.
- Remitos: la notificacion debe permanecer hasta que el remito se imprima.
- Presupuestos y garantias: pueden borrarse al tocar la notificacion.

## historial

Archivo:

`C:\Users\Administrador\Downloads\Corralonprogreso-main\historial.html`

Se reemplazo/integro login viejo con validacion de usuario segun acceso de menu en su momento.

Notificaciones:

- Al imprimir remito desde historial, debe resolver/borrar notificacion asociada.
- Presupuestos web tienen botones para copiar IDArt y cantidades en columna para Access.
- En remitos hay barra de busqueda en la parte superior de la seccion.

## remitos

Archivo:

`C:\Users\Administrador\Downloads\Corralonprogreso-main\remitos.html`

Puntos importantes:

- Numero de remito debe autoasignarse segun remitos confirmados/historial.
- Formato con 8 digitos despues del guion, rellenando ceros a la izquierda.
- Verificacion rapida antes de confirmar para evitar duplicados si otra PC ya confirmo.
- Debe actualizarse en segundo plano si cambia el numero.
- Al guardar cambios en detalle, el detalle no debe cerrarse.
- Guardado debe sentirse instantaneo: cerrar edicion al toque, guardar/cachear local y sincronizar en segundo plano.
- En tabla, subtotal:
  - Si cantidad y precio estan llenos, subtotal se bloquea.
  - Si falta cantidad o precio, subtotal se habilita.
  - Subtotal solo calcula si el usuario escribe en subtotal.
  - Si cantidad y precio estan llenos, al apretar Tab/Enter en precio salta a cantidad de la siguiente fila; si falta algo, enfoca subtotal.

Notificaciones:

- Al confirmar/guardar remito, debe crear notificacion en Firebase.
- Al imprimir desde remitos o historial, debe borrar/resolver la notificacion.

## index

Archivo:

`C:\Users\Administrador\Downloads\Corralonprogreso-main\index.html`

Puntos importantes:

- Pantalla de inicio debe verse antes de los articulos. Se corrigio un problema donde al bajar aparecian articulos y desaparecia menu.
- Paleta ajustada al nuevo diseño argentino/celeste.
- En vista telefono, portada de destacados debe verse como tarjetas horizontales compactas, no carrusel grande.
- Despues de agregar al carrito:
  - En PC puede hacer foco en barra de busqueda.
  - En telefono no debe hacer foco para no abrir teclado.
- Listas desplegables deben abrirse solo cuando se empieza a escribir.
- En carrito hay boton para limpiar carrito al lado de la X.
- Popup detalle producto tiene boton compartir al lado de la X:
  - Copia link con `?articulo=CODIGO`.
  - En telefono abre opciones de compartir con `navigator.share` si existe.
- Si entra con `?articulo=...`, abre automaticamente el detalle.
- Cantidades en carrito deben aceptar decimales.

Presupuestar ceramico / pegamento:

- En ceramicos hay presupuesto de m2.
- Se agregaron switches para incluir pegamento y pastina.
- Rubro correcto de pegamentos: `PEGAMENTOS`.
- Pastina tiene IDArt `000353`.
- En presupuesto de pegamento, ocultar filas de pastina/ceramico que no correspondan.
- El calculo debe mostrar precio unitario con etiqueta y total ya calculado.

## comprobantes y caja

Archivos:

- `C:\Users\Administrador\Downloads\Corralonprogreso-main\comprobantes.html`
- `C:\Users\Administrador\Downloads\Corralonprogreso-main\caja.html`

Se agregaron tarjetas junto al titulo:

- Dolar oficial compra.
- Dolar oficial venta.
- Promedio.

Fuente:

- `dolarhoy.com`

Se actualiza al abrir la pagina. No se pidio tiempo real constante.

Comprobantes:

- Boton `Pegar de Access` no debe abrir automaticamente explorador para comprobante.
- Si campos estan vacios al pegar, hora debe actualizarse a la actual.
- Guardar comprobante no debe llevar a resumen; debe quedarse en carga y limpiar para nuevo comprobante.
- Boton `Ver` en alias abre popup resumen de movimientos:
  - Debe ser escrolleable.
  - Tarjetas no deben superponerse.
  - Debe tener filtro entre fechas.
  - Fechas incompletas: `21` = dia 21 mes/año actual; `21 4` = 21/04/año actual; `21 4 25` = 21/04/2025. Espacios cuentan como `/`. Campo vacio = no filtra.

## proveedores

Archivo:

`C:\Users\Administrador\Downloads\Corralonprogreso-main\proveedores.html`

Puntos importantes:

- Tabla debe sentirse tipo Access.
- Orden en headers tipo listas proveedores:
  - click orden asc/desc.
  - tercera vez quita orden.
- Se agrego ajuste de ancho de columnas tipo Access y se guardo en `funciones.js`.
- Fechas de actualizacion:
  - Verde si 0-30 dias.
  - Amarillo si 30-60 dias.
  - Rojo si mas de 60 dias.
- Campo pagina/link proveedor:
  - Se usa `pagina_link` y fallback `reserva_texto_1`.
  - Si Supabase no tiene columna `pagina_link`, guardar en `reserva_texto_1` para evitar error `PGRST204`.

## faltantes

Archivo:

`C:\Users\Administrador\Downloads\Corralonprogreso-main\faltantes.html`

Puntos importantes:

- Si se filtra lista de corralon, no debe filtrar por proveedor.
- Si selecciona articulo de lista corralon, debe usar ID proveedor de esa lista para buscar nombre equivalente en proveedores.
- Todos los articulos deberian tener ID proveedor.
- Se pidio que campo filtro tambien busque codigo de proveedor como en pedidos.
- Listas desplegables:
  - Al escribir, abre.
  - Enter selecciona primer resultado.
  - Suprimir + Enter no debe seleccionar nada.
  - Escape cancela.
  - Ctrl+Z deshace ultimo cambio.

## calculadoras

Archivo:

`C:\Users\Administrador\Downloads\Corralonprogreso-main\calculadoras.html`

Puntos importantes:

- Campo proveedor con lista desplegable estilo Access.
- Al elegir proveedor, se ocultan descuento 1/2/3 y se reemplazan por porcentaje de descuento, descuento adicional, flete, IVA, iva incluido.
- Descuento usado desde proveedor: descuento en factura.
- Boton `Ver proveedor` al lado de `Menu`; abre popup proveedor con lapiz para editar.
- Flechas izquierda/derecha dentro de inputs deben mover caret/cursor de texto, no navegar campos.
- Flecha arriba/abajo/Enter si navegan campos segun corresponda.
- F1 enfoca Total.
- Escape en campos cancela lo escrito.
- Punto del teclado numerico siempre debe interpretarse como decimal.
- Formatos:
  - Moneda para precios/totales.
  - Porcentaje para porcentajes.
  - Numeros comunes para dividido/por.
  - Pulgadas a mm soporta expresiones tipo `2 1/2 = 63,50 mm`.
- Calculador de netos:
  - Dos IVA predeterminados 10,5 y 21.
  - Si se escribe IVA, calcula neto.
  - Si se escribe neto, calcula IVA.
  - Separador de miles mientras se escribe, pero cuidar que no meta decimal automaticamente.

## facturas web / Access

Carpeta relacionada:

`C:\Users\Administrador\Downloads\Corralonprogreso-main\Fact Web`

Se intento integrar importacion directa a Access, pero Access se rompio y se decidio NO tocar Access automaticamente sin pedir.

Estado importante:

- Usuario descargo version anterior de Access.
- A partir de ahi, cuando haya que tocar Access, darle al usuario el modulo/codigo para que lo pegue.
- No editar Access directamente salvo pedido explicito.

Notas de Access:

- `FFacturasAFP`
- `FRecibosFS`
- `FRecibosXFS`
- El usuario pidio exportar Access a HTML de a poco.
- Campo `LClientes` queda combo/cliente.
- Campo `ApeYNom` en HTML debe ser texto editable con `CONSUMIDOR FINAL` predeterminado.

## servidor local / app

Se creo/uso un servidor local con interfaz.

Puntos importantes:

- Debe minimizarse a bandeja del sistema, al lado de red/sonido.
- Al minimizar o cerrar con X, debe ocultarse ahi, no quedar en barra de tareas.
- Al iniciar con Windows debe iniciar minimizado.
- Debe detectar si ya hay una instancia abierta para no duplicarse.
- Usar icono del index/logo.

El usuario pregunto como acceder desde otra PC:

- Si servidor corre en PC principal y IP es `192.168.100.28`, deberia ser:
  - `http://192.168.100.28:8080/menu.html`
  - o el HTML correspondiente.
- La otra PC no necesita Node si solo accede al servidor de la PC principal.
- Si cada PC usa localhost propio, cada una necesita servidor local o version instalada.

## autenticacion / usuarios

Se pidio centralizar validacion:

- Si no hay usuario: mandar a index.
- Si hay usuario pero no tiene acceso al HTML: mandar a menu.
- Historial tenia login propio; se pidio reemplazar por este sistema.
- Para nuevas paginas, ideal usar sistema centralizado tipo una linea con guardia de menu.

Importante:

- En web publica, no guardar contrasenas en HTML porque se ven con Ctrl+U.
- Las contrasenas/validacion admin deben ir a backend.
- En local se puede usar backend local, pero para web debe validar contra backend web.

## Firebase / Supabase / Cloudinary

Supabase:

- Tablas principales:
  - `proveedores`
  - `proveedores_meta`
  - `lista_precios`
  - `lista_precios_meta`

Firebase:

- Pedidos en tiempo real.
- Notificaciones de menu/historial.

Cloudinary:

- Guarda JSON raw de listas.
- Guarda manifests.

## Estilo de respuesta esperado

El usuario prefiere:

- Respuestas cortas.
- Confirmar que se cambio.
- No explicar demasiado salvo que pregunte.
- En modo rapido: modificar codigo directo.
- Si se termino, marcar archivo con ruta para abrir en default app si corresponde.

Cuando se referencien archivos en respuestas de Codex Desktop, usar rutas absolutas.


## 2026-06-04 - Manifest completo de listas proveedores
- La tabla `lista_precios_meta` no tiene columna `reserva_json_1`; el manifest completo se guarda en `importado_por` con prefijo `provider_full_manifest:`.
- URL actual del manifest completo: https://res.cloudinary.com/do0i2da7h/raw/upload/v1780587578/listas_proveedores/manifest_completo_1780587426936.json
- `corralon-system.js`: al exportar/subir proveedor actualiza el manifest parcial (`archivo_nombre`) y el completo (`importado_por`).
- `listasproveedores.html`: Importar usa el manifest completo, y Ver ultimas actualizaciones tambien lee el manifest completo filtrando ultimos 30 dias.
- `publish-provider-jsons.js`: el manifest completo se publica y se registra en `importado_por`.

## 2026-06-04 - Tabla Supabase para JSON por proveedor
- Se creo `public.listas_json_proveedores` para guardar una fila por proveedor con `json_url`, `chunks`, `total_articulos`, `version` y `fecha_actualizacion`.
- La tabla se poblo desde el manifest completo actual: 51 proveedores / 221.892 articulos.
- `corralon-system.js`: al exportar desde `actualizar articulos`, sea web o localhost, sube el JSON y actualiza `listas_json_proveedores` con upsert.
- `listasproveedores.html`: `Importar` y `Ultimas actualizaciones` usan primero `listas_json_proveedores`; el manifest queda como fallback.
- `publish-provider-jsons.js`: si se regenera el manifest masivo, tambien actualiza `listas_json_proveedores`.

## 2026-06-04 - Base IA comun
- Se creo `corralon-ai.js` y se incluyo en todos los HTML con `?v=20260604-base1`.
- La base expone `window.CorralonAI` con busqueda inteligente de articulos.
- Flujo: primero lee datos locales/cache (`IndexedDB` y `localStorage`); si no hay datos locales, consulta `listas_json_proveedores` en Supabase y descarga los JSON desde Cloudinary.
- Funcion principal para futuras pantallas: `CorralonAI.buscarArticulos(texto, { limit })`.
- Todavia no agrega UI por pantalla; queda lista para conectar en comparar listas, index, pedidos, faltantes, etc.

## 2026-06-04 - Chat IA en comparar listas
- `listasproveedores.html` tiene boton `IA` y panel `Asistente de listas`.
- Comandos soportados: filtrar/buscar similares y consultar mas barato.
- Usa `CorralonAI.buscarArticulos`, que primero busca local/cache y si no hay base local usa `listas_json_proveedores` + Cloudinary.
- Ejemplos: `filtrame abrazaderas`, `buscame similares a canilla fv`, `cual es el mas barato de cemento`.
- El mas barato se agrega a las tarjetas de comparacion.

## 2026-06-04 - API IA para listas proveedores
- `CorralonWebServer.cs` agrega endpoint `POST /api/ai/listas`.
- El endpoint usa OpenAI si encuentra `OPENAI_API_KEY` o el archivo local privado `openai-api-key.private.txt` junto al exe.
- `listasproveedores.html` intenta usar `/api/ai/listas` primero; si no hay endpoint/API key, vuelve al fallback local de `CorralonAI`.
- Se recompilo y reemplazo `CorralonWebServer.exe`.
## IA listas proveedores - 04/06/2026
- Localhost/file usa `http://localhost:8080/api/ai/listas`.
- En web usa Supabase Edge Function: `https://tizyjenayrcdkcodsjnc.supabase.co/functions/v1/ai-listas`.
- Funcion creada en `supabase/functions/ai-listas/index.ts`.
- Proveedor IA actual: Gemini `gemini-2.5-flash`.
- Local: configurar `gemini-api-key.private.txt` o variable `GEMINI_API_KEY`.
- Produccion: configurar secret `GEMINI_API_KEY` en Supabase y desplegar la funcion `ai-listas`.
