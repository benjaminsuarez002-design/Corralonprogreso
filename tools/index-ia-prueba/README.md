# Obri en Index

El 16/10/2026 el usuario eligio el nombre Obri y pidio reemplazar el Index oficial por la copia IA. Se copio index copia ia.html a index.html conservando la copia. La copia SQL/Cloudflare de respaldo no se modifico y su tarea de sincronizacion sigue deshabilitada.

## Edicion

El panel fuente es panel.js y el puente al catalogo se integra con node tools/index-ia-prueba/integrar.cjs. El integrador sigue escribiendo SOLO index copia ia.html: para futuros cambios oficiales revisar y promover explicitamente la copia. No asumir que integra tambien index.html.

## Funcionamiento

- Servicio separado corralon-index-ia-prueba, modelo @cf/meta/llama-3.3-70b-instruct-fp8-fast. /interpretar usa el historial; /responder redacta una introduccion sin repetir las tarjetas. No se cambio el plan contratado.
- Catalogo, carrito, editor y login conservan los servicios del Index anterior. La IA solo recibe consultas, hasta seis turnos y hasta cuatro nombres/detalles publicos. No recibe costos ni todo el catalogo.
- Dos resultados por respuesta general, ordenados por ranking real de ventas de ambas sucursales, desempate por unidades. Ver resultados similares abre el catalogo filtrado; sus coincidencias se conservan al recargar. Los enlaces abren el detalle en la misma pagina.
- Horarios: lectura actual de configuracion/horarios de Firestore, guardados desde Configuracion. No inventa horarios si faltan.
- Ceramicos: identifica modelos en toda la consulta, con o sin palabra ceramico. Reconoce m, mt, mts, m2, m², metros y multiplicaciones como 2 x 3 mt = 6 m², ademas de decimales con coma o punto. Primero filtra el modelo, color, calidad y medida; luego aplica ranking.
- Con metros, deja Ver presupuesto en el chat; el cliente lo abre al tocar. Usa el presupuestador existente con metros y adicionales pedidos precargados. Solo desde IA agrega foto ampliable con Tocá para ver, selector de modelos y presentacion compacta. El acceso manual conserva la presentacion habitual.
- Las cantidades de pegamento y pastina siguen los criterios estimados de la calculadora existente, con su advertencia de consumo/compatibilidad. Precios e importes se calculan en la pagina, sin inventarlos mediante IA.
- Cada pregunta de productos puede usar dos llamadas a Workers AI y consume cuota. Entrada de 700 caracteres; limite compartido de 12 solicitudes por IP/minuto. No prometer consumo ilimitado.
- El chat ubica la pregunta del usuario arriba al enviar; no salta al final cuando llega la respuesta.

Verificacion: node --test tests/index-ia-prueba.test.cjs. Enlaces locales: http://localhost:8080/index.html y http://localhost:8080/index%20copia%20ia.html . La promocion local no publica automaticamente el HTML del dominio.

Actualizacion: tras eliminarse la copia IA local, integrar.cjs trabaja directamente sobre index.html oficial. Las pruebas verifican este archivo.
