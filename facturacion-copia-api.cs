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
    private static List<Dictionary<string, object>> CustomerDetail(SqlConnection connection, int id)
    {
        return Rows(connection,
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
    private static object SaveCustomer(SqlConnection connection, Dictionary<string, object> data)
    {
        int id = 0;
        if (Value(data, "id") != null && Text(Value(data, "id")) != "0") id = Id(Value(data, "id"));
        if (id == 1) throw new InvalidOperationException("No se puede modificar Consumidor Final desde Facturación.");
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
                object sameName = Scalar(connection, transaction,
                    "SELECT TOP 1 IDCliente FROM dbo.Clientes WITH (UPDLOCK,HOLDLOCK) WHERE [RazónSocial]=@p0 AND IDCliente<>@p1", name, id);
                if (sameName != null)
                    throw new InvalidOperationException("Ya existe el cliente " + name + ".");
                object duplicateDocumentName = Scalar(connection, transaction,
                    "SELECT TOP 1 [RazónSocial] FROM dbo.Clientes WITH (UPDLOCK,HOLDLOCK) WHERE REPLACE(REPLACE(CUIT,'-',''),' ','')=REPLACE(REPLACE(@p0,'-',''),' ','') AND IDCliente<>@p1", document, id);
                if (duplicateDocumentName != null)
                    throw new InvalidOperationException("Ya existe el cliente " + Text(duplicateDocumentName) + " con ese documento.");
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
    private static bool InvoiceDateAllowed(DateTime date, DateTime today)
    {
        return date.Date >= today.Date.AddDays(-5) && date.Date <= today.Date;
    }
    private static void AssertBackdatedInvoicePermission(Dictionary<string, object> invoice, DateTime date, DateTime today)
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
        if(!String.Equals(level,"administrador",StringComparison.OrdinalIgnoreCase))throw new InvalidOperationException("Solo los administradores pueden emitir con fecha anterior. La fecha debe ser la de hoy.");
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
            System.Globalization.DateTimeStyles.None, out date) || (!savedAuthorization && !InvoiceDateAllowed(date, DateTime.Today)))
            throw new InvalidOperationException("La fecha debe estar entre hoy y los 5 días corridos anteriores. No se permiten fechas futuras.");
        if(!savedAuthorization)AssertBackdatedInvoicePermission(invoice,date,DateTime.Today);
        var items = Value(invoice, "articulos") as System.Collections.ArrayList;
        var payments = Value(invoice, "valores") as System.Collections.ArrayList;
        if (items == null || items.Count == 0 || items.Count > 200) throw new InvalidOperationException("Agregá entre 1 y 200 artículos.");
        if (payments == null || payments.Count == 0 || payments.Count > 30) throw new InvalidOperationException("Cargá los valores recibidos.");
        string draft = Limited(Value(invoice, "id"), 80, "Identificador del borrador");
        Guid draftId;
        if (!Guid.TryParse(draft, out draftId)) throw new InvalidOperationException("El borrador no tiene un identificador válido.");
        string fiscalRecovery = RecoveryPath(draftId);
        int oper = LocalOperator(connection);
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
                    AssertStoredInvoice(connection, tx, prior, invoice);
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
                if (grandTotal <= 0 || Math.Abs(paidBase - gross) > .005m || Math.Abs(paid - grandTotal) > .005m)
                    throw new InvalidOperationException("Los valores recibidos no coinciden con el total recalculado en SQL.");
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
                    if (!quotation) stockExpected[id] = StoredStock(stockExpected[id] - Convert.ToDecimal(line[1]) * sign);
                }
                foreach (var expected in stockExpected)
                {
                    object actual = Scalar(connection, tx, "SELECT StockAct FROM dbo.ArtsStock WHERE IDArt=@p0 AND IDSuc=@p1", expected.Key, branch);
                    if (!StockMatches(actual, expected.Value))
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
    private static object StockActualizarCosto(SqlConnection connection, Dictionary<string, object> input)
    {
        LocalOperator(connection);
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
    private static object StockIngreso(SqlConnection connection, Dictionary<string, object> input, bool confirmar)
    {
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
        var fingerprintInput = new Dictionary<string, object>(input); fingerprintInput.Remove("accion");
        string fingerprint;
        using (var sha = SHA256.Create()) fingerprint = BitConverter.ToString(sha.ComputeHash(Encoding.UTF8.GetBytes(Json.Serialize(fingerprintInput)))).Replace("-", "");
        string hashMarker = "[HASH:" + fingerprint + "]";
        int operador = LocalOperator(connection);
        SqlTransaction tx = confirmar ? connection.BeginTransaction(IsolationLevel.Serializable) : null;
        try
        {
            if (confirmar && Convert.ToInt32(Scalar(connection, tx,
                "DECLARE @r int; EXEC @r=sp_getapplock @Resource=@p0,@LockMode='Exclusive',@LockOwner='Transaction',@LockTimeout=10000; SELECT @r", "CorralonWeb.StockIngreso." + requestId.ToString("N"))) < 0)
                throw new InvalidOperationException("Otra carga está en curso. Reintentá.");
            var saved = RowsTx(connection, tx, "SELECT TOP 1 IDRecibo,NroMov,IDSuc,IDTipoMov,Total,Nota FROM dbo.RecibosTP WHERE CHARINDEX(@p0,CONVERT(nvarchar(max),Nota))>0 AND Confirmado=1 ORDER BY IDRecibo DESC", marker);
            if (saved.Count > 0)
            {
                if (Text(saved[0]["Nota"]).IndexOf(hashMarker, StringComparison.Ordinal) < 0)
                    throw new InvalidOperationException("Este ingreso ya se confirmó con otros datos. Consultalo antes de continuar.");
                var savedLines = RowsTx(connection, tx, "SELECT d.IDArt AS idart,a.IDArtProv AS codigo,a.[Descripción] AS descripcion,d.Cantidad AS cantidad,d.PrecioUni AS precioUnitario,d.Importe AS importe,d.Stock AS stockAntes,s.StockAct AS stockDespues FROM dbo.RecibosTS d INNER JOIN dbo.[Artículos] a ON a.IDArt=d.IDArt LEFT JOIN dbo.ArtsStock s ON s.IDArt=d.IDArt AND s.IDSuc=@p1 WHERE d.IDRecibo=@p0 ORDER BY d.IDOrden", saved[0]["IDRecibo"], sucursal);
                if (tx != null) tx.Commit();
                return new { ok = true, yaCargado = true, idRecibo = saved[0]["IDRecibo"], numeroMovimiento = saved[0]["NroMov"], total = saved[0]["Total"], articulos = savedLines };
            }
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
            int receipt = Convert.ToInt32(Scalar(connection, tx, "INSERT dbo.RecibosTP (IDTipoMov,NroMov,Fecha,IDDepósito,IDVend,IDOper,IDProveedor,IDSuc,IDEmp,NroFactura,NroRemito,IDFactura,IDRemito,IDDepDes,Total,SubTSDto,Confirmado,Anulado,Nota,FechaYHora) OUTPUT INSERTED.IDRecibo VALUES (@p0,@p1,@p2,@p3,@p4,@p4,@p5,@p6,@p7,@p8,@p9,@p10,@p11,@p12,@p13,@p13,1,0,@p14,GETDATE())", movimiento, number, DateTime.Today, puntoVenta, operador, proveedor == 0 ? (object)DBNull.Value : proveedor, sucursal, empresa, numeroFactura.Length == 0 ? (object)DBNull.Value : numeroFactura, remito.Length == 0 ? (object)DBNull.Value : remito, compra == 0 ? (object)DBNull.Value : compra, relacionado == 0 ? (object)DBNull.Value : relacionado, destino, total, marker + hashMarker + " " + nota));
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
                int destinationReceipt = Convert.ToInt32(Scalar(connection, tx, "INSERT dbo.RecibosTP (IDTipoMov,NroMov,Fecha,IDDepósito,IDVend,IDOper,IDProveedor,IDSuc,IDEmp,IDDepDes,IDRecDes,Total,SubTSDto,Confirmado,Anulado,Nota,FechaYHora) OUTPUT INSERTED.IDRecibo VALUES (58,@p0,@p1,@p2,@p3,@p3,@p4,@p5,@p6,@p7,@p8,@p9,@p9,1,0,@p10,GETDATE())", destinationNumber, DateTime.Today, puntoVenta, operador, proveedor == 0 ? (object)DBNull.Value : proveedor, destino, empresa, sucursal, receipt, total, "Entrada relacionada: " + receipt + " " + nota));
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
    private static object StockConsulta(SqlConnection connection, HttpListenerRequest request)
    {
        int branch = 0, provider = 0, receipt = 0;
        Int32.TryParse(request.QueryString["sucursal"], out branch); Int32.TryParse(request.QueryString["proveedor"], out provider); Int32.TryParse(request.QueryString["recibo"], out receipt);
        string query = request.QueryString["consulta"] ?? "";
        if (query == "proveedores") return new { ok = true, proveedores = Rows(connection, "SELECT IDProveedor AS id,[RazónSocial] AS nombre FROM dbo.Proveedores WHERE ISNULL(Suspendido,0)=0 ORDER BY [RazónSocial]") };
        if (query == "articulos") return new { ok = true, articulos = Rows(connection, "SELECT a.IDArt AS idart,a.IDArtProv AS codProv,a.[Descripción] AS descripcion,a.IDProveedor AS proveedor,p.[RazónSocial] AS proveedorNombre,a.IDRubro AS idRubro,r.[Descripción] AS rubroNombre,a.PorcIVA1 AS iva,a.PorcGanMin AS margen,ISNULL(s.StockAct,0) AS stock,a.PrecioCpraSI AS precioCosto,a.PrecioCpraCI * CASE WHEN a.IDMoneda=1 THEN CONVERT(decimal(18,4),1) ELSE m.ImpCotiz END AS costoFinal FROM dbo.[Artículos] a LEFT JOIN dbo.ArtsStock s ON s.IDArt=a.IDArt AND s.IDSuc=@p0 LEFT JOIN dbo.Monedas m ON m.IDMoneda=a.IDMoneda LEFT JOIN dbo.Proveedores p ON p.IDProveedor=a.IDProveedor LEFT JOIN dbo.Rubros r ON r.IDRubro=a.IDRubro WHERE a.Suspendido=0 ORDER BY a.[Descripción]", branch) };
        if (query == "compras") return new { ok = true, compras = Rows(connection, "SELECT IDRecibo AS id,NroFactura AS numero,CONVERT(varchar(10),Fecha,103) AS fecha,Total AS total FROM dbo.ComprasTP WHERE IDProveedor=@p0 AND Fecha>=DATEADD(day,-90,GETDATE()) AND Confirmado=1 AND EnMovStk=1 AND IDMovStk IS NULL ORDER BY Fecha DESC", provider) };
        if (query == "movimientos")
        {
            int before;
            if(!Int32.TryParse(request.QueryString["antes"]??"0",out before)||before<0)throw new InvalidOperationException("Página de movimientos inválida.");
            DateTime from,to;
            if(!DateTime.TryParseExact(request.QueryString["desde"]??DateTime.Today.ToString("yyyy-MM-dd"),"yyyy-MM-dd",CultureInfo.InvariantCulture,DateTimeStyles.None,out from)||
               !DateTime.TryParseExact(request.QueryString["hasta"]??DateTime.Today.ToString("yyyy-MM-dd"),"yyyy-MM-dd",CultureInfo.InvariantCulture,DateTimeStyles.None,out to)||from>to||to==DateTime.MaxValue.Date)
                throw new InvalidOperationException("Rango de fechas inválido.");
            var records=Rows(connection,"SELECT TOP 201 r.IDRecibo AS id,r.NroMov AS numero,r.IDSuc AS sucursal,r.IDTipoMov AS tipo,r.IDProveedor AS proveedor,r.IDDepósito AS puntoVenta,r.IDDepDes AS destino,r.IDFactura AS compra,r.IDRemito AS relacionado,r.NroFactura AS factura,r.NroRemito AS remito,CONVERT(varchar(10),r.Fecha,103) AS fecha,t.Descripcion AS nombre,p.[RazónSocial] AS proveedorNombre,r.Total AS total,r.Nota AS nota FROM dbo.RecibosTP r LEFT JOIN dbo.TipoComprobantes t ON t.IDComprob=r.IDTipoMov LEFT JOIN dbo.Proveedores p ON p.IDProveedor=r.IDProveedor WHERE (@p0=0 OR r.IDSuc=@p0) AND r.Confirmado=1 AND r.Anulado=0 AND (@p1=0 OR r.IDRecibo<@p1) AND r.Fecha>=@p2 AND r.Fecha<@p3 AND (@p4=0 OR r.IDProveedor=@p4) ORDER BY r.IDRecibo DESC",branch,before,from,to.AddDays(1),provider);
            bool more=records.Count>200;if(more)records.RemoveAt(200);
            int count=Convert.ToInt32(Scalar(connection,null,"SELECT COUNT(*) FROM dbo.RecibosTP WHERE (@p0=0 OR IDSuc=@p0) AND Confirmado=1 AND Anulado=0 AND Fecha>=@p1 AND Fecha<@p2 AND (@p3=0 OR IDProveedor=@p3)",branch,from,to.AddDays(1),provider));
            return new {ok=true,movimientos=records,hayMas=more,total=count};
        }
        if (query == "detalle") return new { ok = true, articulos = Rows(connection, "SELECT d.IDArt AS idart,a.IDArtProv AS codigo,a.[Descripción] AS descripcion,d.Cantidad AS cantidad,d.PrecioUni AS precioUnitario,d.Importe AS importe,ISNULL(s.StockAct,0) AS stock FROM dbo.RecibosTS d INNER JOIN dbo.RecibosTP r ON r.IDRecibo=d.IDRecibo INNER JOIN dbo.[Artículos] a ON a.IDArt=d.IDArt LEFT JOIN dbo.ArtsStock s ON s.IDArt=d.IDArt AND s.IDSuc=r.IDSuc WHERE d.IDRecibo=@p0 AND r.IDSuc=@p1 AND r.Confirmado=1 AND r.Anulado=0 ORDER BY d.IDOrden", receipt, branch) };
        if (query == "relacionados") return new { ok = true, relacionados = Rows(connection, "SELECT TOP 200 r.IDRecibo AS id,r.NroMov AS numero,t.Abreviatura AS tipo,CONVERT(varchar(10),r.Fecha,103) AS fecha FROM dbo.RecibosTP r INNER JOIN dbo.TipoComprobantes t ON t.IDComprob=r.IDTipoMov WHERE r.IDSuc=@p0 AND r.Confirmado=1 AND r.Anulado=0 AND r.Completo=0 AND r.Fecha>=DATEADD(day,-30,GETDATE()) ORDER BY r.IDRecibo DESC", branch) };
        if (query == "pendientes") return new { ok = true, articulos = Rows(connection, "SELECT d.IDArt AS idart,a.IDArtProv AS codigo,a.[Descripción] AS descripcion,SUM(d.Cantidad)-ISNULL((SELECT SUM(e.Cantidad) FROM dbo.RecibosTS e INNER JOIN dbo.RecibosTP h ON h.IDRecibo=e.IDRecibo WHERE h.IDRemito=@p0 AND h.Confirmado=1 AND h.Anulado=0 AND e.IDArt=d.IDArt),0) AS cantidad,MAX(d.PrecioUni) AS precioUnitario FROM dbo.RecibosTS d INNER JOIN dbo.RecibosTP r ON r.IDRecibo=d.IDRecibo INNER JOIN dbo.[Artículos] a ON a.IDArt=d.IDArt WHERE d.IDRecibo=@p0 AND r.IDSuc=@p1 AND r.Confirmado=1 AND r.Anulado=0 GROUP BY d.IDArt,a.IDArtProv,a.[Descripción] HAVING SUM(d.Cantidad)>ISNULL((SELECT SUM(e.Cantidad) FROM dbo.RecibosTS e INNER JOIN dbo.RecibosTP h ON h.IDRecibo=e.IDRecibo WHERE h.IDRemito=@p0 AND h.Confirmado=1 AND h.Anulado=0 AND e.IDArt=d.IDArt),0)", receipt, branch) };
        int oper = LocalOperator(connection);
        return new { ok = true, operador = Rows(connection, "SELECT IDEmpleado AS id,Nombre AS nombre FROM dbo.Empleados WHERE IDEmpleado=@p0", oper),
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
                        {"idRevision",Value(review,"id")},{"destinatario","benja"},{"estado","pendiente"},
                        {"cliente",Value(Object(Value(sale,"cliente")),"nombre")},{"total",Value(Object(Value(sale,"totales")),"total")},
                        {"usuario",Value(sale,"usuario")},{"fecha",Value(sale,"fecha")},{"motivo",Value(review,"motivo")},
                        {"creadoAt",Value(review,"creadoAt")},{"url",Value(review,"url")}
                    }) fields[pair.Key] = new { stringValue = Text(pair.Value) };
                    string url = "https://firestore.googleapis.com/v1/projects/corralon-progreso/databases/(default)/documents/facturacionRevisiones/" + Text(Value(review,"id")) + "?currentDocument.exists=false&key=AIzaSyCxwUGX-rVusOI13j7oTfQuAtkeNXdAYH0";
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
                    if (action == "actualizar-costo") { Reply(context, 200, StockActualizarCosto(connection, data)); return; }
                    if (action != "previsualizar" && action != "confirmar") throw new InvalidOperationException("Acción de stock inválida.");
                    Reply(context, 200, StockIngreso(connection, data, action == "confirmar"));
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
                    if (Text(request.QueryString["opciones"]) == "1")
                    {
                        Reply(context, 200, new { ok = true,
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
                        Reply(context, 200, new { ok = true, cliente = detail[0] });
                        return;
                    }
                    if (Text(request.QueryString["catalogo"]) == "1")
                    {
                        Reply(context, 200, new { ok = true, catalogoCompleto = true, clientes = Rows(connection,
                            "SELECT IDCliente AS id,[RazónSocial] AS nombre,CUIT AS documento,IDTipoIVA AS idTipoIva,IDTipoDoc AS idTipoDoc," +
                            "[Dirección] AS direccion,[Teléfono] AS telefono,Email AS email " +
                            "FROM dbo.Clientes WHERE Suspendido=0 ORDER BY [RazónSocial],IDCliente") });
                        return;
                    }
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
                if (request.HttpMethod == "POST" && request.Url.AbsolutePath == "/clientes")
                {
                    if (!(request.ContentType ?? "").StartsWith("application/json", StringComparison.OrdinalIgnoreCase))
                        throw new InvalidOperationException("Se esperaba un cliente JSON.");
                    string body;
                    using (var reader = new StreamReader(request.InputStream, Encoding.UTF8)) body = reader.ReadToEnd();
                    if (body.Length > 20000) throw new InvalidOperationException("La ficha de cliente es demasiado grande.");
                    Reply(context, 200, SaveCustomer(connection, Object(Json.DeserializeObject(body))));
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
                    string search=Limited(request.QueryString["buscar"],80,"Búsqueda");
                    string pattern="%"+search.Replace("[","[[]").Replace("%","[%]").Replace("_","[_]")+"%";
                    var records=Rows(connection,
                        "SELECT f.IDRecibo AS idRecibo,f.NroFactura AS numero,CONVERT(varchar(10),f.Fecha,103) AS fecha,f.IDComprob AS idComprobante,t.Descripcion AS tipo,f.ApeYNom AS cliente,f.IDSuc AS idSucursal,s.Sucursal AS sucursal,f.Total AS total,f.Anulada AS anulada,f.IDDepósito AS puntoVenta " +
                        "FROM dbo.FacturasATP f LEFT JOIN dbo.TipoComprobantes t ON t.IDComprob=f.IDComprob LEFT JOIN dbo.Sucursales s ON s.IDSuc=f.IDSuc " +
                        "WHERE f.Confirmado<>0 AND f.IDComprob IN (1,2,5,6,7,8,13,29,43) AND f.Fecha>=@p0 AND f.Fecha<@p1 " +
                        "AND (@p2=0 OR f.IDSuc=@p2) AND (@p6=0 OR f.IDDepósito=@p6) AND (@p3='' OR f.ApeYNom LIKE @p4 OR f.NroFactura LIKE @p4) " +
                        "ORDER BY f.Fecha DESC,f.IDRecibo DESC OFFSET @p5 ROWS FETCH NEXT 51 ROWS ONLY",
                        from.Date,to.Date.AddDays(1),branch,search,pattern,page*50,point);
                    bool more=records.Count>50;if(more)records.RemoveAt(50);
                    Reply(context,200,new {ok=true,comprobantes=records,pagina=page,hayMas=more});return;
                }
                if (request.HttpMethod == "GET" && request.Url.AbsolutePath == "/comprobante")
                {
                    int receipt = Id(request.QueryString["id"]);
                    var header = Rows(connection, "SELECT IDRecibo AS idRecibo,NroFactura AS numero,Fecha AS fecha,CONVERT(varchar(10),Fecha,23) AS fechaComprobante,IDComprob AS idComprobante,IDDepósito AS idPuntoVenta,Confirmado AS confirmado,Anulada AS anulada,Total AS total,TotalME AS totalAbsoluto,IDCliente AS idCliente,ApeYNom AS cliente,CUIT AS documento,CAE AS cae,CASE WHEN LEN(CodBarra)=40 THEN SUBSTRING(CodBarra,32,8) ELSE '' END AS caeExpiry,NroFacNC AS facturaAsociada,IDVend AS vendedor,IDSuc AS sucursal,Impresa AS impresa,ActStock AS stockActualizado,IDTipoIVA AS idTipoIva,IDTipoDocFis AS idTipoDoc,[Dirección] AS direccion,[Teléfono] AS telefono,Nota AS nota FROM dbo.FacturasATP WHERE IDRecibo=@p0 AND IDComprob IN (1,2,5,6,7,8,13,29,43)", receipt);
                    if (header.Count != 1) { Reply(context, 404, new { ok = false, error = "El comprobante no existe en SQL." }); return; }
                    Reply(context, 200, new { ok = true, comprobante = header[0],
                        articulos = Rows(connection, "SELECT IDArt AS idart,ArtDesc AS descripcion,Cantidad AS cantidad,PrecioUni AS precio,Importe AS importe FROM dbo.FacturasATS WHERE IDRecibo=@p0 ORDER BY Orden", receipt),
                        valores = Rows(connection, "SELECT v.IDTipoPago AS idTipoPago,p.TipoPago AS tipo,v.Importe AS importe,v.ImpRec AS impRec,v.ImpEnt AS total,v.Cuotas AS cuotas,v.IDTarjeta AS idTarjeta,t.[Descripción] AS tarjeta,v.Coef AS coef,v.Concepto AS descripcion FROM dbo.FacturasTSVal v LEFT JOIN dbo.TiposPagos p ON p.IDTipoPago=v.IDTipoPago LEFT JOIN dbo.Tarjetas t ON t.IDTarjeta=v.IDTarjeta WHERE v.IDRecibo=@p0 ORDER BY v.Orden", receipt) });
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
                    // Al restaurar una pantalla sólo consultar SQL y las copias pendientes;
                    // no habilitar edición de una venta cuyo resultado fiscal esté guardado.
                    if (request.QueryString["soloSql"] == "1")
                    {
                        bool pending = File.Exists(RecoveryPath(id)) || File.Exists(PendingDraftPath(id));
                        Reply(context, 200, new { ok = true, estado = pending ? "pendiente" : "sinRegistro" });
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
        catch (SaleReviewException ex) { Reply(context, 409, new { ok = false, error = ex.Message, revisionRequired = true, recoveryRequired = true }); }
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
                     context.Request.Url.AbsolutePath == "/stock-ingreso");
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
