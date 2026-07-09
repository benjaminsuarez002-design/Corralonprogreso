using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Net;
using System.Security.Cryptography;
using System.Text;
using System.Threading;
using System.Windows.Forms;
using Microsoft.Win32;

internal static class Program
{
    [STAThread]
    private static void Main(string[] args)
    {
        bool created;
        using (new Mutex(true, "CorralonWebServerLocal8080", out created))
        {
            if (!created)
            {
                MessageBox.Show("El servidor de Corralon ya esta abierto.", "Corralon Web");
                return;
            }

            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            Application.Run(new ServerForm(ShouldStartInTray(args)));
        }
    }

    private static bool ShouldStartInTray(string[] args)
    {
        foreach (string arg in args)
        {
            if (string.Equals(arg, "--tray", StringComparison.OrdinalIgnoreCase) || string.Equals(arg, "/tray", StringComparison.OrdinalIgnoreCase)) return true;
        }
        return false;
    }
}

internal sealed class ServerForm : Form
{
    private const int Port = 8080;
    private readonly string root;
    private HttpListener listener;
    private Thread listenThread;
    private Label status;
    private TextBox urlBox;
    private Button startStopButton;
    private CheckBox startWithWindows;
    private NotifyIcon trayIcon;
    private bool exiting;

    public ServerForm(bool startInTray)
    {
        root = AppDomain.CurrentDomain.BaseDirectory.TrimEnd(Path.DirectorySeparatorChar);
        Text = "Corralon Web";
        Width = 440;
        Height = 220;
        FormBorderStyle = FormBorderStyle.FixedDialog;
        MaximizeBox = false;
        StartPosition = FormStartPosition.CenterScreen;
        string iconPath = Path.Combine(root, "icono-corralon-Photoroom.ico");
        if (File.Exists(iconPath)) Icon = new Icon(iconPath);
        BuildUi();
        BuildTrayIcon();
        StartServer();
        if (startInTray) Shown += (s, e) => HideToTray();
    }

    private void BuildUi()
    {
        var title = new Label { Text = "Servidor local Corralon", Left = 18, Top = 16, Width = 380, Font = new Font("Segoe UI", 12, FontStyle.Bold) };
        status = new Label { Text = "Estado: detenido", Left = 18, Top = 48, Width = 380, Font = new Font("Segoe UI", 9) };
        urlBox = new TextBox { Left = 18, Top = 76, Width = 390, ReadOnly = true, Text = "http://localhost:8080/actualizar%20articulos.html" };
        startWithWindows = new CheckBox { Text = "Iniciar con Windows", Left = 18, Top = 108, Width = 200, Checked = IsStartWithWindowsEnabled() };
        var openButton = new Button { Text = "Abrir HTML", Left = 18, Top = 112, Width = 110 };
        openButton.Top = 140;
        startStopButton = new Button { Text = "Detener", Left = 138, Top = 140, Width = 110 };
        var hideButton = new Button { Text = "Minimizar", Left = 258, Top = 140, Width = 110 };

        openButton.Click += (s, e) => Process.Start(urlBox.Text);
        startStopButton.Click += (s, e) => { if (listener != null && listener.IsListening) StopServer(); else StartServer(); };
        hideButton.Click += (s, e) => HideToTray();
        startWithWindows.CheckedChanged += (s, e) => SetStartWithWindows(startWithWindows.Checked);

        Controls.Add(title);
        Controls.Add(status);
        Controls.Add(urlBox);
        Controls.Add(startWithWindows);
        Controls.Add(openButton);
        Controls.Add(startStopButton);
        Controls.Add(hideButton);
    }

    private void BuildTrayIcon()
    {
        trayIcon = new NotifyIcon();
        trayIcon.Text = "Corralon Web";
        trayIcon.Icon = Icon;
        trayIcon.Visible = true;
        var menu = new ContextMenuStrip();
        menu.Items.Add("Abrir", null, (s, e) => ShowFromTray());
        menu.Items.Add("Abrir HTML", null, (s, e) => Process.Start(urlBox.Text));
        menu.Items.Add("Abrir Facturas Web", null, (s, e) => Process.Start("http://localhost:8080/facturas"));
        menu.Items.Add("Salir", null, (s, e) => { exiting = true; Close(); });
        trayIcon.ContextMenuStrip = menu;
        trayIcon.DoubleClick += (s, e) => ShowFromTray();
    }

    private void HideToTray()
    {
        Hide();
        ShowInTaskbar = false;
    }

    private void ShowFromTray()
    {
        Show();
        ShowInTaskbar = true;
        WindowState = FormWindowState.Normal;
        Activate();
    }

    private static bool IsStartWithWindowsEnabled()
    {
        using (var key = Registry.CurrentUser.OpenSubKey(@"Software\Microsoft\Windows\CurrentVersion\Run", false))
        {
            string value = key == null ? null : key.GetValue("Corralon Web") as string;
            return !string.IsNullOrWhiteSpace(value) && value.IndexOf("CorralonWebServer.exe", StringComparison.OrdinalIgnoreCase) >= 0;
        }
    }

    private void SetStartWithWindows(bool enabled)
    {
        using (var key = Registry.CurrentUser.OpenSubKey(@"Software\Microsoft\Windows\CurrentVersion\Run", true))
        {
            if (key == null) return;
            if (enabled) key.SetValue("Corralon Web", "\"" + Application.ExecutablePath + "\" --tray");
            else key.DeleteValue("Corralon Web", false);
        }
    }

    private void StartServer()
    {
        try
        {
            listener = new HttpListener();
            listener.Prefixes.Add("http://+:" + Port + "/");
            listener.Start();
            listenThread = new Thread(Listen) { IsBackground = true };
            listenThread.Start();
            status.Text = "Estado: activo en http://localhost:8080/ y red local";
            startStopButton.Text = "Detener";
        }
        catch (Exception ex)
        {
            status.Text = "Estado: error al iniciar";
            Log(ex.ToString());
            MessageBox.Show(ex.Message, "No pude iniciar el servidor");
        }
    }

    private void StopServer()
    {
        try { listener.Stop(); } catch { }
        try { listener.Close(); } catch { }
        listener = null;
        status.Text = "Estado: detenido";
        startStopButton.Text = "Iniciar";
    }

    private void Listen()
    {
        while (listener != null && listener.IsListening)
        {
            try
            {
                var context = listener.GetContext();
                ThreadPool.QueueUserWorkItem(_ => Serve(context));
            }
            catch
            {
                if (listener == null || !listener.IsListening) return;
            }
        }
    }

    private void Serve(HttpListenerContext context)
    {
        try
        {
            string requestPath = Uri.UnescapeDataString(context.Request.Url.AbsolutePath.TrimStart('/'));
            if (string.Equals(requestPath, "updates/manifest.json", StringComparison.OrdinalIgnoreCase))
            {
                WriteJson(context, 200, BuildUpdateManifest());
                return;
            }
            if (requestPath.StartsWith("api/", StringComparison.OrdinalIgnoreCase))
            {
                HandleFacturasApi(context);
                return;
            }
            if (string.Equals(requestPath, "auth-users.private.json", StringComparison.OrdinalIgnoreCase))
            {
                WriteText(context, 404, "404");
                return;
            }
            if (string.Equals(requestPath, "save-articulos-xls", StringComparison.OrdinalIgnoreCase) && string.Equals(context.Request.HttpMethod, "POST", StringComparison.OrdinalIgnoreCase))
            {
                SaveArticulosXls(context);
                return;
            }
            string fullPath = ResolveStaticFile(requestPath);
            string rootFull = Path.GetFullPath(root);
            string factPublicFull = Path.GetFullPath(Path.Combine(root, "Fact Web", "public"));

            if ((!fullPath.StartsWith(rootFull, StringComparison.OrdinalIgnoreCase) && !fullPath.StartsWith(factPublicFull, StringComparison.OrdinalIgnoreCase)) || !File.Exists(fullPath))
            {
                WriteText(context, 404, "404");
                return;
            }

            byte[] bytes;
            if (String.Equals(Path.GetExtension(fullPath), ".html", StringComparison.OrdinalIgnoreCase))
            {
                string html = File.ReadAllText(fullPath, Encoding.UTF8);
                html = InjectUpdateWidget(html);
                html = InjectArticleSharePreview(html, context.Request, fullPath);
                bytes = Encoding.UTF8.GetBytes(html);
            }
            else
            {
                bytes = File.ReadAllBytes(fullPath);
            }
            context.Response.StatusCode = 200;
            context.Response.ContentType = ContentType(Path.GetExtension(fullPath));
            context.Response.ContentLength64 = bytes.Length;
            context.Response.OutputStream.Write(bytes, 0, bytes.Length);
        }
        catch (Exception ex)
        {
            Log(ex.ToString());
            try { WriteText(context, 500, "500"); } catch { }
        }
        finally
        {
            try { context.Response.OutputStream.Close(); } catch { }
        }
    }

    private string ResolveStaticFile(string requestPath)
    {
        string normalized = String.IsNullOrWhiteSpace(requestPath) ? "menu.html" : requestPath;
        normalized = normalized.TrimStart('/').Replace('/', Path.DirectorySeparatorChar);
        string factPublic = Path.Combine(root, "Fact Web", "public");
        if (String.Equals(normalized, "facturas", StringComparison.OrdinalIgnoreCase) || String.Equals(normalized, "facturas.html", StringComparison.OrdinalIgnoreCase))
        {
            return Path.GetFullPath(Path.Combine(factPublic, "facturas.html"));
        }
        string factFile = Path.GetFullPath(Path.Combine(factPublic, normalized));
        if (factFile.StartsWith(Path.GetFullPath(factPublic), StringComparison.OrdinalIgnoreCase) && File.Exists(factFile))
        {
            return factFile;
        }
        return Path.GetFullPath(Path.Combine(root, normalized));
    }

    private void HandleFacturasApi(HttpListenerContext context)
    {
        try
        {
            string path = context.Request.Url.AbsolutePath;
            string method = context.Request.HttpMethod;
            if (method == "OPTIONS")
            {
                WriteJson(context, 204, "");
                return;
            }
            if (method == "GET" && path == "/api/bootstrap")
            {
                WriteJson(context, 200, RunFactDb("bootstrap", "{}"));
                return;
            }
            if (method == "GET" && path == "/api/search/clientes")
            {
                WriteJson(context, 200, RunFactDb("clientes", "{\"q\":\"" + JsonEscape(context.Request.QueryString["q"] ?? "") + "\"}"));
                return;
            }
            if (method == "GET" && path == "/api/search/articulos")
            {
                WriteJson(context, 200, RunFactDb("articulos", "{\"q\":\"" + JsonEscape(context.Request.QueryString["q"] ?? "") + "\"}"));
                return;
            }
            if (method == "GET" && path == "/api/cache/clientes")
            {
                WriteJson(context, 200, RunFactDb("cacheClientes", "{}"));
                return;
            }
            if (method == "GET" && path == "/api/cache/articulos")
            {
                WriteJson(context, 200, RunFactDb("cacheArticulos", "{}"));
                return;
            }
            if (method == "GET" && path == "/api/articulo-detalle")
            {
                string idArt = JsonEscape(context.Request.QueryString["idArt"] ?? "");
                int idLista = ParseInt(context.Request.QueryString["idLista"]);
                string cantidad = JsonEscape(context.Request.QueryString["cantidad"] ?? "1");
                WriteJson(context, 200, RunFactDb("articuloDetalle", "{\"idArt\":\"" + idArt + "\",\"idLista\":" + idLista + ",\"cantidad\":\"" + cantidad + "\"}"));
                return;
            }
            if (method == "GET" && path == "/api/next-number")
            {
                int idComprob = ParseInt(context.Request.QueryString["idComprob"]);
                int idDeposito = ParseInt(context.Request.QueryString["idDeposito"]);
                WriteJson(context, 200, RunFactDb("nextNumber", "{\"idComprob\":" + idComprob + ",\"idDeposito\":" + idDeposito + "}"));
                return;
            }
            if (method == "POST" && path == "/api/drafts")
            {
                WriteJson(context, 200, SaveFactDraft(ReadRequestBody(context)));
                return;
            }
            if (method == "POST" && path == "/api/import-access")
            {
                WriteJson(context, 200, SaveFactAccessPending(ReadRequestBody(context)));
                return;
            }
            if (method == "GET" && path == "/api/update/check")
            {
                WriteJson(context, 200, CheckForUpdates());
                return;
            }
            if (method == "POST" && path == "/api/update/apply")
            {
                WriteJson(context, 200, ApplyUpdates());
                return;
            }
            if (method == "POST" && path == "/api/auth/admin")
            {
                WriteJson(context, 200, ValidateAdminPassword(ReadRequestBody(context)));
                return;
            }
            if (method == "POST" && path == "/api/auth/login")
            {
                WriteJson(context, 200, ValidateLogin(ReadRequestBody(context)));
                return;
            }
            if (method == "POST" && path == "/api/ai/listas")
            {
                WriteJson(context, 200, AiListas(ReadRequestBody(context)));
                return;
            }
            WriteJson(context, 404, "{\"error\":\"API no encontrada\"}");
        }
        catch (Exception ex)
        {
            WriteJson(context, 500, "{\"error\":\"" + JsonEscape(ex.Message) + "\"}");
        }
    }

    private string AuthFilePath()
    {
        string file = Path.Combine(root, "auth-users.private.json");
        if (!File.Exists(file))
        {
            File.WriteAllText(file, "{\"users\":[{\"id\":\"admin\",\"nombre\":\"Administrador\",\"usuario\":\"admin\",\"password\":\"Akashiya2301\",\"nivel\":\"administrador\"},{\"id\":\"vendedor\",\"nombre\":\"Vendedor\",\"usuario\":\"vendedor\",\"password\":\"1234\",\"nivel\":\"vendedor\"}]}", Encoding.UTF8);
        }
        return file;
    }

    private string ValidateAdminPassword(string body)
    {
        string pass = ExtractJsonString(body, "password");
        bool ok = false;
        foreach (var user in ReadAuthUsers())
        {
            if (String.Equals(user.Nivel, "administrador", StringComparison.OrdinalIgnoreCase) && String.Equals(user.Password, pass, StringComparison.Ordinal))
            {
                ok = true;
                break;
            }
        }
        return "{\"ok\":" + (ok ? "true" : "false") + "}";
    }

    private string ValidateLogin(string body)
    {
        string usuario = ExtractJsonString(body, "usuario").Trim().ToLowerInvariant();
        string pass = ExtractJsonString(body, "password");
        foreach (var user in ReadAuthUsers())
        {
            if ((String.Equals(user.Usuario.Trim().ToLowerInvariant(), usuario, StringComparison.OrdinalIgnoreCase) || String.Equals(user.Nombre.Trim().ToLowerInvariant(), usuario, StringComparison.OrdinalIgnoreCase)) && String.Equals(user.Password, pass, StringComparison.Ordinal))
            {
                return "{\"ok\":true,\"user\":{\"id\":\"" + JsonEscape(user.Id) + "\",\"nombre\":\"" + JsonEscape(user.Nombre) + "\",\"usuario\":\"" + JsonEscape(user.Usuario) + "\",\"nivel\":\"" + JsonEscape(user.Nivel) + "\"}}";
            }
        }
        return "{\"ok\":false}";
    }

    private sealed class AuthUser
    {
        public string Id = "";
        public string Nombre = "";
        public string Usuario = "";
        public string Password = "";
        public string Nivel = "";
    }

    private List<AuthUser> ReadAuthUsers()
    {
        string json = File.ReadAllText(AuthFilePath(), Encoding.UTF8);
        var list = new List<AuthUser>();
        var rx = new System.Text.RegularExpressions.Regex("\\{[^{}]*\\\"password\\\"\\s*:\\s*\\\"(?<password>(?:\\\\.|[^\\\"])*)\\\"[^{}]*\\}");
        foreach (System.Text.RegularExpressions.Match m in rx.Matches(json))
        {
            string obj = m.Value;
            list.Add(new AuthUser
            {
                Id = ExtractJsonString(obj, "id"),
                Nombre = ExtractJsonString(obj, "nombre"),
                Usuario = ExtractJsonString(obj, "usuario"),
                Password = JsonUnescape(m.Groups["password"].Value),
                Nivel = ExtractJsonString(obj, "nivel")
            });
        }
        return list;
    }

    private static string ExtractJsonString(string json, string key)
    {
        var rx = new System.Text.RegularExpressions.Regex("\\\"" + System.Text.RegularExpressions.Regex.Escape(key) + "\\\"\\s*:\\s*\\\"(?<value>(?:\\\\.|[^\\\"])*)\\\"");
        var m = rx.Match(json ?? "");
        return m.Success ? JsonUnescape(m.Groups["value"].Value) : "";
    }

    private string GeminiKey()
    {
        string file = Path.Combine(root, "gemini-api-key.private.txt");
        if (File.Exists(file)) return File.ReadAllText(file, Encoding.UTF8).Trim();
        string key = Environment.GetEnvironmentVariable("GEMINI_API_KEY") ?? "";
        if (!String.IsNullOrWhiteSpace(key)) return key.Trim();
        return "";
    }

    private string AiListas(string body)
    {
        string key = GeminiKey();
        if (String.IsNullOrWhiteSpace(key))
        {
            return "{\"ok\":false,\"fallback\":true,\"error\":\"IA no configurada. Crea gemini-api-key.private.txt o define GEMINI_API_KEY.\"}";
        }

        string prompt = ExtractJsonString(body, "prompt");
        string context = ExtractJsonString(body, "context");
        string candidates = ExtractJsonArrayRaw(body, "candidates");
        if (String.IsNullOrWhiteSpace(prompt)) return "{\"ok\":false,\"error\":\"Prompt vacio\"}";
        if (String.IsNullOrWhiteSpace(candidates)) candidates = "[]";

        string instruction =
            "Sos un asistente de compras de un corralon. Conversa natural en espanol rioplatense. " +
            "Usa solamente los candidatos que te paso para responder sobre articulos/precios. " +
            "Si el usuario pide filtrar, responde con intent filter y una query corta. " +
            "Si pide el mas barato, elegi el menor precio_costo entre candidatos utiles. " +
            "Si pide similares, lista hasta 5 opciones. " +
            "Devolve SOLO JSON valido con: reply, intent, query, selectedId. " +
            "intent puede ser chat, search, filter, cheapest.";

        string input =
            "Contexto previo: " + context + "\n" +
            "Mensaje usuario: " + prompt + "\n" +
            "Candidatos JSON: " + candidates;

        string requestJson =
            "{" +
            "\"system_instruction\":{\"parts\":[{\"text\":\"" + JsonEscape(instruction) + "\"}]}," +
            "\"contents\":[" +
              "{\"role\":\"user\",\"parts\":[{\"text\":\"" + JsonEscape(input) + "\"}]}" +
            "]," +
            "\"generationConfig\":{\"temperature\":0.2}" +
            "}";

        try
        {
            ServicePointManager.SecurityProtocol = SecurityProtocolType.Tls12;
            var request = (HttpWebRequest)WebRequest.Create("https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent");
            request.Method = "POST";
            request.ContentType = "application/json; charset=utf-8";
            request.Headers["x-goog-api-key"] = key;
            byte[] bytes = Encoding.UTF8.GetBytes(requestJson);
            request.ContentLength = bytes.Length;
            using (var stream = request.GetRequestStream()) stream.Write(bytes, 0, bytes.Length);
            using (var response = (HttpWebResponse)request.GetResponse())
            using (var reader = new StreamReader(response.GetResponseStream(), Encoding.UTF8))
            {
                string raw = reader.ReadToEnd();
                string text = ExtractGeminiText(raw);
                string json = ExtractJsonObject(text);
                if (String.IsNullOrWhiteSpace(json)) json = "{\"reply\":\"" + JsonEscape(text) + "\",\"intent\":\"chat\",\"query\":\"\",\"selectedId\":\"\"}";
                return "{\"ok\":true,\"result\":" + json + "}";
            }
        }
        catch (WebException ex)
        {
            string error = ex.Message;
            try
            {
                using (var reader = new StreamReader(ex.Response.GetResponseStream(), Encoding.UTF8)) error = reader.ReadToEnd();
            }
            catch { }
            Log("AI error: " + error);
            return "{\"ok\":false,\"fallback\":true,\"error\":\"" + JsonEscape(error) + "\"}";
        }
        catch (Exception ex)
        {
            Log("AI error: " + ex);
            return "{\"ok\":false,\"fallback\":true,\"error\":\"" + JsonEscape(ex.Message) + "\"}";
        }
    }

    private static string ExtractJsonArrayRaw(string json, string key)
    {
        string marker = "\"" + key + "\"";
        int keyIndex = (json ?? "").IndexOf(marker, StringComparison.OrdinalIgnoreCase);
        if (keyIndex < 0) return "";
        int colon = json.IndexOf(':', keyIndex + marker.Length);
        if (colon < 0) return "";
        int start = json.IndexOf('[', colon + 1);
        if (start < 0) return "";
        int depth = 0;
        bool inString = false;
        bool escape = false;
        for (int i = start; i < json.Length; i++)
        {
            char c = json[i];
            if (escape) { escape = false; continue; }
            if (c == '\\' && inString) { escape = true; continue; }
            if (c == '"') { inString = !inString; continue; }
            if (inString) continue;
            if (c == '[') depth++;
            else if (c == ']')
            {
                depth--;
                if (depth == 0) return json.Substring(start, i - start + 1);
            }
        }
        return "";
    }

    private static string ExtractGeminiText(string raw)
    {
        var matches = System.Text.RegularExpressions.Regex.Matches(raw ?? "", "\\\"text\\\"\\s*:\\s*\\\"(?<value>(?:\\\\.|[^\\\"])*)\\\"");
        var sb = new StringBuilder();
        foreach (System.Text.RegularExpressions.Match match in matches)
        {
            string value = JsonUnescape(match.Groups["value"].Value);
            if (!String.IsNullOrWhiteSpace(value)) sb.Append(value);
        }
        return sb.ToString();
    }

    private static string ExtractJsonObject(string text)
    {
        if (String.IsNullOrWhiteSpace(text)) return "";
        int start = text.IndexOf('{');
        int end = text.LastIndexOf('}');
        if (start < 0 || end <= start) return "";
        return text.Substring(start, end - start + 1);
    }

    private string GetUpdateSource()
    {
        string file = Path.Combine(root, "update-source.txt");
        if (!File.Exists(file)) return "";
        return File.ReadAllText(file, Encoding.UTF8).Trim().TrimEnd('/');
    }

    private static string NormalizeUpdatePath(string path)
    {
        return (path ?? "").Replace("\\", "/").TrimStart('/');
    }

    private string BuildUpdateManifest()
    {
        var files = new List<string>();
        AddUpdateFiles(files, root, "");
        string factPublic = Path.Combine(root, "Fact Web", "public");
        if (Directory.Exists(factPublic)) AddUpdateFiles(files, factPublic, "Fact Web/public");

        var sb = new StringBuilder();
        sb.Append("{\"version\":\"").Append(JsonEscape(DateTime.UtcNow.ToString("yyyyMMddHHmmss"))).Append("\",\"files\":[");
        bool first = true;
        foreach (string rel in files)
        {
            string full = Path.Combine(root, rel.Replace('/', Path.DirectorySeparatorChar));
            if (!File.Exists(full)) continue;
            if (!first) sb.Append(',');
            first = false;
            var info = new FileInfo(full);
            sb.Append("{\"path\":\"").Append(JsonEscape(rel)).Append("\",\"hash\":\"").Append(FileHash(full)).Append("\",\"size\":").Append(info.Length).Append("}");
        }
        sb.Append("]}");
        return sb.ToString();
    }

    private void AddUpdateFiles(List<string> files, string baseDir, string prefix)
    {
        if (!Directory.Exists(baseDir)) return;
        foreach (string file in Directory.GetFiles(baseDir, "*.*", SearchOption.TopDirectoryOnly))
        {
            string name = Path.GetFileName(file);
            string ext = Path.GetExtension(file).ToLowerInvariant();
            if (name.EndsWith(".log", StringComparison.OrdinalIgnoreCase)) continue;
            if (String.Equals(name, "CorralonWebServer.exe", StringComparison.OrdinalIgnoreCase)) continue;
            if (String.Equals(name, "CorralonWebServer.cs", StringComparison.OrdinalIgnoreCase)) continue;
            if (String.Equals(name, "update-source.txt", StringComparison.OrdinalIgnoreCase)) continue;
            if (String.Equals(name, "auth-users.private.json", StringComparison.OrdinalIgnoreCase)) continue;
            if (ext != ".html" && ext != ".js" && ext != ".css" && ext != ".json" && ext != ".ico" && ext != ".png" && ext != ".jpg" && ext != ".jpeg") continue;
            string rel = String.IsNullOrWhiteSpace(prefix) ? name : (prefix.TrimEnd('/') + "/" + name);
            files.Add(NormalizeUpdatePath(rel));
        }
    }

    private static string FileHash(string file)
    {
        using (var sha = SHA256.Create())
        using (var stream = File.OpenRead(file))
        {
            byte[] hash = sha.ComputeHash(stream);
            var sb = new StringBuilder(hash.Length * 2);
            foreach (byte b in hash) sb.Append(b.ToString("x2"));
            return sb.ToString();
        }
    }

    private string CheckForUpdates()
    {
        string source = GetUpdateSource();
        if (String.IsNullOrWhiteSpace(source)) return "{\"ok\":true,\"updates\":0,\"files\":[],\"message\":\"Sin fuente de actualizacion\"}";
        string remote = DownloadText(source + "/updates/manifest.json");
        var remoteFiles = ParseManifestFiles(remote);
        var changed = new List<string>();
        foreach (var entry in remoteFiles)
        {
            string localPath = Path.Combine(root, entry.Path.Replace('/', Path.DirectorySeparatorChar));
            if (!File.Exists(localPath) || !String.Equals(FileHash(localPath), entry.Hash, StringComparison.OrdinalIgnoreCase))
            {
                changed.Add(entry.Path);
            }
        }
        return UpdateResultJson(true, changed, "Actualizacion disponible", source);
    }

    private string ApplyUpdates()
    {
        string source = GetUpdateSource();
        if (String.IsNullOrWhiteSpace(source)) return "{\"ok\":false,\"error\":\"No hay fuente de actualizacion configurada\"}";
        string remote = DownloadText(source + "/updates/manifest.json");
        var remoteFiles = ParseManifestFiles(remote);
        var changed = new List<string>();
        foreach (var entry in remoteFiles)
        {
            string safeRel = NormalizeUpdatePath(entry.Path);
            if (safeRel.Contains("..")) continue;
            string localPath = Path.GetFullPath(Path.Combine(root, safeRel.Replace('/', Path.DirectorySeparatorChar)));
            string rootFull = Path.GetFullPath(root);
            if (!localPath.StartsWith(rootFull, StringComparison.OrdinalIgnoreCase)) continue;
            if (File.Exists(localPath) && String.Equals(FileHash(localPath), entry.Hash, StringComparison.OrdinalIgnoreCase)) continue;

            Directory.CreateDirectory(Path.GetDirectoryName(localPath));
            string temp = localPath + ".update";
            DownloadFile(source + "/" + EncodeUrlPath(safeRel), temp);
            if (!String.Equals(FileHash(temp), entry.Hash, StringComparison.OrdinalIgnoreCase))
            {
                try { File.Delete(temp); } catch { }
                throw new Exception("Hash invalido en " + safeRel);
            }
            File.Copy(temp, localPath, true);
            try { File.Delete(temp); } catch { }
            changed.Add(safeRel);
        }
        return UpdateResultJson(true, changed, changed.Count == 0 ? "Ya estaba actualizado" : "Actualizacion aplicada", source);
    }

    private static string DownloadText(string url)
    {
        using (var wc = new WebClient())
        {
            wc.Encoding = Encoding.UTF8;
            wc.CachePolicy = new System.Net.Cache.RequestCachePolicy(System.Net.Cache.RequestCacheLevel.NoCacheNoStore);
            return wc.DownloadString(url);
        }
    }

    private static void DownloadFile(string url, string target)
    {
        using (var wc = new WebClient())
        {
            wc.CachePolicy = new System.Net.Cache.RequestCachePolicy(System.Net.Cache.RequestCacheLevel.NoCacheNoStore);
            wc.DownloadFile(url, target);
        }
    }

    private sealed class ManifestFile
    {
        public string Path;
        public string Hash;
    }

    private static List<ManifestFile> ParseManifestFiles(string json)
    {
        var list = new List<ManifestFile>();
        if (String.IsNullOrWhiteSpace(json)) return list;
        var rx = new System.Text.RegularExpressions.Regex("\\{\\\"path\\\":\\\"(?<path>(?:\\\\.|[^\\\"])*)\\\",\\\"hash\\\":\\\"(?<hash>[a-fA-F0-9]+)\\\"");
        foreach (System.Text.RegularExpressions.Match m in rx.Matches(json))
        {
            list.Add(new ManifestFile { Path = JsonUnescape(m.Groups["path"].Value), Hash = m.Groups["hash"].Value });
        }
        return list;
    }

    private static string JsonUnescape(string value)
    {
        return (value ?? "").Replace("\\\"", "\"").Replace("\\\\", "\\").Replace("\\/", "/").Replace("\\r", "\r").Replace("\\n", "\n");
    }

    private static string EncodeUrlPath(string rel)
    {
        string[] parts = NormalizeUpdatePath(rel).Split('/');
        for (int i = 0; i < parts.Length; i++) parts[i] = Uri.EscapeDataString(parts[i]);
        return String.Join("/", parts);
    }

    private static string UpdateResultJson(bool ok, List<string> files, string message, string source)
    {
        var sb = new StringBuilder();
        sb.Append("{\"ok\":").Append(ok ? "true" : "false").Append(",\"updates\":").Append(files.Count).Append(",\"source\":\"").Append(JsonEscape(source)).Append("\",\"message\":\"").Append(JsonEscape(message)).Append("\",\"files\":[");
        for (int i = 0; i < files.Count; i++)
        {
            if (i > 0) sb.Append(',');
            sb.Append("\"").Append(JsonEscape(files[i])).Append("\"");
        }
        sb.Append("]}");
        return sb.ToString();
    }

    private static string InjectUpdateWidget(string html)
    {
        if (String.IsNullOrWhiteSpace(html) || html.IndexOf("corralon-update-widget", StringComparison.OrdinalIgnoreCase) >= 0) return html;
        string widget = @"<script id=""corralon-update-widget"">
(function(){
  if(window.__corralonUpdater) return; window.__corralonUpdater = true;
  function css(){var s=document.createElement('style');s.textContent='#corralonUpdateBox{position:fixed;right:14px;bottom:14px;z-index:999999;background:#111827;color:white;border-radius:14px;padding:12px 14px;box-shadow:0 10px 28px rgba(0,0,0,.28);font-family:Arial,sans-serif;font-size:14px;display:none;gap:10px;align-items:center;max-width:360px}#corralonUpdateBox button{border:0;border-radius:10px;padding:8px 11px;font-weight:800;cursor:pointer}#corralonUpdateBox .ok{background:#7c4dff;color:#fff}#corralonUpdateBox .no{background:#374151;color:#fff}';document.head.appendChild(s)}
  function box(msg){if(!document.body)return;css();var b=document.createElement('div');b.id='corralonUpdateBox';b.innerHTML='<span>'+msg+'</span><button class=""ok"">Actualizar</button><button class=""no"">Luego</button>';document.body.appendChild(b);b.style.display='flex';b.querySelector('.no').onclick=function(){b.style.display='none'};b.querySelector('.ok').onclick=function(){b.querySelector('.ok').textContent='Actualizando...';fetch('/api/update/apply',{method:'POST'}).then(function(r){return r.json()}).then(function(){location.reload()}).catch(function(e){alert('No pude actualizar: '+e.message)})}}
  setTimeout(function(){fetch('/api/update/check').then(function(r){return r.json()}).then(function(j){if(j&&j.updates>0)box('Hay '+j.updates+' archivo(s) para actualizar')}).catch(function(){})},1800);
})();
</script>";
        int idx = html.LastIndexOf("</body>", StringComparison.OrdinalIgnoreCase);
        if (idx >= 0) return html.Insert(idx, widget);
        return html + widget;
    }

    private static string InjectArticleSharePreview(string html, HttpListenerRequest request, string fullPath)
    {
        if (String.IsNullOrWhiteSpace(html) || request == null) return html;
        string fileName = Path.GetFileName(fullPath ?? "");
        string requestPath = request.Url == null ? "" : request.Url.AbsolutePath.Trim('/');
        bool isIndexRequest =
            String.Equals(fileName, "index.html", StringComparison.OrdinalIgnoreCase) ||
            String.Equals(requestPath, "index.html", StringComparison.OrdinalIgnoreCase);
        if (!isIndexRequest) return html;

        string codigo = (request.QueryString["articulo"] ?? "").Trim();
        string image = CleanHttpUrl(request.QueryString["previewImg"]);
        if (String.IsNullOrWhiteSpace(codigo) || String.IsNullOrWhiteSpace(image)) return html;

        string title = (request.QueryString["previewTitulo"] ?? "").Trim();
        if (String.IsNullOrWhiteSpace(title)) title = "Articulo Corralon Progreso";
        string price = (request.QueryString["previewPrecio"] ?? "").Trim();
        string description = String.IsNullOrWhiteSpace(price)
            ? "Codigo: " + codigo + " - Corralon Progreso"
            : price + " - Codigo: " + codigo + " - Corralon Progreso";
        string pageUrl = request.Url == null ? "" : request.Url.AbsoluteUri;

        var meta = new StringBuilder();
        meta.AppendLine("<!-- corralon-share-preview-meta -->");
        meta.AppendLine("<meta property=\"og:type\" content=\"product\">");
        meta.AppendLine("<meta property=\"og:site_name\" content=\"Corralon Progreso\">");
        meta.AppendLine("<meta property=\"og:title\" content=\"" + HtmlAttr(title) + "\">");
        meta.AppendLine("<meta property=\"og:description\" content=\"" + HtmlAttr(description) + "\">");
        if (!String.IsNullOrWhiteSpace(pageUrl)) meta.AppendLine("<meta property=\"og:url\" content=\"" + HtmlAttr(pageUrl) + "\">");
        meta.AppendLine("<meta property=\"og:image\" content=\"" + HtmlAttr(image) + "\">");
        meta.AppendLine("<meta property=\"og:image:secure_url\" content=\"" + HtmlAttr(image) + "\">");
        meta.AppendLine("<meta property=\"og:image:alt\" content=\"" + HtmlAttr(title) + "\">");
        meta.AppendLine("<meta property=\"og:image:width\" content=\"1200\">");
        meta.AppendLine("<meta property=\"og:image:height\" content=\"1200\">");
        meta.AppendLine("<meta name=\"twitter:card\" content=\"summary_large_image\">");
        meta.AppendLine("<meta name=\"twitter:title\" content=\"" + HtmlAttr(title) + "\">");
        meta.AppendLine("<meta name=\"twitter:description\" content=\"" + HtmlAttr(description) + "\">");
        meta.AppendLine("<meta name=\"twitter:image\" content=\"" + HtmlAttr(image) + "\">");

        int idx = html.IndexOf("</head>", StringComparison.OrdinalIgnoreCase);
        return idx >= 0 ? html.Insert(idx, meta.ToString()) : meta + html;
    }

    private static string CleanHttpUrl(string value)
    {
        Uri uri;
        if (!Uri.TryCreate((value ?? "").Trim(), UriKind.Absolute, out uri)) return "";
        if (uri.Scheme != Uri.UriSchemeHttp && uri.Scheme != Uri.UriSchemeHttps) return "";
        return uri.AbsoluteUri;
    }

    private static string HtmlAttr(string value)
    {
        return WebUtility.HtmlEncode(value ?? "");
    }

    private string RunFactDb(string operation, string argsJson)
    {
        string script = Path.Combine(root, "Fact Web", "sql-api.ps1");
        string argsFile = Path.Combine(Path.GetTempPath(), "facturas-web-" + Guid.NewGuid().ToString("N") + ".json");
        File.WriteAllText(argsFile, argsJson ?? "{}", Encoding.UTF8);
        var psi = new ProcessStartInfo("powershell.exe");
        psi.UseShellExecute = false;
        psi.CreateNoWindow = true;
        psi.RedirectStandardOutput = true;
        psi.RedirectStandardError = true;
        psi.Arguments = "-NoProfile -ExecutionPolicy Bypass -File \"" + script + "\" -Operation \"" + operation + "\" -ArgsJsonFile \"" + argsFile + "\"";
        try
        {
            using (var process = Process.Start(psi))
            {
                string output = process.StandardOutput.ReadToEnd();
                string error = process.StandardError.ReadToEnd();
                process.WaitForExit();
                if (process.ExitCode != 0) throw new Exception(String.IsNullOrWhiteSpace(error) ? output : error);
                return String.IsNullOrWhiteSpace(output) ? "null" : output;
            }
        }
        finally
        {
            try { File.Delete(argsFile); } catch { }
        }
    }

    private string SaveFactAccessPending(string payload)
    {
        string targetDir = @"C:\Update";
        Directory.CreateDirectory(targetDir);
        string content = String.IsNullOrWhiteSpace(payload) ? "FACTURA_WEB_V1\r\n" : payload.Trim();
        string target = Path.Combine(targetDir, "factura-web-pendiente.txt");
        File.WriteAllText(target, content, Encoding.UTF8);

        string dataDir = Path.Combine(root, "Fact Web", "data");
        Directory.CreateDirectory(dataDir);
        File.WriteAllText(Path.Combine(dataDir, "factura-web-pendiente.txt"), content, Encoding.UTF8);

        return RunFactAccessImportButton();
    }

    private string RunFactAccessImportButton()
    {
        string script = Path.Combine(root, "Fact Web", "llamar-importar-web.ps1");
        var psi = new ProcessStartInfo("powershell.exe");
        psi.UseShellExecute = false;
        psi.CreateNoWindow = true;
        psi.RedirectStandardOutput = true;
        psi.RedirectStandardError = true;
        psi.Arguments = "-NoProfile -ExecutionPolicy Bypass -File \"" + script + "\"";
        using (var process = Process.Start(psi))
        {
            string output = process.StandardOutput.ReadToEnd();
            string error = process.StandardError.ReadToEnd();
            process.WaitForExit();
            if (process.ExitCode != 0) throw new Exception(String.IsNullOrWhiteSpace(error) ? output : error);
            return String.IsNullOrWhiteSpace(output) ? "{\"ok\":true,\"message\":\"Factura importada en Access.\"}" : output;
        }
    }

    private string SaveFactDraft(string body)
    {
        string dataDir = Path.Combine(root, "Fact Web", "data");
        Directory.CreateDirectory(dataDir);
        long id = DateTimeOffset.Now.ToUnixTimeMilliseconds();
        string payload = String.IsNullOrWhiteSpace(body) ? "{}" : body.Trim();
        string content = "{\"id\":" + id + ",\"createdAt\":\"" + DateTime.Now.ToString("o") + "\",\"payload\":" + payload + "}";
        File.WriteAllText(Path.Combine(dataDir, "draft-" + id + ".json"), content, Encoding.UTF8);
        return "{\"ok\":true,\"draftId\":" + id + ",\"mode\":\"BORRADOR_LOCAL_NO_FISCAL\"}";
    }

    private static string ReadRequestBody(HttpListenerContext context)
    {
        using (var reader = new StreamReader(context.Request.InputStream, context.Request.ContentEncoding ?? Encoding.UTF8))
        {
            return reader.ReadToEnd();
        }
    }

    private static int ParseInt(string value)
    {
        int result;
        return Int32.TryParse(value, out result) ? result : 0;
    }

    private static string JsonEscape(string value)
    {
        return (value ?? "").Replace("\\", "\\\\").Replace("\"", "\\\"").Replace("\r", "\\r").Replace("\n", "\\n");
    }

    private static void WriteJson(HttpListenerContext context, int statusCode, string json)
    {
        byte[] bytes = Encoding.UTF8.GetBytes(json ?? "");
        context.Response.StatusCode = statusCode;
        context.Response.ContentType = "application/json; charset=utf-8";
        context.Response.Headers["Cache-Control"] = "no-store";
        context.Response.Headers["Access-Control-Allow-Origin"] = "*";
        context.Response.Headers["Access-Control-Allow-Methods"] = "GET,POST,OPTIONS";
        context.Response.Headers["Access-Control-Allow-Headers"] = "content-type";
        context.Response.ContentLength64 = bytes.Length;
        context.Response.OutputStream.Write(bytes, 0, bytes.Length);
    }

    private static void WriteText(HttpListenerContext context, int statusCode, string text)
    {
        byte[] bytes = Encoding.UTF8.GetBytes(text);
        context.Response.StatusCode = statusCode;
        context.Response.ContentType = "text/plain; charset=utf-8";
        context.Response.ContentLength64 = bytes.Length;
        context.Response.OutputStream.Write(bytes, 0, bytes.Length);
    }

    private static void SaveArticulosXls(HttpListenerContext context)
    {
        string target = @"C:\Update\Articulos.xls";
        Directory.CreateDirectory(Path.GetDirectoryName(target));
        if (File.Exists(target))
        {
            File.Delete(target);
        }
        using (var output = File.Create(target))
        {
            context.Request.InputStream.CopyTo(output);
        }
        WriteText(context, 200, "OK");
    }

    private static string ContentType(string ext)
    {
        switch ((ext ?? "").ToLowerInvariant())
        {
            case ".html": return "text/html; charset=utf-8";
            case ".js": return "application/javascript; charset=utf-8";
            case ".css": return "text/css; charset=utf-8";
            case ".json": return "application/json; charset=utf-8";
            case ".png": return "image/png";
            case ".jpg":
            case ".jpeg": return "image/jpeg";
            case ".ico": return "image/x-icon";
            case ".svg": return "image/svg+xml";
            case ".xls": return "application/vnd.ms-excel";
            default: return "application/octet-stream";
        }
    }

    private void Log(string message)
    {
        try { File.AppendAllText(Path.Combine(root, "CorralonWebServer.log"), DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss") + " " + message + Environment.NewLine); } catch { }
    }

    protected override void OnFormClosing(FormClosingEventArgs e)
    {
        if (!exiting && e.CloseReason == CloseReason.UserClosing)
        {
            e.Cancel = true;
            HideToTray();
            return;
        }
        StopServer();
        if (trayIcon != null)
        {
            trayIcon.Visible = false;
            trayIcon.Dispose();
        }
        base.OnFormClosing(e);
    }
}
