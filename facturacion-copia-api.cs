using System;
using System.Collections.Generic;
using System.Data;
using System.Data.SqlClient;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Printing;
using System.IO;
using System.Net;
using System.Security.Cryptography;
using System.Text;
using System.Threading;
using System.Web.Script.Serialization;
using System.Xml;
using System.Reflection;
using System.Globalization;
using System.Runtime.InteropServices;
using Microsoft.Win32;

// Servicio local de la copia de Facturación.
internal static partial class FacturacionCopiaApi
{
    private static readonly JavaScriptSerializer Json = new JavaScriptSerializer { MaxJsonLength = 16777216 };
    private static readonly string[] Origins = { "http://localhost:8080", "http://127.0.0.1:8080", "http://localhost:8081", "http://127.0.0.1:8081" };
    private static readonly object FiscalGate = new object();
    private static readonly Dictionary<Guid, DateTime> FiscalConsultTimes = new Dictionary<Guid, DateTime>();
    private sealed class FiscalResult { public string Cae, Expiration, Number; }
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct PrintDocInfo
    {
        [MarshalAs(UnmanagedType.LPWStr)] public string Name;
        [MarshalAs(UnmanagedType.LPWStr)] public string Output;
        [MarshalAs(UnmanagedType.LPWStr)] public string DataType;
    }
    [DllImport("winspool.drv", EntryPoint = "OpenPrinterW", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern bool OpenPrinter(string name, out IntPtr handle, IntPtr defaults);
    [DllImport("winspool.drv", EntryPoint = "ClosePrinter", SetLastError = true)]
    private static extern bool ClosePrinter(IntPtr handle);
    [DllImport("winspool.drv", EntryPoint = "StartDocPrinterW", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern int StartDocPrinter(IntPtr handle, int level, ref PrintDocInfo info);
    [DllImport("winspool.drv", EntryPoint = "EndDocPrinter", SetLastError = true)]
    private static extern bool EndDocPrinter(IntPtr handle);
    [DllImport("winspool.drv", EntryPoint = "WritePrinter", SetLastError = true)]
    private static extern bool WritePrinter(IntPtr handle, byte[] bytes, int length, out int written);
    private static List<string> TicketPrinters()
    {
        var names = new List<string>();
        foreach (string name in PrinterSettings.InstalledPrinters)
            if (name.IndexOf("POS", StringComparison.OrdinalIgnoreCase) >= 0 ||
                name.IndexOf("ticket", StringComparison.OrdinalIgnoreCase) >= 0)
                names.Add(name);
        names.Sort(StringComparer.CurrentCultureIgnoreCase);
        return names;
    }
    private static readonly object PrinterConfigGate = new object();
    private static string PrinterConfigPath { get { return Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "impresoras-config.json"); } }
    private static Dictionary<string,object> ReadPrinterConfig() {
        if(!File.Exists(PrinterConfigPath))return new Dictionary<string,object>{{"version",0},{"equipos",new Dictionary<string,object>()},{"puntosVenta",new Dictionary<string,object>()}};
        return Object(Json.DeserializeObject(File.ReadAllText(PrinterConfigPath,Encoding.UTF8)));
    }
    private static void WritePrinterConfig(Dictionary<string,object> config) {
        string temp=PrinterConfigPath+".tmp";File.WriteAllText(temp,Json.Serialize(config),new UTF8Encoding(false));
        if(File.Exists(PrinterConfigPath))File.Replace(temp,PrinterConfigPath,null);else File.Move(temp,PrinterConfigPath);
    }
    private static void DiscoverPrinters(Dictionary<string,object> config,string id,string name,List<string> names,bool server) {
        var machines=Object(Value(config,"equipos"));var machine=Object(Value(machines,id));
        if(machine.Count==0){machine["nombre"]=name;machine["navegador"]=true;}
        var printers=Object(Value(machine,"impresoras"));foreach(var pair in printers)Object(pair.Value)["disponible"]=false;
        foreach(string printer in names){var row=Object(Value(printers,printer));if(row.Count==0)row["visible"]=!server||printer.IndexOf("POS",StringComparison.OrdinalIgnoreCase)>=0||printer.IndexOf("ticket",StringComparison.OrdinalIgnoreCase)>=0;row["disponible"]=true;printers[printer]=row;}
        machine["impresoras"]=printers;machine["ultimaConexion"]=DateTime.UtcNow.ToString("o");machines[id]=machine;config["equipos"]=machines;
    }
    private static object PrinterPublicMachine(Dictionary<string,object> machine) {
        return new{nombre=Value(machine,"nombre"),impresoras=Value(machine,"impresoras"),navegador=Value(machine,"navegador"),ultimaConexion=Value(machine,"ultimaConexion"),consultadoEl=Value(machine,"consultadoEl"),consulta=Value(machine,"respuesta"),remoto=Text(Value(machine,"claveHash")).Length>0};
    }
    private static string PrinterPoint(Dictionary<string,object> input,string fallback) {
        int point=0;Int32.TryParse(input==null?fallback:Text(Value(input,"puntoVenta")),out point);return point>0?point.ToString(CultureInfo.InvariantCulture):"";
    }
    private static string PrinterSecret(string value){using(var sha=SHA256.Create())return Convert.ToBase64String(sha.ComputeHash(Encoding.UTF8.GetBytes(value)));}
    private static List<string> PrinterNames(object values){var names=new List<string>();foreach(object raw in PurchaseArray(values)){string name=Limited(raw,300,"Impresora");if(name.Length>0&&!names.Contains(name))names.Add(name);if(names.Count>100)throw new InvalidOperationException("Demasiadas impresoras.");}return names;}
    private static Dictionary<string,object> PrinterView(Dictionary<string,object> config,string id,string point,bool admin){
        var machines=Object(Value(config,"equipos"));var points=Object(Value(config,"puntosVenta"));var rules=Object(Value(points,point));string bound=Text(Value(rules,"equipo"));
        var machine=Object(Value(machines,bound.Length>0?bound:id));
        var result=new Dictionary<string,object>{{"ok",true},{"version",Value(config,"version")},{"puntoVenta",point},{"equipo",bound},{"puesto",PrinterPublicMachine(machine)},{"servidor",PrinterPublicMachine(Object(Value(machines,"servidor")))},{"reglas",rules}};
        if(!admin){result["impresoras"]=TicketPrinters();result["disponibles"]=WindowsPrinters();}
        return result;
    }
    private static void HandlePrinterSettings(HttpListenerContext context) {
        try {
            var request=context.Request;Dictionary<string,object> input=null;string action="";
            if(request.HttpMethod=="POST"){
                if(!(request.ContentType??"").StartsWith("application/json")||request.ContentLength64<0||request.ContentLength64>100000)throw new InvalidOperationException("Configuración de impresoras inválida.");
                using(var reader=new StreamReader(request.InputStream,Encoding.UTF8))input=Object(Json.DeserializeObject(reader.ReadToEnd()));action=Text(Value(input,"accion"));
                if(action!="guardar-punto"&&action!="consultar-punto"&&action!="registrar"&&action!="conectar"&&action!="sondeo"&&action!="respuesta")throw new InvalidOperationException("Acción de impresoras inválida.");
            }
            bool admin=(input==null&&request.QueryString["configuracion"]=="1")||action=="guardar-punto"||action=="consultar-punto";
            if(admin)AssertPurchasePermission(input==null?request.QueryString["usuarioId"]:Text(Value(input,"usuarioId")),"facturacion",false,false,true);
            if(action=="conectar"){AssertPurchasePermission(Text(Value(input,"usuarioId")),"facturacion");int bindPoint=0;Int32.TryParse(Text(Value(input,"puntoVenta")),out bindPoint);using(var connection=Connect())if(Rows(connection,"SELECT IDDepósito FROM dbo.[Depósitos] WHERE IDDepósito=@p0 AND IDDepósito>1",bindPoint).Count==0)throw new InvalidOperationException("El punto de venta no existe.");}
            string id=Limited(input==null?request.QueryString["puesto"]:Value(input,"puesto"),180,"Equipo"),point=PrinterPoint(input,request.QueryString["puntoVenta"]);
            string waiting="",target="";Dictionary<string,object> result;
            lock(PrinterConfigGate){
                var config=ReadPrinterConfig();var machines=Object(Value(config,"equipos"));
                if(action!="sondeo"&&action!="respuesta")DiscoverPrinters(config,"servidor",Environment.MachineName+" · Servidor",WindowsPrinters(),true);
                if(action=="conectar"||action=="registrar"){
                    if(String.IsNullOrWhiteSpace(id)||!id.StartsWith("pc:"))throw new InvalidOperationException("Identificador de equipo inválido.");
                    var names=PrinterNames(Value(input,"impresoras"));DiscoverPrinters(config,id,Limited(Value(input,"nombre"),120,"Nombre del equipo"),names,false);
                    if(action=="conectar"){
                        if(point.Length==0)throw new InvalidOperationException("Elegí el punto de venta de esta PC.");
                        string key=Text(Value(input,"clave"));if(key.Length<32||key.Length>100)throw new InvalidOperationException("Clave del conector inválida.");
                        var machine=Object(Value(machines,id));string previous=Text(Value(machine,"claveHash"));
                        if(previous.Length>0&&previous!=PrinterSecret(key))throw new InvalidOperationException("El conector de este equipo tiene otra clave. Pedí al administrador que revise el equipo.");
                        machine["claveHash"]=PrinterSecret(key);machine["consultadoEl"]=DateTime.UtcNow.ToString("o");
                        var points=Object(Value(config,"puntosVenta"));var rules=Object(Value(points,point));if(Text(Value(rules,"equipo"))!=id)config["version"]=Convert.ToInt32(Value(config,"version"))+1;rules["equipo"]=id;points[point]=rules;config["puntosVenta"]=points;
                    }
                }
                if(action=="sondeo"||action=="respuesta"){
                    var machine=Object(Value(machines,id));if(Text(Value(machine,"claveHash"))!=PrinterSecret(Text(Value(input,"clave"))))throw new InvalidOperationException("Conector no autorizado.");
                    DateTime seen;bool saveHeartbeat=!DateTime.TryParse(Text(Value(machine,"ultimaConexion")),null,DateTimeStyles.RoundtripKind,out seen)||(DateTime.UtcNow-seen.ToUniversalTime()).TotalSeconds>=60;
                    if(saveHeartbeat||action=="respuesta")machine["ultimaConexion"]=DateTime.UtcNow.ToString("o");
                    if(action=="respuesta"){
                        string query=Text(Value(input,"consulta"));if(query!=Text(Value(machine,"solicitud")))throw new InvalidOperationException("La consulta de impresoras cambió; consultá otra vez.");
                        DiscoverPrinters(config,id,Text(Value(machine,"nombre")),PrinterNames(Value(input,"impresoras")),false);machine["respuesta"]=query;machine["consultadoEl"]=DateTime.UtcNow.ToString("o");
                    }
                    if(saveHeartbeat||action=="respuesta")WritePrinterConfig(config);Reply(context,200,new{ok=true,consulta=Text(Value(machine,"solicitud"))!=Text(Value(machine,"respuesta"))?Text(Value(machine,"solicitud")):""});return;
                }
                if(action=="guardar-punto"){
                    if(point.Length==0)throw new InvalidOperationException("Elegí un punto de venta.");
                    if(Text(Value(input,"version"))!=Text(Value(config,"version")))throw new InvalidOperationException("Otro administrador cambió las impresoras. Consultá nuevamente antes de guardar.");
                    var points=Object(Value(config,"puntosVenta"));var rules=Object(Value(points,point));
                    if(Text(Value(rules,"equipo")).Length==0)throw new InvalidOperationException("Ese punto de venta todavía no tiene un equipo conectado.");
                    var next=new Dictionary<string,object>();foreach(var pair in Object(Value(input,"locales")))if(pair.Value is bool)next[Limited(pair.Key,300,"Impresora")]=pair.Value;rules["locales"]=next;
                    next=new Dictionary<string,object>();foreach(var pair in Object(Value(input,"servidor")))if(pair.Value is bool)next[Limited(pair.Key,300,"Impresora")]=pair.Value;rules["servidor"]=next;
                    rules["navegador"]=Value(input,"navegador") is bool?Value(input,"navegador"):true;points[point]=rules;config["puntosVenta"]=points;
                    config["version"]=Convert.ToInt32(Value(config,"version"))+1;config["actualizadoPor"]=Text(Value(input,"usuarioId"));config["actualizadoEl"]=DateTime.UtcNow.ToString("o");
                }
                if(action=="consultar-punto"){
                    if(point.Length==0)throw new InvalidOperationException("Elegí un punto de venta.");
                    var rules=Object(Value(Object(Value(config,"puntosVenta")),point));target=Text(Value(rules,"equipo"));var machine=Object(Value(machines,target));
                    if(target.Length==0||Text(Value(machine,"claveHash")).Length==0)throw new InvalidOperationException("Este punto todavía no tiene el conector remoto asociado. Actualizá el conector en esa PC y abrí Facturación eligiendo este punto de venta una vez.");
                    waiting=Guid.NewGuid().ToString("N");machine["solicitud"]=waiting;
                }
                WritePrinterConfig(config);result=PrinterView(config,id,point,admin);
            }
            if(waiting.Length>0){
                bool completed=false;for(int attempt=0;attempt<48&&!completed;attempt++){Thread.Sleep(250);lock(PrinterConfigGate){var config=ReadPrinterConfig();completed=Text(Value(Object(Value(Object(Value(config,"equipos")),target)),"respuesta"))==waiting;result=PrinterView(config,id,point,true);}}
                result["consultaCompletada"]=completed;result["mensaje"]=completed?"Lista consultada en el equipo del punto de venta.":"El equipo no respondió a tiempo. Se muestra la última lista recibida; verificá que esté encendido y tenga el conector actualizado.";
            }
            if(admin&&input==null&&request.QueryString["puntos"]=="1")using(var c=Connect())result["puntosVenta"]=Rows(c,"SELECT IDDepósito id,[Descripción] nombre FROM dbo.[Depósitos] WHERE IDDepósito>1 ORDER BY IDDepósito");
            Reply(context,200,result);
        }catch(InvalidOperationException error){Reply(context,400,new{ok=false,error=error.Message});}
        catch(Exception){Reply(context,500,new{ok=false,error="No se pudo consultar o guardar la configuración de impresoras."});}
    }
    private static List<string> WindowsPrinters(){var names=new List<string>();foreach(string name in PrinterSettings.InstalledPrinters)names.Add(name);names.Sort(StringComparer.CurrentCultureIgnoreCase);return names;}

    private static void PrintRawTicket(string printer, string pngBase64, string jobName)
    {
        if (!WindowsPrinters().Contains(printer))
            throw new InvalidOperationException("La ticketera elegida no está instalada en esta PC.");
        // Una cola local con puerto UNC añade un monitor intermedio que puede
        // quedar bloqueado. Abrir directamente la impresora compartida evita
        // esa cola y conserva la selección que ya tiene cada puesto.
        string destination = printer;
        using (var key = Registry.LocalMachine.OpenSubKey(@"SYSTEM\CurrentControlSet\Control\Print\Printers\" + printer))
        {
            string port = key == null ? null : key.GetValue("Port") as string;
            if (!String.IsNullOrWhiteSpace(port) && port.StartsWith(@"\\", StringComparison.Ordinal) && port.IndexOf(',') < 0)
                destination = port;
        }
        byte[] png;
        try { png = Convert.FromBase64String(pngBase64); }
        catch { throw new InvalidOperationException("La imagen del ticket no es válida."); }
        if (png.Length < 100 || png.Length > 6000000)
            throw new InvalidOperationException("El ticket supera el tamaño permitido.");
        using (var source = Image.FromStream(new MemoryStream(png)))
        {
            if (source.Width < 150 || source.Width > 2000 || source.Height < 100 || source.Height > 30000)
                throw new InvalidOperationException("Las medidas del ticket no son válidas.");
            const int printableWidth = 560, rasterWidth = 576, leftMargin = 8;
            int height = (int)Math.Ceiling(source.Height * printableWidth / (double)source.Width);
            if (height > 30000) throw new InvalidOperationException("El ticket es demasiado largo.");
            using (var raster = new Bitmap(printableWidth, height, System.Drawing.Imaging.PixelFormat.Format24bppRgb))
            using (var graphics = Graphics.FromImage(raster))
            using (var output = new MemoryStream())
            {
                graphics.Clear(Color.White);
                graphics.InterpolationMode = InterpolationMode.HighQualityBicubic;
                graphics.DrawImage(source, 0, 0, printableWidth, height);
                output.WriteByte(0x1B); output.WriteByte(0x40); // ESC @
                const int rowsPerBlock = 200, bytesPerRow = rasterWidth / 8;
                for (int start = 0; start < height; start += rowsPerBlock)
                {
                    int rows = Math.Min(rowsPerBlock, height - start);
                    output.Write(new byte[] { 0x1D, 0x76, 0x30, 0x00, bytesPerRow, 0, (byte)(rows & 255), (byte)(rows >> 8) }, 0, 8);
                    byte[] bits = new byte[bytesPerRow * rows];
                    for (int y = 0; y < rows; y++)
                        for (int x = 0; x < printableWidth; x++)
                        {
                            Color pixel = raster.GetPixel(x, start + y);
                            int luminance = (pixel.R * 299 + pixel.G * 587 + pixel.B * 114) / 1000;
                            if (luminance < 190)
                            {
                                int dot = x + leftMargin;
                                bits[y * bytesPerRow + dot / 8] |= (byte)(0x80 >> (dot % 8));
                            }
                        }
                    output.Write(bits, 0, bits.Length);
                }
                output.Write(new byte[] { 0x1B, 0x64, 0x03, 0x1D, 0x56, 0x00 }, 0, 6); // feed + cut
                IntPtr handle;
                if (!OpenPrinter(destination, out handle, IntPtr.Zero))
                    throw new InvalidOperationException("Windows no pudo abrir la ticketera.");
                try
                {
                    var info = new PrintDocInfo { Name = jobName, DataType = "RAW" };
                    if (StartDocPrinter(handle, 1, ref info) == 0)
                        throw new InvalidOperationException("Windows no pudo crear el trabajo de impresión.");
                    try
                    {
                        byte[] bytes = output.ToArray(); int written;
                        if (!WritePrinter(handle, bytes, bytes.Length, out written) || written != bytes.Length)
                            throw new InvalidOperationException("Windows no aceptó el ticket completo.");
                    }
                    finally { EndDocPrinter(handle); }
                }
                finally { ClosePrinter(handle); }
            }
        }
    }
    private sealed class FiscalRejectedException : InvalidOperationException
    {
        public FiscalRejectedException(string message) : base(message) { }
    }
    private sealed class FiscalMismatchException : InvalidOperationException
    {
        public readonly object Actual;
        public FiscalMismatchException(object actual) : base("El número está autorizado en ARCA, pero sus datos no coinciden con este borrador.") { Actual = actual; }
    }
    private sealed class ArcaUnavailableException : InvalidOperationException
    {
        public ArcaUnavailableException(string message) : base(message) { }
    }
    private sealed class SaleReviewException : InvalidOperationException
    {
        public SaleReviewException(string message) : base(message) { }
    }
    private sealed class FiscalRecoveryException : InvalidOperationException
    {
        public readonly string Number;
        public FiscalRecoveryException(string number, string message) : base(message) { Number = number; }
    }
    private static string DraftMarker(Guid id)
    {
        return "WEB-" + Convert.ToBase64String(id.ToByteArray()).TrimEnd('=').Replace('+','-').Replace('/','_');
    }
    private static string RecoveryPath(Guid id)
    {
        return Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "wsfe-" + id.ToString("N") + ".bin");
    }
    private static string PendingDraftPath(Guid id)
    {
        return Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "wsfe-draft-" + id.ToString("N") + ".bin");
    }
    private static string DraftFingerprint(Dictionary<string, object> invoice)
    {
        string core = Json.Serialize(new {
            idComprobante = Value(invoice, "idComprobante"), idPuntoVenta = Value(invoice, "idPuntoVenta"),
            idCliente = Value(invoice, "idCliente"), fecha = Value(invoice, "fecha"),
            vendedor = Value(invoice, "vendedor"), listaPrecios = Value(invoice, "listaPrecios"),
            cliente = Value(invoice, "cliente"), articulos = Value(invoice, "articulos"),
            valores = Value(invoice, "valores"), nota = Value(invoice, "nota"),
            facturaAsociada = Value(invoice, "facturaAsociada") });
        if(InvoiceValueNumber(Value(invoice,"facturarOrigenId"))>0)
            core += "|origenX:"+Text(Value(invoice,"facturarOrigenId"))+"|"+Text(Value(invoice,"facturarOrigenVersion"));
        using (var hash = SHA256.Create())
            return Convert.ToBase64String(hash.ComputeHash(Encoding.UTF8.GetBytes(core)));
    }
    private static bool SavePendingDraft(Guid id, Dictionary<string, object> invoice, string number)
    {
        string path = PendingDraftPath(id), fingerprint = DraftFingerprint(invoice);
        if (File.Exists(path))
        {
            var original = Object(Json.DeserializeObject(Encoding.UTF8.GetString(
                ProtectedData.Unprotect(File.ReadAllBytes(path), null, DataProtectionScope.CurrentUser))));
            if (Text(Value(original, "fingerprint")) != fingerprint || Text(Value(original, "numero")) != number)
                throw new InvalidOperationException("El borrador local ya enviado a ARCA cambió. No se pidió otro CAE; revisá la venta pendiente.");
            return false;
        }
        byte[] plain = Encoding.UTF8.GetBytes(Json.Serialize(new { comprobante = invoice, numero = number, fingerprint }));
        byte[] encrypted = ProtectedData.Protect(plain, null, DataProtectionScope.CurrentUser);
        using (var file = new FileStream(path, FileMode.CreateNew, FileAccess.Write, FileShare.None))
        {
            file.Write(encrypted, 0, encrypted.Length);
            file.Flush(true);
        }
        return true;
    }
    private static void DeletePendingDraft(Guid id)
    {
        try { string path = PendingDraftPath(id); if (File.Exists(path)) File.Delete(path); } catch { }
    }
    private static object ComCall(object com, string method, params object[] arguments)
    {
        return com.GetType().InvokeMember(method, BindingFlags.InvokeMethod, null, com, arguments);
    }
    private static object ComGet(object com, string property)
    {
        return com.GetType().InvokeMember(property, BindingFlags.GetProperty, null, com, null);
    }
    private static void ComSet(object com, string property, object value)
    {
        com.GetType().InvokeMember(property, BindingFlags.SetProperty, null, com, new[] { value });
    }
    private static void ReleaseCom(object com)
    {
        if (com != null && Marshal.IsComObject(com)) Marshal.FinalReleaseComObject(com);
    }
    private static string Tag(XmlDocument xml, string name)
    {
        var nodes = xml.GetElementsByTagName(name);
        return nodes.Count == 0 ? "" : nodes[0].InnerText;
    }
    private static string FiscalBarcode(string cuit, int afipType, int point, string cae, string expiration)
    {
        if (!System.Text.RegularExpressions.Regex.IsMatch(expiration ?? "", @"^\d{8}$"))
            throw new InvalidOperationException("ARCA devolvió un vencimiento de CAE inválido.");
        string body = cuit + afipType.ToString("00") + point.ToString("0000") + cae + expiration;
        if (body.Length != 39) throw new InvalidOperationException("No se pudo formar el código fiscal del comprobante.");
        int sum = 0;
        for (int i = 0; i < body.Length; i++) sum += (body[i] - '0') * (i % 2 == 0 ? 3 : 1);
        return body + ((10 - sum % 10) % 10).ToString();
    }
    private static string FiscalTicket()
    {
        string path = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "wsfe-ticket.bin");
        if (File.Exists(path))
        {
            try
            {
                string cached = Encoding.UTF8.GetString(ProtectedData.Unprotect(File.ReadAllBytes(path), null, DataProtectionScope.CurrentUser));
                var xml = new XmlDocument(); xml.LoadXml(cached);
                DateTimeOffset expiration;
                if (DateTimeOffset.TryParse(Tag(xml, "expirationTime"), out expiration) && expiration > DateTimeOffset.Now.AddMinutes(5)
                    && Tag(xml, "token").Length > 0 && Tag(xml, "sign").Length > 0) return cached;
            }
            catch { }
        }
        // Access comparte AutAFIP con SQL; si allí hay un TA vigente, reutilizarlo
        // evita solicitar otro mientras ARCA mantiene uno activo para el certificado.
        try
        {
            using (var connection = Connect())
            using (var command = new SqlCommand(
                "SELECT TOP 1 CONVERT(nvarchar(max),Token),CONVERT(nvarchar(max),Sign),FyHExp FROM dbo.AutAFIP WHERE FyHExp>DATEADD(minute,5,GETDATE()) ORDER BY FyHExp DESC", connection))
            using (var reader = command.ExecuteReader())
            {
                if (reader.Read() && !reader.IsDBNull(0) && !reader.IsDBNull(1) && !reader.IsDBNull(2))
                {
                    string token = reader.GetString(0), sign = reader.GetString(1);
                    DateTime expires = reader.GetDateTime(2);
                    if (token.Length > 0 && sign.Length > 0)
                    {
                        var xml = new XmlDocument();
                        var root = xml.CreateElement("loginTicketResponse"); xml.AppendChild(root);
                        var header = xml.CreateElement("header"); root.AppendChild(header);
                        var expiration = xml.CreateElement("expirationTime"); header.AppendChild(expiration);
                        expiration.InnerText = new DateTimeOffset(expires, TimeZoneInfo.Local.GetUtcOffset(expires))
                            .ToString("yyyy-MM-ddTHH:mm:sszzz", CultureInfo.InvariantCulture);
                        var credentials = xml.CreateElement("credentials"); root.AppendChild(credentials);
                        var tokenNode = xml.CreateElement("token"); tokenNode.InnerText = token; credentials.AppendChild(tokenNode);
                        var signNode = xml.CreateElement("sign"); signNode.InnerText = sign; credentials.AppendChild(signNode);
                        string shared = xml.OuterXml;
                        File.WriteAllBytes(path, ProtectedData.Protect(Encoding.UTF8.GetBytes(shared), null, DataProtectionScope.CurrentUser));
                        return shared;
                    }
                }
            }
        }
        catch { }
        string certificate = @"C:\Update\ariel2.crt", key = @"C:\Update\ariel2.key";
        if (!File.Exists(certificate) || !File.Exists(key))
            throw new InvalidOperationException("No se encontraron el certificado y la clave que usa Access en C:\\Update. No se emitió.");
        object wsaa = null;
        try
        {
            Type type = Type.GetTypeFromProgID("WSAA");
            if (type == null) throw new InvalidOperationException("No está registrado PyAfipWs WSAA en esta PC.");
            wsaa = Activator.CreateInstance(type);
            ComCall(wsaa, "Conectar", @"C:\PyAfipWs", "https://wsaa.afip.gov.ar/ws/services/LoginCms?wsdl", "");
            string tra = Text(ComCall(wsaa, "CreateTRA", "wsfe", 43200));
            string cms = Text(ComCall(wsaa, "SignTRA", tra, certificate, key));
            if (cms.Length == 0) throw new InvalidOperationException("No se pudo firmar el pedido a ARCA: " + Text(ComGet(wsaa, "Excepcion")));
            string ticket = Text(ComCall(wsaa, "LoginCMS", cms));
            var xml = new XmlDocument(); xml.LoadXml(ticket);
            if (Tag(xml, "token").Length == 0 || Tag(xml, "sign").Length == 0)
                throw new InvalidOperationException("ARCA no entregó un ticket de acceso válido.");
            File.WriteAllBytes(path, ProtectedData.Protect(Encoding.UTF8.GetBytes(ticket), null, DataProtectionScope.CurrentUser));
            return ticket;
        }
        catch (TargetInvocationException ex)
        {
            throw new InvalidOperationException("No se pudo autenticar con ARCA: " + (ex.InnerException == null ? ex.Message : ex.InnerException.Message));
        }
        finally { ReleaseCom(wsaa); }
    }
    private static readonly object PadronGate = new object();
    private static string PadronTicket()
    {
        string path = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "padron-constancia-ticket.bin");
        lock (PadronGate)
        {
            if (File.Exists(path)) try
            {
                var cached = new XmlDocument { XmlResolver = null };
                cached.LoadXml(Encoding.UTF8.GetString(ProtectedData.Unprotect(File.ReadAllBytes(path), null, DataProtectionScope.CurrentUser)));
                DateTimeOffset expiration;
                if (DateTimeOffset.TryParse(Tag(cached,"expirationTime"),out expiration) && expiration > DateTimeOffset.Now.AddMinutes(5)
                    && Tag(cached,"token").Length > 0 && Tag(cached,"sign").Length > 0) return cached.OuterXml;
            }
            catch { }
            string certificate = @"C:\Update\ariel2.crt", key = @"C:\Update\ariel2.key";
            if (!File.Exists(certificate) || !File.Exists(key)) throw new InvalidOperationException("No se encontró el certificado para consultar el padrón de ARCA.");
            object wsaa = null;
            try
            {
                Type type = Type.GetTypeFromProgID("WSAA");
                if (type == null) throw new InvalidOperationException("No está registrado PyAfipWs WSAA.");
                wsaa = Activator.CreateInstance(type);
                ComCall(wsaa,"Conectar",@"C:\PyAfipWs","https://wsaa.afip.gov.ar/ws/services/LoginCms?wsdl", "");
                string tra = Text(ComCall(wsaa,"CreateTRA","ws_sr_constancia_inscripcion",43200));
                string cms = Text(ComCall(wsaa,"SignTRA",tra,certificate,key));
                if (cms.Length == 0) throw new InvalidOperationException("No se pudo firmar la consulta del padrón.");
                string ticket = Text(ComCall(wsaa,"LoginCMS",cms));
                var xml = new XmlDocument { XmlResolver = null }; xml.LoadXml(ticket);
                if (Tag(xml,"token").Length == 0 || Tag(xml,"sign").Length == 0) throw new InvalidOperationException("ARCA no entregó el acceso al padrón. Habilitá el servicio ws_sr_constancia_inscripcion para el certificado.");
                File.WriteAllBytes(path,ProtectedData.Protect(Encoding.UTF8.GetBytes(ticket),null,DataProtectionScope.CurrentUser));
                return ticket;
            }
            catch (TargetInvocationException ex)
            {
                string detail = ex.InnerException == null ? ex.Message : ex.InnerException.Message;
                if (detail.IndexOf("notAuthorized",StringComparison.OrdinalIgnoreCase) >= 0)
                    throw new InvalidOperationException("ARCA no autorizó este certificado para consultar el padrón. Habilitá ws_sr_constancia_inscripcion en el Administrador de Relaciones de ARCA.");
                throw new InvalidOperationException("No se pudo autenticar la consulta del padrón de ARCA. Revisá la conexión y la habilitación del servicio ws_sr_constancia_inscripcion.");
            }
            finally { ReleaseCom(wsaa); }
        }
    }
    private static string PadronText(XmlNode node, string name)
    {
        if (node == null) return "";
        XmlNode child = node.SelectSingleNode(".//*[local-name()='" + name + "']");
        return child == null ? "" : child.InnerText.Trim();
    }
    private static object ParsePadronCustomer(XmlDocument xml, string cuit)
    {
        string fault = PadronText(xml,"faultstring");
        if (fault.Length > 0) throw new InvalidOperationException("ARCA: " + fault);
        XmlNode general = xml.SelectSingleNode("//*[local-name()='datosGenerales']");
        if (general == null) throw new InvalidOperationException("ARCA no devolvió datos para ese CUIT. " + PadronText(xml,"error"));
        if (PadronText(general,"idPersona") != cuit) throw new InvalidOperationException("El CUIT devuelto por ARCA no coincide con la consulta.");
        string name = PadronText(general,"razonSocial");
        if (name.Length == 0) name = (PadronText(general,"apellido") + " " + PadronText(general,"nombre")).Trim();
        if (name.Length == 0) throw new InvalidOperationException("ARCA no devolvió una razón social.");
        int tax = 0;
        foreach (XmlNode item in xml.SelectNodes("//*[local-name()='impuesto']"))
        {
            string state = PadronText(item,"estadoImpuesto").ToUpperInvariant(), id = PadronText(item,"idImpuesto");
            if (state != "AC" && state != "ACTIVO") continue;
            if (id == "30") { tax = 1; break; }
            if (id == "20") tax = 6;
            if (id == "32" && tax == 0) tax = 4;
        }
        XmlNode address = general.SelectSingleNode(".//*[local-name()='domicilioFiscal']");
        string status = PadronText(general,"estadoClave");
        return new { ok = true, cliente = new { nombre = name, documento = cuit, idTipoDoc = 67, idTipoIva = tax,
            direccion = PadronText(address,"direccion"), localidad = PadronText(address,"localidad"),
            codigoPostal = PadronText(address,"codPostal"), provincia = PadronText(address,"descripcionProvincia") },
            aviso = (status != "ACTIVO" ? "Estado de CUIT en ARCA: " + status + ". " : "") + (tax == 0 ? "ARCA no informó una condición de IVA reconocida. Seleccionala antes de guardar." : "") };
    }
    private static object LocalPadronCustomer(SqlConnection connection, string document)
    {
        string cuit=CustomerDocumentDigits(document);
        if(cuit.Trim('0').Length==0 || !ValidCuit(cuit))throw new InvalidOperationException("Ingresá un CUIT/CUIL válido de 11 cifras.");
        object table=Scalar(connection,null,"SELECT OBJECT_ID('dbo.WebPadronArca','U')");
        if(table==null || table==DBNull.Value)
            throw new InvalidOperationException("Todavía no se cargó el padrón en el servidor.");
        var rows=Rows(connection,"SELECT CUIT,Denominacion FROM dbo.WebPadronArca WHERE CUIT=@p0",cuit);
        if(rows.Count!=1 || Text(rows[0]["Denominacion"]).Length==0)
            throw new InvalidOperationException("El CUIT/CUIL no figura en el padrón tributario descargado. Eso no significa que sea inválido: podés completar el nombre manualmente.");
        var defaults=CustomerDefaults(connection);
        var customer=new Dictionary<string,object>(defaults);
        customer["nombre"]=Text(rows[0]["Denominacion"]).ToUpperInvariant();customer["documento"]=cuit;customer["idTipoDoc"]=67;customer["idTipoIva"]=1;
        var state=Rows(connection,"SELECT CONVERT(varchar(10),FechaArchivo,103) AS fecha FROM dbo.WebPadronArcaEstado WHERE Id=1");
        string date=state.Count==1?Text(state[0]["fecha"]):"";
        return new {ok=true,cliente=customer,fuente="padron-servidor",fechaPadron=date,aviso="Padrón del servidor"+(date.Length>0?" · "+date:"")+". Nombre de hasta 30 caracteres. IVA Responsable Inscripto e Ingresos Brutos Exento son valores predeterminados editables."};
    }
    private static object PadronCustomer(SqlConnection connection, string cuit)
    {
        cuit = cuit.Replace("-", "").Replace(" ", "");
        if (!ValidCuit(cuit)) throw new InvalidOperationException("Ingresá un CUIT válido de 11 dígitos.");
        string company = Text(Scalar(connection,null,"SELECT CUIT FROM dbo.Empresa WHERE IDEmpresa=1")).Replace("-", "").Replace(" ", "");
        if (!ValidCuit(company)) throw new InvalidOperationException("El CUIT emisor no es válido.");
        var ticket = new XmlDocument { XmlResolver = null }; ticket.LoadXml(PadronTicket());
        byte[] body;
        using (var stream = new MemoryStream())
        {
            using (var writer = XmlWriter.Create(stream,new XmlWriterSettings { Encoding = new UTF8Encoding(false), CloseOutput = false }))
            {
                writer.WriteStartElement("soap","Envelope","http://schemas.xmlsoap.org/soap/envelope/");
                writer.WriteStartElement("soap","Body","http://schemas.xmlsoap.org/soap/envelope/");
                writer.WriteStartElement("a5","getPersona_v2","http://a5.soap.ws.server.puc.sr/");
                writer.WriteElementString("token",Tag(ticket,"token"));writer.WriteElementString("sign",Tag(ticket,"sign"));
                writer.WriteElementString("cuitRepresentada",company);writer.WriteElementString("idPersona",cuit);
                writer.WriteEndElement();writer.WriteEndElement();writer.WriteEndElement();
            }
            body = stream.ToArray();
        }
        ServicePointManager.SecurityProtocol |= (SecurityProtocolType)3072;
        var request = (HttpWebRequest)WebRequest.Create("https://aws.afip.gov.ar/sr-padron/webservices/personaServiceA5");
        request.Method = "POST";request.ContentType = "text/xml; charset=utf-8";request.Headers["SOAPAction"] = "\"\"";
        request.Timeout = 25000;request.ReadWriteTimeout = 25000;request.ContentLength = body.Length;
        using (var stream = request.GetRequestStream()) stream.Write(body,0,body.Length);
        WebResponse response;
        try { response = request.GetResponse(); }
        catch (WebException ex) { if (ex.Response == null) throw new InvalidOperationException("ARCA no respondió a la consulta del padrón.");response = ex.Response; }
        using (response) using (var stream = response.GetResponseStream())
        using (var reader = XmlReader.Create(stream,new XmlReaderSettings { DtdProcessing = DtdProcessing.Prohibit, XmlResolver = null, MaxCharactersInDocument = 2000000 }))
        {
            var xml = new XmlDocument { XmlResolver = null };xml.Load(reader);return ParsePadronCustomer(xml,cuit);
        }
    }
    private static int FiscalLastAuthorized(int afipType, int point, string companyCuit)
    {
        var ticket = new XmlDocument(); ticket.LoadXml(FiscalTicket());
        object wsfe = null;
        try
        {
            Type type = Type.GetTypeFromProgID("WSFEv1");
            if (type == null) throw new InvalidOperationException("No está registrado PyAfipWs WSFEv1 en esta PC.");
            wsfe = Activator.CreateInstance(type);
            ComCall(wsfe, "Conectar", @"C:\PyAfipWs", "https://servicios1.afip.gov.ar/wsfev1/service.asmx?WSDL", "", "");
            ComSet(wsfe, "Token", Tag(ticket, "token"));
            ComSet(wsfe, "Sign", Tag(ticket, "sign"));
            ComSet(wsfe, "CUIT", companyCuit);
            int last;
            if (!Int32.TryParse(Text(ComCall(wsfe, "CompUltimoAutorizado", afipType, point)), out last) || last < 0)
                throw new InvalidOperationException("ARCA no devolvió la última numeración autorizada. No se emitió.");
            return last;
        }
        catch (TargetInvocationException ex)
        {
            throw new InvalidOperationException("No se pudo consultar la numeración de ARCA: " + (ex.InnerException == null ? ex.Message : ex.InnerException.Message));
        }
        finally { ReleaseCom(wsfe); }
    }

    private const string WsfeNamespace = "http://ar.gov.afip.dif.FEV1/";
    private static void WsfeField(XmlWriter writer, string name, object value)
    {
        writer.WriteElementString("ar", name, WsfeNamespace, Convert.ToString(value, CultureInfo.InvariantCulture));
    }
    // El descuento/recargo de los medios de pago cambia el total del comprobante.
    // Distribuirlo en centavos entre las alicuotas evita que ImpTotal difiera de neto + IVA.
    private static decimal[] FiscalAmounts(decimal gross, decimal finalTotal, decimal net21, decimal iva21,
        decimal net105, decimal iva105)
    {
        decimal gross21 = net21 + iva21, gross105 = net105 + iva105;
        decimal untaxed = gross - gross21 - gross105;
        if (gross <= 0 || finalTotal <= 0 || untaxed < 0)
            throw new InvalidOperationException("No se puede distribuir el total fiscal entre las alícuotas.");
        if (finalTotal == gross)
            return new decimal[] { net21 + net105, iva21 + iva105, untaxed, net21, iva21, net105, iva105 };
        decimal[] buckets = { gross21, gross105, untaxed };
        long totalCents = decimal.ToInt64(finalTotal * 100m);
        long[] cents = new long[3];
        decimal[] fractions = new decimal[3];
        long assigned = 0;
        for (int i = 0; i < buckets.Length; i++)
        {
            decimal exact = totalCents * buckets[i] / gross;
            cents[i] = decimal.ToInt64(decimal.Floor(exact));
            fractions[i] = exact - cents[i];
            assigned += cents[i];
        }
        while (assigned < totalCents)
        {
            int best = -1;
            for (int i = 0; i < buckets.Length; i++)
                if (buckets[i] > 0 && (best < 0 || fractions[i] > fractions[best])) best = i;
            cents[best]++; fractions[best] = -1; assigned++;
        }
        decimal adjusted21 = cents[0] / 100m, adjusted105 = cents[1] / 100m;
        decimal adjustedNet21 = Decimal.Round(adjusted21 / 1.21m, 2, MidpointRounding.AwayFromZero);
        decimal adjustedNet105 = Decimal.Round(adjusted105 / 1.105m, 2, MidpointRounding.AwayFromZero);
        decimal adjustedIva21 = adjusted21 - adjustedNet21;
        decimal adjustedIva105 = adjusted105 - adjustedNet105;
        return new decimal[] { adjustedNet21 + adjustedNet105, adjustedIva21 + adjustedIva105,
            cents[2] / 100m, adjustedNet21, adjustedIva21, adjustedNet105, adjustedIva105 };
    }
    private static byte[] FiscalSoapRequest(string token, string sign, string cuit, int afipType, int point,
        int sequence, DateTime date, int documentType, string document, int conditionIvaId,
        decimal gross, decimal net, decimal tax, decimal untaxed, decimal net21, decimal iva21,
        decimal net105, decimal iva105, int associateType, string associateNumber, DateTime associateDate)
    {
        Func<decimal, string> amount = value => value.ToString("0.00", CultureInfo.InvariantCulture);
        using (var stream = new MemoryStream())
        {
            using (var writer = XmlWriter.Create(stream, new XmlWriterSettings { Encoding = new UTF8Encoding(false), Indent = false }))
            {
                writer.WriteStartElement("soap", "Envelope", "http://schemas.xmlsoap.org/soap/envelope/");
                writer.WriteAttributeString("xmlns", "ar", null, WsfeNamespace);
                writer.WriteStartElement("soap", "Body", "http://schemas.xmlsoap.org/soap/envelope/");
                writer.WriteStartElement("ar", "FECAESolicitar", WsfeNamespace);
                writer.WriteStartElement("ar", "Auth", WsfeNamespace);
                WsfeField(writer, "Token", token); WsfeField(writer, "Sign", sign); WsfeField(writer, "Cuit", cuit);
                writer.WriteEndElement();
                writer.WriteStartElement("ar", "FeCAEReq", WsfeNamespace);
                writer.WriteStartElement("ar", "FeCabReq", WsfeNamespace);
                WsfeField(writer, "CantReg", 1); WsfeField(writer, "PtoVta", point); WsfeField(writer, "CbteTipo", afipType);
                writer.WriteEndElement();
                writer.WriteStartElement("ar", "FeDetReq", WsfeNamespace);
                writer.WriteStartElement("ar", "FECAEDetRequest", WsfeNamespace);
                WsfeField(writer, "Concepto", 1);
                WsfeField(writer, "DocTipo", documentType); WsfeField(writer, "DocNro", document.Replace("-", ""));
                WsfeField(writer, "CbteDesde", sequence); WsfeField(writer, "CbteHasta", sequence);
                WsfeField(writer, "CbteFch", date.ToString("yyyyMMdd", CultureInfo.InvariantCulture));
                WsfeField(writer, "ImpTotal", amount(gross)); WsfeField(writer, "ImpTotConc", amount(untaxed));
                WsfeField(writer, "ImpNeto", amount(net)); WsfeField(writer, "ImpOpEx", amount(0));
                WsfeField(writer, "ImpTrib", amount(0)); WsfeField(writer, "ImpIVA", amount(tax));
                WsfeField(writer, "MonId", "PES"); WsfeField(writer, "MonCotiz", "1.000");
                WsfeField(writer, "CondicionIVAReceptorId", conditionIvaId);
                if (associateType > 0)
                {
                    writer.WriteStartElement("ar", "CbtesAsoc", WsfeNamespace);
                    writer.WriteStartElement("ar", "CbteAsoc", WsfeNamespace);
                    WsfeField(writer, "Tipo", associateType);
                    WsfeField(writer, "PtoVta", Int32.Parse(associateNumber.Substring(0, 4), CultureInfo.InvariantCulture));
                    WsfeField(writer, "Nro", Int32.Parse(associateNumber.Substring(5, 8), CultureInfo.InvariantCulture));
                    WsfeField(writer, "Cuit", cuit);
                    WsfeField(writer, "CbteFch", associateDate.ToString("yyyyMMdd", CultureInfo.InvariantCulture));
                    writer.WriteEndElement(); writer.WriteEndElement();
                }
                if (iva21 != 0 || iva105 != 0)
                {
                    writer.WriteStartElement("ar", "Iva", WsfeNamespace);
                    if (iva21 != 0)
                    {
                        writer.WriteStartElement("ar", "AlicIva", WsfeNamespace);
                        WsfeField(writer, "Id", 5); WsfeField(writer, "BaseImp", amount(net21)); WsfeField(writer, "Importe", amount(iva21));
                        writer.WriteEndElement();
                    }
                    if (iva105 != 0)
                    {
                        writer.WriteStartElement("ar", "AlicIva", WsfeNamespace);
                        WsfeField(writer, "Id", 4); WsfeField(writer, "BaseImp", amount(net105)); WsfeField(writer, "Importe", amount(iva105));
                        writer.WriteEndElement();
                    }
                    writer.WriteEndElement();
                }
                writer.WriteEndElement(); writer.WriteEndElement(); writer.WriteEndElement();
                writer.WriteEndElement(); writer.WriteEndElement(); writer.WriteEndElement();
            }
            return stream.ToArray();
        }
    }
    private static string WsfeValue(XmlNode node, string path)
    {
        XmlNode value = node == null ? null : node.SelectSingleNode(path);
        return value == null ? "" : value.InnerText.Trim();
    }
    private static FiscalResult FiscalSoapResponse(Stream response, int afipType, int point, int sequence, string number)
    {
        var xml = new XmlDocument { XmlResolver = null };
        xml.Load(response);
        XmlNode result = xml.SelectSingleNode("//*[local-name()='FECAESolicitarResult']");
        XmlNode detail = result == null ? null : result.SelectSingleNode("./*[local-name()='FeDetResp']/*[local-name()='FECAEDetResponse']");
        string outcome = WsfeValue(detail, "./*[local-name()='Resultado']");
        string cae = WsfeValue(detail, "./*[local-name()='CAE']");
        string expiration = WsfeValue(detail, "./*[local-name()='CAEFchVto']");
        var messages = new List<string>();
        if (result != null)
            foreach (XmlNode item in result.SelectNodes("./*[local-name()='Errors']/*[local-name()='Err']|./*[local-name()='FeDetResp']/*[local-name()='FECAEDetResponse']/*[local-name()='Observaciones']/*[local-name()='Obs']"))
                messages.Add(WsfeValue(item, "./*[local-name()='Code']") + ": " + WsfeValue(item, "./*[local-name()='Msg']"));
        string explanation = String.Join("; ", messages.ToArray());
        if ((outcome == "R" || (detail == null && messages.Count > 0)) && cae.Length == 0)
            throw new FiscalRejectedException("ARCA rechazó el comprobante: " + explanation);
        if (outcome != "A" || !System.Text.RegularExpressions.Regex.IsMatch(cae, @"^\d{14}$") ||
            !System.Text.RegularExpressions.Regex.IsMatch(expiration, @"^\d{8}$") ||
            WsfeValue(result, "./*[local-name()='FeCabResp']/*[local-name()='CbteTipo']") != afipType.ToString(CultureInfo.InvariantCulture) ||
            WsfeValue(result, "./*[local-name()='FeCabResp']/*[local-name()='PtoVta']") != point.ToString(CultureInfo.InvariantCulture) ||
            WsfeValue(detail, "./*[local-name()='CbteDesde']") != sequence.ToString(CultureInfo.InvariantCulture) ||
            WsfeValue(detail, "./*[local-name()='CbteHasta']") != sequence.ToString(CultureInfo.InvariantCulture))
            throw new InvalidOperationException("ARCA no devolvió una autorización verificable para esta numeración. " + explanation);
        return new FiscalResult { Cae = cae, Expiration = expiration, Number = number };
    }
    private static FiscalResult FiscalSoapAuthorize(byte[] requestBody, int afipType, int point, int sequence,
        string number, Action beforeSubmit)
    {
        ServicePointManager.SecurityProtocol |= (SecurityProtocolType)3072; // TLS 1.2 en .NET Framework.
        var request = (HttpWebRequest)WebRequest.Create("https://servicios1.afip.gov.ar/wsfev1/service.asmx");
        request.Method = "POST";
        request.ContentType = "text/xml; charset=utf-8";
        request.Headers["SOAPAction"] = "\"" + WsfeNamespace + "FECAESolicitar\"";
        request.Timeout = 60000;
        request.ReadWriteTimeout = 60000;
        request.ContentLength = requestBody.Length;
        beforeSubmit();
        using (var body = request.GetRequestStream()) body.Write(requestBody, 0, requestBody.Length);
        using (var response = request.GetResponse())
        using (var stream = response.GetResponseStream())
            return FiscalSoapResponse(stream, afipType, point, sequence, number);
    }

    private static FiscalResult FiscalAuthorize(int afipType, int point, string number, DateTime date, int documentType,
        string document, int conditionIvaId, decimal gross, decimal net, decimal tax, decimal untaxed, decimal net21, decimal iva21,
        decimal net105, decimal iva105, string companyCuit, int associateType, string associateNumber, DateTime associateDate,
        Action beforeSubmit)
    {
        lock (FiscalGate)
        {
            var ticket = new XmlDocument(); ticket.LoadXml(FiscalTicket());
            object wsfe = null;
            try
            {
                Type type = Type.GetTypeFromProgID("WSFEv1");
                if (type == null) throw new InvalidOperationException("No está registrado PyAfipWs WSFEv1 en esta PC.");
                wsfe = Activator.CreateInstance(type);
                ComCall(wsfe, "Conectar", @"C:\PyAfipWs", "https://servicios1.afip.gov.ar/wsfev1/service.asmx?WSDL", "", "");
                ComSet(wsfe, "Token", Tag(ticket, "token"));
                ComSet(wsfe, "Sign", Tag(ticket, "sign"));
                ComSet(wsfe, "CUIT", companyCuit);
                int last = Convert.ToInt32(ComCall(wsfe, "CompUltimoAutorizado", afipType, point));
                int proposed = Int32.Parse(number.Substring(number.Length - 8), CultureInfo.InvariantCulture);
                if (last + 1 != proposed)
                    throw new InvalidOperationException("La numeración de ARCA cambió mientras se preparaba la factura. Último autorizado: " + last + ". No se emitió; volvé a intentar.");
                byte[] request = FiscalSoapRequest(Tag(ticket, "token"), Tag(ticket, "sign"), companyCuit,
                    afipType, point, proposed, date, documentType, document, conditionIvaId,
                    gross, net, tax, untaxed, net21, iva21, net105, iva105,
                    associateType, associateNumber, associateDate);
                return FiscalSoapAuthorize(request, afipType, point, proposed, number, beforeSubmit);
            }
            catch (TargetInvocationException ex)
            {
                throw new InvalidOperationException("No se pudo completar la autorización fiscal: " + (ex.InnerException == null ? ex.Message : ex.InnerException.Message));
            }
            finally { ReleaseCom(wsfe); }
        }
    }
    // FECompConsultar is read-only: a lost response must never trigger another CAESolicitar.
    private static FiscalResult FiscalConsult(int afipType, int point, string number, string companyCuit,
        DateTime date, int documentType, string document, decimal total)
    {
        lock (FiscalGate)
        {
            var ticket = new XmlDocument(); ticket.LoadXml(FiscalTicket());
            object wsfe = null;
            try
            {
                Type type = Type.GetTypeFromProgID("WSFEv1");
                if (type == null) throw new InvalidOperationException("No está registrado PyAfipWs WSFEv1 en esta PC.");
                wsfe = Activator.CreateInstance(type);
                ComCall(wsfe, "Conectar", @"C:\PyAfipWs", "https://servicios1.afip.gov.ar/wsfev1/service.asmx?WSDL", "", "");
                ComSet(wsfe, "Token", Tag(ticket, "token"));
                ComSet(wsfe, "Sign", Tag(ticket, "sign"));
                ComSet(wsfe, "CUIT", companyCuit);
                int sequence = Int32.Parse(number.Substring(number.Length - 8), CultureInfo.InvariantCulture);
                string cae = Text(ComCall(wsfe, "CompConsultar", afipType, point, sequence));
                if (!System.Text.RegularExpressions.Regex.IsMatch(cae, @"^\d{14}$"))
                {
                    string code = Text(ComGet(wsfe, "ErrCode"));
                    if (code == "602") return null;
                    throw new InvalidOperationException("ARCA no confirmó el resultado de la consulta. " + Text(ComGet(wsfe, "ErrMsg")));
                }
                Func<string, string> field = name => Text(ComCall(wsfe, "ObtenerCampoFactura", name));
                string actualDocument = field("nro_doc");
                decimal actualTotal;
                if (field("tipo_cbte") != afipType.ToString(CultureInfo.InvariantCulture) ||
                    field("punto_vta") != point.ToString(CultureInfo.InvariantCulture) ||
                    field("cbt_desde") != sequence.ToString(CultureInfo.InvariantCulture) ||
                    field("cbt_hasta") != sequence.ToString(CultureInfo.InvariantCulture) ||
                    field("fecha_cbte") != date.ToString("yyyyMMdd", CultureInfo.InvariantCulture) ||
                    field("tipo_doc") != documentType.ToString(CultureInfo.InvariantCulture) ||
                    actualDocument != document ||
                    !Decimal.TryParse(field("imp_total"), NumberStyles.Any, CultureInfo.InvariantCulture, out actualTotal) ||
                    Math.Abs(actualTotal - total) > .01m)
                    throw new FiscalMismatchException(new { fecha = field("fecha_cbte"), documento = actualDocument, total = field("imp_total"), tipoDocumento = field("tipo_doc") });
                string expiration = Text(ComGet(wsfe, "Vencimiento"));
                if (!System.Text.RegularExpressions.Regex.IsMatch(expiration, @"^\d{8}$"))
                    throw new InvalidOperationException("ARCA devolvió un CAE sin vencimiento válido. Avisá al encargado.");
                return new FiscalResult { Cae = cae, Expiration = expiration, Number = number };
            }
            catch (TargetInvocationException ex)
            {
                throw new InvalidOperationException("No se pudo consultar el comprobante en ARCA: " +
                    (ex.InnerException == null ? ex.Message : ex.InnerException.Message));
            }
            finally { ReleaseCom(wsfe); }
        }
    }

    private static string Text(object value) { return value == null || value == DBNull.Value ? "" : Convert.ToString(value, System.Globalization.CultureInfo.InvariantCulture).Trim(); }
    private static string Upper(object value) { return Text(value).ToUpper(new CultureInfo("es-AR")); }
    private static Dictionary<string, object> Object(object value) { return value as Dictionary<string, object> ?? new Dictionary<string, object>(); }
    private static object Value(Dictionary<string, object> data, string key) { object value; return data.TryGetValue(key, out value) ? value : null; }
    private static decimal Number(object value)
    {
        decimal result;
        if (!Decimal.TryParse(Text(value), System.Globalization.NumberStyles.Any, System.Globalization.CultureInfo.InvariantCulture, out result)) throw new InvalidOperationException("Importe o cantidad inválida.");
        return result;
    }
    private static decimal StockNumber(object value)
    {
        // SQL real llega como Single. Convertir primero a Double conserva sus
        // bits; Convert.ToDecimal(Single) redondea a siete cifras significativas.
        if (value is float) return Convert.ToDecimal((double)(float)value);
        return Convert.ToDecimal(value);
    }
    private static decimal StoredStock(decimal value)
    {
        return StockNumber((float)value);
    }
    private static bool StockMatches(object actual, decimal expected)
    {
        return actual != null && actual != DBNull.Value &&
            Math.Abs(StockNumber(actual) - (actual is float ? StoredStock(expected) : expected)) <= .0001m;
    }
    private static int Id(object value)
    {
        int result;
        if (!Int32.TryParse(Text(value), out result) || result <= 0) throw new InvalidOperationException("Falta seleccionar un valor de la base local.");
        return result;
    }
    private static int RequiredId(object value, string label)
    {
        int result;
        if (!Int32.TryParse(Text(value), out result) || result <= 0)
            throw new InvalidOperationException("Falta seleccionar " + label + ".");
        return result;
    }
    private static SqlConnection Connect()
    {
        using (var key = Registry.CurrentUser.OpenSubKey(@"Software\CorralonProgreso\LocalSql"))
        {
            string encrypted = key == null ? "" : Text(key.GetValue("Connection"));
            if (encrypted.Length == 0) throw new InvalidOperationException("Falta configurar la conexión SQL local para este usuario de Windows.");
            string connectionString = Encoding.UTF8.GetString(ProtectedData.Unprotect(Convert.FromBase64String(encrypted), null, DataProtectionScope.CurrentUser));
            for (int attempt = 0; attempt < 3; attempt++)
            {
                var connection = new SqlConnection(connectionString);
                try
                {
                    connection.Open();
                    return connection;
                }
                catch (SqlException ex)
                {
                    connection.Dispose();
                    // Una credencial inválida no se recupera esperando. Los cortes de red o
                    // conexiones del pool caducadas sí pueden resolverse al abrir de nuevo.
                    if (ex.Number == 18456 || attempt == 2) throw;
                    SqlConnection.ClearAllPools();
                    Thread.Sleep(300 * (attempt + 1));
                }
                catch
                {
                    connection.Dispose();
                    throw;
                }
            }
            throw new InvalidOperationException("No se pudo conectar con SQL Server.");
        }
    }
    private static List<Dictionary<string, object>> Rows(SqlConnection connection, string sql, params object[] values)
    {
        using (var command = new SqlCommand(sql, connection))
        {
            command.CommandTimeout = 15;
            for (int i = 0; i < values.Length; i++) command.Parameters.AddWithValue("@p" + i, values[i] ?? DBNull.Value);
            using (var reader = command.ExecuteReader())
            {
                var rows = new List<Dictionary<string, object>>();
                while (reader.Read())
                {
                    var row = new Dictionary<string, object>(StringComparer.OrdinalIgnoreCase);
                    for (int i = 0; i < reader.FieldCount; i++) row[reader.GetName(i)] = reader.IsDBNull(i) ? null : reader.GetValue(i);
                    rows.Add(row);
                }
                return rows;
            }
        }
    }
    private static List<Dictionary<string, object>> RowsTx(SqlConnection connection, SqlTransaction transaction, string sql, params object[] values)
    {
        using (var command = new SqlCommand(sql, connection, transaction))
        {
            command.CommandTimeout = 30;
            for (int i = 0; i < values.Length; i++) command.Parameters.AddWithValue("@p" + i, values[i] ?? DBNull.Value);
            using (var reader = command.ExecuteReader())
            {
                var rows = new List<Dictionary<string, object>>();
                while (reader.Read())
                {
                    var row = new Dictionary<string, object>(StringComparer.OrdinalIgnoreCase);
                    for (int i = 0; i < reader.FieldCount; i++) row[reader.GetName(i)] = reader.IsDBNull(i) ? null : reader.GetValue(i);
                    rows.Add(row);
                }
                return rows;
            }
        }
    }
    private static bool CajaSucursalAbierta(SqlConnection connection, SqlTransaction transaction, int branch)
    {
        object closed = Scalar(connection, transaction,
            "SELECT TOP 1 CAST(c.Confirmado AS int) FROM dbo.CajaDiaTP c WITH (HOLDLOCK) " +
            "INNER JOIN dbo.[Depósitos] d ON d.[IDDepósito]=c.[IDDepósito] " +
            "WHERE d.IDSucAsoc=@p0 AND c.IDEmp=1 AND c.Global<>0 AND ISNULL(c.Anulado,0)=0 " +
            "AND c.Fecha>=CONVERT(date,GETDATE()) AND c.Fecha<DATEADD(day,1,CONVERT(date,GETDATE())) " +
            "ORDER BY c.IDRecibo DESC", branch);
        // Sin caja registrada hoy, el cierre del día anterior no bloquea la nueva jornada.
        if(closed==null || closed==DBNull.Value) {
            object removed=Scalar(connection,transaction,"SELECT 1 FROM dbo.CajaWebEstado WITH(HOLDLOCK) WHERE Fecha=CONVERT(date,GETDATE()) AND Seccion='caja-eliminada' AND Usuario=@p0",branch.ToString(CultureInfo.InvariantCulture));
            return removed==null || removed==DBNull.Value;
        }
        return Convert.ToInt32(closed)==0;
    }

    private static object Scalar(SqlConnection connection, SqlTransaction transaction, string sql, params object[] values)
    {
        using (var command = new SqlCommand(sql, connection, transaction))
        {
            command.CommandTimeout = 30;
            for (int i = 0; i < values.Length; i++) command.Parameters.AddWithValue("@p" + i, values[i] ?? DBNull.Value);
            return command.ExecuteScalar();
        }
    }
    private static int Execute(SqlConnection connection, SqlTransaction transaction, string sql, params object[] values)
    {
        using (var command = new SqlCommand(sql, connection, transaction))
        {
            command.CommandTimeout = 30;
            for (int i = 0; i < values.Length; i++) command.Parameters.AddWithValue("@p" + i, values[i] ?? DBNull.Value);
            return command.ExecuteNonQuery();
        }
    }
    private static List<Dictionary<string, object>> CustomerDetail(SqlConnection connection, int id,SqlTransaction transaction=null)
    {
        return RowsTx(connection,transaction,
            "SELECT c.IDCliente AS id,c.[RazónSocial] AS nombre,c.Contacto AS contacto,c.[Dirección] AS direccion," +
            "c.IDLocalidad AS idDepartamento,c.IDProvincia AS idProvincia,c.IDRegión AS idRegion," +
            "c.LocalidadCli AS localidad,c.CodPostal AS codigoPostal,c.[Teléfono] AS telefono,c.Fax AS celular," +
            "c.IDTipoIVA AS idTipoIva,c.IDTipoDoc AS idTipoDoc,c.CUIT AS documento,c.TipoCli AS idLista," +
            "c.IDTipoIB AS idTipoIb,c.NroIIBB AS numeroIibb,CONVERT(varchar(10),c.FechaVtoExIB,23) AS vencimientoIibb," +
            "c.IDTipoComer AS idTipoComercio,CONVERT(varchar(10),c.FechaAlta,103) AS fechaAlta," +
            "c.IDVend AS idVendedor,c.IDTipoPago AS idTipoPago,c.PorcDto*100 AS descuento,c.ImpCred AS limiteCredito," +
            "c.SaldoCC AS saldoSql,c.Email AS email,c.Web AS web,c.CBU AS cbu,c.CBUAlias AS cbuAlias," +
            "CONVERT(nvarchar(4000),c.Nota) AS nota,c.Suspendido AS suspendido," +
            "ISNULL(c.ImpCred,0)-ISNULL(c.SaldoCC,0)-" +
            "ISNULL((SELECT SUM(v.ImpEnt*tc.ImpPor) FROM dbo.FacturasATP h JOIN dbo.FacturasTSVal v ON v.IDRecibo=h.IDRecibo JOIN dbo.TipoComprobantes tc ON tc.IDComprob=h.IDComprob WHERE h.IDCliente=c.IDCliente AND h.IDEmp=1 AND h.Anulada=0 AND h.Confirmado=-1 AND v.IDTipoPago=3 AND tc.IDTipoAcred>0),0)+" +
            "ISNULL((SELECT SUM(r.Total) FROM dbo.RecibosXTP r WHERE r.IDCliente=c.IDCliente AND r.IDEmp=1 AND r.Anulado=0 AND r.Confirmado=1),0) AS cupoDisponible " +
            "FROM dbo.Clientes c WHERE c.IDCliente=@p0", id);
    }
    private static Dictionary<string, object> CustomerDefaults(SqlConnection connection)
    {
        var defaults = Rows(connection,
            "SELECT l.IDLocal AS idDepartamento,l.CodPostal AS codigoPostal,p.IDProvincia AS idProvincia," +
            "r.[IDRegión] AS idRegion,ib.IDTipoIB AS idTipoIb " +
            "FROM dbo.Localidades l CROSS JOIN dbo.Provincias p CROSS JOIN dbo.Regiones r CROSS JOIN dbo.TiposIB ib " +
            "WHERE l.Localidad=@p0 AND p.Provincia=@p1 AND r.[Descripción]=@p2 AND ib.TipoIB=@p3",
            "Rawson", "San Juan", "Capital SJ", "Exento");
        if (defaults.Count != 1 || Text(defaults[0]["codigoPostal"]).Length == 0)
            throw new InvalidOperationException("No se pudieron determinar en SQL los valores predeterminados del cliente.");
        return defaults[0];
    }
    private sealed class CustomerDocumentException : InvalidOperationException
    {
        public CustomerDocumentException(string message) : base(message) { }
    }
    private sealed class CustomerMergeRejected : InvalidOperationException { public CustomerMergeRejected(string message):base(message){} }
    private static readonly object CustomerMergeSchemaGate=new object();
    private static void EnsureCustomerMergeSchema(SqlConnection c)
    {
        lock(CustomerMergeSchemaGate)Execute(c,null,
            "IF OBJECT_ID('dbo.WebClientesUnificaciones','U') IS NULL CREATE TABLE dbo.WebClientesUnificaciones(Operacion uniqueidentifier NOT NULL PRIMARY KEY,Principal int NOT NULL,Usuario nvarchar(150) NOT NULL,FechaUtc datetime2 NOT NULL,Antes nvarchar(max) NOT NULL,Resultado nvarchar(max) NOT NULL);"+
            "IF OBJECT_ID('dbo.WebClientesUnificados','U') IS NULL CREATE TABLE dbo.WebClientesUnificados(Origen int NOT NULL PRIMARY KEY,Principal int NOT NULL,Operacion uniqueidentifier NOT NULL,FechaUtc datetime2 NOT NULL)");
    }
    private static int CustomerMergeDestination(SqlConnection c,SqlTransaction tx,int id)
    {
        object table=Scalar(c,tx,"SELECT OBJECT_ID('dbo.WebClientesUnificados','U')");
        if(table==null||table==DBNull.Value)return 0;
        int current=id;
        for(int i=0;i<20;i++){
            object next=Scalar(c,tx,"SELECT Principal FROM dbo.WebClientesUnificados WITH(HOLDLOCK) WHERE Origen=@p0",current);
            if(next==null||next==DBNull.Value)return current==id?0:current;
            int target=Convert.ToInt32(next);if(target<=1||target==current)throw new CustomerMergeRejected("La referencia de la cuenta unificada no es válida.");current=target;
        }
        throw new CustomerMergeRejected("Hay demasiadas referencias de cuentas unificadas. Revisá la cuenta principal.");
    }
    private static List<int> CustomerMergeIds(object value)
    {
        var ids=new List<int>();
        if(value is string){foreach(string part in Text(value).Split(',')){int id;if(!Int32.TryParse(part.Trim(),out id)||id<=1)throw new CustomerMergeRejected("Ingresá los IDs de las cuentas, separados por coma. Consumidor Final no se puede unificar.");if(!ids.Contains(id))ids.Add(id);}}
        else foreach(object item in PurchaseArray(value)){int id;if(!Int32.TryParse(Text(item),out id)||id<=1)throw new CustomerMergeRejected("Elegí cuentas válidas, distintas de Consumidor Final.");if(!ids.Contains(id))ids.Add(id);}
        ids.Sort();if(ids.Count<2||ids.Count>10)throw new CustomerMergeRejected("Elegí entre 2 y 10 cuentas para unificar.");return ids;
    }
    private static string CustomerMergeIdList(List<int> ids){return String.Join(",",ids.ConvertAll(id=>id.ToString(CultureInfo.InvariantCulture)).ToArray());}
    private static Dictionary<string,object> CustomerMergeSnapshot(SqlConnection c,SqlTransaction tx,List<int> ids,int requestedPrincipal)
    {
        string numbers=CustomerMergeIdList(ids);
        var accounts=RowsTx(c,tx,"SELECT IDCliente AS id,[RazónSocial] AS nombre,CUIT AS documento,ISNULL(IDTipoDoc,0) AS idTipoDoc,CONVERT(int,ISNULL(Suspendido,0)) AS suspendido,ISNULL(SaldoCC,0) AS saldoInicial,ISNULL(ImpCred,0) AS limiteCredito,CONVERT(nvarchar(max),Nota) AS nota FROM dbo.Clientes WITH(UPDLOCK,HOLDLOCK) WHERE IDCliente IN("+numbers+") ORDER BY IDCliente");
        if(accounts.Count!=ids.Count)throw new CustomerMergeRejected("Una de las cuentas ya no existe.");
        int principal=requestedPrincipal;
        if(principal==0){var candidate=accounts.Find(row=>InvoiceValueNumber(row["suspendido"])==0)??accounts[0];principal=Convert.ToInt32(candidate["id"]);}
        if(!ids.Contains(principal))throw new CustomerMergeRejected("La cuenta principal debe estar entre las seleccionadas.");
        var target=accounts.Find(row=>Convert.ToInt32(row["id"])==principal);
        // Una cuenta suspendida puede ser principal; se reactiva solo al confirmar la unificación.
        decimal totalBalance=0,initialBalance=0;
        foreach(var account in accounts){int accountId=Convert.ToInt32(account["id"]),destination=CustomerMergeDestination(c,tx,accountId);if(destination>0)throw new CustomerMergeRejected("La cuenta ID "+accountId+" ya se unificó en ID "+destination+". Usá la cuenta principal.");decimal balance=CollectionBalance(c,tx,accountId,1);account["saldoActual"]=balance;account["movimientos"]=0;totalBalance+=balance;initialBalance+=InvoiceValueNumber(account["saldoInicial"]);}
        var refs=RowsTx(c,tx,"SELECT s.name AS esquema,t.name AS tabla,c.name AS columna,c.is_identity,c.is_computed,ty.name AS tipo,QUOTENAME(s.name)+'.'+QUOTENAME(t.name) AS objeto,QUOTENAME(c.name) AS campo,t.object_id AS objetoId FROM sys.tables t JOIN sys.schemas s ON s.schema_id=t.schema_id JOIN sys.columns c ON c.object_id=t.object_id JOIN sys.types ty ON ty.user_type_id=c.user_type_id WHERE t.object_id<>OBJECT_ID('dbo.Clientes') AND (c.name='IDCliente' OR EXISTS(SELECT 1 FROM sys.foreign_key_columns fk WHERE fk.parent_object_id=t.object_id AND fk.parent_column_id=c.column_id AND fk.referenced_object_id=OBJECT_ID('dbo.Clientes'))) ORDER BY s.name,t.name,c.column_id");
        foreach(var reference in refs){
            if(Convert.ToBoolean(reference["is_identity"])||Convert.ToBoolean(reference["is_computed"])||Array.IndexOf(new[]{"int","smallint","bigint"},Text(reference["tipo"]))<0)throw new CustomerMergeRejected("No se puede trasladar automáticamente la referencia "+Text(reference["tabla"])+"."+Text(reference["columna"])+".");
            var keys=RowsTx(c,tx,"SELECT QUOTENAME(c.name) AS campo,c.name AS nombre FROM sys.indexes i JOIN sys.index_columns k ON k.object_id=i.object_id AND k.index_id=i.index_id JOIN sys.columns c ON c.object_id=k.object_id AND c.column_id=k.column_id WHERE i.object_id=@p0 AND i.is_primary_key=1 AND k.key_ordinal>0 ORDER BY k.key_ordinal",reference["objetoId"]);
            if(keys.Count==0)throw new CustomerMergeRejected("La tabla "+Text(reference["tabla"])+" no tiene clave primaria. Revisala antes de unificar.");
            string keyFields=String.Join(",",keys.ConvertAll(row=>Text(row["campo"])).ToArray());
            var rows=RowsTx(c,tx,"SELECT "+keyFields+","+Text(reference["campo"])+" AS _ClienteOriginal FROM "+Text(reference["objeto"])+" WITH(UPDLOCK,HOLDLOCK) WHERE "+Text(reference["campo"])+" IN("+numbers+") ORDER BY "+keyFields);
            reference["registros"]=rows;reference["aTrasladar"]=rows.FindAll(row=>Convert.ToInt32(row["_ClienteOriginal"])!=principal).Count;
            foreach(var account in accounts)account["movimientos"]=Convert.ToInt32(account["movimientos"])+rows.FindAll(row=>Convert.ToInt32(row["_ClienteOriginal"])==Convert.ToInt32(account["id"])).Count;
        }
        return new Dictionary<string,object>{{"principal",principal},{"cuentas",accounts},{"referencias",refs},{"saldoInicialTotal",initialBalance},{"saldoFinal",totalBalance},{"limiteCredito",target["limiteCredito"]}};
    }
    private static object CustomerMergePreview(SqlConnection c,List<int> ids,int principal)
    {
        EnsureCustomerMergeSchema(c);
        using(var tx=c.BeginTransaction(IsolationLevel.Serializable)){
            var snapshot=CustomerMergeSnapshot(c,tx,ids,principal);var summary=new List<object>();
            foreach(var reference in (List<Dictionary<string,object>>)snapshot["referencias"])summary.Add(new {tabla=reference["tabla"],columna=reference["columna"],movimientos=reference["aTrasladar"]});
            string version=ProviderVersion(snapshot);tx.Commit();
            return new {ok=true,principal=snapshot["principal"],cuentas=snapshot["cuentas"],referencias=summary,saldoFinal=snapshot["saldoFinal"],limiteCredito=snapshot["limiteCredito"],version=version};
        }
    }
    private static object CustomerMergeCommit(SqlConnection c,Dictionary<string,object> input)
    {
        var ids=CustomerMergeIds(Value(input,"ids"));int principal=Id(Value(input,"principal"));Guid operation;
        if(!Guid.TryParse(Text(Value(input,"operacion")),out operation))throw new CustomerMergeRejected("Falta el identificador de la unificación.");
        if(Text(Value(input,"confirmado"))!="True")throw new CustomerMergeRejected("Confirmá que las cuentas pertenecen al mismo cliente.");
        string user=Text(Value(input,"usuarioId"));EnsureCustomerMergeSchema(c);
        using(var tx=c.BeginTransaction(IsolationLevel.Serializable)){
            if(InvoiceValueNumber(Scalar(c,tx,"DECLARE @r int;EXEC @r=sp_getapplock @Resource='CorralonWeb.UnificarClientes',@LockMode='Exclusive',@LockOwner='Transaction',@LockTimeout=10000;SELECT @r"))<0)throw new CustomerMergeRejected("Hay otra unificación en curso. Volvé a intentar.");
            var saved=RowsTx(c,tx,"SELECT Principal,Usuario,Antes,Resultado FROM dbo.WebClientesUnificaciones WITH(UPDLOCK,HOLDLOCK) WHERE Operacion=@p0",operation);
            if(saved.Count>0){var prior=Object(Json.DeserializeObject(Text(saved[0]["Antes"])));var priorAccounts=PurchaseArray(Value(prior,"cuentas"));var priorIds=new List<int>();foreach(var row in priorAccounts)priorIds.Add(Convert.ToInt32(Value(Object(row),"id")));priorIds.Sort();if(Convert.ToInt32(saved[0]["Principal"])!=principal||Text(saved[0]["Usuario"])!=user||CustomerMergeIdList(priorIds)!=CustomerMergeIdList(ids))throw new CustomerMergeRejected("Esta operación ya se usó para otras cuentas.");object result=Json.DeserializeObject(Text(saved[0]["Resultado"]));tx.Commit();return result;}
            var snapshot=CustomerMergeSnapshot(c,tx,ids,principal);
            if(Text(Value(input,"version"))!=ProviderVersion(snapshot))throw new CustomerMergeRejected("Las cuentas o sus movimientos cambiaron. Volvé a revisar la unificación antes de confirmar.");
            var sources=ids.FindAll(id=>id!=principal);string sourceList=CustomerMergeIdList(sources);var moved=new List<object>();
            foreach(var reference in (List<Dictionary<string,object>>)snapshot["referencias"]){int expected=Convert.ToInt32(reference["aTrasladar"]);if(expected==0)continue;int updated=Execute(c,tx,"UPDATE "+Text(reference["objeto"])+" SET "+Text(reference["campo"])+"=@p0 WHERE "+Text(reference["campo"])+" IN("+sourceList+")",principal);if(updated!=expected)throw new InvalidOperationException("No coincide la cantidad de movimientos trasladados de "+Text(reference["tabla"])+".");moved.Add(new {tabla=reference["tabla"],columna=reference["columna"],movimientos=updated});}
            Execute(c,tx,"UPDATE dbo.Clientes SET SaldoCC=@p1,Suspendido=0 WHERE IDCliente=@p0",principal,snapshot["saldoInicialTotal"]);
            foreach(int source in sources){Execute(c,tx,"UPDATE dbo.Clientes SET SaldoCC=0,Suspendido=1,Nota=ISNULL(CONVERT(nvarchar(max),Nota),'')+@p1 WHERE IDCliente=@p0",source," [UNIFICADO EN CLIENTE "+principal+"; OPERACION "+operation.ToString("D")+"]");Execute(c,tx,"UPDATE dbo.WebClientesUnificados SET Principal=@p1 WHERE Principal=@p0;INSERT dbo.WebClientesUnificados(Origen,Principal,Operacion,FechaUtc) VALUES(@p0,@p1,@p2,SYSUTCDATETIME())",source,principal,operation);}
            decimal actualBalance=CollectionBalance(c,tx,principal,1);
            if(Math.Abs(actualBalance-InvoiceValueNumber(snapshot["saldoFinal"]))>.01m)throw new InvalidOperationException("El saldo resultante no coincide con la suma de las cuentas. No se confirmó la unificación.");
            var customer=CustomerDetail(c,principal,tx)[0];var resultData=new {ok=true,principal=principal,origenes=sources,cliente=customer,saldoFinal=actualBalance,movimientos=moved,operacion=operation.ToString("D")};string json=Json.Serialize(resultData);
            Execute(c,tx,"INSERT dbo.WebClientesUnificaciones(Operacion,Principal,Usuario,FechaUtc,Antes,Resultado) VALUES(@p0,@p1,@p2,SYSUTCDATETIME(),@p3,@p4)",operation,principal,user,Json.Serialize(snapshot),json);
            tx.Commit();return resultData;
        }
    }
    private static string CustomerDocumentDigits(string document)
    {
        return System.Text.RegularExpressions.Regex.Replace(document ?? "", @"[.\s-]", "");
    }
    private static string CustomerDocumentError(int type, string document)
    {
        string digits = CustomerDocumentDigits(document);
        if (type == 67) return digits.Trim('0').Length > 0 && ValidCuit(digits) ? "" : "El número de documento del cliente no es válido. Ingresá un CUIT/CUIL de 11 cifras con dígito verificador correcto.";
        if (type != 50 || !System.Text.RegularExpressions.Regex.IsMatch(document ?? "", @"^[0-9.\s]+$") || !System.Text.RegularExpressions.Regex.IsMatch(digits, @"^[0-9]{7,8}$") || digits.TrimStart('0').Length < 7)
            return "El número de documento del cliente no es válido. Ingresá un DNI de 7 u 8 cifras o un CUIT/CUIL válido.";
        for (int period = 1; period <= 3; period++)
        {
            bool repeated = true;
            for (int i = period; i < digits.Length; i++) if (digits[i] != digits[i % period]) { repeated = false; break; }
            if (repeated) return "El número de documento del cliente no es válido. Reemplazá el número de relleno por el DNI real del cliente.";
        }
        if ("0123456789".Contains(digits) || "9876543210".Contains(digits))
            return "El número de documento del cliente no es válido. Reemplazá la secuencia de relleno por el DNI real del cliente.";
        return "";
    }
    private static string CustomerDocumentIdentity(string document)
    {
        string digits = CustomerDocumentDigits(document);
        if (System.Text.RegularExpressions.Regex.IsMatch(digits, @"^\d{7,8}$")) return "DNI:" + digits.TrimStart('0');
        if (digits.Length == 11 && ValidCuit(digits) && Array.IndexOf(new[] { "20", "23", "24", "27" }, digits.Substring(0, 2)) >= 0)
            return "DNI:" + digits.Substring(2, 8).TrimStart('0');
        return "DOC:" + digits;
    }
    private static List<Dictionary<string, object>> CustomerDocumentDuplicates(SqlConnection connection, SqlTransaction tx, int id, string document)
    {
        string digits = CustomerDocumentDigits(document), identity = CustomerDocumentIdentity(document);
        string dni = identity.StartsWith("DNI:") ? identity.Substring(4).PadLeft(8, '0') : "";
        string clean = "REPLACE(REPLACE(REPLACE(REPLACE(CUIT,'-',''),' ',''),'.',''),CHAR(9),'')";
        var candidates = RowsTx(connection, tx,
            "SELECT IDCliente AS id,[RazónSocial] AS nombre,CUIT AS documento,ISNULL(IDTipoDoc,0) AS idTipoDoc,CASE WHEN ISNULL(Suspendido,0)<>0 THEN 1 ELSE 0 END AS suspendido,SaldoCC AS saldoSql " +
            "FROM dbo.Clientes WITH (UPDLOCK,HOLDLOCK) WHERE IDCliente>1 AND IDCliente<>@p0 AND (" + clean + "=@p1 OR (@p2<>'' AND ((LEN(" + clean + ") IN (7,8) AND RIGHT('00000000'+" + clean + ",8)=@p2) OR (LEN(" + clean + ")=11 AND LEFT(" + clean + ",2) IN ('20','23','24','27') AND SUBSTRING(" + clean + ",3,8)=@p2)))) ORDER BY IDCliente", id, digits, dni);
        candidates.RemoveAll(row => CustomerDocumentIdentity(Text(row["documento"])) != identity || CustomerMergeDestination(connection,tx,Convert.ToInt32(row["id"]))>0);
        return candidates;
    }
    private static string CustomerDuplicateMessage(Dictionary<string, object> customer)
    {
        return "Esta cuenta ya existe: " + Text(customer["nombre"]) + " (ID " + Text(customer["id"]) + "), con " +
            (CustomerDocumentDigits(Text(customer["documento"])).Length == 11 ? "CUIT/CUIL " : "DNI ") + Text(customer["documento"]) +
            ". Revisá esa cuenta antes de confirmar; los saldos no se unifican automáticamente.";
    }
    private static object CheckCustomerDocument(SqlConnection connection, int id, int type, string document)
    {
        using (var tx = connection.BeginTransaction(IsolationLevel.Serializable))
        {
            var rows = RowsTx(connection, tx, "SELECT IDCliente AS id,[RazónSocial] AS nombre,CUIT AS documento,ISNULL(IDTipoDoc,0) AS idTipoDoc,CASE WHEN ISNULL(Suspendido,0)<>0 THEN 1 ELSE 0 END AS suspendido,SaldoCC AS saldoSql FROM dbo.Clientes WITH (UPDLOCK,HOLDLOCK) WHERE IDCliente=@p0", id);
            if (id <= 1 || rows.Count != 1) throw new CustomerDocumentException("Seleccioná un cliente registrado.");
            var customer = rows[0];
            if (Number(customer["suspendido"]) != 0) throw new CustomerDocumentException("El cliente está suspendido. Elegí otra cuenta.");
            string error = CustomerDocumentError(type, document);
            var duplicates = error.Length == 0 ? CustomerDocumentDuplicates(connection, tx, id, document) : new List<Dictionary<string, object>>();
            bool changed = CustomerDocumentDigits(Text(customer["documento"])) != CustomerDocumentDigits(document) || Number(customer["idTipoDoc"]) != type;
            if (duplicates.Count > 0) error = CustomerDuplicateMessage(duplicates[0]);
            tx.Commit();
            return new { ok = true, valido = error.Length == 0, error = error, requiereGuardar = changed, cliente = customer, coincidencias = duplicates,bloqueoDuplicado=duplicates.Count>0 };
        }
    }
    private static object SaveCustomerDocument(SqlConnection connection, Dictionary<string, object> data)
    {
        AssertPurchasePermission(Text(Value(data, "usuarioId")), "facturacion");
        int id = Id(Value(data, "id")), type = Text(Value(data, "tipoDocumento")) == "CUIT" ? 67 : Text(Value(data, "tipoDocumento")) == "DNI" ? 50 : 0;
        string document = CustomerDocumentDigits(Text(Value(data, "documento"))), error = CustomerDocumentError(type, document);
        if (id <= 1 || error.Length > 0) throw new CustomerDocumentException(error.Length > 0 ? error : "Seleccioná un cliente registrado.");
        using (var tx = connection.BeginTransaction(IsolationLevel.Serializable))
        {
            var rows = RowsTx(connection, tx, "SELECT CUIT,ISNULL(IDTipoDoc,0) AS IDTipoDoc,CASE WHEN ISNULL(Suspendido,0)<>0 THEN 1 ELSE 0 END AS Suspendido FROM dbo.Clientes WITH (UPDLOCK,HOLDLOCK) WHERE IDCliente=@p0", id);
            if (rows.Count != 1 || Number(rows[0]["Suspendido"]) != 0) throw new CustomerDocumentException("El cliente ya no está disponible.");
            if (Text(rows[0]["CUIT"]) != Text(Value(data, "documentoAnterior")) || Number(rows[0]["IDTipoDoc"]) != Number(Value(data, "tipoAnterior")))
                throw new CustomerDocumentException("Otro puesto modificó el documento de este cliente. Volvé a consultar antes de guardarlo.");
            var duplicates = CustomerDocumentDuplicates(connection, tx, id, document);
            if (duplicates.Count > 0) throw new CustomerDocumentException(CustomerDuplicateMessage(duplicates[0]));
            Execute(connection, tx, "UPDATE dbo.Clientes SET CUIT=@p1,IDTipoDoc=@p2 WHERE IDCliente=@p0", id, document, type);
            tx.Commit();
        }
        return new { ok = true, cliente = CustomerDetail(connection, id)[0] };
    }
    private static void AssertRegisteredCustomerDocument(SqlConnection connection, SqlTransaction tx, int id, int type, string document)
    {
        if (id <= 1) return;
        string error = CustomerDocumentError(type, document);
        if (error.Length > 0) throw new CustomerDocumentException(error);
        var rows = RowsTx(connection, tx, "SELECT CUIT,ISNULL(IDTipoDoc,0) AS IDTipoDoc,CASE WHEN ISNULL(Suspendido,0)<>0 THEN 1 ELSE 0 END AS Suspendido FROM dbo.Clientes WITH (UPDLOCK,HOLDLOCK) WHERE IDCliente=@p0", id);
        if (rows.Count != 1 || Number(rows[0]["Suspendido"]) != 0) throw new CustomerDocumentException("El cliente ya no está disponible.");
        if (CustomerDocumentDigits(Text(rows[0]["CUIT"])) != CustomerDocumentDigits(document) || Number(rows[0]["IDTipoDoc"]) != type)
            throw new CustomerDocumentException("Corregí y guardá el documento en la ficha del cliente antes de confirmar la boleta.");
        var duplicates = CustomerDocumentDuplicates(connection, tx, id, document);
        if (duplicates.Count > 0)
            throw new CustomerDocumentException("Hay una cuenta duplicada con el mismo DNI/CUIT. La boleta está bloqueada hasta resolver el duplicado. " + CustomerDuplicateMessage(duplicates[0]));
    }
    private static object SaveCustomer(SqlConnection connection, Dictionary<string, object> data)
    {
        int id = 0;
        if (Value(data, "id") != null && Text(Value(data, "id")) != "0") id = Id(Value(data, "id"));
        if (id == 1) throw new InvalidOperationException("No se puede modificar Consumidor Final desde Facturación.");
        if (id == 0)
        {
            var defaults = CustomerDefaults(connection);
            foreach (string field in new[] { "idDepartamento", "idProvincia", "idRegion", "idTipoIb" })
                if (Text(Value(data, field)).Length == 0 || Text(Value(data, field)) == "0") data[field] = defaults[field];
            if (Text(Value(data, "codigoPostal")).Length == 0) data["codigoPostal"] = defaults["codigoPostal"];
        }
        string name = Limited(Upper(Value(data, "nombre")), 100, "Razón social");
        if (name.Length < 2) throw new InvalidOperationException("Ingresá la razón social del cliente.");
        string document = Limited(Upper(Value(data, "documento")), 13, "Documento");
        if (document.Length == 0) throw new InvalidOperationException("Ingresá el número de documento o CUIT del cliente.");
        string contact = Limited(Upper(Value(data, "contacto")), 35, "Contacto");
        string address = Limited(Upper(Value(data, "direccion")), 100, "Dirección");
        string locality = Limited(Upper(Value(data, "localidad")), 50, "Localidad");
        string zip = Limited(Upper(Value(data, "codigoPostal")), 20, "Código postal");
        string phone = Limited(Upper(Value(data, "telefono")), 50, "Teléfono");
        string mobile = Limited(Upper(Value(data, "celular")), 50, "Celular");
        string email = Limited(Upper(Value(data, "email")), 150, "Email");
        string web = Limited(Upper(Value(data, "web")), 150, "Web");
        string cbu = Limited(Upper(Value(data, "cbu")), 22, "CBU");
        string alias = Limited(Upper(Value(data, "cbuAlias")), 100, "Alias");
        string note = Limited(Upper(Value(data, "nota")), 4000, "Nota");
        string iibbNumber = Limited(Upper(Value(data, "numeroIibb")), 20, "Número de Ingresos Brutos");
        DateTime dueDate;
        object iibbDue = Text(Value(data, "vencimientoIibb")).Length == 0 ? null :
            (DateTime.TryParseExact(Text(Value(data, "vencimientoIibb")), "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out dueDate)
                ? (object)dueDate : null);
        if (Text(Value(data, "vencimientoIibb")).Length > 0 && iibbDue == null)
            throw new InvalidOperationException("La fecha de vencimiento de Ingresos Brutos no es válida.");
        int department, province, region, iibb;
        if (!Int32.TryParse(Text(Value(data, "idDepartamento")), out department) || department < 0) department = 0;
        if (!Int32.TryParse(Text(Value(data, "idProvincia")), out province) || province < 0) province = 0;
        if (!Int32.TryParse(Text(Value(data, "idRegion")), out region) || region < 0) region = 0;
        if (!Int32.TryParse(Text(Value(data, "idTipoIb")), out iibb) || iibb < 0) iibb = 0;
        int commerce = RequiredId(Value(data, "idTipoComercio"), "el tipo de comercio");
        bool suspended = Text(Value(data, "suspendido")).Equals("True", StringComparison.OrdinalIgnoreCase);
        int iva = RequiredId(Value(data, "idTipoIva"), "la condición de IVA");
        int docType = RequiredId(Value(data, "idTipoDoc"), "el tipo de documento");
        int list = RequiredId(Value(data, "idLista"), "la lista de precios");
        int seller = RequiredId(Value(data, "idVendedor"), "el vendedor");
        int payment = RequiredId(Value(data, "idTipoPago"), "el tipo de pago");
        decimal limit = Number(Value(data, "limiteCredito"));
        decimal discount = Number(Value(data, "descuento"));
        if (limit < 0 || limit > 999999999 || discount < 0 || discount > 100)
            throw new InvalidOperationException("El límite de crédito o descuento no es válido.");
        using (var transaction = connection.BeginTransaction(IsolationLevel.Serializable))
        {
            try
            {
                if (id > 0 && Scalar(connection, transaction, "SELECT 1 FROM dbo.Clientes WITH (UPDLOCK,HOLDLOCK) WHERE IDCliente=@p0", id) == null)
                    throw new InvalidOperationException("El cliente ya no existe en SQL.");
                int mergedInto=id>1?CustomerMergeDestination(connection,transaction,id):0;
                if(mergedInto>0)throw new CustomerMergeRejected("Esta cuenta se unificó en el cliente ID "+mergedInto+". Modificá la cuenta principal.");
                var sameNames = RowsTx(connection, transaction,
                    "SELECT IDCliente FROM dbo.Clientes WITH (UPDLOCK,HOLDLOCK) WHERE [RazónSocial]=@p0 AND IDCliente<>@p1", name, id);
                if (sameNames.Exists(row=>CustomerMergeDestination(connection,transaction,Convert.ToInt32(row["IDCliente"]))==0))
                    throw new InvalidOperationException("Ya existe el cliente " + name + ".");
                var priorDocument = id > 0 ? RowsTx(connection, transaction, "SELECT CUIT,ISNULL(IDTipoDoc,0) AS IDTipoDoc FROM dbo.Clientes WHERE IDCliente=@p0", id) : new List<Dictionary<string, object>>();
                if (id == 0 || Text(priorDocument[0]["CUIT"]) != document || Number(priorDocument[0]["IDTipoDoc"]) != docType)
                {
                    string documentError = CustomerDocumentError(docType, document);
                    if (documentError.Length > 0) throw new CustomerDocumentException(documentError);
                    document = CustomerDocumentDigits(document);
                    var duplicates = CustomerDocumentDuplicates(connection, transaction, id, document);
                    if (duplicates.Count > 0) throw new CustomerDocumentException(CustomerDuplicateMessage(duplicates[0]));
                }
                if (id == 0) id = Convert.ToInt32(Scalar(connection, transaction, "SELECT ISNULL(MAX(IDCliente),0)+1 FROM dbo.Clientes WITH (TABLOCKX,HOLDLOCK)"));
                string sql;
                if (Value(data, "id") == null || Text(Value(data, "id")) == "0")
                    sql = "INSERT INTO dbo.Clientes (IDCliente,[RazónSocial],Contacto,[Dirección],LocalidadCli,CodPostal,[Teléfono],Fax,IDTipoIVA,IDTipoDoc,CUIT,TipoCli,IDVend,IDTipoPago,PorcDto,ImpCred,Email,Web,CBU,CBUAlias,Nota,IDLocalidad,IDProvincia,IDRegión,IDTipoIB,NroIIBB,FechaVtoExIB,IDTipoComer,Suspendido,FechaAlta,FechaIng) VALUES (@p0,@p1,@p2,@p3,@p4,@p5,@p6,@p7,@p8,@p9,@p10,@p11,@p12,@p13,@p14,@p15,@p16,@p17,@p18,@p19,@p20,@p21,@p22,@p23,@p24,@p25,@p26,@p27,@p28,GETDATE(),GETDATE())";
                else
                    sql = "UPDATE dbo.Clientes SET [RazónSocial]=@p1,Contacto=@p2,[Dirección]=@p3,LocalidadCli=@p4,CodPostal=@p5,[Teléfono]=@p6,Fax=@p7,IDTipoIVA=@p8,IDTipoDoc=@p9,CUIT=@p10,TipoCli=@p11,IDVend=@p12,IDTipoPago=@p13,PorcDto=@p14,ImpCred=@p15,Email=@p16,Web=@p17,CBU=@p18,CBUAlias=@p19,Nota=@p20,IDLocalidad=@p21,IDProvincia=@p22,IDRegión=@p23,IDTipoIB=@p24,NroIIBB=@p25,FechaVtoExIB=@p26,IDTipoComer=@p27,Suspendido=@p28 WHERE IDCliente=@p0";
                Execute(connection, transaction, sql, id, name, contact, address, locality, zip, phone, mobile, iva, docType, document, list, seller, payment, discount / 100m, limit, email, web, cbu, alias, note,
                    department == 0 ? null : (object)department, province == 0 ? null : (object)province, region == 0 ? null : (object)region, iibb == 0 ? null : (object)iibb,
                    iibbNumber, iibbDue, commerce, suspended);
                transaction.Commit();
            }
            catch (SqlException ex)
            {
                transaction.Rollback();
                if (ex.Number == 2601 || ex.Number == 2627)
                    throw new InvalidOperationException("Ya existe un cliente con esos datos. Buscalo en el campo Cliente y elegí Ver cliente para modificarlo.");
                throw;
            }
            catch { transaction.Rollback(); throw; }
        }
        return new { ok = true, cliente = CustomerDetail(connection, id)[0] };
    }
    private static string QueryUtf8(HttpListenerRequest request, string key)
    {
        // HttpListener puede usar la codificación local para un GET sin Content-Type.
        // URLSearchParams envía UTF-8: decodificarlo de forma explícita y una sola vez.
        foreach (string part in request.Url.Query.TrimStart('?').Split('&'))
        {
            int separator = part.IndexOf('=');
            string name = separator < 0 ? part : part.Substring(0,separator);
            if (Uri.UnescapeDataString(name.Replace("+"," ")) != key) continue;
            return separator < 0 ? "" : Uri.UnescapeDataString(part.Substring(separator+1).Replace("+"," "));
        }
        return "";
    }
    private static string Limited(object value, int max, string label)
    {
        string result = Text(value);
        if (result.Length > max) throw new InvalidOperationException(label + " excede el largo admitido por Access.");
        return result;
    }
    private static bool ValidCuit(string value)
    {
        string digits = value.Replace("-", "").Replace(" ", "");
        if (digits.Length != 11) return false;
        int[] weights = { 5,4,3,2,7,6,5,4,3,2 };
        int sum = 0;
        for (int i = 0; i < digits.Length; i++) if (digits[i] < '0' || digits[i] > '9') return false;
        for (int i = 0; i < 10; i++) sum += (digits[i] - '0') * weights[i];
        int check = 11 - sum % 11;
        return check != 10 && digits[10] - '0' == (check == 11 ? 0 : check);
    }
    private static int LocalOperator(SqlConnection connection, SqlTransaction tx = null)
    {
        // Configuración local de la API, independiente del MDB y del vendedor elegido.
        int operatorId;
        string path = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "facturacion-operador.json");
        if (!File.Exists(path))
            throw new InvalidOperationException("Falta facturacion-operador.json junto a la API de facturación.");
        var settings = Object(Json.DeserializeObject(File.ReadAllText(path, Encoding.UTF8)));
        if (!Int32.TryParse(Text(Value(settings, "IDOper")), out operatorId) || operatorId <= 0)
            throw new InvalidOperationException("Configurá un IDOper válido en facturacion-operador.json.");
        if (Scalar(connection, tx, "SELECT IDEmpleado FROM dbo.Empleados WHERE IDEmpleado=@p0 AND Susp=0", operatorId) == null)
            throw new InvalidOperationException("El operador configurado en la API no existe en SQL o está suspendido.");
        return operatorId;
    }
    private static int UserOperator(SqlConnection connection, string userId)
    {
        if (String.IsNullOrWhiteSpace(userId) || userId.Length > 150)
            throw new InvalidOperationException("Iniciá sesión desde el menú para usar tu operador SQL.");
        Dictionary<string, object> fields;
        try
        {
            string url = "https://firestore.googleapis.com/v1/projects/corralon-progreso/databases/(default)/documents/menuUsuarios/" + Uri.EscapeDataString(userId)
                + "?mask.fieldPaths=idOperador&key=AIzaSyCxwUGX-rVusOI13j7oTfQuAtkeNXdAYH0";
            var request = (HttpWebRequest)WebRequest.Create(url); request.Timeout = 8000;
            using (var response = request.GetResponse()) using (var reader = new StreamReader(response.GetResponseStream(), Encoding.UTF8))
                fields = Object(Value(Object(Json.DeserializeObject(reader.ReadToEnd())), "fields"));
        }
        catch { throw new InvalidOperationException("No se pudo consultar el operador asignado en Usuarios. Reintentá cuando vuelva la conexión."); }
        var field = Object(Value(fields, "idOperador"));
        object assigned = Value(field, "integerValue") ?? Value(field, "doubleValue") ?? Value(field, "stringValue");
        int id;
        if (!Int32.TryParse(Text(assigned), out id) || id <= 0)
            throw new InvalidOperationException("Tu usuario no tiene ID operador SQL asignado. Configuralo en Usuarios.");
        if (Scalar(connection, null, "SELECT IDEmpleado FROM dbo.Empleados WHERE IDEmpleado=@p0 AND Susp=0", id) == null)
            throw new InvalidOperationException("El operador asignado en Usuarios no existe en SQL o está suspendido.");
        return id;
    }
    private static bool InvoiceDateAllowed(DateTime date, DateTime today)
    {
        return date.Date >= today.Date.AddDays(-5) && date.Date <= today.Date;
    }
    private static void AssertBackdatedInvoicePermission(Dictionary<string, object> invoice, DateTime date, DateTime today, string permission = "facturacion")
    {
        if(date.Date==today.Date)return;
        string userId=Text(Value(invoice,"usuarioId")).Trim();
        if(userId.Length==0)throw new InvalidOperationException("Solo los administradores pueden emitir con fecha anterior. Iniciá sesión y usá la fecha de hoy.");
        Dictionary<string,object> document;
        try
        {
            string url="https://firestore.googleapis.com/v1/projects/corralon-progreso/databases/(default)/documents/menuUsuarios/"+Uri.EscapeDataString(userId)+"?key=AIzaSyCxwUGX-rVusOI13j7oTfQuAtkeNXdAYH0";
            var request=(HttpWebRequest)WebRequest.Create(url);request.Method="GET";request.Timeout=6000;
            using(var response=request.GetResponse())using(var reader=new StreamReader(response.GetResponseStream(),Encoding.UTF8))document=Object(Json.DeserializeObject(reader.ReadToEnd()));
        }
        catch { throw new InvalidOperationException("No se pudo verificar el permiso de administrador. Usá la fecha de hoy o reintentá cuando vuelva la conexión."); }
        string level=Text(Value(Object(Value(Object(Value(document,"fields")),"nivel")),"stringValue")).Trim();
        if(!String.Equals(level,"administrador",StringComparison.OrdinalIgnoreCase)&&!UserHasModuleEditPermission(Object(Value(document,"fields")),permission))throw new InvalidOperationException("Solo los administradores pueden emitir con fecha anterior. La fecha debe ser la de hoy.");
    }
    private static void AssertStoredInvoice(SqlConnection connection, SqlTransaction tx, int receipt, Dictionary<string, object> invoice)
    {
        var headers = RowsTx(connection, tx, "SELECT IDDepósito AS point,IDComprob AS type,IDCliente AS customer,ApeYNom AS name,CONVERT(varchar(10),Fecha,23) AS date,TotalME AS total,Confirmado AS confirmed,Anulada AS cancelled FROM dbo.FacturasATP WHERE IDRecibo=@p0", receipt);
        var articles = RowsTx(connection, tx, "SELECT IDArt AS idart,Cantidad AS cantidad,PrecioUni AS precio,ArtDesc AS descripcion FROM dbo.FacturasATS WHERE IDRecibo=@p0 ORDER BY Orden", receipt);
        var payments = RowsTx(connection, tx, "SELECT IDTipoPago AS idTipoPago,Importe AS importe,ImpRec AS impRec,Cuotas AS cuotas,IDTarjeta AS idTarjeta FROM dbo.FacturasTSVal WHERE IDRecibo=@p0 ORDER BY Orden", receipt);
        var items = Value(invoice, "articulos") as System.Collections.ArrayList;
        var values = Value(invoice, "valores") as System.Collections.ArrayList;
        bool matches = headers.Count == 1 && items != null && values != null && articles.Count == items.Count && payments.Count == values.Count;
        if (matches)
        {
            var h = headers[0];
            matches = Number(h["confirmed"]) == -1 && Number(h["cancelled"]) == 0 &&
                Number(h["point"]) == Number(Value(invoice, "idPuntoVenta")) && Number(h["type"]) == Number(Value(invoice, "idComprobante")) &&
                Number(h["customer"]) == Number(Value(invoice, "idCliente")) && Text(h["date"]) == Text(Value(invoice, "fecha")) &&
                String.Equals(Text(h["name"]).Trim(), Text(Value(Object(Value(invoice, "cliente")), "nombre")).Trim(), StringComparison.OrdinalIgnoreCase) &&
                Math.Abs(Number(h["total"]) - Number(Value(Object(Value(invoice, "totales")), "total"))) <= .01m;
            for (int i = 0; matches && i < items.Count; i++)
            {
                var row = Object(items[i]); var saved = articles[i];
                matches = Number(saved["idart"]) == Number(Value(row, "idart")) &&
                    Math.Abs(Number(saved["cantidad"]) - Number(Value(row, "cantidad"))) <= .0001m &&
                    Math.Abs(Number(saved["precio"]) - Number(Value(row, "precio"))) <= .0001m &&
                    String.Equals(Text(saved["descripcion"]).Trim(), Limited(Value(row, "descripcion"), 150, "Descripción"), StringComparison.OrdinalIgnoreCase);
            }
            for (int i = 0; matches && i < values.Count; i++)
            {
                var row = Object(values[i]); var saved = payments[i];
                matches = Number(saved["idTipoPago"]) == Number(Value(row, "idTipoPago")) &&
                    Number(saved["idTarjeta"] == DBNull.Value ? (object)0 : saved["idTarjeta"]) == Number(Value(row, "idTarjeta") ?? (object)0) && Number(saved["cuotas"] == DBNull.Value ? (object)0 : saved["cuotas"]) == Number(Value(row, "cuotas") ?? (object)0) &&
                    Math.Abs(Number(saved["importe"]) - Number(Value(row, "importe"))) <= .01m && Math.Abs(Number(saved["impRec"]) - Number(Value(row, "impRec"))) <= .01m;
            }
        }
        if (!matches) throw new SaleReviewException("Este borrador ya está asociado a otra venta o sus datos cambiaron. No se emitió ni vinculó otra boleta.");
    }
    private static object Emit(SqlConnection connection, Dictionary<string, object> invoice, bool dryRun, bool recoveryOnly)
    { lock(FiscalGate) { return EmitCore(connection,invoice,dryRun,recoveryOnly); } }
    private static object EmitCore(SqlConnection connection, Dictionary<string, object> invoice, bool dryRun, bool recoveryOnly)
    {
        Guid pendingId;
        if(Guid.TryParse(Text(Value(invoice,"id")),out pendingId) && File.Exists(PendingDraftPath(pendingId))) {
            var saved=Object(Json.DeserializeObject(Encoding.UTF8.GetString(ProtectedData.Unprotect(File.ReadAllBytes(PendingDraftPath(pendingId)),null,DataProtectionScope.CurrentUser))));
            var original=Object(Value(saved,"comprobante"));
            if(InvoiceValueNumber(Value(original,"facturarOrigenId"))>0 &&
                (Text(Value(original,"facturarOrigenId"))!=Text(Value(invoice,"facturarOrigenId")) || Text(Value(original,"facturarOrigenVersion"))!=Text(Value(invoice,"facturarOrigenVersion"))))
                throw new InvalidOperationException("Esta emisión corresponde a una boleta X. Recuperala desde Ventas con Tarjeta para conservar sus opciones de stock e informe de ventas.");
        }
        int cardSource=(int)InvoiceValueNumber(Value(invoice,"facturarOrigenId"));
        bool cardConversion=cardSource>0;
        if(cardConversion)AssertPurchasePermission(Text(Value(invoice,"usuarioId")),"ventas_tarjeta",true);
        int typeId = RequiredId(Value(invoice, "idComprobante"), "el comprobante");
        if (Array.IndexOf(new[] { 1,2,5,6,7,8,13,29,43 }, typeId) < 0)
            throw new InvalidOperationException("Tipo de comprobante no admitido para esta pantalla.");
        bool fiscal = typeId == 1 || typeId == 2 || typeId == 5 || typeId == 6 || typeId == 7 || typeId == 8;
        bool returnType = typeId == 5 || typeId == 6 || typeId == 29, quotation = typeId == 43;
        int sign = returnType ? -1 : 1;
        int point = RequiredId(Value(invoice, "idPuntoVenta"), "el punto de venta"), seller = RequiredId(Value(invoice, "vendedor"), "el vendedor");
        int customer = RequiredId(Value(invoice, "idCliente"), "un cliente de la base local"), list = RequiredId(Value(invoice, "listaPrecios"), "la lista de precios");
        if (list > 3) throw new InvalidOperationException("Lista de precios inválida.");
        string name = Limited(Value(Object(Value(invoice, "cliente")), "nombre"), 100, "Nombre del cliente").ToUpperInvariant();
        if (name.Length < 2 || name == "CONSUMIDOR FINAL") throw new InvalidOperationException("Ingresá el nombre del cliente, como exige Access.");
        DateTime date;
        Guid recoveryDraftId;
        bool savedAuthorization = fiscal && Guid.TryParse(Text(Value(invoice, "id")), out recoveryDraftId)
            && File.Exists(RecoveryPath(recoveryDraftId));
        if (!DateTime.TryParseExact(Text(Value(invoice, "fecha")), "yyyy-MM-dd", System.Globalization.CultureInfo.InvariantCulture,
            System.Globalization.DateTimeStyles.None, out date) || (!savedAuthorization && !InvoiceDateAllowed(date, DateTime.Today)))
            throw new InvalidOperationException("La fecha debe estar entre hoy y los 5 días corridos anteriores. No se permiten fechas futuras.");
        if(!savedAuthorization)AssertBackdatedInvoicePermission(invoice,date,DateTime.Today,cardConversion?"ventas_tarjeta":"facturacion");
        var items = Value(invoice, "articulos") as System.Collections.ArrayList;
        var payments = Value(invoice, "valores") as System.Collections.ArrayList;
        if (items == null || items.Count == 0 || items.Count > 200) throw new InvalidOperationException("Agregá entre 1 y 200 artículos.");
        if (payments == null || payments.Count == 0 || payments.Count > 30) throw new InvalidOperationException("Cargá los valores recibidos.");
        string draft = Limited(Value(invoice, "id"), 80, "Identificador del borrador");
        Guid draftId;
        if (!Guid.TryParse(draft, out draftId)) throw new InvalidOperationException("El borrador no tiene un identificador válido.");
        if(File.Exists(ReviewResolutionPath(draftId)))throw new InvalidOperationException("Este intento fue cerrado o tiene otro borrador en corrección. No puede volver a emitirse.");
        string fiscalRecovery = RecoveryPath(draftId);
        int oper = UserOperator(connection, Text(Value(invoice, "usuarioId")));
        var client = Object(Value(invoice, "cliente"));
        string docType = Text(Value(client, "tipoDocumento"));
        int docId = docType == "CUIT" ? 67 : docType == "DNI" ? 50 : docType == "Sin identificar" ? 32 : 0;
        if (docId == 0) throw new InvalidOperationException("Tipo de documento no admitido para la emisión.");
        string doc = Limited(Value(client, "numeroDocumento"), 13, "Documento");
        if (customer > 1 && !savedAuthorization)
        {
            string documentError = CustomerDocumentError(docId, doc);
            if (documentError.Length > 0) throw new CustomerDocumentException(documentError);
            doc = CustomerDocumentDigits(doc);
        }
        if (doc.Length > 0 && (!System.Text.RegularExpressions.Regex.IsMatch(doc, @"^[0-9]+(?:-[0-9]+)*$") || (docType != "CUIT" && doc.IndexOf('-') >= 0)))
            throw new InvalidOperationException("Documento inválido: corregí el DNI/CUIT. No se envió a ARCA ni se guardó la venta en SQL.");
        if (docType == "CUIT" && doc.Replace("-", "").Length != 11)
            throw new InvalidOperationException("CUIT inválido: debe tener 11 números. No se envió a ARCA ni se guardó la venta en SQL.");
        // Access conserva el documento mostrado; ARCA recibe tipo 99/número 0 para el consumidor sin identificar.
        string sqlDocument = doc;
        int sqlDocumentType = docId;
        string address = Limited(Value(client, "direccion"), 100, "Dirección");
        string phone = Limited(Value(client, "telefono"), 50, "Teléfono");
        string note = Limited(Value(invoice, "nota"), 160, "Nota");
        FiscalResult authorization = null;
        bool fiscalCallStarted = false;
        bool pendingDraftCreated = false;
        string fiscalNumber = "";
        string ivaName = Text(Value(client, "condicionIva"));
        int ivaType = ivaName == "Responsable inscripto" ? 1 :
            ivaName == "Responsable no inscripto" ? 2 :
            ivaName == "No responsable" ? 3 :
            ivaName == "Exento" ? 4 :
            ivaName == "Consumidor final" ? 5 :
            ivaName == "Monotributista" ? 6 : 0;
        // Los IDs 2 y 3 son de Access; ARCA usa otra tabla para la condición del receptor.
        int conditionIvaId = ivaType == 2 ? 7 : ivaType == 3 ? 15 : ivaType;
        if (fiscal && conditionIvaId == 0)
            throw new InvalidOperationException("Elegí una condición de IVA válida para el receptor antes de facturar.");
        using (var tx = connection.BeginTransaction(IsolationLevel.Serializable))
        {
            try
            {
                // Se conserva el GUID en un campo no impreso para reconocer reintentos.
                string marker = DraftMarker(draftId);
                Dictionary<string,object> cardOrigin=null;
                if(cardConversion){
                    if(typeId!=1&&typeId!=2)throw new InvalidOperationException("Elegí Factura A o B.");
                    if(draftId!=CardFiscalDraftId(cardSource))throw new InvalidOperationException("Identificador de facturación de boleta inválido.");
                    if(Number(Scalar(connection,tx,"DECLARE @r int; EXEC @r=sp_getapplock @Resource=@p0,@LockMode='Exclusive',@LockOwner='Transaction',@LockTimeout=10000; SELECT @r","CorralonWeb.FacturarX."+cardSource))<0)throw new InvalidOperationException("Esta boleta se está facturando en otro equipo.");
                    var linked=RowsTx(connection,tx,"SELECT IDComprob,NroFactura FROM dbo.FacturasATP WITH(UPDLOCK,HOLDLOCK) WHERE NroOTrab=@p0 AND Confirmado=-1",marker);
                    if(linked.Count>0&&(linked.Count!=1||Number(linked[0]["IDComprob"])!=typeId))throw new InvalidOperationException("Esta boleta ya tiene una factura emitida. Consultala antes de continuar.");
                    cardOrigin=AssertCardFiscalOrigin(connection,tx,invoice);
                    if(Number(Scalar(connection,tx,"SELECT COUNT(*) FROM dbo.FacturasATP WITH(UPDLOCK,HOLDLOCK) WHERE IDEmp=1 AND IDComprob IN(1,2) AND Confirmado=-1 AND Anulada=0 AND NroFacNC=@p0 AND ISNULL(NroOTrab,'')<>@p1",cardOrigin["NroFactura"],marker))>0)throw new InvalidOperationException("La boleta X ya está vinculada a otra factura. Consultala antes de continuar.");
                }
                object existing = Scalar(connection, tx, "SELECT TOP 1 IDRecibo FROM dbo.FacturasATP WITH (UPDLOCK,HOLDLOCK) WHERE IDComprob=@p0 AND NroOTrab=@p1 ORDER BY IDRecibo DESC", typeId, marker);
                if (existing != null && existing != DBNull.Value)
                {
                    int prior = Convert.ToInt32(existing);
                    AssertStoredInvoice(connection, tx, prior, invoice);
                    var found = Scalar(connection, tx, "SELECT NroFactura FROM dbo.FacturasATP WHERE IDRecibo=@p0 AND Confirmado=-1", prior);
                    if (found == null) throw new InvalidOperationException("Ya existe un intento previo con este borrador. Revisá el comprobante " + prior + " en Access.");
                    tx.Commit();
                    try { if (File.Exists(fiscalRecovery)) File.Delete(fiscalRecovery); } catch { }
                    DeletePendingDraft(draftId);
                    return new { ok = true, idRecibo = prior, numero = Text(found), yaEmitido = true };
                }
                if (!savedAuthorization) AssertRegisteredCustomerDocument(connection, tx, customer, docId, doc);
                var pointInfo = Scalar(connection, tx, "SELECT IDSucAsoc FROM dbo.[Depósitos] WHERE IDDepósito=@p0 AND IDEmp=1", point);
                if (pointInfo == null) throw new InvalidOperationException("Punto de venta inválido.");
                int branch = Convert.ToInt32(pointInfo);
                if (!CajaSucursalAbierta(connection, tx, branch))
                    throw new InvalidOperationException("La caja de esta sucursal está cerrada.");
                if (Scalar(connection, tx, "SELECT 1 FROM dbo.TiposCompXPV WHERE IDPtoVta=@p0 AND IDComprob=@p1", point, typeId) == null)
                    throw new InvalidOperationException("El comprobante no está habilitado en este punto de venta.");
                int afipType = 0;
                string associatedNumber = Limited(Value(invoice, "facturaAsociada"), 13, "Comprobante asociado");
                int associatedReceipt;
                if (!Int32.TryParse(Text(Value(invoice, "idFacturaAsociada")), out associatedReceipt) || associatedReceipt < 0) associatedReceipt = 0;
                if (typeId != 5 && typeId != 6 && typeId != 7 && typeId != 8 && typeId != 29) associatedNumber = "";
                int associatedType = 0;
                DateTime associatedDate = DateTime.MinValue;
                string companyCuit = "";
                if (fiscal)
                {
                    if (customer == 1 && docId == 50 && (doc.Length == 0 || doc == "00000001000" || doc == "00001000000")) { docId = 32; doc = ""; }
                    object afip = Scalar(connection, tx,
                        "SELECT IDTipoAFIP FROM dbo.TipoComprobantes WHERE IDComprob=@p0 AND EnLibroIVA=1", typeId);
                    if (afip == null || !Int32.TryParse(Text(afip), out afipType) || afipType < 1)
                        throw new InvalidOperationException("Falta el código fiscal de este comprobante.");
                    if (Scalar(connection, tx, "SELECT 1 FROM dbo.[Depósitos] WHERE IDDepósito=@p0 AND FE=1", point) == null)
                        throw new InvalidOperationException("El punto de venta no está habilitado para factura electrónica.");
                    companyCuit = Text(Scalar(connection, tx, "SELECT CUIT FROM dbo.Empresa WHERE IDEmpresa=1")).Replace("-", "").Replace(" ", "");
                    if (!ValidCuit(companyCuit)) throw new InvalidOperationException("El CUIT emisor no es válido.");
                    if (associatedNumber.Length > 0)
                    {
                        if (!System.Text.RegularExpressions.Regex.IsMatch(associatedNumber, @"^\d{4}-\d{8}$"))
                            throw new InvalidOperationException("El comprobante asociado debe tener formato 0000-00000000.");
                        int expectedAssociatedType = afipType == 2 || afipType == 3 ? 1 : 6;
                        using (var command = new SqlCommand(
                            "SELECT TOP 1 tc.IDTipoAFIP,h.Fecha FROM dbo.FacturasATP h JOIN dbo.TipoComprobantes tc ON tc.IDComprob=h.IDComprob WHERE h.NroFactura=@p0 AND tc.IDTipoAFIP=@p1 AND h.IDCliente=@p2 AND (@p2<>1 OR UPPER(LTRIM(RTRIM(h.ApeYNom)))=@p3) AND (@p4=0 OR h.IDRecibo=@p4) AND h.Confirmado=-1 AND h.Anulada=0 AND LEN(h.CAE)=14 ORDER BY h.IDRecibo DESC", connection, tx))
                        {
                            command.Parameters.AddWithValue("@p0", associatedNumber);
                            command.Parameters.AddWithValue("@p1", expectedAssociatedType.ToString("000"));
                            command.Parameters.AddWithValue("@p2", customer);
                            command.Parameters.AddWithValue("@p3", name.Trim().ToUpperInvariant());
                            command.Parameters.AddWithValue("@p4", associatedReceipt);
                            using (var reader = command.ExecuteReader())
                            {
                                if (!reader.Read() || !Int32.TryParse(Text(reader.GetValue(0)), out associatedType))
                                    throw new InvalidOperationException("No se encontró un comprobante fiscal autorizado con ese número.");
                                associatedDate = reader.GetDateTime(1);
                            }
                        }
                        if (associatedType != expectedAssociatedType)
                            throw new InvalidOperationException("El comprobante asociado debe ser una factura del mismo tipo A o B.");
                    }
                    else if (returnType) throw new InvalidOperationException("La nota de crédito necesita una factura asociada, como exige Access.");
                    if (returnType && associatedReceipt == 0)
                        throw new InvalidOperationException("Buscá y seleccioná la factura original de SQL antes de emitir la nota de crédito.");
                    if (typeId == 1 || typeId == 5 || typeId == 7)
                    {
                        if (ivaType != 1 || docId != 67 || !ValidCuit(doc))
                            throw new InvalidOperationException("El comprobante A requiere cliente responsable inscripto y CUIT válido.");
                    }
                    else if (docId == 50 && !System.Text.RegularExpressions.Regex.IsMatch(doc.Replace(".", ""), @"^\d{7,8}$"))
                        throw new InvalidOperationException("El DNI del receptor debe tener 7 u 8 dígitos.");
                    else if (docId == 67 && !ValidCuit(doc))
                        throw new InvalidOperationException("El CUIT del receptor no es válido.");
                }
                if (typeId == 29 && associatedNumber.Length > 0)
                {
                    if (associatedReceipt == 0 || !System.Text.RegularExpressions.Regex.IsMatch(associatedNumber, @"^\d{4}-\d{8}$"))
                        throw new InvalidOperationException("Buscá y seleccioná la boleta original de SQL, o dejá el campo vacío.");
                    if (Scalar(connection, tx,
                        "SELECT 1 FROM dbo.FacturasATP WHERE IDRecibo=@p0 AND NroFactura=@p1 AND IDComprob IN (1,2,13) AND IDCliente=@p2 AND Confirmado=-1 AND Anulada=0 AND (IDComprob=13 OR LEN(CAE)=14)",
                        associatedReceipt, associatedNumber, customer) == null)
                        throw new InvalidOperationException("La boleta original seleccionada ya no está disponible para este cliente.");
                }
                if (Scalar(connection, tx, "SELECT 1 FROM dbo.Empleados WHERE IDEmpleado=@p0 AND Susp=0", seller) == null)
                    throw new InvalidOperationException("Vendedor no disponible.");
                if (Scalar(connection, tx, "SELECT 1 FROM dbo.Clientes WHERE IDCliente=@p0 AND Suspendido=0", customer) == null)
                    throw new InvalidOperationException("Cliente no disponible.");
                if (customer == 1 && doc.Length == 0 && docId == 50)
                    doc = Text(Scalar(connection, tx, "SELECT CUIT FROM dbo.Clientes WHERE IDCliente=1"));
                if (ivaType == 0) throw new InvalidOperationException("Condición de IVA inválida.");
                if ((ivaType == 1 || ivaType == 4 || ivaType == 6) && !ValidCuit(doc))
                    throw new InvalidOperationException("Para esta condición de IVA, Access exige un CUIT válido.");
                decimal gross = 0, net = 0, net21 = 0, net105 = 0, iva21 = 0, iva105 = 0, other = 0;
                var lines = new List<object[]>();
                foreach (object item in items)
                {
                    var row = Object(item);
                    string id = Limited(Value(row, "idart"), 20, "IDArt");
                    object[] article;
                    using (var cmd = new SqlCommand("SELECT a.[Descripción],a.PorcIVA1,a.PrecioCpraCI,a.UniMed,ISNULL(s.StockAct,0),a.EnStock,a.IDMoneda,CASE WHEN a.IDMoneda=1 THEN CONVERT(decimal(18,4),1) ELSE m.ImpCotiz END FROM dbo.[Artículos] a LEFT JOIN dbo.ArtsStock s ON s.IDArt=a.IDArt AND s.IDSuc=@p1 LEFT JOIN dbo.Monedas m ON m.IDMoneda=a.IDMoneda WHERE a.IDArt=@p0 AND a.Suspendido=0", connection, tx))
                    {
                        cmd.Parameters.AddWithValue("@p0", id); cmd.Parameters.AddWithValue("@p1", branch);
                        using (var reader = cmd.ExecuteReader())
                        {
                            if (!reader.Read()) throw new InvalidOperationException("El artículo " + id + " ya no existe.");
                            article = new object[8]; reader.GetValues(article);
                            if (reader.Read()) throw new InvalidOperationException("Stock duplicado para el artículo " + id + ".");
                        }
                    }
                    decimal qty = Number(Value(row, "cantidad")), price = Number(Value(row, "precio")), basePrice = Number(Value(row, "precioBase"));
                    decimal discount = Number(Value(row, "descuento"));
                    if (qty <= 0 || qty > 100000 || price < 0 || price > 1000000000 || discount < -1000 || discount > 100)
                        throw new InvalidOperationException("Cantidad, precio o descuento inválido en " + id + ".");
                    decimal iva = article[1] == DBNull.Value ? 0 : Convert.ToDecimal(article[1]);
                    decimal shownIva = Number(Value(row, "iva")) / 100m;
                    if (Math.Abs(shownIva - iva) > .0001m) throw new InvalidOperationException("Cambió el IVA del artículo " + id + ". Recargá el catálogo.");
                    price = Decimal.Round(price, 4, MidpointRounding.AwayFromZero);
                    decimal amount = Decimal.Round(qty * price, 2, MidpointRounding.AwayFromZero);
                    decimal tax = iva > 0 ? Decimal.Round(amount - amount / (1 + iva), 2, MidpointRounding.AwayFromZero) : 0;
                    decimal lineNet = amount - tax;
                    gross += amount; net += lineNet;
                    if (fiscal && iva > 0 && Math.Abs(iva - .21m) >= .0001m && Math.Abs(iva - .105m) >= .0001m)
                        throw new InvalidOperationException("El artículo " + id + " tiene una alícuota que todavía no está configurada para ARCA.");
                    if (Math.Abs(iva - .21m) < .0001m) { iva21 += tax; net21 += lineNet; }
                    else if (Math.Abs(iva - .105m) < .0001m) { iva105 += tax; net105 += lineNet; }
                    else other += tax;
                    decimal rate = article[7] == DBNull.Value ? 0 : Convert.ToDecimal(article[7]);
                    if (rate <= 0) throw new InvalidOperationException("Falta la cotización de la moneda del artículo " + id + ".");
                    if (Convert.ToInt32(article[6]) != 1 && Math.Abs(Number(Value(row, "cotizacion")) - rate) > .0001m)
                        throw new InvalidOperationException("La cotización del artículo " + id + " cambió o no estaba cargada. Volvé a seleccionarlo del catálogo antes de emitir.");
                    decimal cost = (article[2] == DBNull.Value ? 0 : Convert.ToDecimal(article[2])) * rate;
                    decimal gain = Decimal.Round(amount - cost * qty, 2, MidpointRounding.AwayFromZero);
                    decimal margin = cost == 0 ? 0 : price / cost - 1;
                    lines.Add(new object[] { id, qty, price, amount, tax, gain, iva, discount / 100m, cost,
                        Limited(Value(row, "descripcion"), 150, "Descripción"), lineNet / qty, list,
                        basePrice > 0 ? basePrice : price, price / rate, StockNumber(article[4]), margin, article[3] == DBNull.Value ? null : article[3],
                        article[5] != DBNull.Value && Convert.ToBoolean(article[5]) });
                }
                if (gross <= 0 || gross > 1000000000) throw new InvalidOperationException("Total fuera de rango.");
                decimal paid = 0, paidBase = 0, adjustment = 0, cash = 0, bank = 0, card = 0, account = 0;
                var valueLines = new List<object[]>();
                foreach (object value in payments)
                {
                    var row = Object(value);
                    int paymentId = RequiredId(Value(row, "idTipoPago"), "el tipo de valor recibido");
                    object kind = Scalar(connection, tx, "SELECT IDClasePago FROM dbo.TiposPagos WHERE IDTipoPago=@p0 AND EnCaja=1", paymentId);
                    if (kind == null) throw new InvalidOperationException("Medio de pago inválido.");
                    int cls = Convert.ToInt32(kind);
                    if (cls == 2) throw new InvalidOperationException("Los cheques necesitan datos y validaciones que esta pantalla todavía no recoge.");
                    if (paymentId == 14) throw new InvalidOperationException("El pago en dólares requiere una cotización y no está habilitado en esta pantalla.");
                    decimal amount = Number(Value(row, "importe"));
                    if (amount <= 0 || amount > gross) throw new InvalidOperationException("Importe de pago inválido.");
                    int installments = Value(row, "cuotas") == null ? 0 : Convert.ToInt32(Number(Value(row, "cuotas")));
                    if (installments < 0 || installments > 99) throw new InvalidOperationException("Cantidad de cuotas inválida.");
                    decimal coefficient = Value(row, "coef") == null ? 0 : Number(Value(row, "coef"));
                    decimal fee = Value(row, "impRec") == null ? 0 : Number(Value(row, "impRec"));
                    if (coefficient < -1 || coefficient > 5 || Math.Abs(fee - Decimal.Round(amount * coefficient, 2, MidpointRounding.AwayFromZero)) > .01m)
                        throw new InvalidOperationException("El porcentaje y el descuento/recargo del valor recibido no coinciden.");
                    decimal finalAmount = amount + fee;
                    if (finalAmount < 0) throw new InvalidOperationException("El total del valor recibido no puede ser negativo.");
                    int cardId = 0;
                    if (cls == 3 || cls == 5)
                    {
                        cardId = RequiredId(Value(row, "idTarjeta"), cls == 5 ? "la tarjeta" : "la cuenta de la transferencia");
                        if (Scalar(connection, tx, "SELECT 1 FROM dbo.Tarjetas WHERE IDTarjeta=@p0 AND Susp=0", cardId) == null)
                            throw new InvalidOperationException("La tarjeta o cuenta no está disponible en Access.");
                        if (cls == 5)
                        {
                            if (installments < 1 || Scalar(connection, tx, "SELECT 1 FROM dbo.TarjetasCuotas WHERE IDTipoPago=@p0 AND Cuotas=@p1", cardId, installments) == null)
                                throw new InvalidOperationException("Elegí un plan de cuotas vigente para esa tarjeta.");
                            card += finalAmount;
                        }
                        else { if (installments != 0) throw new InvalidOperationException("La transferencia no admite cuotas."); bank += finalAmount; }
                    }
                    else if (cls == 6) { if (customer == 1) throw new InvalidOperationException("Cuenta corriente requiere un cliente registrado."); if (installments != 0) throw new InvalidOperationException("Cuenta corriente no admite cuotas en esta pantalla."); account += finalAmount; }
                    else if (cls == 1) { if (installments != 0) throw new InvalidOperationException("Este medio de pago no admite cuotas."); cash += finalAmount; }
                    else throw new InvalidOperationException("Medio de pago no admitido en este comprobante.");
                    paidBase += amount; paid += finalAmount; adjustment += fee;
                    valueLines.Add(new object[] { paymentId, amount, fee, finalAmount, installments, cardId, coefficient, Limited(Value(row, "descripcion"), 30, "Concepto") });
                }
                decimal grandTotal = gross + adjustment;
                if(cardConversion&&Math.Abs(grandTotal-Math.Abs(Number(cardOrigin["Total"])))>.005m)throw new InvalidOperationException("El total recalculado no coincide con la boleta X. No se solicitó CAE.");
                if (grandTotal <= 0 || Math.Abs(paidBase - gross) > .005m || Math.Abs(paid - grandTotal) > .005m)
                    throw new InvalidOperationException("Los valores recibidos no coinciden con el total recalculado en SQL. Artículos: " + gross.ToString("N2", CultureInfo.GetCultureInfo("es-AR")) + "; importes de pago sin dto./rec.: " + paidBase.ToString("N2", CultureInfo.GetCultureInfo("es-AR")) + "; total con dto./rec.: " + grandTotal.ToString("N2", CultureInfo.GetCultureInfo("es-AR")) + "; valores recibidos: " + paid.ToString("N2", CultureInfo.GetCultureInfo("es-AR")) + ". Revisá Valores recibidos.");
                if (account > 0 && !returnType && !quotation)
                {
                    object credit = Scalar(connection, tx,
                        "SELECT ISNULL(c.ImpCred,0)-ISNULL(c.SaldoCC,0)-" +
                        "ISNULL((SELECT SUM(v.ImpEnt*tc.ImpPor) FROM dbo.FacturasATP h JOIN dbo.FacturasTSVal v ON v.IDRecibo=h.IDRecibo JOIN dbo.TipoComprobantes tc ON tc.IDComprob=h.IDComprob WHERE h.IDCliente=c.IDCliente AND h.IDEmp=1 AND h.Anulada=0 AND h.Confirmado=-1 AND v.IDTipoPago=3 AND tc.IDTipoAcred>0),0)+" +
                        "ISNULL((SELECT SUM(r.Total) FROM dbo.RecibosXTP r WHERE r.IDCliente=c.IDCliente AND r.IDEmp=1 AND r.Anulado=0 AND r.Confirmado=1),0) FROM dbo.Clientes c WHERE c.IDCliente=@p0",
                        customer);
                    if (credit == null || Convert.ToDecimal(credit) < account) throw new InvalidOperationException("Cupo excedido. La cuenta corriente supera el crédito disponible.");
                }
                // Access usa DMax por comprobante y punto. TABLOCKX evita carreras también con altas desde Access.
                object maxObj = Scalar(connection, tx,
                    "SELECT MAX(TRY_CONVERT(int,RIGHT(NroFactura,8))) FROM dbo.FacturasATP WITH (TABLOCKX,HOLDLOCK) WHERE IDComprob=@p0 AND IDDepósito=@p1 AND Confirmado=-1 AND NroFactura LIKE @p2",
                    typeId, point, point.ToString("0000") + "-________");
                int next = maxObj == null || maxObj == DBNull.Value ? 1 : Convert.ToInt32(maxObj) + 1;
                if (fiscal && !dryRun)
                {
                    if (File.Exists(fiscalRecovery))
                    {
                        var saved = Object(Json.DeserializeObject(Encoding.UTF8.GetString(
                            ProtectedData.Unprotect(File.ReadAllBytes(fiscalRecovery), null, DataProtectionScope.CurrentUser))));
                        string savedNumber = Text(Value(saved, "number"));
                        if (!System.Text.RegularExpressions.Regex.IsMatch(savedNumber, @"^\d{4}-\d{8}$") ||
                            savedNumber.Substring(0, 4) != point.ToString("0000"))
                            throw new InvalidOperationException("La numeración fiscal guardada para recuperar esta venta no coincide con el punto de venta.");
                        next = Int32.Parse(savedNumber.Substring(5), CultureInfo.InvariantCulture);
                    }
                    else if (recoveryOnly)
                        throw new InvalidOperationException("No está el CAE guardado para recuperar esta venta. No se pidió otro CAE. Revisá el comprobante con el encargado.");
                    else
                    {
                        try { next = FiscalLastAuthorized(afipType, point, companyCuit) + 1; }
                        catch (SqlException) { throw; }
                        catch (Exception ex) { throw new ArcaUnavailableException(ex.Message); }
                    }
                }
                string number = point.ToString("0000") + "-" + next.ToString("00000000");
                fiscalNumber = number;
                if (Scalar(connection, tx,
                    "SELECT TOP 1 IDRecibo FROM dbo.FacturasATP WHERE IDComprob=@p0 AND IDDepósito=@p1 AND NroFactura=@p2", typeId, point, number) != null)
                    throw new InvalidOperationException("El número siguiente ya está reservado por otro borrador en Access. Cerrá o confirmá ese borrador antes de emitir desde esta pantalla.");
                if (fiscal && !dryRun)
                {
                    if (recoveryOnly && !File.Exists(fiscalRecovery))
                        throw new InvalidOperationException("No está el CAE guardado para recuperar esta venta. No se pidió otro CAE. Revisá el comprobante con el encargado.");
                    // Comprobar la misma transacción, la base y los permisos de todas las escrituras
                    // antes de solicitar el CAE. No garantiza que la red o el commit no fallen luego.
                    if (Convert.ToInt32(Scalar(connection, tx,
                        "SELECT CASE WHEN XACT_STATE()=1 AND DATABASEPROPERTYEX(DB_NAME(),'Updateability')='READ_WRITE' " +
                        "AND HAS_PERMS_BY_NAME('dbo.FacturasATP','OBJECT','INSERT')=1 " +
                        "AND HAS_PERMS_BY_NAME('dbo.FacturasATP','OBJECT','UPDATE')=1 " +
                        "AND HAS_PERMS_BY_NAME('dbo.FacturasATS','OBJECT','INSERT')=1 " +
                        "AND HAS_PERMS_BY_NAME('dbo.FacturasTSVal','OBJECT','INSERT')=1 " +
                        "AND HAS_PERMS_BY_NAME('dbo.ArtsStock','OBJECT','UPDATE')=1 THEN 1 ELSE 0 END")) != 1)
                        throw new InvalidOperationException("Error al facturar: SQL no está listo para guardar la venta. No se solicitó CAE; revisá la conexión o los permisos.");
                    pendingDraftCreated = SavePendingDraft(draftId, invoice, number);
                    if (!pendingDraftCreated && !File.Exists(fiscalRecovery))
                        throw new FiscalRecoveryException(number,
                            "Hay una solicitud anterior a ARCA cuyo resultado todavía no se verificó. No se pidió otro CAE; revisá esta venta pendiente.");
                    if (File.Exists(fiscalRecovery))
                    {
                        var recovered = Object(Json.DeserializeObject(Encoding.UTF8.GetString(
                            ProtectedData.Unprotect(File.ReadAllBytes(fiscalRecovery), null, DataProtectionScope.CurrentUser))));
                        if (Text(Value(recovered, "number")) != number || Number(Value(recovered, "total")) != grandTotal ||
                            Id(Value(recovered, "typeId")) != typeId || Id(Value(recovered, "point")) != point)
                            throw new InvalidOperationException("Existe una autorización de ARCA pendiente para este borrador con otros datos. Revisala antes de continuar.");
                        authorization = new FiscalResult { Number = number, Cae = Text(Value(recovered, "cae")),
                            Expiration = Text(Value(recovered, "expiration")) };
                    }
                    else
                    {
                        decimal[] fiscalAmounts = FiscalAmounts(gross, grandTotal, net21, iva21, net105, iva105);
                        authorization = FiscalAuthorize(afipType, point, number, date,
                            docId == 67 ? 80 : docId == 50 ? 96 : 99, docId == 32 ? "0" : doc.Replace(".", "").Replace(" ", ""), conditionIvaId,
                            grandTotal, fiscalAmounts[0], fiscalAmounts[1], fiscalAmounts[2],
                            fiscalAmounts[3], fiscalAmounts[4], fiscalAmounts[5], fiscalAmounts[6],
                            companyCuit, associatedType, associatedNumber, associatedDate,
                            () => { fiscalCallStarted = true; });
                        string recovery = Json.Serialize(new { number, total = grandTotal, typeId, point,
                            cae = authorization.Cae, expiration = authorization.Expiration });
                        File.WriteAllBytes(fiscalRecovery, ProtectedData.Protect(
                            Encoding.UTF8.GetBytes(recovery), null, DataProtectionScope.CurrentUser));
                    }
                }
                else if (fiscal && dryRun && Text(Value(invoice, "caeSoloPrueba")).Length > 0)
                {
                    string testCae = Text(Value(invoice, "caeSoloPrueba"));
                    string testExpiry = Text(Value(invoice, "vencimientoSoloPrueba"));
                    if (!System.Text.RegularExpressions.Regex.IsMatch(testCae, @"^\d{14}$") ||
                        !System.Text.RegularExpressions.Regex.IsMatch(testExpiry, @"^\d{8}$"))
                        throw new InvalidOperationException("CAE de prueba inválido.");
                    authorization = new FiscalResult { Cae = testCae, Expiration = testExpiry, Number = number };
                }
                int receipt = Convert.ToInt32(Scalar(connection, tx,
                    "INSERT dbo.FacturasATP (IDDepósito,IDComprob,NroFactura,Fecha,IDCliente,ApeYNom,[Dirección],[Teléfono],IDTipoVta,Confirmado,Total,IDTipoIVA,IDTipoDocFis,CUIT,IDVend,TotalEF,TotalEC,SubTotal,ImpIVA1,SubTSDto,Impresa,ActStock,IDSuc,SubTot1,ImpIVA21,SubTot2,ImpIVA105,IDTipoCli,IDOper,Pagada,IDEmp,CantArts,TotalCC,TotalCH,Nota,NroOTrab,TotalME,FechaPriVto,ImpAtoDto,PorcDtoAto) " +
                    "OUTPUT INSERTED.IDRecibo VALUES (@p0,@p32,@p1,@p2,@p3,@p4,@p5,@p6,1,-1,@p7,@p8,@p9,@p10,@p11,@p12,@p13,@p14,@p15,@p14,-1,-1,@p16,@p17,@p18,@p19,@p20,@p21,@p22,@p23,@p24,@p25,@p26,@p27,@p28,@p29,@p33,DATEADD(month,1,@p2),@p30,@p31)",
                    point, number, date, customer, name, address, phone, grandTotal * sign, ivaType, sqlDocumentType, sqlDocument, seller,
                    // Access marca "Completo" con Pagada; la caja debe hacerlo al cobrar, aun si ya hay valores cargados.
                    cash * sign, card * sign, net * sign, (iva21 + iva105 + other) * sign, branch, net21 * sign, iva21 * sign, net105 * sign, iva105 * sign, list, oper, quotation||cardConversion, 1, items.Count, account * sign, bank * sign,
                    note, marker, adjustment, net == 0 ? 0 : adjustment / net, typeId, grandTotal));
                if(cardConversion){
                    if(Math.Abs(grandTotal-Math.Abs(Number(cardOrigin["Total"])))>.005m)throw new InvalidOperationException("El total no coincide con la boleta X. No se confirmó la factura.");
                    Execute(connection,tx,"UPDATE dbo.FacturasATP SET ActStock=0,EnInfVtas=0,Pagada=1 WHERE IDRecibo=@p0",receipt);
                }
                if (fiscal)
                    Execute(connection, tx,
                        "UPDATE dbo.FacturasATP SET CAE=@p0,NroFacNC=@p1,CodBarra=@p2 WHERE IDRecibo=@p3",
                        authorization == null ? "" : authorization.Cae, associatedNumber,
                        authorization == null ? "" : FiscalBarcode(companyCuit, afipType, point, authorization.Cae, authorization.Expiration), receipt);
                else if (typeId == 29 && associatedNumber.Length > 0)
                    Execute(connection, tx, "UPDATE dbo.FacturasATP SET NroFacNC=@p0 WHERE IDRecibo=@p1", associatedNumber, receipt);
                foreach (object[] line in lines)
                {
                    Execute(connection, tx,
                        "INSERT dbo.FacturasATS (IDRecibo,IDArt,Cantidad,PrecioUni,Importe,ImpIVA1,ImpGan,PorcIVA,PorcDto,PrecioUniCpra,ArtDesc,PrecioUniSI,IDLista,PrecioUniOrig,PUMonExt,Stock,PorcMV,UniMed) " +
                        "VALUES (@p0,@p1,@p2,@p3,@p4,@p5,@p6,@p7,@p8,@p9,@p10,@p11,@p12,@p13,@p14,@p15,@p16,@p17)",
                        receipt,line[0],line[1],line[2],line[3],line[4],line[5],line[6],line[7],line[8],line[9],line[10],line[11],line[12],line[13],line[14],line[15],line[16]);
                    if (!quotation && !cardConversion)
                    {
                        int updated = Execute(connection, tx, "UPDATE dbo.ArtsStock SET StockAct=StockAct-@p0 WHERE IDArt=@p1 AND IDSuc=@p2", Convert.ToDecimal(line[1]) * sign,line[0],branch);
                        if (updated != 1 && (bool)line[17]) throw new InvalidOperationException("Falta un registro de stock único para " + line[0] + ".");
                    }
                }
                foreach (object[] payment in valueLines)
                    Execute(connection, tx, "INSERT dbo.FacturasTSVal (IDRecibo,IDTipoPago,Importe,ImpRec,ImpEnt,Cuotas,Concepto,FechaVto,IDTarjeta,Coef) VALUES (@p0,@p1,@p2,@p3,@p4,@p5,@p6,@p7,@p8,@p9)",
                        receipt,payment[0],payment[1],payment[2],payment[3],payment[4],payment[7],date,payment[5],payment[6]);
                int savedItems = Convert.ToInt32(Scalar(connection, tx, "SELECT COUNT(*) FROM dbo.FacturasATS WHERE IDRecibo=@p0", receipt));
                int savedPayments = Convert.ToInt32(Scalar(connection, tx, "SELECT COUNT(*) FROM dbo.FacturasTSVal WHERE IDRecibo=@p0", receipt));
                if (savedItems != lines.Count || savedPayments != valueLines.Count)
                    throw new InvalidOperationException("No se pudieron verificar todos los renglones del comprobante.");
                if (Convert.ToInt32(Scalar(connection, tx,
                    "SELECT COUNT(*) FROM dbo.FacturasATP WHERE IDRecibo=@p0 AND TotalME=@p1 AND FechaPriVto=DATEADD(month,1,@p2) AND Pagada=@p3", receipt, grandTotal, date, quotation||cardConversion)) != 1)
                    throw new InvalidOperationException("No se guardaron el total, el primer vencimiento y el estado pendiente de caja.");
                if (Convert.ToInt32(Scalar(connection, tx,
                    "SELECT COUNT(*) FROM dbo.FacturasATP WHERE IDRecibo=@p0 AND Total=@p1 AND IDComprob=@p2 AND (CAE=@p3 OR (@p3='' AND (CAE IS NULL OR CAE='')))",
                    receipt, grandTotal * sign, typeId, authorization == null ? "" : authorization.Cae)) != 1)
                    throw new InvalidOperationException("No se guardaron el tipo, signo y CAE del comprobante.");
                if (fiscal && authorization != null && Convert.ToInt32(Scalar(connection, tx,
                    "SELECT COUNT(*) FROM dbo.FacturasATP WHERE IDRecibo=@p0 AND LEN(CodBarra)=40 AND SUBSTRING(CodBarra,32,8)=@p1 AND NroFacNC=@p2",
                    receipt, authorization.Expiration, associatedNumber)) != 1)
                    throw new InvalidOperationException("No se guardaron el vencimiento fiscal y el comprobante asociado.");
                var stockExpected = new Dictionary<string, decimal>();
                foreach (object[] line in lines)
                {
                    string id = (string)line[0];
                    if (!(bool)line[17]) continue;
                    if (!stockExpected.ContainsKey(id)) stockExpected[id] = Convert.ToDecimal(line[14]);
                    if (!quotation && !cardConversion) stockExpected[id] = StoredStock(stockExpected[id] - Convert.ToDecimal(line[1]) * sign);
                }
                foreach (var expected in stockExpected)
                {
                    object actual = Scalar(connection, tx, "SELECT StockAct FROM dbo.ArtsStock WHERE IDArt=@p0 AND IDSuc=@p1", expected.Key, branch);
                    if (!StockMatches(actual, expected.Value))
                        throw new InvalidOperationException("La actualización de stock no coincide para " + expected.Key + ".");
                }
                if(cardConversion){
                    Execute(connection,tx,"UPDATE dbo.FacturasATP SET NroFacNC=@p1 WHERE IDRecibo=@p0",receipt,cardOrigin["NroFactura"]);
                    if(Number(Scalar(connection,tx,"SELECT COUNT(*) FROM dbo.FacturasATP WHERE IDRecibo=@p0 AND ActStock=0 AND EnInfVtas=0 AND Pagada=1 AND NroFacNC=@p1",receipt,cardOrigin["NroFactura"]))!=1)throw new InvalidOperationException("No se guardaron los indicadores de facturación de la boleta.");
                }
                if (dryRun) tx.Rollback(); else tx.Commit();
                try { if (!dryRun && fiscal && File.Exists(fiscalRecovery)) File.Delete(fiscalRecovery); } catch { }
                if (!dryRun && fiscal) DeletePendingDraft(draftId);
                return new { ok = true, idRecibo = receipt, numero = number, total = grandTotal, cae = authorization == null ? "" : authorization.Cae,
                    caeExpiry = authorization == null ? "" : authorization.Expiration, articulos = savedItems,
                    valores = savedPayments, pruebaTransaccion = dryRun, yaEmitido = false };
            }
            catch (Exception ex)
            {
                try { tx.Rollback(); } catch { }
                if (ex is FiscalRejectedException)
                {
                    if (pendingDraftCreated) DeletePendingDraft(draftId);
                    throw new FiscalRejectedException("Error al facturar. ARCA rechazó el comprobante; no se confirmó ni guardó la venta en SQL. Si esta venta admite un ticket no fiscal, probá con PRES. ESPECIAL. " + ex.Message);
                }
                if (authorization != null && !dryRun)
                    throw new FiscalRecoveryException(authorization.Number,
                        "ARCA autorizó este comprobante, pero SQL no terminó de guardarlo. No repitas esta venta. Recuperá esta emisión o avisá al encargado. Detalle: " + ex.Message);
                if (fiscalCallStarted && !dryRun)
                    throw new FiscalRecoveryException(fiscalNumber,
                        "Se inició la autorización en ARCA y no se pudo confirmar el resultado. No repitas esta venta. Avisá al encargado para verificar ARCA y SQL. Detalle: " + ex.Message);
                if (!dryRun && fiscal && pendingDraftCreated) DeletePendingDraft(draftId);
                if (!dryRun && fiscal && pendingDraftCreated && !fiscalCallStarted && !(ex is SqlException) &&
                    !ex.Message.StartsWith("La numeración de ARCA cambió", StringComparison.OrdinalIgnoreCase))
                    throw new ArcaUnavailableException(ex.Message);
                throw;
            }
        }
    }
    private static object StockActualizarCosto(SqlConnection connection, Dictionary<string, object> input)
    {
        UserOperator(connection, Text(Value(input, "usuarioId")));
        string id = Limited(Value(input, "idart"), 30, "IDArt");
        decimal cost = Math.Round(Number(Value(input, "costo")), 4, MidpointRounding.AwayFromZero);
        decimal previous = Number(Value(input, "costoAnterior"));
        if (id.Length == 0 || cost <= 0 || cost > 100000000) throw new InvalidOperationException("Costo o artículo inválido.");
        using (var tx = connection.BeginTransaction(IsolationLevel.Serializable))
        {
            var found = RowsTx(connection, tx, "SELECT ISNULL(PrecioCpraSI,0) AS costo,ISNULL(PorcIVA1,0) AS iva FROM dbo.[Artículos] WITH (UPDLOCK,HOLDLOCK) WHERE IDArt=@p0 AND Suspendido=0", id);
            if (found.Count != 1) throw new InvalidOperationException("El artículo no existe o está suspendido.");
            if (Math.Abs(Convert.ToDecimal(found[0]["costo"]) - previous) > .0001m) throw new InvalidOperationException("El costo cambió desde otra PC. Recargá el stock antes de actualizarlo.");
            decimal costWithIva = Math.Round(cost * (1 + Convert.ToDecimal(found[0]["iva"])), 4, MidpointRounding.AwayFromZero);
            if (Execute(connection, tx, "UPDATE dbo.[Artículos] SET PrecioCpraSISDto=@p1,PrecioCpraSI=@p1,PrecioCpraCI=@p2,FechaActPrec=GETDATE() WHERE IDArt=@p0", id, cost, costWithIva) != 1) throw new InvalidOperationException("No se pudo actualizar el costo del artículo.");
            tx.Commit();
            return new { ok = true, idart = id, precioCosto = cost, costoFinal = costWithIva };
        }
    }
    private static Guid StockBudgetTransferGuid(string budgetId)
    {
        byte[] digest;using(var sha=SHA256.Create())digest=sha.ComputeHash(Encoding.UTF8.GetBytes("CorralonWeb.Presupuesto.Transferencia.v1:"+budgetId));
        var uuid=new byte[16];Buffer.BlockCopy(digest,0,uuid,0,uuid.Length);return new Guid(uuid);
    }
    private static Dictionary<string,object> StockWebSourceState(SqlConnection c,string source,string sourceId,SqlTransaction tx=null)
    {
        string marker;var purchases=new List<Dictionary<string,object>>();
        List<Dictionary<string,object>> movements,history;
        if(source=="remito"){
            int id=RequiredId(sourceId,"el remito");marker="[WEBREMITO:"+id+"]";
            purchases=RowsTx(c,tx,"SELECT IDRecibo,NroFactura FROM dbo.ComprasTP WHERE Confirmado=1 AND CHARINDEX(@p0,CONVERT(nvarchar(max),Nota))>0",marker);
            history=RowsTx(c,tx,"SELECT IDRecibo FROM dbo.RecibosTP WHERE CHARINDEX(@p0,CONVERT(nvarchar(max),Nota))>0",marker);
            movements=RowsTx(c,tx,"SELECT IDRecibo,NroMov,IDTipoMov,IDRecDes,IDSuc FROM dbo.RecibosTP WHERE Confirmado=1 AND Anulado=0 AND CHARINDEX(@p0,CONVERT(nvarchar(max),Nota))>0",marker);
        }else if(source=="presupuesto"){
            if(String.IsNullOrWhiteSpace(sourceId)||sourceId.Length>150)throw new InvalidOperationException("Presupuesto inválido.");
            marker="[WEBSTOCK:"+StockBudgetTransferGuid(sourceId).ToString("N")+"]";
            history=RowsTx(c,tx,"SELECT IDRecibo,IDRecDes FROM dbo.RecibosTP WHERE CHARINDEX(@p0,CONVERT(nvarchar(max),Nota))>0",marker);
            var relatedIds=new HashSet<int>();
            foreach(var row in history){relatedIds.Add(Convert.ToInt32(row["IDRecibo"]));if(Number(row["IDRecDes"])>0)relatedIds.Add(Convert.ToInt32(row["IDRecDes"]));}
            movements=relatedIds.Count==0?new List<Dictionary<string,object>>():RowsTx(c,tx,"SELECT IDRecibo,NroMov,IDTipoMov,IDRecDes,IDSuc FROM dbo.RecibosTP WHERE Confirmado=1 AND Anulado=0 AND (IDRecibo IN("+String.Join(",",relatedIds)+") OR IDRecDes IN("+String.Join(",",relatedIds)+"))");
        }else throw new InvalidOperationException("Origen SQL inválido.");
        bool active=purchases.Count>0||movements.Count>0,complete=false;
        object result=null;
        if(source=="remito"){complete=purchases.Count==1&&movements.Count==1;if(complete)result=new {compraId=purchases[0]["IDRecibo"],numero=purchases[0]["NroFactura"],stockId=movements[0]["IDRecibo"],stockNumero=movements[0]["NroMov"]};}
        else if(movements.Count==2){
            var output=movements.Find(row=>Number(row["IDTipoMov"])==57);var entry=movements.Find(row=>Number(row["IDTipoMov"])==58);
            complete=output!=null&&entry!=null&&Number(output["IDRecDes"])==Number(entry["IDRecibo"])&&Number(entry["IDRecDes"])==Number(output["IDRecibo"]);
            if(complete)result=new {idRecibo=output["IDRecibo"],numeroMovimiento=output["NroMov"],sucursal=output["IDSuc"]};
        }
        return new Dictionary<string,object>{{"ok",true},{"vigente",active},{"cargado",complete},{"bloqueado",active&&!complete},{"puedeRecargar",!active},{"hayAnterior",history.Count>0},{"resultado",result},{"mensaje",active&&!complete?"Todavía queda una compra o un movimiento de stock vigente en SQL. Revisá la anulación completa antes de volver a cargar.":complete?"La carga sigue vigente en SQL.":"No hay una carga vigente en SQL. Podés volver a cargar."}};
    }
    private static int StockBudgetTransferProvider(SqlConnection connection)
    {
        var providers=Rows(connection,"SELECT IDProveedor FROM dbo.Proveedores WHERE ISNULL(Suspendido,0)=0 AND LTRIM(RTRIM([RazónSocial])) COLLATE Latin1_General_CI_AI='CORRALON PROGRESO'");
        if(providers.Count!=1)throw new InvalidOperationException("Debe existir un único proveedor activo CORRALON PROGRESO en SQL.");
        return RequiredId(providers[0]["IDProveedor"],"el proveedor CORRALON PROGRESO");
    }
    private static Dictionary<string,object> StockBudgetTransferInput(Dictionary<string,object> input)
    {
        string budgetId=Limited(Value(input,"presupuestoId"),150,"Presupuesto");
        if(budgetId.Length==0)throw new InvalidOperationException("Falta el presupuesto de origen.");
        int origin=RequiredId(Value(input,"sucursal"),"la sucursal de origen");
        int destination=RequiredId(Value(input,"sucursalDestino"),"la sucursal de destino");
        if((origin!=1&&origin!=2)||destination!=(origin==1?2:1))throw new InvalidOperationException("El destino debe ser la otra sucursal.");
        if(RequiredId(Value(input,"tipoMovimiento"),"el movimiento")!=57)throw new InvalidOperationException("Esta opción requiere Transferencia de stock.");
        var data=new Dictionary<string,object>(input);data.Remove("presupuestoId");
        data["id"]=StockBudgetTransferGuid(budgetId).ToString();data["accion"]="confirmar";data["permitirRecargaAnulada"]=true;
        return data;
    }
    private static object StockIngreso(SqlConnection connection, Dictionary<string, object> input, bool confirmar)
    {
        DateTime movementDate;
        string movementDateText = Text(Value(input,"fecha"));
        if (movementDateText.Length == 0) movementDateText = DateTime.Today.ToString("yyyy-MM-dd");
        if (!DateTime.TryParseExact(movementDateText,"yyyy-MM-dd",CultureInfo.InvariantCulture,DateTimeStyles.None,out movementDate) || movementDate > DateTime.Today || movementDate < new DateTime(1753,1,1)) throw new InvalidOperationException("La fecha de carga de stock debe ser válida, igual o anterior a hoy.");
        Guid requestId;
        if (!Guid.TryParse(Text(Value(input, "id")), out requestId)) throw new InvalidOperationException("La carga no tiene un identificador válido.");
        int sucursal = RequiredId(Value(input, "sucursal"), "la sucursal");
        int puntoVenta = RequiredId(Value(input, "puntoVenta"), "el punto de venta");
        int movimiento = Value(input, "tipoMovimiento") == null ? 23 : RequiredId(Value(input, "tipoMovimiento"), "el movimiento");
        int proveedor = 0; Int32.TryParse(Text(Value(input, "proveedor")), out proveedor);
        int destino = 0; Int32.TryParse(Text(Value(input, "sucursalDestino")), out destino);
        int compra = 0; Int32.TryParse(Text(Value(input, "idFactura")), out compra);
        int relacionado = 0; Int32.TryParse(Text(Value(input, "idRelacionado")), out relacionado);
        string numeroFactura = Limited(Value(input, "numeroFactura"), 20, "Número de factura");
        string remito = Limited(Value(input, "numeroRemito"), 20, "Número de remito");
        string nota = Limited(Value(input, "nota"), 300, "Nota");
        var articulos = new List<object>();
        object rawItems = Value(input, "articulos");
        if (rawItems is object[]) articulos.AddRange((object[])rawItems);
        else if (rawItems is System.Collections.ArrayList) foreach (object item in (System.Collections.ArrayList)rawItems) articulos.Add(item);
        if (articulos.Count == 0 || articulos.Count > 5000) throw new InvalidOperationException("Cargá entre 1 y 5000 artículos.");
        string marker = "[WEBSTOCK:" + requestId.ToString("N") + "]";
        var fingerprintInput = new Dictionary<string, object>(input); fingerprintInput.Remove("accion");fingerprintInput.Remove("permitirRecargaAnulada");
        string fingerprint;
        using (var sha = SHA256.Create()) fingerprint = BitConverter.ToString(sha.ComputeHash(Encoding.UTF8.GetBytes(Json.Serialize(fingerprintInput)))).Replace("-", "");
        string hashMarker = "[HASH:" + fingerprint + "]";
        int operador = UserOperator(connection, Text(Value(input, "usuarioId")));
        SqlTransaction tx = confirmar ? connection.BeginTransaction(IsolationLevel.Serializable) : null;
        try
        {
            if (confirmar && Convert.ToInt32(Scalar(connection, tx,
                "DECLARE @r int; EXEC @r=sp_getapplock @Resource=@p0,@LockMode='Exclusive',@LockOwner='Transaction',@LockTimeout=10000; SELECT @r", "CorralonWeb.StockIngreso." + requestId.ToString("N"))) < 0)
                throw new InvalidOperationException("Otra carga está en curso. Reintentá.");
            var saved = RowsTx(connection, tx, "SELECT TOP 1 IDRecibo,NroMov,IDSuc,IDTipoMov,Total,Nota FROM dbo.RecibosTP WHERE CHARINDEX(@p0,CONVERT(nvarchar(max),Nota))>0 AND Confirmado=1 AND (Anulado=0 OR @p1=0) ORDER BY IDRecibo DESC", marker,Value(input,"permitirRecargaAnulada")!=null&&Convert.ToBoolean(Value(input,"permitirRecargaAnulada"))?1:0);
            if (saved.Count > 0)
            {
                if (Text(saved[0]["Nota"]).IndexOf(hashMarker, StringComparison.Ordinal) < 0)
                    throw new InvalidOperationException("Este ingreso ya se confirmó con otros datos. Consultalo antes de continuar.");
                var savedLines = RowsTx(connection, tx, "SELECT d.IDArt AS idart,a.IDArtProv AS codigo,a.[Descripción] AS descripcion,d.Cantidad AS cantidad,d.PrecioUni AS precioUnitario,d.Importe AS importe,d.Stock AS stockAntes,s.StockAct AS stockDespues FROM dbo.RecibosTS d INNER JOIN dbo.[Artículos] a ON a.IDArt=d.IDArt LEFT JOIN dbo.ArtsStock s ON s.IDArt=d.IDArt AND s.IDSuc=@p1 WHERE d.IDRecibo=@p0 ORDER BY d.IDOrden", saved[0]["IDRecibo"], sucursal);
                if (tx != null) tx.Commit();
                return new { ok = true, yaCargado = true, idRecibo = saved[0]["IDRecibo"], numeroMovimiento = saved[0]["NroMov"], total = saved[0]["Total"], articulos = savedLines };
            }
            try { AssertBackdatedInvoicePermission(input,movementDate,DateTime.Today,"carga_stock"); }
            catch (InvalidOperationException ex) { throw new InvalidOperationException(ex.Message.Replace("emitir con fecha anterior","cargar stock con fecha anterior")); }
            var types = RowsTx(connection, tx, "SELECT IDComprob,IDTipoMovStock,StkPor,ImpPor,GenNS,ConReceta FROM dbo.TipoComprobantes WHERE IDComprob=@p0 AND EnStk=1", movimiento);
            if (types.Count != 1) throw new InvalidOperationException("El tipo de movimiento no está habilitado para stock.");
            if (Convert.ToBoolean(types[0]["GenNS"] == DBNull.Value || types[0]["GenNS"] == null ? false : types[0]["GenNS"]) || Convert.ToBoolean(types[0]["ConReceta"] == null ? false : types[0]["ConReceta"]))
                throw new InvalidOperationException("Este movimiento requiere series o producción de Access.");
            int stockType = Convert.ToInt32(types[0]["IDTipoMovStock"]);
            int stockSign = stockType == 0 ? 0 : (stockType == 2 ? -1 : 1);
            int amountSign = types[0]["ImpPor"] == null ? 1 : Convert.ToInt32(types[0]["ImpPor"]);
            if (movimiento == 57 && (destino <= 0 || destino == sucursal)) throw new InvalidOperationException("Elegí una sucursal de destino distinta del origen.");
            if (movimiento != 57 && destino > 0) throw new InvalidOperationException("La sucursal destino sólo corresponde a transferencias.");
            if (movimiento == 57 && RowsTx(connection, tx, "SELECT IDSuc FROM dbo.Sucursales WHERE IDSuc=@p0", destino).Count != 1) throw new InvalidOperationException("Sucursal destino inexistente.");
            if ((movimiento == 23 || movimiento == 28) && proveedor <= 0) throw new InvalidOperationException("Seleccioná un proveedor de SQL.");
            var branches = RowsTx(connection, tx, "SELECT IDSuc FROM dbo.Sucursales WHERE IDSuc=@p0", sucursal);
            var points = RowsTx(connection, tx, "SELECT IDEmp FROM dbo.[Depósitos] WHERE IDDepósito=@p0 AND IDSucAsoc=@p1", puntoVenta, sucursal);
            if (branches.Count != 1 || points.Count != 1) throw new InvalidOperationException("La sucursal y el punto de venta no coinciden.");
            int empresa = Convert.ToInt32(points[0]["IDEmp"]);
            if (proveedor > 0 && RowsTx(connection, tx, "SELECT IDProveedor FROM dbo.Proveedores WHERE IDProveedor=@p0 AND Suspendido=0", proveedor).Count != 1) throw new InvalidOperationException("Proveedor inexistente o suspendido.");
            if (compra == 0 && movimiento == 23 && proveedor > 0 && numeroFactura.Length > 0)
            {
                var matchingPurchases = RowsTx(connection, tx, "SELECT IDRecibo FROM dbo.ComprasTP WHERE IDProveedor=@p0 AND NroFactura=@p1 AND Confirmado=1 AND EnMovStk=1 AND IDMovStk IS NULL", proveedor, numeroFactura);
                if (matchingPurchases.Count > 1) throw new InvalidOperationException("Hay varias compras con ese número. Elegí la factura en el desplegable.");
                if (matchingPurchases.Count == 1) compra = Convert.ToInt32(matchingPurchases[0]["IDRecibo"]);
            }
            if (compra > 0 && (movimiento != 23 || RowsTx(connection, tx, "SELECT IDRecibo FROM dbo.ComprasTP WHERE IDRecibo=@p0 AND IDProveedor=@p1 AND Confirmado=1 AND EnMovStk=1 AND IDMovStk IS NULL", compra, proveedor).Count != 1)) throw new InvalidOperationException("La factura de compra ya tiene ingreso o no corresponde al proveedor.");
            if (relacionado > 0 && RowsTx(connection, tx, "SELECT IDRecibo FROM dbo.RecibosTP WHERE IDRecibo=@p0 AND IDSuc=@p1 AND Confirmado=1 AND Anulado=0", relacionado, sucursal).Count != 1) throw new InvalidOperationException("Comprobante relacionado inválido.");
            if (numeroFactura.Length > 0 && proveedor > 0 && Convert.ToInt32(Scalar(connection, tx, "SELECT COUNT(*) FROM dbo.RecibosTP WHERE IDTipoMov=@p0 AND IDProveedor=@p1 AND NroFactura=@p2 AND Confirmado=1 AND Anulado=0", movimiento, proveedor, numeroFactura)) > 0) throw new InvalidOperationException("Esa factura del proveedor ya tiene un movimiento confirmado.");
            var lines = new List<Dictionary<string, object>>(); var ids = new HashSet<string>(StringComparer.OrdinalIgnoreCase); decimal total = 0;
            foreach (object raw in articulos)
            {
                var row = Object(raw); string codigo = Limited(Value(row, "codigo"), 30, "Código proveedor"); string id = Limited(Value(row, "idart"), 30, "IDArt");
                if (id.Length == 0 && (proveedor <= 0 || codigo.Length == 0)) throw new InvalidOperationException("Identificá cada artículo por IDArt o código de proveedor.");
                var found = RowsTx(connection, tx, "SELECT a.IDArt,a.IDArtProv,a.[Descripción] AS descripcion,a.UniMed,ISNULL(a.PrecioCpraSI,0) AS precioCosto,ISNULL(s.StockAct,0) AS stock FROM dbo.[Artículos] a LEFT JOIN dbo.ArtsStock s ON s.IDArt=a.IDArt AND s.IDSuc=@p2 WHERE a.Suspendido=0 AND ((@p3<>'' AND a.IDArt=@p3) OR (@p3='' AND a.IDProveedor=@p0 AND LTRIM(RTRIM(a.IDArtProv))=@p1))", proveedor, codigo, sucursal, id);
                if (found.Count != 1) throw new InvalidOperationException("El código " + codigo + " no tiene una coincidencia única en SQL.");
                id = Text(found[0]["IDArt"]); if (!ids.Add(id)) throw new InvalidOperationException("El artículo " + id + " está repetido. Unificá sus cantidades.");
                decimal before = StockNumber(found[0]["stock"]), qty = Math.Round(Number(Value(row, "cantidad")), 4, MidpointRounding.AwayFromZero);
                if (Value(row, "conteo") != null)
                {
                    if (movimiento != 35) throw new InvalidOperationException("El conteo de inventario requiere Ajuste de Stock.");
                    decimal count = Number(Value(row, "conteo")); if (count < 0 || count > 100000) throw new InvalidOperationException("Conteo fuera de rango.");
                    qty = Math.Round(count - before, 4, MidpointRounding.AwayFromZero);
                }
                decimal price = Math.Round(Convert.ToDecimal(found[0]["precioCosto"]), 4, MidpointRounding.AwayFromZero);
                if (Math.Abs(qty) > 100000 || (movimiento != 35 && qty <= 0) || price < 0 || price > 100000000) throw new InvalidOperationException("Cantidad o precio fuera de rango para " + id + ".");
                decimal amount = Math.Round(qty * price, 4, MidpointRounding.AwayFromZero); total += amount;
                lines.Add(new Dictionary<string, object> { { "idart", id }, { "codigo", Text(found[0]["IDArtProv"]) }, { "descripcion", found[0]["descripcion"] }, { "cantidad", qty }, { "precioUnitario", price }, { "importe", amount }, { "stockAntes", before }, { "stockDespues", before + qty * stockSign }, { "unidad", found[0]["UniMed"] } });
            }
            total = Math.Round(total * amountSign, 4, MidpointRounding.AwayFromZero);
            if (!confirmar) return new { ok = true, yaCargado = false, total, articulos = lines };
            int number = Convert.ToInt32(Scalar(connection, tx, "SELECT ISNULL(MAX(NroMov),0)+1 FROM dbo.RecibosTP WITH (UPDLOCK,HOLDLOCK) WHERE IDTipoMov=@p0 AND IDSuc=@p1", movimiento, sucursal));
            int receipt = Convert.ToInt32(Scalar(connection, tx, "INSERT dbo.RecibosTP (IDTipoMov,NroMov,Fecha,IDDepósito,IDVend,IDOper,IDProveedor,IDSuc,IDEmp,NroFactura,NroRemito,IDFactura,IDRemito,IDDepDes,Total,SubTSDto,Confirmado,Anulado,Nota,FechaYHora) OUTPUT INSERTED.IDRecibo VALUES (@p0,@p1,@p2,@p3,@p4,@p4,@p5,@p6,@p7,@p8,@p9,@p10,@p11,@p12,@p13,@p13,1,0,@p14,GETDATE())", movimiento, number, movementDate, puntoVenta, operador, proveedor == 0 ? (object)DBNull.Value : proveedor, sucursal, empresa, numeroFactura.Length == 0 ? (object)DBNull.Value : numeroFactura, remito.Length == 0 ? (object)DBNull.Value : remito, compra == 0 ? (object)DBNull.Value : compra, relacionado == 0 ? (object)DBNull.Value : relacionado, destino, total, marker + hashMarker + " " + nota));
            foreach (var line in lines)
            {
                Execute(connection, tx, "INSERT dbo.RecibosTS (IDRecibo,IDArt,Cantidad,PrecioUni,Importe,Stock,UniMed) VALUES (@p0,@p1,@p2,@p3,@p4,@p5,@p6)", receipt, line["idart"], line["cantidad"], line["precioUnitario"], line["importe"], line["stockAntes"], line["unidad"] ?? DBNull.Value);
                if (stockSign != 0)
                {
                    Execute(connection, tx, "IF NOT EXISTS (SELECT 1 FROM dbo.ArtsStock WHERE IDArt=@p0 AND IDSuc=@p1) INSERT dbo.ArtsStock (IDArt,IDSuc,StockAct) VALUES (@p0,@p1,0)", line["idart"], sucursal);
                    if (Execute(connection, tx, "UPDATE dbo.ArtsStock SET StockAct=ISNULL(StockAct,0)+@p0 WHERE IDArt=@p1 AND IDSuc=@p2", Convert.ToDecimal(line["cantidad"]) * stockSign, line["idart"], sucursal) != 1) throw new InvalidOperationException("Stock no único para " + line["idart"]);
                }
            }
            Execute(connection, tx, "UPDATE dbo.TipoComprobantes SET UltNroComp=@p0 WHERE IDComprob=@p1", number, movimiento);
            if (compra > 0 && Execute(connection, tx, "UPDATE dbo.ComprasTP SET IDMovStk=@p0 WHERE IDRecibo=@p1 AND IDMovStk IS NULL", number, compra) != 1) throw new InvalidOperationException("La compra fue ingresada desde otra PC.");
            if (movimiento == 57)
            {
                if (RowsTx(connection, tx, "SELECT IDComprob FROM dbo.TipoComprobantes WHERE IDComprob=58", new object[0]).Count != 1) throw new InvalidOperationException("Falta el tipo de entrada de transferencia 58 en SQL.");
                int destinationNumber = Convert.ToInt32(Scalar(connection, tx, "SELECT ISNULL(MAX(NroMov),0)+1 FROM dbo.RecibosTP WITH (UPDLOCK,HOLDLOCK) WHERE IDTipoMov=58 AND IDSuc=@p0", destino));
                int destinationReceipt = Convert.ToInt32(Scalar(connection, tx, "INSERT dbo.RecibosTP (IDTipoMov,NroMov,Fecha,IDDepósito,IDVend,IDOper,IDProveedor,IDSuc,IDEmp,IDDepDes,IDRecDes,Total,SubTSDto,Confirmado,Anulado,Nota,FechaYHora,NroRemito) OUTPUT INSERTED.IDRecibo VALUES (58,@p0,@p1,@p2,@p3,@p3,@p4,@p5,@p6,@p7,@p8,@p9,@p9,1,0,@p10,GETDATE(),@p11)", destinationNumber, movementDate, puntoVenta, operador, proveedor == 0 ? (object)DBNull.Value : proveedor, destino, empresa, sucursal, receipt, total, "Entrada relacionada: " + receipt + " " + nota, remito.Length == 0 ? (object)DBNull.Value : remito));
                foreach (var line in lines)
                {
                    Execute(connection, tx, "IF NOT EXISTS (SELECT 1 FROM dbo.ArtsStock WHERE IDArt=@p0 AND IDSuc=@p1) INSERT dbo.ArtsStock (IDArt,IDSuc,StockAct) VALUES (@p0,@p1,0)", line["idart"], destino);
                    decimal destinationBefore = StockNumber(Scalar(connection, tx, "SELECT ISNULL(StockAct,0) FROM dbo.ArtsStock WHERE IDArt=@p0 AND IDSuc=@p1", line["idart"], destino));
                    Execute(connection, tx, "INSERT dbo.RecibosTS (IDRecibo,IDArt,Cantidad,PrecioUni,Importe,Stock,UniMed) VALUES (@p0,@p1,@p2,@p3,@p4,@p5,@p6)", destinationReceipt, line["idart"], line["cantidad"], line["precioUnitario"], line["importe"], destinationBefore, line["unidad"] ?? DBNull.Value);
                    if (Execute(connection, tx, "UPDATE dbo.ArtsStock SET StockAct=ISNULL(StockAct,0)+@p0 WHERE IDArt=@p1 AND IDSuc=@p2", line["cantidad"], line["idart"], destino) != 1) throw new InvalidOperationException("Stock destino no único.");
                    object destinationAfter = Scalar(connection, tx, "SELECT StockAct FROM dbo.ArtsStock WHERE IDArt=@p0 AND IDSuc=@p1", line["idart"], destino);
                    if (!StockMatches(destinationAfter, destinationBefore + Convert.ToDecimal(line["cantidad"]))) throw new InvalidOperationException("El stock de destino no coincide con la transferencia.");
                }
                Execute(connection, tx, "UPDATE dbo.RecibosTP SET IDRecDes=@p0 WHERE IDRecibo=@p1", destinationReceipt, receipt);
                Execute(connection, tx, "UPDATE dbo.TipoComprobantes SET UltNroComp=@p0 WHERE IDComprob=58", destinationNumber);
            }
            if (Convert.ToInt32(Scalar(connection, tx, "SELECT COUNT(*) FROM dbo.RecibosTS WHERE IDRecibo=@p0", receipt)) != lines.Count) throw new InvalidOperationException("El movimiento no guardó todos sus artículos.");
            if (stockSign != 0) foreach (var line in lines)
            {
                object actual = Scalar(connection, tx, "SELECT StockAct FROM dbo.ArtsStock WHERE IDArt=@p0 AND IDSuc=@p1", line["idart"], sucursal);
                if (!StockMatches(actual, Convert.ToDecimal(line["stockDespues"]))) throw new InvalidOperationException("El stock final no coincide para " + line["idart"]);
            }
            tx.Commit();
            return new { ok = true, yaCargado = false, idRecibo = receipt, numeroMovimiento = number, total, articulos = lines };
        }
        catch { if (tx != null) try { tx.Rollback(); } catch { } throw; }
        finally { if (tx != null) tx.Dispose(); }
    }
    private const string ArticuloSelect = @"SELECT a.IDArt AS id,a.IDProveedor AS idProveedor,a.IDRubro AS idRubro,a.IDSeccion AS idSeccion,a.IDMoneda AS idMoneda,a.IDPorcIVA AS idIva,a.ImpImpInt AS impuestoInterno,a.PrecioFlete AS flete,a.PorcDto1 AS descuento1,a.PorcDto2 AS descuento2,a.IDArtProv AS codigoProveedor,a.IDArtExt AS codigoBarras,
            a.[Descripción] AS descripcion,a.DescImpr AS descripcionWeb,r.[Descripción] AS rubro,p.[RazónSocial] AS proveedor,
            s.Seccion AS seccion,m.Moneda AS moneda,a.Suspendido AS suspendido,a.ModifPV AS modificaPrecio,a.EnStock AS enStock,
            a.UniXBulto AS unidadesBulto,a.PrecioCpraSISDto AS costoLista,CONVERT(varchar(10),a.FechaActPrec,103) AS ultimaActualizacion,a.PrecioCpraSI AS costoSinIva,a.PrecioCpraCI AS costoConIva,
            a.ImpDtos AS descuentos,a.PorcIVA1 AS iva,a.PrecioVta3 AS minorista,a.PrecioVta2 AS intermedio,a.PrecioVta1 AS mayorista,
            a.PorcGanMin AS gananciaMinorista,a.PorcGanInt AS gananciaIntermedio,a.PorcGanMay AS gananciaMayorista,
            a.PrecioVta3-a.PrecioCpraCI-ISNULL(a.ImpImpInt,0) AS margenMinorista,
            a.PrecioVta2-a.PrecioCpraCI-ISNULL(a.ImpImpInt,0) AS margenIntermedio,
            a.PrecioVta1-a.PrecioCpraCI-ISNULL(a.ImpImpInt,0) AS margenMayorista,
            ISNULL(st.total,0) AS stockTotal
            FROM dbo.[Artículos] a LEFT JOIN dbo.Proveedores p ON p.IDProveedor=a.IDProveedor
            LEFT JOIN dbo.Rubros r ON r.IDRubro=a.IDRubro LEFT JOIN dbo.Secciones s ON s.IDSeccion=a.IDSeccion
            LEFT JOIN dbo.Monedas m ON m.IDMoneda=a.IDMoneda
            LEFT JOIN (SELECT IDArt,SUM(StockAct) AS total FROM dbo.ArtsStock GROUP BY IDArt) st ON st.IDArt=a.IDArt
";
    private const string ArticuloStockSelect = "SELECT s.IDSuc AS id,s.Sucursal AS sucursal,ISNULL(a.StockAct,0) AS stock,a.Ubic AS ubicacion FROM dbo.Sucursales s LEFT JOIN dbo.ArtsStock a ON a.IDSuc=s.IDSuc AND a.IDArt=@p0 ORDER BY s.IDSuc";
    private static string ArticuloVersion(Dictionary<string, object> row)
    {
        var snapshot = new Dictionary<string, object>(row);
        snapshot.Remove("version"); snapshot.Remove("stockTotal");
        using (var sha = System.Security.Cryptography.SHA256.Create())
            return Convert.ToBase64String(sha.ComputeHash(Encoding.UTF8.GetBytes(Json.Serialize(snapshot))));
    }
    private static List<Dictionary<string, object>> ArticuloRows(SqlConnection c, SqlTransaction tx, string id)
    {
        var rows = id == null ? Rows(c, ArticuloSelect + " ORDER BY a.[Descripción],a.IDArt") :
            RowsTx(c, tx, ArticuloSelect + " WHERE a.IDArt=@p0", id);
        foreach (var row in rows) row["version"] = ArticuloVersion(row);
        return rows;
    }
    private static object ArticuloFichaVendedor(SqlConnection c,SqlTransaction tx,string id) {
        var rows=RowsTx(c,tx,"SELECT IDArt id,IDArtProv codigoProveedor,Suspendido suspendido,[Descripción] descripcion FROM dbo.[Artículos] WHERE IDArt=@p0",id);
        if(rows.Count!=1)throw new InvalidOperationException("El artículo ya no existe.");
        var row=rows[0];row["version"]=ProviderVersion(row);return new {ok=true,articulo=row};
    }
    private static object ArticuloGuardarVendedor(SqlConnection c,Dictionary<string,object> input) {
        AssertPurchasePermission(Text(Value(input,"usuarioId")),"facturacion");
        var data=Object(Value(input,"articulo"));
        foreach(string key in data.Keys)if(key!="id" && key!="codigoProveedor" && key!="descripcion" && key!="suspendido")throw new InvalidOperationException("Campo no permitido en la ficha reducida.");
        string id=Limited(Value(data,"id"),20,"ID artículo"),description=Limited(Value(data,"descripcion"),100,"Descripción"),code=Limited(Value(data,"codigoProveedor"),30,"Código proveedor");
        if(id.Length==0 || description.Trim().Length==0 || !(Value(data,"suspendido") is bool))throw new InvalidOperationException("Completá la descripción y el estado del artículo.");
        int oper=UserOperator(c,Text(Value(input,"usuarioId")));
        using(var tx=c.BeginTransaction(IsolationLevel.Serializable)) {
            var rows=RowsTx(c,tx,"SELECT IDArt id,IDArtProv codigoProveedor,Suspendido suspendido,[Descripción] descripcion FROM dbo.[Artículos] WITH(UPDLOCK,HOLDLOCK) WHERE IDArt=@p0",id);
            if(rows.Count!=1 || ProviderVersion(rows[0])!=Text(Value(input,"version")))throw new InvalidOperationException("El artículo cambió en otra PC. Volvé a abrir la ficha.");
            Execute(c,tx,"UPDATE dbo.[Artículos] SET IDArtProv=@p1,[Descripción]=@p2,Suspendido=@p3,IDOperModif=@p4,HoraModif=GETDATE() WHERE IDArt=@p0",id,code,description,Value(data,"suspendido"),oper);
            var result=ArticuloFichaVendedor(c,tx,id);tx.Commit();return result;
        }
    }
    private static object ArticulosSql(SqlConnection connection, HttpListenerRequest request)
    {
        string id = request.QueryString["id"];
        if(request.QueryString["modo"]=="vendedor") {AssertPurchasePermission(request.QueryString["usuarioId"],"facturacion");return ArticuloFichaVendedor(connection,null,Limited(id,20,"ID artículo"));}
        if (!String.IsNullOrEmpty(id)) {
            var rows = ArticuloRows(connection, null, Limited(id,20,"ID artículo"));
            if (rows.Count != 1) throw new InvalidOperationException("El artículo ya no existe. Actualizá el listado.");
            return new { ok = true, articulo = rows[0], stock = Rows(connection, ArticuloStockSelect, id) };
        }
        return new { ok = true, articulos = request.QueryString["catalogos"] == "1" ? new List<Dictionary<string, object>>() : ArticuloRows(connection,null,null),
            proveedores = Rows(connection,"SELECT IDProveedor AS id,[RazónSocial] AS nombre FROM dbo.Proveedores ORDER BY [RazónSocial]"),
            rubros = Rows(connection,"SELECT IDRubro AS id,[Descripción] AS nombre FROM dbo.Rubros ORDER BY [Descripción]"),
            secciones = Rows(connection,"SELECT IDSeccion AS id,Seccion AS nombre FROM dbo.Secciones ORDER BY Seccion"),
            monedas = Rows(connection,"SELECT IDMoneda AS id,Moneda AS nombre FROM dbo.Monedas ORDER BY IDMoneda"),
            tasasIva = Rows(connection,"SELECT IDPorcIVA AS id,PorcIVA1 AS iva,PorcIVA2 AS iva2 FROM dbo.PorcIVA ORDER BY PorcIVA1,IDPorcIVA") };
    }
    private static object ArticulosPresupuestarAridos(SqlConnection connection, Dictionary<string, object> input)
    {
        AssertPurchasePermission(Text(Value(input,"usuarioId")),"facturacion");
        int oper = UserOperator(connection,Text(Value(input,"usuarioId")));
        var lines = Value(input,"articulos") as object[];
        if(lines == null || lines.Length == 0 || lines.Length > 30)throw new InvalidOperationException("Elegí entre 1 y 30 áridos.");
        using(var tx=connection.BeginTransaction(IsolationLevel.Serializable)) {
            ArticulosAplicarPresupuestoAridos(connection,tx,lines,oper);
            tx.Commit();return new {ok=true,actualizados=lines.Length};
        }
    }
    private static void ArticulosAplicarPresupuestoAridos(SqlConnection connection, SqlTransaction tx, object[] lines, int oper)
    {
            var seen=new HashSet<string>();
            foreach(object raw in lines) {
                var item=Object(raw);string id=Limited(Value(item,"idart"),20,"ID artículo");
                decimal pesos=Number(Value(item,"costoConIva"));
                if(id.Length==0 || !seen.Add(id) || pesos<=0 || pesos>100000000)throw new InvalidOperationException("Artículo o costo de árido inválido.");
                var locked=RowsTx(connection,tx,"SELECT IDArt FROM dbo.[Artículos] WITH(UPDLOCK,HOLDLOCK) WHERE IDArt=@p0 AND Suspendido=0",id);
                if(locked.Count!=1)throw new InvalidOperationException("El árido no existe o está suspendido.");
                var rows=ArticuloRows(connection,tx,id);var current=rows[0];
                if(Text(Value(item,"version"))!=Text(current["version"]))throw new InvalidOperationException("El artículo cambió desde otra PC. Volvé a importar el presupuesto.");
                decimal rate=1;
                if(InvoiceValueNumber(current["idMoneda"])!=1)rate=Number(Scalar(connection,tx,"SELECT ImpCotiz FROM dbo.Monedas WHERE IDMoneda=@p0",current["idMoneda"]));
                if(rate<=0)throw new InvalidOperationException("Falta la cotización de la moneda del árido.");
                decimal iva=InvoiceValueNumber(current["iva"]), costCI=Math.Round(pesos/rate,4,MidpointRounding.AwayFromZero);
                if(iva<0 || iva>1)throw new InvalidOperationException("IVA del árido inválido.");
                decimal costSI=Math.Round(costCI/(1+iva),4,MidpointRounding.AwayFromZero);
                decimal oldSI=InvoiceValueNumber(current["costoSinIva"]), oldList=InvoiceValueNumber(current["costoLista"]);
                decimal list=oldSI>0 && oldList>0 ? Math.Round(costSI*oldList/oldSI,4,MidpointRounding.AwayFromZero) : costSI;
                decimal internalTax=InvoiceValueNumber(current["impuestoInterno"]);
                decimal minorista=Math.Round(costCI*(1+InvoiceValueNumber(current["gananciaMinorista"]))+internalTax,4,MidpointRounding.AwayFromZero);
                decimal intermedio=Math.Round(costCI*(1+InvoiceValueNumber(current["gananciaIntermedio"]))+internalTax,4,MidpointRounding.AwayFromZero);
                decimal mayorista=Math.Round(costCI*(1+InvoiceValueNumber(current["gananciaMayorista"]))+internalTax,4,MidpointRounding.AwayFromZero);
                if(Execute(connection,tx,"UPDATE dbo.[Artículos] SET PrecioCpraSISDto=@p1,PrecioCpraSI=@p2,PrecioCpraCI=@p3,ImpDtos=@p4,PrecioVta3=@p5,PrecioVta2=@p6,PrecioVta1=@p7,IDOperModif=@p8,HoraModif=GETDATE(),FechaActPrec=GETDATE() WHERE IDArt=@p0",id,list,costSI,costCI,list-costSI,minorista,intermedio,mayorista,oper)!=1)throw new InvalidOperationException("No se pudo actualizar el árido.");
            }
    }
    private static object ArticuloNumero(Dictionary<string, object> data, string key, bool negative, bool nullable)
    {
        if (!data.ContainsKey(key)) throw new InvalidOperationException("Falta el campo " + key + ".");
        object value = Value(data,key);
        if (value == null && nullable) return null;
        decimal n = Number(value);
        if ((!negative && n < 0) || Math.Abs(n) > 100000000m) throw new InvalidOperationException("Valor fuera de rango en " + key + ".");
        return Math.Round(n,key.StartsWith("ganancia")?8:4,MidpointRounding.AwayFromZero);
    }
    private static object ArticuloGuardar(SqlConnection connection, Dictionary<string, object> input, bool prueba)
    {
        int oper = LocalOperator(connection);
        var data = Object(Value(input,"articulo"));
        string oldId = Limited(Value(input,"idOriginal"),20,"ID artículo"), id = Limited(Value(data,"id"),20,"ID artículo");
        string version = Text(Value(input,"version"));
        if (oldId.Length == 0 || id.Length == 0 || version.Length == 0) throw new InvalidOperationException("Falta identificar el artículo y su versión.");
        var stockItems = Value(input,"stock") as System.Collections.IEnumerable;
        if (stockItems == null || Value(input,"stock") is string) throw new InvalidOperationException("Stock inválido.");
        using (var tx = connection.BeginTransaction(IsolationLevel.Serializable)) {
            try {
                if (Scalar(connection,tx,"SELECT IDArt FROM dbo.[Artículos] WITH(UPDLOCK,HOLDLOCK) WHERE IDArt=@p0",oldId) == null)
                    throw new InvalidOperationException("El artículo ya no existe.");
                var current = ArticuloRows(connection,tx,oldId)[0];
                if (Text(current["version"]) != version) throw new InvalidOperationException("El artículo cambió desde otra PC. Recargá la ficha antes de guardar.");
                if (oldId != id && Scalar(connection,tx,"SELECT IDArt FROM dbo.[Artículos] WITH(UPDLOCK,HOLDLOCK) WHERE IDArt=@p0",id) != null)
                    throw new InvalidOperationException("Ese ID ya corresponde a otro artículo.");
                var values = new List<object>(); values.Add(oldId);
                var sets = new List<string>();
                Action<string,object> set = (column,value) => { values.Add(value); sets.Add("["+column+"]=@p"+(values.Count-1)); };
                set("IDArt",id);
                string[] texts = {"codigoProveedor","IDArtProv","30","codigoBarras","IDArtExt","30","descripcion","Descripción","100","descripcionWeb","DescImpr","100"};
                for(int i=0;i<texts.Length;i+=3) {
                    if(!data.ContainsKey(texts[i])) throw new InvalidOperationException("Falta el campo "+texts[i]);
                    set(texts[i+1],Limited(Value(data,texts[i]),Int32.Parse(texts[i+2]),texts[i]));
                }
                string[] lookups = {"idProveedor","IDProveedor","Proveedores","idRubro","IDRubro","Rubros","idSeccion","IDSeccion","Secciones","idMoneda","IDMoneda","Monedas","idIva","IDPorcIVA","PorcIVA"};
                for(int i=0;i<lookups.Length;i+=3) {
                    if(!data.ContainsKey(lookups[i])) throw new InvalidOperationException("Falta el campo "+lookups[i]);
                    object v = Value(data,lookups[i]);
                    if(v != null) {
                        int n; if(!Int32.TryParse(Text(v),out n) || Scalar(connection,tx,"SELECT ["+lookups[i+1]+"] FROM dbo.["+lookups[i+2]+"] WHERE ["+lookups[i+1]+"]=@p0",n)==null)
                            throw new InvalidOperationException("Selección inválida en "+lookups[i]);
                        v=n;
                    } else if(lookups[i]=="idIva") throw new InvalidOperationException("Elegí un IVA.");
                    set(lookups[i+1],v);
                }
                var rate=RowsTx(connection,tx,"SELECT PorcIVA1,PorcIVA2 FROM dbo.PorcIVA WHERE IDPorcIVA=@p0",Value(data,"idIva"))[0];
                set("PorcIVA1",rate["PorcIVA1"]);set("PorcIVA2",rate["PorcIVA2"]);
                string[] flags = {"suspendido","Suspendido","modificaPrecio","ModifPV","enStock","EnStock"};
                for(int i=0;i<flags.Length;i+=2) { if(!(Value(data,flags[i]) is bool))throw new InvalidOperationException("Estado inválido en "+flags[i]);set(flags[i+1],Value(data,flags[i])); }
                string[] amounts = {"unidadesBulto","UniXBulto","costoLista","PrecioCpraSISDto","descuentos","ImpDtos","costoSinIva","PrecioCpraSI","costoConIva","PrecioCpraCI","minorista","PrecioVta3","intermedio","PrecioVta2","mayorista","PrecioVta1","gananciaMinorista","PorcGanMin","gananciaIntermedio","PorcGanInt","gananciaMayorista","PorcGanMay"};
                for(int i=0;i<amounts.Length;i+=2) {
                    bool gain=amounts[i].StartsWith("ganancia");
                    object v=ArticuloNumero(data,amounts[i],gain,amounts[i]!="unidadesBulto" && amounts[i]!="descuentos");
                    if(gain && v!=null) v=Number(v)/100m;
                    set(amounts[i+1],v);
                }
                set("IDOperModif",oper);sets.Add("[HoraModif]=GETDATE()");
                string[] priceKeys={"costoLista","costoSinIva","costoConIva","minorista","intermedio","mayorista","descuentos"};
                bool pricesChanged = Text(current["idIva"])!=Text(Value(data,"idIva"));
                foreach(string key in priceKeys) if(Text(current[key])!=Text(Value(data,key)))pricesChanged=true;
                if(pricesChanged)sets.Add("[FechaActPrec]=GETDATE()");
                if(Execute(connection,tx,"UPDATE dbo.[Artículos] SET "+String.Join(",",sets.ToArray())+" WHERE IDArt=@p0",values.ToArray())!=1)
                    throw new InvalidOperationException("No se pudo guardar el artículo.");
                var seen = new HashSet<int>(); bool stockChanged=false;
                foreach(object item in stockItems) {
                    var entry=Object(item); int branch=RequiredId(Value(entry,"id"),"la sucursal");
                    if(!seen.Add(branch))throw new InvalidOperationException("Sucursal duplicada.");
                    if(Scalar(connection,tx,"SELECT IDSuc FROM dbo.Sucursales WHERE IDSuc=@p0",branch)==null)throw new InvalidOperationException("Sucursal inválida.");
                    decimal stock=Number(ArticuloNumero(entry,"stock",true,false));string location=Limited(Value(entry,"ubicacion"),10,"Ubicación");
                    decimal previous=Number(Value(entry,"stockAnterior"));string previousLocation=Text(Value(entry,"ubicacionAnterior"));
                    var existing=RowsTx(connection,tx,"SELECT StockAct,Ubic FROM dbo.ArtsStock WITH(UPDLOCK,HOLDLOCK) WHERE IDArt=@p0 AND IDSuc=@p1",id,branch);
                    if(existing.Count>1)throw new InvalidOperationException("Stock duplicado para esta sucursal.");
                    object actual=existing.Count==0?0f:existing[0]["StockAct"];
                    string actualLocation=existing.Count==0?"":Text(existing[0]["Ubic"]);
                    if(!StockMatches(actual,previous) || actualLocation!=previousLocation)
                        throw new InvalidOperationException("El stock cambió desde otra PC. Recargá la ficha antes de guardar.");
                    if(!StockMatches(actual,stock) || actualLocation!=location) {
                        if(existing.Count==0)Execute(connection,tx,"INSERT INTO dbo.ArtsStock(IDArt,IDSuc,StockAct,Ubic) VALUES(@p0,@p1,@p2,@p3)",id,branch,stock,location);
                        else Execute(connection,tx,"UPDATE dbo.ArtsStock SET StockAct=@p2,Ubic=@p3 WHERE IDArt=@p0 AND IDSuc=@p1",id,branch,stock,location);
                        stockChanged=true;
                    }
                }
                if(stockChanged)Execute(connection,tx,"UPDATE dbo.[Artículos] SET StockAct=(SELECT ISNULL(SUM(StockAct),0) FROM dbo.ArtsStock WHERE IDArt=@p0) WHERE IDArt=@p0",id);
                var saved=ArticuloRows(connection,tx,id)[0];var savedStock=RowsTx(connection,tx,ArticuloStockSelect,id);
                if(prueba)tx.Rollback();else tx.Commit();
                return new {ok=true,articulo=saved,stock=savedStock,prueba=prueba};
            } catch {try {tx.Rollback();}catch{}throw;}
        }
    }

    private static void AssertPurchasePermission(string userId, string permission = "cargar_facturas", bool administratorOnly = false, bool strictAdministrator = false, bool reviewAdministrator = false)
    {
        string permissionName = permission == "facturacion" ? "Facturación" : permission == "recibos_cobro" ? "Recibos de Cobro" : permission == "proveedores_sql" ? "Proveedores SQL" : permission == "pagos_proveedores" ? "Pagos a proveedores" : permission == "historial_movimiento" ? "Historial de movimiento" : "Cargar facturas";
        if (String.IsNullOrWhiteSpace(userId) || userId.Length > 150) throw new InvalidOperationException("Iniciá sesión para usar " + permissionName + ".");
        Dictionary<string, object> fields;
        try
        {
            string url = "https://firestore.googleapis.com/v1/projects/corralon-progreso/databases/(default)/documents/menuUsuarios/" + Uri.EscapeDataString(userId)
                + "?mask.fieldPaths=nivel&mask.fieldPaths=permisos&mask.fieldPaths=permisosEdicion&key=AIzaSyCxwUGX-rVusOI13j7oTfQuAtkeNXdAYH0";
            var request = (HttpWebRequest)WebRequest.Create(url); request.Timeout = 8000;
            using (var response = request.GetResponse()) using (var reader = new StreamReader(response.GetResponseStream(), Encoding.UTF8))
                fields = Object(Value(Object(Json.DeserializeObject(reader.ReadToEnd())), "fields"));
        }
        catch { throw new InvalidOperationException("No se pudo verificar tu permiso de " + permissionName + ". Reintentá al recuperar la conexión."); }
        string level = Text(Value(Object(Value(fields, "nivel")), "stringValue")).ToLowerInvariant();
        if (level == "administrador") return;
        if(reviewAdministrator)throw new InvalidOperationException("Esta acción requiere una cuenta de administrador.");
        if (strictAdministrator) {
            if (UserHasModuleEditPermission(fields, permission)) return;
            throw new InvalidOperationException(permission == "recibos_cobro" ? "Solo los administradores de Recibos de Cobro pueden anular recibos." : "Solo los administradores de Facturación pueden anular boletas.");
        }
        if (administratorOnly)
        {
            if (UserHasModuleEditPermission(fields, permission)) return;
            throw new InvalidOperationException("Tu usuario no tiene permiso de edición para modificar los valores de una boleta.");
        }
        if (level != "vendedor" || permission == "facturacion" || permission == "historial_movimiento")
        {
            object values = Value(Object(Value(Object(Value(fields, "permisos")), "arrayValue")), "values");
            foreach (var item in PurchaseArray(values))
                if (Text(Value(Object(item), "stringValue")) == permission) return;
        }
        throw new InvalidOperationException("Tu usuario no tiene permiso para " + permissionName + ".");
    }

    private static bool UserHasModuleEditPermission(Dictionary<string, object> fields, string permission)
    {
        bool access = false, edit = false;
        foreach (var item in PurchaseArray(Value(Object(Value(Object(Value(fields, "permisos")), "arrayValue")), "values")))
            if (Text(Value(Object(item), "stringValue")) == permission) access = true;
        foreach (var item in PurchaseArray(Value(Object(Value(Object(Value(fields, "permisosEdicion")), "arrayValue")), "values")))
            if (Text(Value(Object(item), "stringValue")) == permission) edit = true;
        return access && edit;
    }

    private static string InvoiceCancellationVersion(SqlConnection c, SqlTransaction tx, int receipt)
    {
        return ProviderVersion(new Dictionary<string,object> {
            {"cabecera",RowsTx(c,tx,"SELECT * FROM dbo.FacturasATP WITH(HOLDLOCK) WHERE IDRecibo=@p0",receipt)},
            {"articulos",RowsTx(c,tx,"SELECT * FROM dbo.FacturasATS WITH(HOLDLOCK) WHERE IDRecibo=@p0 ORDER BY Orden",receipt)},
            {"valores",RowsTx(c,tx,"SELECT * FROM dbo.FacturasTSVal WITH(HOLDLOCK) WHERE IDRecibo=@p0 ORDER BY Orden",receipt)} });
    }
    private static object InvoiceCancelTx(SqlConnection c, SqlTransaction tx, Dictionary<string,object> input)
    {
        int receipt=Id(Text(Value(input,"idRecibo")));
        var rows=RowsTx(c,tx,"SELECT h.IDRecibo,h.NroFactura,CONVERT(int,h.Confirmado) AS Confirmado,CONVERT(int,h.Anulada) AS Anulada,CONVERT(int,h.ActStock) AS ActStock,h.IDSuc,t.IDTipoMovStock,t.StkPor,CONVERT(int,t.EnLibroIVA) AS EnLibroIVA,CONVERT(int,d.FE) AS FE FROM dbo.FacturasATP h WITH(UPDLOCK,HOLDLOCK) JOIN dbo.TipoComprobantes t ON t.IDComprob=h.IDComprob JOIN dbo.[Depósitos] d ON d.IDEmp=h.IDEmp AND d.[IDDepósito]=h.[IDDepósito] WHERE h.IDRecibo=@p0 AND h.IDComprob IN(1,2,5,6,7,8,13,29,43)",receipt);
        if(rows.Count!=1)throw new InvalidOperationException("La boleta no existe en SQL.");
        var h=rows[0];
        if(InvoiceValueNumber(Value(h,"Anulada"))!=0)return new {ok=true,idRecibo=receipt,yaAnulada=true};
        if(InvoiceValueNumber(Value(h,"Confirmado"))==0)throw new InvalidOperationException("La boleta debe estar confirmada.");
        if(InvoiceValueNumber(Value(h,"FE"))!=0 && InvoiceValueNumber(Value(h,"EnLibroIVA"))!=0)throw new InvalidOperationException("No se puede anular: debe hacer una nota de crédito/débito.");
        string version=Text(Value(input,"version"));
        if(version.Length==0 || version!=InvoiceCancellationVersion(c,tx,receipt))throw new InvalidOperationException("La boleta cambió. Volvé a consultarla antes de anular.");
        // Misma reversión que FVentasDesActualStockResta de Access.
        if(InvoiceValueNumber(Value(h,"ActStock"))!=0 && InvoiceValueNumber(Value(h,"IDTipoMovStock"))>0)
            Execute(c,tx,"UPDATE s SET StockAct=s.StockAct-a.Cantidad*@p2 FROM dbo.ArtsStock s JOIN (SELECT IDArt,SUM(Cantidad) AS Cantidad FROM dbo.FacturasATS WITH(HOLDLOCK) WHERE IDRecibo=@p0 GROUP BY IDArt) a ON a.IDArt=s.IDArt WHERE s.IDSuc=@p1",receipt,Value(h,"IDSuc"),InvoiceValueNumber(Value(h,"StkPor")));
        // bConfi_Click: conservar los renglones y poner en cero la cabecera.
        if(Execute(c,tx,"UPDATE dbo.FacturasATP SET Anulada=-1,ImpIVA1=0,ImpIVA2=0,SubTotal=0,Total=0,TotalCC=0,TotalCH=0,TotalEC=0,TotalEF=0 WHERE IDRecibo=@p0 AND Anulada=0",receipt)!=1)throw new InvalidOperationException("No se pudo anular la boleta.");
        return new {ok=true,idRecibo=receipt,yaAnulada=false};
    }
    private static object InvoiceCancel(SqlConnection c, Dictionary<string,object> input)
    {
        using(var tx=c.BeginTransaction(IsolationLevel.Serializable)) {
            var result=InvoiceCancelTx(c,tx,input);tx.Commit();return result;
        }
    }
    private static string InvoiceValuesVersion(SqlConnection c, SqlTransaction tx, int receipt)
    {
        return ProviderVersion(new Dictionary<string,object> {
            {"cabecera", RowsTx(c,tx,"SELECT IDRecibo,Confirmado,Anulada,IDCliente,IDComprob,Total,TotalME,ImpAtoDto,TotalEF,TotalEC,TotalCC,TotalCH,Pagada,ActStock,EnInfVtas,IDSuc,CAE,CUIT,ApeYNom,IDTipoDocFis,IDTipoIVA FROM dbo.FacturasATP WITH(HOLDLOCK) WHERE IDRecibo=@p0",receipt)},
            {"baseArticulos", RowsTx(c,tx,"SELECT SUM(Importe) AS importe,COUNT(*) AS filas FROM dbo.FacturasATS WITH(HOLDLOCK) WHERE IDRecibo=@p0",receipt)},
            {"cantidades",RowsTx(c,tx,"SELECT IDArt,SUM(Cantidad) AS cantidad FROM dbo.FacturasATS WITH(HOLDLOCK) WHERE IDRecibo=@p0 GROUP BY IDArt ORDER BY IDArt",receipt)},
            {"valores", RowsTx(c,tx,"SELECT * FROM dbo.FacturasTSVal WITH(HOLDLOCK) WHERE IDRecibo=@p0 ORDER BY Orden",receipt)} });
    }
    private static decimal InvoiceValueNumber(object value) { return value==null || value==DBNull.Value ? 0m : Number(value); }
    private static string InvoiceValuesBalanceError(decimal issuedTotal, decimal articlesTotal, decimal valuesBase, decimal valuesAdjustment, decimal valuesTotal)
    {
        issuedTotal = Math.Abs(issuedTotal); articlesTotal = Math.Abs(articlesTotal);
        if (Math.Abs(valuesTotal-issuedTotal)>.005m)
            return "Los valores recibidos deben coincidir con el total de la boleta. La diferencia debe ser cero.";
        if (Math.Abs(valuesBase-articlesTotal)>.005m || Math.Abs(valuesAdjustment-(issuedTotal-articlesTotal))>.005m)
            return "Los valores no conservan la base de artículos y el descuento/recargo emitido. Artículos: " + articlesTotal.ToString("N2",CultureInfo.GetCultureInfo("es-AR")) +
                "; ajuste emitido: " + (issuedTotal-articlesTotal).ToString("N2",CultureInfo.GetCultureInfo("es-AR")) +
                "; ajuste cargado: " + valuesAdjustment.ToString("N2",CultureInfo.GetCultureInfo("es-AR")) + ". Reasigná el ajuste entre los medios de pago antes de guardar.";
        return "";
    }
    private static bool InvoiceHeaderFlag(object value){return value is bool?(bool)value:InvoiceValueNumber(value)!=0;}
    private static Dictionary<string,object> InvoiceHeaderChanges(SqlConnection c,SqlTransaction tx,int receipt,Dictionary<string,object> input,Dictionary<string,object> header) {
        var edits=Object(Value(input,"cabecera"));if(edits.Count==0)return edits;
        AssertPurchasePermission(Text(Value(input,"usuarioId")),"facturacion",false,true);
        foreach(var pair in edits)if(Array.IndexOf(new[]{"idCliente","completo","actualizaStock","enInformeVentas"},pair.Key)<0)throw new InvalidOperationException("Campo de boleta no editable: "+pair.Key);
        foreach(string key in new[]{"completo","actualizaStock","enInformeVentas"})if(edits.ContainsKey(key)&&!(edits[key] is bool))throw new InvalidOperationException("Estado inválido para "+key+".");
        var result=new Dictionary<string,object>(edits);int original=Convert.ToInt32(InvoiceValueNumber(Value(header,"IDCliente")));
        int customer=edits.ContainsKey("idCliente")?RequiredId(Value(edits,"idCliente"),"el cliente"):original;result["idCliente"]=customer;
        if(customer!=original){
            var customers=CustomerDetail(c,customer,tx);if(customers.Count!=1||InvoiceHeaderFlag(Value(customers[0],"suspendido")))throw new InvalidOperationException("El cliente no existe o está suspendido.");
            if(CustomerMergeDestination(c,tx,customer)>0)throw new InvalidOperationException("La cuenta elegida fue unificada. Elegí la cuenta principal.");
            if(InvoiceValueNumber(Scalar(c,tx,"SELECT COUNT(*) FROM dbo.RecibosXTSFac f WITH(HOLDLOCK) JOIN dbo.RecibosXTP r WITH(HOLDLOCK) ON r.IDRecibo=f.IDRecibo WHERE f.IDFactura=@p0 AND r.Anulado=0 AND r.IDCliente<>@p1",receipt,customer))>0)throw new InvalidOperationException("La boleta tiene recibos de cobro de otro cliente. Resolvé esos recibos o unificá las cuentas antes de cambiar el cliente.");
            var client=customers[0];bool fiscal=System.Text.RegularExpressions.Regex.IsMatch(Text(Value(header,"CAE")),@"^\d{14}$");
            if(fiscal&&CustomerDocumentDigits(Text(Value(client,"documento")))!=CustomerDocumentDigits(Text(Value(header,"CUIT"))))throw new InvalidOperationException("La factura tiene CAE. Solo se puede vincular a otra cuenta del mismo documento; los datos autorizados no se modifican.");
            result["cliente"]=client;result["conservarDatosFiscales"]=fiscal;
        }
        return result;
    }
    private static decimal InvoiceHeaderStockTarget(object current,object quantity,decimal multiplier){return StoredStock((current==null||current==DBNull.Value?0m:StockNumber(current))+(quantity==null||quantity==DBNull.Value?0m:StockNumber(quantity))*multiplier);}
    private static void InvoiceApplyHeaderChanges(SqlConnection c,SqlTransaction tx,int receipt,Dictionary<string,object> changes,Dictionary<string,object> header) {
        if(changes.Count==0)return;
        int customer=Convert.ToInt32(changes["idCliente"]);bool stock=changes.ContainsKey("actualizaStock")?Convert.ToBoolean(changes["actualizaStock"]):InvoiceHeaderFlag(Value(header,"ActStock"));
        bool complete=changes.ContainsKey("completo")?Convert.ToBoolean(changes["completo"]):InvoiceHeaderFlag(Value(header,"Pagada"));
        bool report=changes.ContainsKey("enInformeVentas")?Convert.ToBoolean(changes["enInformeVentas"]):InvoiceHeaderFlag(Value(header,"EnInfVtas"));
        if(stock!=(InvoiceHeaderFlag(Value(header,"ActStock")))){
            var types=RowsTx(c,tx,"SELECT IDTipoMovStock,StkPor FROM dbo.TipoComprobantes WITH(HOLDLOCK) WHERE IDComprob=@p0",Value(header,"IDComprob"));
            decimal direction=types.Count==1&&InvoiceValueNumber(Value(types[0],"IDTipoMovStock"))>0?InvoiceValueNumber(Value(types[0],"StkPor")):0;
            if(direction==0&&stock)throw new InvalidOperationException("Este tipo de comprobante no genera movimientos de stock.");
            if(direction!=0){
                int branch=RequiredId(Value(header,"IDSuc"),"la sucursal de la boleta");decimal multiplier=direction*(stock?1m:-1m);
                var articles=RowsTx(c,tx,"SELECT d.IDArt,SUM(d.Cantidad) AS Cantidad,MAX(CONVERT(int,ISNULL(a.EnStock,0))) AS EnStock FROM dbo.FacturasATS d WITH(HOLDLOCK) LEFT JOIN dbo.[Artículos] a WITH(HOLDLOCK) ON a.IDArt=d.IDArt WHERE d.IDRecibo=@p0 GROUP BY d.IDArt ORDER BY d.IDArt",receipt);
                foreach(var article in articles){
                    string id=Text(Value(article,"IDArt"));var stocks=RowsTx(c,tx,"SELECT StockAct FROM dbo.ArtsStock WITH(UPDLOCK,HOLDLOCK) WHERE IDArt=@p0 AND IDSuc=@p1",id,branch);
                    if(stocks.Count==0&&InvoiceValueNumber(Value(article,"EnStock"))==0)continue;
                    if(stocks.Count!=1)throw new InvalidOperationException("Falta un registro de stock único para "+id+" en la sucursal de la boleta.");
                    decimal expected=InvoiceHeaderStockTarget(Value(stocks[0],"StockAct"),Value(article,"Cantidad"),multiplier);
                    if(Execute(c,tx,"UPDATE dbo.ArtsStock SET StockAct=@p0 WHERE IDArt=@p1 AND IDSuc=@p2",expected,id,branch)!=1||!StockMatches(Scalar(c,tx,"SELECT StockAct FROM dbo.ArtsStock WHERE IDArt=@p0 AND IDSuc=@p1",id,branch),expected))throw new InvalidOperationException("No se pudo verificar el ajuste de stock de "+id+".");
                }
            }
        }
        if(changes.ContainsKey("cliente")){
            var client=Object(changes["cliente"]);
            if(Convert.ToBoolean(changes["conservarDatosFiscales"]))Execute(c,tx,"UPDATE dbo.FacturasATP SET IDCliente=@p0 WHERE IDRecibo=@p1",customer,receipt);
            else Execute(c,tx,"UPDATE dbo.FacturasATP SET IDCliente=@p0,ApeYNom=@p1,CUIT=@p2,IDTipoDocFis=@p3,IDTipoIVA=@p4,[Dirección]=@p5,[Teléfono]=@p6 WHERE IDRecibo=@p7",customer,Limited(Upper(Value(client,"nombre")),100,"Nombre del cliente"),Limited(Value(client,"documento"),13,"Documento"),Value(client,"idTipoDoc"),Value(client,"idTipoIva"),Limited(Value(client,"direccion"),100,"Dirección"),Limited(Value(client,"telefono"),50,"Teléfono"),receipt);
        }
        if(Execute(c,tx,"UPDATE dbo.FacturasATP SET Pagada=@p0,ActStock=@p1,EnInfVtas=@p2 WHERE IDRecibo=@p3",complete,stock?-1:0,report,receipt)!=1)throw new InvalidOperationException("No se pudieron guardar los datos de la boleta.");
    }

    private static object InvoiceValuesSave(SqlConnection c,Dictionary<string,object> input) {
        using(var tx=c.BeginTransaction(IsolationLevel.Serializable)){var result=InvoiceValuesSaveCore(c,tx,input);tx.Commit();return result;}
    }
    private static object InvoiceValuesSaveCore(SqlConnection c,SqlTransaction tx,Dictionary<string,object> input) {
        int receipt=RequiredId(Value(input,"idRecibo"),"la boleta");var edits=PurchaseArray(Value(input,"valores"));
            var headers=RowsTx(c,tx,"SELECT IDCliente,IDComprob,Confirmado,Anulada,Total,Pagada,ActStock,EnInfVtas,IDSuc,CAE,CUIT FROM dbo.FacturasATP WITH(UPDLOCK,HOLDLOCK) WHERE IDRecibo=@p0",receipt);
            if(headers.Count!=1 || InvoiceValueNumber(Value(headers[0],"Confirmado"))==0 || InvoiceValueNumber(Value(headers[0],"Anulada"))!=0)throw new InvalidOperationException("La boleta debe estar confirmada y sin anular.");
            if(Array.IndexOf(new[]{1,2,5,6,7,8,13,29,43},Convert.ToInt32(InvoiceValueNumber(Value(headers[0],"IDComprob"))))<0)throw new InvalidOperationException("Este comprobante no admite edición desde Facturación.");
            if(Text(Value(input,"version"))!=InvoiceValuesVersion(c,tx,receipt))throw new InvalidOperationException("La boleta cambió en otro equipo. Cerrá y volvé a consultar antes de guardar.");
            var headerChanges=InvoiceHeaderChanges(c,tx,receipt,input,headers[0]);int targetCustomer=headerChanges.Count>0?Convert.ToInt32(headerChanges["idCliente"]):Convert.ToInt32(InvoiceValueNumber(Value(headers[0],"IDCliente")));
            var stored=RowsTx(c,tx,"SELECT Orden,IDTipoPago,IDTarjeta,Cuotas,Importe,ImpRec,Coef,ImpEnt,Concepto,FechaVto,IDMovBco,IDRec FROM dbo.FacturasTSVal WITH(UPDLOCK,HOLDLOCK) WHERE IDRecibo=@p0 ORDER BY Orden",receipt);
            if(edits.Count<1 || edits.Count>100)throw new InvalidOperationException("Ingresá entre 1 y 100 valores recibidos.");
            decimal cash=0,card=0,account=0,bank=0,valuesBase=0,valuesAdjustment=0;var seen=new HashSet<int>();var prepared=new List<object[]>();
            foreach(var item in edits)
            {
                var edit=Object(item);int order=Convert.ToInt32(InvoiceValueNumber(Value(edit,"orden")));
                var old=stored.Find(v=>Convert.ToInt32(InvoiceValueNumber(Value(v,"Orden")))==order);
                if(order!=0 && (old==null || !seen.Add(order)))throw new InvalidOperationException("Renglón de valor inválido o repetido.");
                int kind=RequiredId(Value(edit,"idTipoPago"),"el tipo de valor"),cardId=Convert.ToInt32(InvoiceValueNumber(Value(edit,"idTarjeta"))),installments=Convert.ToInt32(InvoiceValueNumber(Value(edit,"cuotas")));
                decimal baseAmount=InvoiceValueNumber(Value(edit,"importe")),fee=InvoiceValueNumber(Value(edit,"impRec")),coefficient=InvoiceValueNumber(Value(edit,"coef"));
                if(baseAmount<=0 || baseAmount>1000000000 || coefficient< -1 || coefficient>5 || Math.Abs(baseAmount-Math.Round(baseAmount,2,MidpointRounding.AwayFromZero))>.001m || Math.Abs(fee-Math.Round(fee,2,MidpointRounding.AwayFromZero))>.001m || Math.Abs(fee-Math.Round(baseAmount*coefficient,2,MidpointRounding.AwayFromZero))>.01m)throw new InvalidOperationException("El importe y el descuento o recargo del valor no coinciden.");
                decimal amount=baseAmount+fee;if(amount<0)throw new InvalidOperationException("El total del valor no puede ser negativo.");
                valuesBase+=baseAmount;valuesAdjustment+=fee;
                bool changed=old==null || kind!=InvoiceValueNumber(Value(old,"IDTipoPago")) || cardId!=InvoiceValueNumber(Value(old,"IDTarjeta")) || installments!=InvoiceValueNumber(Value(old,"Cuotas")) || baseAmount!=InvoiceValueNumber(Value(old,"Importe")) || fee!=InvoiceValueNumber(Value(old,"ImpRec")) || coefficient!=InvoiceValueNumber(Value(old,"Coef"));
                if(old!=null && changed && InvoiceValueNumber(Value(old,"IDMovBco"))>0)throw new InvalidOperationException("El valor ya tiene un movimiento bancario vinculado. Resolvé ese movimiento antes de cambiarlo.");
                object clsValue=Scalar(c,tx,"SELECT IDClasePago FROM dbo.TiposPagos WHERE IDTipoPago=@p0 AND EnCaja=1",kind);
                int cls=clsValue==null?0:Convert.ToInt32(clsValue);
                if(cls==2 && !changed){bank+=amount;continue;}
                if(kind==14 || Array.IndexOf(new[]{1,3,5,6},cls)<0)throw new InvalidOperationException("Elegí un tipo de valor habilitado en Facturación.");
                if(cls==3 || cls==5)
                {
                    if(cardId<=0 || Scalar(c,tx,"SELECT 1 FROM dbo.Tarjetas WHERE IDTarjeta=@p0 AND Susp=0",cardId)==null)throw new InvalidOperationException("Elegí una tarjeta o cuenta vigente.");
                    if(cls==5 && (installments<1 || Scalar(c,tx,"SELECT 1 FROM dbo.TarjetasCuotas WHERE IDTipoPago=@p0 AND Cuotas=@p1",cardId,installments)==null))throw new InvalidOperationException("Elegí un plan de cuotas vigente.");
                    if(cls==3 && installments!=0)throw new InvalidOperationException("La transferencia no admite cuotas.");
                    if(cls==5)card+=amount;else bank+=amount;
                }
                else
                {
                    if(cardId!=0 || installments!=0)throw new InvalidOperationException("Este tipo de valor no admite tarjeta ni cuotas.");
                    if(cls==6){if(targetCustomer<=1)throw new InvalidOperationException("Cuenta corriente requiere un cliente registrado.");account+=amount;}else cash+=amount;
                }
                string description=Limited(Value(edit,"descripcion"),30,"Concepto");
                prepared.Add(new object[]{order,kind,cardId,installments,baseAmount,fee,amount,coefficient,description});
            }
            decimal articlesTotal=Math.Abs(InvoiceValueNumber(Scalar(c,tx,"SELECT SUM(Importe) FROM dbo.FacturasATS WITH(HOLDLOCK) WHERE IDRecibo=@p0",receipt)));
            string balanceError=InvoiceValuesBalanceError(InvoiceValueNumber(Value(headers[0],"Total")),articlesTotal,valuesBase,valuesAdjustment,cash+card+account+bank);
            if(balanceError.Length>0)throw new InvalidOperationException(balanceError);
            decimal collected=Number(Scalar(c,tx,"SELECT ISNULL(SUM(f.ImpPagado),0) FROM dbo.RecibosXTSFac f JOIN dbo.RecibosXTP h ON h.IDRecibo=f.IDRecibo WHERE f.IDFactura=@p0 AND h.Confirmado=1 AND h.Anulado=0",receipt));
            if(account<Math.Abs(collected))throw new InvalidOperationException("Cuenta corriente no puede quedar por debajo de los recibos de cobro ya vinculados.");
            foreach(var old in stored)if(!seen.Contains(Convert.ToInt32(InvoiceValueNumber(Value(old,"Orden")))))
            {
                if(InvoiceValueNumber(Value(old,"IDMovBco"))>0)throw new InvalidOperationException("No se puede quitar un valor con un movimiento bancario vinculado.");
            }
            foreach(var line in prepared)
            {
                if(Convert.ToInt32(line[0])==0)Execute(c,tx,"INSERT dbo.FacturasTSVal(IDRecibo,IDTipoPago,IDTarjeta,Cuotas,Importe,ImpRec,ImpEnt,Coef,Concepto,FechaVto) VALUES(@p0,@p1,@p2,@p3,@p4,@p5,@p6,@p7,@p8,(SELECT Fecha FROM dbo.FacturasATP WHERE IDRecibo=@p0))",receipt,line[1],line[2],line[3],line[4],line[5],line[6],line[7],line[8]);
                else if(Execute(c,tx,"UPDATE dbo.FacturasTSVal SET IDTipoPago=@p0,IDTarjeta=@p1,Cuotas=@p2,Importe=@p3,ImpRec=@p4,ImpEnt=@p5,Coef=@p6,Concepto=@p7 WHERE IDRecibo=@p8 AND Orden=@p9",line[1],line[2],line[3],line[4],line[5],line[6],line[7],line[8],receipt,line[0])!=1)throw new InvalidOperationException("No se pudo actualizar el valor.");
            }
            foreach(var old in stored)if(!seen.Contains(Convert.ToInt32(InvoiceValueNumber(Value(old,"Orden")))))
            {
                if(Execute(c,tx,"DELETE dbo.FacturasTSVal WHERE IDRecibo=@p0 AND Orden=@p1",receipt,Value(old,"Orden"))!=1)throw new InvalidOperationException("No se pudo quitar el valor.");
            }
            decimal sign=InvoiceValueNumber(Value(headers[0],"Total"))<0?-1m:1m;
            Execute(c,tx,"UPDATE dbo.FacturasATP SET TotalEF=@p0,TotalEC=@p1,TotalCC=@p2,TotalCH=@p3 WHERE IDRecibo=@p4",cash*sign,card*sign,account*sign,bank*sign,receipt);
        InvoiceApplyHeaderChanges(c,tx,receipt,headerChanges,headers[0]);
        return new {ok=true};
    }
    private static string ProviderVersion(Dictionary<string, object> row)
    {
        using (var sha = SHA256.Create()) return BitConverter.ToString(sha.ComputeHash(Encoding.UTF8.GetBytes(Json.Serialize(row)))).Replace("-", "");
    }
    private static object ProviderDetail(SqlConnection c, SqlTransaction tx, int id)
    {
        var records = RowsTx(c, tx, "SELECT * FROM dbo.Proveedores WHERE IDProveedor=@p0", id);
        if (records.Count != 1) throw new InvalidOperationException("El proveedor no existe o fue eliminado.");
        return new { ok = true, proveedor = records[0], version = ProviderVersion(records[0]) };
    }
    private static object ProviderQuery(SqlConnection c, HttpListenerRequest request)
    {
        string query = request.QueryString["consulta"] ?? "opciones";
        int id; Int32.TryParse(request.QueryString["id"], out id);
        if (query == "detalle") return ProviderDetail(c, null, id);
        if (query != "opciones") throw new InvalidOperationException("Consulta de proveedores desconocida.");
        return new { ok = true,
            proveedores = Rows(c, "SELECT IDProveedor AS id,[RazónSocial] AS nombre,CUIT AS cuit,Suspendido AS suspendido,Contacto AS contacto,[Dirección] AS direccion,Localidad AS localidad,[Teléfono] AS telefono,Email AS email FROM dbo.Proveedores ORDER BY [RazónSocial],IDProveedor"),
            provincias = Rows(c, "SELECT IDProvincia AS id,Provincia AS nombre FROM dbo.Provincias ORDER BY Provincia"),
            tiposIva = Rows(c, "SELECT IDTipoIVA AS id,Descripcion AS nombre FROM dbo.TiposIVA ORDER BY IDTipoIVA"),
            tiposIb = Rows(c, "SELECT IDTipoIB AS id,TipoIB AS nombre FROM dbo.TiposIB ORDER BY IDTipoIB"),
            tiposProveedor = Rows(c, "SELECT IDTipoProv AS id,TipoProv AS nombre FROM dbo.TiposProvee ORDER BY IDTipoProv"),
            tiposBien = Rows(c, "SELECT IDTipoBien AS id,TipoBien AS nombre FROM dbo.TiposBienCpra ORDER BY IDTipoBien"),
            cuentas = Rows(c, "SELECT CodCuenta AS id,Cuenta AS nombre FROM dbo.Cuentas ORDER BY Cuenta"),
            siguienteId = Scalar(c, null, "SELECT ISNULL(MAX(IDProveedor),0)+1 FROM dbo.Proveedores") };
    }
    private static object ProviderSave(SqlConnection c, Dictionary<string, object> input)
    {
        string action = Text(Value(input, "accion"));
        if (action != "guardar" && action != "eliminar") throw new InvalidOperationException("Acción de proveedor inválida.");
        Guid requestId;
        if (!Guid.TryParse(Text(Value(input, "solicitud")), out requestId)) throw new InvalidOperationException("La solicitud no tiene identificador válido.");
        int operatorId = UserOperator(c, Text(Value(input, "usuarioId")));
        int id; Int32.TryParse(Text(Value(input, "id")), out id);
        string fingerprint;
        using (var sha = SHA256.Create()) fingerprint = BitConverter.ToString(sha.ComputeHash(Encoding.UTF8.GetBytes(Json.Serialize(input)))).Replace("-", "");
        using (var tx = c.BeginTransaction(IsolationLevel.Serializable))
        {
            try
            {
                if (Convert.ToInt32(Scalar(c, tx, "DECLARE @r int; EXEC @r=sp_getapplock @Resource='CorralonWeb.Proveedores',@LockMode='Exclusive',@LockOwner='Transaction',@LockTimeout=10000; SELECT @r")) < 0)
                    throw new InvalidOperationException("Otro usuario está guardando proveedores. Reintentá.");
                Scalar(c, tx, "IF OBJECT_ID('dbo.WebProveedoresSolicitudes','U') IS NULL CREATE TABLE dbo.WebProveedoresSolicitudes(Solicitud uniqueidentifier NOT NULL PRIMARY KEY,Hash varchar(64) NOT NULL,ProveedorId int NOT NULL,OperadorId int NOT NULL,Resultado nvarchar(max) NOT NULL,Fecha datetime NOT NULL DEFAULT GETDATE()); SELECT 1");
                var previous = RowsTx(c, tx, "SELECT Hash,Resultado FROM dbo.WebProveedoresSolicitudes WHERE Solicitud=@p0", requestId);
                if (previous.Count > 0)
                {
                    if (Text(previous[0]["Hash"]) != fingerprint) throw new InvalidOperationException("Esta solicitud ya fue usada con otros datos.");
                    object repeated = Json.DeserializeObject(Text(previous[0]["Resultado"])); tx.Commit(); return repeated;
                }
                if (id > 0)
                {
                    var current = RowsTx(c, tx, "SELECT * FROM dbo.Proveedores WITH(UPDLOCK,HOLDLOCK) WHERE IDProveedor=@p0", id);
                    if (current.Count != 1) throw new InvalidOperationException("El proveedor no existe o fue eliminado.");
                    if (Text(Value(input, "version")) != ProviderVersion(current[0])) throw new InvalidOperationException("Otro usuario modificó este proveedor. Volvé a consultarlo antes de guardar.");
                }
                object result;
                if (action == "eliminar")
                {
                    if (id <= 0) throw new InvalidOperationException("Seleccioná un proveedor para eliminar.");
                    var references = RowsTx(c, tx, "SELECT QUOTENAME(s.name)+'.'+QUOTENAME(t.name) AS tabla FROM sys.tables t JOIN sys.schemas s ON s.schema_id=t.schema_id JOIN sys.columns col ON col.object_id=t.object_id WHERE col.name='IDProveedor' AND t.object_id<>OBJECT_ID('dbo.Proveedores')");
                    foreach (var reference in references)
                        if (Number(Scalar(c, tx, "SELECT COUNT_BIG(*) FROM " + Text(reference["tabla"]) + " WHERE IDProveedor=@p0", id)) > 0)
                            throw new InvalidOperationException("El proveedor tiene artículos o movimientos vinculados. Usá Suspendido para conservar su historial.");
                    Scalar(c, tx, "DELETE dbo.Proveedores WHERE IDProveedor=@p0; SELECT @@ROWCOUNT", id);
                    result = new { ok = true, eliminado = id };
                }
                else
                {
                    var values = new Dictionary<string, object>();
                    string[] strings = {"nombre","RazónSocial","100","contacto","Contacto","25","telefonoContacto","TelContacto","50","direccion","Dirección","100","localidad","Localidad","50","codigoPostal","CodPostal","30","telefonos","Teléfono","75","celular","Celular","50","email","Email","150","web","Web","150","nroIibb","NroIIBB","15","bancos","Bancos","10000","nota","Nota","10000"};
                    for (int i = 0; i < strings.Length; i += 3) values[strings[i + 1]] = Limited(Value(input, strings[i]), Int32.Parse(strings[i + 2]), strings[i]).Trim();
                    values["RazónSocial"] = Text(values["RazónSocial"]).ToUpperInvariant();
                    if (Text(values["RazónSocial"]).Length == 0) throw new InvalidOperationException("Ingresá la razón social del proveedor.");
                    string cuit = Text(Value(input, "cuit")).Replace("-", "").Replace(" ", "");
                    if (cuit.Length > 0 && !ValidCuit(cuit)) throw new InvalidOperationException("El CUIT del proveedor no es válido.");
                    if (cuit.Length > 0 && Number(Scalar(c, tx, "SELECT COUNT(*) FROM dbo.Proveedores WHERE REPLACE(REPLACE(CUIT,'-',''),' ','')=@p0 AND IDProveedor<>@p1", cuit, id)) > 0)
                        throw new InvalidOperationException("Ya existe un proveedor con ese CUIT. Seleccionalo de la lista.");
                    values["CUIT"] = cuit.Length == 11 ? cuit.Substring(0, 2) + "-" + cuit.Substring(2, 8) + "-" + cuit.Substring(10) : (object)DBNull.Value;
                    string[] lookups = {"provincia","Provincia","Provincias","IDProvincia","tipoIva","IDTipoIVA","TiposIVA","IDTipoIVA","tipoIb","IDTipoIB","TiposIB","IDTipoIB","tipoProveedor","IDTipoProv","TiposProvee","IDTipoProv","tipoBien","IDTipoBien","TiposBienCpra","IDTipoBien"};
                    for (int i = 0; i < lookups.Length; i += 4)
                    {
                        int lookup; if (!Int32.TryParse(Text(Value(input, lookups[i])), out lookup)) throw new InvalidOperationException("Seleccioná " + lookups[i] + " de SQL.");
                        if (Number(Scalar(c, tx, "SELECT COUNT(*) FROM dbo.[" + lookups[i + 2] + "] WHERE [" + lookups[i + 3] + "]=@p0", lookup)) != 1) throw new InvalidOperationException("El valor de " + lookups[i] + " no existe en SQL.");
                        values[lookups[i + 1]] = lookup;
                    }
                    string account = Limited(Value(input, "cuenta"), 10, "Cuenta");
                    if (Number(Scalar(c, tx, "SELECT COUNT(*) FROM dbo.Cuentas WHERE CodCuenta=@p0", account)) != 1) throw new InvalidOperationException("Seleccioná una cuenta de SQL.");
                    values["CodCta"] = account;
                    values["Suspendido"] = Value(input, "suspendido") != null && Convert.ToBoolean(Value(input, "suspendido"));
                    values["PorcProv"] = Value(input, "gananciasProveedor") != null && Convert.ToBoolean(Value(input, "gananciasProveedor"));
                    string[] margins = {"gananciaMayorista","PorcGan1","gananciaIntermedio","PorcGan2","gananciaMinorista","PorcGan3"};
                    for (int i = 0; i < margins.Length; i += 2) { decimal rate = Number(Value(input, margins[i])); if (rate < 0 || rate > 100) throw new InvalidOperationException("Revisá los porcentajes de ganancias."); values[margins[i + 1]] = rate; }
                    var columns = new List<string>(); var parameters = new List<string>(); var assignments = new List<string>(); var args = new List<object>();
                    foreach (var value in values) { string p = "@p" + args.Count; columns.Add("[" + value.Key + "]"); parameters.Add(p); assignments.Add("[" + value.Key + "]=" + p); args.Add(value.Value); }
                    if (id > 0) { string p = "@p" + args.Count; args.Add(id); Scalar(c, tx, "UPDATE dbo.Proveedores SET " + String.Join(",", assignments.ToArray()) + " WHERE IDProveedor=" + p + "; SELECT @@ROWCOUNT", args.ToArray()); }
                    else
                    {
                        id = Convert.ToInt32(Scalar(c, tx, "SELECT ISNULL(MAX(IDProveedor),0)+1 FROM dbo.Proveedores WITH(UPDLOCK,HOLDLOCK)"));
                        columns.Add("IDProveedor"); parameters.Add("@p" + args.Count); args.Add(id);
                        Scalar(c, tx, "INSERT dbo.Proveedores(" + String.Join(",", columns.ToArray()) + ") VALUES(" + String.Join(",", parameters.ToArray()) + "); SELECT @@ROWCOUNT", args.ToArray());
                    }
                    result = ProviderDetail(c, tx, id);
                }
                Scalar(c, tx, "INSERT dbo.WebProveedoresSolicitudes(Solicitud,Hash,ProveedorId,OperadorId,Resultado) VALUES(@p0,@p1,@p2,@p3,@p4); SELECT 1", requestId, fingerprint, id, operatorId, Json.Serialize(result));
                tx.Commit(); return result;
            }
            catch { tx.Rollback(); throw; }
        }
    }

    private static List<object> PurchaseArray(object value)
    {
        var result = new List<object>();
        if (value is object[]) result.AddRange((object[])value);
        else if (value is System.Collections.ArrayList) foreach (object item in (System.Collections.ArrayList)value) result.Add(item);
        return result;
    }

    private static DateTime PurchaseDate(object value, string label)
    {
        DateTime date;
        if (!DateTime.TryParseExact(Text(value), "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out date) || date.Year < 1900 || date.Year > 2099)
            throw new InvalidOperationException("Revisá " + label + ".");
        return date;
    }

    private static decimal PurchaseMoney(object value)
    {
        return Math.Round(Number(value), 2, MidpointRounding.AwayFromZero);
    }

    private static bool PurchaseCuitValid(string value)
    {
        string digits = System.Text.RegularExpressions.Regex.Replace(value, @"\D", "");
        if (digits.Length != 11) return false;
        int[] weights = { 5, 4, 3, 2, 7, 6, 5, 4, 3, 2 }; int sum = 0;
        for (int i = 0; i < 10; i++) sum += (digits[i] - '0') * weights[i];
        int check = 11 - sum % 11; if (check == 11) check = 0; if (check == 10) check = 9;
        return digits[10] - '0' == check;
    }

    private static string PurchaseDiscountVersion(SqlConnection c,SqlTransaction tx,int id)
    {
        var data=RowsTx(c,tx,"SELECT * FROM dbo.ComprasTP WHERE IDRecibo=@p0",id);
        using(var sha=SHA256.Create())return BitConverter.ToString(sha.ComputeHash(Encoding.UTF8.GetBytes(Json.Serialize(data)))).Replace("-","");
    }
    private static decimal PurchaseDiscountAmount(decimal total,decimal discount)
    {
        if(discount<=0 || discount>=1)throw new InvalidOperationException("Ingresá un descuento mayor a cero y menor al 100%.");
        decimal amount=-PurchaseMoney(total*discount);
        if(amount==0)throw new InvalidOperationException("El descuento es demasiado pequeño para generar un crédito.");
        return amount;
    }
    private static void PurchaseCreateDiscount(SqlConnection c,SqlTransaction tx,int receipt,decimal discount,int operatorId)
    {
        var records=RowsTx(c,tx,"SELECT * FROM dbo.ComprasTP WITH(UPDLOCK,HOLDLOCK) WHERE IDRecibo=@p0 AND Confirmado=1",receipt);
        if(records.Count!=1)throw new InvalidOperationException("La compra no existe o no está confirmada.");
        var p=records[0];
        int point=Convert.ToInt32(p["IDDepósito"]),provider=Convert.ToInt32(p["IDProveedor"]),payment=Convert.ToInt32(p["IDFormaPago"]),branch=Convert.ToInt32(p["IDSuc"]),company=Convert.ToInt32(p["IDEmp"]);
        DateTime date=Convert.ToDateTime(p["Fecha"]),period=Convert.ToDateTime(p["FechaIVA"]),due=Convert.ToDateTime(p["FechaVto"]);
        string number=Text(p["NroFactura"]),account=Text(p["CodCuentaCpra"]),cuit=Text(p["CUIT"]);
        decimal signed=Number(p["Total"]);

        decimal creditAmount = PurchaseDiscountAmount(signed,discount);
        int credit = Convert.ToInt32(Scalar(c, tx, "INSERT dbo.ComprasTP(IDTipoComp,IDDepósito,Fecha,FechaIVA,IDProveedor,Proveedor,Concepto,CUIT,IDFormaPago,NroFactura,CodCuentaCpra,Nota,Confirmado,Total,FechaVto,IDSuc,IDOper,IDEmp,IDTipoBien) OUTPUT INSERTED.IDRecibo VALUES(51,@p0,@p1,@p2,@p3,@p4,@p5,@p6,@p7,@p8,@p9,@p10,1,@p11,@p12,@p13,@p14,@p15,2)", point, date, new DateTime(period.Year, period.Month, 1), provider, p["Proveedor"], "Credito Factura N° " + number, cuit, payment, number, account, "Descuento de compra " + receipt, creditAmount, due, branch, operatorId, company));
        Execute(c, tx, "INSERT dbo.ComprasTS(IDRecibo,IDImpuesto,[Descripción],Importe,PorcImp,NroNeto) VALUES(@p0,0,'Neto 1',@p1,0,1)", credit, Math.Abs(creditAmount));
        Execute(c, tx, "UPDATE dbo.ComprasTP SET IDRecImp=@p0,ImpDto=@p2 WHERE IDRecibo=@p1", credit, receipt,discount);
        var lastPayment = RowsTx(c, tx, "SELECT TOP 1 NroOrden FROM dbo.OrdPagosTP WITH(UPDLOCK,HOLDLOCK) WHERE IDProveedor=@p0 AND IDEmp=@p1 AND Confirmado=1 AND ISNULL(Anulado,0)=0 ORDER BY NroOrden DESC", provider, company);
        if (lastPayment.Count == 0) throw new InvalidOperationException("El proveedor no tiene un pago confirmado y no anulado para aplicar el descuento.");
        int discountOrder = Convert.ToInt32(lastPayment[0]["NroOrden"]);
        Execute(c, tx, "INSERT dbo.OrdPagosTSFac(NroOrden,IDFactura,Importe) VALUES(@p0,@p1,@p2)", discountOrder, credit, creditAmount);
        Execute(c, tx, "UPDATE dbo.OrdPagosTSFac SET Importe=Importe+@p2 WHERE NroOrden=@p0 AND IDFactura=@p1; IF @@ROWCOUNT=0 INSERT dbo.OrdPagosTSFac(NroOrden,IDFactura,Importe) VALUES(@p0,@p1,@p2)", discountOrder, receipt, -creditAmount);
                
    }
    private static object PurchaseGenerateDiscount(SqlConnection c,Dictionary<string,object> input)
    {
        int id=RequiredId(Value(input,"id"),"la compra");
        decimal discount=Number(Value(input,"descuento"));
        int operatorId=UserOperator(c,Text(Value(input,"usuarioId")));
        using(var tx=c.BeginTransaction(IsolationLevel.Serializable)){
            try{
                var records=RowsTx(c,tx,"SELECT p.*,t.IDTipoAcred FROM dbo.ComprasTP p WITH(UPDLOCK,HOLDLOCK) JOIN dbo.TipoComprobantes t ON t.IDComprob=p.IDTipoComp WHERE p.IDRecibo=@p0 AND p.Confirmado=1",id);
                if(records.Count!=1)throw new InvalidOperationException("La compra no existe o ya no está confirmada.");
                var p=records[0];decimal total=Number(p["Total"]);
                if(total<=0 || Number(p["IDTipoAcred"])==2 || Number(p["IDTipoComp"])==51)throw new InvalidOperationException("Solo se puede generar descuento sobre una compra positiva.");
                decimal amount=PurchaseDiscountAmount(total,discount);
                int credit=Convert.ToInt32(InvoiceValueNumber(Value(p,"IDRecImp")));
                if(credit>0){
                    var linked=RowsTx(c,tx,"SELECT IDRecibo FROM dbo.ComprasTP WITH(UPDLOCK,HOLDLOCK) WHERE IDRecibo=@p0 AND IDTipoComp=51 AND Confirmado=1 AND IDProveedor=@p1 AND Total=@p2",credit,p["IDProveedor"],amount);
                    if(Math.Abs(InvoiceValueNumber(p["ImpDto"])-discount)<0.000000001m && linked.Count==1){var previous=PurchaseResult(c,tx,id);tx.Rollback();return previous;}
                    throw new InvalidOperationException("Esta compra ya tiene un crédito o descuento vinculado. Consultalo antes de generar otro.");
                }
                if(InvoiceValueNumber(p["ImpDto"])!=0)throw new InvalidOperationException("La compra ya tiene un porcentaje de descuento. Revisá su crédito antes de continuar.");
                string version=Text(Value(input,"version"));
                if(version.Length==0 || version!=PurchaseDiscountVersion(c,tx,id))throw new InvalidOperationException("La compra cambió en otra PC. Cerrá y volvé a consultar antes de generar el descuento.");
                PurchaseCreateDiscount(c,tx,id,discount,operatorId);
                var result=PurchaseResult(c,tx,id);tx.Commit();return result;
            }catch{try{tx.Rollback();}catch{}throw;}
        }
    }
    private static object PurchaseResult(SqlConnection c, SqlTransaction tx, int id)
    {
        return new { ok = true,versionDescuento=PurchaseDiscountVersion(c,tx,id),
            factura = RowsTx(c, tx, "SELECT p.*,(SELECT e.Nombre FROM dbo.Empleados e WHERE e.IDEmpleado=p.IDOper) AS operadorNombre,t.Abreviatura AS tipo,t.Descripcion AS tipoNombre,t.Discrimina,t.EnLibroIVA,t.IDTipoAcred,ISNULL(d.IDSucAsoc,p.IDSuc) AS sucursalReal,d.[Descripción] AS puntoVentaNombre,c.Cuenta,fp.TipoPago AS pago,b.TipoBien,r.IDRecibo AS stockId,r.NroMov AS stockNumero FROM dbo.ComprasTP p JOIN dbo.TipoComprobantes t ON t.IDComprob=p.IDTipoComp LEFT JOIN dbo.[Depósitos] d ON d.IDDepósito=p.IDDepósito LEFT JOIN dbo.Cuentas c ON c.CodCuenta=p.CodCuentaCpra LEFT JOIN dbo.TiposPagos fp ON fp.IDTipoPago=p.IDFormaPago LEFT JOIN dbo.TiposBienCpra b ON b.IDTipoBien=p.IDTipoBien OUTER APPLY (SELECT TOP 1 IDRecibo,NroMov FROM dbo.RecibosTP WHERE IDFactura=p.IDRecibo AND Confirmado=1 AND Anulado=0 ORDER BY IDRecibo DESC) r WHERE p.IDRecibo=@p0 AND p.Confirmado=1", id),
            impuestos = RowsTx(c, tx, "SELECT d.IDImpuesto AS impuesto,d.NroNeto AS neto,d.Importe AS importe,d.PorcImp AS porcentaje,d.[Descripción] AS descripcion,i.Impuesto AS nombre FROM dbo.ComprasTS d JOIN dbo.Impuestos i ON i.IDImpuesto=d.IDImpuesto WHERE d.IDRecibo=@p0 ORDER BY d.NroNeto,d.IDImpuesto", id),
            pagos = RowsTx(c, tx, "SELECT o.NroOrden,o.NroOP,o.Fecha,o.TotalPagos,o.Nota,tp.TipoPago,v.Importe FROM dbo.OrdPagosTSFac f JOIN dbo.OrdPagosTP o ON o.NroOrden=f.NroOrden LEFT JOIN dbo.OrdPagosTSPag v ON v.NroOrden=o.NroOrden LEFT JOIN dbo.TiposPagos tp ON tp.IDTipoPago=v.IDTipoPago WHERE f.IDFactura=@p0 AND o.Confirmado=1 AND o.Anulado=0 ORDER BY o.Fecha,o.NroOrden", id),
            credito = RowsTx(c, tx, "SELECT c.IDRecibo,c.NroFactura,c.Total FROM dbo.ComprasTP p JOIN dbo.ComprasTP c ON c.IDRecibo=p.IDRecImp AND c.Confirmado=1 WHERE p.IDRecibo=@p0", id) };
    }

    private static void PurchaseCashPayment(SqlConnection c, SqlTransaction tx, int id, int operatorId)
    {
        var records = RowsTx(c, tx, "SELECT IDFormaPago,IDProveedor,IDDepósito,IDEmp,Fecha,NroFactura,Total,ISNULL(IDRecImp,0) AS IDRecImp FROM dbo.ComprasTP WITH(UPDLOCK,HOLDLOCK) WHERE IDRecibo=@p0 AND Confirmado=1", id);
        if (records.Count != 1) throw new InvalidOperationException("La compra no existe.");
        var p = records[0];
        if (Convert.ToInt32(p["IDFormaPago"]) == 1) return; // Reintentar no crea otra orden.
        if (Convert.ToInt32(p["IDFormaPago"]) != 3 || Number(p["Total"]) <= 0) throw new InvalidOperationException("Solo se pueden pasar a efectivo las facturas positivas cargadas en cuenta corriente.");
        if (Number(Scalar(c,tx,"SELECT COUNT(*) FROM dbo.OrdPagosTSFac f WITH(UPDLOCK,HOLDLOCK) JOIN dbo.OrdPagosTP o WITH(UPDLOCK,HOLDLOCK) ON o.NroOrden=f.NroOrden WHERE (f.IDFactura=@p0 OR f.IDFactura=@p1) AND o.Confirmado=1 AND ISNULL(o.Anulado,0)=0",id,p["IDRecImp"])) > 0)
            throw new InvalidOperationException("No se puede pasar a efectivo: la factura o su crédito interno ya tienen una orden de pago confirmada y no anulada aplicada.");
        if (RowsTx(c,tx,"SELECT IDTipoPago FROM dbo.TiposPagos WHERE IDTipoPago=1 AND EnCpras=1").Count != 1) throw new InvalidOperationException("Efectivo no está habilitado para compras.");
        decimal paid = Number(Scalar(c,tx,"SELECT ISNULL(SUM(f.Importe),0) FROM dbo.OrdPagosTSFac f WITH(UPDLOCK,HOLDLOCK) JOIN dbo.OrdPagosTP o WITH(UPDLOCK,HOLDLOCK) ON o.NroOrden=f.NroOrden WHERE f.IDFactura=@p0 AND o.Confirmado=1 AND ISNULL(o.Anulado,0)=0",id));
        decimal invoicePending = PurchaseMoney(Number(p["Total"])-paid), creditPending = 0;
        int creditId = Convert.ToInt32(p["IDRecImp"]);
        if (creditId > 0)
        {
            var credits = RowsTx(c,tx,"SELECT Total FROM dbo.ComprasTP WITH(UPDLOCK,HOLDLOCK) WHERE IDRecibo=@p0 AND IDTipoComp=51 AND IDProveedor=@p1 AND IDEmp=@p2 AND Confirmado=1",creditId,p["IDProveedor"],p["IDEmp"]);
            if (credits.Count != 1 || Number(credits[0]["Total"]) > 0) throw new InvalidOperationException("Revisá el crédito interno vinculado a la factura.");
            decimal creditPaid = Number(Scalar(c,tx,"SELECT ISNULL(SUM(f.Importe),0) FROM dbo.OrdPagosTSFac f WITH(UPDLOCK,HOLDLOCK) JOIN dbo.OrdPagosTP o WITH(UPDLOCK,HOLDLOCK) ON o.NroOrden=f.NroOrden WHERE f.IDFactura=@p0 AND o.Confirmado=1 AND ISNULL(o.Anulado,0)=0",creditId));
            creditPending = PurchaseMoney(Number(credits[0]["Total"])-creditPaid);
            if (creditPending > 0) throw new InvalidOperationException("El crédito interno tiene aplicaciones inconsistentes. Revisá sus pagos.");
        }
        decimal cash = PurchaseMoney(invoicePending + creditPending);
        if (invoicePending <= 0 || cash <= 0) throw new InvalidOperationException("La factura ya está pagada o no tiene saldo pendiente para generar un pago en efectivo.");
        int opNumber = Convert.ToInt32(Scalar(c,tx,"SELECT ISNULL(MAX(NroOP),0)+1 FROM dbo.OrdPagosTP WITH(UPDLOCK,HOLDLOCK)"));
        int order = Convert.ToInt32(Scalar(c,tx,"INSERT dbo.OrdPagosTP(NroOP,Fecha,IDProveedor,Confirmado,IDDepósito,TotalCpras,TotalPagos,IDOper,IDEmp,Nota) OUTPUT INSERTED.NroOrden VALUES(@p0,@p1,@p2,1,@p3,@p4,@p4,@p5,@p6,@p7)",opNumber,p["Fecha"],p["IDProveedor"],p["IDDepósito"],cash,operatorId,p["IDEmp"],"Pago de factura " + Text(p["NroFactura"])));
        Execute(c,tx,"INSERT dbo.OrdPagosTSFac(NroOrden,IDFactura,Importe) VALUES(@p0,@p1,@p2)",order,id,invoicePending);
        if (creditPending != 0) Execute(c,tx,"INSERT dbo.OrdPagosTSFac(NroOrden,IDFactura,Importe) VALUES(@p0,@p1,@p2)",order,creditId,creditPending);
        Execute(c,tx,"INSERT dbo.OrdPagosTSPag(NroOrden,IDTipoPago,Importe,FechaVto,IDBanco,IDMovBco) VALUES(@p0,1,@p1,@p2,0,NULL)",order,cash,p["Fecha"]);
        Execute(c,tx,"UPDATE dbo.ComprasTP SET IDFormaPago=1 WHERE IDRecibo=@p0",id);
        if (creditId > 0) Execute(c,tx,"UPDATE dbo.ComprasTP SET IDFormaPago=1 WHERE IDRecibo=@p0",creditId);
    }

    private static object PurchaseEditHeader(SqlConnection c, Dictionary<string, object> input)
    {
        int id = RequiredId(Value(input, "id"), "la compra");
        string number = Limited(Value(input, "numero"), 20, "Número de boleta").Trim();
        if (!System.Text.RegularExpressions.Regex.IsMatch(number, @"^\d{4}-\d{8}$")) throw new InvalidOperationException("Ingresá el número con formato 0000-00000000.");
        bool inStock = Convert.ToBoolean(Value(input, "enStock"));
        int requestedPayment = Value(input,"pago") == null ? 0 : RequiredId(Value(input,"pago"),"la forma de pago");
        int paymentOperator = requestedPayment == 1 ? UserOperator(c,Text(Value(input,"usuarioId"))) : 0;
        using (var tx = c.BeginTransaction(IsolationLevel.Serializable))
        {
            try
            {
                var records = RowsTx(c, tx, "SELECT IDProveedor,IDTipoComp,NroFactura,EnMovStk,ISNULL(IDMovStk,0) AS IDMovStk,ISNULL(IDRecImp,0) AS IDRecImp,CodCuentaCpra,IDFormaPago FROM dbo.ComprasTP WITH(UPDLOCK,HOLDLOCK) WHERE IDRecibo=@p0 AND Confirmado=1", id);
                if (records.Count != 1) throw new InvalidOperationException("La compra no existe.");
                var p = records[0];
                bool currentStock = p["EnMovStk"] != null && p["EnMovStk"] != DBNull.Value && Convert.ToBoolean(p["EnMovStk"]);
                bool paymentChanged = requestedPayment > 0 && requestedPayment != Convert.ToInt32(p["IDFormaPago"]);
                if (Text(p["NroFactura"]) == number && currentStock == inStock && !paymentChanged) { var existing = PurchaseResult(c, tx, id); tx.Commit(); return existing; }
                if (Text(p["NroFactura"]) != Text(Value(input, "numeroAnterior")) || currentStock != Convert.ToBoolean(Value(input, "enStockAnterior")) || (paymentChanged && Convert.ToInt32(p["IDFormaPago"]) != RequiredId(Value(input,"pagoAnterior"),"la forma de pago anterior"))) throw new InvalidOperationException("Otro usuario modificó la compra. Cerrá y volvé a consultarla.");
                if (paymentChanged && requestedPayment != 1) throw new InvalidOperationException("Solo está habilitado el cambio de cuenta corriente a efectivo.");
                if (inStock && Text(p["CodCuentaCpra"]).Trim() == "11") throw new InvalidOperationException("Las compras de fletes no se incluyen en movimientos de stock.");
                if (!inStock && (Number(p["IDMovStk"]) > 0 || Number(Scalar(c, tx, "SELECT COUNT(*) FROM dbo.RecibosTP WHERE IDFactura=@p0 AND IDTipoMov=23 AND Confirmado=1 AND Anulado=0", id)) > 0)) throw new InvalidOperationException("Anulá primero la carga de stock vinculada antes de desmarcar esta opción.");
                if (Number(Scalar(c, tx, "SELECT COUNT(*) FROM dbo.ComprasTP WHERE IDProveedor=@p0 AND IDTipoComp=@p1 AND NroFactura=@p2 AND Confirmado=1 AND IDRecibo<>@p3", p["IDProveedor"], p["IDTipoComp"], number, id)) > 0) throw new InvalidOperationException("Ya existe otra compra con ese número de boleta.");
                Execute(c, tx, "UPDATE dbo.ComprasTP SET NroFactura=@p0,EnMovStk=@p1 WHERE IDRecibo=@p2", number, inStock, id);
                Execute(c, tx, "UPDATE dbo.RecibosTP SET NroFactura=@p0 WHERE IDFactura=@p1 AND IDTipoMov=23 AND Confirmado=1 AND Anulado=0", number, id);
                if (Number(p["IDRecImp"]) > 0) Execute(c, tx, "UPDATE dbo.ComprasTP SET NroFactura=@p0 WHERE IDRecibo=@p1 AND IDTipoComp=51", number, p["IDRecImp"]);
                if (paymentChanged) PurchaseCashPayment(c,tx,id,paymentOperator);
                var result = PurchaseResult(c, tx, id); tx.Commit(); return result;
            }
            catch { try { tx.Rollback(); } catch { } throw; }
        }
    }

    private static List<Dictionary<string,object>> PurchaseAvailableStock(SqlConnection c,SqlTransaction tx,int provider,int company,int receipt)
    {
        string hints=tx==null?"":" WITH(UPDLOCK,HOLDLOCK)";
        return RowsTx(c,tx,"SELECT r.IDRecibo AS id,r.NroMov AS numero,CONVERT(varchar(10),r.Fecha,103) AS fecha,r.Total AS total,r.NroRemito AS remito,r.IDSuc AS sucursal,s.Sucursal AS sucursalNombre,t.Descripcion AS tipo,r.NroMov,r.IDFactura,r.NroFactura,r.IDSuc,r.IDRecibo FROM dbo.RecibosTP r"+hints+" JOIN dbo.TipoComprobantes t ON t.IDComprob=r.IDTipoMov LEFT JOIN dbo.Sucursales s ON s.IDSuc=r.IDSuc WHERE r.IDProveedor=@p0 AND r.IDEmp=@p1 AND (@p2=0 OR r.IDRecibo=@p2) AND r.Fecha>=DATEADD(day,-90,CONVERT(date,GETDATE())) AND r.IDTipoMov=23 AND r.Confirmado=1 AND r.Anulado=0 AND t.EnStk=1 AND t.IDTipoMovStock=1 AND r.IDFactura IS NULL AND r.NroFactura IS NULL AND NOT EXISTS(SELECT 1 FROM dbo.ComprasTP p"+hints+" LEFT JOIN dbo.[Depósitos] d ON d.IDDepósito=p.IDDepósito WHERE p.IDMovStk=r.NroMov AND p.IDProveedor=r.IDProveedor AND ISNULL(d.IDSucAsoc,p.IDSuc)=r.IDSuc) ORDER BY r.Fecha DESC,r.NroMov DESC",provider,company,receipt);
    }
    private static object PurchaseEditStock(SqlConnection c,Dictionary<string,object> input)
    {
        int id=RequiredId(Value(input,"id"),"la compra");
        int movement=Convert.ToInt32(Number(Value(input,"movimiento")??0));
        int previous=Convert.ToInt32(Number(Value(input,"movimientoAnterior")??0));
        if(movement<0)throw new InvalidOperationException("Movimiento inválido.");
        using(var tx=c.BeginTransaction(IsolationLevel.Serializable))
        {
            try
            {
                var invoices=RowsTx(c,tx,"SELECT p.*,ISNULL(d.IDSucAsoc,p.IDSuc) AS sucursalReal FROM dbo.ComprasTP p WITH(UPDLOCK,HOLDLOCK) LEFT JOIN dbo.[Depósitos] d ON d.IDDepósito=p.IDDepósito WHERE p.IDRecibo=@p0 AND p.Confirmado=1",id);
                if(invoices.Count!=1)throw new InvalidOperationException("La compra no existe.");
                var invoice=invoices[0];
                var old=RowsTx(c,tx,"SELECT IDRecibo,NroMov,IDFactura FROM dbo.RecibosTP WITH(UPDLOCK,HOLDLOCK) WHERE IDTipoMov=23 AND Confirmado=1 AND (IDFactura=@p0 OR (IDFactura IS NULL AND NroMov=@p1 AND IDProveedor=@p2 AND IDSuc=@p3 AND NroFactura=@p4))",id,invoice["IDMovStk"]??0,invoice["IDProveedor"],invoice["sucursalReal"],invoice["NroFactura"]);
                if(old.Count>1)throw new InvalidOperationException("La factura tiene más de una carga vinculada. Revisá la vinculación.");
                if((movement==0 && old.Count==0 && Number(invoice["IDMovStk"]??0)==0)||(old.Count==1 && Number(old[0]["IDRecibo"])==movement))
                {var existing=PurchaseResult(c,tx,id);tx.Commit();return existing;}
                if(Number(invoice["IDMovStk"]??0)!=previous)throw new InvalidOperationException("Otro usuario cambió el movimiento. Cerrá y volvé a consultar la factura.");
                if(movement>0 && previous>0 && old.Count==0)throw new InvalidOperationException("No se encontró la carga de stock vinculada. Podés borrar el número para quitar el vínculo anterior.");
                Dictionary<string,object> next=null;
                if(movement>0)
                {
                    if(!Convert.ToBoolean(invoice["EnMovStk"]) || Text(invoice["CodCuentaCpra"]).Trim()=="11")throw new InvalidOperationException("La factura no está habilitada para movimientos de stock.");
                    var available=PurchaseAvailableStock(c,tx,Convert.ToInt32(invoice["IDProveedor"]),Convert.ToInt32(invoice["IDEmp"]),movement);
                    if(available.Count!=1)throw new InvalidOperationException("El movimiento ya no está disponible para este proveedor y sucursal.");
                    next=available[0];
                }
                foreach(var row in old)Execute(c,tx,"UPDATE dbo.RecibosTP SET IDFactura=NULL,NroFactura=NULL WHERE IDRecibo=@p0",row["IDRecibo"]);
                if(next!=null)Execute(c,tx,"UPDATE dbo.RecibosTP SET IDFactura=@p0,NroFactura=@p1 WHERE IDRecibo=@p2",id,invoice["NroFactura"],movement);
                Execute(c,tx,"UPDATE dbo.ComprasTP SET IDMovStk=@p0 WHERE IDRecibo=@p1",next==null?(object)DBNull.Value:next["NroMov"],id);
                var result=PurchaseResult(c,tx,id);tx.Commit();return result;
            }
            catch{try{tx.Rollback();}catch{}throw;}
        }
    }
    private sealed class PurchaseRemovalState
    {
        public List<Dictionary<string, object>> facturas, impuestos, pagos, stock, padres, ordenes, valoresPago, facturasPago, articulosStock;
        public List<string> motivos = new List<string>();
        public List<string> motivosEliminar = new List<string>();
        public bool ok = true, bloqueado, bloqueadoEliminar;
        public string version = "";
    }
    private static PurchaseRemovalState PurchaseRemovalPreview(SqlConnection c, SqlTransaction tx, int id)
    {
        string hints = tx == null ? "" : " WITH(UPDLOCK,HOLDLOCK)";
        var main = RowsTx(c, tx, "SELECT * FROM dbo.ComprasTP" + hints + " WHERE IDRecibo=@p0", id);
        if (main.Count != 1) throw new InvalidOperationException("La compra no existe o ya fue eliminada.");
        int credit = Convert.ToInt32(Number(main[0]["IDRecImp"] ?? 0));
        string ids = id.ToString(CultureInfo.InvariantCulture) + (credit > 0 && credit != id ? "," + credit.ToString(CultureInfo.InvariantCulture) : "");
        var state = new PurchaseRemovalState {
            facturas = RowsTx(c, tx, "SELECT * FROM dbo.ComprasTP" + hints + " WHERE IDRecibo IN(" + ids + ") ORDER BY IDRecibo"),
            impuestos = RowsTx(c, tx, "SELECT * FROM dbo.ComprasTS" + hints + " WHERE IDRecibo IN(" + ids + ") ORDER BY IDRecibo,NroNeto,IDImpuesto"),
            pagos = RowsTx(c, tx, "SELECT f.IDFactura,f.NroOrden,o.NroOP,f.Importe,o.Confirmado,o.Anulado FROM dbo.OrdPagosTSFac f" + hints + " LEFT JOIN dbo.OrdPagosTP o ON o.NroOrden=f.NroOrden WHERE f.IDFactura IN(" + ids + ") ORDER BY f.IDFactura,f.NroOrden"),
            stock = RowsTx(c, tx, "SELECT r.IDRecibo,r.NroMov,r.IDFactura,r.IDSuc,r.Confirmado,r.Anulado FROM dbo.RecibosTP r" + hints + " WHERE r.IDTipoMov=23 AND r.Confirmado=1 AND EXISTS(SELECT 1 FROM dbo.ComprasTP p LEFT JOIN dbo.[Depósitos] d ON d.IDDepósito=p.IDDepósito WHERE p.IDRecibo IN(" + ids + ") AND (r.IDFactura=p.IDRecibo OR (r.IDFactura IS NULL AND p.IDMovStk=r.NroMov AND r.IDProveedor=p.IDProveedor AND r.NroFactura=p.NroFactura AND r.IDSuc=ISNULL(d.IDSucAsoc,p.IDSuc)))) ORDER BY r.IDRecibo"),
            padres = RowsTx(c, tx, "SELECT IDRecibo,NroFactura,IDRecImp,ImpDto FROM dbo.ComprasTP" + hints + " WHERE IDRecImp IN(" + ids + ") AND IDRecibo NOT IN(" + ids + ") ORDER BY IDRecibo") };
        string orderFilter=" WHERE NroOrden IN(SELECT NroOrden FROM dbo.OrdPagosTSFac WHERE IDFactura IN("+ids+"))";
        state.ordenes=RowsTx(c,tx,"SELECT * FROM dbo.OrdPagosTP"+hints+orderFilter+" ORDER BY NroOrden");
        state.valoresPago=RowsTx(c,tx,"SELECT v.*,t.TipoPago FROM dbo.OrdPagosTSPag v"+hints+" LEFT JOIN dbo.TiposPagos t ON t.IDTipoPago=v.IDTipoPago"+orderFilter+" ORDER BY NroOrden,IDOrden");
        state.facturasPago=RowsTx(c,tx,"SELECT f.*,p.NroFactura AS numeroFactura,p.Proveedor AS proveedor FROM dbo.OrdPagosTSFac f"+hints+" LEFT JOIN dbo.ComprasTP p ON p.IDRecibo=f.IDFactura"+orderFilter+" ORDER BY NroOrden,IDFactura");
        state.articulosStock=new List<Dictionary<string,object>>();
        foreach(var movement in state.stock)state.articulosStock.AddRange(RowsTx(c,tx,"SELECT d.*,a.IDArtProv AS codigo,a.[Descripción] AS descripcion FROM dbo.RecibosTS d"+hints+" LEFT JOIN dbo.[Artículos] a ON a.IDArt=d.IDArt WHERE d.IDRecibo=@p0 ORDER BY d.IDOrden",movement["IDRecibo"]));
        foreach(var order in state.ordenes)
        {
            var reasons=new List<string>();
            if(state.facturasPago.Exists(row=>Number(row["NroOrden"])==Number(order["NroOrden"]) && !state.facturas.Exists(header=>Number(header["IDRecibo"])==Number(row["IDFactura"]))))reasons.Add("Tiene otra factura asociada. No se puede eliminar esta orden de pago.");
            if(Number(order["IDAsiento"]??0)>0 || Number(order["IDRecImp"]??0)>0)reasons.Add("Tiene un asiento o comprobante vinculado.");
            if(state.valoresPago.Exists(row=>Number(row["NroOrden"])==Number(order["NroOrden"]) && Number(row["IDMovBco"]??0)>0))reasons.Add("Tiene un movimiento bancario vinculado.");
            order["bloqueadoEliminar"]=reasons.Count>0;order["motivoEliminar"]=String.Join(" ",reasons.ToArray());
            state.motivosEliminar.AddRange(reasons);
        }
        foreach (var movement in state.stock)
        {
            if (movement["IDFactura"] != null && !state.facturas.Exists(header => Number(header["IDRecibo"]) == Number(movement["IDFactura"]))) state.motivos.Add("El movimiento de stock está vinculado a otra compra. Revisá esa vinculación.");
            if (Number(Scalar(c, tx, "SELECT COUNT(*) FROM dbo.ComprasTP" + hints + " WHERE IDRecibo NOT IN(" + ids + ") AND IDMovStk=@p0 AND IDProveedor=@p1 AND NroFactura=@p2 AND IDDepósito IN(SELECT IDDepósito FROM dbo.[Depósitos] WHERE IDSucAsoc=@p3)", movement["NroMov"], main[0]["IDProveedor"], main[0]["NroFactura"], movement["IDSuc"])) > 0) state.motivos.Add("Otra compra referencia esta carga de stock. Revisá esa vinculación.");
            bool linked=Number(Scalar(c,tx,"SELECT COUNT(*) FROM dbo.RecibosTP R"+hints+" WHERE (R.IDRecibo=@p0 AND (ISNULL(R.IDRecDes,0)<>0 OR ISNULL(R.IDRemito,0)<>0 OR EXISTS(SELECT 1 FROM dbo.TipoComprobantes T WHERE T.IDComprob=R.IDTipoMov AND (ISNULL(T.GenNS,0)<>0 OR ISNULL(T.ConReceta,0)<>0)))) OR R.IDRecDes=@p0 OR R.IDRemito=@p0",movement["IDRecibo"]))>0;
            movement["bloqueadoEliminar"]=linked;movement["motivoEliminar"]=linked?"La carga tiene otros movimientos vinculados.":"";
            if(linked)state.motivosEliminar.Add(Text(movement["motivoEliminar"]));
        }
        foreach (var header in state.facturas)
        {
            if (Number(header["IDMovStk"] ?? 0) > 0 && !state.stock.Exists(movement => Number(movement["NroMov"]) == Number(header["IDMovStk"]) && (movement["IDFactura"] == null || Number(movement["IDFactura"]) == Number(header["IDRecibo"])))) state.motivos.Add("La cabecera referencia un movimiento de stock que no coincide con la carga vinculada. Revisá esa vinculación antes de eliminar.");
            if (Number(header["IDAsiento"] ?? 0) > 0) state.motivos.Add("Tiene un asiento contable vinculado. Debés resolverlo antes de eliminar.");
            if (Number(header["IDRecibo"]) != id && Number(header["IDTipoComp"]) != 51) state.motivos.Add("El movimiento vinculado no es un crédito interno por descuento. Revisá la vinculación.");
        }
        if (credit > 0 && state.padres.Count > 0) state.motivos.Add("El crédito está vinculado a otra compra. Revisá la vinculación antes de eliminar.");
        state.bloqueado = state.motivos.Count > 0;
        state.bloqueadoEliminar=state.bloqueado || state.motivosEliminar.Count>0;
        using (var sha = SHA256.Create()) state.version = BitConverter.ToString(sha.ComputeHash(Encoding.UTF8.GetBytes(Json.Serialize(state)))).Replace("-", "");
        return state;
    }
    private static string PurchaseRemovalChoice(Dictionary<string,object> input,string group,object id)
    {
        string choice=Value(input,group)==null?Text(Value(input,"vinculaciones")):Text(Value(Object(Value(input,group)),Text(id)));
        if(choice!="desvincular" && choice!="eliminar")throw new InvalidOperationException("Elegí una acción para cada carga y orden de pago.");
        return choice;
    }
    private static object PurchaseDelete(SqlConnection c, Dictionary<string, object> input)
    {
        int id = RequiredId(Value(input, "id"), "la compra");
        int oper = UserOperator(c, Text(Value(input, "usuarioId")));
        string version = Text(Value(input, "version"));
        using (var tx = c.BeginTransaction(IsolationLevel.Serializable))
        {
            try
            {
                if (Convert.ToInt32(Scalar(c, tx, "DECLARE @r int; EXEC @r=sp_getapplock @Resource='CorralonWeb.EliminarCompra',@LockMode='Exclusive',@LockOwner='Transaction',@LockTimeout=10000; SELECT @r")) < 0) throw new InvalidOperationException("Otra PC está eliminando una compra. Reintentá.");
                Scalar(c, tx, "IF OBJECT_ID('dbo.WebComprasEliminadas','U') IS NULL CREATE TABLE dbo.WebComprasEliminadas(IDRecibo int NOT NULL PRIMARY KEY,Version varchar(64) NOT NULL,Usuario nvarchar(150) NOT NULL,IDOper int NOT NULL,Fecha datetime NOT NULL DEFAULT GETDATE(),Datos nvarchar(max) NOT NULL); SELECT 1");
                var prior = RowsTx(c, tx, "SELECT Version FROM dbo.WebComprasEliminadas WHERE IDRecibo=@p0", id);
                if (prior.Count > 0 && RowsTx(c, tx, "SELECT IDRecibo FROM dbo.ComprasTP WHERE IDRecibo=@p0", id).Count == 0)
                {
                    if (Text(prior[0]["Version"]) != version) throw new InvalidOperationException("Esta compra ya fue eliminada desde otra consulta.");
                    tx.Commit(); return new { ok = true, eliminado = id, yaEliminado = true };
                }
                var state = PurchaseRemovalPreview(c, tx, id);
                if (state.bloqueado) throw new InvalidOperationException(String.Join(" ", state.motivos.ToArray()));
                if (version != state.version) throw new InvalidOperationException("La compra o sus vinculaciones cambiaron. Volvé a consultar antes de eliminar.");
                foreach(var movement in state.stock)if(PurchaseRemovalChoice(input,"stockAcciones",movement["IDRecibo"])=="eliminar" && Convert.ToBoolean(movement["bloqueadoEliminar"]))throw new InvalidOperationException(Text(movement["motivoEliminar"]));
                foreach(var order in state.ordenes)if(PurchaseRemovalChoice(input,"pagoAcciones",order["NroOrden"])=="eliminar" && Convert.ToBoolean(order["bloqueadoEliminar"]))throw new InvalidOperationException(Text(order["motivoEliminar"]));
                string archived = Json.Serialize(state);
                foreach (var movement in state.stock)
                {
                    string mode=PurchaseRemovalChoice(input,"stockAcciones",movement["IDRecibo"]);
                    if(mode=="desvincular")
                    {
                        if (Execute(c, tx, "UPDATE dbo.RecibosTP SET IDFactura=NULL,NroFactura=NULL WHERE IDRecibo=@p0 AND IDTipoMov=23 AND Confirmado=1", movement["IDRecibo"]) != 1) throw new InvalidOperationException("No se pudo liberar la carga de stock vinculada.");
                    }
                    else
                    {
                        if(!Convert.ToBoolean(movement["Anulado"]))
                            Execute(c,tx,"UPDATE A SET A.StockAct=ISNULL(A.StockAct,0)-D.Cantidad*T.StkPor FROM dbo.ArtsStock A JOIN (SELECT IDArt,SUM(Cantidad) AS Cantidad FROM dbo.RecibosTS WHERE IDRecibo=@p0 GROUP BY IDArt) D ON D.IDArt=A.IDArt JOIN dbo.RecibosTP R ON R.IDRecibo=@p0 AND R.IDSuc=A.IDSuc JOIN dbo.TipoComprobantes T ON T.IDComprob=R.IDTipoMov WHERE T.IDTipoMovStock>0",movement["IDRecibo"]);
                        Execute(c,tx,"DELETE dbo.RecibosTS WHERE IDRecibo=@p0",movement["IDRecibo"]);
                        if(Execute(c,tx,"DELETE dbo.RecibosTP WHERE IDRecibo=@p0",movement["IDRecibo"])!=1)throw new InvalidOperationException("No se pudo eliminar la carga de stock.");
                    }
                }
                foreach(var order in state.ordenes)
                {
                    string mode=PurchaseRemovalChoice(input,"pagoAcciones",order["NroOrden"]);
                    if(mode=="eliminar")
                    {
                        Execute(c,tx,"DELETE dbo.OrdPagosTSFac WHERE NroOrden=@p0",order["NroOrden"]);
                        Execute(c,tx,"DELETE dbo.OrdPagosTSPag WHERE NroOrden=@p0",order["NroOrden"]);
                        Execute(c,tx,"DELETE dbo.OrdPagosTP WHERE NroOrden=@p0",order["NroOrden"]);
                    }
                    else
                    {
                        foreach(var parent in state.padres){int creditId=Convert.ToInt32(parent["IDRecImp"]);decimal credit=Number(Scalar(c,tx,"SELECT ISNULL(SUM(Importe),0) FROM dbo.OrdPagosTSFac WHERE NroOrden=@p0 AND IDFactura=@p1",order["NroOrden"],creditId));if(credit<0){decimal parentApplied=Number(Scalar(c,tx,"SELECT ISNULL(SUM(Importe),0) FROM dbo.OrdPagosTSFac WHERE NroOrden=@p0 AND IDFactura=@p1",order["NroOrden"],parent["IDRecibo"]));if(parentApplied < -credit)throw new InvalidOperationException("La aplicación de la factura cambió. Revisá la orden antes de desvincular el crédito.");Execute(c,tx,"UPDATE dbo.OrdPagosTSFac SET Importe=Importe+@p2 WHERE NroOrden=@p0 AND IDFactura=@p1; DELETE dbo.OrdPagosTSFac WHERE NroOrden=@p0 AND IDFactura=@p1 AND Importe=0",order["NroOrden"],parent["IDRecibo"],credit);}}
                        foreach(var invoice in state.facturas)Execute(c,tx,"DELETE dbo.OrdPagosTSFac WHERE NroOrden=@p0 AND IDFactura=@p1",order["NroOrden"],invoice["IDRecibo"]);
                        Execute(c,tx,"UPDATE dbo.OrdPagosTP SET TotalCpras=ISNULL((SELECT SUM(Importe) FROM dbo.OrdPagosTSFac WHERE NroOrden=@p0),0) WHERE NroOrden=@p0",order["NroOrden"]);
                    }
                }
                foreach (var parent in state.padres) Execute(c, tx, "UPDATE dbo.ComprasTP SET IDRecImp=NULL,ImpDto=0 WHERE IDRecibo=@p0 AND IDRecImp=@p1", parent["IDRecibo"], parent["IDRecImp"]);
                foreach (var header in state.facturas)
                {
                    int receipt = Convert.ToInt32(header["IDRecibo"]);
                    Execute(c, tx, "INSERT dbo.WebComprasEliminadas(IDRecibo,Version,Usuario,IDOper,Datos) VALUES(@p0,@p1,@p2,@p3,@p4)", receipt, version, Text(Value(input, "usuarioId")), oper, archived);
                    Execute(c, tx, "UPDATE dbo.ComprasTP SET IDRecImp=NULL WHERE IDRecibo=@p0", receipt);
                    Execute(c, tx, "DELETE dbo.ComprasTS WHERE IDRecibo=@p0", receipt);
                    if (Execute(c, tx, "DELETE dbo.ComprasTP WHERE IDRecibo=@p0", receipt) != 1) throw new InvalidOperationException("No se pudo eliminar la compra completa.");
                }
                tx.Commit(); return new { ok = true, eliminado = id, movimientos = state.facturas.Count };
            }
            catch { try { tx.Rollback(); } catch { } throw; }
        }
    }
    private static object PurchaseQuery(SqlConnection c, HttpListenerRequest request)
    {
        string query = request.QueryString["consulta"] ?? "opciones";
        int provider = 0, id = 0, point = 0, before = 0;
        Int32.TryParse(request.QueryString["proveedor"], out provider); Int32.TryParse(request.QueryString["id"], out id);
        Int32.TryParse(request.QueryString["puntoVenta"], out point); Int32.TryParse(request.QueryString["antes"], out before);
        if (query == "previsualizar-eliminacion") return PurchaseRemovalPreview(c, null, RequiredId(id, "la compra"));
        if (query == "opciones") return new { ok = true,
            tipos = Rows(c, "SELECT IDComprob AS id,Abreviatura AS codigo,Descripcion AS nombre,Discrimina AS discrimina,EnLibroIVA AS libroIva,CAST(CASE WHEN UPPER(RTRIM(Abreviatura))='CRINP' THEN 0 ELSE NroAut END AS bit) AS automatico,IDTipoAcred AS acredita FROM dbo.TipoComprobantes WHERE EnCpras=1 ORDER BY Abreviatura"),
            proveedores = Rows(c, "SELECT IDProveedor AS id,[RazónSocial] AS nombre,CUIT AS cuit,CodCta AS cuenta,IDTipoBien AS tipoBien,Suspendido AS suspendido FROM dbo.Proveedores ORDER BY [RazónSocial]"),
            cuentas = Rows(c, "SELECT CodCuenta AS id,Cuenta AS nombre,IDEmp AS empresa FROM dbo.Cuentas ORDER BY Cuenta"),
            pagos = Rows(c, "SELECT IDTipoPago AS id,TipoPago AS nombre FROM dbo.TiposPagos WHERE EnCpras=1 ORDER BY TipoPago"),
            bienes = Rows(c, "SELECT IDTipoBien AS id,TipoBien AS nombre FROM dbo.TiposBienCpra ORDER BY TipoBien"),
            impuestos = Rows(c, "SELECT IDImpuesto AS id,Impuesto AS nombre,CONVERT(decimal(10,4),PorcImp) AS porcentaje,CodIVAAFIP AS codigoIva FROM dbo.Impuestos ORDER BY Impuesto"),
            puntosVenta = Rows(c, "SELECT IDDepósito AS id,[Descripción] AS nombre,IDSucAsoc AS sucursal,IDEmp AS empresa FROM dbo.[Depósitos] WHERE IDDepósito>1 ORDER BY IDDepósito") };
        if (query == "proveedor") return new { ok = true, proveedor = Rows(c, "SELECT p.IDProveedor,p.[RazónSocial] AS nombre,p.CUIT,p.[Dirección] AS direccion,p.Localidad,p.[Teléfono] AS telefono,p.Email,p.Web,p.Nota,p.SaldoIni,t.Descripcion AS condicionIva FROM dbo.Proveedores p LEFT JOIN dbo.TiposIVA t ON t.IDTipoIVA=p.IDTipoIVA WHERE p.IDProveedor=@p0", provider) };
        if (query == "movimientos") return new { ok = true, movimientos = PurchaseAvailableStock(c,null,provider,RequiredId(Scalar(c,null,"SELECT IDEmp FROM dbo.[Depósitos] WHERE IDDepósito=@p0",point),"la empresa"),0) };
        if (query == "detalle-stock")
        {
            var movements = PurchaseAvailableStock(c,null,provider,RequiredId(Scalar(c,null,"SELECT IDEmp FROM dbo.[Depósitos] WHERE IDDepósito=@p0",point),"la empresa"),RequiredId(id,"el movimiento"));
            if (movements.Count != 1) throw new InvalidOperationException("El movimiento ya no está disponible para este proveedor y sucursal.");
            return new { ok = true, articulos = Rows(c,"SELECT d.IDArt AS idart,a.IDArtProv AS codigo,a.[Descripción] AS descripcion,d.Cantidad AS cantidad,d.PrecioUni AS precioUnitario,d.Importe AS importe FROM dbo.RecibosTS d LEFT JOIN dbo.[Artículos] a ON a.IDArt=d.IDArt WHERE d.IDRecibo=@p0 ORDER BY d.IDOrden",id) };
        }
        if(query=="stock-factura") {
            int purchase=RequiredId(id,"la factura");
            var headers=Rows(c,"SELECT TOP 1 r.IDRecibo id,r.NroMov numero,r.IDSuc sucursal,r.IDTipoMov tipo,r.IDProveedor proveedor,r.IDDepósito puntoVenta,r.IDVend vendedor,r.IDOper operador,r.Anulado anulado,r.IDDepDes destino,r.IDFactura compra,r.IDRemito relacionado,r.NroFactura factura,r.NroRemito remito,CONVERT(varchar(10),r.Fecha,103) fecha,t.Descripcion nombre,(SELECT pr.[RazónSocial] FROM dbo.Proveedores pr WHERE pr.IDProveedor=r.IDProveedor) proveedorNombre,r.Total total,r.Nota nota FROM dbo.ComprasTP p JOIN dbo.RecibosTP r ON r.IDFactura=p.IDRecibo OR (r.IDTipoMov=23 AND r.NroMov=p.IDMovStk AND r.IDProveedor=p.IDProveedor AND r.IDSuc=ISNULL((SELECT d.IDSucAsoc FROM dbo.[Depósitos] d WHERE d.IDDepósito=p.IDDepósito),p.IDSuc)) LEFT JOIN dbo.TipoComprobantes t ON t.IDComprob=r.IDTipoMov LEFT JOIN dbo.Sucursales s ON s.IDSuc=r.IDSuc WHERE p.IDRecibo=@p0 AND p.Confirmado=1 AND r.Confirmado=1 AND r.Anulado=0 ORDER BY CASE WHEN r.IDFactura=p.IDRecibo THEN 0 ELSE 1 END,r.IDRecibo DESC",purchase);
            if(headers.Count!=1)throw new InvalidOperationException("La factura no tiene una carga de stock vigente vinculada.");
            return new {ok=true,movimiento=headers[0],articulos=Rows(c,"SELECT x.IDArt idart,a.IDArtProv codigo,a.[Descripción] descripcion,x.Cantidad cantidad,x.PrecioUni precio,x.PrecioUni precioUnitario,x.Importe importe,ISNULL(st.StockAct,0) stock FROM dbo.RecibosTS x LEFT JOIN dbo.[Artículos] a ON a.IDArt=x.IDArt LEFT JOIN dbo.ArtsStock st ON st.IDArt=x.IDArt AND st.IDSuc=@p1 WHERE x.IDRecibo=@p0 ORDER BY x.IDOrden",headers[0]["id"],headers[0]["sucursal"])};
        }
        if (query == "detalle") return PurchaseResult(c, null, RequiredId(id, "la factura"));
        if (query == "numero")
        {
            int type = RequiredId(request.QueryString["tipo"], "el tipo");
            string last = Text(Scalar(c, null, "SELECT MAX(NroFactura) FROM dbo.ComprasTP WHERE IDTipoComp=@p0", type));
            long serial = 0; string prefix = "0001";
            if (System.Text.RegularExpressions.Regex.IsMatch(last, @"^[0-9]{4}-[0-9]{8}$")) { prefix = last.Substring(0,4); Int64.TryParse(last.Substring(5), out serial); }
            return new { ok = true, numero = prefix + "-" + (serial+1).ToString("D8") };
        }
        DateTime from = PurchaseDate(request.QueryString["desde"] ?? DateTime.Today.AddDays(-90).ToString("yyyy-MM-dd"), "la fecha desde");
        DateTime to = PurchaseDate(request.QueryString["hasta"] ?? DateTime.Today.ToString("yyyy-MM-dd"), "la fecha hasta");
        if (from > to) throw new InvalidOperationException("El rango de fechas es inválido.");
        string filter = Text(request.QueryString["buscar"]).Trim();
        if (filter.Length > 100) throw new InvalidOperationException("La búsqueda es demasiado larga.");
        if (query == "cuenta-corriente")
        {
            if (provider == 0) return new { ok = true, saldos = Rows(c,
                "WITH pag AS(SELECT f.IDFactura,SUM(f.Importe) AS pagado FROM dbo.OrdPagosTSFac f JOIN dbo.OrdPagosTP o ON o.NroOrden=f.NroOrden WHERE o.Confirmado=1 AND o.Anulado=0 GROUP BY f.IDFactura),s AS(SELECT c.IDProveedor,SUM(c.Total-ISNULL(pag.pagado,0)) AS saldo,SUM(CASE WHEN c.FechaVto<CONVERT(date,GETDATE()) THEN c.Total-ISNULL(pag.pagado,0) ELSE 0 END) AS vencido FROM dbo.ComprasTP c LEFT JOIN pag ON pag.IDFactura=c.IDRecibo WHERE c.Confirmado=1 GROUP BY c.IDProveedor) SELECT p.IDProveedor AS id,p.[RazónSocial] AS proveedor,p.SaldoIni+ISNULL(s.saldo,0) AS saldo,ISNULL(s.vencido,0) AS vencido FROM dbo.Proveedores p LEFT JOIN s ON s.IDProveedor=p.IDProveedor WHERE ABS(p.SaldoIni+ISNULL(s.saldo,0))>.01 ORDER BY p.[RazónSocial]") };
            return new { ok = true, movimientos = Rows(c,
                "WITH m AS (SELECT p.Fecha,p.IDRecibo AS id,t.Abreviatura AS tipo,p.NroFactura AS numero,p.Total AS debe,CONVERT(money,0) AS haber,0 AS orden FROM dbo.ComprasTP p JOIN dbo.TipoComprobantes t ON t.IDComprob=p.IDTipoComp WHERE p.IDProveedor=@p0 AND p.Confirmado=1 UNION ALL SELECT o.Fecha,o.NroOrden,'OP',CONVERT(varchar(20),o.NroOP),0,ISNULL((SELECT SUM(Importe) FROM dbo.OrdPagosTSFac WHERE NroOrden=o.NroOrden),0),1 FROM dbo.OrdPagosTP o WHERE o.IDProveedor=@p0 AND o.Confirmado=1 AND o.Anulado=0),s AS (SELECT *,SUM(debe-haber) OVER(ORDER BY Fecha,id,orden ROWS UNBOUNDED PRECEDING)+(SELECT SaldoIni FROM dbo.Proveedores WHERE IDProveedor=@p0) AS saldo FROM m) SELECT CONVERT(varchar(10),Fecha,103) AS fecha,id,tipo,numero,debe,haber,saldo,orden FROM s WHERE Fecha>=@p1 AND Fecha<@p2 ORDER BY Fecha DESC,id DESC,orden DESC", provider, from, to.AddDays(1)) };
        }
        if (query == "iva") return new { ok = true, filas = Rows(c,
            "SELECT CONVERT(varchar(10),p.Fecha,103) AS fecha,CONVERT(varchar(7),p.FechaIVA,120) AS periodo,p.IDRecibo AS id,t.Abreviatura AS tipo,p.NroFactura AS numero,p.Proveedor AS proveedor,p.CUIT,p.Total AS total,SUM(CASE WHEN d.IDImpuesto=0 THEN d.Importe ELSE 0 END)*t.ImpPor AS neto,SUM(CASE WHEN NULLIF(i.CodIVAAFIP,'') IS NOT NULL THEN d.Importe ELSE 0 END)*t.ImpPor AS iva,SUM(CASE WHEN d.IDImpuesto NOT IN(0,1,8,10) THEN d.Importe ELSE 0 END)*t.ImpPor AS otros FROM dbo.ComprasTP p JOIN dbo.TipoComprobantes t ON t.IDComprob=p.IDTipoComp JOIN dbo.ComprasTS d ON d.IDRecibo=p.IDRecibo JOIN dbo.Impuestos i ON i.IDImpuesto=d.IDImpuesto WHERE p.Confirmado=1 AND t.EnLibroIVA=1 AND p.FechaIVA>=@p0 AND p.FechaIVA<@p1 AND (@p2=0 OR p.IDProveedor=@p2) GROUP BY p.Fecha,p.FechaIVA,p.IDRecibo,t.Abreviatura,t.ImpPor,p.NroFactura,p.Proveedor,p.CUIT,p.Total ORDER BY p.Fecha,p.IDRecibo", from, to.AddDays(1), provider) };
        if (query == "buscar")
        {
            var records = Rows(c, "DECLARE @cursorDate datetime=(SELECT Fecha FROM dbo.ComprasTP WHERE IDRecibo=@p1); SELECT TOP 201 p.IDRecibo AS id,CONVERT(varchar(10),p.Fecha,103) AS fecha,t.Abreviatura AS tipo,p.NroFactura AS numero,p.Proveedor AS proveedor,p.Total AS total,p.IDMovStk AS movimiento,p.EnMovStk AS enStock,p.IDProveedor AS idProveedor FROM dbo.ComprasTP p JOIN dbo.TipoComprobantes t ON t.IDComprob=p.IDTipoComp WHERE p.Confirmado=1 AND (@p0=0 OR p.IDProveedor=@p0) AND (@p1=0 OR p.Fecha<@cursorDate OR (p.Fecha=@cursorDate AND p.IDRecibo<@p1)) AND ((@p2='' AND p.Fecha>=@p3 AND p.Fecha<@p4) OR (@p2<>'' AND (p.NroFactura LIKE @p5 OR p.Proveedor LIKE @p5 OR CONVERT(varchar(20),p.IDRecibo)=@p2))) ORDER BY p.Fecha DESC,p.IDRecibo DESC", provider, before, filter, from, to.AddDays(1), "%" + filter + "%");
            bool more = records.Count > 200; if (more) records.RemoveAt(200);
            return new { ok = true, facturas = records, hayMas = more };
        }
        throw new InvalidOperationException("Consulta de compras desconocida.");
    }

    private static Guid RemitoPurchaseIdentity(SqlConnection c,int webId)
    {
        string webMarker="[WEBREMITO:"+webId+"]";
        long cancelled=Convert.ToInt64(Scalar(c,null,"SELECT ISNULL(MAX(IDRecibo),0) FROM dbo.RecibosTP WHERE CHARINDEX(@p0,CONVERT(nvarchar(max),Nota))>0 AND (Anulado<>0 OR Confirmado=0)",webMarker));
        long deleted=0;
        if(Number(Scalar(c,null,"SELECT CASE WHEN OBJECT_ID('dbo.WebComprasEliminadas','U') IS NULL THEN 0 ELSE 1 END"))==1)deleted=Convert.ToInt64(Scalar(c,null,"SELECT ISNULL(MAX(IDRecibo),0) FROM dbo.WebComprasEliminadas WHERE CHARINDEX(@p0,Datos)>0",webMarker));
        string cycle=cancelled>0||deleted>0?".recarga."+cancelled+"."+deleted:"";
        byte[] identity;
        using(var sha=SHA256.Create()) identity=sha.ComputeHash(Encoding.UTF8.GetBytes("Corralon.RemitoWeb."+webId+cycle));
        var guidBytes=new byte[16]; Array.Copy(identity,guidBytes,16);return new Guid(guidBytes);
    }
    private static object RemitoPurchaseConfirm(SqlConnection c, Dictionary<string, object> source, bool dryRun)
    {
        int webId = RequiredId(Value(source,"remitoId"),"el remito web");
        int provider = RequiredId(Value(source,"proveedor"),"el ID de proveedor seleccionado");
        int branch = RequiredId(Value(source,"sucursal"),"la sucursal del remito");
        int payment = RequiredId(Value(source,"pago"),"el pago");
        if (Rows(c,"SELECT IDTipoPago FROM dbo.TiposPagos WHERE IDTipoPago=@p0 AND EnCpras=1",payment).Count!=1) throw new InvalidOperationException("Elegí una forma de pago habilitada en Cargar facturas.");
        string number = Limited(Value(source,"numero"),15,"Número de remito");
        DateTime date = PurchaseDate(Value(source,"fecha"),"la fecha del remito");
        if (date > DateTime.Today) throw new InvalidOperationException("El remito no puede tener fecha futura.");
        AssertBackdatedInvoicePermission(source,date,DateTime.Today);
        var providers = Rows(c,"SELECT CodCta,IDTipoBien,CUIT FROM dbo.Proveedores WHERE IDProveedor=@p0 AND Suspendido=0",provider);
        if (providers.Count != 1) throw new InvalidOperationException("El ID de proveedor no existe o está suspendido en SQL.");
        var points = Rows(c,"SELECT TOP 1 IDDepósito FROM dbo.[Depósitos] WHERE IDSucAsoc=@p0 AND IDDepósito>1 ORDER BY IDDepósito",branch);
        if (points.Count != 1) throw new InvalidOperationException("La sucursal no tiene punto de compra en SQL.");
        string selectedAccount = source.ContainsKey("cuenta") ? Limited(Value(source,"cuenta"),15,"Cuenta") : Text(providers[0]["CodCta"]);
        var accounts = Rows(c,"SELECT Cuenta FROM dbo.Cuentas WHERE CodCuenta=@p0 AND IDEmp=(SELECT IDEmp FROM dbo.[Depósitos] WHERE IDDepósito=@p1)",selectedAccount,points[0]["IDDepósito"]);
        if(accounts.Count!=1) throw new InvalidOperationException("Seleccioná una cuenta válida para la sucursal del remito.");
        var types = Rows(c,"SELECT IDComprob FROM dbo.TipoComprobantes WHERE Abreviatura='TIKNF' AND EnCpras=1 AND EnLibroIVA=0 AND IDTipoAcred=1");
        if (types.Count != 1) throw new InvalidOperationException("Falta un tipo único de compra no fiscal TIKNF en SQL.");
        var rows = PurchaseArray(Value(source,"articulos"));
        if (rows.Count == 0 || rows.Count > 5000) throw new InvalidOperationException("El remito debe tener entre 1 y 5000 artículos con IDArt.");
        decimal total = 0;
        foreach (object raw in rows)
        {
            var item = Object(raw);
            decimal qty = Number(Value(item,"cantidad"));
            if (qty <= 0 || qty > 100000 || qty != Math.Round(qty,4) || Text(Value(item,"idart")).Trim().Length == 0) throw new InvalidOperationException("Cada renglón necesita IDArt y cantidad positiva, con hasta cuatro decimales.");
            // Legacy queued requests retain their purchase amount; stock never uses their price.
            if(!source.ContainsKey("totalRemito")) total += PurchaseMoney(qty * Number(Value(item,"precio")));
        }
        if(source.ContainsKey("totalRemito"))total=PurchaseMoney(Number(Value(source,"totalRemito")));
        if(total<=0 || total>1000000000m)throw new InvalidOperationException("El total del remito no es válido.");
        Guid identity=RemitoPurchaseIdentity(c,webId);
        var input = new Dictionary<string,object> {
            {"id",identity.ToString()}, {"usuarioId",Value(source,"usuarioId")},
            {"proveedor",provider}, {"tipo",types[0]["IDComprob"]}, {"puntoVenta",points[0]["IDDepósito"]},
            {"pago",payment}, {"tipoBien",providers[0]["IDTipoBien"]}, {"cuenta",selectedAccount}, {"cuit",providers[0]["CUIT"]},
            {"numero",number}, {"remito",number}, {"fecha",date.ToString("yyyy-MM-dd")}, {"periodo",date.ToString("yyyy-MM-01")},
            {"vencimiento",date.ToString("yyyy-MM-dd")}, {"concepto",accounts[0]["Cuenta"]}, {"nota","[WEBREMITO:"+webId+"]"},
            {"descuento",0}, {"movimiento",0}, {"enStock",true}, {"webRemito",source},
            {"impuestos",new object[]{new Dictionary<string,object>{{"impuesto",0},{"neto",1},{"importe",total},{"porcentaje",0},{"descripcion","Neto"}}}}
        };
        return PurchaseConfirm(c,input,dryRun);
    }

    private static void PurchaseCreateRemitoStock(SqlConnection c, SqlTransaction tx, Dictionary<string,object> source, int purchase, string invoiceNumber, int provider, int branch, int point, int company, int oper, DateTime date)
    {
        var type=RowsTx(c,tx,"SELECT IDComprob FROM dbo.TipoComprobantes WHERE IDComprob=23 AND EnStk=1 AND StkPor=1 AND ISNULL(GenNS,0)=0 AND ISNULL(ConReceta,0)=0");
        if(type.Count!=1) throw new InvalidOperationException("El tipo Compra de mercadería no está habilitado para ingresar stock.");
        var grouped=new Dictionary<string,Dictionary<string,object>>(StringComparer.OrdinalIgnoreCase);
        decimal total=0;
        foreach(object raw in PurchaseArray(Value(source,"articulos")))
        {
            var row=Object(raw); string id=Limited(Value(row,"idart"),30,"IDArt").Trim();
            var article=RowsTx(c,tx,"SELECT a.IDArt,a.UniMed,ISNULL(a.PrecioCpraSI,0) AS precioCosto,ISNULL(s.StockAct,0) AS stock FROM dbo.[Artículos] a LEFT JOIN dbo.ArtsStock s WITH(UPDLOCK,HOLDLOCK) ON s.IDArt=a.IDArt AND s.IDSuc=@p1 WHERE a.IDArt=@p0 AND a.Suspendido=0",id,branch);
            if(article.Count!=1) throw new InvalidOperationException("El artículo "+id+" no existe, está suspendido o tiene stock duplicado en SQL.");
            decimal qty=Number(Value(row,"cantidad")),price=Math.Round(Convert.ToDecimal(article[0]["precioCosto"]),4,MidpointRounding.AwayFromZero);
            if(qty<=0 || qty>100000 || qty!=Math.Round(qty,4) || price<0 || price>100000000)throw new InvalidOperationException("Cantidad o costo SQL fuera de rango para "+id);
            decimal amount=PurchaseMoney(qty*price); total+=amount;
            if(grouped.ContainsKey(id)) {
                var previous=grouped[id];
                if(Convert.ToDecimal(previous["precio"])!=price) throw new InvalidOperationException("El artículo "+id+" está repetido con precios diferentes.");
                previous["cantidad"]=Convert.ToDecimal(previous["cantidad"])+qty;
                if(Convert.ToDecimal(previous["cantidad"])>100000) throw new InvalidOperationException("Cantidad total fuera de rango para "+id);
                previous["importe"]=Convert.ToDecimal(previous["importe"])+amount;
            } else grouped[id]=new Dictionary<string,object>{{"cantidad",qty},{"precio",price},{"importe",amount},{"stock",article[0]["stock"]},{"unidad",article[0]["UniMed"]}};
        }
        int number=Convert.ToInt32(Scalar(c,tx,"SELECT ISNULL(MAX(NroMov),0)+1 FROM dbo.RecibosTP WITH(UPDLOCK,HOLDLOCK) WHERE IDTipoMov=23 AND IDSuc=@p0",branch));
        int receipt=Convert.ToInt32(Scalar(c,tx,"INSERT dbo.RecibosTP(IDTipoMov,NroMov,Fecha,IDDepósito,IDVend,IDOper,IDProveedor,IDSuc,IDEmp,NroFactura,NroRemito,IDFactura,Total,SubTSDto,Confirmado,Anulado,Nota,FechaYHora) OUTPUT INSERTED.IDRecibo VALUES(23,@p0,@p1,@p2,@p3,@p3,@p4,@p5,@p6,@p7,@p8,@p9,@p10,@p10,1,0,@p11,GETDATE())",number,date,point,oper,provider,branch,company,invoiceNumber,Value(source,"numero"),purchase,total,"[WEBREMITO:"+Text(Value(source,"remitoId"))+"]"));
        foreach(var pair in grouped) {
            var line=pair.Value;
            Execute(c,tx,"INSERT dbo.RecibosTS(IDRecibo,IDArt,Cantidad,PrecioUni,Importe,Stock,UniMed) VALUES(@p0,@p1,@p2,@p3,@p4,@p5,@p6)",receipt,pair.Key,line["cantidad"],line["precio"],line["importe"],line["stock"],line["unidad"]??DBNull.Value);
            Execute(c,tx,"IF NOT EXISTS(SELECT 1 FROM dbo.ArtsStock WHERE IDArt=@p0 AND IDSuc=@p1) INSERT dbo.ArtsStock(IDArt,IDSuc,StockAct) VALUES(@p0,@p1,0)",pair.Key,branch);
            if(Execute(c,tx,"UPDATE dbo.ArtsStock SET StockAct=ISNULL(StockAct,0)+@p0 WHERE IDArt=@p1 AND IDSuc=@p2",line["cantidad"],pair.Key,branch)!=1) throw new InvalidOperationException("Stock no único para "+pair.Key);
        }
        Execute(c,tx,"UPDATE dbo.TipoComprobantes SET UltNroComp=@p0 WHERE IDComprob=23",number);
        if(Execute(c,tx,"UPDATE dbo.ComprasTP SET IDMovStk=@p0 WHERE IDRecibo=@p1 AND IDMovStk IS NULL",number,purchase)!=1) throw new InvalidOperationException("La compra ya tiene stock vinculado.");
    }

    private static object PurchaseConfirm(SqlConnection c, Dictionary<string, object> input, bool dryRun)
    {
        Guid draft;
        if (!Guid.TryParse(Text(Value(input, "id")), out draft)) throw new InvalidOperationException("El borrador no tiene un identificador válido.");
        int provider = RequiredId(Value(input, "proveedor"), "el proveedor");
        int typeId = RequiredId(Value(input, "tipo"), "el tipo de comprobante");
        int point = RequiredId(Value(input, "puntoVenta"), "la sucursal/punto de venta");
        int payment = RequiredId(Value(input, "pago"), "el medio de pago");
        int goods = RequiredId(Value(input, "tipoBien"), "el tipo de bien");
        int movementId = 0; Int32.TryParse(Text(Value(input, "movimiento")), out movementId);
        bool inStock = Value(input, "enStock") != null && Convert.ToBoolean(Value(input, "enStock"));
        if (movementId < 0 || (!inStock && movementId > 0)) throw new InvalidOperationException("El movimiento de stock requiere activar En movimientos de stock.");
        string number = Limited(Value(input, "numero"), 15, "Número de comprobante").Trim();
        string account = Limited(Value(input, "cuenta"), 15, "Cuenta");
        string concept = Limited(Value(input, "concepto"), 100, "Concepto");
        string cuit = Limited(Value(input, "cuit"), 13, "CUIT");
        string remito = Limited(Value(input, "remito"), 15, "Remito");
        string note = Limited(Value(input, "nota"), 4000, "Nota");
        DateTime date = PurchaseDate(Value(input, "fecha"), "la fecha de compra");
        DateTime period = PurchaseDate(Value(input, "periodo"), "el período de IVA");
        DateTime due = PurchaseDate(Value(input, "vencimiento"), "el vencimiento");
        if (date.Month != period.Month || date.Year != period.Year) throw new InvalidOperationException("El período de IVA debe corresponder al mes y año de la compra.");
        if (due < date) throw new InvalidOperationException("El vencimiento no puede ser anterior a la compra.");
        decimal discount = Number(Value(input, "descuento"));
        if (discount < 0 || discount >= 1) throw new InvalidOperationException("El descuento debe ser mayor o igual a cero y menor al 100%.");
        string marker = "[WEBFACTURA:" + draft.ToString("N") + "]";
        var fingerprintInput = new Dictionary<string, object>(input); fingerprintInput.Remove("accion"); fingerprintInput.Remove("pruebaTransaccion");
        if(Value(input,"webRemito")!=null) {
            fingerprintInput.Remove("usuarioId");
            var sourceFingerprint=new Dictionary<string,object>(Object(Value(input,"webRemito")));
            sourceFingerprint.Remove("usuarioId"); sourceFingerprint.Remove("idOperador");
            fingerprintInput["webRemito"]=sourceFingerprint;
        }
        string hash;
        using (var sha = SHA256.Create()) hash = BitConverter.ToString(sha.ComputeHash(Encoding.UTF8.GetBytes(Json.Serialize(fingerprintInput)))).Replace("-", "");
        string hashMarker = "[HASH:" + hash + "]";
        var items = PurchaseArray(Value(input, "impuestos"));
        if (items.Count < 1 || items.Count > 200) throw new InvalidOperationException("Cargá entre 1 y 200 renglones de impuestos.");
        int operatorId = UserOperator(c, Text(Value(input, "usuarioId")));
        using (var tx = c.BeginTransaction(IsolationLevel.Serializable))
        {
            try
            {
                if(Value(input,"webRemito")!=null && Number(Scalar(c,tx,"DECLARE @r int; EXEC @r=sp_getapplock @Resource=@p0,@LockMode='Exclusive',@LockOwner='Transaction',@LockTimeout=10000; SELECT @r","CorralonWeb.Remito."+Text(Value(Object(Value(input,"webRemito")),"remitoId"))))<0) throw new InvalidOperationException("Este remito se está cargando desde otra PC. Reintentá.");
                var already = RowsTx(c, tx, "SELECT IDRecibo,CONVERT(nvarchar(max),Nota) AS nota FROM dbo.ComprasTP WITH(UPDLOCK,HOLDLOCK) WHERE Confirmado=1 AND CHARINDEX(@p0,CONVERT(nvarchar(max),Nota))>0", marker);
                if (Number(Scalar(c, tx, "SELECT CASE WHEN OBJECT_ID('dbo.WebComprasEliminadas','U') IS NULL THEN 0 ELSE 1 END")) == 1 && Number(Scalar(c, tx, "SELECT COUNT(*) FROM dbo.WebComprasEliminadas WHERE CHARINDEX(@p0,Datos)>0", marker)) > 0)
                    throw new InvalidOperationException("Esta compra fue eliminada. El borrador anterior no puede volver a confirmarse.");
                if(Value(input,"webRemito")!=null&&already.Count==0){
                    var state=StockWebSourceState(c,"remito",Text(Value(Object(Value(input,"webRemito")),"remitoId")),tx);
                    if(Convert.ToBoolean(state["vigente"]))throw new InvalidOperationException(Text(state["mensaje"]));
                }
                if (already.Count > 0)
                {
                    if (already.Count != 1 || !Text(already[0]["nota"]).Contains(hashMarker)) throw new InvalidOperationException("Ese borrador ya fue confirmado con otros datos. Consultá la factura antes de volver a cargarla.");
                    var previous = PurchaseResult(c, tx, Convert.ToInt32(already[0]["IDRecibo"])); tx.Rollback(); return previous;
                }
                var providers = RowsTx(c, tx, "SELECT [RazónSocial] AS nombre,Suspendido FROM dbo.Proveedores WHERE IDProveedor=@p0", provider);
                if (providers.Count != 1 || Convert.ToBoolean(providers[0]["Suspendido"])) throw new InvalidOperationException("Proveedor inexistente o suspendido.");
                var types = RowsTx(c, tx, "SELECT Discrimina,EnLibroIVA,NroAut,IDTipoAcred,Abreviatura FROM dbo.TipoComprobantes WHERE IDComprob=@p0 AND EnCpras=1", typeId);
                if (types.Count != 1) throw new InvalidOperationException("Tipo de comprobante no habilitado para compras.");
                var points = RowsTx(c, tx, "SELECT IDEmp,IDSucAsoc FROM dbo.[Depósitos] WHERE IDDepósito=@p0 AND IDDepósito>1", point);
                if (points.Count != 1) throw new InvalidOperationException("Punto de venta inexistente.");
                int company = Convert.ToInt32(points[0]["IDEmp"]), branch = Convert.ToInt32(points[0]["IDSucAsoc"]);
                if (RowsTx(c, tx, "SELECT IDTipoPago FROM dbo.TiposPagos WHERE IDTipoPago=@p0 AND EnCpras=1", payment).Count != 1)
                    throw new InvalidOperationException("La forma de pago no está habilitada para compras.");
                if (RowsTx(c, tx, "SELECT IDTipoBien FROM dbo.TiposBienCpra WHERE IDTipoBien=@p0", goods).Count != 1)
                    throw new InvalidOperationException("El tipo de bien no existe en SQL.");
                if (RowsTx(c, tx, "SELECT CodCuenta FROM dbo.Cuentas WHERE CodCuenta=@p0 AND IDEmp=@p1", account, company).Count != 1)
                    throw new InvalidOperationException("La cuenta seleccionada no existe en la empresa de esta sucursal.");
                bool automatic = Convert.ToBoolean(types[0]["NroAut"]) && !Text(types[0]["Abreviatura"]).Trim().Equals("CRINP", StringComparison.OrdinalIgnoreCase);
                if (automatic)
                {
                    string last = Text(Scalar(c, tx, "SELECT MAX(NroFactura) FROM dbo.ComprasTP WITH(UPDLOCK,HOLDLOCK) WHERE IDTipoComp=@p0", typeId));
                    long previousNumber = 0; string prefix = "0001";
                    if (System.Text.RegularExpressions.Regex.IsMatch(last, @"^[0-9]{4}-[0-9]{8}$")) { prefix = last.Substring(0, 4); Int64.TryParse(last.Substring(5), out previousNumber); }
                    if (previousNumber >= 99999999) throw new InvalidOperationException("Se agotó la numeración del comprobante.");
                    number = prefix + "-" + (previousNumber + 1).ToString("D8");
                }
                if (!System.Text.RegularExpressions.Regex.IsMatch(number, @"^[0-9]{4}-[0-9]{8}$") || number.StartsWith("0000-")) throw new InvalidOperationException("Ingresá un número válido 0000-00000000, con punto de venta distinto de cero.");
                if (Convert.ToInt32(Scalar(c, tx, "SELECT COUNT(*) FROM dbo.ComprasTP WITH(UPDLOCK,HOLDLOCK) WHERE IDProveedor=@p0 AND IDTipoComp=@p1 AND NroFactura=@p2 AND Confirmado=1", provider, typeId, number)) > 0)
                    throw new InvalidOperationException("Ese comprobante del proveedor ya está cargado.");
                bool discriminates = Convert.ToBoolean(types[0]["Discrimina"]), book = Convert.ToBoolean(types[0]["EnLibroIVA"]);
                if (discriminates && book && !PurchaseCuitValid(cuit)) throw new InvalidOperationException("Falta CUIT o CUIT no válido.");
                int sign = Convert.ToInt32(types[0]["IDTipoAcred"]) == 2 ? -1 : 1;
                decimal total = 0; var lines = new List<Dictionary<string, object>>();
                var nets = new Dictionary<int, decimal>(); var vats = new Dictionary<int, decimal>();
                foreach (object raw in items)
                {
                    var row = Object(raw); int tax = Convert.ToInt32(Value(row, "impuesto")); int net = RequiredId(Value(row, "neto"), "el número de neto");
                    if (net > 32767) throw new InvalidOperationException("Número de neto demasiado grande.");
                    var taxes = RowsTx(c, tx, "SELECT Impuesto,PorcImp,CodIVAAFIP FROM dbo.Impuestos WHERE IDImpuesto=@p0", tax);
                    if (taxes.Count != 1) throw new InvalidOperationException("Impuesto inexistente.");
                    decimal amount = PurchaseMoney(Value(row, "importe")); decimal rate = Number(Value(row, "porcentaje"));
                    if (amount < 0 || rate < 0 || rate > 1) throw new InvalidOperationException("Los importes y porcentajes deben ser positivos; el tipo de comprobante determina el signo.");
                    string description = Limited(Value(row, "descripcion"), 50, "Descripción de impuesto");
                    if (description.Length == 0) description = Text(taxes[0]["Impuesto"]);
                    if (tax == 0) nets[net] = (nets.ContainsKey(net) ? nets[net] : 0) + amount;
                    if (Text(taxes[0]["CodIVAAFIP"]).Length > 0) vats[net] = (vats.ContainsKey(net) ? vats[net] : 0) + amount;
                    lines.Add(new Dictionary<string, object> { { "tax", tax }, { "net", net }, { "amount", amount }, { "rate", rate }, { "description", description.ToUpperInvariant() } });
                    total += amount;
                }
                if (total <= 0 || total > 999999999999m) throw new InvalidOperationException("Faltan importes o el total supera el permitido.");
                if (discriminates && book && !(lines.Count == 1 && Convert.ToInt32(lines[0]["tax"]) == 12))
                {
                    if (nets.Count == 0 || nets.Count != vats.Count) throw new InvalidOperationException("No coincide la cantidad de netos con los IVA cargados.");
                    foreach (int key in nets.Keys) if (!vats.ContainsKey(key)) throw new InvalidOperationException("Falta el IVA correspondiente al neto " + key + ".");
                }
                Dictionary<string, object> stock = null;
                if (movementId > 0)
                {
                    var movements = PurchaseAvailableStock(c,tx,provider,company,movementId);
                    if (movements.Count != 1 || movements[0]["IDFactura"] != null || Text(movements[0]["NroFactura"]).Length > 0) throw new InvalidOperationException("El movimiento ya está vinculado o no corresponde al proveedor/sucursal.");
                    stock = movements[0];
                }
                decimal signed = total * sign;
                int receipt = Convert.ToInt32(Scalar(c, tx,
                    "INSERT dbo.ComprasTP(IDTipoComp,IDDepósito,Fecha,FechaIVA,IDProveedor,Proveedor,Concepto,CUIT,IDFormaPago,NroFactura,CodCuentaCpra,Nota,Confirmado,Total,SaldoFac,FechaVto,IDSuc,IDOper,IDEmp,IDTipoBien,NroRemMerc,EnMovStk,IDMovStk,ImpDto) OUTPUT INSERTED.IDRecibo VALUES(@p0,@p1,@p2,@p3,@p4,@p5,@p6,@p7,@p8,@p9,@p10,@p11,1,@p12,@p12,@p13,@p14,@p15,@p16,@p17,@p18,@p19,@p20,@p21)",
                    typeId, point, date, new DateTime(period.Year, period.Month, 1), provider, providers[0]["nombre"], concept, cuit, payment, number, account,
                    marker + hashMarker + " [USUARIO:" + Text(Value(input, "usuarioId")) + "] " + note, signed, due, branch, operatorId, company, goods,
                    remito.Length == 0 ? (object)DBNull.Value : remito, inStock, stock == null ? (object)DBNull.Value : stock["NroMov"], discount));
                foreach (var line in lines) Execute(c, tx, "INSERT dbo.ComprasTS(IDRecibo,IDImpuesto,[Descripción],Importe,PorcImp,NroNeto) VALUES(@p0,@p1,@p2,@p3,@p4,@p5)", receipt, line["tax"], line["description"], line["amount"], line["rate"], line["net"]);
                if(Value(input,"webRemito")!=null) PurchaseCreateRemitoStock(c,tx,Object(Value(input,"webRemito")),receipt,number,provider,branch,point,company,operatorId,date);
                if (stock != null && Execute(c, tx, "UPDATE dbo.RecibosTP SET NroFactura=@p0,IDFactura=@p1 WHERE IDRecibo=@p2 AND IDFactura IS NULL AND ISNULL(NroFactura,'')=''", number, receipt, movementId) != 1)
                    throw new InvalidOperationException("Otra PC vinculó ese movimiento. Recargá antes de confirmar.");
                if (payment != 3 && sign == 1)
                {
                    decimal cashAmount = signed - PurchaseMoney(signed * discount);
                    int opNumber = Convert.ToInt32(Scalar(c, tx, "SELECT ISNULL(MAX(NroOP),0)+1 FROM dbo.OrdPagosTP WITH(UPDLOCK,HOLDLOCK)"));
                    int order = Convert.ToInt32(Scalar(c, tx, "INSERT dbo.OrdPagosTP(NroOP,Fecha,IDProveedor,Confirmado,IDDepósito,TotalCpras,TotalPagos,IDOper,IDEmp,Nota) OUTPUT INSERTED.NroOrden VALUES(@p0,@p1,@p2,1,@p3,@p4,@p4,@p5,@p6,@p7)", opNumber, date, provider, point, cashAmount, operatorId, company, "Pago de factura " + number));
                    Execute(c, tx, "INSERT dbo.OrdPagosTSFac(NroOrden,IDFactura,Importe) VALUES(@p0,@p1,@p2)", order, receipt, cashAmount);
                    // Access une los valores con Bancos incluso para efectivo: 0 es sin banco.
                    Execute(c, tx, "INSERT dbo.OrdPagosTSPag(NroOrden,IDTipoPago,Importe,FechaVto,IDBanco,IDMovBco) VALUES(@p0,@p1,@p2,@p3,0,NULL)", order, payment, cashAmount, DateTime.Today);
                }
                if (discount > 0) PurchaseCreateDiscount(c,tx,receipt,discount,operatorId);
                var result = PurchaseResult(c, tx, receipt);
                if (dryRun) tx.Rollback(); else tx.Commit();
                return result;
            }
            catch { try { tx.Rollback(); } catch { } throw; }
        }
    }

    private static void StockClearPurchaseLinks(SqlConnection connection, SqlTransaction tx, int receipt)
    {
        Execute(connection, tx, "UPDATE C SET C.IDMovStk=NULL FROM dbo.ComprasTP C INNER JOIN dbo.RecibosTP R ON C.IDMovStk=R.NroMov AND C.IDProveedor=R.IDProveedor AND C.IDEmp=R.IDEmp LEFT JOIN dbo.[Depósitos] D ON D.IDDepósito=C.IDDepósito AND D.IDEmp=C.IDEmp WHERE R.IDRecibo=@p0 AND R.IDTipoMov=23 AND ISNULL(D.IDSucAsoc,C.IDSuc)=R.IDSuc AND (R.IDFactura=C.IDRecibo OR (R.IDFactura IS NULL AND (R.NroFactura IS NULL OR R.NroFactura=C.NroFactura)))", receipt);
        Execute(connection, tx, "UPDATE dbo.RecibosTP SET NroFactura=NULL,IDFactura=NULL WHERE IDRecibo=@p0", receipt);
    }

    // Copy every stored field, including legacy Access fields, except generated columns.
    private static string StockCopyColumns(SqlConnection connection, SqlTransaction tx, string table, string excluded)
    {
        var columns = RowsTx(connection, tx, "SELECT QUOTENAME(name) AS nombre FROM sys.columns WHERE object_id=OBJECT_ID(@p0) AND is_identity=0 AND is_computed=0 AND system_type_id<>189 AND name<>@p1 ORDER BY column_id", "dbo." + table, excluded);
        if (columns.Count == 0) throw new InvalidOperationException("No se pudo verificar la estructura del movimiento.");
        return String.Join(",", columns.ConvertAll(row => Text(row["nombre"])).ToArray());
    }

    private static object StockCambiarSucursal(SqlConnection connection, Dictionary<string, object> input)
    {
        AssertPurchasePermission(Text(Value(input, "usuarioId")), "carga_stock");
        int receipt = RequiredId(Value(input, "recibo"), "el movimiento");
        int branch = RequiredId(Value(input, "sucursal"), "la sucursal original");
        int destination = RequiredId(Value(input, "destino"), "la nueva sucursal");
        if (branch == destination) throw new InvalidOperationException("Elegí otra sucursal.");
        string marker = "[WEBSTOCKMOVE:" + receipt + ":" + destination + "]";
        using (var tx = connection.BeginTransaction(IsolationLevel.Serializable))
        {
            try
            {
                if (Convert.ToInt32(Scalar(connection, tx, "DECLARE @r int; EXEC @r=sp_getapplock @Resource=@p0,@LockMode='Exclusive',@LockOwner='Transaction',@LockTimeout=10000; SELECT @r", "CorralonWeb.StockMove." + receipt)) < 0)
                    throw new InvalidOperationException("El movimiento está siendo corregido. Reintentá.");
                var saved = RowsTx(connection, tx, "SELECT IDRecibo,NroMov FROM dbo.RecibosTP WITH(UPDLOCK,HOLDLOCK) WHERE IDSuc=@p0 AND Confirmado=1 AND Anulado=0 AND CHARINDEX(@p1,CONVERT(nvarchar(max),Nota))>0", destination, marker);
                if (saved.Count == 1) { tx.Commit(); return new { ok = true, idRecibo = saved[0]["IDRecibo"], numeroMovimiento = saved[0]["NroMov"], yaCambiado = true }; }
                var records = RowsTx(connection, tx, "SELECT R.*,T.StkPor,T.IDTipoMovStock,T.GenNS,T.ConReceta FROM dbo.RecibosTP R WITH(UPDLOCK,HOLDLOCK) JOIN dbo.TipoComprobantes T ON T.IDComprob=R.IDTipoMov WHERE R.IDRecibo=@p0 AND R.IDSuc=@p1 AND R.Confirmado=1 AND R.Anulado=0", receipt, branch);
                if (records.Count != 1) throw new InvalidOperationException("El movimiento cambió o ya no está disponible en la sucursal original. Volvé a consultarlo.");
                var header = records[0]; int type = Convert.ToInt32(header["IDTipoMov"]);
                if (type == 57 || type == 58 || type == 38 || (Text(header["IDRecDes"]).Length > 0 && Number(header["IDRecDes"]) != 0) || (Text(header["IDRemito"]).Length > 0 && Number(header["IDRemito"]) != 0) || (Text(header["GenNS"]).Length > 0 && Convert.ToBoolean(header["GenNS"])) || (Text(header["ConReceta"]).Length > 0 && Convert.ToBoolean(header["ConReceta"])) ||
                    Convert.ToInt32(Scalar(connection, tx, "SELECT COUNT(*) FROM dbo.RecibosTP WITH(UPDLOCK,HOLDLOCK) WHERE IDRecDes=@p0 OR IDRemito=@p0", receipt)) > 0)
                    throw new InvalidOperationException("Este movimiento tiene transferencias, series o comprobantes relacionados. No se puede cambiar su sucursal desde aquí.");
                var points = RowsTx(connection, tx, "SELECT TOP 1 D.IDDepósito FROM dbo.[Depósitos] D JOIN dbo.Sucursales S ON S.IDSuc=D.IDSucAsoc WHERE S.IDSuc=@p0 AND D.IDEmp=@p1 ORDER BY D.IDDepósito", destination, header["IDEmp"]);
                if (points.Count != 1) throw new InvalidOperationException("La sucursal elegida necesita un punto de venta de la misma empresa.");
                var lines = RowsTx(connection, tx, "SELECT IDArt,SUM(Cantidad) AS cantidad FROM dbo.RecibosTS WITH(UPDLOCK,HOLDLOCK) WHERE IDRecibo=@p0 GROUP BY IDArt ORDER BY IDArt", receipt);
                if (lines.Count == 0) throw new InvalidOperationException("El movimiento no tiene artículos.");
                if (type == 23 && Text(header["IDFactura"]).Length > 0 && Number(header["IDFactura"]) > 0 &&
                    RowsTx(connection, tx, "SELECT IDRecibo FROM dbo.ComprasTP WITH(UPDLOCK,HOLDLOCK) WHERE IDRecibo=@p0 AND IDMovStk=@p1", header["IDFactura"], header["NroMov"]).Count != 1)
                    throw new InvalidOperationException("La vinculación con la factura cambió. Revisala antes de corregir la sucursal.");
                decimal sign = Number(header["IDTipoMovStock"]) > 0 ? Number(header["StkPor"]) : 0;
                if (sign != -1 && sign != 0 && sign != 1) throw new InvalidOperationException("Este tipo de movimiento tiene un comportamiento de stock especial.");
                int number = Convert.ToInt32(Scalar(connection, tx, "SELECT ISNULL(MAX(NroMov),0)+1 FROM dbo.RecibosTP WITH(UPDLOCK,HOLDLOCK) WHERE IDTipoMov=@p0 AND IDSuc=@p1", type, destination));
                string headerColumns = StockCopyColumns(connection, tx, "RecibosTP", "IDRecibo");
                string headerValues = headerColumns.Replace("[IDSuc]", "@p1").Replace("[IDDepósito]", "@p2").Replace("[NroMov]", "@p3").Replace("[Nota]", "CONVERT(nvarchar(max),ISNULL([Nota],''))+@p4");
                // The unique (type, number, branch) key must already be new at INSERT time.
                int replacement = Convert.ToInt32(Scalar(connection, tx, "INSERT dbo.RecibosTP(" + headerColumns + ") OUTPUT INSERTED.IDRecibo SELECT " + headerValues + " FROM dbo.RecibosTP WHERE IDRecibo=@p0", receipt, destination, points[0]["IDDepósito"], number, marker));
                string detailColumns = StockCopyColumns(connection, tx, "RecibosTS", "IDRecibo");
                Execute(connection, tx, "INSERT dbo.RecibosTS(IDRecibo," + detailColumns + ") SELECT @p0," + detailColumns + " FROM dbo.RecibosTS WHERE IDRecibo=@p1", replacement, receipt);
                foreach (var line in lines)
                {
                    string id = Text(line["IDArt"]); decimal delta = Number(line["cantidad"]) * sign;
                    if (sign == 0) continue;
                    if (RowsTx(connection, tx, "SELECT IDArt FROM dbo.ArtsStock WITH(UPDLOCK,HOLDLOCK) WHERE IDArt=@p0 AND IDSuc=@p1", id, branch).Count != 1)
                        throw new InvalidOperationException("Falta el stock original del artículo " + id + ". No se modificó el movimiento.");
                    Execute(connection, tx, "IF NOT EXISTS(SELECT 1 FROM dbo.ArtsStock WITH(UPDLOCK,HOLDLOCK) WHERE IDArt=@p0 AND IDSuc=@p1) INSERT dbo.ArtsStock(IDArt,IDSuc,StockAct) VALUES(@p0,@p1,0)", id, destination);
                    decimal before = StockNumber(Scalar(connection, tx, "SELECT StockAct FROM dbo.ArtsStock WITH(UPDLOCK,HOLDLOCK) WHERE IDArt=@p0 AND IDSuc=@p1", id, destination));
                    Execute(connection, tx, "UPDATE dbo.RecibosTS SET Stock=@p0 WHERE IDRecibo=@p1 AND IDArt=@p2", before, replacement, id);
                    if (Execute(connection, tx, "UPDATE dbo.ArtsStock SET StockAct=ISNULL(StockAct,0)-@p0 WHERE IDArt=@p1 AND IDSuc=@p2", delta, id, branch) != 1 ||
                        Execute(connection, tx, "UPDATE dbo.ArtsStock SET StockAct=ISNULL(StockAct,0)+@p0 WHERE IDArt=@p1 AND IDSuc=@p2", delta, id, destination) != 1)
                        throw new InvalidOperationException("El stock del artículo " + id + " no es único.");
                }
                Execute(connection, tx, "UPDATE C SET IDMovStk=@p0 FROM dbo.ComprasTP C JOIN dbo.RecibosTP R ON R.IDFactura=C.IDRecibo WHERE R.IDRecibo=@p1 AND R.IDTipoMov=23 AND C.IDMovStk=R.NroMov", number, receipt);
                Execute(connection, tx, "UPDATE dbo.TipoComprobantes SET UltNroComp=@p0 WHERE IDComprob=@p1", number, type);
                Execute(connection, tx, "DELETE dbo.RecibosTS WHERE IDRecibo=@p0", receipt);
                if (Execute(connection, tx, "DELETE dbo.RecibosTP WHERE IDRecibo=@p0 AND IDSuc=@p1", receipt, branch) != 1) throw new InvalidOperationException("No se pudo eliminar el movimiento original.");
                tx.Commit();
                return new { ok = true, idRecibo = replacement, numeroMovimiento = number, yaCambiado = false };
            }
            catch { try { tx.Rollback(); } catch { } throw; }
        }
    }

    private static object StockVincularCompra(SqlConnection connection, Dictionary<string, object> input)
    {
        AssertPurchasePermission(Text(Value(input,"usuarioId")),"carga_stock");
        int receipt=RequiredId(Value(input,"recibo"),"el movimiento"),branch=RequiredId(Value(input,"sucursal"),"la sucursal"),purchase=RequiredId(Value(input,"compra"),"la factura");
        using(var tx=connection.BeginTransaction(IsolationLevel.Serializable))
        {
            try
            {
                var movements=RowsTx(connection,tx,"SELECT IDFactura,IDProveedor,IDEmp,NroMov FROM dbo.RecibosTP WITH(UPDLOCK,HOLDLOCK) WHERE IDRecibo=@p0 AND IDSuc=@p1 AND IDTipoMov=23 AND Confirmado=1 AND Anulado=0",receipt,branch);
                if(movements.Count!=1)throw new InvalidOperationException("La carga de stock ya no está disponible.");
                var movement=movements[0];
                var purchases=RowsTx(connection,tx,"SELECT C.IDMovStk,C.NroFactura FROM dbo.ComprasTP C WITH(UPDLOCK,HOLDLOCK) JOIN dbo.TipoComprobantes T ON T.IDComprob=C.IDTipoComp WHERE C.IDRecibo=@p0 AND C.IDProveedor=@p1 AND C.IDEmp=@p2 AND C.Confirmado=1 AND T.ImpPor>0",purchase,movement["IDProveedor"],movement["IDEmp"]);
                if(purchases.Count!=1)throw new InvalidOperationException("La factura no corresponde al proveedor y empresa de esta carga.");
                var invoice=purchases[0];
                if(Text(movement["IDFactura"]).Length>0 && Number(movement["IDFactura"])>0 && Number(movement["IDFactura"])!=purchase)throw new InvalidOperationException("El movimiento ya tiene otra factura vinculada. Volvé a consultarlo.");
                if(Text(invoice["IDMovStk"]).Length>0 && Number(invoice["IDMovStk"])>0 && (Text(movement["IDFactura"]).Length==0 || Number(movement["IDFactura"])!=purchase || Number(invoice["IDMovStk"])!=Number(movement["NroMov"])))throw new InvalidOperationException("La factura ya tiene otra carga de stock vinculada.");
                if(Convert.ToInt32(Scalar(connection,tx,"SELECT COUNT(*) FROM dbo.RecibosTP WITH(UPDLOCK,HOLDLOCK) WHERE IDFactura=@p0 AND IDRecibo<>@p1 AND Confirmado=1 AND Anulado=0",purchase,receipt))>0)throw new InvalidOperationException("La factura fue vinculada desde otro equipo.");
                Execute(connection,tx,"UPDATE dbo.ComprasTP SET IDMovStk=@p0,EnMovStk=1 WHERE IDRecibo=@p1",movement["NroMov"],purchase);
                Execute(connection,tx,"UPDATE dbo.RecibosTP SET IDFactura=@p0,NroFactura=@p1 WHERE IDRecibo=@p2",purchase,invoice["NroFactura"],receipt);
                tx.Commit();return new {ok=true,numeroFactura=invoice["NroFactura"],numeroMovimiento=movement["NroMov"]};
            }
            catch{try{tx.Rollback();}catch{}throw;}
        }
    }

    private static object StockAnular(SqlConnection connection, Dictionary<string, object> input)
    {
        UserOperator(connection, Text(Value(input, "usuarioId")));
        int receipt = RequiredId(Value(input, "recibo"), "el movimiento");
        int branch = RequiredId(Value(input, "sucursal"), "la sucursal");
        using (var tx = connection.BeginTransaction(IsolationLevel.Serializable))
        {
            try
            {
                var records = RowsTx(connection, tx, "SELECT IDRecibo,IDSuc,IDTipoMov,IDRecDes,Confirmado,Anulado FROM dbo.RecibosTP WITH (UPDLOCK,HOLDLOCK) WHERE IDRecibo=@p0 AND IDSuc=@p1", receipt, branch);
                if (records.Count != 1) throw new InvalidOperationException("No se encontró el movimiento en esa sucursal.");
                var header = records[0];
                int type = Convert.ToInt32(header["IDTipoMov"]);
                if (Convert.ToBoolean(header["Anulado"])) { StockClearPurchaseLinks(connection, tx, receipt); tx.Commit(); return new { ok = true, yaAnulado = true }; }
                if (!Convert.ToBoolean(header["Confirmado"])) throw new InvalidOperationException("El movimiento no está confirmado.");
                if (type == 58) throw new InvalidOperationException("Este es el movimiento interno de entrada. Anulá la transferencia desde el comprobante de salida relacionado.");
                if (type == 57)
                {
                    int related = header["IDRecDes"] == null || header["IDRecDes"] == DBNull.Value ? 0 : Convert.ToInt32(header["IDRecDes"]);
                    var entries = RowsTx(connection, tx, "SELECT IDSuc,IDTipoMov,IDRecDes,Anulado FROM dbo.RecibosTP WITH (UPDLOCK,HOLDLOCK) WHERE IDRecibo=@p0", related);
                    if (entries.Count != 1 || Convert.ToInt32(entries[0]["IDSuc"]) <= 0) throw new InvalidOperationException("No se encontró el movimiento de entrada o su sucursal de destino.");
                    if (Convert.ToInt32(entries[0]["IDTipoMov"]) != 58 || Number(entries[0]["IDRecDes"]) != receipt) throw new InvalidOperationException("La entrada no corresponde a esta transferencia.");
                    if (Convert.ToBoolean(entries[0]["Anulado"])) throw new InvalidOperationException("El movimiento relacionado ya se encuentra anulado.");
                    Execute(connection, tx, "UPDATE A SET A.StockAct=ISNULL(A.StockAct,0)+D.Cantidad FROM dbo.ArtsStock A INNER JOIN dbo.RecibosTS D ON A.IDArt=D.IDArt WHERE A.IDSuc=@p0 AND D.IDRecibo=@p1", branch, receipt);
                    Execute(connection, tx, "UPDATE A SET A.StockAct=ISNULL(A.StockAct,0)-D.Cantidad FROM dbo.ArtsStock A INNER JOIN dbo.RecibosTS D ON A.IDArt=D.IDArt WHERE A.IDSuc=@p0 AND D.IDRecibo=@p1", entries[0]["IDSuc"], related);
                    if (Execute(connection, tx, "UPDATE dbo.RecibosTP SET Anulado=1 WHERE IDRecibo IN (@p0,@p1) AND Anulado=0", receipt, related) != 2) throw new InvalidOperationException("No se pudieron anular ambos movimientos de la transferencia.");
                    StockClearPurchaseLinks(connection, tx, related);
                }
                else
                {
                    // FDesActualStockRecibosSuma / Resta y bAnular_Click de Access.
                    Execute(connection, tx, "UPDATE A SET A.StockAct=A.StockAct-(D.Cantidad*T.StkPor) FROM dbo.ArtsStock A INNER JOIN dbo.RecibosTS D ON A.IDArt=D.IDArt INNER JOIN dbo.RecibosTP R ON R.IDRecibo=D.IDRecibo AND A.IDSuc=R.IDSuc INNER JOIN dbo.TipoComprobantes T ON T.IDComprob=R.IDTipoMov WHERE D.IDRecibo=@p0 AND T.IDTipoMovStock>0", receipt);
                    if (type == 38) Execute(connection, tx, "UPDATE A SET A.StockAct=A.StockAct+D.Cantidad FROM dbo.ArtsStock A INNER JOIN dbo.RecibosTS D ON A.IDArt=D.IDArt INNER JOIN dbo.RecibosTP R ON R.IDRecibo=D.IDRecibo AND A.IDSuc=R.IDSuc WHERE D.IDRecibo=@p0", receipt);
                    if (Execute(connection, tx, "UPDATE dbo.RecibosTP SET Anulado=1 WHERE IDRecibo=@p0 AND Anulado=0", receipt) != 1) throw new InvalidOperationException("No se pudo anular el movimiento.");
                }
                StockClearPurchaseLinks(connection, tx, receipt);
                tx.Commit();
                return new { ok = true, yaAnulado = false };
            }
            catch { try { tx.Rollback(); } catch { } throw; }
        }
    }

    private static List<Dictionary<string, object>> CollectionPending(SqlConnection c, SqlTransaction tx, int customer, int company)
    {
        return RowsTx(c, tx,
            "SELECT h.IDRecibo AS id,h.NroFactura AS numero,CONVERT(varchar(10),h.Fecha,103) AS fecha,t.Abreviatura AS tipo,0 AS cuota," +
            "ISNULL(cc.importe,0)*t.ImpPor AS impcc,ISNULL(p.totalPagos,0) AS totalPagos,ISNULL(p.cantidadRecibos,0) AS cantidadRecibos," +
            "ISNULL(cc.importe,0)*t.ImpPor-ISNULL(p.totalPagos,0) AS saldo " +
            "FROM dbo.FacturasATP h WITH(UPDLOCK,HOLDLOCK) JOIN dbo.TipoComprobantes t ON t.IDComprob=h.IDComprob " +
            "OUTER APPLY(SELECT SUM(v.ImpEnt) AS importe FROM dbo.FacturasTSVal v WHERE v.IDRecibo=h.IDRecibo AND v.IDTipoPago=3) cc " +
            "OUTER APPLY(SELECT SUM(d.ImpPagado) AS totalPagos,COUNT(d.IDRecibo) AS cantidadRecibos FROM dbo.RecibosXTSFac d JOIN dbo.RecibosXTP r ON r.IDRecibo=d.IDRecibo WHERE d.IDFactura=h.IDRecibo AND r.Confirmado=1 AND r.Anulado=0) p " +
            "WHERE h.IDCliente=@p0 AND h.IDEmp=@p1 AND h.Confirmado=-1 AND h.Anulada=0 AND t.IDTipoAcred>0 AND EXISTS(SELECT 1 FROM dbo.FacturasTSVal v WHERE v.IDRecibo=h.IDRecibo AND v.IDTipoPago=3) ORDER BY h.Fecha,h.IDComprob,h.NroFactura", customer, company)
            .FindAll(row => Math.Abs(Number(row["saldo"])) > .01m);
    }
    private static decimal CollectionBalance(SqlConnection c, SqlTransaction tx, int customer, int company)
    {
        return Number(Scalar(c, tx, "SELECT ISNULL(SaldoCC,0)+ISNULL((SELECT SUM(v.ImpEnt*t.ImpPor) FROM dbo.FacturasATP h JOIN dbo.FacturasTSVal v ON v.IDRecibo=h.IDRecibo JOIN dbo.TipoComprobantes t ON t.IDComprob=h.IDComprob WHERE h.IDCliente=c.IDCliente AND h.IDEmp=@p1 AND h.Confirmado=-1 AND h.Anulada=0 AND v.IDTipoPago=3 AND t.IDTipoAcred>0),0)-ISNULL((SELECT SUM(r.Total) FROM dbo.RecibosXTP r WHERE r.IDCliente=c.IDCliente AND r.IDEmp=@p1 AND r.Confirmado=1 AND r.Anulado=0),0) FROM dbo.Clientes c WHERE c.IDCliente=@p0", customer, company));
    }
    private static string CollectionReceiptVersion(SqlConnection c, SqlTransaction tx, int receipt)
    {
        return ProviderVersion(new Dictionary<string, object> {
            {"cabecera", RowsTx(c,tx,"SELECT * FROM dbo.RecibosXTP WITH(HOLDLOCK) WHERE IDRecibo=@p0",receipt)},
            {"facturas", RowsTx(c,tx,"SELECT * FROM dbo.RecibosXTSFac WITH(HOLDLOCK) WHERE IDRecibo=@p0 ORDER BY IDFactura",receipt)},
            {"valores", RowsTx(c,tx,"SELECT * FROM dbo.RecibosXTS WITH(HOLDLOCK) WHERE IDRecibo=@p0 ORDER BY IDOrden",receipt)} });
    }
    private const string CardSalesFrom = " FROM dbo.FacturasATP h JOIN dbo.TipoComprobantes t ON t.IDComprob=h.IDComprob JOIN dbo.FacturasTSVal v ON v.IDRecibo=h.IDRecibo JOIN dbo.TiposPagos p ON p.IDTipoPago=v.IDTipoPago JOIN dbo.Tarjetas a ON a.IDTarjeta=v.IDTarjeta JOIN dbo.[Depósitos] d ON d.IDDepósito=h.IDDepósito WHERE h.IDEmp=1 AND h.Confirmado=-1 AND h.Anulada=0 AND t.IDTipoAcred>0 AND v.IDTarjeta>0 AND h.Fecha>=@p0 AND h.Fecha<@p1 AND (@p2=0 OR v.IDTarjeta=@p2)";
    private static Guid CardFiscalDraftId(int source)
    {
        using(var hash=SHA256.Create()){byte[] bytes=hash.ComputeHash(Encoding.UTF8.GetBytes("CorralonWeb.FacturarX."+source));byte[] id=new byte[16];Array.Copy(bytes,id,16);return new Guid(id);}
    }
    private static Dictionary<string,object> CardFiscalSnapshot(SqlConnection c,SqlTransaction tx,int source)
    {
        var h=RowsTx(c,tx,"SELECT * FROM dbo.FacturasATP WITH(HOLDLOCK) WHERE IDRecibo=@p0 AND IDComprob=13 AND IDEmp=1 AND Confirmado=-1 AND Anulada=0 AND EXISTS(SELECT 1 FROM dbo.FacturasTSVal WHERE IDRecibo=@p0 AND IDTarjeta>0)",source);
        if(h.Count!=1)throw new InvalidOperationException("Solo se puede facturar una boleta X/PRES. ESPECIAL confirmada y sin anular de esta consulta.");
        var rows=RowsTx(c,tx,"SELECT * FROM dbo.FacturasATS WITH(HOLDLOCK) WHERE IDRecibo=@p0 ORDER BY Orden",source);
        var values=RowsTx(c,tx,"SELECT * FROM dbo.FacturasTSVal WITH(HOLDLOCK) WHERE IDRecibo=@p0 ORDER BY Orden",source);
        return new Dictionary<string,object>{{"cabecera",h[0]},{"articulos",rows},{"valores",values}};
    }
    private static Dictionary<string,object> CardFiscalInvoice(SqlConnection c,SqlTransaction tx,Dictionary<string,object> snapshot,Dictionary<string,object> input)
    {
        var h=Object(snapshot["cabecera"]);int source=Convert.ToInt32(h["IDRecibo"]),type=RequiredId(Value(input,"tipo"),"el tipo de factura"),customer=RequiredId(Value(input,"cliente"),"el cliente");
        if(type!=1&&type!=2)throw new InvalidOperationException("Elegí Factura A o B.");
        int point=RequiredId(Value(input,"puntoVenta"),"el punto de venta");
        if(Number(Scalar(c,tx,"SELECT COUNT(*) FROM dbo.[Depósitos] d JOIN dbo.TiposCompXPV p ON p.IDPtoVta=d.IDDepósito WHERE d.IDEmp=1 AND d.FE=1 AND d.IDDepósito=@p0 AND p.IDComprob=@p1",point,type))!=1)throw new InvalidOperationException("Elegí un punto de venta electrónico habilitado para este tipo de factura.");
        var customers=RowsTx(c,tx,"SELECT [RazónSocial] nombre,IDTipoIVA idTipoIva,IDTipoDoc idTipoDoc,CUIT documento,[Dirección] direccion,[Teléfono] telefono,Email email,Suspendido suspendido FROM dbo.Clientes WITH(HOLDLOCK) WHERE IDCliente=@p0",customer);if(customers.Count!=1||Convert.ToBoolean(customers[0]["suspendido"]))throw new InvalidOperationException("Seleccioná una razón social vigente.");
        var client=customers[0];int tax=(int)Number(client["idTipoIva"]),doc=(int)Number(client["idTipoDoc"]);
        if((type==1&&tax!=1)||(type==2&&tax==1))throw new InvalidOperationException("La condición de IVA no corresponde al tipo de factura seleccionado.");
        var items=new System.Collections.ArrayList();foreach(var item in (List<Dictionary<string,object>>)snapshot["articulos"]){
            var r=Object(item);var rates=RowsTx(c,tx,"SELECT a.PorcIVA1,a.IDMoneda,CASE WHEN a.IDMoneda=1 THEN CONVERT(decimal(18,4),1) ELSE m.ImpCotiz END cotizacion FROM dbo.[Artículos] a LEFT JOIN dbo.Monedas m ON m.IDMoneda=a.IDMoneda WHERE a.IDArt=@p0",r["IDArt"]);
            if(rates.Count!=1||Math.Abs(InvoiceValueNumber(r["PorcIVA"])-InvoiceValueNumber(rates[0]["PorcIVA1"]))>.0001m)throw new InvalidOperationException("Cambió el IVA de un artículo de la boleta. Revisala antes de facturar.");
            items.Add(new {idart=Text(r["IDArt"]),descripcion=Text(r["ArtDesc"]),cantidad=Number(r["Cantidad"]),precio=Number(r["PrecioUni"]),precioBase=InvoiceValueNumber(Value(r,"PrecioUniOrig")),descuento=InvoiceValueNumber(r["PorcDto"])*100,iva=InvoiceValueNumber(r["PorcIVA"])*100,cotizacion=InvoiceValueNumber(rates[0]["cotizacion"])});
        }
        var payments=new System.Collections.ArrayList();foreach(var item in (List<Dictionary<string,object>>)snapshot["valores"]){
            var r=Object(item);if(InvoiceValueNumber(r["Importe"])<=0)throw new InvalidOperationException("La boleta tiene un valor sin importe positivo. Revisala antes de facturar.");
            payments.Add(new {idTipoPago=Number(r["IDTipoPago"]),idTarjeta=InvoiceValueNumber(r["IDTarjeta"]),importe=Number(r["Importe"]),impRec=InvoiceValueNumber(r["ImpRec"]),coef=InvoiceValueNumber(r["Coef"]),cuotas=InvoiceValueNumber(r["Cuotas"]),descripcion=Text(r["Concepto"])});
        }
        string[] taxNames={"","Responsable inscripto","Responsable no inscripto","No responsable","Exento","Consumidor final","Monotributista"};
        var invoice=new {id=CardFiscalDraftId(source).ToString("D"),usuarioId=Text(Value(input,"usuarioId")),idComprobante=type,idPuntoVenta=point,idCliente=customer,fecha=Text(Value(input,"fecha")),vendedor=Number(h["IDVend"]),listaPrecios=Math.Max(1,Math.Min(3,InvoiceValueNumber(h["IDTipoCli"]))),
            cliente=new {nombre=Text(client["nombre"]),tipoDocumento=doc==67?"CUIT":doc==32?"Sin identificar":"DNI",numeroDocumento=Text(client["documento"]),condicionIva=tax>=1&&tax<=6?taxNames[tax]:"",direccion=Text(client["direccion"]),telefono=Text(client["telefono"]),email=Text(client["email"])},
            articulos=items,valores=payments,totales=new {total=Math.Abs(Number(h["Total"]))},nota=Text(h["Nota"]),facturarOrigenId=source,facturarOrigenVersion=Text(Value(input,"version"))};
        // Igual que /emitir: Deserialize<T> conserva los renglones como ArrayList.
        return Json.Deserialize<Dictionary<string,object>>(Json.Serialize(invoice));
    }
    private static Dictionary<string,object> AssertCardFiscalOrigin(SqlConnection c,SqlTransaction tx,Dictionary<string,object> invoice)
    {
        int source=RequiredId(Value(invoice,"facturarOrigenId"),"la boleta X");var snapshot=CardFiscalSnapshot(c,tx,source);
        if(Text(Value(invoice,"facturarOrigenVersion"))!=ProviderVersion(snapshot))throw new InvalidOperationException("La boleta X cambió. Volvé a consultarla antes de facturar.");
        var expected=CardFiscalInvoice(c,tx,snapshot,new Dictionary<string,object>{{"tipo",Value(invoice,"idComprobante")},{"puntoVenta",Value(invoice,"idPuntoVenta")},{"cliente",Value(invoice,"idCliente")},{"fecha",Value(invoice,"fecha")},{"usuarioId",Value(invoice,"usuarioId")},{"version",Value(invoice,"facturarOrigenVersion")}});
        if(DraftFingerprint(invoice)!=DraftFingerprint(expected))throw new InvalidOperationException("Los datos no coinciden exactamente con la boleta X y el receptor elegidos. No se solicitó CAE.");
        return Object(snapshot["cabecera"]);
    }
    private static object CardFiscalPrepare(SqlConnection c,int source)
    {
        using(var tx=c.BeginTransaction(IsolationLevel.Serializable)){
            var snapshot=CardFiscalSnapshot(c,tx,source);var h=Object(snapshot["cabecera"]);
            var linked=RowsTx(c,tx,"SELECT IDRecibo idRecibo,NroFactura numero FROM dbo.FacturasATP WHERE IDEmp=1 AND IDComprob IN(1,2) AND Confirmado=-1 AND Anulada=0 AND (NroOTrab=@p0 OR NroFacNC=@p1)",DraftMarker(CardFiscalDraftId(source)),h["NroFactura"]);
            var result=new {ok=true,borradorId=CardFiscalDraftId(source).ToString("D"),version=ProviderVersion(snapshot),origen=new {idRecibo=source,numero=h["NroFactura"],total=h["Total"],puntoVenta=h["IDDepósito"]},facturas=linked,puntosVenta=RowsTx(c,tx,"SELECT d.IDDepósito id,d.[Descripción] nombre,p.IDComprob tipo FROM dbo.[Depósitos] d JOIN dbo.TiposCompXPV p ON p.IDPtoVta=d.IDDepósito WHERE d.IDEmp=1 AND d.FE=1 AND p.IDComprob IN(1,2) ORDER BY d.IDDepósito,p.IDComprob"),clientes=RowsTx(c,tx,"SELECT IDCliente id,[RazónSocial] nombre,CUIT documento,IDTipoIVA idTipoIva FROM dbo.Clientes WHERE IDCliente>1 AND Suspendido=0 ORDER BY [RazónSocial]")};
            tx.Commit();return result;
        }
    }
    // Read-only recovery check when a browser intent never acquired a server draft number.
    private static object CardFiscalVerifyPending(SqlConnection c,Dictionary<string,object> input)
    {
        int source=RequiredId(Value(input,"idRecibo"),"la boleta X");Dictionary<string,object> invoice;
        using(var tx=c.BeginTransaction(IsolationLevel.Serializable)){
            var snapshot=CardFiscalSnapshot(c,tx,source);
            if(Text(Value(input,"version"))!=ProviderVersion(snapshot))throw new InvalidOperationException("La boleta X cambió. Cerrá el aviso y volvé a abrirla para revisar sus datos.");
            invoice=CardFiscalInvoice(c,tx,snapshot,input);tx.Commit();
        }
        Guid draft=CardFiscalDraftId(source);
        if(File.Exists(PendingDraftPath(draft))||File.Exists(RecoveryPath(draft)))return new {ok=true,estado="incierto",detalle="El servidor conserva una solicitud fiscal. Volvé a verificar esa misma operación."};
        int type=Id(invoice["idComprobante"]),point=Id(invoice["idPuntoVenta"]),customer=Id(invoice["idCliente"]);
        DateTime date=DateTime.ParseExact(Text(invoice["fecha"]),"yyyy-MM-dd",CultureInfo.InvariantCulture);
        decimal total=Number(Object(invoice["totales"])["total"]);
        string cuit=Text(Scalar(c,null,"SELECT CUIT FROM dbo.Empresa WHERE IDEmpresa=1")).Replace("-","").Replace(" ","");
        int afipType=Convert.ToInt32(Scalar(c,null,"SELECT IDTipoAFIP FROM dbo.TipoComprobantes WHERE IDComprob=@p0 AND EnLibroIVA=1",type));
        var known=Rows(c,"SELECT NroFactura,IDCliente,Fecha,Total,NroFacNC,NroOTrab FROM dbo.FacturasATP WHERE IDEmp=1 AND IDComprob=@p0 AND NroFactura LIKE @p1 AND Confirmado=-1 AND LEN(CAE)=14",type,point.ToString("0000")+"-%");
        string originalNumber=Text(Scalar(c,null,"SELECT NroFactura FROM dbo.FacturasATP WHERE IDRecibo=@p0",source));
        foreach(var row in known)if(Text(row["NroFacNC"])==originalNumber||Text(row["NroOTrab"])==DraftMarker(draft)||(Number(row["IDCliente"])==customer&&Convert.ToDateTime(row["Fecha"]).Date==date.Date&&Math.Abs(Number(row["Total"])-total)<=.01m))
            return new {ok=true,estado="incierto",detalle="Hay una factura en SQL que puede corresponder a este intento. Cerrá el aviso y revisá Ver factura emitida antes de continuar."};
        var numbers=new HashSet<int>();foreach(var row in known){string n=Text(row["NroFactura"]);int sequence;if(n.Length>=8&&Int32.TryParse(n.Substring(n.Length-8),out sequence)&&sequence>0)numbers.Add(sequence);}
        lock(FiscalGate){
            int last=FiscalLastAuthorized(afipType,point,cuit);
            if(last<0||last>100000)return new {ok=true,estado="incierto",detalle="La numeración requiere una revisión más amplia. No se habilitó otra emisión."};
            var gaps=new List<int>();for(int n=1;n<=last;n++)if(!numbers.Contains(n))gaps.Add(n);
            if(gaps.Count>20)return new {ok=true,estado="incierto",detalle="Hay más de 20 números fiscales sin respaldo en SQL. Se requiere revisión antes de reintentar."};
            var client=Object(invoice["cliente"]);string documentType=Text(client["tipoDocumento"]),document=CustomerDocumentDigits(Text(client["numeroDocumento"]));int doc=documentType=="CUIT"?80:documentType=="DNI"?96:99;
            foreach(int n in gaps){string number=point.ToString("0000")+"-"+n.ToString("00000000");try{
                var authorized=FiscalConsult(afipType,point,number,cuit,date,doc,document,total);
                if(authorized!=null)return new {ok=true,estado="incierto",detalle="ARCA tiene una autorización coincidente en "+number+" que no figura en SQL. No se pidió otro CAE; debe revisarse para recuperar la factura."};
            }catch(FiscalMismatchException){/* This fiscal number belongs to a different date, document or amount. */}}
            return new {ok=true,estado="reintentable",detalle="Se cruzó la numeración autorizada de ARCA con SQL y los números faltantes no corresponden a este intento. Se puede continuar con el mismo identificador."};
        }
    }
    private static object CardFiscalIssue(SqlConnection c,Dictionary<string,object> input)
    {
        int source=RequiredId(Value(input,"idRecibo"),"la boleta X");Dictionary<string,object> invoice;
        using(var tx=c.BeginTransaction(IsolationLevel.Serializable)){
            var snapshot=CardFiscalSnapshot(c,tx,source);
            if(Text(Value(input,"version"))!=ProviderVersion(snapshot))throw new InvalidOperationException("La boleta X cambió. Volvé a consultarla antes de facturar.");
            invoice=CardFiscalInvoice(c,tx,snapshot,input);tx.Commit();
        }
        return Emit(c,invoice,false,false);
    }
    private static object CardSalesQuery(SqlConnection c,HttpListenerRequest request)
    {
        if(Text(request.QueryString["consulta"])=="opciones")return new {ok=true,tarjetas=Rows(c,"SELECT IDTarjeta id,[Descripción] nombre FROM dbo.Tarjetas WHERE Susp=0 ORDER BY [Descripción]")};
        if(Text(request.QueryString["consulta"])=="factura-vinculada"){
            int source=RequiredId(request.QueryString["idRecibo"],"la boleta X");
            var original=Rows(c,"SELECT NroFactura FROM dbo.FacturasATP WHERE IDRecibo=@p0 AND IDEmp=1 AND IDComprob=13 AND Confirmado=-1 AND Anulada=0",source);
            if(original.Count!=1)throw new InvalidOperationException("No se encontró la boleta X original.");
            return new {ok=true,facturas=Rows(c,"SELECT IDRecibo idRecibo,NroFactura numero FROM dbo.FacturasATP WHERE IDEmp=1 AND IDComprob IN(1,2) AND Confirmado=-1 AND Anulada=0 AND (NroOTrab=@p0 OR NroFacNC=@p1) ORDER BY Fecha,IDRecibo",DraftMarker(CardFiscalDraftId(source)),original[0]["NroFactura"])};
        }
        if(Text(request.QueryString["consulta"])=="preparar-factura"){AssertPurchasePermission(request.QueryString["usuarioId"],"ventas_tarjeta",true);return CardFiscalPrepare(c,RequiredId(request.QueryString["idRecibo"],"la boleta X"));}
        DateTime from,to;
        if(!DateTime.TryParseExact(request.QueryString["desde"],"yyyy-MM-dd",CultureInfo.InvariantCulture,DateTimeStyles.None,out from)||!DateTime.TryParseExact(request.QueryString["hasta"],"yyyy-MM-dd",CultureInfo.InvariantCulture,DateTimeStyles.None,out to)||to<from||to>=DateTime.MaxValue.Date)throw new InvalidOperationException("Revisá las fechas Desde y Hasta.");
        int card; if(!Int32.TryParse(request.QueryString["tarjeta"]??"0",out card)||card<0)throw new InvalidOperationException("Tarjeta inválida.");
        bool report=Text(request.QueryString["consulta"])=="informe";
        using(var tx=c.BeginTransaction(IsolationLevel.Serializable)){
            object result;
            if(report)result=new {ok=true,filas=RowsTx(c,tx,"SELECT d.IDDepósito puntoVenta,d.[Descripción] deposito,v.IDTarjeta tarjetaId,a.[Descripción] tarjeta,SUM(ISNULL(v.Importe,0)-ISNULL(v.ImpRec,0)) total"+CardSalesFrom+" AND h.EnInfVtas<>0 GROUP BY d.IDDepósito,d.[Descripción],v.IDTarjeta,a.[Descripción] ORDER BY d.IDDepósito,a.[Descripción]",from,to.AddDays(1),card)};
            else {
                var rows=RowsTx(c,tx,"SELECT h.IDRecibo idRecibo,h.IDComprob idComprobante,v.Orden orden,CONVERT(varchar(10),h.Fecha,23) fecha,t.Abreviatura tipo,h.NroFactura numero,v.Cuotas cuotas,h.ApeYNom cliente,v.Concepto numeroTarjeta,v.ImpEnt*t.ImpPor total,h.Pagada cobrada,p.TipoPago tipoPago,v.IDTarjeta tarjetaId,a.[Descripción] tarjeta,d.[Descripción] puntoVenta"+CardSalesFrom+" ORDER BY h.Fecha,t.Abreviatura,h.NroFactura,h.IDRecibo,v.Orden",from,to.AddDays(1),card);
                // Leer los vinculos una sola vez: el EXISTS correlacionado por fila
                // hacia FacturasATP sin indice por NroFacNC agotaba el tiempo de SQL.
                if(rows.Exists(row=>Number(row["idComprobante"])==13)) {
                    var invoiced=new HashSet<string>(StringComparer.OrdinalIgnoreCase);
                    foreach(var link in RowsTx(c,tx,"SELECT DISTINCT NroFacNC FROM dbo.FacturasATP WHERE IDEmp=1 AND IDComprob IN(1,2) AND Confirmado=-1 AND Anulada=0 AND NroFacNC<>''"))invoiced.Add(Text(link["NroFacNC"]));
                    foreach(var row in rows)if(Number(row["idComprobante"])==13&&invoiced.Contains(Text(row["numero"])))row["tipo"]=Text(row["tipo"])+" - F";
                }
                var versions=new Dictionary<int,string>();
                foreach(var row in rows){int id=Convert.ToInt32(row["idRecibo"]);if(!versions.ContainsKey(id))versions[id]=CardSalesVersion(c,tx,id);row["version"]=versions[id];}
                result=new {ok=true,filas=rows};
            }
            tx.Commit();return result;
        }
    }
    private static string CardSalesVersion(SqlConnection c,SqlTransaction tx,int receipt)
    {
        return ProviderVersion(new Dictionary<string,object>{{"cabecera",RowsTx(c,tx,"SELECT IDRecibo,Pagada,Confirmado,Anulada,Total,IDEmp FROM dbo.FacturasATP WITH(HOLDLOCK) WHERE IDRecibo=@p0",receipt)},{"valores",RowsTx(c,tx,"SELECT Orden,IDTarjeta,IDTipoPago,Cuotas,ImpEnt,Concepto FROM dbo.FacturasTSVal WITH(HOLDLOCK) WHERE IDRecibo=@p0 ORDER BY Orden",receipt)}});
    }
    private static object CardSalesUncheck(SqlConnection c,Dictionary<string,object> input)
    {
        int receipt=RequiredId(Value(input,"idRecibo"),"la boleta");
        if(Text(Value(input,"accion"))!="desmarcar")throw new InvalidOperationException("Solo se permite desmarcar Cobrada.");
        using(var tx=c.BeginTransaction(IsolationLevel.Serializable)){
            var h=RowsTx(c,tx,"SELECT h.Pagada FROM dbo.FacturasATP h WITH(UPDLOCK,HOLDLOCK) JOIN dbo.TipoComprobantes t ON t.IDComprob=h.IDComprob WHERE h.IDRecibo=@p0 AND h.IDEmp=1 AND h.Confirmado=-1 AND h.Anulada=0 AND t.IDTipoAcred>0 AND EXISTS(SELECT 1 FROM dbo.FacturasTSVal WHERE IDRecibo=h.IDRecibo AND IDTarjeta>0)",receipt);
            if(h.Count!=1)throw new InvalidOperationException("La boleta ya no está disponible en esta consulta.");
            if(String.IsNullOrWhiteSpace(Text(Value(input,"version")))||Text(Value(input,"version"))!=CardSalesVersion(c,tx,receipt))throw new InvalidOperationException("La boleta cambió en otro equipo. Actualizá antes de desmarcar.");
            Execute(c,tx,"UPDATE dbo.FacturasATP SET Pagada=0 WHERE IDRecibo=@p0",receipt);
            var version=CardSalesVersion(c,tx,receipt);tx.Commit();return new {ok=true,idRecibo=receipt,cobrada=false,version=version};
        }
    }
    private static object CollectionReceiptCancel(SqlConnection c, Dictionary<string, object> input)
    {
        int receipt=RequiredId(Value(input,"id"),"el recibo");
        using(var tx=c.BeginTransaction(IsolationLevel.Serializable))
        {
            try
            {
                if(Number(Scalar(c,tx,"DECLARE @r int; EXEC @r=sp_getapplock @Resource=@p0,@LockMode='Exclusive',@LockOwner='Transaction',@LockTimeout=10000; SELECT @r","CorralonWeb.RecibosCobro"))<0)throw new InvalidOperationException("Hay otro recibo en proceso. Reintentá.");
                var headers=RowsTx(c,tx,"SELECT Confirmado,Anulado,IDCaja FROM dbo.RecibosXTP WITH(UPDLOCK,HOLDLOCK) WHERE IDRecibo=@p0",receipt);
                if(headers.Count!=1 || !Convert.ToBoolean(headers[0]["Confirmado"]))throw new InvalidOperationException("No se encontró el recibo confirmado.");
                if(!Convert.ToBoolean(headers[0]["Anulado"]))
                {
                    if(String.IsNullOrWhiteSpace(Text(Value(input,"version"))) || Text(Value(input,"version"))!=CollectionReceiptVersion(c,tx,receipt))throw new InvalidOperationException("El recibo cambió en otro equipo. Cerrá y volvé a consultarlo antes de anular.");
                    int cash=Convert.ToInt32(InvoiceValueNumber(headers[0]["IDCaja"]));
                    if(cash>0 && Scalar(c,tx,"SELECT IDRecibo FROM dbo.CajaDiaTP WITH(UPDLOCK,HOLDLOCK) WHERE IDRecibo=@p0 AND Confirmado<>0",cash)!=null)throw new InvalidOperationException("El recibo pertenece a una Caja cerrada. Reabrí la Caja antes de anularlo.");
                    // Keep the cancelled receipt and its received values, but unlink the invoices below.
                    if(Execute(c,tx,"UPDATE dbo.RecibosXTP SET Anulado=1 WHERE IDRecibo=@p0 AND Confirmado=1 AND Anulado=0",receipt)!=1)throw new InvalidOperationException("No se pudo anular el recibo.");
                }
                Execute(c,tx,"DELETE d FROM dbo.RecibosXTSFac d JOIN dbo.RecibosXTP r ON r.IDRecibo=d.IDRecibo WHERE r.IDRecibo=@p0 AND r.Confirmado=1 AND r.Anulado=1",receipt);
                var result=CollectionReceiptResult(c,tx,receipt);tx.Commit();return result;
            }
            catch {try {tx.Rollback();}catch{}throw;}
        }
    }
    private static object CollectionReceiptEditPayment(SqlConnection c,Dictionary<string,object> input)
    {
        AssertPurchasePermission(Text(Value(input,"usuarioId")),"recibos_cobro",false,true);
        int receipt=RequiredId(Value(input,"id"),"el recibo"),order=RequiredId(Value(input,"orden"),"el valor recibido"),kind=RequiredId(Value(input,"tipo"),"el tipo de pago");
        using(var tx=c.BeginTransaction(IsolationLevel.Serializable)){
            var h=RowsTx(c,tx,"SELECT IDCaja FROM dbo.RecibosXTP WITH(UPDLOCK,HOLDLOCK) WHERE IDRecibo=@p0 AND Confirmado=1 AND Anulado=0",receipt);
            if(h.Count!=1)throw new InvalidOperationException("El recibo no está confirmado o fue anulado.");
            if(Text(Value(input,"version"))!=CollectionReceiptVersion(c,tx,receipt))throw new InvalidOperationException("El recibo cambió. Cerrá y volvé a consultarlo.");
            int cash=(int)InvoiceValueNumber(h[0]["IDCaja"]);
            if(cash>0&&Scalar(c,tx,"SELECT IDRecibo FROM dbo.CajaDiaTP WITH(UPDLOCK,HOLDLOCK) WHERE IDRecibo=@p0 AND Confirmado<>0",cash)!=null)throw new InvalidOperationException("El recibo pertenece a una Caja cerrada. Reabrí la Caja antes de modificar el pago.");
            var rows=RowsTx(c,tx,"SELECT v.*,p.IDClasePago clase FROM dbo.RecibosXTS v WITH(UPDLOCK,HOLDLOCK) JOIN dbo.TiposPagos p ON p.IDTipoPago=v.IDTipoPago WHERE v.IDRecibo=@p0 AND v.IDOrden=@p1",receipt,order);
            var kinds=RowsTx(c,tx,"SELECT IDClasePago clase FROM dbo.TiposPagos WHERE IDTipoPago=@p0 AND IDTipoPago NOT IN(3,4)",kind);
            if(rows.Count!=1||kinds.Count!=1)throw new InvalidOperationException("Valor o tipo de pago inválido.");
            int cls=(int)Number(kinds[0]["clase"]),oldClass=(int)Number(rows[0]["clase"]),card=(int)InvoiceValueNumber(Value(input,"tarjeta")),installments=(int)InvoiceValueNumber(Value(input,"cuotas"));
            if(cls==2||oldClass==2||InvoiceValueNumber(rows[0]["IDMovBco"])>0)throw new InvalidOperationException("Los cheques vinculados requieren su gestión bancaria; no se cambian desde este editor.");
            if(cls!=1&&cls!=3&&cls!=5)throw new InvalidOperationException("Tipo de pago no admitido para esta corrección.");
            if(cls==1){card=0;installments=0;}else if(card<=0||Scalar(c,tx,"SELECT IDTarjeta FROM dbo.Tarjetas WHERE IDTarjeta=@p0 AND Susp=0",card)==null)throw new InvalidOperationException("Seleccioná una tarjeta o cuenta vigente.");
            if(cls==3)installments=0;
            if(installments<0||installments>120||(cls==5&&installments<1))throw new InvalidOperationException("Revisá las cuotas de la tarjeta.");
            if(Execute(c,tx,"UPDATE dbo.RecibosXTS SET IDTipoPago=@p0,IDTarjeta=@p1,Cuotas=@p2 WHERE IDRecibo=@p3 AND IDOrden=@p4",kind,card,installments,receipt,order)!=1)throw new InvalidOperationException("No se pudo actualizar el valor.");
            var result=CollectionReceiptResult(c,tx,receipt);tx.Commit();return result;
        }
    }
    private static object CollectionReceiptResult(SqlConnection c, SqlTransaction tx, int receipt)
    {
        var headers = RowsTx(c, tx, "SELECT r.IDRecibo AS id,r.NroFactura AS numero,CONVERT(varchar(10),r.Fecha,103) AS fecha,r.IDCliente AS idCliente,r.Cliente AS cliente,r.Total AS total,r.Nota AS nota,r.Concepto AS concepto,c.CUIT AS documento,r.IDEmp AS empresa,r.Anulado AS anulado,r.IDDepósito AS puntoVenta,p.[Descripción] AS nombrePuntoVenta FROM dbo.RecibosXTP r JOIN dbo.[Depósitos] p ON p.IDDepósito=r.IDDepósito LEFT JOIN dbo.Clientes c ON c.IDCliente=r.IDCliente WHERE r.IDRecibo=@p0 AND r.Confirmado=1", receipt);
        if (headers.Count != 1) throw new InvalidOperationException("No se encontró el recibo confirmado.");
        headers[0]["saldo"] = CollectionBalance(c, tx, Convert.ToInt32(headers[0]["idCliente"]), Convert.ToInt32(headers[0]["empresa"]));
        return new { ok = true, version = CollectionReceiptVersion(c,tx,receipt), recibo = headers[0], facturas = RowsTx(c, tx, "SELECT d.IDFactura AS id,h.NroFactura AS numero,CONVERT(varchar(10),h.Fecha,103) AS fecha,t.Abreviatura AS tipo,d.CuotaPaga AS cuota,h.Total AS importeFactura,d.ImpPagado AS importe FROM dbo.RecibosXTSFac d JOIN dbo.FacturasATP h ON h.IDRecibo=d.IDFactura JOIN dbo.TipoComprobantes t ON t.IDComprob=h.IDComprob WHERE d.IDRecibo=@p0 ORDER BY h.Fecha,h.NroFactura", receipt),
            valores = RowsTx(c, tx, "SELECT v.IDOrden AS orden,v.IDTipoPago AS idTipoPago,p.IDClasePago AS clase,p.TipoPago AS tipo,v.IDTarjeta AS idTarjeta,t.[Descripción] AS tarjeta,v.Cuotas AS cuotas,CONVERT(varchar(10),v.FechaVto,103) AS vencimiento,v.Importe AS importe,v.Concepto AS descripcion,m.NroMovExt AS numero,b.Banco AS banco FROM dbo.RecibosXTS v JOIN dbo.TiposPagos p ON p.IDTipoPago=v.IDTipoPago LEFT JOIN dbo.Tarjetas t ON t.IDTarjeta=v.IDTarjeta LEFT JOIN dbo.MovCheques m ON m.NroMovInt=v.IDMovBco LEFT JOIN dbo.Bancos b ON b.IDBanco=COALESCE(NULLIF(v.IDBanco,0),m.IDBanco) WHERE v.IDRecibo=@p0 ORDER BY v.IDOrden", receipt) };
    }
    private static object CollectionReceiptQuery(SqlConnection c, HttpListenerRequest request)
    {
        string query = request.QueryString["consulta"] ?? "opciones";
        if (query == "opciones") return new { ok = true,
            clientes = Rows(c, "SELECT IDCliente AS id,[RazónSocial] AS nombre,CUIT AS documento FROM dbo.Clientes WHERE IDCliente>1 AND ISNULL(Suspendido,0)=0 ORDER BY [RazónSocial]"),
            puntosVenta = Rows(c, "SELECT IDDepósito AS id,[Descripción] AS nombre,IDEmp AS empresa FROM dbo.[Depósitos] WHERE IDDepósito>1 ORDER BY IDDepósito"),
            pagos = Rows(c, "SELECT IDTipoPago AS id,TipoPago AS nombre,IDClasePago AS clase FROM dbo.TiposPagos WHERE IDTipoPago NOT IN(3,4) ORDER BY TipoPago"),
            tarjetas = Rows(c, "SELECT IDTarjeta AS id,[Descripción] AS nombre FROM dbo.Tarjetas WHERE Susp=0 ORDER BY [Descripción]"),
            valores = Rows(c, "SELECT NroMovInt AS id,NroMovExt AS numero,CONVERT(varchar(10),FechaVto,23) AS vencimiento,Importe AS importe,IDBanco AS banco FROM dbo.MovCheques WHERE Confirmado=1 AND Anulado=0 ORDER BY NroMovExt") };
        if (query == "detalle") return CollectionReceiptResult(c, null, RequiredId(request.QueryString["id"], "el recibo"));
        int customer; Int32.TryParse(request.QueryString["cliente"], out customer);
        if (query == "recibos") return new { ok = true, recibos = Rows(c, "SELECT TOP 200 IDRecibo AS id,NroFactura AS numero,CONVERT(varchar(10),Fecha,103) AS fecha,Cliente AS cliente,Total AS total,Anulado AS anulado FROM dbo.RecibosXTP WHERE Confirmado=1 AND (@p0=0 OR IDCliente=@p0) ORDER BY IDRecibo DESC", customer) };
        if (query != "facturas" || customer <= 1) throw new InvalidOperationException("Seleccioná un cliente válido.");
        int point = RequiredId(request.QueryString["puntoVenta"], "el punto de venta");
        var points = Rows(c, "SELECT IDEmp FROM dbo.[Depósitos] WHERE IDDepósito=@p0", point);
        if (points.Count != 1) throw new InvalidOperationException("Punto de venta inválido.");
        int company = Convert.ToInt32(points[0]["IDEmp"]);
        return new { ok = true, facturas = CollectionPending(c, null, customer, company), saldo = CollectionBalance(c, null, customer, company) };
    }
    private static object CollectionReceiptConfirm(SqlConnection c, Dictionary<string, object> input)
    {
        int customer = RequiredId(Value(input, "cliente"), "el cliente"), point = RequiredId(Value(input, "puntoVenta"), "el punto de venta");
        int oper = UserOperator(c, Text(Value(input, "usuarioId")));
        Guid operation; if (!Guid.TryParse(Text(Value(input, "operacion")), out operation)) throw new InvalidOperationException("Falta el identificador del recibo.");
        var invoices = PurchaseArray(Value(input, "facturas")); var payments = PurchaseArray(Value(input, "valores"));
        if (payments.Count == 0 || payments.Count > 100 || invoices.Count > 500) throw new InvalidOperationException("Revisá los renglones del recibo.");
        string marker = "[WEBRECIBO:" + operation.ToString("D") + "]";
        string signature = marker + "[HASH:" + ProviderVersion(input).Substring(0, 32) + "]";
        string note = Limited(Value(input, "nota"), 100, "Nota");
        using (var tx = c.BeginTransaction(IsolationLevel.Serializable))
        {
            try
            {
                if (Number(Scalar(c, tx, "DECLARE @r int; EXEC @r=sp_getapplock @Resource=@p0,@LockMode='Exclusive',@LockOwner='Transaction',@LockTimeout=10000; SELECT @r", "CorralonWeb.RecibosCobro")) < 0) throw new InvalidOperationException("Hay otro recibo confirmándose. Reintentá.");
                var saved = RowsTx(c, tx, "SELECT IDRecibo,Concepto FROM dbo.RecibosXTP WITH(UPDLOCK,HOLDLOCK) WHERE Concepto LIKE @p0", marker.Replace("[", "[[]") + "%");
                if (saved.Count > 0)
                {
                    if (saved.Count != 1 || Text(saved[0]["Concepto"]) != signature) throw new InvalidOperationException("Este recibo ya fue enviado con otros datos. Consultalo antes de continuar.");
                    var previous = CollectionReceiptResult(c, tx, Convert.ToInt32(saved[0]["IDRecibo"])); tx.Commit(); return previous;
                }
                var client = RowsTx(c, tx, "SELECT [RazónSocial] AS nombre FROM dbo.Clientes WITH(UPDLOCK,HOLDLOCK) WHERE IDCliente=@p0 AND IDCliente>1 AND ISNULL(Suspendido,0)=0", customer);
                var points = RowsTx(c, tx, "SELECT IDEmp FROM dbo.[Depósitos] WITH(UPDLOCK,HOLDLOCK) WHERE IDDepósito=@p0 AND IDDepósito>1", point);
                if (client.Count != 1 || points.Count != 1) throw new InvalidOperationException("Cliente o punto de venta inválido.");
                int company = Convert.ToInt32(points[0]["IDEmp"]);
                var pending = CollectionPending(c, tx, customer, company);
                decimal allocated = 0, received = 0;
                var selected = new HashSet<int>();
                foreach (var value in invoices)
                {
                    var line = Object(value); int invoice = RequiredId(Value(line, "id"), "la factura");
                    if (!selected.Add(invoice)) throw new InvalidOperationException("La misma factura aparece dos veces.");
                    decimal amount = Math.Round(Number(Value(line, "importe")), 2, MidpointRounding.AwayFromZero);
                    var found = pending.Find(row => Convert.ToInt32(row["id"]) == invoice);
                    if (found == null) throw new InvalidOperationException("Una factura ya fue cobrada o no pertenece al cliente. Volvé a cargar las facturas.");
                    decimal balance = Number(found["saldo"]);
                    if ((balance > 0 && (amount < 0 || amount > balance + .01m)) || (balance < 0 && (amount > 0 || amount < balance - .01m))) throw new InvalidOperationException("El importe supera el saldo pendiente de la factura " + Text(found["numero"]) + ".");
                    allocated += amount;
                }
                foreach (var value in payments)
                {
                    var line = Object(value); decimal amount = Math.Round(Number(Value(line, "importe")), 2, MidpointRounding.AwayFromZero);
                    if (amount <= 0 || amount > 1000000000m) throw new InvalidOperationException("Revisá el importe de los valores recibidos."); received += amount;
                    int kind = RequiredId(Value(line, "tipo"), "el tipo de valor");
                    if (RowsTx(c, tx, "SELECT IDTipoPago FROM dbo.TiposPagos WHERE IDTipoPago=@p0 AND IDTipoPago NOT IN(3,4)", kind).Count != 1) throw new InvalidOperationException("Tipo de valor inválido.");
                }
                if (invoices.Count > 0 && Math.Abs(received - allocated) > .01m) throw new InvalidOperationException("Existen diferencias de importes entre facturas y valores recibidos.");
                string prefix = point.ToString("0000") + "-";
                int next = Convert.ToInt32(Scalar(c, tx, "SELECT ISNULL(MAX(TRY_CONVERT(int,SUBSTRING(NroFactura,6,8))),0)+1 FROM dbo.RecibosXTP WITH(UPDLOCK,HOLDLOCK) WHERE IDDepósito=@p0 AND NroFactura LIKE @p1", point, prefix + "%"));
                if (next > 99999999) throw new InvalidOperationException("Se agotó la numeración de recibos.");
                string number = prefix + next.ToString("00000000");
                int receipt = Convert.ToInt32(Scalar(c, tx, "INSERT dbo.RecibosXTP(IDComprob,IDDepósito,NroFactura,Fecha,IDCliente,Concepto,Cliente,Confirmado,Total,Nota,Anulado,IDOper,IDEmp,FechaCarga) OUTPUT INSERTED.IDRecibo VALUES(9,@p0,@p1,@p2,@p3,@p4,@p5,0,@p6,@p7,0,@p8,@p9,GETDATE())", point, number, DateTime.Today, customer, signature, client[0]["nombre"], received, note, oper, company));
                foreach (var value in invoices)
                {
                    var line = Object(value); Execute(c, tx, "INSERT dbo.RecibosXTSFac(IDRecibo,IDFactura,ImpPagado,CuotaPaga) VALUES(@p0,@p1,@p2,0)", receipt, RequiredId(Value(line, "id"), "la factura"), Math.Round(Number(Value(line, "importe")), 2, MidpointRounding.AwayFromZero));
                }
                var usedMovements = new HashSet<int>();
                foreach (var value in payments)
                {
                    var line = Object(value); int kind = RequiredId(Value(line, "tipo"), "el tipo de valor"), card = Convert.ToInt32(Number(Value(line, "tarjeta") ?? 0)), installments = Convert.ToInt32(Number(Value(line, "cuotas") ?? 0)), bank = 0;
                    int movement = Convert.ToInt32(Number(Value(line, "valor") ?? 0)); object movementValue = null;
                    DateTime due; if (!DateTime.TryParseExact(Text(Value(line, "vencimiento")), "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out due)) throw new InvalidOperationException("Fecha de vencimiento inválida.");
                    decimal amount = Math.Round(Number(Value(line, "importe")), 2, MidpointRounding.AwayFromZero);
                    int paymentClass = Convert.ToInt32(Scalar(c, tx, "SELECT IDClasePago FROM dbo.TiposPagos WHERE IDTipoPago=@p0", kind));
                    if (installments < 0 || installments > 120) throw new InvalidOperationException("Cantidad de cuotas inválida.");
                    if (card > 0 && RowsTx(c, tx, "SELECT IDTarjeta FROM dbo.Tarjetas WHERE IDTarjeta=@p0 AND Susp=0", card).Count != 1) throw new InvalidOperationException("Tarjeta inválida.");
                    if (paymentClass == 2 && movement <= 0) throw new InvalidOperationException("Seleccioná el cheque en Valor Nº.");
                    if (movement > 0)
                    {
                        if (!usedMovements.Add(movement)) throw new InvalidOperationException("El mismo valor bancario aparece dos veces en el recibo.");
                        var checks = RowsTx(c, tx, "SELECT Importe,FechaVto,IDBanco FROM dbo.MovCheques WITH(UPDLOCK,HOLDLOCK) WHERE NroMovInt=@p0 AND Confirmado=1 AND Anulado=0", movement);
                        if (checks.Count != 1 || Math.Abs(Number(checks[0]["Importe"]) - amount) > .01m) throw new InvalidOperationException("El valor bancario no existe o su importe no coincide.");
                        bank = Convert.ToInt32(checks[0]["IDBanco"]); due = Convert.ToDateTime(checks[0]["FechaVto"]); movementValue = movement;
                        if (Number(Scalar(c, tx, "SELECT COUNT(*) FROM dbo.RecibosXTS v JOIN dbo.RecibosXTP r ON r.IDRecibo=v.IDRecibo WHERE v.IDMovBco=@p0 AND r.Confirmado=1 AND r.Anulado=0", movement)) > 0) throw new InvalidOperationException("Ese valor bancario ya fue recibido en otro recibo.");
                    }
                    Execute(c, tx, "INSERT dbo.RecibosXTS(IDRecibo,IDTipoPago,Concepto,FechaVto,Importe,Cobrado,IDMovBco,IDTarjeta,IDBanco,Cuotas,PtosDesc) VALUES(@p0,@p1,@p2,@p3,@p4,1,@p5,@p6,@p7,@p8,0)", receipt, kind, Limited(Value(line, "descripcion"), 100, "Descripción"), due, amount, movementValue, card, bank, installments);
                }
                Execute(c, tx, "UPDATE dbo.RecibosXTP SET Confirmado=1 WHERE IDRecibo=@p0", receipt);
                var result = CollectionReceiptResult(c, tx, receipt); tx.Commit(); return result;
            }
            catch { try { tx.Rollback(); } catch { } throw; }
        }
    }


    // Informe por artículo: mantiene el criterio de los informes originales de Access.
    private const string StockArticleMovements =
      "SELECT h.Fecha AS fechaOrden,h.IDSuc AS sucursal,'venta' AS origen,h.IDRecibo AS id,CONVERT(nvarchar(40),h.NroFactura) AS numero,t.IDComprob AS tipo,t.Descripcion AS comprobante,h.ApeYNom AS tercero,ISNULL(CONVERT(nvarchar(80),d.NroSerie),'') AS pieza,SUM(CONVERT(decimal(28,6),d.Cantidad)) AS cantidad,SUM(CONVERT(decimal(28,6),d.Cantidad)*ISNULL(t.StkPor,0)) AS variacion,SUM(CONVERT(decimal(28,6),d.Importe)) AS importe FROM dbo.FacturasATP h JOIN dbo.FacturasATS d ON d.IDRecibo=h.IDRecibo JOIN dbo.TipoComprobantes t ON t.IDComprob=h.IDComprob WHERE d.IDArt=@p0 AND h.Confirmado=-1 AND h.Anulada=0 AND h.ActStock<>0 AND t.IDTipoMovStock>0 GROUP BY h.Fecha,h.IDSuc,h.IDRecibo,h.NroFactura,t.IDComprob,t.Descripcion,h.ApeYNom,d.NroSerie "+
      "UNION ALL SELECT h.Fecha,h.IDSuc,'stock',h.IDRecibo,CONVERT(nvarchar(40),h.NroMov),t.IDComprob,t.Descripcion,COALESCE(p.[RazónSocial],c.[RazónSocial],''),ISNULL(CONVERT(nvarchar(80),d.NroSerie),''),SUM(CONVERT(decimal(28,6),d.Cantidad)),SUM(CONVERT(decimal(28,6),d.Cantidad)*ISNULL(t.StkPor,0)),SUM(CONVERT(decimal(28,6),d.Importe)) FROM dbo.RecibosTP h JOIN dbo.RecibosTS d ON d.IDRecibo=h.IDRecibo JOIN dbo.TipoComprobantes t ON t.IDComprob=h.IDTipoMov LEFT JOIN dbo.Proveedores p ON p.IDProveedor=h.IDProveedor LEFT JOIN dbo.Clientes c ON c.IDCliente=h.IDCliente WHERE d.IDArt=@p0 AND h.Confirmado=1 AND h.Anulado=0 AND t.IDTipoMovStock>0 GROUP BY h.Fecha,h.IDSuc,h.IDRecibo,h.NroMov,t.IDComprob,t.Descripcion,p.[RazónSocial],c.[RazónSocial],d.NroSerie";
    private static string StockReportArticleId(object value)
    {
        string id=Text(value).Trim();if(!System.Text.RegularExpressions.Regex.IsMatch(id,@"^\d{1,6}$"))throw new InvalidOperationException("Elegí un artículo válido.");return id.PadLeft(6,'0');
    }
    private static Dictionary<string,object> StockArticleRecountSnapshot(SqlConnection c,SqlTransaction tx,string id,int branch)
    {
        var article=RowsTx(c,tx,"SELECT IDArt,[Descripción] AS descripcion,EnStock FROM dbo.[Artículos] WITH(UPDLOCK,HOLDLOCK) WHERE IDArt=@p0",id);
        if(article.Count!=1)throw new InvalidOperationException("El artículo no existe.");
        if(StockNumber(article[0]["EnStock"])==0)throw new InvalidOperationException("Este artículo no lleva stock.");
        var current=RowsTx(c,tx,"SELECT s.IDSuc,s.Sucursal,ISNULL(a.StockAct,0) AS actual,a.Ubic FROM dbo.Sucursales s LEFT JOIN dbo.ArtsStock a WITH(UPDLOCK,HOLDLOCK) ON a.IDSuc=s.IDSuc AND a.IDArt=@p0 WHERE (@p1=0 OR s.IDSuc=@p1) ORDER BY s.IDSuc",id,branch);
        if(current.Count==0)throw new InvalidOperationException("Elegí una sucursal válida.");
        var detail=RowsTx(c,tx,"WITH movimientos AS ("+StockArticleMovements+") SELECT * FROM movimientos WHERE (@p1=0 OR sucursal=@p1) ORDER BY fechaOrden,origen,id,pieza,tipo",id,branch);
        foreach(var row in current){decimal sum=0;foreach(var movement in detail)if(Convert.ToInt32(movement["sucursal"])==Convert.ToInt32(row["IDSuc"]))sum+=StockNumber(movement["variacion"]);row["calculado"]=sum;}
        return new Dictionary<string,object>{{"articulo",article[0]},{"sucursales",current},{"movimientos",detail}};
    }
    private static object StockArticleRecalculate(SqlConnection c,Dictionary<string,object> input)
    {
        AssertPurchasePermission(Text(Value(input,"usuarioId")),"historial_movimiento");
        string id=StockReportArticleId(Value(input,"articulo"));int branch=Convert.ToInt32(Value(input,"sucursal"));if(branch<0)throw new InvalidOperationException("Sucursal inválida.");
        if(Text(Value(input,"confirmado"))!="True")throw new InvalidOperationException("Confirmá el recálculo de stock.");
        using(var tx=c.BeginTransaction(IsolationLevel.Serializable)){
            var snapshot=StockArticleRecountSnapshot(c,tx,id,branch);
            if(ProviderVersion(snapshot)!=Text(Value(input,"version")))throw new InvalidOperationException("El artículo o sus movimientos cambiaron. Volvé a consultar el recálculo.");
            Execute(c,tx,"IF OBJECT_ID('dbo.WebStockRecalculos','U') IS NULL CREATE TABLE dbo.WebStockRecalculos(Id uniqueidentifier NOT NULL PRIMARY KEY,IDArt varchar(6) NOT NULL,Usuario nvarchar(150) NOT NULL,FechaUtc datetime2 NOT NULL,Antes nvarchar(max) NOT NULL)");
            foreach(var row in (List<Dictionary<string,object>>)snapshot["sucursales"]){Execute(c,tx,"IF NOT EXISTS(SELECT 1 FROM dbo.ArtsStock WHERE IDArt=@p0 AND IDSuc=@p1) INSERT dbo.ArtsStock(IDArt,IDSuc,StockAct) VALUES(@p0,@p1,0);UPDATE dbo.ArtsStock SET StockAct=@p2 WHERE IDArt=@p0 AND IDSuc=@p1",id,row["IDSuc"],row["calculado"]);}
            Execute(c,tx,"UPDATE dbo.[Artículos] SET StockAct=(SELECT ISNULL(SUM(StockAct),0) FROM dbo.ArtsStock WHERE IDArt=@p0) WHERE IDArt=@p0",id);
            Execute(c,tx,"INSERT dbo.WebStockRecalculos VALUES(@p0,@p1,@p2,SYSUTCDATETIME(),@p3)",Guid.NewGuid(),id,Text(Value(input,"usuarioId")),Json.Serialize(snapshot));
            tx.Commit();return new {ok=true,articulo=id,sucursales=snapshot["sucursales"]};
        }
    }


    private sealed class StockLedgerSnapshot {
        public string Token,User,Article;public int Branch;public DateTime From,To,Created;
        public Dictionary<string,object> CustomerArticle,Company;
        public List<Dictionary<string,object>> Rows,Stocks,Summary,Types;
        public decimal Opening,Closing;public long Movements;
    }
    private static readonly object StockLedgerCacheGate=new object();
    private static readonly Dictionary<string,StockLedgerSnapshot> StockLedgerCache=new Dictionary<string,StockLedgerSnapshot>();
    private static StockLedgerSnapshot StockLedgerCached(HttpListenerRequest request,int offset) {
        string token=Text(request.QueryString["snapshot"]);if(token.Length==0)return null;
        lock(StockLedgerCacheGate){StockLedgerSnapshot snapshot;if(!StockLedgerCache.TryGetValue(token,out snapshot))return null;
            if(snapshot.Created<DateTime.UtcNow.AddMinutes(-10)){StockLedgerCache.Remove(token);return null;}
            if(snapshot.User!=Text(request.QueryString["usuarioId"])||snapshot.Article!=StockReportArticleId(request.QueryString["articulo"])||snapshot.Branch!=Convert.ToInt32(request.QueryString["sucursal"]??"0")||snapshot.From!=PurchaseDate(request.QueryString["desde"],"desde")||snapshot.To!=PurchaseDate(request.QueryString["hasta"],"hasta"))return null;
            return snapshot;
        }
    }
    private static object StockLedgerPage(StockLedgerSnapshot snapshot,HttpListenerRequest request,int offset){
        string types=Text(request.QueryString["tipos"]),sort=Text(request.QueryString["ordenar"]),direction=Text(request.QueryString["direccion"]);
        var selectedTypes=new HashSet<int>();bool restrict=types.Length>0;
        if(types!="ninguno"&&restrict){if(types.Length>1500||!System.Text.RegularExpressions.Regex.IsMatch(types,@"^\d{1,6}(,\d{1,6})*$"))throw new InvalidOperationException("Filtro de movimientos inválido.");foreach(string part in types.Split(','))selectedTypes.Add(Int32.Parse(part));}
        string filtersJson=Text(request.QueryString["filtros"]);if(filtersJson.Length>3000)throw new InvalidOperationException("Los filtros son demasiado largos.");
        var filters=filtersJson.Length==0?new Dictionary<string,object>():Object(Json.DeserializeObject(filtersJson));var active=new Dictionary<string,string>();
        foreach(string key in new[]{"fecha","numero","tercero","sucursalNombre","pieza","maquina","cantidad","saldo"}){string value=Text(Value(filters,key)).Trim();if(value.Length>120)throw new InvalidOperationException("El filtro es demasiado largo.");if(value.Length>0)active[key]=value;}
        if(sort.Length>0&&Array.IndexOf(new[]{"fecha","comprobante","numero","tercero","sucursalNombre","pieza","maquina","cantidad","saldo"},sort)<0)throw new InvalidOperationException("Columna de orden inválida.");
        var culture=CultureInfo.GetCultureInfo("es-AR");var found=new List<Dictionary<string,object>>();
        foreach(var row in snapshot.Rows){if(restrict&&!selectedTypes.Contains(Convert.ToInt32(row["tipo"])))continue;bool matches=true;
            foreach(var filter in active){string value=filter.Key=="cantidad"||filter.Key=="saldo"?StockNumber(row[filter.Key]).ToString("N2",culture):Text(row[filter.Key]);if(culture.CompareInfo.IndexOf(value,filter.Value,CompareOptions.IgnoreCase|CompareOptions.IgnoreNonSpace)<0){matches=false;break;}}
            if(matches)found.Add(row);
        }
        if(sort.Length>0)found.Sort(delegate(Dictionary<string,object> left,Dictionary<string,object> right){int result;
            if(sort=="cantidad"||sort=="saldo"||sort=="maquina")result=StockNumber(left[sort]).CompareTo(StockNumber(right[sort]));
            else result=culture.CompareInfo.Compare(Text(left[sort=="fecha"?"fechaIso":sort]),Text(right[sort=="fecha"?"fechaIso":sort]),CompareOptions.IgnoreCase|CompareOptions.IgnoreNonSpace);
            if(result!=0)return direction=="desc"?-result:result;return Convert.ToInt32(left["indice"]).CompareTo(Convert.ToInt32(right["indice"]));});
        int count=Math.Min(200,Math.Max(0,found.Count-offset));var page=count>0?found.GetRange(offset,count):new List<Dictionary<string,object>>();
        return new {ok=true,bInfo=true,todasSucursales=snapshot.Branch==0,snapshot=snapshot.Token,articulo=snapshot.CustomerArticle,stocks=snapshot.Stocks,registros=page,hayMas=offset+count<found.Count,sucursales=snapshot.Summary,tiposDisponibles=snapshot.Types,totales=new {registros=found.Count,movimientos=snapshot.Movements,cantidad=snapshot.Closing-snapshot.Opening,variacion=snapshot.Closing-snapshot.Opening,importe=0},saldoAnterior=snapshot.Opening,saldoFinal=snapshot.Closing,empresa=snapshot.Company};
    }
    private static object StockArticleBInfo(SqlConnection c,string id,int branch,DateTime from,DateTime to,int offset,Dictionary<string,object> article,List<Dictionary<string,object>> stocks,HttpListenerRequest request)
    {
        // bInfo -> InfMovStockVentas + InfMovStockCompras + Actual + Anterior.
        // Preserve each original detail line and reset the running balance per branch.
        string source="SELECT h.IDSuc AS sucursal,h.Fecha AS fechaOrden,t.Descripcion AS comprobante,CONVERT(nvarchar(40),h.NroFactura) AS numero,h.ApeYNom AS tercero,CONVERT(nvarchar(80),d.NroSerie) AS pieza,CONVERT(decimal(28,6),d.Cantidad)*t.StkPor AS variacion,'venta' AS origen,h.IDRecibo AS id,ISNULL(d.Orden,0) AS orden,t.IDComprob AS tipo,COALESCE(h.FechaYHora,h.Fecha) AS salidaOrden,ISNULL(h.[IDDepósito],0) AS maquina FROM dbo.FacturasATP h JOIN dbo.FacturasATS d ON d.IDRecibo=h.IDRecibo JOIN dbo.TipoComprobantes t ON t.IDComprob=h.IDComprob WHERE d.IDArt=@p0 AND h.Anulada=0 AND h.Confirmado=-1 AND h.ActStock=-1 AND t.IDTipoMovStock>0 "+
          "UNION ALL SELECT h.IDSuc,h.Fecha,t.Descripcion,CONVERT(nvarchar(40),h.NroMov),p.[RazónSocial],CONVERT(nvarchar(80),d.NroSerie),CONVERT(decimal(28,6),d.Cantidad)*t.StkPor,'stock',h.IDRecibo,ISNULL(d.IDOrden,0),t.IDComprob,COALESCE(h.FechaYHora,h.Fecha),ISNULL(h.[IDDepósito],0) FROM dbo.RecibosTP h JOIN dbo.RecibosTS d ON d.IDRecibo=h.IDRecibo JOIN dbo.TipoComprobantes t ON t.IDComprob=h.IDTipoMov LEFT JOIN dbo.Proveedores p ON p.IDProveedor=h.IDProveedor WHERE d.IDArt=@p0 AND h.Anulado=0 AND h.Confirmado=1 AND t.IDTipoMovStock>0";
        string common="WITH base AS ("+source+"),movimientos AS (SELECT b.* FROM base b JOIN dbo.ArtsStock s ON s.IDArt=@p0 AND s.IDSuc=b.sucursal JOIN dbo.Sucursales su ON su.IDSuc=b.sucursal WHERE (@p1=0 OR b.sucursal=@p1) AND b.fechaOrden<@p3),anteriores AS (SELECT sucursal,DATEADD(day,-1,@p2) AS fechaOrden,CONVERT(nvarchar(255),'Stock Anterior') AS comprobante,CONVERT(nvarchar(40),NULL) AS numero,CONVERT(nvarchar(255),NULL) AS tercero,CONVERT(nvarchar(80),NULL) AS pieza,SUM(variacion) AS variacion,'apertura' AS origen,0 AS id,0 AS orden,0 AS tipo,DATEADD(day,-1,@p2) AS salidaOrden,0 AS maquina FROM movimientos WHERE fechaOrden<@p2 GROUP BY sucursal),periodo AS (SELECT * FROM movimientos WHERE fechaOrden>=@p2),lineas AS (SELECT * FROM anteriores UNION ALL SELECT * FROM periodo),saldos AS (SELECT *,SUM(variacion) OVER(PARTITION BY sucursal ORDER BY fechaOrden,salidaOrden,origen,id,orden,pieza ROWS UNBOUNDED PRECEDING) AS saldo FROM lineas) ";
        // Materialize the ledger once; subsequent pages only filter this immutable snapshot.
        var rows=Rows(c,common+"SELECT TOP(100001) sucursal,CONVERT(varchar(10),fechaOrden,103) AS fecha,CONVERT(varchar(10),fechaOrden,23) AS fechaIso,comprobante,numero,tercero,pieza,variacion AS cantidad,variacion,saldo,origen,id,orden,tipo,maquina FROM saldos ORDER BY fechaOrden,salidaOrden,origen,id,orden,pieza,sucursal",id,branch,from,to.AddDays(1));
        if(rows.Count>100000)throw new InvalidOperationException("El informe supera 100.000 filas. Acotá el período de consulta.");
        var snapshot=new StockLedgerSnapshot{Token=Guid.NewGuid().ToString("N"),User=Text(request.QueryString["usuarioId"]),Article=id,Branch=branch,From=from,To=to,Created=DateTime.UtcNow,CustomerArticle=article,Stocks=stocks,Rows=rows,Summary=new List<Dictionary<string,object>>(),Types=new List<Dictionary<string,object>>()};
        var summary=new Dictionary<int,Dictionary<string,object>>();var types=new Dictionary<int,string>();int index=0;
        foreach(var row in rows){row["indice"]=index++;int branchId=Convert.ToInt32(row["sucursal"]);Dictionary<string,object> item;
            if(!summary.TryGetValue(branchId,out item)){var stock=stocks.Find(x=>Convert.ToInt32(x["id"])==branchId);item=new Dictionary<string,object>{{"sucursal",branchId},{"nombre",stock==null?branchId.ToString():stock["sucursal"]},{"stockActual",stock==null?0:stock["stock"]},{"saldoAnterior",0m},{"saldoFinal",0m},{"movimientos",0},{"filas",0}};summary.Add(branchId,item);snapshot.Summary.Add(item);}
            row["sucursalNombre"]=item["nombre"];
            item["filas"]=Convert.ToInt32(item["filas"])+1;item["saldoFinal"]=row["saldo"];
            if(Text(row["origen"])=="apertura"){item["saldoAnterior"]=row["variacion"];snapshot.Opening+=StockNumber(row["variacion"]);}else if(Value(row,"numero")!=null){item["movimientos"]=Convert.ToInt32(item["movimientos"])+1;snapshot.Movements++;}
            types[Convert.ToInt32(row["tipo"])]=Text(row["comprobante"]);
        }
        foreach(var item in snapshot.Summary){snapshot.Closing+=StockNumber(item["saldoFinal"]);item["diferencia"]=StockNumber(item["saldoFinal"])-StockNumber(item["stockActual"]);}
        if(branch==0){
            var openingRows=rows.FindAll(row=>Text(row["origen"])=="apertura");
            if(openingRows.Count>0){var opening=new Dictionary<string,object>(openingRows[0]);opening["sucursal"]=0;opening["sucursalNombre"]="Todas";opening["cantidad"]=snapshot.Opening;opening["variacion"]=snapshot.Opening;opening["saldo"]=snapshot.Opening;opening["maquina"]=0;rows.RemoveAll(row=>Text(row["origen"])=="apertura");rows.Insert(0,opening);}
            decimal running=0;int ordinal=0;foreach(var row in rows){row["saldoSucursal"]=row["saldo"];running+=StockNumber(row["variacion"]);row["saldo"]=running;row["indice"]=ordinal++;}
        }
        foreach(var type in types)snapshot.Types.Add(new Dictionary<string,object>{{"id",type.Key},{"nombre",type.Value}});
        snapshot.Types.Sort((left,right)=>String.Compare(Text(left["nombre"]),Text(right["nombre"]),StringComparison.CurrentCultureIgnoreCase));
        var companies=Rows(c,"SELECT TOP 1 Empresa AS nombre,Actividad AS actividad FROM dbo.Empresa WHERE IDEmpresa=1");snapshot.Company=companies.Count>0?companies[0]:null;
        lock(StockLedgerCacheGate){var expired=new List<string>();int total=0;foreach(var item in StockLedgerCache){if(item.Value.Created<DateTime.UtcNow.AddMinutes(-10))expired.Add(item.Key);else total+=item.Value.Rows.Count;}foreach(string key in expired)StockLedgerCache.Remove(key);
            while(StockLedgerCache.Count>0&&(StockLedgerCache.Count>=8||total+rows.Count>200000)){StockLedgerSnapshot oldest=null;foreach(var candidate in StockLedgerCache.Values)if(oldest==null||candidate.Created<oldest.Created)oldest=candidate;total-=oldest.Rows.Count;StockLedgerCache.Remove(oldest.Token);}
            StockLedgerCache.Add(snapshot.Token,snapshot);
        }
        return StockLedgerPage(snapshot,request,offset);
    }

    private static object StockArticleReport(SqlConnection c,HttpListenerRequest request)
    {
        int cachedOffset;if(!Int32.TryParse(request.QueryString["offset"]??"0",out cachedOffset)||cachedOffset<0||cachedOffset>2000000)throw new InvalidOperationException("Página inválida.");
        if(Text(request.QueryString["informe"])=="historico"){var cached=StockLedgerCached(request,cachedOffset);if(cached!=null)return StockLedgerPage(cached,request,cachedOffset);}
        AssertPurchasePermission(request.QueryString["usuarioId"],"historial_movimiento");
        if(Text(request.QueryString["informe"])=="catalogo")return new {ok=true,sucursales=Rows(c,"SELECT IDSuc AS id,Sucursal AS nombre FROM dbo.Sucursales ORDER BY IDSuc"),articulos=Rows(c,"SELECT IDArt AS idart,IDArtProv AS codProv,[Descripción] AS descripcion FROM dbo.[Artículos] WHERE ISNULL(Suspendido,0)=0 ORDER BY [Descripción]")};
        string id=StockReportArticleId(request.QueryString["articulo"]),mode=Text(request.QueryString["informe"]);int branch=0,type=0,offset=0;
        if(!Int32.TryParse(request.QueryString["sucursal"]??"0",out branch)||branch<0||!Int32.TryParse(request.QueryString["tipo"]??"0",out type)||type<0||!Int32.TryParse(request.QueryString["offset"]??"0",out offset)||offset<0||offset>2000000)throw new InvalidOperationException("Revisá los filtros del informe.");
        if(mode=="recalcular"){
            using(var tx=c.BeginTransaction(IsolationLevel.Serializable)){var snapshot=StockArticleRecountSnapshot(c,tx,id,branch);string version=ProviderVersion(snapshot);tx.Commit();return new {ok=true,articulo=snapshot["articulo"],sucursales=snapshot["sucursales"],version=version};}
        }
        var article=Rows(c,"SELECT a.IDArt AS id,a.IDArtProv AS codigo,a.[Descripción] AS descripcion,a.Suspendido AS suspendido,a.PrecioCpraSI AS costo,a.PrecioCpraCI AS costoIva,a.PrecioVta3 AS minorista,a.PrecioVta2 AS intermedio,a.PrecioVta1 AS mayorista,a.PorcIVA1 AS iva,a.IDMoneda AS moneda,m.Moneda AS monedaNombre FROM dbo.[Artículos] a LEFT JOIN dbo.Monedas m ON m.IDMoneda=a.IDMoneda WHERE a.IDArt=@p0",id);
        if(article.Count!=1)throw new InvalidOperationException("El artículo no existe en SQL.");
        var stocks=Rows(c,ArticuloStockSelect,id);
        if(mode=="ficha")return new {ok=true,articulo=article[0],stocks=stocks,comprobantes=Rows(c,"SELECT IDComprob AS id,Abreviatura AS codigo,Descripcion AS nombre FROM dbo.TipoComprobantes WHERE EnStk<>0 OR EnVtas<>0 OR IDComprob=13 ORDER BY Descripcion")};
        if(Array.IndexOf(new[]{"historico","pieza","ventas","presupuestos","comprobante"},mode)<0)throw new InvalidOperationException("Informe desconocido.");
        DateTime from=PurchaseDate(request.QueryString["desde"],"la fecha desde"),to=PurchaseDate(request.QueryString["hasta"],"la fecha hasta");if(from>to)throw new InvalidOperationException("La fecha desde debe ser anterior a hasta.");
        string piece=Text(request.QueryString["pieza"]).Trim();if(piece.Length>80)throw new InvalidOperationException("El número de pieza es demasiado largo.");if(mode=="pieza"&&piece.Length==0)throw new InvalidOperationException("Ingresá el número de pieza.");if(mode=="comprobante"&&type==0)throw new InvalidOperationException("Elegí un comprobante.");
        if(mode=="historico")return StockArticleBInfo(c,id,branch,from,to,offset,article[0],stocks,request);
        string source=StockArticleMovements;
        if(mode=="ventas"||mode=="presupuestos")source="SELECT h.Fecha AS fechaOrden,h.IDSuc AS sucursal,'venta' AS origen,h.IDRecibo AS id,CONVERT(nvarchar(40),h.NroFactura) AS numero,t.IDComprob AS tipo,t.Descripcion AS comprobante,h.ApeYNom AS tercero,ISNULL(CONVERT(nvarchar(80),d.NroSerie),'') AS pieza,SUM(CONVERT(decimal(28,6),d.Cantidad)) AS cantidad,CAST(0 AS decimal(28,6)) AS variacion,SUM(CONVERT(decimal(28,6),d.Importe)*(1+ISNULL(h.PorcDtoAto,0))) AS importe FROM dbo.FacturasATP h JOIN dbo.FacturasATS d ON d.IDRecibo=h.IDRecibo JOIN dbo.TipoComprobantes t ON t.IDComprob=h.IDComprob WHERE d.IDArt=@p0 AND h.Confirmado=-1 AND h.Anulada=0 "+(mode=="presupuestos"?"AND h.IDComprob=13 AND h.EnInfVtas<>0 ":"AND t.EnVtas<>0 ")+"GROUP BY h.Fecha,h.IDSuc,h.IDRecibo,h.NroFactura,t.IDComprob,t.Descripcion,h.ApeYNom,d.NroSerie";
        string filter="(@p1=0 OR sucursal=@p1) AND (@p4='' OR pieza=@p4) AND (@p5=0 OR tipo=@p5)";
        var args=new object[]{id,branch,from,to.AddDays(1),mode=="pieza"?piece:"",mode=="comprobante"?type:0,offset};
        var totals=Rows(c,"WITH movimientos AS ("+source+") SELECT COUNT_BIG(*) AS registros,ISNULL(SUM(cantidad),0) AS cantidad,ISNULL(SUM(variacion),0) AS variacion,ISNULL(SUM(importe),0) AS importe FROM movimientos WHERE "+filter+" AND fechaOrden>=@p2 AND fechaOrden<@p3",args)[0];
        decimal opening=StockNumber(Scalar(c,null,"WITH movimientos AS ("+source+") SELECT ISNULL(SUM(variacion),0) FROM movimientos WHERE "+filter+" AND fechaOrden<@p2",args));
        var records=Rows(c,"WITH movimientos AS ("+source+"),filtrados AS (SELECT *,@p7+SUM(variacion) OVER(ORDER BY fechaOrden,origen,id,pieza,tipo ROWS UNBOUNDED PRECEDING) AS saldo FROM movimientos WHERE "+filter+" AND fechaOrden>=@p2 AND fechaOrden<@p3) SELECT CONVERT(varchar(10),fechaOrden,103) AS fecha,sucursal,origen,id,numero,tipo,comprobante,tercero,pieza,cantidad,CASE WHEN cantidad=0 THEN 0 ELSE importe/cantidad END AS precioUnitario,importe,variacion,saldo FROM filtrados ORDER BY fechaOrden,origen,id,pieza,tipo OFFSET @p6 ROWS FETCH NEXT 201 ROWS ONLY",id,branch,from,to.AddDays(1),mode=="pieza"?piece:"",mode=="comprobante"?type:0,offset,opening);
        bool more=records.Count>200;if(more)records.RemoveAt(200);
        return new {ok=true,articulo=article[0],stocks=stocks,registros=records,hayMas=more,totales=totals,saldoAnterior=opening,saldoFinal=opening+StockNumber(totals["variacion"])};
    }

    private static object StockConsulta(SqlConnection connection, HttpListenerRequest request)
    {
        int branch = 0, provider = 0, receipt = 0;
        Int32.TryParse(request.QueryString["sucursal"], out branch); Int32.TryParse(request.QueryString["proveedor"], out provider); Int32.TryParse(request.QueryString["recibo"], out receipt);
        string query = request.QueryString["consulta"] ?? "";
        if(query=="informe-articulo")return StockArticleReport(connection,request);
        if(query=="estado-origen"){
            AssertPurchasePermission(request.QueryString["usuarioId"],"carga_stock");
            return StockWebSourceState(connection,request.QueryString["origen"],request.QueryString["origenId"]);
        }
        if (query == "proveedores") return new { ok = true, proveedores = Rows(connection, "SELECT IDProveedor AS id,[RazónSocial] AS nombre FROM dbo.Proveedores WHERE ISNULL(Suspendido,0)=0 ORDER BY [RazónSocial]") };
        if(query=="revision-articulos")return new {ok=true,revision=Text(Scalar(connection,null,"SELECT CONVERT(varchar(30),COUNT_BIG(*))+':'+CONVERT(varchar(30),ISNULL(CHECKSUM_AGG(BINARY_CHECKSUM(IDArt,Suspendido,HoraModif,PrecioCpraSI,PrecioCpraCI,[Descripción],IDArtProv)),0)) FROM dbo.[Artículos]"))};
        if (query == "articulos") return new { ok = true, suspendidos=Rows(connection,"SELECT IDArt AS idart FROM dbo.[Artículos] WHERE Suspendido=1"), articulos = Rows(connection, "SELECT a.IDArt AS idart,a.IDArtProv AS codProv,a.[Descripción] AS descripcion,a.IDProveedor AS proveedor,p.[RazónSocial] AS proveedorNombre,a.IDRubro AS idRubro,r.[Descripción] AS rubroNombre,a.PorcIVA1 AS iva,a.PorcGanMin AS margen,ISNULL(s.StockAct,0) AS stock,a.PrecioCpraSI AS precioCosto,a.IDMoneda AS idMoneda,CASE WHEN a.IDMoneda=1 THEN CONVERT(decimal(18,4),1) ELSE m.ImpCotiz END AS cotizacion,a.PrecioCpraSI * CASE WHEN a.IDMoneda=1 THEN CONVERT(decimal(18,4),1) ELSE m.ImpCotiz END AS costoListaPesos,a.PrecioCpraCI * CASE WHEN a.IDMoneda=1 THEN CONVERT(decimal(18,4),1) ELSE m.ImpCotiz END AS costoFinal FROM dbo.[Artículos] a LEFT JOIN dbo.ArtsStock s ON s.IDArt=a.IDArt AND s.IDSuc=@p0 LEFT JOIN dbo.Monedas m ON m.IDMoneda=a.IDMoneda LEFT JOIN dbo.Proveedores p ON p.IDProveedor=a.IDProveedor LEFT JOIN dbo.Rubros r ON r.IDRubro=a.IDRubro WHERE a.Suspendido=0 ORDER BY a.[Descripción]", branch) };
        if(query=="compras-sin-stock")
        {
            AssertPurchasePermission(request.QueryString["usuarioId"],"carga_stock");
            return new {ok=true,compras=Rows(connection,"SELECT C.IDRecibo AS id,C.NroFactura AS numero,CONVERT(varchar(10),C.Fecha,103) AS fecha,C.Total AS total FROM dbo.ComprasTP C JOIN dbo.TipoComprobantes T ON T.IDComprob=C.IDTipoComp JOIN dbo.RecibosTP R ON R.IDProveedor=C.IDProveedor AND R.IDEmp=C.IDEmp WHERE R.IDRecibo=@p0 AND R.IDSuc=@p1 AND R.IDTipoMov=23 AND R.Confirmado=1 AND R.Anulado=0 AND C.Fecha>=DATEADD(day,-90,GETDATE()) AND C.Confirmado=1 AND C.EnMovStk=1 AND C.IDMovStk IS NULL AND T.ImpPor>0 AND NOT EXISTS(SELECT 1 FROM dbo.RecibosTP S WHERE S.IDFactura=C.IDRecibo AND S.Confirmado=1 AND S.Anulado=0) ORDER BY C.Fecha DESC,C.IDRecibo DESC",receipt,branch)};
        }
        if (query == "compras") return new { ok = true, compras = Rows(connection, "SELECT IDRecibo AS id,NroFactura AS numero,CONVERT(varchar(10),Fecha,103) AS fecha,Total AS total FROM dbo.ComprasTP WHERE IDProveedor=@p0 AND Confirmado=1 AND EnMovStk=1 AND IDMovStk IS NULL ORDER BY Fecha DESC,IDRecibo DESC", provider) };
        if (query == "numeros-movimientos")
        {
            string search = (request.QueryString["buscar"] ?? "").Trim();
            if(search.Length>80)throw new InvalidOperationException("El número buscado es demasiado largo.");
            int movementType;
            if(!Int32.TryParse(request.QueryString["tipo"] ?? "0",out movementType))movementType=0;
            if(movementType<0)throw new InvalidOperationException("Tipo de comprobante inválido.");
            string like = "%" + search.Replace("[", "[[]").Replace("%", "[%]").Replace("_", "[_]") + "%";
            return new {ok=true,numeros=Rows(connection,"SELECT TOP 100 n.numero FROM dbo.RecibosTP r CROSS APPLY (VALUES (r.NroFactura),(r.NroRemito)) n(numero) WHERE r.Confirmado=1 AND r.Anulado=0 AND (@p0=0 OR r.IDProveedor=@p0) AND (@p1=0 OR r.IDTipoMov=@p1) AND NULLIF(LTRIM(RTRIM(n.numero)),'') IS NOT NULL AND n.numero LIKE @p2 GROUP BY n.numero ORDER BY MAX(r.Fecha) DESC,n.numero",provider,movementType,like)};
        }
        if (query == "movimientos")
        {
            int before;
            if(!Int32.TryParse(request.QueryString["antes"]??"0",out before)||before<0)throw new InvalidOperationException("Página de movimientos inválida.");
            string numberFilter = (request.QueryString["buscar"] ?? "").Trim();
            string articleFilter = (request.QueryString["articulo"] ?? "").Trim();
            DateTime from,to;
            if(numberFilter.Length>0 && articleFilter.Length==0) { from=DateTime.Today; to=DateTime.Today; }
            else
            if(!DateTime.TryParseExact(request.QueryString["desde"]??DateTime.Today.ToString("yyyy-MM-dd"),"yyyy-MM-dd",CultureInfo.InvariantCulture,DateTimeStyles.None,out from)||
               !DateTime.TryParseExact(request.QueryString["hasta"]??DateTime.Today.ToString("yyyy-MM-dd"),"yyyy-MM-dd",CultureInfo.InvariantCulture,DateTimeStyles.None,out to)||from>to||to==DateTime.MaxValue.Date)
                throw new InvalidOperationException("Rango de fechas inválido.");
            string typeFilter = (request.QueryString["tipos"] ?? "").Trim();
            if (typeFilter.Length > 500 || (typeFilter.Length > 0 && !System.Text.RegularExpressions.Regex.IsMatch(typeFilter, @"^\d{1,6}(,\d{1,6})*$"))) throw new InvalidOperationException("Filtro de comprobantes inválido.");
            if (typeFilter.Length > 0) typeFilter = "," + typeFilter + ",";
            if (numberFilter.Length > 80) throw new InvalidOperationException("El número buscado es demasiado largo.");
            if (articleFilter.Length > 100) throw new InvalidOperationException("La búsqueda de artículos es demasiado larga.");
            string numberLike = "%" + numberFilter.Replace("[", "[[]").Replace("%", "[%]").Replace("_", "[_]") + "%";
            string articleLike = "%" + articleFilter.Replace("[", "[[]").Replace("%", "[%]").Replace("_", "[_]") + "%";
            var filterArgs=new List<object>{branch,before,from,to.AddDays(1),provider,typeFilter,numberFilter,numberLike,articleFilter,articleLike};
            string articleMatches="d.IDArt=@p8 OR (TRY_CONVERT(int,@p8) IS NOT NULL AND d.IDArt=RIGHT('000000'+@p8,6)) OR d.IDArt LIKE @p9 OR a.IDArtProv COLLATE Latin1_General_CI_AI LIKE @p9 OR a.[Descripción] COLLATE Latin1_General_CI_AI LIKE @p9";
            var words=new List<string>();
            foreach(System.Text.RegularExpressions.Match match in System.Text.RegularExpressions.Regex.Matches(articleFilter,@"[\p{L}\p{N}]+"))
            {
                if(words.Count==12)throw new InvalidOperationException("Usá hasta 12 palabras para buscar el artículo.");
                words.Add(match.Value);
            }
            if(words.Count>0)
            {
                var everyWord=new List<string>();
                foreach(string word in words)
                {
                    string parameter="@p"+filterArgs.Count;
                    filterArgs.Add("%"+word.Replace("[","[[]").Replace("%","[%]").Replace("_","[_]")+"%");
                    everyWord.Add("(d.IDArt LIKE "+parameter+" OR a.IDArtProv COLLATE Latin1_General_CI_AI LIKE "+parameter+" OR a.[Descripción] COLLATE Latin1_General_CI_AI LIKE "+parameter+")");
                }
                articleMatches+=" OR ("+String.Join(" AND ",everyWord.ToArray())+")";
            }
            string filtersSql="(@p0=0 OR r.IDSuc=@p0) AND r.Confirmado=1 AND r.Anulado=0 AND ((@p6<>'' AND @p8='') OR (r.Fecha>=@p2 AND r.Fecha<@p3)) AND (@p4=0 OR r.IDProveedor=@p4) AND (@p5='' OR CHARINDEX(','+CONVERT(varchar(12),r.IDTipoMov)+',',@p5)>0) AND (@p6='' OR r.NroFactura LIKE @p7 OR COALESCE(NULLIF(LTRIM(RTRIM(r.NroRemito)),''),CASE WHEN r.IDTipoMov=58 THEN (SELECT s.NroRemito FROM dbo.RecibosTP s WHERE s.IDRecibo=r.IDRecDes AND s.IDTipoMov=57) END) LIKE @p7) AND (@p8='' OR EXISTS (SELECT 1 FROM dbo.RecibosTS d INNER JOIN dbo.[Artículos] a ON a.IDArt=d.IDArt WHERE d.IDRecibo=r.IDRecibo AND ("+articleMatches+")))";
            var records=Rows(connection,"SELECT TOP 201 r.IDRecibo AS id,r.NroMov AS numero,r.IDSuc AS sucursal,r.IDTipoMov AS tipo,r.IDProveedor AS proveedor,r.IDDepósito AS puntoVenta,r.IDVend AS vendedor,r.IDOper AS operador,r.Anulado AS anulado,r.IDDepDes AS destino,r.IDFactura AS compra,r.IDRemito AS relacionado,r.NroFactura AS factura,COALESCE(NULLIF(LTRIM(RTRIM(r.NroRemito)),''),CASE WHEN r.IDTipoMov=58 THEN (SELECT s.NroRemito FROM dbo.RecibosTP s WHERE s.IDRecibo=r.IDRecDes AND s.IDTipoMov=57) END) AS remito,CONVERT(varchar(10),r.Fecha,103) AS fecha,t.Descripcion AS nombre,p.[RazónSocial] AS proveedorNombre,r.Total AS total,r.Nota AS nota FROM dbo.RecibosTP r LEFT JOIN dbo.TipoComprobantes t ON t.IDComprob=r.IDTipoMov LEFT JOIN dbo.Proveedores p ON p.IDProveedor=r.IDProveedor WHERE "+filtersSql+" AND (@p1=0 OR r.IDRecibo<@p1) ORDER BY r.IDRecibo DESC",filterArgs.ToArray());
            bool more=records.Count>200;if(more)records.RemoveAt(200);
            int count=Convert.ToInt32(Scalar(connection,null,"SELECT COUNT(*) FROM dbo.RecibosTP r WHERE "+filtersSql,filterArgs.ToArray()));
            return new {ok=true,movimientos=records,hayMas=more,total=count};
        }
        if (query == "detalle") return new { ok = true, articulos = Rows(connection, "SELECT d.IDArt AS idart,a.IDArtProv AS codigo,a.[Descripción] AS descripcion,d.Cantidad AS cantidad,d.PrecioUni AS precioUnitario,d.Importe AS importe,ISNULL(s.StockAct,0) AS stock FROM dbo.RecibosTS d INNER JOIN dbo.RecibosTP r ON r.IDRecibo=d.IDRecibo INNER JOIN dbo.[Artículos] a ON a.IDArt=d.IDArt LEFT JOIN dbo.ArtsStock s ON s.IDArt=d.IDArt AND s.IDSuc=r.IDSuc WHERE d.IDRecibo=@p0 AND r.IDSuc=@p1 AND r.Confirmado=1 AND r.Anulado=0 ORDER BY d.IDOrden", receipt, branch) };
        if (query == "relacionados") return new { ok = true, relacionados = Rows(connection, "SELECT TOP 200 r.IDRecibo AS id,r.NroMov AS numero,t.Abreviatura AS tipo,CONVERT(varchar(10),r.Fecha,103) AS fecha FROM dbo.RecibosTP r INNER JOIN dbo.TipoComprobantes t ON t.IDComprob=r.IDTipoMov WHERE r.IDSuc=@p0 AND r.Confirmado=1 AND r.Anulado=0 AND r.Completo=0 AND r.Fecha>=DATEADD(day,-30,GETDATE()) ORDER BY r.IDRecibo DESC", branch) };
        if (query == "pendientes") return new { ok = true, articulos = Rows(connection, "SELECT d.IDArt AS idart,a.IDArtProv AS codigo,a.[Descripción] AS descripcion,SUM(d.Cantidad)-ISNULL((SELECT SUM(e.Cantidad) FROM dbo.RecibosTS e INNER JOIN dbo.RecibosTP h ON h.IDRecibo=e.IDRecibo WHERE h.IDRemito=@p0 AND h.Confirmado=1 AND h.Anulado=0 AND e.IDArt=d.IDArt),0) AS cantidad,MAX(d.PrecioUni) AS precioUnitario FROM dbo.RecibosTS d INNER JOIN dbo.RecibosTP r ON r.IDRecibo=d.IDRecibo INNER JOIN dbo.[Artículos] a ON a.IDArt=d.IDArt WHERE d.IDRecibo=@p0 AND r.IDSuc=@p1 AND r.Confirmado=1 AND r.Anulado=0 GROUP BY d.IDArt,a.IDArtProv,a.[Descripción] HAVING SUM(d.Cantidad)>ISNULL((SELECT SUM(e.Cantidad) FROM dbo.RecibosTS e INNER JOIN dbo.RecibosTP h ON h.IDRecibo=e.IDRecibo WHERE h.IDRemito=@p0 AND h.Confirmado=1 AND h.Anulado=0 AND e.IDArt=d.IDArt),0)", receipt, branch) };
        int oper = UserOperator(connection, request.QueryString["usuarioId"]);
        return new { ok = true, proveedorTransferencia = query=="transferencia-presupuesto"?StockBudgetTransferProvider(connection):0, operador = Rows(connection, "SELECT IDEmpleado AS id,Nombre AS nombre FROM dbo.Empleados WHERE IDEmpleado=@p0", oper),
            sucursales = Rows(connection, "SELECT IDSuc AS id,Sucursal AS nombre FROM dbo.Sucursales ORDER BY IDSuc"),
            puntosVenta = Rows(connection, "SELECT IDDepósito AS id,[Descripción] AS nombre,IDSucAsoc AS idSucursal FROM dbo.[Depósitos] ORDER BY IDDepósito"),
            tiposMovimiento = Rows(connection, "SELECT IDComprob AS id,Abreviatura AS codigo,Descripcion AS nombre,IDTipoMovStock AS stock,StkPor AS signo FROM dbo.TipoComprobantes WHERE EnStk=1 AND ISNULL(GenNS,0)=0 AND ISNULL(ConReceta,0)=0 ORDER BY Abreviatura") };
    }

    private static void Reply(HttpListenerContext context, int status, object data)
    {
        byte[] bytes = Encoding.UTF8.GetBytes(Json.Serialize(data));
        context.Response.StatusCode = status;
        context.Response.ContentType = "application/json; charset=utf-8";
        context.Response.Headers["Cache-Control"] = "no-store";
        string origin = context.Request.Headers["Origin"];
        if (Array.IndexOf(Origins, origin) >= 0) context.Response.Headers["Access-Control-Allow-Origin"] = origin;
        context.Response.ContentLength64 = bytes.Length;
        context.Response.OutputStream.Write(bytes, 0, bytes.Length);
        context.Response.Close();
    }
    private static readonly object ReviewGate = new object();
    private static Timer ReviewNotifyTimer;
    private static string ReviewPath(Guid id)
    {
        return Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "venta-revision-" + id.ToString("N") + ".bin");
    }
    private static Dictionary<string, object> ReadReview(string path)
    {
        return Object(Json.DeserializeObject(Encoding.UTF8.GetString(ProtectedData.Unprotect(File.ReadAllBytes(path), null, DataProtectionScope.CurrentUser))));
    }
    private static void WriteReview(string path, object data)
    {
        byte[] bytes = ProtectedData.Protect(Encoding.UTF8.GetBytes(Json.Serialize(data)), null, DataProtectionScope.CurrentUser);
        string temp = path + ".tmp";
        using (var file = new FileStream(temp, FileMode.Create, FileAccess.Write, FileShare.None)) { file.Write(bytes, 0, bytes.Length); file.Flush(true); }
        if (File.Exists(path)) File.Replace(temp, path, null); else File.Move(temp, path);
    }
    private static void NotifyReviews()
    {
        if (!Monitor.TryEnter(ReviewGate)) return;
        try
        {
            foreach (string path in Directory.GetFiles(AppDomain.CurrentDomain.BaseDirectory, "venta-revision-*.bin"))
            {
                try
                {
                    var review = ReadReview(path);
                    if (Text(Value(review, "notificado")) == "True") continue;
                    var sale = Object(Value(review, "comprobante"));
                    var fields = new Dictionary<string, object>();
                    foreach (var pair in new Dictionary<string, object> {
                        {"idRevision",Value(review,"id")},{"borradorId",Value(sale,"id")},{"destinatario","administradores"},{"estado",Text(Value(review,"estado"))==""?"pendiente":Value(review,"estado")},
                        {"cliente",Value(Object(Value(sale,"cliente")),"nombre")},{"total",Value(Object(Value(sale,"totales")),"total")},
                        {"usuario",Value(sale,"usuario")},{"fecha",Value(sale,"fecha")},{"motivo",Value(review,"motivo")},
                        {"creadoAt",Value(review,"creadoAt")},{"url",Value(review,"url")},{"resolucion",Json.Serialize(Value(review,"resolucion"))}
                    }) fields[pair.Key] = new { stringValue = Text(pair.Value) };
                    string url = "https://firestore.googleapis.com/v1/projects/corralon-progreso/databases/(default)/documents/facturacionRevisiones/" + Text(Value(review,"id")) + (Text(Value(review,"estado"))==""?"?currentDocument.exists=false&":"?updateMask.fieldPaths=estado&updateMask.fieldPaths=resolucion&") + "key=AIzaSyCxwUGX-rVusOI13j7oTfQuAtkeNXdAYH0";
                    var request = (HttpWebRequest)WebRequest.Create(url);
                    request.Method="PATCH";request.ContentType="application/json";request.Timeout=8000;
                    byte[] body=Encoding.UTF8.GetBytes(Json.Serialize(new { fields }));request.ContentLength=body.Length;
                    bool sent=false;
                    try { using(var stream=request.GetRequestStream())stream.Write(body,0,body.Length);using(var response=request.GetResponse())sent=true; }
                    catch(WebException ex) { var response=ex.Response as HttpWebResponse; if(response!=null && (int)response.StatusCode==409)sent=true; else throw; if(response!=null)response.Close(); }
                    if(sent){review["notificado"]=true;WriteReview(path,review);}
                }
                catch (Exception ex) { Console.Error.WriteLine("Revisión pendiente de notificar: " + ex.Message); }
            }
        }
        finally { Monitor.Exit(ReviewGate); }
    }


    private sealed class SupplierPaymentRejected : InvalidOperationException { public SupplierPaymentRejected(string message):base(message){} }
    private static DateTime SupplierPaymentDate(object value,string label){DateTime result;if(!DateTime.TryParseExact(Text(value),"yyyy-MM-dd",CultureInfo.InvariantCulture,DateTimeStyles.None,out result)||result.Year<1753||result.Year>9998)throw new InvalidOperationException("Ingresá una fecha válida para "+label+".");return result;}
    private static List<Dictionary<string,object>> SupplierOpenInvoices(SqlConnection c,int provider){return Rows(c,
        "WITH paid AS(SELECT f.IDFactura,SUM(f.Importe) AS importe FROM dbo.OrdPagosTSFac f JOIN dbo.OrdPagosTP o ON o.NroOrden=f.NroOrden WHERE o.Confirmado=1 AND o.Anulado=0 GROUP BY f.IDFactura) SELECT p.IDRecibo AS id,p.NroFactura AS numero,CONVERT(varchar(10),p.Fecha,23) AS fecha,CONVERT(varchar(10),p.FechaVto,23) AS vence,t.Abreviatura AS tipo,p.Total AS total,ISNULL(paid.importe,0) AS pagado,p.Total-ISNULL(paid.importe,0) AS saldo,p.IDEmp AS empresa,CONVERT(nvarchar(max),p.Nota) AS nota FROM dbo.ComprasTP p JOIN dbo.TipoComprobantes t ON t.IDComprob=p.IDTipoComp LEFT JOIN paid ON paid.IDFactura=p.IDRecibo WHERE p.IDProveedor=@p0 AND p.Confirmado=1 AND ABS(p.Total-ISNULL(paid.importe,0))>=.01 ORDER BY p.Fecha,p.NroFactura,p.IDRecibo",provider);}
    private static string SupplierPaymentVersion(SqlConnection c,SqlTransaction tx,int id){
        var data=new {cabecera=RowsTx(c,tx,"SELECT * FROM dbo.OrdPagosTP WITH(UPDLOCK,HOLDLOCK) WHERE NroOrden=@p0",id),facturas=RowsTx(c,tx,"SELECT * FROM dbo.OrdPagosTSFac WITH(UPDLOCK,HOLDLOCK) WHERE NroOrden=@p0 ORDER BY IDFactura",id),valores=RowsTx(c,tx,"SELECT * FROM dbo.OrdPagosTSPag WITH(UPDLOCK,HOLDLOCK) WHERE NroOrden=@p0 ORDER BY IDOrden",id)};
        using(var sha=SHA256.Create())return BitConverter.ToString(sha.ComputeHash(Encoding.UTF8.GetBytes(Json.Serialize(data)))).Replace("-","");
    }
    private static object SupplierPaymentRead(SqlConnection c,int id){using(var tx=c.BeginTransaction(IsolationLevel.Serializable)){
        var rows=RowsTx(c,tx,"SELECT o.NroOrden AS id,o.NroOP AS numero,o.IDTipoComp AS tipo,o.IDProveedor AS proveedor,p.[RazónSocial] AS nombre,CONVERT(varchar(10),o.Fecha,23) AS fecha,o.TotalCpras AS total,o.TotalPagos AS pagado,o.ImpRetPerc AS retencion,CONVERT(nvarchar(max),o.Nota) AS nota,o.Confirmado AS confirmado,o.Anulado AS anulado,o.IDDepósito AS punto,o.IDEmp AS empresa,o.IDOper AS operador,o.SonPesos AS letras,CONVERT(varchar(19),o.FechaCarga,126) AS fechaCarga FROM dbo.OrdPagosTP o JOIN dbo.Proveedores p ON p.IDProveedor=o.IDProveedor WHERE o.NroOrden=@p0",id);
        if(rows.Count!=1)throw new InvalidOperationException("La orden de pago no existe.");
        var answer=new {ok=true,empresa=RowsTx(c,tx,"SELECT Empresa AS nombre,Actividad AS actividad FROM dbo.Empresa WHERE IDEmpresa=@p0",rows[0]["empresa"]),version=SupplierPaymentVersion(c,tx,id),orden=rows[0],facturas=RowsTx(c,tx,"SELECT f.IDFactura AS id,c.NroFactura AS numero,f.Importe AS importe,CONVERT(varchar(10),c.Fecha,23) AS fecha,CONVERT(varchar(10),c.FechaVto,23) AS vence,t.Abreviatura AS tipo,c.Total AS total,c.Total-ISNULL((SELECT SUM(pf.Importe) FROM dbo.OrdPagosTSFac pf JOIN dbo.OrdPagosTP po ON po.NroOrden=pf.NroOrden WHERE pf.IDFactura=c.IDRecibo AND po.Confirmado=1 AND po.Anulado=0),0) AS saldo,c.IDEmp AS empresa,CONVERT(nvarchar(max),c.Nota) AS nota FROM dbo.OrdPagosTSFac f JOIN dbo.ComprasTP c ON c.IDRecibo=f.IDFactura JOIN dbo.TipoComprobantes t ON t.IDComprob=c.IDTipoComp WHERE f.NroOrden=@p0 ORDER BY c.Fecha,c.IDRecibo",id),valores=RowsTx(c,tx,"SELECT v.IDOrden AS id,v.IDTipoPago AS tipo,t.TipoPago AS nombre,v.IDMovBco AS valor,v.NroCompPago AS documento,CONVERT(varchar(10),v.FechaVto,23) AS vence,v.Importe AS importe,v.IDBanco AS banco,b.Banco AS nombreBanco FROM dbo.OrdPagosTSPag v JOIN dbo.TiposPagos t ON t.IDTipoPago=v.IDTipoPago LEFT JOIN dbo.Bancos b ON b.IDBanco=v.IDBanco WHERE v.NroOrden=@p0 ORDER BY v.IDOrden",id)};tx.Commit();return answer;
    }}
    private static object SupplierPaymentGet(SqlConnection c,HttpListenerRequest request){
        string q=request.QueryString["consulta"]??"bootstrap";int provider=0;Int32.TryParse(request.QueryString["proveedor"],out provider);
        if(q=="bootstrap")return new {ok=true,proveedores=Rows(c,"SELECT IDProveedor AS id,[RazónSocial] AS nombre,SaldoIni AS saldoInicial,IDTipoProv AS clase FROM dbo.Proveedores WHERE ISNULL(Suspendido,0)=0 ORDER BY [RazónSocial]"),comprobantes=Rows(c,"SELECT IDComprob AS id,Abreviatura AS nombre,Descripcion AS descripcion FROM dbo.TipoComprobantes WHERE EnOP=1 ORDER BY IDComprob"),puntos=Rows(c,"SELECT [IDDepósito] AS id,Descripción AS nombre,IDEmp AS empresa,IDSucAsoc AS sucursal FROM dbo.[Depósitos] ORDER BY [IDDepósito]"),tipos=Rows(c,"SELECT IDTipoPago AS id,TipoPago AS nombre,Efectivo AS efectivo,IDClasePago AS clase FROM dbo.TiposPagos ORDER BY TipoPago"),bancos=Rows(c,"SELECT IDBanco AS id,Banco AS nombre FROM dbo.Bancos ORDER BY Banco"),cuentas=Rows(c,"SELECT IDCtaBanco AS id,Banco AS nombre,IDBanco AS banco,Titular AS titular,IDEmp AS empresa FROM dbo.CtasBancos ORDER BY Banco"),tiposValor=Rows(c,"SELECT IDTipoValor AS id,TipoValor AS nombre FROM dbo.TiposValores ORDER BY TipoValor")};
        if(q=="facturas"){if(provider<1)throw new InvalidOperationException("Seleccioná un proveedor.");return new {ok=true,facturas=SupplierOpenInvoices(c,provider)};}
        if(q=="valores"){int type=Id(request.QueryString["tipo"]),point=Id(request.QueryString["punto"]);return new {ok=true,valores=Rows(c,"SELECT m.NroMovInt AS id,m.NroMovExt AS documento,CONVERT(varchar(10),m.FechaValor,23) AS fecha,CONVERT(varchar(10),m.FechaVto,23) AS vence,m.Importe AS importe,m.IDBanco AS banco,b.Banco AS nombreBanco,m.Titular AS titular,m.IDOrigen AS origen,m.IDCtaBanco AS cuenta,m.IDTipoValor AS tipoValor,m.IDEstado AS estado FROM dbo.MovCheques m JOIN dbo.Bancos b ON b.IDBanco=m.IDBanco JOIN dbo.[Depósitos] d ON d.[IDDepósito]=@p0 AND d.IDEmp=m.IDEmp WHERE m.Confirmado=1 AND m.Anulado=0 AND ((@p1=4 AND m.IDOrigen=1 AND m.IDEstado=3) OR (@p1<>4 AND m.IDOrigen=2 AND m.IDEstado IN(1,2,3))) AND NOT EXISTS(SELECT 1 FROM dbo.OrdPagosTSPag v JOIN dbo.OrdPagosTP o ON o.NroOrden=v.NroOrden WHERE v.IDMovBco=m.NroMovInt AND o.Confirmado=1 AND o.Anulado=0) ORDER BY m.FechaVto,m.NroMovExt",point,type)};}
        if(q=="valor"){int id=Id(request.QueryString["id"]);var data=Rows(c,"SELECT m.NroMovInt AS id,m.NroMovVal AS numero,m.NroMovExt AS documento,CONVERT(varchar(10),m.FechaValor,23) AS fecha,CONVERT(varchar(10),m.FechaVto,23) AS vence,m.Importe AS importe,m.IDBanco AS banco,b.Banco AS nombreBanco,m.Titular AS titular,m.EntregadoA AS entregado,m.RecibidoDe AS recibido,m.IDOrigen AS origen,m.IDEstado AS estado,m.IDTipoValor AS tipoValor,m.Nota AS nota,m.Anulado AS anulado,m.Confirmado AS confirmado,m.IDCtaBanco AS cuenta FROM dbo.MovCheques m LEFT JOIN dbo.Bancos b ON b.IDBanco=m.IDBanco WHERE m.NroMovInt=@p0",id);if(data.Count!=1)throw new InvalidOperationException("No se encontró el valor.");return new {ok=true,valor=data[0]};}
        if(q=="orden")return SupplierPaymentRead(c,Id(request.QueryString["id"]));
        if(q=="buscar"){
            DateTime from=SupplierPaymentDate(request.QueryString["desde"],"Desde"),to=SupplierPaymentDate(request.QueryString["hasta"],"Hasta");if(from>to)throw new InvalidOperationException("Revisá el rango de fechas.");int page=0;Int32.TryParse(request.QueryString["pagina"],out page);if(page<0||page>100000)throw new InvalidOperationException("Página inválida.");string filter=Limited(request.QueryString["buscar"],80,"Búsqueda");
            var rows=Rows(c,"SELECT o.NroOrden AS id,o.NroOP AS numero,CONVERT(varchar(10),o.Fecha,23) AS fecha,p.[RazónSocial] AS proveedor,o.TotalPagos AS total,o.Anulado AS anulado,o.IDDepósito AS punto,COUNT_BIG(*) OVER() AS registros FROM dbo.OrdPagosTP o JOIN dbo.Proveedores p ON p.IDProveedor=o.IDProveedor WHERE o.Confirmado=1 AND (@p0=0 OR o.IDProveedor=@p0) AND o.Fecha>=@p1 AND o.Fecha<@p2 AND (@p3='' OR CONVERT(varchar(20),o.NroOP)=@p3 OR CONVERT(varchar(20),o.NroOrden)=@p3 OR p.[RazónSocial] LIKE @p4) ORDER BY o.Fecha DESC,o.NroOrden DESC OFFSET @p5 ROWS FETCH NEXT 51 ROWS ONLY",provider,from,to.AddDays(1),filter,"%"+filter+"%",page*50);bool more=rows.Count>50;if(more)rows.RemoveAt(50);return new {ok=true,ordenes=rows,pagina=page,hayMas=more};
        }
        if(q=="cuentas"){
            if(provider<1)return new {ok=true,saldos=Rows(c,"WITH pag AS(SELECT f.IDFactura,SUM(f.Importe) AS pagado FROM dbo.OrdPagosTSFac f JOIN dbo.OrdPagosTP o ON o.NroOrden=f.NroOrden WHERE o.Confirmado=1 AND o.Anulado=0 GROUP BY f.IDFactura) SELECT p.IDProveedor AS id,p.[RazónSocial] AS proveedor,p.SaldoIni+ISNULL(SUM(c.Total-ISNULL(pag.pagado,0)),0) AS saldo FROM dbo.Proveedores p LEFT JOIN dbo.ComprasTP c ON c.IDProveedor=p.IDProveedor AND c.Confirmado=1 LEFT JOIN pag ON pag.IDFactura=c.IDRecibo GROUP BY p.IDProveedor,p.[RazónSocial],p.SaldoIni ORDER BY p.[RazónSocial]")};
            return new {ok=true,movimientos=Rows(c,"WITH m AS(SELECT p.Fecha,p.IDRecibo AS id,t.Abreviatura AS tipo,p.NroFactura AS numero,p.Total AS debe,CONVERT(money,0) AS haber,0 AS orden FROM dbo.ComprasTP p JOIN dbo.TipoComprobantes t ON t.IDComprob=p.IDTipoComp WHERE p.IDProveedor=@p0 AND p.Confirmado=1 UNION ALL SELECT o.Fecha,o.NroOrden,'OP',CONVERT(varchar(20),o.NroOP),0,ISNULL((SELECT SUM(Importe) FROM dbo.OrdPagosTSFac WHERE NroOrden=o.NroOrden),0),1 FROM dbo.OrdPagosTP o WHERE o.IDProveedor=@p0 AND o.Confirmado=1 AND o.Anulado=0) SELECT CONVERT(varchar(10),Fecha,23) AS fecha,id,tipo,numero,debe,haber,SUM(debe-haber) OVER(ORDER BY Fecha,id,orden ROWS UNBOUNDED PRECEDING)+(SELECT SaldoIni FROM dbo.Proveedores WHERE IDProveedor=@p0) AS saldo FROM m ORDER BY Fecha,id,orden",provider)};
        }
        if(q=="factura"){int id=Id(request.QueryString["id"]);var rows=Rows(c,"SELECT c.IDRecibo AS id,c.NroFactura AS numero,c.Proveedor AS proveedor,CONVERT(varchar(10),c.Fecha,23) AS fecha,CONVERT(varchar(10),c.FechaVto,23) AS vence,c.Total AS total,c.CUIT AS documento,c.Concepto AS concepto,CONVERT(nvarchar(max),c.Nota) AS nota,t.Descripcion AS tipo FROM dbo.ComprasTP c JOIN dbo.TipoComprobantes t ON t.IDComprob=c.IDTipoComp WHERE c.IDRecibo=@p0",id);if(rows.Count!=1)throw new InvalidOperationException("La factura no existe.");return new {ok=true,factura=rows[0],impuestos=Rows(c,"SELECT d.[Descripción] AS descripcion,d.Importe AS importe,d.PorcImp AS porcentaje,d.NroNeto AS neto FROM dbo.ComprasTS d WHERE d.IDRecibo=@p0",id),pagos=Rows(c,"SELECT o.NroOrden AS id,o.NroOP AS numero,CONVERT(varchar(10),o.Fecha,23) AS fecha,f.Importe AS importe FROM dbo.OrdPagosTSFac f JOIN dbo.OrdPagosTP o ON o.NroOrden=f.NroOrden WHERE f.IDFactura=@p0 AND o.Confirmado=1 AND o.Anulado=0 ORDER BY o.Fecha,o.NroOrden",id)};}
        throw new InvalidOperationException("Consulta de pagos desconocida.");
    }

    private static string SupplierAmountWords(long value){
        string[] small={"CERO","UNO","DOS","TRES","CUATRO","CINCO","SEIS","SIETE","OCHO","NUEVE","DIEZ","ONCE","DOCE","TRECE","CATORCE","QUINCE","DIECISEIS","DIECISIETE","DIECIOCHO","DIECINUEVE","VEINTE","VEINTIUNO","VEINTIDOS","VEINTITRES","VEINTICUATRO","VEINTICINCO","VEINTISEIS","VEINTISIETE","VEINTIOCHO","VEINTINUEVE"};
        if(value<30)return small[value];if(value<100){string[] tens={"","","","TREINTA","CUARENTA","CINCUENTA","SESENTA","SETENTA","OCHENTA","NOVENTA"};return tens[value/10]+(value%10==0?"":" Y "+small[value%10]);}
        if(value==100)return "CIEN";if(value<1000){string[] hundreds={"","CIENTO","DOSCIENTOS","TRESCIENTOS","CUATROCIENTOS","QUINIENTOS","SEISCIENTOS","SETECIENTOS","OCHOCIENTOS","NOVECIENTOS"};return hundreds[value/100]+(value%100==0?"":" "+SupplierAmountWords(value%100));}
        if(value<1000000)return (value/1000==1?"MIL":SupplierAmountWords(value/1000).Replace("UNO","UN")+" MIL")+(value%1000==0?"":" "+SupplierAmountWords(value%1000));
        return (value/1000000==1?"UN MILLON":SupplierAmountWords(value/1000000).Replace("UNO","UN")+" MILLONES")+(value%1000000==0?"":" "+SupplierAmountWords(value%1000000));
    }
    private static string SupplierPaymentWords(decimal amount){amount=PurchaseMoney(amount);if(amount<0||amount>999999999999.99m)throw new InvalidOperationException("El importe del pago está fuera del rango admitido.");return SupplierAmountWords((long)amount).Replace("UNO","UN")+" PESOS CON "+((int)((amount-Math.Truncate(amount))*100)).ToString("00")+"/100";}

    private static void SupplierValidateAmount(decimal amount,decimal balance){
        if(amount==0||balance==0||Math.Sign(amount)!=Math.Sign(balance)||Math.Abs(amount)>Math.Abs(balance)+.001m)throw new InvalidOperationException("El importe aplicado excede el saldo pendiente o tiene un signo incorrecto. Actualizá las facturas.");
    }
    private static object SupplierPaymentAnnul(SqlConnection c,Dictionary<string,object> input,bool dryRun){
        AssertPurchasePermission(Text(Value(input,"usuarioId")),"pagos_proveedores",false,false,true);int id=RequiredId(Value(input,"id"),"la orden");int oper=UserOperator(c,Text(Value(input,"usuarioId")));
        using(var tx=c.BeginTransaction(IsolationLevel.Serializable)){try{
            if(Convert.ToInt32(Scalar(c,tx,"DECLARE @r int; EXEC @r=sp_getapplock @Resource='CorralonWeb.PagosProveedores',@LockMode='Exclusive',@LockOwner='Transaction',@LockTimeout=12000;SELECT @r"))<0)throw new InvalidOperationException("Otro usuario está modificando pagos. Reintentá.");
            var found=RowsTx(c,tx,"SELECT * FROM dbo.OrdPagosTP WITH(UPDLOCK,HOLDLOCK) WHERE NroOrden=@p0",id);if(found.Count!=1)throw new InvalidOperationException("La orden ya no existe.");var p=found[0];
            if(Convert.ToBoolean(p["Anulado"])){tx.Rollback();return new {ok=true,id,anulado=true};}
            if(!Convert.ToBoolean(p["Confirmado"]))throw new InvalidOperationException("La orden no está confirmada.");
            if(Text(Value(input,"versionOrden"))!=SupplierPaymentVersion(c,tx,id))throw new InvalidOperationException("La orden cambió. Volvé a consultar antes de anular.");
            if(InvoiceValueNumber(p["IDCaja"])>0||InvoiceValueNumber(p["IDAsiento"])>0)throw new InvalidOperationException("La orden está vinculada a una caja o asiento. Revisá esa vinculación antes de anular.");
            var values=RowsTx(c,tx,"SELECT * FROM dbo.OrdPagosTSPag WITH(UPDLOCK,HOLDLOCK) WHERE NroOrden=@p0 ORDER BY IDOrden",id);string archived=Json.Serialize(new {cabecera=p,facturas=RowsTx(c,tx,"SELECT * FROM dbo.OrdPagosTSFac WHERE NroOrden=@p0",id),valores=values});
            foreach(var v in values){int cheque=Convert.ToInt32(InvoiceValueNumber(v["IDMovBco"]));if(cheque<1)continue;var ch=RowsTx(c,tx,"SELECT IDEstado,Conciliado,Anulado FROM dbo.MovCheques WITH(UPDLOCK,HOLDLOCK) WHERE NroMovInt=@p0",cheque);if(ch.Count!=1||Convert.ToInt32(ch[0]["IDEstado"])!=4||Convert.ToBoolean(ch[0]["Conciliado"])||Convert.ToBoolean(ch[0]["Anulado"]))throw new InvalidOperationException("Un cheque cambió de estado o fue conciliado. Revisalo antes de anular.");if(Number(Scalar(c,tx,"SELECT COUNT(*) FROM dbo.OrdPagosTSPag v JOIN dbo.OrdPagosTP o ON o.NroOrden=v.NroOrden WHERE v.IDMovBco=@p0 AND v.NroOrden<>@p1 AND o.Confirmado=1 AND o.Anulado=0",cheque,id))>0)throw new InvalidOperationException("Un cheque también está vinculado a otra orden vigente.");Execute(c,tx,"UPDATE dbo.MovCheques SET IDEstado=3,EntregadoA=NULL WHERE NroMovInt=@p0",cheque);}
            Execute(c,tx,"UPDATE dbo.OrdPagosTP SET Anulado=1 WHERE NroOrden=@p0",id);
            Execute(c,tx,"IF OBJECT_ID('dbo.WebOrdPagosAnulaciones','U') IS NULL CREATE TABLE dbo.WebOrdPagosAnulaciones(ID int IDENTITY PRIMARY KEY,NroOrden int NOT NULL,Usuario nvarchar(150) NOT NULL,IDOper int NOT NULL,Fecha datetime NOT NULL DEFAULT GETDATE(),DatosAntes nvarchar(max) NOT NULL)");Execute(c,tx,"INSERT dbo.WebOrdPagosAnulaciones(NroOrden,Usuario,IDOper,DatosAntes) VALUES(@p0,@p1,@p2,@p3)",id,Text(Value(input,"usuarioId")),oper,archived);
            Execute(c,tx,"DELETE dbo.OrdPagosTSFac WHERE NroOrden=@p0",id);Execute(c,tx,"DELETE dbo.OrdPagosTSPag WHERE NroOrden=@p0",id);Execute(c,tx,"UPDATE dbo.OrdPagosTP SET TotalCpras=0,TotalPagos=0,ImpRetPerc=0,SonPesos=@p1 WHERE NroOrden=@p0",id,SupplierPaymentWords(0));
            if(dryRun)tx.Rollback();else tx.Commit();return new {ok=true,id,anulado=true};
        }catch{try{tx.Rollback();}catch{}throw;}}
    }
    private static object SupplierPaymentConfirm(SqlConnection c,Dictionary<string,object> input,bool dryRun){
        Guid request;if(!Guid.TryParse(Text(Value(input,"solicitud")),out request))throw new SupplierPaymentRejected("Falta el identificador de esta confirmación.");
        string fingerprint;using(var sha=SHA256.Create())fingerprint=BitConverter.ToString(sha.ComputeHash(Encoding.UTF8.GetBytes(Json.Serialize(input)))).Replace("-","");
        int editing=0;Int32.TryParse(Text(Value(input,"editarOrden")),out editing);if(editing>0){try{AssertPurchasePermission(Text(Value(input,"usuarioId")),"pagos_proveedores",false,false,true);}catch(InvalidOperationException ex){throw new SupplierPaymentRejected(ex.Message);}}
        int oper;try{oper=UserOperator(c,Text(Value(input,"usuarioId")));}catch(InvalidOperationException ex){throw new SupplierPaymentRejected(ex.Message);}
        using(var tx=c.BeginTransaction(IsolationLevel.Serializable)){bool committing=false;try{
            if(Convert.ToInt32(Scalar(c,tx,"DECLARE @r int; EXEC @r=sp_getapplock @Resource='CorralonWeb.PagosProveedores',@LockMode='Exclusive',@LockOwner='Transaction',@LockTimeout=12000; SELECT @r"))<0)throw new InvalidOperationException("Otro usuario está confirmando pagos. Reintentá.");
            Execute(c,tx,"IF OBJECT_ID('dbo.WebOrdPagosSolicitudes','U') IS NULL CREATE TABLE dbo.WebOrdPagosSolicitudes(Solicitud uniqueidentifier NOT NULL PRIMARY KEY,Hash varchar(64) NOT NULL,NroOrden int NOT NULL,OperadorId int NOT NULL,Resultado nvarchar(max) NOT NULL,Fecha datetime NOT NULL DEFAULT GETDATE())");
            var previous=RowsTx(c,tx,"SELECT Hash,Resultado FROM dbo.WebOrdPagosSolicitudes WITH(UPDLOCK,HOLDLOCK) WHERE Solicitud=@p0",request);
            if(previous.Count>0){if(Text(previous[0]["Hash"])!=fingerprint)throw new Exception("La solicitud ya existe con otros datos. Verificá la orden antes de continuar.");var result=Json.DeserializeObject(Text(previous[0]["Resultado"]));committing=true;if(dryRun)tx.Rollback();else tx.Commit();return result;}
            Dictionary<string,object> oldOrder=null;string archived=null;var oldCheques=new HashSet<int>();
            if(editing>0){
                var found=RowsTx(c,tx,"SELECT * FROM dbo.OrdPagosTP WITH(UPDLOCK,HOLDLOCK) WHERE NroOrden=@p0",editing);if(found.Count!=1)throw new InvalidOperationException("La orden ya no existe.");oldOrder=found[0];
                if(Convert.ToBoolean(oldOrder["Anulado"])||!Convert.ToBoolean(oldOrder["Confirmado"]))throw new InvalidOperationException("Solo se pueden modificar órdenes confirmadas y no anuladas.");
                if(Text(Value(input,"versionOrden"))!=SupplierPaymentVersion(c,tx,editing))throw new InvalidOperationException("La orden cambió en otra PC. Volvé a consultarla antes de modificar.");
                if(InvoiceValueNumber(oldOrder["IDAsiento"])>0||InvoiceValueNumber(oldOrder["IDCaja"])>0)throw new InvalidOperationException("La orden está vinculada a una caja o asiento. Debe revisarse esa vinculación antes de reemplazarla.");
                archived=Json.Serialize(new {cabecera=oldOrder,facturas=RowsTx(c,tx,"SELECT * FROM dbo.OrdPagosTSFac WHERE NroOrden=@p0",editing),valores=RowsTx(c,tx,"SELECT * FROM dbo.OrdPagosTSPag WHERE NroOrden=@p0",editing)});
                foreach(var v in RowsTx(c,tx,"SELECT IDMovBco FROM dbo.OrdPagosTSPag WITH(UPDLOCK,HOLDLOCK) WHERE NroOrden=@p0 AND IDMovBco IS NOT NULL",editing)){int cheque=Convert.ToInt32(v["IDMovBco"]);if(cheque<1)continue;oldCheques.Add(cheque);var ch=RowsTx(c,tx,"SELECT IDEstado,Conciliado,Anulado FROM dbo.MovCheques WITH(UPDLOCK,HOLDLOCK) WHERE NroMovInt=@p0",cheque);if(ch.Count!=1||Convert.ToInt32(ch[0]["IDEstado"])!=4||Convert.ToBoolean(ch[0]["Conciliado"])||Convert.ToBoolean(ch[0]["Anulado"]))throw new InvalidOperationException("Un cheque de esta orden cambió de estado o fue conciliado. Revisalo antes de modificar.");}
                Execute(c,tx,"DELETE dbo.OrdPagosTSFac WHERE NroOrden=@p0",editing);Execute(c,tx,"DELETE dbo.OrdPagosTSPag WHERE NroOrden=@p0",editing);
            }
            int provider=Id(Value(input,"proveedor")),point=Id(Value(input,"punto")),type=Id(Value(input,"tipo"));
            DateTime date=SupplierPaymentDate(Value(input,"fecha"),"Pago");if(date.Date!=DateTime.Today){try{AssertPurchasePermission(Text(Value(input,"usuarioId")),"pagos_proveedores",false,false,true);}catch(InvalidOperationException ex){throw new SupplierPaymentRejected("Solo los administradores pueden cambiar la fecha del pago. "+ex.Message);}}string note=Limited(Value(input,"nota"),2000,"Nota");
            var points=RowsTx(c,tx,"SELECT IDEmp,IDSucAsoc AS IDSuc FROM dbo.[Depósitos] WHERE [IDDepósito]=@p0",point);if(points.Count!=1)throw new InvalidOperationException("Seleccioná un punto de venta válido.");int company=Convert.ToInt32(points[0]["IDEmp"]),branch=Convert.ToInt32(points[0]["IDSuc"]);if(editing>0&&company!=Convert.ToInt32(oldOrder["IDEmp"]))throw new InvalidOperationException("La orden debe conservar su empresa original.");
            var providers=RowsTx(c,tx,"SELECT [RazónSocial] AS nombre FROM dbo.Proveedores WITH(UPDLOCK,HOLDLOCK) WHERE IDProveedor=@p0 AND ISNULL(Suspendido,0)=0",provider);if(providers.Count!=1)throw new InvalidOperationException("El proveedor no existe o está suspendido.");
            if(Number(Scalar(c,tx,"SELECT COUNT(*) FROM dbo.TipoComprobantes WHERE IDComprob=@p0 AND EnOP=1",type))!=1)throw new InvalidOperationException("Tipo de comprobante no habilitado para pagos.");
            var invoices=PurchaseArray(Value(input,"facturas"));var values=PurchaseArray(Value(input,"valores"));if(invoices.Count<1||invoices.Count>200||values.Count<1||values.Count>100)throw new InvalidOperationException("Cargá entre 1 y 200 facturas y entre 1 y 100 valores.");
            var ids=new HashSet<int>();decimal total=0,paid=0,retention=0;var checkedInvoices=new List<Dictionary<string,object>>();
            foreach(var row in invoices){var line=Object(row);int id=Id(Value(line,"id"));if(!ids.Add(id))throw new InvalidOperationException("La misma factura está repetida.");decimal amount=PurchaseMoney(Number(Value(line,"importe")));
                var original=RowsTx(c,tx,"SELECT Total,IDProveedor,IDEmp,Confirmado FROM dbo.ComprasTP WITH(UPDLOCK,HOLDLOCK) WHERE IDRecibo=@p0",id);if(original.Count!=1||Convert.ToInt32(original[0]["IDProveedor"])!=provider||Convert.ToInt32(original[0]["IDEmp"])!=company||Convert.ToInt32(original[0]["Confirmado"])!=1)throw new InvalidOperationException("Una factura no corresponde al proveedor, empresa o no está confirmada.");
                decimal applied=Number(Scalar(c,tx,"SELECT ISNULL(SUM(f.Importe),0) FROM dbo.OrdPagosTSFac f WITH(UPDLOCK,HOLDLOCK) JOIN dbo.OrdPagosTP o WITH(UPDLOCK,HOLDLOCK) ON o.NroOrden=f.NroOrden WHERE f.IDFactura=@p0 AND o.Confirmado=1 AND o.Anulado=0",id));SupplierValidateAmount(amount,Number(original[0]["Total"])-applied);total+=amount;checkedInvoices.Add(new Dictionary<string,object>{{"id",id},{"importe",amount}});
            }
            var checkedValues=new List<Dictionary<string,object>>();var used=new HashSet<int>();
            foreach(var row in values){var line=Object(row);int payType=Id(Value(line,"tipo"));decimal amount=PurchaseMoney(Number(Value(line,"importe")));if(amount<=0)throw new InvalidOperationException("Cada valor debe tener un importe mayor a cero.");
                var types=RowsTx(c,tx,"SELECT IDClasePago FROM dbo.TiposPagos WHERE IDTipoPago=@p0",payType);if(types.Count!=1)throw new InvalidOperationException("Tipo de valor inválido.");bool cheque=Convert.ToInt32(types[0]["IDClasePago"])==2;
                int instrument=0,bank=0;string document=Limited(Value(line,"documento"),20,"N° cheque/documento");DateTime due=SupplierPaymentDate(Value(line,"vence"),"Vencimiento");
                if(cheque){var fresh=Object(Value(line,"nuevo"));
                    if(fresh.Count>0){int account=0;Int32.TryParse(Text(Value(fresh,"cuenta")),out account);bank=Id(Value(fresh,"banco"));int valueType=Id(Value(fresh,"tipoValor")),origin=payType==4?1:2;DateTime valueDate=SupplierPaymentDate(Value(fresh,"fecha"),"Fecha del valor");string holder=Limited(Value(fresh,"titular"),50,"Titular").ToUpperInvariant();
                        if(document.Length==0||due<valueDate)throw new InvalidOperationException("Revisá número y fechas del cheque nuevo.");
                        if(Number(Scalar(c,tx,"SELECT COUNT(*) FROM dbo.Bancos WHERE IDBanco=@p0",bank))!=1||Number(Scalar(c,tx,"SELECT COUNT(*) FROM dbo.TiposValores WHERE IDTipoValor=@p0",valueType))!=1)throw new InvalidOperationException("Banco o tipo de valor inválido.");
                        if(origin==1){var accounts=RowsTx(c,tx,"SELECT IDBanco,IDEmp FROM dbo.CtasBancos WHERE IDCtaBanco=@p0",account);if(accounts.Count!=1||Convert.ToInt32(accounts[0]["IDBanco"])!=bank||Convert.ToInt32(accounts[0]["IDEmp"])!=company)throw new InvalidOperationException("El cheque propio requiere una cuenta bancaria de la empresa y banco elegidos.");}else account=0;
                        if(Number(Scalar(c,tx,"SELECT COUNT(*) FROM dbo.MovCheques WITH(UPDLOCK,HOLDLOCK) WHERE IDEmp=@p0 AND IDBanco=@p1 AND NroMovExt=@p2 AND IDOrigen=@p3 AND IDCtaBanco=@p4 AND Anulado=0",company,bank,document,origin,account))>0)throw new InvalidOperationException("Ese cheque ya existe. Seleccionalo desde Valores disponibles.");
                        int number=Convert.ToInt32(Scalar(c,tx,"SELECT ISNULL(MAX(NroMovVal),0)+1 FROM dbo.MovCheques WITH(TABLOCKX,HOLDLOCK)"));
                        instrument=Convert.ToInt32(Scalar(c,tx,"INSERT dbo.MovCheques(IDSuc,NroMovVal,NroMovExt,FechaValor,IDCtaBanco,IDOper,IDTipoValor,Plazo,FechaVto,IDBanco,Endosable,IDOrigen,Conciliado,Confirmado,Anulado,IDEstado,Importe,IDProveedor,Titular,EntregadoA,IDEmp,Nota) OUTPUT INSERTED.NroMovInt VALUES(@p0,@p1,@p2,@p3,@p4,@p5,@p6,@p7,@p8,@p9,@p10,@p11,0,1,0,4,@p12,@p13,@p14,@p15,@p16,@p17)",branch,number,document,valueDate,account,oper,valueType,(due-valueDate).Days,due,bank,Text(Value(fresh,"endosable"))=="True",origin,amount,provider,holder,providers[0]["nombre"],company,Limited(Value(fresh,"nota"),100,"Nota del valor")));
                    }else{
                        instrument=Id(Value(line,"valor"));if(!used.Add(instrument))throw new InvalidOperationException("El mismo cheque está repetido.");
                        var cheques=RowsTx(c,tx,"SELECT IDBanco,NroMovExt,FechaVto,Importe,IDOrigen,IDEstado,IDEmp,Confirmado,Anulado FROM dbo.MovCheques WITH(UPDLOCK,HOLDLOCK) WHERE NroMovInt=@p0",instrument);
                        if(cheques.Count!=1)throw new InvalidOperationException("El cheque ya no existe.");var ch=cheques[0];int origin=Convert.ToInt32(ch["IDOrigen"]),status=Convert.ToInt32(ch["IDEstado"]);if(Convert.ToInt32(ch["Confirmado"])!=1||Convert.ToInt32(ch["Anulado"])!=0||Convert.ToInt32(ch["IDEmp"])!=company||(payType==4?origin!=1:origin!=2)||(oldCheques.Contains(instrument)?status!=4:(payType==4?(origin!=1||status!=3):(origin!=2||status<1||status>3))))throw new InvalidOperationException("El cheque ya no está disponible para este pago.");
                        if(Number(ch["Importe"])!=amount||Convert.ToDateTime(ch["FechaVto"]).Date!=due.Date||Text(ch["NroMovExt"])!=document)throw new InvalidOperationException("Los datos del cheque cambiaron. Volvé a seleccionarlo.");
                        if(Number(Scalar(c,tx,"SELECT COUNT(*) FROM dbo.OrdPagosTSPag v WITH(UPDLOCK,HOLDLOCK) JOIN dbo.OrdPagosTP o WITH(UPDLOCK,HOLDLOCK) ON o.NroOrden=v.NroOrden WHERE v.IDMovBco=@p0 AND o.Confirmado=1 AND o.Anulado=0",instrument))>0)throw new InvalidOperationException("El cheque ya fue utilizado en otra orden.");bank=Convert.ToInt32(ch["IDBanco"]);
                        Execute(c,tx,"UPDATE dbo.MovCheques SET IDEstado=4,EntregadoA=@p1,IDProveedor=@p2 WHERE NroMovInt=@p0",instrument,providers[0]["nombre"],provider);
                    }
                }else{Int32.TryParse(Text(Value(line,"banco")),out bank);if(bank<0||Number(Scalar(c,tx,"SELECT COUNT(*) FROM dbo.Bancos WHERE IDBanco=@p0",bank))!=1)throw new InvalidOperationException("Seleccioná un banco válido para el valor.");}
                paid+=amount;if(payType==12)retention+=amount;checkedValues.Add(new Dictionary<string,object>{{"tipo",payType},{"importe",amount},{"documento",document},{"vence",due},{"banco",bank},{"valor",instrument}});
            }
            if(total<=0||Math.Abs(total-paid)>=.005m)throw new InvalidOperationException("Los valores deben coincidir con el total de facturas menos notas de crédito. No se confirmó el pago.");
            foreach(int cheque in oldCheques)if(!used.Contains(cheque))Execute(c,tx,"UPDATE dbo.MovCheques SET IDEstado=3,EntregadoA=NULL WHERE NroMovInt=@p0",cheque);
            int orderNumber=editing>0?Convert.ToInt32(oldOrder["NroOP"]):Convert.ToInt32(Scalar(c,tx,"SELECT ISNULL(MAX(NroOP),0)+1 FROM dbo.OrdPagosTP WITH(TABLOCKX,HOLDLOCK) WHERE IDEmp=@p0",company));
            int order=editing>0?editing:Convert.ToInt32(Scalar(c,tx,"INSERT dbo.OrdPagosTP(IDTipoComp,IDEmp,[IDDepósito],NroOP,Fecha,IDProveedor,Nota,Confirmado,TotalCpras,TotalPagos,ImpRetPerc,Anulado,IDOper,SonPesos) OUTPUT INSERTED.NroOrden VALUES(@p0,@p1,@p2,@p3,@p4,@p5,@p6,1,@p7,@p8,@p9,0,@p10,@p11)",type,company,point,orderNumber,date,provider,note,total,paid,retention,oper,SupplierPaymentWords(paid)));
            if(editing>0){Execute(c,tx,"UPDATE dbo.OrdPagosTP SET IDTipoComp=@p1,[IDDepósito]=@p2,Fecha=@p3,IDProveedor=@p4,Nota=@p5,TotalCpras=@p6,TotalPagos=@p7,ImpRetPerc=@p8,SonPesos=@p9 WHERE NroOrden=@p0",editing,type,point,date,provider,note,total,paid,retention,SupplierPaymentWords(paid));Execute(c,tx,"IF OBJECT_ID('dbo.WebOrdPagosEdiciones','U') IS NULL CREATE TABLE dbo.WebOrdPagosEdiciones(ID int IDENTITY PRIMARY KEY,NroOrden int NOT NULL,Usuario nvarchar(150) NOT NULL,IDOper int NOT NULL,Fecha datetime NOT NULL DEFAULT GETDATE(),DatosAntes nvarchar(max) NOT NULL,Solicitud uniqueidentifier NOT NULL)");Execute(c,tx,"INSERT dbo.WebOrdPagosEdiciones(NroOrden,Usuario,IDOper,DatosAntes,Solicitud) VALUES(@p0,@p1,@p2,@p3,@p4)",editing,Text(Value(input,"usuarioId")),oper,archived,request);}
            foreach(var invoice in checkedInvoices)Execute(c,tx,"INSERT dbo.OrdPagosTSFac(NroOrden,IDFactura,Importe) VALUES(@p0,@p1,@p2)",order,invoice["id"],invoice["importe"]);
            foreach(var value in checkedValues)Execute(c,tx,"INSERT dbo.OrdPagosTSPag(NroOrden,IDTipoPago,NroCompPago,IDBanco,FechaVto,Importe,IDMovBco) VALUES(@p0,@p1,@p2,@p3,@p4,@p5,@p6)",order,value["tipo"],value["documento"],value["banco"],value["vence"],value["importe"],Convert.ToInt32(value["valor"])==0?(object)DBNull.Value:value["valor"]);
            var answer=new {ok=true,id=order,numero=orderNumber,total,pagado=paid,retencion=retention};Execute(c,tx,"INSERT dbo.WebOrdPagosSolicitudes(Solicitud,Hash,NroOrden,OperadorId,Resultado) VALUES(@p0,@p1,@p2,@p3,@p4)",request,fingerprint,order,oper,Json.Serialize(answer));
            committing=true;if(dryRun)tx.Rollback();else tx.Commit();return answer;
        }catch(InvalidOperationException ex){try{tx.Rollback();}catch{}if(!committing)throw new SupplierPaymentRejected(ex.Message);throw;}catch{try{tx.Rollback();}catch{}throw;}}
    }

    private static string ReviewResolutionPath(Guid draft) { return Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "venta-resuelta-" + draft.ToString("N") + ".bin"); }
    private static Dictionary<string, object> ReviewEmissionState(SqlConnection c, Guid id, int requestedType, bool consult)
    {
        var result = new Dictionary<string, object> { {"ok",true},{"estado","incierto"},{"sql","sinConfirmar"},{"arca","sinVerificar"} };
        foreach(string file in Directory.GetFiles(AppDomain.CurrentDomain.BaseDirectory,"venta-revision-*.bin")){try{var review=ReadReview(file);if(Text(Value(Object(Value(review,"comprobante")),"id"))==id.ToString()){result["revisionId"]=Value(review,"id");break;}}catch{}}
        var found = Rows(c,"SELECT TOP 1 IDRecibo AS idRecibo,NroFactura AS numero,Confirmado AS confirmado,Anulada AS anulada FROM dbo.FacturasATP WHERE NroOTrab=@p0 ORDER BY IDRecibo DESC",DraftMarker(id));
        if(found.Count>0) { var row=found[0];result["estado"]=Convert.ToInt32(row["confirmado"])==-1&&Convert.ToInt32(row["anulada"])==0?"emitido":"pendiente";result["sql"]=Text(result["estado"])=="emitido"?"confirmado":"pendiente";result["idRecibo"]=row["idRecibo"];result["numero"]=row["numero"];return result; }
        if(File.Exists(ReviewResolutionPath(id))) { var resolution=ReadReview(ReviewResolutionPath(id));result["estado"]=Text(Value(resolution,"estado"));result["resolucion"]=resolution;result["detalle"]="Este intento ya fue cerrado o tiene una continuación en curso.";return result; }
        if(File.Exists(RecoveryPath(id))) { var auth=ReadReview(RecoveryPath(id));result["estado"]="recuperable";result["arca"]="autorizado";result["numero"]=Value(auth,"number");return result; }
        if(requestedType==13||requestedType==29||requestedType==43) {result["estado"]="reintentable";result["arca"]="noRequiere";return result;}
        if(!File.Exists(PendingDraftPath(id))) {result["detalle"]="No se conserva el número solicitado en este servidor. No se pudo verificar ARCA; revisá el puesto de origen.";return result;}
        var pending=ReadReview(PendingDraftPath(id));var invoice=Object(Value(pending,"comprobante"));string number=Text(Value(pending,"numero"));
        if(Text(Value(pending,"fingerprint"))!=DraftFingerprint(invoice)||!System.Text.RegularExpressions.Regex.IsMatch(number,@"^\d{4}-\d{8}$"))throw new InvalidOperationException("El resguardo fiscal no coincide con el borrador.");
        result["numero"]=number;result["borrador"]=new {fecha=Value(invoice,"fecha"),documento=Value(Object(Value(invoice,"cliente")),"numeroDocumento"),total=Value(Object(Value(invoice,"totales")),"total")};
        if(!consult) {result["detalle"]="Consultá ARCA para verificar el intento anterior antes de continuar.";return result;}
        int type=Id(Value(invoice,"idComprobante")),point=Id(Value(invoice,"idPuntoVenta"));
        int afipType=Convert.ToInt32(Scalar(c,null,"SELECT IDTipoAFIP FROM dbo.TipoComprobantes WHERE IDComprob=@p0 AND EnLibroIVA=1",type));
        string cuit=Text(Scalar(c,null,"SELECT CUIT FROM dbo.Empresa WHERE IDEmpresa=1")).Replace("-","").Replace(" ","");
        var client=Object(Value(invoice,"cliente"));string docType=Text(Value(client,"tipoDocumento")),document=Text(Value(client,"numeroDocumento"));int doc=docType=="CUIT"?80:docType=="DNI"?96:99;
        if(Id(Value(invoice,"idCliente"))==1&&doc==96&&(document==""||document=="00000001000"||document=="00001000000")){doc=99;document="0";}
        DateTime date=DateTime.ParseExact(Text(Value(invoice,"fecha")),"yyyy-MM-dd",CultureInfo.InvariantCulture);
        if(afipType<1||point<1||!ValidCuit(cuit)||number.Substring(0,4)!=point.ToString("0000"))throw new InvalidOperationException("Faltan datos fiscales válidos para consultar.");
        try {
            var auth=FiscalConsult(afipType,point,number,cuit,date,doc,document.Replace(".","").Replace(" ",""),Number(Value(Object(Value(invoice,"totales")),"total")));
            if(auth==null){result["estado"]="noautorizado";result["arca"]="noRegistrado";result["detalle"]="ARCA no registra ese número y SQL no tiene este borrador confirmado. Podés corregirlo o elegir otro tipo de comprobante.";return result;}
            WriteReview(RecoveryPath(id),new {number,total=Value(Object(Value(invoice,"totales")),"total"),typeId=type,point,cae=auth.Cae,expiration=auth.Expiration});
            result["estado"]="recuperable";result["arca"]="autorizado";
        } catch(FiscalMismatchException ex){result["estado"]="diferente";result["arca"]="datosDistintos";result["autorizado"]=ex.Actual;result["detalle"]=ex.Message;}
        catch(Exception ex){result["detalle"]="No se pudo verificar ARCA. "+ex.Message;}
        return result;
    }
    private static void ReviewResolve(Guid draft, int receipt, string number, string userId, string reason)
    {
        var resolution=new {estado="resuelto",idRecibo=receipt,numero=number,usuario=userId,motivo=reason,fecha=DateTime.UtcNow.ToString("o")};
        WriteReview(ReviewResolutionPath(draft),resolution);
        foreach(string file in Directory.GetFiles(AppDomain.CurrentDomain.BaseDirectory,"venta-revision-*.bin")){
            var review=ReadReview(file);if(Text(Value(Object(Value(review,"comprobante")),"id"))!=draft.ToString())continue;
            review["estado"]="resuelto";review["resolucion"]=resolution;review["notificado"]=false;WriteReview(file,review);
        }
    }

    private static void HandleSaleReview(HttpListenerContext context)
    {
        var request=context.Request;
        Dictionary<string,object> input=new Dictionary<string,object>();
        if(request.HttpMethod=="POST")
        {
            if(!(request.ContentType??"").StartsWith("application/json")||request.ContentLength64>(request.Url.AbsolutePath=="/imprimir-revision"?8500000:1000000))throw new InvalidOperationException("Revisión inválida o demasiado grande.");
            using(var reader=new StreamReader(request.InputStream,Encoding.UTF8))input=Object(Json.DeserializeObject(reader.ReadToEnd()));
        }
        Guid id;
        if(!Guid.TryParse(request.HttpMethod=="GET"?request.QueryString["id"]:Text(Value(input,"idRevision")),out id))throw new InvalidOperationException("Identificador de revisión inválido.");
        string path=ReviewPath(id);
        lock(ReviewGate)
        {
            if(request.HttpMethod=="GET")
            {
                if(!File.Exists(path))throw new InvalidOperationException("No se encontró la venta en revisión.");
                Reply(context,200,new {ok=true,revision=ReadReview(path)});return;
            }
            string action=Text(Value(input,"accion"));
            if(request.Url.AbsolutePath=="/revision-venta"&&(action=="resolver"||action=="preparar"||action=="revisado"))
            {
                string admin=Text(Value(input,"usuarioId"));AssertPurchasePermission(admin,"facturacion",true,false,true);
                if(!File.Exists(path))throw new InvalidOperationException("No se encontró la revisión.");
                var review=ReadReview(path);var sale=Object(Value(review,"comprobante"));Guid draft=Guid.Parse(Text(Value(sale,"id")));
                if(action=="revisado"){
                    lock(FiscalGate){ReviewResolve(draft,0,"",admin,"Revisado y cerrado manualmente por un administrador, sin vincular otro comprobante.");}
                    ThreadPool.QueueUserWorkItem(_=>NotifyReviews());Reply(context,200,new {ok=true,borradorId=draft.ToString()});return;
                }
                using(var c=Connect()) lock(FiscalGate) {
                    if(action=="resolver"){
                        int receipt=Id(Value(input,"idRecibo"));
                        var rows=Rows(c,"SELECT IDRecibo,NroFactura AS numero,IDComprob AS tipo,CAE AS cae FROM dbo.FacturasATP WHERE IDRecibo=@p0 AND Confirmado=-1 AND Anulada=0",receipt);
                        if(rows.Count!=1)throw new InvalidOperationException("La venta elegida no está confirmada o fue anulada.");
                        int type=Convert.ToInt32(rows[0]["tipo"]);if((type==1||type==2||type==5||type==6||type==7||type==8)&&!System.Text.RegularExpressions.Regex.IsMatch(Text(rows[0]["cae"]),@"^\d{14}$"))throw new InvalidOperationException("La venta fiscal elegida no tiene CAE válido.");
                        ReviewResolve(draft,receipt,Text(rows[0]["numero"]),admin,"Venta realizada en otro comprobante.");
                        ThreadPool.QueueUserWorkItem(_=>NotifyReviews());Reply(context,200,new {ok=true,numero=rows[0]["numero"]});return;
                    }
                    if(Value(review,"continuacion")!=null){Reply(context,200,new {ok=true,comprobante=Value(review,"continuacion")});return;}
                    var state=ReviewEmissionState(c,draft,Id(Value(sale,"idComprobante")),true);
                    if(Text(state["estado"])!="noautorizado"&&Text(state["estado"])!="reintentable")throw new InvalidOperationException("No está comprobado que el intento anterior esté sin autorización y sin guardar. No se habilitó una nueva emisión.");
                    int target=Id(Value(input,"tipo")),original=Id(Value(sale,"idComprobante"));if(target!=original&&target!=13&&target!=43)throw new InvalidOperationException("Tipo de continuación inválido.");
                    var next=Object(Json.DeserializeObject(Json.Serialize(sale)));next["id"]=Guid.NewGuid().ToString();next["idComprobante"]=target;next["emision"]=null;next["recoveryPending"]=false;next["revisionPendiente"]=null;next["revisionOrigen"]=id.ToString();next["usuarioId"]=admin;next["fecha"]=DateTime.Today.ToString("yyyy-MM-dd");
                    review["continuacion"]=next;WriteReview(path,review);
                    WriteReview(ReviewResolutionPath(draft),new {estado="encorreccion",nuevoBorrador=next["id"],revision=id.ToString(),usuario=admin});
                    Reply(context,200,new {ok=true,comprobante=next});return;
                }
            }
            if(request.Url.AbsolutePath=="/revision-venta")
            {
                var sale=Object(Value(input,"comprobante"));Guid draft;
                if(!Guid.TryParse(Text(Value(sale,"id")),out draft)|| !(Value(sale,"articulos") is System.Collections.IList))throw new InvalidOperationException("Faltan los datos de la venta.");
                if(File.Exists(path))
                {
                    var existing=ReadReview(path);
                    if(Text(Value(existing,"fingerprint"))!=DraftFingerprint(sale))throw new InvalidOperationException("La revisión guardada tiene otro contenido. No se sobrescribió.");
                }
                else WriteReview(path,new {id=id.ToString(),comprobante=sale,fingerprint=DraftFingerprint(sale),motivo=Limited(Value(input,"motivo"),2000,"Motivo"),creadoAt=DateTime.UtcNow.ToString("o"),url=Text(Value(input,"url")),notificado=false,impreso=false});
                Reply(context,200,new {ok=true,idRevision=id.ToString()});ThreadPool.QueueUserWorkItem(_=>NotifyReviews());return;
            }
            if(request.Url.AbsolutePath=="/imprimir-revision")
            {
                if(!File.Exists(path))throw new InvalidOperationException("Guardá la revisión antes de imprimir.");
                var review=ReadReview(path);
                if(Text(Value(review,"impreso"))=="True"){Reply(context,200,new {ok=true,yaImpreso=true});return;}
                PrintRawTicket(Text(Value(input,"impresora")),Text(Value(input,"imagen")),"VENTA PENDIENTE DE REVISION "+id.ToString());
                review["impreso"]=true;review["impresoAt"]=DateTime.UtcNow.ToString("o");WriteReview(path,review);
                Reply(context,200,new {ok=true});return;
            }
        }
        throw new InvalidOperationException("Acción de revisión no disponible.");
    }
    private static void Handle(HttpListenerContext context)
    {
        var request = context.Request;
        string origin = request.Headers["Origin"];
        if (request.RemoteEndPoint == null || !IPAddress.IsLoopback(request.RemoteEndPoint.Address) ||
            (origin != null && Array.IndexOf(Origins, origin) < 0) || request.Headers["Sec-Fetch-Site"] == "cross-site")
        { Reply(context, 403, new { ok = false, error = "Disponible solo desde la pantalla local de facturación." }); return; }
        if (request.HttpMethod == "OPTIONS")
        {
            context.Response.StatusCode = 204;
            if (origin != null) context.Response.Headers["Access-Control-Allow-Origin"] = origin;
            context.Response.Headers["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS";
            context.Response.Headers["Access-Control-Allow-Headers"] = "Content-Type";
            context.Response.Close();
            return;
        }
        if (request.HttpMethod == "GET" && request.Url.AbsolutePath == "/health")
        {
            Reply(context, 200, new { ok = true });
            return;
        }
        if (request.Url.AbsolutePath == "/revision-venta" || request.Url.AbsolutePath == "/imprimir-revision")
        {
            try { HandleSaleReview(context); }
            catch (Exception ex) { Reply(context, 400, new { ok = false, error = ex.Message }); }
            return;
        }
        if (request.HttpMethod == "GET" && request.Url.AbsolutePath == "/borradores-fiscales")
        {
            try
            {
                var drafts = new List<object>();
                foreach (string path in Directory.GetFiles(AppDomain.CurrentDomain.BaseDirectory, "wsfe-draft-*.bin"))
                {
                    Guid id;
                    string name = Path.GetFileNameWithoutExtension(path);
                    if (!name.StartsWith("wsfe-draft-", StringComparison.OrdinalIgnoreCase) ||
                        !Guid.TryParseExact(name.Substring(11), "N", out id) || new FileInfo(path).Length > 1000000) continue;
                    try
                    {
                        var saved = Object(Json.DeserializeObject(Encoding.UTF8.GetString(
                            ProtectedData.Unprotect(File.ReadAllBytes(path), null, DataProtectionScope.CurrentUser))));
                        var invoice = Object(Value(saved, "comprobante"));
                        Guid resolvedId;if(Guid.TryParse(Text(Value(invoice,"id")),out resolvedId)&&File.Exists(ReviewResolutionPath(resolvedId)))continue;
                        Guid savedId;
                        if (Guid.TryParse(Text(Value(invoice, "id")), out savedId) && savedId == id)
                            drafts.Add(new { comprobante = invoice, numero = Text(Value(saved, "numero")) });
                    }
                    catch { }
                }
                Reply(context, 200, new { ok = true, borradores = drafts });
            }
            catch (Exception) { Reply(context, 500, new { ok = false, error = "No se pudieron leer los borradores fiscales guardados en esta PC." }); }
            return;
        }
        if ((request.HttpMethod == "GET" || request.HttpMethod == "POST") && request.Url.AbsolutePath == "/impresoras") { HandlePrinterSettings(context); return; }
        try
        {
            using (var connection = Connect())
            {
                if(request.Url.AbsolutePath=="/pagos-proveedores"){
                    try{
                        if(request.HttpMethod=="GET"){AssertPurchasePermission(request.QueryString["usuarioId"],"pagos_proveedores");Reply(context,200,SupplierPaymentGet(connection,request));return;}
                        if(request.HttpMethod!="POST"||!(request.ContentType??"").StartsWith("application/json"))throw new SupplierPaymentRejected("Se esperaba una orden JSON.");
                        string body;using(var reader=new StreamReader(request.InputStream,Encoding.UTF8))body=reader.ReadToEnd();if(body.Length>200000)throw new SupplierPaymentRejected("La orden es demasiado grande.");var input=Object(Json.DeserializeObject(body));
                        try{AssertPurchasePermission(Text(Value(input,"usuarioId")),"pagos_proveedores",true);}catch(InvalidOperationException ex){throw new SupplierPaymentRejected(ex.Message);}
                        if(Text(Value(input,"accion"))=="anular"){Reply(context,200,SupplierPaymentAnnul(connection,input,false));return;}
                        Reply(context,200,SupplierPaymentConfirm(connection,input,false));return;
                    }catch(SupplierPaymentRejected ex){Reply(context,409,new {ok=false,error=ex.Message,safeToCorrect=true});return;}
                }
                if (request.Url.AbsolutePath == "/caja") { Reply(context, 200, CajaSqlHandle(connection, request)); return; }
                if (request.HttpMethod == "POST" && request.Url.AbsolutePath == "/comprobante-anular")
                {
                    if (!(request.ContentType ?? "").StartsWith("application/json",StringComparison.OrdinalIgnoreCase)) throw new InvalidOperationException("Se esperaba una solicitud JSON.");
                    string body;using(var reader=new StreamReader(request.InputStream,Encoding.UTF8))body=reader.ReadToEnd();
                    if(body.Length>10000)throw new InvalidOperationException("La solicitud es demasiado grande.");
                    var input=Object(Json.DeserializeObject(body));
                    AssertPurchasePermission(Text(Value(input,"usuarioId")),"facturacion",false,true);
                    Reply(context,200,InvoiceCancel(connection,input));return;
                }
                if (request.HttpMethod == "POST" && request.Url.AbsolutePath == "/comprobante-valores")
                {
                    if (!(request.ContentType ?? "").StartsWith("application/json",StringComparison.OrdinalIgnoreCase)) throw new InvalidOperationException("Se esperaba una solicitud JSON.");
                    string body;using(var reader=new StreamReader(request.InputStream,Encoding.UTF8))body=reader.ReadToEnd();
                    if(body.Length>100000)throw new InvalidOperationException("La solicitud es demasiado grande.");
                    var input=Object(Json.DeserializeObject(body));
                    AssertPurchasePermission(Text(Value(input,"usuarioId")),"facturacion",true);
                    Reply(context,200,InvoiceValuesSave(connection,input));return;
                }
                if(request.Url.AbsolutePath=="/ventas-tarjeta"){
                    if(request.HttpMethod=="GET"){
                        AssertPurchasePermission(request.QueryString["usuarioId"],"ventas_tarjeta");Reply(context,200,CardSalesQuery(connection,request));return;
                    }
                    if(request.HttpMethod=="POST"){
                        if(!(request.ContentType??"").StartsWith("application/json",StringComparison.OrdinalIgnoreCase)||request.ContentLength64>10000)throw new InvalidOperationException("Solicitud inválida.");
                        string body;using(var reader=new StreamReader(request.InputStream,Encoding.UTF8))body=reader.ReadToEnd();if(body.Length>10000)throw new InvalidOperationException("Solicitud demasiado grande.");
                        var input=Object(Json.DeserializeObject(body));AssertPurchasePermission(Text(Value(input,"usuarioId")),"ventas_tarjeta",true);Reply(context,200,Text(Value(input,"accion"))=="verificar-pendiente"?CardFiscalVerifyPending(connection,input):Text(Value(input,"accion"))=="facturar"?CardFiscalIssue(connection,input):CardSalesUncheck(connection,input));return;
                    }
                }
                if (request.Url.AbsolutePath == "/recibos-cobro")
                {
                    if (request.HttpMethod == "GET") { AssertPurchasePermission(request.QueryString["usuarioId"], "recibos_cobro"); Reply(context, 200, CollectionReceiptQuery(connection, request)); return; }
                    if (request.HttpMethod == "POST")
                    {
                        if (!(request.ContentType ?? "").StartsWith("application/json", StringComparison.OrdinalIgnoreCase)) throw new InvalidOperationException("Se esperaba un recibo JSON.");
                        string body; using (var reader = new StreamReader(request.InputStream, Encoding.UTF8)) body = reader.ReadToEnd();
                        if (body.Length > 250000) throw new InvalidOperationException("El recibo es demasiado grande.");
                        var input = Object(Json.DeserializeObject(body)); AssertPurchasePermission(Text(Value(input, "usuarioId")), "recibos_cobro");
                        if(Text(Value(input,"accion"))=="anular")
                        {
                            AssertPurchasePermission(Text(Value(input,"usuarioId")),"recibos_cobro",false,true);
                            Reply(context,200,CollectionReceiptCancel(connection,input));return;
                        }
                        if(Text(Value(input,"accion"))=="editar-pago"){Reply(context,200,CollectionReceiptEditPayment(connection,input));return;}
                        Reply(context, 200, CollectionReceiptConfirm(connection, input)); return;
                    }
                }
                if (request.Url.AbsolutePath == "/proveedores-sql")
                {
                    if (request.HttpMethod == "GET")
                    {
                        AssertPurchasePermission(request.QueryString["usuarioId"], "proveedores_sql");
                        Reply(context, 200, ProviderQuery(connection, request)); return;
                    }
                    if (request.HttpMethod == "POST")
                    {
                        if (!(request.ContentType ?? "").StartsWith("application/json", StringComparison.OrdinalIgnoreCase)) throw new InvalidOperationException("Se esperaba un proveedor JSON.");
                        string body; using (var reader = new StreamReader(request.InputStream, Encoding.UTF8)) body = reader.ReadToEnd();
                        if (body.Length > 100000) throw new InvalidOperationException("El proveedor es demasiado grande.");
                        var input = Object(Json.DeserializeObject(body));
                        AssertPurchasePermission(Text(Value(input, "usuarioId")), "proveedores_sql");
                        Reply(context, 200, ProviderSave(connection, input)); return;
                    }
                }
                if (request.Url.AbsolutePath == "/cargar-facturas" && request.HttpMethod == "GET")
                {
                    AssertPurchasePermission(request.QueryString["usuarioId"]);
                    Reply(context, 200, PurchaseQuery(connection, request)); return;
                }
                if (request.Url.AbsolutePath == "/cargar-facturas" && request.HttpMethod == "POST")
                {
                    if (!(request.ContentType ?? "").StartsWith("application/json", StringComparison.OrdinalIgnoreCase)) throw new InvalidOperationException("Se esperaba una factura JSON.");
                    string body; using (var reader = new StreamReader(request.InputStream, Encoding.UTF8)) body = reader.ReadToEnd();
                    if (body.Length > 200000) throw new InvalidOperationException("La factura es demasiado grande.");
                    var data = Object(Json.DeserializeObject(body));
                    AssertPurchasePermission(Text(Value(data, "usuarioId")));
                    if (Text(Value(data,"accion")) == "importar-remito") {
                        AssertPurchasePermission(Text(Value(data,"usuarioId")),"carga_stock");
                        Reply(context,200,RemitoPurchaseConfirm(connection,data,false)); return;
                    }
                    if (Text(Value(data,"accion")) == "generar-descuento") {Reply(context,200,PurchaseGenerateDiscount(connection,data));return;}
                    if (Text(Value(data, "accion")) == "editar-cabecera") { Reply(context, 200, PurchaseEditHeader(connection, data)); return; }
                    if (Text(Value(data, "accion")) == "editar-stock") { Reply(context, 200, PurchaseEditStock(connection, data)); return; }
                    if (Text(Value(data, "accion")) == "eliminar") { Reply(context, 200, PurchaseDelete(connection, data)); return; }
                    if (Text(Value(data,"accion")) != "confirmar") throw new InvalidOperationException("Acción de compra inválida.");
                    Reply(context, 200, PurchaseConfirm(connection, data, false)); return;
                }
                if (request.HttpMethod == "POST" && request.Url.AbsolutePath == "/articulos-sql")
                {
                    if (!(request.ContentType ?? "").StartsWith("application/json",StringComparison.OrdinalIgnoreCase)) throw new InvalidOperationException("Se esperaba un artículo JSON.");
                    string body; using(var reader=new StreamReader(request.InputStream,Encoding.UTF8))body=reader.ReadToEnd();
                    if(body.Length>100000)throw new InvalidOperationException("El artículo es demasiado grande.");
                    var articleInput=Object(Json.DeserializeObject(body));
                    if(Text(Value(articleInput,"accion"))=="ficha-vendedor") {Reply(context,200,ArticuloGuardarVendedor(connection,articleInput));return;}
                    Reply(context,200,Text(Value(articleInput,"accion"))=="presupuestar-aridos" ? ArticulosPresupuestarAridos(connection,articleInput) : ArticuloGuardar(connection,articleInput,false)); return;
                }
                if (request.HttpMethod == "GET" && request.Url.AbsolutePath == "/articulos-sql")
                {
                    Reply(context, 200, ArticulosSql(connection, request));
                    return;
                }
                if (request.HttpMethod == "GET" && request.Url.AbsolutePath == "/stock-ingreso")
                {
                    Reply(context, 200, StockConsulta(connection, request));
                    return;
                }
                if (request.HttpMethod == "POST" && request.Url.AbsolutePath == "/stock-ingreso")
                {
                    if (!(request.ContentType ?? "").StartsWith("application/json", StringComparison.OrdinalIgnoreCase))
                        throw new InvalidOperationException("Se esperaba una carga de stock JSON.");
                    string body;
                    using (var reader = new StreamReader(request.InputStream, Encoding.UTF8)) body = reader.ReadToEnd();
                    if (body.Length > 2000000) throw new InvalidOperationException("La carga de stock es demasiado grande.");
                    var data = Object(Json.DeserializeObject(body));
                    string action = Text(Value(data, "accion"));
                    if (action == "transferir-presupuesto") {
                        var transfer=StockBudgetTransferInput(data);
                        AssertPurchasePermission(Text(Value(data,"usuarioId")),"carga_stock");
                        transfer["proveedor"]=StockBudgetTransferProvider(connection);
                        var state=StockWebSourceState(connection,"presupuesto",Text(Value(data,"presupuestoId")));
                        if(Convert.ToBoolean(state["bloqueado"]))throw new InvalidOperationException(Text(state["mensaje"]));
                        Reply(context,200,StockIngreso(connection,transfer,true));return;
                    }
                    if (action == "recalcular-articulo") { Reply(context,200,StockArticleRecalculate(connection,data));return; }
                    if (action == "anular") { Reply(context, 200, StockAnular(connection, data)); return; }
                    if (action == "cambiar-sucursal") { Reply(context, 200, StockCambiarSucursal(connection, data)); return; }
                    if (action == "vincular-compra") { Reply(context, 200, StockVincularCompra(connection, data)); return; }
                    if (action == "actualizar-costo") { Reply(context, 200, StockActualizarCosto(connection, data)); return; }
                    if (action != "previsualizar" && action != "confirmar") throw new InvalidOperationException("Acción de stock inválida.");
                    Reply(context, 200, StockIngreso(connection, data, action == "confirmar"));
                    return;
                }
                if (request.HttpMethod == "GET" && request.Url.AbsolutePath == "/caja-estado")
                {
                    int point;
                    if (!Int32.TryParse(request.QueryString["puntoVenta"], out point))
                        throw new InvalidOperationException("Elegí un punto de venta.");
                    object branch = Scalar(connection, null, "SELECT IDSucAsoc FROM dbo.[Depósitos] WHERE [IDDepósito]=@p0 AND IDEmp=1", point);
                    if (branch == null || branch == DBNull.Value) throw new InvalidOperationException("Punto de venta inválido.");
                    Reply(context, 200, new { ok = true, abierta = CajaSucursalAbierta(connection, null, Convert.ToInt32(branch)) });
                    return;
                }
                if (request.HttpMethod == "GET" && request.Url.AbsolutePath == "/bootstrap")
                {
                    Reply(context, 200, new { ok = true, impresionDirecta = true, stockEnVivo = true, clientesEdicion = true,
                        comprobantes = Rows(connection, "SELECT tc.IDComprob AS id, tc.Abreviatura AS codigo, tc.Descripcion AS nombre, tc.IDTipoAFIP AS idAfip, tc.EnLibroIVA AS libroIva, tc.ImpFis AS impresoraFiscal, tc.IDTipoMovStock AS tipoMovimientoStock, xp.IDPtoVta AS idPuntoVenta FROM dbo.TipoComprobantes tc INNER JOIN dbo.TiposCompXPV xp ON xp.IDComprob=tc.IDComprob WHERE tc.EnVtas=1 ORDER BY xp.IDPtoVta,tc.Abreviatura"),
                        puntosVenta = Rows(connection, "SELECT IDDepósito AS id, [Descripción] AS nombre, IDSucAsoc AS idSucursal, IDEmp AS idEmpresa, FE AS electronica, ImpFis AS impresoraFiscal FROM dbo.[Depósitos] ORDER BY IDDepósito"),
                        tiposPago = Rows(connection, "SELECT IDTipoPago AS id, TipoPago AS nombre, IDClasePago AS clase, PorcRec1C AS recargoInicial, CuotasPlan AS cuotasPlan FROM dbo.TiposPagos WHERE EnCaja=1 ORDER BY TipoPago"),
                        tarjetas = Rows(connection, "SELECT IDTarjeta AS id, [Descripción] AS nombre FROM dbo.Tarjetas WHERE Susp=0 ORDER BY [Descripción]"),
                        tarjetasCuotas = Rows(connection, "SELECT IDTipoPago AS idTarjeta,Cuotas AS cuotas,PorcAD AS coeficiente FROM dbo.TarjetasCuotas ORDER BY IDTipoPago,Cuotas"),
                        empresa = Rows(connection, "SELECT TOP 1 e.Empresa AS nombre,e.RazonSocial AS razonSocial,e.Domicilio AS domicilio,e.CUIT AS cuit,e.Actividad AS actividad,CONVERT(varchar(10),e.FechaIniActiv,103) AS inicioActividades,e.[Teléfono] AS telefono,e.Email AS email,e.NroIIBB AS ingresosBrutos,e.CBUEmp AS cbu,e.NotaFAC AS notaFactura,i.Descripcion AS ivaEmpresa FROM dbo.Empresa e LEFT JOIN dbo.TiposIVA i ON i.IDTipoIVA=e.IDTipoIVAEmp WHERE e.IDEmpresa=1"),
                        sucursales = Rows(connection, "SELECT IDSuc AS id,Sucursal AS nombre,Domicilio AS domicilio,Tel AS telefono,Email AS email FROM dbo.Sucursales ORDER BY IDSuc"),
                        listas = Rows(connection, "SELECT IDTipoCli AS id, TipoCliDesc AS nombre FROM dbo.TiposCli ORDER BY IDTipoCli"),
                        tiposIva = Rows(connection, "SELECT IDTipoIVA AS id, Descripcion AS nombre FROM dbo.TiposIVA ORDER BY IDTipoIVA"),
                        tiposDocumento = Rows(connection, "SELECT IDTipoDocFis AS id, TipoDocFis AS nombre FROM dbo.TiposDocFis ORDER BY IDTipoDocFis"),
                        vendedores = Rows(connection, "SELECT IDEmpleado AS id, Nombre AS nombre FROM dbo.Empleados WHERE Susp=0 ORDER BY Nombre"),
                        comprobantesEmitibles = new int[] { 1, 2, 5, 6, 7, 8, 13, 29, 43 } });
                    return;
                }
                if (request.HttpMethod == "GET" && request.Url.AbsolutePath == "/catalogo")
                {
                    int pointId = Id(request.QueryString["puntoVenta"]);
                    int listId = Id(request.QueryString["lista"]);
                    if (listId < 1 || listId > 3) throw new InvalidOperationException("Lista de precios inválida.");
                    var catalog = Rows(connection,
                        "SELECT a.IDArt AS idart,a.IDArtProv AS codProv,a.[Descripción] AS descripcion,a.IDProveedor AS idProveedor,p.[RazónSocial] AS proveedor," +
                        "(CASE @p1 WHEN 1 THEN a.PrecioVta1 WHEN 2 THEN a.PrecioVta2 ELSE a.PrecioVta3 END) * CASE WHEN a.IDMoneda=1 THEN CONVERT(decimal(18,4),1) ELSE m.ImpCotiz END AS precioFinal," +
                        "ISNULL(s.StockAct,0) AS stock,CONVERT(varchar(10),a.FechaActPrec,103) AS ultimaActualizacion,a.PorcIVA1*100 AS iva,a.IDMoneda AS idMoneda,CASE WHEN a.IDMoneda=1 THEN CONVERT(decimal(18,4),1) ELSE m.ImpCotiz END AS cotizacion,a.PrecioCpraCI * CASE WHEN a.IDMoneda=1 THEN CONVERT(decimal(18,4),1) ELSE m.ImpCotiz END AS costoFinal " +
                        "FROM dbo.[Artículos] a " +
                        "LEFT JOIN dbo.Proveedores p ON p.IDProveedor=a.IDProveedor " +
                        "CROSS JOIN dbo.[Depósitos] d " +
                        "LEFT JOIN dbo.Monedas m ON m.IDMoneda=a.IDMoneda " +
                        "LEFT JOIN dbo.ArtsStock s ON s.IDArt=a.IDArt AND s.IDSuc=d.IDSucAsoc " +
                        "WHERE d.IDDepósito=@p0 AND a.Suspendido=0 ORDER BY a.[Descripción],a.IDArt", pointId, listId);
                    Reply(context, 200, new { ok = true, catalogo = catalog });
                    return;
                }
                if (request.HttpMethod == "GET" && request.Url.AbsolutePath == "/stock")
                {
                    int pointId = Id(request.QueryString["puntoVenta"]);
                    string[] requested = (request.QueryString["ids"] ?? "").Split(new[] { ',' }, StringSplitOptions.RemoveEmptyEntries);
                    if (requested.Length > 200) throw new InvalidOperationException("Demasiados artículos para consultar stock.");
                    var ids = new List<string>();
                    foreach (string raw in requested)
                    {
                        string id = raw.Trim();
                        if (id.Length < 1 || id.Length > 30) throw new InvalidOperationException("Código de artículo inválido.");
                        if (!ids.Contains(id)) ids.Add(id);
                    }
                    if (ids.Count == 0) { Reply(context, 200, new { ok = true, stock = new object[0] }); return; }
                    var parameters = new object[ids.Count + 1]; parameters[0] = pointId;
                    var names = new List<string>();
                    for (int i = 0; i < ids.Count; i++) { parameters[i + 1] = ids[i]; names.Add("@p" + (i + 1)); }
                    var stock = Rows(connection,
                        "SELECT a.IDArt AS idart,ISNULL(s.StockAct,0) AS stock,CONVERT(varchar(10),a.FechaActPrec,103) AS ultimaActualizacion FROM dbo.[Artículos] a " +
                        "CROSS JOIN dbo.[Depósitos] d LEFT JOIN dbo.ArtsStock s ON s.IDArt=a.IDArt AND s.IDSuc=d.IDSucAsoc " +
                        "WHERE d.IDDepósito=@p0 AND a.IDArt IN (" + String.Join(",", names.ToArray()) + ")",
                        parameters);
                    Reply(context, 200, new { ok = true, stock });
                    return;
                }
                if (request.HttpMethod == "GET" && request.Url.AbsolutePath == "/clientes")
                {
                    if(Text(request.QueryString["unificar"])=="1"){
                        AssertPurchasePermission(request.QueryString["usuarioId"],"facturacion");
                        int principal=String.IsNullOrEmpty(request.QueryString["principal"])?0:Id(request.QueryString["principal"]);
                        Reply(context,200,CustomerMergePreview(connection,CustomerMergeIds(request.QueryString["ids"]),principal));return;
                    }
                    if (Text(request.QueryString["validarDocumento"]) == "1")
                    {
                        int documentType = Text(request.QueryString["tipoDocumento"]) == "CUIT" ? 67 : Text(request.QueryString["tipoDocumento"]) == "DNI" ? 50 : 0;
                        Reply(context, 200, CheckCustomerDocument(connection, Id(request.QueryString["id"]), documentType, Text(request.QueryString["documento"]))); return;
                    }
                    if (Text(request.QueryString["padron"]) == "1")
                    {
                        AssertPurchasePermission(request.QueryString["usuarioId"],"facturacion");
                        Reply(context,200,LocalPadronCustomer(connection,Text(request.QueryString["cuit"])));return;
                    }
                    if (Text(request.QueryString["opciones"]) == "1")
                    {
                        Reply(context, 200, new { ok = true,
                            predeterminados = CustomerDefaults(connection),
                            departamentos = Rows(connection, "SELECT IDLocal AS id,Localidad AS nombre FROM dbo.Localidades ORDER BY Localidad"),
                            provincias = Rows(connection, "SELECT IDProvincia AS id,Provincia AS nombre FROM dbo.Provincias ORDER BY Provincia"),
                            regiones = Rows(connection, "SELECT IDRegión AS id,[Descripción] AS nombre FROM dbo.Regiones ORDER BY [Descripción]"),
                            tiposIb = Rows(connection, "SELECT IDTipoIB AS id,TipoIB AS nombre FROM dbo.TiposIB ORDER BY TipoIB"),
                            tiposComercio = Rows(connection, "SELECT IDTipoCom AS id,DescCom AS nombre FROM dbo.TipoComer ORDER BY DescCom") });
                        return;
                    }
                    if (!String.IsNullOrEmpty(request.QueryString["id"]))
                    {
                        int customerId = Id(request.QueryString["id"]);
                        var detail = CustomerDetail(connection, customerId);
                        if (detail.Count == 0) { Reply(context, 404, new { ok = false, error = "El cliente no existe en SQL." }); return; }
                        int destination=CustomerMergeDestination(connection,null,customerId);
                        Reply(context, 200, new { ok = true, cliente = detail[0],unificadoEn=destination,clientePrincipal=destination>0?CustomerDetail(connection,destination)[0]:null });
                        return;
                    }
                    if (Text(request.QueryString["catalogo"]) == "1")
                    {
                        Reply(context, 200, new { ok = true, catalogoCompleto = true, clientes = Rows(connection,
                            "SELECT IDCliente AS id,[RazónSocial] AS nombre,CUIT AS documento,IDTipoIVA AS idTipoIva,IDTipoDoc AS idTipoDoc," +
                            "[Dirección] AS direccion,[Teléfono] AS telefono,Email AS email,Suspendido AS suspendido " +
                            "FROM dbo.Clientes " + (Text(request.QueryString["incluirSuspendidos"]) == "1" ? "" : "WHERE Suspendido=0 ") + "ORDER BY [RazónSocial],IDCliente") });
                        return;
                    }
                    string query = Text(request.QueryString["q"]);
                    if (query.Length > 80) throw new InvalidOperationException("Búsqueda demasiado larga.");
                    string[] words = query.Split((char[])null, StringSplitOptions.RemoveEmptyEntries);
                    if (words.Length > 8) throw new InvalidOperationException("Búsqueda demasiado larga.");
                    int startRow;
                    if (!int.TryParse(Text(request.QueryString["start"]), out startRow) || startRow < 1) startRow = 0;
                    if (startRow > 1000000) throw new InvalidOperationException("Página fuera de rango.");
                    bool excludeRegistered=Array.IndexOf(new[]{2,6,8},Id(request.QueryString["tipoComprobante"]))>=0;
                    var patterns = new object[words.Length + 3];
                    var match = new StringBuilder("1=1");
                    for (int i = 0; i < words.Length; i++)
                    {
                        patterns[i] = "%" + words[i].Replace("[", "[[]").Replace("%", "[%]").Replace("_", "[_]") + "%";
                        match.Append(" AND ([RazónSocial] COLLATE Latin1_General_CI_AI LIKE @p").Append(i)
                             .Append(" OR CUIT LIKE @p").Append(i)
                             .Append(" OR REPLACE(REPLACE(CUIT,'-',''),' ','') LIKE @p").Append(i).Append(")");
                    }
                    patterns[words.Length] = query.Replace("[", "[[]").Replace("%", "[%]").Replace("_", "[_]") + "%";
                    patterns[words.Length + 1] = (words.Length > 0 ? words[0] : "").Replace("[", "[[]").Replace("%", "[%]").Replace("_", "[_]") + "%";
                    patterns[words.Length + 2] = startRow;
                    var sql = new StringBuilder("WITH ordered AS (SELECT IDCliente AS id,[RazónSocial] AS nombre,CUIT AS documento,IDTipoIVA AS idTipoIva,IDTipoDoc AS idTipoDoc," +
                        "[Dirección] AS direccion,[Teléfono] AS telefono,Email AS email," +
                        "ROW_NUMBER() OVER (ORDER BY [RazónSocial],IDCliente) AS alphaRn,CASE WHEN ");
                    sql.Append(match).Append(" THEN 1 ELSE 0 END AS coincide,CASE WHEN [RazónSocial] COLLATE Latin1_General_CI_AI LIKE @p").Append(words.Length)
                       .Append(" THEN 0 WHEN [RazónSocial] COLLATE Latin1_General_CI_AI LIKE @p").Append(words.Length + 1)
                       .Append(" AND (").Append(match).Append(") THEN 1 WHEN ").Append(match)
                       .Append(" THEN 2 WHEN [RazónSocial] COLLATE Latin1_General_CI_AI LIKE @p").Append(words.Length + 1)
                       .Append(" THEN 3 ELSE 4 END AS matchRank FROM dbo.Clientes WHERE Suspendido=0").Append(excludeRegistered?" AND ISNULL(IDTipoIVA,0)<>1":"").Append("),")
                       .Append(" best AS (SELECT *,FIRST_VALUE(alphaRn) OVER(ORDER BY matchRank,alphaRn) AS bestAlphaRn FROM ordered),")
                       .Append(" grouped AS (SELECT *,CASE WHEN matchRank<4 THEN 1 WHEN alphaRn<bestAlphaRn THEN 0 ELSE 2 END AS sortGroup FROM best),")
                       .Append(" ranked AS (SELECT *,ROW_NUMBER() OVER(ORDER BY sortGroup,CASE WHEN sortGroup=1 THEN matchRank ELSE 0 END,nombre,id) AS rn FROM grouped),")
                       .Append(" positioned AS (SELECT *,MIN(CASE WHEN sortGroup=1 THEN rn END) OVER() AS firstMatch,COUNT(*) OVER() AS total FROM ranked),")
                       .Append(" windowed AS (SELECT *,CASE WHEN @p").Append(words.Length + 2)
                       .Append(" > 0 THEN @p").Append(words.Length + 2)
                       .Append(" WHEN COALESCE(firstMatch,1)>20 THEN COALESCE(firstMatch,1)-20 ELSE 1 END AS startRow FROM positioned)")
                       .Append(" SELECT id,nombre,documento,idTipoIva,idTipoDoc,direccion,telefono,email,rn,coincide,matchRank,firstMatch,total FROM windowed")
                       .Append(" WHERE rn BETWEEN startRow AND startRow+60 ORDER BY rn");
                    var clients = Rows(connection, sql.ToString(), patterns);
                    Reply(context, 200, new { ok = true, clientes = clients });
                    return;
                }
                if (request.HttpMethod == "POST" && request.Url.AbsolutePath == "/clientes")
                {
                    if (!(request.ContentType ?? "").StartsWith("application/json", StringComparison.OrdinalIgnoreCase))
                        throw new InvalidOperationException("Se esperaba un cliente JSON.");
                    string body;
                    using (var reader = new StreamReader(request.InputStream, Encoding.UTF8)) body = reader.ReadToEnd();
                    if (body.Length > 20000) throw new InvalidOperationException("La ficha de cliente es demasiado grande.");
                    var customerData = Object(Json.DeserializeObject(body));
                    if(Text(Value(customerData,"accion"))=="unificar"){
                        AssertPurchasePermission(Text(Value(customerData,"usuarioId")),"facturacion");
                        Reply(context,200,CustomerMergeCommit(connection,customerData));return;
                    }
                    Reply(context, 200, Text(Value(customerData, "soloDocumento")) == "True" ? SaveCustomerDocument(connection, customerData) : SaveCustomer(connection, customerData));
                    return;
                }
                if (request.HttpMethod == "GET" && request.Url.AbsolutePath == "/facturas-asociables")
                {
                    int creditType = Id(request.QueryString["tipo"]);
                    if (Array.IndexOf(new[] { 1, 2, 5, 6, 7, 8, 13, 29, 43 }, creditType) < 0)
                        throw new InvalidOperationException("Este comprobante no puede copiar una boleta de SQL.");
                    int invoiceType = creditType == 5 || creditType == 7 ? 1 : creditType == 6 || creditType == 8 ? 2 : 29;
                    string query = Text(request.QueryString["q"]).Trim();
                    if (query.Length > 80) throw new InvalidOperationException("Búsqueda demasiado larga.");
                    var shortNumber = System.Text.RegularExpressions.Regex.Match(query, @"^(\d{1,4})\s*-\s*(\d{1,8})$");
                    if (shortNumber.Success)
                        query = Int32.Parse(shortNumber.Groups[1].Value).ToString("0000") + "-" + Int32.Parse(shortNumber.Groups[2].Value).ToString("00000000");
                    string pattern = "%" + query.Replace("[", "[[]").Replace("%", "[%]").Replace("_", "[_]") + "%";
                    var invoices = Rows(connection,
                        "SELECT TOP 60 h.IDRecibo AS idRecibo,h.NroFactura AS numero,CONVERT(varchar(10),h.Fecha,103) AS fecha,h.ApeYNom AS cliente,h.IDCliente AS idCliente,h.TotalME AS total,h.CUIT AS documento,tc.Descripcion AS tipoOriginal,h.Anulada AS anulada " +
                        "FROM dbo.FacturasATP h JOIN dbo.TipoComprobantes tc ON tc.IDComprob=h.IDComprob WHERE ((@p0=29 AND h.IDComprob IN (1,2,13,43)) OR (@p0<>29 AND h.IDComprob=@p0)) AND h.Confirmado=-1 AND (h.IDComprob IN (13,43) OR LEN(h.CAE)=14) " +
                        "AND (h.NroFactura LIKE @p1 OR h.ApeYNom COLLATE Latin1_General_CI_AI LIKE @p1 OR h.CUIT LIKE @p1) " +
                        "ORDER BY CASE WHEN h.NroFactura=@p2 THEN 0 WHEN h.ApeYNom COLLATE Latin1_General_CI_AI=@p2 THEN 1 ELSE 2 END,h.Fecha DESC,h.IDRecibo DESC", invoiceType, pattern, query);
                    Reply(context, 200, new { ok = true, facturas = invoices });
                    return;
                }
                if (request.HttpMethod == "GET" && request.Url.AbsolutePath == "/factura-asociable")
                {
                    int receipt = Id(request.QueryString["id"]), creditType = Id(request.QueryString["tipo"]);
                    if (Array.IndexOf(new[] { 1, 2, 5, 6, 7, 8, 13, 29, 43 }, creditType) < 0)
                        throw new InvalidOperationException("Este comprobante no puede copiar una boleta de SQL.");
                    int invoiceType = creditType == 5 || creditType == 7 ? 1 : creditType == 6 || creditType == 8 ? 2 : 29;
                    var header = Rows(connection,
                        "SELECT h.IDRecibo AS idRecibo,h.NroFactura AS numero,CONVERT(varchar(10),h.Fecha,103) AS fecha,h.IDCliente AS idCliente,h.ApeYNom AS cliente,h.CUIT AS documento," +
                        "h.IDTipoDocFis AS idTipoDoc,h.IDTipoIVA AS idTipoIva,h.[Dirección] AS direccion,h.[Teléfono] AS telefono,c.Email AS email,h.TotalME AS total,h.Anulada AS anulada " +
                        "FROM dbo.FacturasATP h LEFT JOIN dbo.Clientes c ON c.IDCliente=h.IDCliente " +
                        "WHERE h.IDRecibo=@p0 AND ((@p1=29 AND h.IDComprob IN (1,2,13,43)) OR (@p1<>29 AND h.IDComprob=@p1)) AND h.Confirmado=-1 AND (h.IDComprob IN (13,43) OR LEN(h.CAE)=14)", receipt, invoiceType);
                    if (header.Count != 1) { Reply(context, 404, new { ok = false, error = "La boleta original ya no está disponible." }); return; }
                    var lines = Rows(connection,
                        "SELECT IDArt AS idart,ArtDesc AS descripcion,Cantidad AS cantidad,PrecioUni AS precio,PrecioUniOrig AS precioBase,PorcDto*100 AS descuento,PorcIVA*100 AS iva " +
                        "FROM dbo.FacturasATS WHERE IDRecibo=@p0 ORDER BY Orden", receipt);
                    var values = Rows(connection,
                        "SELECT v.IDTipoPago AS idTipoPago,p.TipoPago AS tipo,v.Importe AS importe,v.ImpRec AS impRec,v.ImpEnt AS total," +
                        "v.Cuotas AS cuotas,v.IDTarjeta AS idTarjeta,t.[Descripción] AS tarjeta,v.Coef AS coef,v.Concepto AS descripcion " +
                        "FROM dbo.FacturasTSVal v LEFT JOIN dbo.TiposPagos p ON p.IDTipoPago=v.IDTipoPago " +
                        "LEFT JOIN dbo.Tarjetas t ON t.IDTarjeta=v.IDTarjeta WHERE v.IDRecibo=@p0 ORDER BY v.Orden", receipt);
                    Reply(context, 200, new { ok = true, factura = header[0], articulos = lines, valores = values });
                    return;
                }
                if (request.HttpMethod == "GET" && request.Url.AbsolutePath == "/consultar-comprobantes")
                {
                    DateTime from,to;
                    if(!DateTime.TryParseExact(request.QueryString["desde"],"yyyy-MM-dd",CultureInfo.InvariantCulture,DateTimeStyles.None,out from)||
                       !DateTime.TryParseExact(request.QueryString["hasta"],"yyyy-MM-dd",CultureInfo.InvariantCulture,DateTimeStyles.None,out to)||from>to||to.Year>=9999)
                        throw new InvalidOperationException("Ingresá un rango de fechas válido.");
                    int page,branch,point;
                    if(!Int32.TryParse(request.QueryString["pagina"]??"0",out page)||page<0||page>100000||
                       !Int32.TryParse(request.QueryString["sucursal"]??"0",out branch)||branch<0||
                       !Int32.TryParse(request.QueryString["puntoVenta"]??"0",out point)||point<0)
                        throw new InvalidOperationException("Página, sucursal o punto de venta inválido.");
                    string search=Limited(QueryUtf8(request,"buscar"),80,"Búsqueda");
                    string pattern="%"+search.Replace("[","[[]").Replace("%","[%]").Replace("_","[_]")+"%";
                    string article=Limited(QueryUtf8(request,"articulo"),100,"Artículo");
                    string articlePattern="%"+article.Replace("[","[[]").Replace("%","[%]").Replace("_","[_]")+"%";
                    string sortField=request.QueryString["orden"]??"",sortDirection=request.QueryString["direccion"]??"";
                    string sortColumn="";
                    switch(sortField){
                        case "numero": sortColumn="f.NroFactura";break;
                        case "tipo": sortColumn="t.Descripcion COLLATE Latin1_General_CI_AI";break;
                        case "cliente": sortColumn="f.ApeYNom COLLATE Latin1_General_CI_AI";break;
                        case "sucursal": sortColumn="s.Sucursal COLLATE Latin1_General_CI_AI";break;
                        case "fecha": sortColumn="f.Fecha";break;
                        case "total": sortColumn="f.Total";break;
                        case "estado": sortColumn="CASE WHEN ISNULL(f.Anulada,0)<>0 THEN 0 ELSE 1 END";break;
                        case "": break;
                        default: throw new InvalidOperationException("Campo de orden inválido.");
                    }
                    if(sortColumn!=""&&sortDirection!="asc"&&sortDirection!="desc")throw new InvalidOperationException("Dirección de orden inválida.");
                    string orderBy=sortColumn==""?"f.Fecha DESC,f.IDRecibo DESC":sortColumn+(sortDirection=="desc"?" DESC":" ASC")+",f.IDRecibo DESC";
                    var records=Rows(connection,
                        "SELECT COUNT_BIG(*) OVER() AS totalConsulta,f.IDRecibo AS idRecibo,f.NroFactura AS numero,CONVERT(varchar(10),f.Fecha,103) AS fecha,f.IDComprob AS idComprobante,t.Descripcion AS tipo,f.ApeYNom AS cliente,f.IDSuc AS idSucursal,s.Sucursal AS sucursal,f.Total AS total,f.Anulada AS anulada,f.IDDepósito AS puntoVenta " +
                        "FROM dbo.FacturasATP f LEFT JOIN dbo.TipoComprobantes t ON t.IDComprob=f.IDComprob LEFT JOIN dbo.Sucursales s ON s.IDSuc=f.IDSuc " +
                        "WHERE f.Confirmado<>0 AND f.IDComprob IN (1,2,5,6,7,8,13,29,43) AND f.Fecha>=@p0 AND f.Fecha<@p1 " +
                        "AND (@p2=0 OR f.IDSuc=@p2) AND (@p6=0 OR f.IDDepósito=@p6) AND (@p3='' OR f.ApeYNom COLLATE Latin1_General_CI_AI LIKE @p4 OR f.NroFactura LIKE @p4) " +
                        "AND (@p7='' OR EXISTS (SELECT 1 FROM dbo.FacturasATS d LEFT JOIN dbo.[Artículos] a ON a.IDArt=d.IDArt WHERE d.IDRecibo=f.IDRecibo AND (d.IDArt=@p7 OR (TRY_CONVERT(int,@p7) IS NOT NULL AND d.IDArt=RIGHT('000000'+@p7,6)) OR d.IDArt LIKE @p8 OR d.ArtDesc COLLATE Latin1_General_CI_AI LIKE @p8 OR a.IDArtProv COLLATE Latin1_General_CI_AI LIKE @p8 OR a.[Descripción] COLLATE Latin1_General_CI_AI LIKE @p8))) " +
                        "ORDER BY "+orderBy+" OFFSET @p5 ROWS FETCH NEXT 51 ROWS ONLY",
                        from.Date,to.Date.AddDays(1),branch,search,pattern,page*50,point,article,articlePattern);
                    long totalRecords=records.Count>0?Convert.ToInt64(records[0]["totalConsulta"]):0;
                    bool more=records.Count>50;if(more)records.RemoveAt(50);
                    foreach(var record in records)record.Remove("totalConsulta");
                    Reply(context,200,new {ok=true,comprobantes=records,pagina=page,hayMas=more,totalComprobantes=totalRecords});return;
                }
                if (request.HttpMethod == "GET" && request.Url.AbsolutePath == "/comprobante")
                {
                    int receipt = Id(request.QueryString["id"]);
                    using(var tx=connection.BeginTransaction(IsolationLevel.Serializable)) {
                    var header = RowsTx(connection,tx, "SELECT IDRecibo AS idRecibo,NroFactura AS numero,Fecha AS fecha,CONVERT(varchar(10),Fecha,23) AS fechaComprobante,CONVERT(varchar(19),FechaYHora,126) AS fechaHora,IDComprob AS idComprobante,IDDepósito AS idPuntoVenta,Confirmado AS confirmado,Anulada AS anulada,Total AS total,TotalME AS totalAbsoluto,IDCliente AS idCliente,ApeYNom AS cliente,CUIT AS documento,CAE AS cae,CASE WHEN LEN(CodBarra)=40 THEN SUBSTRING(CodBarra,32,8) ELSE '' END AS caeExpiry,NroFacNC AS facturaAsociada,IDVend AS vendedor,IDSuc AS sucursal,Impresa AS impresa,ActStock AS stockActualizado,Pagada AS Completo,IDTipoIVA AS idTipoIva,IDTipoDocFis AS idTipoDoc,[Dirección] AS direccion,[Teléfono] AS telefono,Nota AS nota,IDOper AS operador,SubTot1 AS neto21,ImpIVA21 AS iva21,SubTot2 AS neto105,ImpIVA105 AS iva105,SubTSDto AS subtotalSinDto,SubTotal AS gravado,ImpIVA1 AS importeIva,TotalEF AS efectivo,TotalEC AS tarjeta,TotalCC AS cuentaCorriente,TotalCH AS cheque,CONVERT(varchar(10),FechaPriVto,23) AS vencimiento FROM dbo.FacturasATP WHERE IDRecibo=@p0 AND IDComprob IN (1,2,5,6,7,8,13,29,43)", receipt);
                    if (header.Count != 1) { Reply(context, 404, new { ok = false, error = "El comprobante no existe en SQL." }); return; }
                    header[0]["totalArticulos"] = Math.Abs(InvoiceValueNumber(Scalar(connection,tx,"SELECT SUM(Importe) FROM dbo.FacturasATS WITH(HOLDLOCK) WHERE IDRecibo=@p0",receipt)));
                    header[0]["ajusteEmitido"] = Math.Abs(InvoiceValueNumber(header[0]["total"])) - InvoiceValueNumber(header[0]["totalArticulos"]);
                    var detailResult = new { ok = true, bloqueoAnulacionFiscal = Convert.ToInt32(Scalar(connection,tx,"SELECT COUNT(*) FROM dbo.FacturasATP h JOIN dbo.TipoComprobantes t ON t.IDComprob=h.IDComprob JOIN dbo.[Depósitos] d ON d.IDEmp=h.IDEmp AND d.[IDDepósito]=h.[IDDepósito] WHERE h.IDRecibo=@p0 AND d.FE<>0 AND t.EnLibroIVA<>0",receipt))>0, versionAnulacion = InvoiceCancellationVersion(connection,tx,receipt), versionValores = InvoiceValuesVersion(connection,tx,receipt), comprobante = header[0],
                        articulos = RowsTx(connection,tx, "SELECT IDArt AS idart,ArtDesc AS descripcion,Cantidad AS cantidad,PrecioUni AS precio,Importe AS importe,PorcIVA*100 AS iva,PorcDto*100 AS descuento FROM dbo.FacturasATS WHERE IDRecibo=@p0 ORDER BY Orden", receipt),
                        valores = RowsTx(connection,tx, "SELECT v.Orden AS orden,v.IDTipoPago AS idTipoPago,p.IDClasePago AS clase,p.TipoPago AS tipo,v.Importe AS importe,v.ImpRec AS impRec,v.ImpEnt AS total,v.Cuotas AS cuotas,v.IDTarjeta AS idTarjeta,t.[Descripción] AS tarjeta,v.Coef AS coef,v.Concepto AS descripcion FROM dbo.FacturasTSVal v LEFT JOIN dbo.TiposPagos p ON p.IDTipoPago=v.IDTipoPago LEFT JOIN dbo.Tarjetas t ON t.IDTarjeta=v.IDTarjeta WHERE v.IDRecibo=@p0 ORDER BY v.Orden", receipt) }; tx.Commit(); Reply(context,200,detailResult);
                    } return;
                }
                if (request.HttpMethod == "POST" && request.Url.AbsolutePath == "/imprimir")
                {
                    if (!(request.ContentType ?? "").StartsWith("application/json", StringComparison.OrdinalIgnoreCase))
                        throw new InvalidOperationException("Se esperaba un ticket JSON.");
                    if (request.ContentLength64 > 8500000)
                        throw new InvalidOperationException("La imagen del ticket es demasiado grande.");
                    string body;
                    using (var reader = new StreamReader(request.InputStream, Encoding.UTF8)) body = reader.ReadToEnd();
                    if (body.Length > 8500000) throw new InvalidOperationException("La imagen del ticket es demasiado grande.");
                    var input = Object(Json.DeserializeObject(body));
                    int receipt = Id(Value(input, "idRecibo"));
                    string printer = Text(Value(input, "impresora"));
                    var issued = Rows(connection,
                        "SELECT TOP 1 NroFactura AS numero,IDComprob AS tipo,CAE AS cae FROM dbo.FacturasATP " +
                        "WHERE IDRecibo=@p0 AND Confirmado=-1 AND Anulada=0 AND IDComprob IN (1,2,5,6,7,8,13,29,43)", receipt);
                    if (issued.Count != 1) throw new InvalidOperationException("El comprobante no está confirmado en SQL. No se imprimió.");
                    int typeId = Convert.ToInt32(issued[0]["tipo"]);
                    if (typeId == 1 || typeId == 2 || typeId == 5 || typeId == 6 || typeId == 7 || typeId == 8)
                        if (!System.Text.RegularExpressions.Regex.IsMatch(Text(issued[0]["cae"]), @"^\d{14}$"))
                            throw new InvalidOperationException("Falta el CAE fiscal en SQL. No se imprimió.");
                    PrintRawTicket(printer, Text(Value(input, "imagen")), "Corralón Progreso " + Text(issued[0]["numero"]));
                    Reply(context, 200, new { ok = true, numero = issued[0]["numero"], impresora = printer });
                    return;
                }
                if (request.HttpMethod == "GET" && request.Url.AbsolutePath == "/estado-emision")
                {
                    Guid id;if(!Guid.TryParse(request.QueryString["id"],out id))throw new InvalidOperationException("Borrador inválido.");
                    int type;Int32.TryParse(request.QueryString["tipo"],out type);
                    var status=ReviewEmissionState(connection,id,type,request.QueryString["consultarArca"]=="1");
                    if(request.QueryString["soloSql"]=="1"&&Text(status["estado"])=="incierto"&&!File.Exists(PendingDraftPath(id))&&!File.Exists(RecoveryPath(id)))status["estado"]="sinRegistro";
                    Reply(context,200,status);return;
                }
                if (request.HttpMethod == "POST" && request.Url.AbsolutePath == "/validar")
                {
                    if (!(request.ContentType ?? "").StartsWith("application/json", StringComparison.OrdinalIgnoreCase)) throw new InvalidOperationException("Se esperaba un comprobante JSON.");
                    string body;
                    using (var reader = new StreamReader(request.InputStream, Encoding.UTF8)) body = reader.ReadToEnd();
                    if (body.Length > 1000000) throw new InvalidOperationException("Comprobante demasiado grande.");
                    var invoice = Json.Deserialize<Dictionary<string, object>>(body);
                    if (invoice == null) throw new InvalidOperationException("Faltan datos del comprobante.");
                    int typeId = Id(Value(invoice, "idComprobante"));
                    int pointId = Id(Value(invoice, "idPuntoVenta"));
                    int customerId = Id(Value(invoice, "idCliente"));
                    int sellerId = Id(Value(invoice, "vendedor"));
                    if (Rows(connection, "SELECT IDDepósito FROM dbo.[Depósitos] WHERE IDDepósito=@p0", pointId).Count != 1) throw new InvalidOperationException("El punto de venta no existe.");
                    if (Rows(connection, "SELECT tc.IDComprob FROM dbo.TipoComprobantes tc INNER JOIN dbo.TiposCompXPV xp ON xp.IDComprob=tc.IDComprob WHERE tc.IDComprob=@p0 AND xp.IDPtoVta=@p1 AND tc.EnVtas=1", typeId, pointId).Count != 1) throw new InvalidOperationException("El tipo de comprobante no está habilitado para este punto de venta.");
                    if (Rows(connection, "SELECT IDCliente FROM dbo.Clientes WHERE IDCliente=@p0 AND Suspendido=0", customerId).Count != 1) throw new InvalidOperationException("Elegí un cliente existente en SQL.");
                    if (Rows(connection, "SELECT IDEmpleado FROM dbo.Empleados WHERE IDEmpleado=@p0 AND Susp=0", sellerId).Count != 1) throw new InvalidOperationException("Elegí un vendedor existente en SQL.");
                    var items = Value(invoice, "articulos") as System.Collections.ArrayList;
                    if (items == null || items.Count == 0 || items.Count > 200) throw new InvalidOperationException("Agregá entre 1 y 200 artículos.");
                    decimal total = 0;
                    foreach (object item in items)
                    {
                        var row = Object(item);
                        string articleId = Text(Value(row, "idart"));
                        if (articleId.Length == 0 || Rows(connection, "SELECT IDArt FROM dbo.[Artículos] WHERE IDArt=@p0 AND Suspendido=0", articleId).Count != 1) throw new InvalidOperationException("El artículo " + articleId + " no está disponible en SQL.");
                        decimal quantity = Number(Value(row, "cantidad")), price = Number(Value(row, "precio"));
                        if (quantity <= 0 || price < 0) throw new InvalidOperationException("Revisá cantidad y precio de " + articleId + ".");
                        total += Decimal.Round(quantity * price, 2, MidpointRounding.AwayFromZero);
                    }
                    var values = Value(invoice, "valores") as System.Collections.ArrayList;
                    decimal paid = 0;
                    if (values != null) foreach (object value in values)
                    {
                        var row = Object(value);
                        int paymentId = Id(Value(row, "idTipoPago"));
                        if (Rows(connection, "SELECT IDTipoPago FROM dbo.TiposPagos WHERE IDTipoPago=@p0 AND EnCaja=1", paymentId).Count != 1) throw new InvalidOperationException("El medio de pago no existe en SQL.");
                        decimal amount = Number(Value(row, "importe"));
                        if (amount <= 0) throw new InvalidOperationException("El importe del pago debe ser positivo.");
                        paid += amount;
                    }
                    if (Math.Abs(total - paid) > .01m) throw new InvalidOperationException("Los valores recibidos no coinciden con el total calculado por el servidor.");
                    bool enabled = Array.IndexOf(new[] { 1,2,5,6,7,8,13,29,43 }, typeId) >= 0;
                    Reply(context, 200, new { ok = true, total = total, valores = paid, emisionHabilitada = enabled, message = enabled ? "El comprobante está habilitado para emisión." : "Este comprobante requiere autorización fiscal antes de emitir." });
                    return;
                }
                if (request.HttpMethod == "POST" && request.Url.AbsolutePath == "/emitir")
                {
                    if (!(request.ContentType ?? "").StartsWith("application/json", StringComparison.OrdinalIgnoreCase))
                        throw new InvalidOperationException("Se esperaba un comprobante JSON.");
                    string body;
                    using (var reader = new StreamReader(request.InputStream, Encoding.UTF8)) body = reader.ReadToEnd();
                    if (body.Length > 1000000) throw new InvalidOperationException("Comprobante demasiado grande.");
                    var envelope = Json.Deserialize<Dictionary<string, object>>(body);
                    if (envelope == null) throw new InvalidOperationException("Faltan datos del comprobante.");
                    bool dryRun = Text(Value(envelope, "pruebaTransaccion")) == "True";
                    bool recoveryOnly = Text(Value(envelope, "recuperarSolo")) == "True";
                    Reply(context, 200, Emit(connection, Object(Value(envelope, "comprobante")), dryRun, recoveryOnly));
                    return;
                }
            }
            Reply(context, 404, new { ok = false, error = "Ruta no encontrada." });
        }
        catch (FiscalRejectedException ex) { Reply(context, 409, new { ok = false, error = ex.Message, fiscalRejected = true }); }
        catch (ArcaUnavailableException ex) { Reply(context, 503, new { ok = false, error = "No hay conexión con ARCA o no devolvió CAE. Intentá con PRES. ESPECIAL. " + ex.Message, arcaUnavailable = true, safeToRetry = true }); }
        catch (SaleReviewException ex) { Reply(context, 409, new { ok = false, error = ex.Message, revisionRequired = true, recoveryRequired = true }); }
        catch (FiscalRecoveryException ex) { Reply(context, 409, new { ok = false, error = ex.Message, recoveryRequired = true, numero = ex.Number }); }
        catch (CustomerMergeRejected ex) { Reply(context, 409, new { ok = false, error = ex.Message, safeToCorrect = true }); }
        catch (CustomerDocumentException ex) { Reply(context, 409, new { ok = false, error = ex.Message, safeToRetry = true, clienteDocumento = true }); }
        catch (InvalidOperationException ex) { Reply(context, 409, new { ok = false, error = ex.Message }); }
        catch (SqlException ex)
        {
            bool issuing = request.HttpMethod == "POST" && request.Url.AbsolutePath == "/emitir";
            Reply(context, 503, new { ok = false,
                error = issuing ? "Error al facturar: falló la conexión o escritura en SQL antes de solicitar el CAE. No se emitió ni guardó esta venta. " + ex.Message
                                : "No se pudo consultar SQL Server: " + ex.Message,
                safeToRetry = issuing });
        }
        catch (Exception) { Reply(context, 500, new { ok = false, error = "No se pudo preparar el comprobante. Revisá la conexión local." }); }
    }
    private static int activeCriticalRequests;

    private static void Main()
    {
        ReviewNotifyTimer = new Timer(_ => NotifyReviews(), null, 15000, 60000);
        using (var listener = new HttpListener())
        {
            int port;
            if (!Int32.TryParse(Environment.GetEnvironmentVariable("CORRALON_FACTURACION_TEST_PORT"), out port) || port < 1 || port > 65535) port = 8081;
            listener.Prefixes.Add("http://localhost:" + port + "/");
            listener.Start();
            Console.WriteLine("Facturación copia: API de preparación en http://localhost:" + port + "/");
            while (true)
            {
                HttpListenerContext context;
                try { context = listener.GetContext(); }
                catch (HttpListenerException) { if (!listener.IsListening) break; Thread.Sleep(250); continue; }
                if (context.Request.HttpMethod == "POST" && context.Request.Url.AbsolutePath == "/shutdown")
                {
                    if (context.Request.RemoteEndPoint == null || !IPAddress.IsLoopback(context.Request.RemoteEndPoint.Address) ||
                        context.Request.Headers["Origin"] != null)
                    {
                        Reply(context, 403, new { ok = false, error = "Apagado disponible solo para el servidor local." });
                        continue;
                    }
                    if (Interlocked.CompareExchange(ref activeCriticalRequests, 0, 0) != 0)
                    {
                        Reply(context, 409, new { ok = false, error = "Hay una emisión o impresión en curso. Volvé a detener el servidor cuando termine." });
                        continue;
                    }
                    Reply(context, 200, new { ok = true });
                    Thread.Sleep(150);
                    listener.Stop();
                    break;
                }
                bool critical = context.Request.HttpMethod == "POST" &&
                    (context.Request.Url.AbsolutePath == "/emitir" || context.Request.Url.AbsolutePath == "/imprimir" || context.Request.Url.AbsolutePath == "/imprimir-revision" || context.Request.Url.AbsolutePath == "/revision-venta" ||
                     context.Request.Url.AbsolutePath == "/stock-ingreso" || context.Request.Url.AbsolutePath == "/articulos-sql" || context.Request.Url.AbsolutePath == "/cargar-facturas" || context.Request.Url.AbsolutePath == "/pagos-proveedores");
                critical = critical || (context.Request.HttpMethod == "GET" && context.Request.Url.AbsolutePath == "/estado-emision");
                if (critical) Interlocked.Increment(ref activeCriticalRequests);
                ThreadPool.QueueUserWorkItem(_ =>
                {
                    try { Handle(context); }
                    catch (Exception ex)
                    {
                        try { Console.Error.WriteLine("Facturación: solicitud interrumpida: " + ex.GetType().Name + ": " + ex.Message); }
                        catch { }
                        try { Reply(context, 503, new { ok = false, error = "El servicio de facturación interrumpió esta consulta. Volvé a verificar el estado antes de emitir otra venta." }); }
                        catch { }
                    }
                    finally { if (critical) Interlocked.Decrement(ref activeCriticalRequests); }
                });
            }
        }
    }
}


