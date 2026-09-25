using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Printing;
using System.IO;
using System.Linq;
using System.Net;
using System.Net.Sockets;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Web.Script.Serialization;
using System.Windows.Forms;

// Conector de impresión de cada puesto. Solo escucha en 127.0.0.1 y acepta
// solicitudes del origen de Facturación elegido durante la instalación.
internal static class ImpresoraLocal
{
    private static readonly JavaScriptSerializer Json = new JavaScriptSerializer { MaxJsonLength = 16777216 };
    private static readonly string Folder = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "CorralonProgreso");
    private static readonly string InstalledExe = Path.Combine(Folder, "ImpresoraLocal.exe");
    private static readonly string OriginFile = Path.Combine(Folder, "impresora-origen.txt");
    private const int Port = 8082;

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

    [STAThread]
    private static void Main(string[] args)
    {
        if (args.Length > 0 && args[0] == "--agent") { Run(args.Length > 1 ? args[1] : null); return; }
        Application.EnableVisualStyles();
        using (var form = new Form { Text = "Impresora local de Facturación", Width = 440, Height = 220, StartPosition = FormStartPosition.CenterScreen, FormBorderStyle = FormBorderStyle.FixedDialog, MaximizeBox = false })
        {
            var label = new Label { Text = "Dirección de Facturación que abrís en esta PC:", Left = 18, Top = 22, Width = 390 };
            var input = new TextBox { Text = File.Exists(OriginFile) ? File.ReadAllText(OriginFile).Trim() : "http://192.168.100.28:8080", Left = 18, Top = 47, Width = 385 };
            var explanation = new Label { Text = "Instalá este conector una sola vez. Después, en Facturación, tocá Elegir impresora y Actualizar lista.", Left = 18, Top = 83, Width = 390, Height = 43 };
            var button = new Button { Text = "Instalar y conectar", Left = 224, Top = 135, Width = 178, Height = 32 };
            button.Click += (sender, e) =>
            {
                try
                {
                    Uri uri;
                    if (!Uri.TryCreate(input.Text.Trim().TrimEnd('/'), UriKind.Absolute, out uri) || uri.Scheme != "http" || uri.Port != 8080 || uri.UserInfo.Length > 0 || uri.AbsolutePath != "/")
                        throw new InvalidOperationException("Ingresá una dirección como http://192.168.100.28:8080");
                    string origin = uri.GetLeftPart(UriPartial.Authority);
                    Directory.CreateDirectory(Folder);
                    foreach (var process in Process.GetProcessesByName("ImpresoraLocal"))
                    {
                        try { if (process.Id != Process.GetCurrentProcess().Id && String.Equals(process.MainModule.FileName, InstalledExe, StringComparison.OrdinalIgnoreCase)) { process.Kill(); process.WaitForExit(3000); } }
                        catch { }
                        finally { process.Dispose(); }
                    }
                    string current = Process.GetCurrentProcess().MainModule.FileName;
                    if (!String.Equals(current, InstalledExe, StringComparison.OrdinalIgnoreCase)) File.Copy(current, InstalledExe, true);
                    File.WriteAllText(OriginFile, origin, Encoding.UTF8);
                    string startup = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Startup), "CorralonProgreso-Impresora.cmd");
                    File.WriteAllText(startup, "@echo off\r\nstart \"\" /min \"" + InstalledExe + "\" --agent\r\n", Encoding.Default);
                    Process.Start(new ProcessStartInfo { FileName = InstalledExe, Arguments = "--agent", UseShellExecute = false, CreateNoWindow = true, WindowStyle = ProcessWindowStyle.Hidden });
                    bool connected = false;
                    for (int attempt = 0; attempt < 20 && !connected; attempt++)
                    {
                        Thread.Sleep(100);
                        try
                        {
                            var request = (HttpWebRequest)WebRequest.Create("http://127.0.0.1:8082/impresoras");
                            request.Proxy = null; request.Timeout = 600; request.Headers["Origin"] = origin;
                            using (var response = (HttpWebResponse)request.GetResponse()) connected = response.StatusCode == HttpStatusCode.OK;
                        }
                        catch { }
                    }
                    if (!connected) throw new InvalidOperationException("El conector no pudo iniciar en el puerto 8082 de esta PC.");
                    MessageBox.Show("Conector instalado para " + origin + ". Volvé a Facturación y actualizá la lista de impresoras.", "Listo", MessageBoxButtons.OK, MessageBoxIcon.Information);
                    form.Close();
                }
                catch (Exception ex) { MessageBox.Show(ex.Message, "No se pudo instalar", MessageBoxButtons.OK, MessageBoxIcon.Error); }
            };
            form.Controls.AddRange(new Control[] { label, input, explanation, button });
            Application.Run(form);
        }
    }

    private static void Run(string overrideOrigin)
    {
        if (overrideOrigin == null && !File.Exists(OriginFile)) return;
        string allowedOrigin = (overrideOrigin ?? File.ReadAllText(OriginFile, Encoding.UTF8)).Trim();
        var listener = new TcpListener(IPAddress.Loopback, Port);
        try { listener.Start(); }
        catch (SocketException) { return; }
        while (true)
        {
            TcpClient client;
            try { client = listener.AcceptTcpClient(); }
            catch { break; }
            ThreadPool.QueueUserWorkItem(state => Handle((TcpClient)state, allowedOrigin), client);
        }
    }

    private static void Handle(TcpClient client, string allowedOrigin)
    {
        using (client)
        {
            client.ReceiveTimeout = 30000;
            client.SendTimeout = 30000;
            using (var stream = client.GetStream())
            {
                string origin = "";
                try
                {
                    var header = new MemoryStream();
                    int tail = 0, b;
                    while ((b = stream.ReadByte()) >= 0)
                    {
                        if (header.Length >= 32768) throw new InvalidOperationException("Cabecera demasiado larga.");
                        header.WriteByte((byte)b);
                        tail = ((tail << 8) | b);
                        if (tail == unchecked((int)0x0d0a0d0a)) break;
                    }
                    string raw = Encoding.ASCII.GetString(header.ToArray());
                    string[] lines = raw.Split(new[] { "\r\n" }, StringSplitOptions.None);
                    string[] first = lines[0].Split(' ');
                    if (first.Length < 2) throw new InvalidOperationException("Solicitud inválida.");
                    string method = first[0], path = first[1];
                    var fields = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
                    for (int i = 1; i < lines.Length; i++)
                    {
                        int colon = lines[i].IndexOf(':');
                        if (colon > 0) fields[lines[i].Substring(0, colon)] = lines[i].Substring(colon + 1).Trim();
                    }
                    fields.TryGetValue("Origin", out origin);
                    if (!String.Equals(origin, allowedOrigin, StringComparison.OrdinalIgnoreCase))
                    { Reply(stream, 403, new { ok = false, error = "Origen de Facturación no autorizado en esta PC." }, ""); return; }
                    if (method == "OPTIONS") { Reply(stream, 200, new { ok = true }, origin); return; }
                    if (method == "GET" && path == "/impresoras")
                    { Reply(stream, 200, new { ok = true, impresoras = TicketPrinters() }, origin); return; }
                    if (method == "POST" && path == "/imprimir")
                    {
                        int length;
                        if (!fields.ContainsKey("Content-Type") || !fields["Content-Type"].StartsWith("application/json", StringComparison.OrdinalIgnoreCase) ||
                            !fields.ContainsKey("Content-Length") || !Int32.TryParse(fields["Content-Length"], out length) || length < 1 || length > 8500000)
                            throw new InvalidOperationException("Ticket inválido o demasiado grande.");
                        byte[] body = new byte[length]; int read = 0;
                        while (read < length) { int count = stream.Read(body, read, length - read); if (count <= 0) throw new IOException("Ticket incompleto."); read += count; }
                        var data = Json.DeserializeObject(Encoding.UTF8.GetString(body)) as Dictionary<string, object>;
                        if (data == null || !data.ContainsKey("idRecibo") || Convert.ToInt32(data["idRecibo"]) <= 0)
                            throw new InvalidOperationException("Falta el comprobante emitido.");
                        int receipt = Convert.ToInt32(data["idRecibo"]);
                        VerifyReceipt(allowedOrigin, receipt);
                        string printer = Convert.ToString(data["impresora"]), image = Convert.ToString(data["imagen"]);
                        PrintRawTicket(printer, image, "Corralón Progreso " + receipt);
                        Reply(stream, 200, new { ok = true, impresora = printer }, origin);
                        return;
                    }
                    Reply(stream, 404, new { ok = false, error = "Ruta no disponible." }, origin);
                }
                catch (Exception ex) { try { Reply(stream, 400, new { ok = false, error = ex.Message }, origin); } catch { } }
            }
        }
    }

    private static void VerifyReceipt(string centralOrigin, int receipt)
    {
        try
        {
            var request = (HttpWebRequest)WebRequest.Create(centralOrigin + "/api/facturacion/comprobante?id=" + receipt);
            request.Proxy = null; request.Timeout = 8000; request.ReadWriteTimeout = 8000;
            using (var response = (HttpWebResponse)request.GetResponse())
            using (var reader = new StreamReader(response.GetResponseStream(), Encoding.UTF8))
            {
                var envelope = Json.DeserializeObject(reader.ReadToEnd()) as Dictionary<string, object>;
                var header = envelope != null && envelope.ContainsKey("comprobante") ? envelope["comprobante"] as Dictionary<string, object> : null;
                if (header == null || !Convert.ToBoolean(envelope["ok"]) || Convert.ToInt32(header["idRecibo"]) != receipt ||
                    Convert.ToInt32(header["confirmado"]) != -1 || Convert.ToInt32(header["anulada"]) != 0)
                    throw new InvalidOperationException("El comprobante no está confirmado en SQL.");
                int type = Convert.ToInt32(header["idComprobante"]);
                if (new[] { 1, 2, 5, 6, 7, 8 }.Contains(type) && !System.Text.RegularExpressions.Regex.IsMatch(Convert.ToString(header["cae"]), @"^\d{14}$"))
                    throw new InvalidOperationException("Falta el CAE fiscal en SQL.");
            }
        }
        catch (Exception ex) { throw new InvalidOperationException("No se pudo verificar la boleta en SQL; no se imprimió. " + ex.Message); }
    }

    private static void Reply(Stream stream, int status, object data, string origin)
    {
        byte[] body = Encoding.UTF8.GetBytes(Json.Serialize(data));
        var headers = new StringBuilder("HTTP/1.1 ").Append(status).Append(status == 200 ? " OK" : " Error").Append("\r\nContent-Type: application/json; charset=utf-8\r\nCache-Control: no-store\r\nConnection: close\r\nContent-Length: ").Append(body.Length).Append("\r\n");
        if (origin.Length > 0) headers.Append("Access-Control-Allow-Origin: ").Append(origin).Append("\r\nAccess-Control-Allow-Methods: GET, POST, OPTIONS\r\nAccess-Control-Allow-Headers: Content-Type\r\nAccess-Control-Allow-Private-Network: true\r\nVary: Origin\r\n");
        headers.Append("\r\n");
        byte[] prefix = Encoding.ASCII.GetBytes(headers.ToString());
        stream.Write(prefix, 0, prefix.Length); stream.Write(body, 0, body.Length); stream.Flush();
    }

    private static List<string> TicketPrinters()
    {
        var names = new List<string>();
        foreach (string name in PrinterSettings.InstalledPrinters)
            names.Add(name);
        names.Sort(StringComparer.CurrentCultureIgnoreCase);
        return names;
    }

    private static void PrintRawTicket(string printer, string pngBase64, string jobName)
    {
        if (!TicketPrinters().Contains(printer)) throw new InvalidOperationException("La ticketera elegida no está instalada en esta PC.");
        byte[] png;
        try { png = Convert.FromBase64String(pngBase64); }
        catch { throw new InvalidOperationException("La imagen del ticket no es válida."); }
        if (png.Length < 100 || png.Length > 6000000) throw new InvalidOperationException("El ticket supera el tamaño permitido.");
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
                output.WriteByte(0x1B); output.WriteByte(0x40);
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
                output.Write(new byte[] { 0x1B, 0x64, 0x03, 0x1D, 0x56, 0x00 }, 0, 6);
                IntPtr handle;
                if (!OpenPrinter(printer, out handle, IntPtr.Zero)) throw new InvalidOperationException("Windows no pudo abrir la ticketera.");
                try
                {
                    var info = new PrintDocInfo { Name = jobName, DataType = "RAW" };
                    if (StartDocPrinter(handle, 1, ref info) == 0) throw new InvalidOperationException("Windows no pudo crear el trabajo de impresión.");
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
}
