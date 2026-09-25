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
internal static class FacturacionCopiaApi
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
    private static void PrintRawTicket(string printer, string pngBase64, string jobName)
    {
        if (!TicketPrinters().Contains(printer))
            throw new InvalidOperationException("La ticketera elegida no está instalada en esta PC.");
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
                if (!OpenPrinter(printer, out handle, IntPtr.Zero))
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
    private sealed class ArcaUnavailableException : InvalidOperationException
    {
        public ArcaUnavailableException(string message) : base(message) { }
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
                if (!System.Text.RegularExpressions.Regex.IsMatch(cae, @"^\d{14}$")) return null;
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
                    throw new InvalidOperationException("ARCA tiene ese número autorizado, pero sus datos no coinciden con la venta guardada. No se recuperó automáticamente; avisá al encargado.");
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
    private static Dictionary<string, object> Object(object value) { return value as Dictionary<string, object> ?? new Dictionary<string, object>(); }
    private static object Value(Dictionary<string, object> data, string key) { object value; return data.TryGetValue(key, out value) ? value : null; }
    private static decimal Number(object value)
    {
        decimal result;
        if (!Decimal.TryParse(Text(value), System.Globalization.NumberStyles.Any, System.Globalization.CultureInfo.InvariantCulture, out result)) throw new InvalidOperationException("Importe o cantidad inválida.");
        return result;
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
            var connection = new SqlConnection(connectionString);
            connection.Open();
            return connection;
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
    private static int LocalOperator()
    {
        // Config es local del MDB; Access usa este valor como IDOper, distinto del vendedor.
        object engine = null, database = null, recordset = null;
        try
        {
            Type dao = Type.GetTypeFromProgID("DAO.DBEngine.120");
            if (dao == null) throw new InvalidOperationException("No está disponible DAO de Access para leer el operador local.");
            engine = Activator.CreateInstance(dao);
            database = dao.InvokeMember("OpenDatabase", System.Reflection.BindingFlags.InvokeMethod, null, engine,
                new object[] { @"C:\Update\Ariel2App - copia.mdb", false, true });
            recordset = database.GetType().InvokeMember("OpenRecordset", System.Reflection.BindingFlags.InvokeMethod, null, database,
                new object[] { "SELECT TOP 1 IDOper FROM Config" });
            object fields = recordset.GetType().InvokeMember("Fields", System.Reflection.BindingFlags.GetProperty, null, recordset, null);
            object field = fields.GetType().InvokeMember("Item", System.Reflection.BindingFlags.GetProperty, null, fields, new object[] { "IDOper" });
            object value = field.GetType().InvokeMember("Value", System.Reflection.BindingFlags.GetProperty, null, field, null);
            return Id(value);
        }
        catch (InvalidOperationException) { throw; }
        catch (Exception ex) { throw new InvalidOperationException("No se pudo leer IDOper del MDB local: " + ex.Message); }
        finally
        {
            if (recordset != null) { try { recordset.GetType().InvokeMember("Close", System.Reflection.BindingFlags.InvokeMethod, null, recordset, null); } catch { } System.Runtime.InteropServices.Marshal.FinalReleaseComObject(recordset); }
            if (database != null) { try { database.GetType().InvokeMember("Close", System.Reflection.BindingFlags.InvokeMethod, null, database, null); } catch { } System.Runtime.InteropServices.Marshal.FinalReleaseComObject(database); }
            if (engine != null) System.Runtime.InteropServices.Marshal.FinalReleaseComObject(engine);
        }
    }
    private static object Emit(SqlConnection connection, Dictionary<string, object> invoice, bool dryRun, bool recoveryOnly)
    {
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
            System.Globalization.DateTimeStyles.None, out date) || (date.Date != DateTime.Today && !savedAuthorization))
            throw new InvalidOperationException("Para emitir, la fecha debe ser la de hoy. Access exige autorización para otra fecha.");
        var items = Value(invoice, "articulos") as System.Collections.ArrayList;
        var payments = Value(invoice, "valores") as System.Collections.ArrayList;
        if (items == null || items.Count == 0 || items.Count > 200) throw new InvalidOperationException("Agregá entre 1 y 200 artículos.");
        if (payments == null || payments.Count == 0 || payments.Count > 30) throw new InvalidOperationException("Cargá los valores recibidos.");
        string draft = Limited(Value(invoice, "id"), 80, "Identificador del borrador");
        Guid draftId;
        if (!Guid.TryParse(draft, out draftId)) throw new InvalidOperationException("El borrador no tiene un identificador válido.");
        string fiscalRecovery = RecoveryPath(draftId);
        int oper = LocalOperator();
        var client = Object(Value(invoice, "cliente"));
        string docType = Text(Value(client, "tipoDocumento"));
        int docId = docType == "CUIT" ? 67 : docType == "DNI" ? 50 : docType == "Sin identificar" ? 32 : 0;
        if (docId == 0) throw new InvalidOperationException("Tipo de documento no admitido para la emisión.");
        string doc = Limited(Value(client, "numeroDocumento"), 13, "Documento");
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
                object existing = Scalar(connection, tx, "SELECT TOP 1 IDRecibo FROM dbo.FacturasATP WITH (UPDLOCK,HOLDLOCK) WHERE IDComprob=@p0 AND NroOTrab=@p1 ORDER BY IDRecibo DESC", typeId, marker);
                if (existing != null && existing != DBNull.Value)
                {
                    int prior = Convert.ToInt32(existing);
                    var found = Scalar(connection, tx, "SELECT NroFactura FROM dbo.FacturasATP WHERE IDRecibo=@p0 AND Confirmado=-1", prior);
                    if (found == null) throw new InvalidOperationException("Ya existe un intento previo con este borrador. Revisá el comprobante " + prior + " en Access.");
                    tx.Commit();
                    try { if (File.Exists(fiscalRecovery)) File.Delete(fiscalRecovery); } catch { }
                    DeletePendingDraft(draftId);
                    return new { ok = true, idRecibo = prior, numero = Text(found), yaEmitido = true };
                }
                var pointInfo = Scalar(connection, tx, "SELECT IDSucAsoc FROM dbo.[Depósitos] WHERE IDDepósito=@p0 AND IDEmp=1", point);
                if (pointInfo == null) throw new InvalidOperationException("Punto de venta inválido.");
                int branch = Convert.ToInt32(pointInfo);
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
                    if (customer == 1 && docId == 50 && (doc.Length == 0 || doc == "00000001000")) { docId = 32; doc = ""; }
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
                    else if (docId == 50 && doc.Replace(".", "").Length != 8)
                        throw new InvalidOperationException("El DNI del receptor debe tener 8 dígitos.");
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
                        basePrice > 0 ? basePrice : price, price / rate, Convert.ToDecimal(article[4]), margin, article[3] == DBNull.Value ? null : article[3],
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
                if (grandTotal <= 0 || Math.Abs(paidBase - gross) > .005m || Math.Abs(paid - grandTotal) > .005m)
                    throw new InvalidOperationException("Los valores recibidos no coinciden con el total recalculado en SQL.");
                if (account > 0 && !returnType && !quotation)
                {
                    object credit = Scalar(connection, tx,
                        "SELECT ISNULL(c.ImpCred,0)-ISNULL(c.SaldoCC,0)-" +
                        "ISNULL((SELECT SUM(v.ImpEnt*tc.ImpPor) FROM dbo.FacturasATP h JOIN dbo.FacturasTSVal v ON v.IDRecibo=h.IDRecibo JOIN dbo.TipoComprobantes tc ON tc.IDComprob=h.IDComprob WHERE h.IDCliente=c.IDCliente AND h.IDEmp=1 AND h.Anulada=0 AND h.Confirmado=-1 AND v.IDTipoPago=3 AND tc.IDTipoAcred>0),0)+" +
                        "ISNULL((SELECT SUM(r.Total) FROM dbo.RecibosXTP r WHERE r.IDCliente=c.IDCliente AND r.IDEmp=1 AND r.Anulado=0 AND r.Confirmado=1),0) FROM dbo.Clientes c WHERE c.IDCliente=@p0",
                        customer);
                    if (credit == null || Convert.ToDecimal(credit) < account) throw new InvalidOperationException("La cuenta corriente supera el crédito disponible.");
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
                        authorization = FiscalAuthorize(afipType, point, number, date,
                            docId == 67 ? 80 : docId == 50 ? 96 : 99, docId == 32 ? "0" : doc.Replace(".", "").Replace(" ", ""), conditionIvaId,
                            grandTotal, net21 + net105, iva21 + iva105, net - net21 - net105,
                            net21, iva21, net105, iva105, companyCuit, associatedType, associatedNumber, associatedDate,
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
                    cash * sign, card * sign, net * sign, (iva21 + iva105 + other) * sign, branch, net21 * sign, iva21 * sign, net105 * sign, iva105 * sign, list, oper, quotation, 1, items.Count, account * sign, bank * sign,
                    note, marker, adjustment, net == 0 ? 0 : adjustment / net, typeId, grandTotal));
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
                    if (!quotation)
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
                    "SELECT COUNT(*) FROM dbo.FacturasATP WHERE IDRecibo=@p0 AND TotalME=@p1 AND FechaPriVto=DATEADD(month,1,@p2) AND Pagada=@p3", receipt, grandTotal, date, quotation)) != 1)
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
                    if (!quotation) stockExpected[id] -= Convert.ToDecimal(line[1]) * sign;
                }
                foreach (var expected in stockExpected)
                {
                    object actual = Scalar(connection, tx, "SELECT StockAct FROM dbo.ArtsStock WHERE IDArt=@p0 AND IDSuc=@p1", expected.Key, branch);
                    if (actual == null || actual == DBNull.Value || Math.Abs(Convert.ToDecimal(actual) - expected.Value) > .0001m)
                        throw new InvalidOperationException("La actualización de stock no coincide para " + expected.Key + ".");
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
        if (request.HttpMethod == "GET" && request.Url.AbsolutePath == "/impresoras")
        {
            try { Reply(context, 200, new { ok = true, impresoras = TicketPrinters() }); }
            catch (Exception) { Reply(context, 500, new { ok = false, error = "No se pudieron consultar las ticketeras de Windows." }); }
            return;
        }
        try
        {
            using (var connection = Connect())
            {
                if (request.HttpMethod == "GET" && request.Url.AbsolutePath == "/bootstrap")
                {
                    Reply(context, 200, new { ok = true, impresionDirecta = true, stockEnVivo = true,
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
                        "SELECT a.IDArt AS idart,a.IDArtProv AS codProv,a.[Descripción] AS descripcion," +
                        "(CASE @p1 WHEN 1 THEN a.PrecioVta1 WHEN 2 THEN a.PrecioVta2 ELSE a.PrecioVta3 END) * CASE WHEN a.IDMoneda=1 THEN CONVERT(decimal(18,4),1) ELSE m.ImpCotiz END AS precioFinal," +
                        "ISNULL(s.StockAct,0) AS stock,a.PorcIVA1*100 AS iva,a.IDMoneda AS idMoneda,CASE WHEN a.IDMoneda=1 THEN CONVERT(decimal(18,4),1) ELSE m.ImpCotiz END AS cotizacion,a.PrecioCpraCI * CASE WHEN a.IDMoneda=1 THEN CONVERT(decimal(18,4),1) ELSE m.ImpCotiz END AS costoFinal " +
                        "FROM dbo.[Artículos] a " +
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
                        "SELECT a.IDArt AS idart,ISNULL(s.StockAct,0) AS stock FROM dbo.[Artículos] a " +
                        "CROSS JOIN dbo.[Depósitos] d LEFT JOIN dbo.ArtsStock s ON s.IDArt=a.IDArt AND s.IDSuc=d.IDSucAsoc " +
                        "WHERE d.IDDepósito=@p0 AND a.IDArt IN (" + String.Join(",", names.ToArray()) + ")",
                        parameters);
                    Reply(context, 200, new { ok = true, stock });
                    return;
                }
                if (request.HttpMethod == "GET" && request.Url.AbsolutePath == "/clientes")
                {
                    string query = Text(request.QueryString["q"]);
                    if (query.Length > 80) throw new InvalidOperationException("Búsqueda demasiado larga.");
                    string[] words = query.Split((char[])null, StringSplitOptions.RemoveEmptyEntries);
                    if (words.Length > 8) throw new InvalidOperationException("Búsqueda demasiado larga.");
                    int startRow;
                    if (!int.TryParse(Text(request.QueryString["start"]), out startRow) || startRow < 1) startRow = 0;
                    if (startRow > 1000000) throw new InvalidOperationException("Página fuera de rango.");
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
                       .Append(" THEN 3 ELSE 4 END AS matchRank FROM dbo.Clientes WHERE Suspendido=0),")
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
                        "SELECT TOP 60 h.IDRecibo AS idRecibo,h.NroFactura AS numero,CONVERT(varchar(10),h.Fecha,103) AS fecha,h.ApeYNom AS cliente,h.IDCliente AS idCliente,h.TotalME AS total,h.CUIT AS documento,tc.Descripcion AS tipoOriginal " +
                        "FROM dbo.FacturasATP h JOIN dbo.TipoComprobantes tc ON tc.IDComprob=h.IDComprob WHERE ((@p0=29 AND h.IDComprob IN (1,2,13,43)) OR (@p0<>29 AND h.IDComprob=@p0)) AND h.Confirmado=-1 AND h.Anulada=0 AND (h.IDComprob IN (13,43) OR LEN(h.CAE)=14) " +
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
                        "h.IDTipoDocFis AS idTipoDoc,h.IDTipoIVA AS idTipoIva,h.[Dirección] AS direccion,h.[Teléfono] AS telefono,c.Email AS email,h.TotalME AS total " +
                        "FROM dbo.FacturasATP h LEFT JOIN dbo.Clientes c ON c.IDCliente=h.IDCliente " +
                        "WHERE h.IDRecibo=@p0 AND ((@p1=29 AND h.IDComprob IN (1,2,13,43)) OR (@p1<>29 AND h.IDComprob=@p1)) AND h.Confirmado=-1 AND h.Anulada=0 AND (h.IDComprob IN (13,43) OR LEN(h.CAE)=14)", receipt, invoiceType);
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
                if (request.HttpMethod == "GET" && request.Url.AbsolutePath == "/comprobante")
                {
                    int receipt = Id(request.QueryString["id"]);
                    var header = Rows(connection, "SELECT IDRecibo AS idRecibo,NroFactura AS numero,Fecha AS fecha,IDComprob AS idComprobante,IDDepósito AS idPuntoVenta,Confirmado AS confirmado,Anulada AS anulada,Total AS total,TotalME AS totalAbsoluto,IDCliente AS idCliente,ApeYNom AS cliente,CUIT AS documento,CAE AS cae,CASE WHEN LEN(CodBarra)=40 THEN SUBSTRING(CodBarra,32,8) ELSE '' END AS caeExpiry,NroFacNC AS facturaAsociada,IDVend AS vendedor,IDSuc AS sucursal,Impresa AS impresa,ActStock AS stockActualizado FROM dbo.FacturasATP WHERE IDRecibo=@p0 AND IDComprob IN (1,2,5,6,7,8,13,29,43)", receipt);
                    if (header.Count != 1) { Reply(context, 404, new { ok = false, error = "El comprobante no existe en SQL." }); return; }
                    Reply(context, 200, new { ok = true, comprobante = header[0],
                        articulos = Rows(connection, "SELECT IDArt AS idart,ArtDesc AS descripcion,Cantidad AS cantidad,PrecioUni AS precio,Importe AS importe FROM dbo.FacturasATS WHERE IDRecibo=@p0 ORDER BY Orden", receipt),
                        valores = Rows(connection, "SELECT IDTipoPago AS idTipoPago,Importe AS importe,ImpRec AS impRec,ImpEnt AS total,Cuotas AS cuotas,IDTarjeta AS idTarjeta,Coef AS coef,Concepto AS descripcion FROM dbo.FacturasTSVal WHERE IDRecibo=@p0 ORDER BY Orden", receipt) });
                    return;
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
                    Guid id;
                    if (!Guid.TryParse(request.QueryString["id"], out id))
                        throw new InvalidOperationException("Borrador inválido para verificar la emisión.");
                    int requestedType;
                    if (!Int32.TryParse(request.QueryString["tipo"], out requestedType)) requestedType = 0;
                    var found = Rows(connection,
                        "SELECT TOP 1 IDRecibo AS idRecibo,NroFactura AS numero,Confirmado AS confirmado,Anulada AS anulada FROM dbo.FacturasATP WHERE NroOTrab=@p0 ORDER BY IDRecibo DESC",
                        DraftMarker(id));
                    if (found.Count > 0)
                    {
                        bool issued = Convert.ToInt32(found[0]["confirmado"]) == -1 && Convert.ToInt32(found[0]["anulada"]) == 0;
                        Reply(context, 200, new { ok = true, estado = issued ? "emitido" : "pendiente",
                            idRecibo = found[0]["idRecibo"], numero = found[0]["numero"] });
                        return;
                    }
                    // Estos comprobantes no consultan ARCA. Con SQL disponible y sin la marca
                    // del borrador, se puede reintentar la misma venta sin duplicarla.
                    if (requestedType == 13 || requestedType == 29 || requestedType == 43)
                    {
                        Reply(context, 200, new { ok = true, estado = "reintentable" });
                        return;
                    }
                    string path = RecoveryPath(id);
                    if (File.Exists(path))
                    {
                        try
                        {
                            var recovered = Object(Json.DeserializeObject(Encoding.UTF8.GetString(
                                ProtectedData.Unprotect(File.ReadAllBytes(path), null, DataProtectionScope.CurrentUser))));
                            Reply(context, 200, new { ok = true, estado = "recuperable", numero = Text(Value(recovered, "number")) });
                            return;
                        }
                        catch { Reply(context, 200, new { ok = true, estado = "pendiente" }); return; }
                    }
                    string draftPath = PendingDraftPath(id);
                    if (File.Exists(draftPath))
                    {
                        var saved = Object(Json.DeserializeObject(Encoding.UTF8.GetString(
                            ProtectedData.Unprotect(File.ReadAllBytes(draftPath), null, DataProtectionScope.CurrentUser))));
                        var invoice = Object(Value(saved, "comprobante"));
                        string number = Text(Value(saved, "numero"));
                        if (Text(Value(saved, "fingerprint")) != DraftFingerprint(invoice) ||
                            !System.Text.RegularExpressions.Regex.IsMatch(number, @"^\d{4}-\d{8}$"))
                            throw new InvalidOperationException("La copia local de la venta no coincide con la solicitud fiscal.");
                        bool force = request.QueryString["consultarArca"] == "1";
                        bool consult;
                        lock (FiscalConsultTimes)
                        {
                            DateTime last;
                            consult = force || !FiscalConsultTimes.TryGetValue(id, out last) ||
                                DateTime.UtcNow - last >= TimeSpan.FromMinutes(1);
                            if (consult) FiscalConsultTimes[id] = DateTime.UtcNow;
                        }
                        if (consult)
                        {
                            try
                            {
                                int typeId = Id(Value(invoice, "idComprobante"));
                                int point = Id(Value(invoice, "idPuntoVenta"));
                                int afipType = Convert.ToInt32(Scalar(connection, null,
                                    "SELECT IDTipoAFIP FROM dbo.TipoComprobantes WHERE IDComprob=@p0 AND EnLibroIVA=1", typeId));
                                string cuit = Text(Scalar(connection, null,
                                    "SELECT CUIT FROM dbo.Empresa WHERE IDEmpresa=1")).Replace("-", "").Replace(" ", "");
                                var client = Object(Value(invoice, "cliente"));
                                string docType = Text(Value(client, "tipoDocumento"));
                                int docId = docType == "CUIT" ? 67 : docType == "DNI" ? 50 : docType == "Sin identificar" ? 32 : 0;
                                string doc = Text(Value(client, "numeroDocumento"));
                                if (Id(Value(invoice, "idCliente")) == 1 && docId == 50 &&
                                    (doc.Length == 0 || doc == "00000001000")) { docId = 32; doc = ""; }
                                int fiscalDocType = docId == 67 ? 80 : docId == 50 ? 96 : 99;
                                string fiscalDoc = docId == 32 ? "0" : doc.Replace(".", "").Replace(" ", "");
                                DateTime date = DateTime.ParseExact(Text(Value(invoice, "fecha")), "yyyy-MM-dd",
                                    CultureInfo.InvariantCulture);
                                decimal total = Number(Value(Object(Value(invoice, "totales")), "total"));
                                if (afipType < 1 || !ValidCuit(cuit) || point < 1 ||
                                    number.Substring(0, 4) != point.ToString("0000") || docId == 0)
                                    throw new InvalidOperationException("Faltan datos para consultar esta venta en ARCA.");
                                var authorization = FiscalConsult(afipType, point, number, cuit, date,
                                    fiscalDocType, fiscalDoc, total);
                                if (authorization != null)
                                {
                                    string recovery = Json.Serialize(new { number, total, typeId, point,
                                        cae = authorization.Cae, expiration = authorization.Expiration });
                                    using (var file = new FileStream(path, FileMode.CreateNew, FileAccess.Write, FileShare.None))
                                    {
                                        byte[] bytes = ProtectedData.Protect(Encoding.UTF8.GetBytes(recovery), null,
                                            DataProtectionScope.CurrentUser);
                                        file.Write(bytes, 0, bytes.Length);
                                        file.Flush(true);
                                    }
                                    Reply(context, 200, new { ok = true, estado = "recuperable", numero = number });
                                    return;
                                }
                            }
                            catch (InvalidOperationException ex)
                            {
                                Reply(context, 200, new { ok = true, estado = "incierto", detalle = ex.Message });
                                return;
                            }
                            catch (Exception)
                            {
                                Reply(context, 200, new { ok = true, estado = "incierto",
                                    detalle = "ARCA no respondió a la consulta. La venta sigue guardada para volver a verificar." });
                                return;
                            }
                        }
                    }
                    Reply(context, 200, new { ok = true, estado = "incierto" });
                    return;
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
        catch (FiscalRecoveryException ex) { Reply(context, 409, new { ok = false, error = ex.Message, recoveryRequired = true, numero = ex.Number }); }
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
        using (var listener = new HttpListener())
        {
            listener.Prefixes.Add("http://localhost:8081/");
            listener.Start();
            Console.WriteLine("Facturación copia: API de preparación en http://localhost:8081/");
            while (true)
            {
                var context = listener.GetContext();
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
                    (context.Request.Url.AbsolutePath == "/emitir" || context.Request.Url.AbsolutePath == "/imprimir");
                critical = critical || (context.Request.HttpMethod == "GET" && context.Request.Url.AbsolutePath == "/estado-emision");
                if (critical) Interlocked.Increment(ref activeCriticalRequests);
                ThreadPool.QueueUserWorkItem(_ =>
                {
                    try { Handle(context); }
                    finally { if (critical) Interlocked.Decrement(ref activeCriticalRequests); }
                });
            }
        }
    }
}
