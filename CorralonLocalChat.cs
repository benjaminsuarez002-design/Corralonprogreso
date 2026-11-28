using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Net;
using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;
using System.Web.Script.Serialization;
using Microsoft.Win32;

internal sealed class LocalInvoiceChat
{
    private const int LegacyFileLimit = 10 * 1024 * 1024;
    private const int TransferBufferSize = 128 * 1024;
    private const string SessionCookie = "corralon_chat_privado";
    private const string MenuDocuments = "https://firestore.googleapis.com/v1/projects/corralon-progreso/databases/(default)/documents/menuUsuarios";
    private const string MenuFieldMask = "mask.fieldPaths=nombre&mask.fieldPaths=usuario&mask.fieldPaths=nivel&mask.fieldPaths=permisos";
    private readonly string directory;
    private readonly Func<string, string, string> verifyMenuSession;
    private readonly Func<Dictionary<string, string>> loadContacts;
    private readonly object identityGate = new object();
    private readonly object contactsGate = new object();
    private readonly Dictionary<string, Queue<DateTime>> attempts = new Dictionary<string, Queue<DateTime>>();
    private Dictionary<string, Account> accounts;
    private Dictionary<string, string> contacts = new Dictionary<string, string>();
    private DateTime contactsExpire;
    private readonly object gate = new object();
    private List<Message> messages;
    private long revision;
    private DateTime nextUploadCleanup;

    public sealed class Message
    {
        public long id { get; set; }
        public string usuario { get; set; }
        public string nombre { get; set; }
        public string remitente { get; set; }
        public string destinatario { get; set; }
        public string destinatarioNombre { get; set; }
        public string fecha { get; set; }
        public string texto { get; set; }
        public string archivo { get; set; }
        public string imagen { get; set; }
        public long bytes { get; set; }
        public string operacion { get; set; }
        public long revision { get; set; }
        public string leidoEn { get; set; }
        public long revisionLectura { get; set; }
        public bool importante { get; set; }
        public bool eliminado { get; set; }

        internal Message WithReceipt(string date, long nextRevision)
        {
            var updated = (Message)MemberwiseClone();
            updated.leidoEn = date;
            updated.revisionLectura = nextRevision;
            return updated;
        }
    }

    public sealed class Account
    {
        public string User { get; set; }
        public string Name { get; set; }
        public DateTime Expires { get; set; }
    }

    private sealed class ChatException : Exception
    {
        public readonly int Status;
        public ChatException(int status, string message) : base(message) { Status = status; }
    }

    internal LocalInvoiceChat(string storage, Func<string, string, string> verifySession = null, Func<Dictionary<string, string>> directoryLookup = null)
    {
        directory = storage;
        verifyMenuSession = verifySession ?? VerifyMenuSession;
        loadContacts = directoryLookup ?? ReadMenuContacts;
    }

    internal void Handle(HttpListenerContext context)
    {
        try
        {
            HttpListenerRequest request = context.Request;
            if (!IsPrivateRequest(request))
                throw new ChatException(403, "Chat disponible en la red privada del corralón.");
            string route = request.Url.AbsolutePath.ToLowerInvariant();
            string method = request.HttpMethod;
            if (route == "/api/chat/identidad" && method == "POST") { Login(context); return; }
            if (route == "/api/chat/salir" && method == "POST") { Logout(context); return; }
            if (route == "/api/chat/contactos" && method == "GET") { ListContacts(context); return; }
            if (route == "/api/chat/avisos" && method == "GET") { ListNotices(context); return; }
            if (route == "/api/chat/mensajes" && method == "GET") { ReadMessages(context); return; }
            if (route == "/api/chat/mensajes" && method == "POST") { SendMessage(context); return; }
            if (route == "/api/chat/mensajes/lectura" && method == "POST") { MarkRead(context); return; }
            if (route == "/api/chat/mensajes/accion" && method == "POST") { ChangeMessage(context); return; }
            if (route == "/api/chat/subir" && method == "POST") { UploadFile(context); return; }
            if (route == "/api/chat/archivo" && method == "GET") { ReadFile(context); return; }
            throw new ChatException(404, "Ruta de chat no disponible.");
        }
        catch (ChatException ex) { Reply(context, ex.Status, new { ok = false, error = ex.Message }); }
        catch (Exception) { Reply(context, 500, new { ok = false, error = "No se pudo completar la operación del chat. Reintentá." }); }
    }

    private static bool IsPrivateRequest(HttpListenerRequest request)
    {
        IPAddress peer = request.RemoteEndPoint == null ? null : request.RemoteEndPoint.Address;
        if (peer == null) return false;
        if (peer.IsIPv4MappedToIPv6) peer = peer.MapToIPv4();
        byte[] ip = peer.GetAddressBytes();
        bool allowed = IPAddress.IsLoopback(peer) || (ip.Length == 4 &&
            ((ip[0] == 192 && ip[1] == 168 && ip[2] == 100) || (ip[0] == 100 && ip[1] >= 64 && ip[1] <= 127)));
        string origin = request.Headers["Origin"];
        string site = request.Headers["Sec-Fetch-Site"];
        return allowed && (site == null || site == "none" || site == "same-origin") &&
            (origin == null || String.Equals(origin, request.Url.GetLeftPart(UriPartial.Authority), StringComparison.OrdinalIgnoreCase));
    }

    private static bool ValidUser(string id) { return id.Length > 0 && id.Length <= 150; }

    private Account CurrentAccount(HttpListenerRequest request)
    {
        string header = request.Headers["X-Chat-Usuario"];
        string expected = header == null ? request.QueryString["usuario"] ?? "" : Uri.UnescapeDataString(header);
        string token = request.Cookies[SessionCookie] == null ? "" : request.Cookies[SessionCookie].Value;
        if (!ValidUser(expected) || token.Length != 43) return null;
        lock (identityGate)
        {
            LoadAccounts();
            Account account;
            return accounts.TryGetValue(TokenKey(token), out account) && account.User == expected && account.Expires > DateTime.UtcNow ? account : null;
        }
    }

    private void Login(HttpListenerContext context)
    {
        var input = ReadJson(context.Request, 4096);
        string user = Field(input, "usuario"), menuToken = Field(input, "sesion");
        if (!ValidUser(user) || !Regex.IsMatch(menuToken, @"^[A-Za-z0-9_-]{43}$"))
            throw new ChatException(400, "No se encontró la sesión vigente del menú.");
        string address = context.Request.RemoteEndPoint.Address.ToString();
        DateTime now = DateTime.UtcNow;
        lock (identityGate)
        {
            foreach (string key in attempts.Where(item => now - item.Value.Last() >= TimeSpan.FromMinutes(2)).Select(item => item.Key).ToArray())
                attempts.Remove(key);
            Queue<DateTime> recent;
            if (!attempts.TryGetValue(address, out recent)) attempts[address] = recent = new Queue<DateTime>();
            while (recent.Count > 0 && now - recent.Peek() >= TimeSpan.FromMinutes(2)) recent.Dequeue();
            if (recent.Count >= 8) throw new ChatException(429, "El chat privado no pudo validar el ingreso. Reintentá en unos minutos.");
            recent.Enqueue(now);
        }
        string name = verifyMenuSession(user, menuToken);
        if (String.IsNullOrWhiteSpace(name)) throw new ChatException(401, "No se pudo confirmar la sesión vigente del menú.");
        byte[] secret = new byte[32];
        using (var random = RandomNumberGenerator.Create()) random.GetBytes(secret);
        string token = Convert.ToBase64String(secret).TrimEnd('=').Replace('+', '-').Replace('/', '_');
        TimeSpan duration = object.Equals(Value(input, "recordar"), true) ? TimeSpan.FromHours(12) : TimeSpan.FromHours(1);
        lock (identityGate)
        {
            LoadAccounts();
            var updated = accounts.Where(item => item.Value.Expires > now).ToDictionary(item => item.Key, item => item.Value);
            var previous = context.Request.Cookies[SessionCookie];
            if (previous != null) updated.Remove(TokenKey(previous.Value));
            updated[TokenKey(token)] = new Account { User = user, Name = name, Expires = now.Add(duration) };
            SaveAccounts(updated);
            attempts.Remove(address);
        }
        SetCookie(context, token, (long)duration.TotalSeconds);
        Reply(context, 200, new { ok = true });
    }

    private void Logout(HttpListenerContext context)
    {
        var cookie = context.Request.Cookies[SessionCookie];
        if (cookie != null)
        {
            lock (identityGate)
            {
                LoadAccounts();
                var updated = new Dictionary<string, Account>(accounts);
                if (updated.Remove(TokenKey(cookie.Value))) SaveAccounts(updated);
            }
        }
        SetCookie(context, "", 0);
        Reply(context, 200, new { ok = true });
    }

    private string AccountPath { get { return Path.Combine(directory, "privados.dat"); } }

    private void LoadAccounts()
    {
        if (accounts != null) return;
        accounts = File.Exists(AccountPath) ? Json().Deserialize<Dictionary<string, Account>>(File.ReadAllText(AccountPath, Encoding.UTF8))
            : new Dictionary<string, Account>();
    }

    private void SaveAccounts(Dictionary<string, Account> updated)
    {
        Directory.CreateDirectory(directory);
        string temp = AccountPath + ".tmp";
        File.WriteAllText(temp, Json().Serialize(updated), new UTF8Encoding(false));
        if (File.Exists(AccountPath)) File.Replace(temp, AccountPath, null);
        else File.Move(temp, AccountPath);
        accounts = updated;
    }

    private static string TokenKey(string token)
    {
        using (var sha = SHA256.Create()) return Convert.ToBase64String(sha.ComputeHash(Encoding.UTF8.GetBytes(token)));
    }

    private static void SetCookie(HttpListenerContext context, string token, long age)
    {
        context.Response.Headers.Add("Set-Cookie", SessionCookie + "=" + token + "; Path=/api/chat; HttpOnly; SameSite=Strict; Max-Age=" +
            age.ToString(System.Globalization.CultureInfo.InvariantCulture) + (context.Request.IsSecureConnection ? "; Secure" : ""));
    }

    private void ListContacts(HttpListenerContext context)
    {
        var account = CurrentAccount(context.Request);
        if (account == null) throw new ChatException(401, "No se pudo consultar la sesión del menú.");
        var result = Contacts().Where(item => item.Key != account.User).OrderBy(item => item.Value)
            .Select(item => new { id = item.Key, nombre = item.Value }).ToArray();
        Reply(context, 200, new { ok = true, contactos = result });
    }

    private Dictionary<string, string> Contacts()
    {
        lock (contactsGate)
        {
            if (DateTime.UtcNow < contactsExpire) return contacts;
            try { contacts = loadContacts(); }
            catch (ChatException) { if (contacts.Count == 0) throw; }
            contactsExpire = DateTime.UtcNow.AddMinutes(2);
            return contacts;
        }
    }

    private static string VerifyMenuSession(string id, string token)
    {
        const string endpoint = "https://tizyjenayrcdkcodsjnc.supabase.co/rest/v1/catalogo_editor_sesiones";
        string key;
        try
        {
            var protectedKey = Registry.GetValue(@"HKEY_CURRENT_USER\Software\CorralonProgreso\ChatMenu", "SessionReadKey", null) as string;
            if (String.IsNullOrEmpty(protectedKey)) throw new InvalidOperationException();
            key = Encoding.UTF8.GetString(ProtectedData.Unprotect(Convert.FromBase64String(protectedKey), null, DataProtectionScope.CurrentUser));
        }
        catch (Exception) { throw new ChatException(503, "El servidor no tiene disponible la verificación del menú."); }

        string hash;
        using (var sha = SHA256.Create())
            hash = BitConverter.ToString(sha.ComputeHash(Encoding.UTF8.GetBytes(token))).Replace("-", "").ToLowerInvariant();
        // El menú conserva sus sesiones hasta que se cierran. Algunos registros anteriores
        // todavía tienen una fecha de caducidad del editor de catálogo.
        ServicePointManager.SecurityProtocol |= SecurityProtocolType.Tls12;
        var request = (HttpWebRequest)WebRequest.Create(endpoint + "?select=user_id&limit=1&token_hash=eq." + hash);
        request.Headers["apikey"] = key;
        request.Headers[HttpRequestHeader.Authorization] = "Bearer " + key;
        request.Timeout = 5500;
        request.ReadWriteTimeout = 5500;
        try
        {
            using (var response = request.GetResponse())
            using (var reader = new StreamReader(response.GetResponseStream(), Encoding.UTF8))
            {
                var rows = Json().DeserializeObject(reader.ReadToEnd()) as object[];
                if (rows == null || rows.Length != 1 || Field(Object(rows[0]), "user_id") != id) return null;
            }
        }
        catch (WebException error)
        {
            if (error.Response != null) error.Response.Close();
            throw new ChatException(503, "No se pudo comprobar la sesión vigente del menú.");
        }
        var fields = Object(Value(MenuRequest(MenuDocuments + "/" + Uri.EscapeDataString(id) + "?" + MenuFieldMask), "fields"));
        return CanUseChat(fields) ? ContactName(fields, id) : null;
    }

    private static Dictionary<string, string> ReadMenuContacts()
    {
        var result = new Dictionary<string, string>();
        string next = "";
        do
        {
            string query = "?pageSize=200&" + MenuFieldMask + (next.Length == 0 ? "" : "&pageToken=" + Uri.EscapeDataString(next));
            var page = MenuRequest(MenuDocuments + query);
            var docs = Value(page, "documents") as System.Collections.IEnumerable ?? new object[0];
            foreach (var entry in docs)
            {
                var doc = Object(entry);
                string path = Field(doc, "name");
                string id = path.Substring(path.LastIndexOf('/') + 1);
                var fields = Object(Value(doc, "fields"));
                if (ValidUser(id) && CanUseChat(fields)) result[id] = ContactName(fields, id);
            }
            next = Field(page, "nextPageToken");
        } while (next.Length > 0);
        return result;
    }

    private static Dictionary<string, object> MenuRequest(string url)
    {
        var request = (HttpWebRequest)WebRequest.Create(url);
        request.Timeout = 5500;
        request.ReadWriteTimeout = 5500;
        try
        {
            using (var response = request.GetResponse())
            using (var reader = new StreamReader(response.GetResponseStream(), Encoding.UTF8))
                return Object(Json().DeserializeObject(reader.ReadToEnd()));
        }
        catch (WebException error)
        {
            var response = error.Response as HttpWebResponse;
            bool missing = response != null && response.StatusCode == HttpStatusCode.NotFound;
            if (response != null) response.Close();
            if (missing) return new Dictionary<string, object>();
            throw new ChatException(503, "No se pudo consultar el acceso de los usuarios del menú.");
        }
    }

    private static string MenuField(Dictionary<string, object> fields, string name) { return Field(Object(Value(fields, name)), "stringValue"); }

    private static string ContactName(Dictionary<string, object> fields, string id)
    {
        string name = MenuField(fields, "nombre").Trim();
        if (name.Length == 0) name = MenuField(fields, "usuario").Trim();
        return name.Length > 0 ? name : id;
    }

    private static bool CanUseChat(Dictionary<string, object> fields)
    {
        string level = MenuField(fields, "nivel").Trim().ToLowerInvariant();
        if (level == "administrador") return true;
        if (level == "vendedor") return false;
        var list = Object(Value(Object(Value(fields, "permisos")), "arrayValue"));
        var entries = Value(list, "values") as System.Collections.IEnumerable ?? new object[0];
        return entries.Cast<object>().Any(entry => Field(Object(entry), "stringValue") == "facturacion");
    }

    private static bool CanRead(Message message, Account account)
    {
        return String.IsNullOrEmpty(message.destinatario) || (account != null && (account.User == message.remitente || account.User == message.destinatario));
    }

    private void LoadMessages()
    {
        if (messages != null) return;
        Directory.CreateDirectory(directory);
        var loaded = new List<Message>();
        foreach (string path in Directory.GetFiles(directory, "*.json"))
        {
            try
            {
                var item = Json().Deserialize<Message>(File.ReadAllText(path, Encoding.UTF8));
                if (item != null && item.id > 0) loaded.Add(item);
            }
            catch (ArgumentException) { }
            catch (InvalidOperationException) { }
        }
        messages = loaded.OrderBy(item => item.id).ToList();
        revision = messages.Count == 0 ? 0 : messages.Max(item => Math.Max(item.id, ChangeRevision(item)));
    }

    private static long ChangeRevision(Message item) { return Math.Max(item.revision, item.revisionLectura); }

    private void ListNotices(HttpListenerContext context)
    {
        var account = CurrentAccount(context.Request);
        if (account == null) throw new ChatException(401, "Se requiere la sesión del menú.");
        string workstation = context.Request.QueryString["puesto"] ?? "";
        object result;
        lock (gate)
        {
            LoadMessages();
            result = messages.Where(item => item.importante && !item.eliminado && CanRead(item, account) &&
                (String.IsNullOrEmpty(item.destinatario) ? item.usuario != workstation : item.destinatario == account.User))
                .OrderByDescending(item => item.revision).Select(item => new { item.id, item.revision, item.nombre,
                    chat = String.IsNullOrEmpty(item.destinatario) ? "" : item.remitente }).ToArray();
        }
        Reply(context, 200, new { ok = true, avisos = result });
    }

    private void ReadMessages(HttpListenerContext context)
    {
        long after, lastRevision;
        var query = context.Request.QueryString;
        var account = CurrentAccount(context.Request);
        string identity = account == null ? "" : account.User;
        bool accountChanged = (query["cuenta"] ?? "") != identity;
        Message[] result;
        lock (gate)
        {
            LoadMessages();
            lastRevision = revision;
            if (!accountChanged && Int64.TryParse(query["cambio"], out after) && after >= 0)
            {
                result = after == revision ? new Message[0] : messages.Where(item => ChangeRevision(item) > after && CanRead(item, account)).OrderBy(ChangeRevision).Take(100).ToArray();
                if (result.Length == 100) lastRevision = ChangeRevision(result[result.Length - 1]);
            }
            else if (Int64.TryParse(query["despues"], out after))
            {
                int start = messages.FindLastIndex(item => item.id <= after) + 1;
                result = messages.Skip(start).Where(item => !item.eliminado && CanRead(item, account)).Take(100).ToArray();
            }
            else
            {
                var visible = messages.Where(item => !item.eliminado && CanRead(item, account));
                result = visible.GroupBy(item => String.IsNullOrEmpty(item.destinatario) ? "" :
                    (item.remitente == identity ? item.destinatario : item.remitente))
                    .SelectMany(thread => thread.Reverse().Take(100).Union(thread.Where(item => item.importante)))
                    .OrderBy(item => item.id).ToArray();
            }
        }
        Reply(context, 200, new { ok = true, mensajes = result, revision = lastRevision, identidad = identity });
    }

    private string UploadDirectory { get { return Path.Combine(directory, "subidas"); } }

    private void UploadFile(HttpListenerContext context)
    {
        var request = context.Request;
        if (!String.Equals(request.ContentType, "application/octet-stream", StringComparison.OrdinalIgnoreCase))
            throw new ChatException(415, "El archivo requiere una transferencia binaria.");
        long expected = request.ContentLength64;
        if (expected < 0) throw new ChatException(411, "No se pudo determinar el tamaño del archivo.");
        if (expected == 0) throw new ChatException(400, "El archivo está vacío.");
        Directory.CreateDirectory(UploadDirectory);
        CleanStagedUploads();
        var drive = new DriveInfo(Path.GetPathRoot(Path.GetFullPath(UploadDirectory)));
        if (expected > drive.AvailableFreeSpace) throw new ChatException(507, "El servidor no tiene espacio suficiente para este archivo.");
        string id = Guid.NewGuid().ToString("N");
        string uploaded = Path.Combine(UploadDirectory, id + ".bin");
        string incomplete = uploaded + ".part";
        try
        {
            using (var stream = new FileStream(incomplete, FileMode.CreateNew, FileAccess.Write, FileShare.None, TransferBufferSize, FileOptions.SequentialScan))
            {
                request.InputStream.CopyTo(stream, TransferBufferSize);
                if (stream.Length != expected) throw new ChatException(400, "La transferencia quedó incompleta. Volvé a intentar.");
            }
            File.Move(incomplete, uploaded);
        }
        finally { File.Delete(incomplete); }
        Reply(context, 200, new { ok = true, subida = id });
    }

    private void CleanStagedUploads()
    {
        lock (gate)
        {
            DateTime now = DateTime.UtcNow;
            if (now < nextUploadCleanup) return;
            nextUploadCleanup = now.AddHours(1);
            foreach (string path in Directory.EnumerateFiles(UploadDirectory))
            {
                try { if (File.GetLastWriteTimeUtc(path) < now.AddDays(-1)) File.Delete(path); }
                catch (IOException) { }
                catch (UnauthorizedAccessException) { }
            }
        }
    }

    private void SendMessage(HttpListenerContext context)
    {
        var input = ReadJson(context.Request, 15 * 1024 * 1024);
        string sender = Field(input, "puesto");
        string displayName = Field(input, "nombre").Trim();
        string recipient = Field(input, "destinatario").Trim(), recipientName = "", author = "";
        if (recipient.Length > 0)
        {
            var account = CurrentAccount(context.Request);
            if (account == null) throw new ChatException(401, "No se pudo consultar la sesión del menú.");
            if (!ValidUser(recipient) || recipient == account.User || !Contacts().TryGetValue(recipient, out recipientName))
                throw new ChatException(400, "El destinatario no está disponible.");
            author = account.User;displayName = account.Name;
        }
        string address = context.Request.RemoteEndPoint.Address.ToString();
        if (!Regex.IsMatch(sender, @"^[A-Za-z0-9-]{12,64}$")) sender = address;
        if (displayName.Length == 0) displayName = "Puesto " + address;
        if (displayName.Length > 80) displayName = displayName.Substring(0, 80);
        string operation = Field(input, "operacion");
        if (!Regex.IsMatch(operation, @"^[A-Za-z0-9-]{12,64}$")) throw new ChatException(400, "El mensaje no es válido.");
        string text = Field(input, "texto").Trim();
        string name = Field(input, "archivo").Trim(), encoded = Field(input, "contenido"), upload = Field(input, "subida");
        if (text.Length > 4000) throw new ChatException(400, "El mensaje puede tener hasta 4000 caracteres.");
        byte[] attachment = null;
        if (encoded.Length > 0)
        {
            if (encoded.Length > ((LegacyFileLimit + 2) / 3) * 4) throw new ChatException(413, "El archivo supera los 10 MB.");
            try { attachment = Convert.FromBase64String(encoded); }
            catch (FormatException) { throw new ChatException(400, "No se pudo leer el archivo adjunto."); }
            if (attachment.Length > LegacyFileLimit) throw new ChatException(413, "El archivo supera los 10 MB.");
            if (attachment.Length == 0) throw new ChatException(400, "El archivo adjunto está vacío.");
        }
        string stagedPath = null;
        if (!String.IsNullOrEmpty(upload))
        {
            Guid id;
            if (attachment != null || !Guid.TryParseExact(upload, "N", out id)) throw new ChatException(400, "La referencia del archivo no es válida.");
            stagedPath = Path.Combine(UploadDirectory, id.ToString("N") + ".bin");
        }
        if (stagedPath != null || attachment != null)
        {
            name = Regex.Replace(name, @"[\x00-\x1F\x7F/\\]", "_");
            if (name.Length == 0 || name.Length > 255) throw new ChatException(400, "El nombre del archivo no es válido.");
        }
        else name = "";
        if (text.Length == 0 && name.Length == 0) throw new ChatException(400, "Escribí un mensaje o adjuntá un archivo.");
        Message message;
        lock (gate)
        {
            LoadMessages();
            message = messages.LastOrDefault(item => item.usuario == sender && item.operacion == operation &&
                (item.destinatario ?? "") == recipient && (item.remitente ?? "") == author);
            if (message == null)
            {
                long fileSize = attachment == null ? 0 : attachment.LongLength;
                byte[] signature = attachment;
                if (stagedPath != null)
                {
                    if (!File.Exists(stagedPath)) throw new ChatException(404, "La transferencia ya no está disponible. Volvé a adjuntar el archivo.");
                    using (var stream = File.OpenRead(stagedPath))
                    {
                        fileSize = stream.Length;
                        signature = new byte[(int)Math.Min(fileSize, 12)];
                        int offset = 0;
                        while (offset < signature.Length)
                        {
                            int count = stream.Read(signature, offset, signature.Length - offset);
                            if (count == 0) break;
                            offset += count;
                        }
                    }
                }
                var item = new Message
                {
                    id = messages.Count == 0 ? 1 : messages[messages.Count - 1].id + 1,
                    usuario = sender, nombre = displayName, fecha = DateTime.UtcNow.ToString("o"),
                    remitente = author, destinatario = recipient, destinatarioNombre = recipientName,
                    texto = text, archivo = name, imagen = ImageType(signature), bytes = fileSize,
                    operacion = operation, revision = revision + 1
                };
                string contents = ItemPath(item.id, ".bin");
                if (stagedPath != null) File.Move(stagedPath, contents);
                else if (attachment != null) File.WriteAllBytes(contents, attachment);
                try
                {
                    WriteMessage(item, false);
                }
                catch
                {
                    if (stagedPath != null) File.Move(contents, stagedPath);
                    else if (attachment != null) File.Delete(contents);
                    throw;
                }
                messages.Add(item);
                revision = item.revision;
                message = item;
            }
        }
        Reply(context, 200, new { ok = true, mensaje = message });
    }

    private void WriteMessage(Message item, bool replacing)
    {
        string metadata = ItemPath(item.id, ".json"), temp = metadata + ".tmp";
        File.WriteAllText(temp, Json().Serialize(item), new UTF8Encoding(false));
        if (replacing) File.Replace(temp, metadata, null);
        else File.Move(temp, metadata);
    }

    private void MarkRead(HttpListenerContext context)
    {
        var account = CurrentAccount(context.Request);
        if (account == null) throw new ChatException(401, "Se requiere la sesión del menú.");
        var input = ReadJson(context.Request, 4096);
        var ids = Value(input, "ids") as object[];
        if (ids == null || ids.Length == 0 || ids.Length > 100)
            throw new ChatException(400, "La lista de mensajes no es válida.");
        var wanted = new HashSet<long>();
        foreach (object value in ids)
        {
            long id;
            if (!Int64.TryParse(Convert.ToString(value), out id) || id <= 0)
                throw new ChatException(400, "El mensaje no es válido.");
            wanted.Add(id);
        }
        lock (gate)
        {
            LoadMessages();
            string date = DateTime.UtcNow.ToString("o");
            for (int i = 0; i < messages.Count; i++)
            {
                var item = messages[i];
                if (item.destinatario != account.User || item.eliminado || !String.IsNullOrEmpty(item.leidoEn) ||
                    !wanted.Contains(item.id)) continue;
                var updated = item.WithReceipt(date, revision + 1);
                WriteMessage(updated, true);
                messages[i] = updated;
                revision = updated.revisionLectura;
            }
        }
        Reply(context, 200, new { ok = true });
    }

    private void ChangeMessage(HttpListenerContext context)
    {
        var input = ReadJson(context.Request, 4096);
        string action = Field(input, "accion"), sender = Field(input, "puesto");
        var account = CurrentAccount(context.Request);
        long id;
        if (!Int64.TryParse(Convert.ToString(Value(input, "id")), out id) || id <= 0 ||
            (action != "importante" && action != "eliminar"))
            throw new ChatException(400, "La acción del mensaje no es válida.");
        lock (gate)
        {
            LoadMessages();
            int index = messages.FindIndex(item => item.id == id);
            if (index < 0) throw new ChatException(404, "El mensaje ya no está disponible.");
            var old = messages[index];
            if (!CanRead(old, account)) throw new ChatException(404, "El mensaje ya no está disponible.");
            bool own = String.IsNullOrEmpty(old.destinatario) ? !String.IsNullOrEmpty(sender) && old.usuario == sender
                : account != null && old.remitente == account.User;
            if (!own)
                throw new ChatException(403, "Solo podés cambiar los mensajes que enviaste.");
            bool deleting = action == "eliminar";
            if (!old.eliminado && (deleting || !old.importante))
            {
                var updated = new Message
                {
                    id = old.id, usuario = old.usuario, nombre = old.nombre, fecha = old.fecha, operacion = old.operacion,
                    remitente = old.remitente, destinatario = old.destinatario, destinatarioNombre = old.destinatarioNombre,
                    leidoEn = old.leidoEn, revisionLectura = old.revisionLectura,
                    revision = revision + 1, importante = !deleting, eliminado = deleting,
                    texto = deleting ? "" : old.texto, archivo = deleting ? "" : old.archivo,
                    imagen = deleting ? "" : old.imagen, bytes = deleting ? 0 : old.bytes
                };
                WriteMessage(updated, true);
                messages[index] = updated;
                revision = updated.revision;
                if (deleting && old.bytes > 0)
                {
                    try { File.Delete(ItemPath(id, ".bin")); }
                    catch (IOException) { }
                    catch (UnauthorizedAccessException) { }
                }
            }
        }
        Reply(context, 200, new { ok = true });
    }

    private void ReadFile(HttpListenerContext context)
    {
        long id;
        if (!Int64.TryParse(context.Request.QueryString["id"], out id) || id <= 0)
            throw new ChatException(404, "Archivo no encontrado.");
        Message item;
        var account = CurrentAccount(context.Request);
        lock (gate)
        {
            LoadMessages();
            item = messages.FirstOrDefault(message => message.id == id && !message.eliminado && message.bytes > 0 && CanRead(message, account));
        }
        string path = ItemPath(id, ".bin");
        if (item == null || !File.Exists(path)) throw new ChatException(404, "Archivo no encontrado.");
        bool preview = context.Request.QueryString["imagen"] == "1" && !String.IsNullOrEmpty(item.imagen);
        var response = context.Response;
        response.ContentType = preview ? item.imagen : "application/octet-stream";
        response.Headers["X-Content-Type-Options"] = "nosniff";
        response.Headers["Cache-Control"] = "no-store";
        response.Headers["Content-Disposition"] = preview ? "inline" :
            "attachment; filename=\"archivo-adjunto\"; filename*=UTF-8''" + Uri.EscapeDataString(item.archivo);
        FileStream download;
        try { download = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.Read | FileShare.Delete); }
        catch (FileNotFoundException) { throw new ChatException(404, "Archivo no encontrado."); }
        using (download)
        {
            response.ContentLength64 = download.Length;
            download.CopyTo(response.OutputStream);
        }
    }

    private string ItemPath(long id, string extension) { return Path.Combine(directory, id.ToString(System.Globalization.CultureInfo.InvariantCulture) + extension); }

    private static string ImageType(byte[] bytes)
    {
        if (bytes == null || bytes.Length < 12) return "";
        if (bytes[0] == 137 && Encoding.ASCII.GetString(bytes, 1, 3) == "PNG" && bytes[4] == 13 && bytes[5] == 10 && bytes[6] == 26 && bytes[7] == 10) return "image/png";
        if (bytes[0] == 255 && bytes[1] == 216 && bytes[2] == 255) return "image/jpeg";
        string signature = Encoding.ASCII.GetString(bytes, 0, 6);
        if (signature == "GIF87a" || signature == "GIF89a") return "image/gif";
        if (Encoding.ASCII.GetString(bytes, 0, 4) == "RIFF" && Encoding.ASCII.GetString(bytes, 8, 4) == "WEBP") return "image/webp";
        return "";
    }

    private static Dictionary<string, object> ReadJson(HttpListenerRequest request, int limit)
    {
        if (request.ContentType == null || request.ContentType.Split(';')[0].Trim().ToLowerInvariant() != "application/json")
            throw new ChatException(415, "El chat requiere una solicitud JSON.");
        if (request.ContentLength64 > limit) throw new ChatException(413, "La solicitud es demasiado grande.");
        using (var buffer = new MemoryStream())
        {
            byte[] chunk = new byte[8192];
            int count;
            while ((count = request.InputStream.Read(chunk, 0, chunk.Length)) > 0)
            {
                if (buffer.Length + count > limit) throw new ChatException(413, "La solicitud es demasiado grande.");
                buffer.Write(chunk, 0, count);
            }
            try { return Object(Json().DeserializeObject(Encoding.UTF8.GetString(buffer.ToArray()))); }
            catch (ArgumentException) { throw new ChatException(400, "La solicitud no es válida."); }
            catch (InvalidOperationException) { throw new ChatException(400, "La solicitud no es válida."); }
        }
    }

    private static void Reply(HttpListenerContext context, int status, object data)
    {
        byte[] body = Encoding.UTF8.GetBytes(Json().Serialize(data));
        context.Response.StatusCode = status;
        context.Response.ContentType = "application/json; charset=utf-8";
        context.Response.Headers["Cache-Control"] = "no-store";
        context.Response.Headers["X-Content-Type-Options"] = "nosniff";
        context.Response.ContentLength64 = body.Length;
        context.Response.OutputStream.Write(body, 0, body.Length);
    }

    private static JavaScriptSerializer Json() { return new JavaScriptSerializer { MaxJsonLength = 16 * 1024 * 1024 }; }
    private static Dictionary<string, object> Object(object data) { return data as Dictionary<string, object> ?? new Dictionary<string, object>(); }
    private static object Value(Dictionary<string, object> fields, string key) { object value; return fields.TryGetValue(key, out value) ? value : null; }
    private static string Field(Dictionary<string, object> fields, string key) { return Value(fields, key) as string ?? ""; }
}

