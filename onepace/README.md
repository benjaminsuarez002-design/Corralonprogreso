# One Piece Player

Mini streaming privado para reproducir tus MP4 de Google Drive con cache local, precarga del siguiente capitulo y progreso sincronizado en Firebase.

## Archivos

- `index.html`: app principal.
- `app.js`: reproductor, login del menu, OAuth de Drive, cache local y progreso.
- `episodes.js`: catalogo inicial de respaldo.
- `config.js`: claves publicas de Firebase y Google OAuth Client ID.
- `config.example.js`: plantilla para copiar valores.

## Configuracion

El proyecto ya usa la misma configuracion Firebase del sistema `Corralon Progreso`.

Google Drive se autoriza con OAuth usando solo el Client ID publico. El secreto del cliente no se usa en el HTML.

La app lee automaticamente la carpeta de Drive configurada en `config.js`:

```js
drive: {
  folderId: "1N8awrcgHVDSajwKmHe7PLgGubTfdaQ7X"
}
```

Cuando Drive esta autorizado, sincroniza el catalogo al abrir y vuelve a revisar cada 60 segundos.

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
2. La app pide permiso de Drive si todavia no lo tiene.
3. Descarga el MP4 bruto con Google Drive API.
4. Guarda el video temporalmente en IndexedDB.
5. Reproduce con `<video>`.
6. Guarda el progreso exacto en Firebase cada 10 segundos, al pausar y al cerrar/cambiar de pestana.
7. Al terminar, marca visto y espera que toques `Siguiente`.
8. Al tocar `Siguiente`, borra el capitulo anterior de la cache y descarga el proximo.

La app baja un solo capitulo a la vez. No hace precarga automatica del siguiente.

Al abrir la app, si encuentra un capitulo empezado, lo selecciona automaticamente y lo carga si ya esta en cache o si el token de Drive sigue vigente.

El token de Drive se guarda localmente hasta que vence para evitar tener que autorizar en cada refresh.

## Nota importante

OAuth no funciona si abris el HTML con doble click como `file://`. Para probar localmente usa `http://127.0.0.1:4173/`.

Los navegadores de algunas Smart TV tienen limites agresivos de memoria y almacenamiento. Si una tele no descarga archivos grandes, proba desde Chrome/Edge en un Chromecast, Android TV, notebook o celular conectado por HDMI/cast.
