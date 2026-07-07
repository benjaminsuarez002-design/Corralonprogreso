# One Piece Player

Mini streaming privado para reproducir tus MP4 de Google Drive con progreso sincronizado en Firebase.

## Archivos

- `index.html`: app principal.
- `app.js`: reproductor, login del menu, Drive directo y progreso.
- `episodes.js`: catalogo generado desde `Mi unidad > COSAS > One pace`.
- `config.js`: claves publicas de Firebase.
- `config.example.js`: plantilla para copiar valores.

## Configuracion

El proyecto ya usa la misma configuracion Firebase del sistema `Corralon Progreso`.

El login usa la coleccion:

```text
menuUsuarios
```

y las mismas claves de sesion local:

```text
historial_keep_logged_v1
corralon_menu_active_user_v1
corralon_menu_active_user_snapshot_v1
```

## Firestore

La app guarda progreso en:

```text
onePieceProgreso/{userId}_{episodeId}
```

Cada documento guarda:

```json
{
  "episodeId": "drive-...",
  "driveFileId": "...",
  "title": "Syrup Village 01",
  "currentTime": 123,
  "duration": 1500,
  "percent": 8,
  "watched": false,
  "updatedAt": "serverTimestamp"
}
```

## Flujo de reproduccion

1. Elegis un capitulo.
2. La app intenta reproducir el MP4 directo desde Drive en `<video>`.
3. Guarda el progreso en Firebase mientras miras.
4. Al terminar, marca visto.

## Nota importante

Google Drive bloquea `fetch` desde el navegador por CORS, asi que la cache local y la precarga del siguiente capitulo no son posibles desde un HTML puro usando Drive como origen. Para tener cache/precarga hace falta un proxy propio o un hosting de video/archivo que envie CORS correcto.

Los navegadores de algunas Smart TV tienen limites agresivos de memoria y almacenamiento. Si una tele no descarga archivos grandes, proba desde Chrome/Edge en un Chromecast, Android TV, notebook o celular conectado por HDMI/cast.
