using System;
using System.Drawing;
using System.Globalization;
using System.IO;
using System.IO.Compression;
using System.Drawing.Imaging;
using System.Runtime.InteropServices;
using System.Net;
using System.Net.Sockets;
using System.Text;
using System.Text.RegularExpressions;
using Microsoft.Win32;

internal static class PrintLinkTicket
{
    internal static string QueueFor(string printer)
    {
        using (var key = Registry.LocalMachine.OpenSubKey(@"SYSTEM\CurrentControlSet\Control\Print\Printers\" + printer))
        {
            string port = key == null ? "" : Convert.ToString(key.GetValue("Port"));
            var match = Regex.Match(port ?? "", @"^TP-LPR-([a-f0-9]{24})$", RegexOptions.IgnoreCase);
            return match.Success ? match.Groups[1].Value.ToLowerInvariant() : "";
        }
    }

    private static void Write(Stream stream, string text)
    {
        byte[] bytes = Encoding.ASCII.GetBytes(text);
        stream.Write(bytes, 0, bytes.Length);
    }

    private static byte[] Grayscale(Image source)
    {
        using (var bitmap = new Bitmap(source.Width, source.Height, PixelFormat.Format24bppRgb))
        using (var compressed = new MemoryStream())
        {
            using (var graphics = Graphics.FromImage(bitmap))
            {
                graphics.Clear(Color.White);
                graphics.DrawImageUnscaled(source, 0, 0);
            }
            var data = bitmap.LockBits(new Rectangle(0, 0, bitmap.Width, bitmap.Height), ImageLockMode.ReadOnly, PixelFormat.Format24bppRgb);
            uint a = 1, b = 0;
            try
            {
                compressed.WriteByte(0x78); compressed.WriteByte(0x9C);
                using (var deflate = new DeflateStream(compressed, CompressionMode.Compress, true))
                {
                    byte[] colors = new byte[bitmap.Width * 3], row = new byte[bitmap.Width];
                    for (int y = 0; y < bitmap.Height; y++)
                    {
                        Marshal.Copy(IntPtr.Add(data.Scan0, y * data.Stride), colors, 0, colors.Length);
                        for (int x = 0, offset = 0; x < row.Length; x++, offset += 3)
                        {
                            row[x] = (byte)((colors[offset + 2] * 299 + colors[offset + 1] * 587 + colors[offset] * 114) / 1000);
                            a = (a + row[x]) % 65521; b = (b + a) % 65521;
                        }
                        deflate.Write(row, 0, row.Length);
                    }
                }
                uint checksum = (b << 16) | a;
                for (int shift = 24; shift >= 0; shift -= 8) compressed.WriteByte((byte)(checksum >> shift));
                return compressed.ToArray();
            }
            finally { bitmap.UnlockBits(data); }
        }
    }

    internal static byte[] Pdf(Image source)
    {
        byte[] pixels = Grayscale(source);
        double width = 80 * 72 / 25.4, ink = width * 560 / 576;
        string w = width.ToString("0.###", CultureInfo.InvariantCulture);
        string h = (ink * source.Height / source.Width).ToString("0.###", CultureInfo.InvariantCulture);
        string content = "q " + ink.ToString("0.###", CultureInfo.InvariantCulture) + " 0 0 " + h + " " +
            (width * 8 / 576).ToString("0.###", CultureInfo.InvariantCulture) + " 0 cm /Ticket Do Q\n";
        using (var pdf = new MemoryStream())
        {
            long[] offsets = new long[6];
            Write(pdf, "%PDF-1.4\n");
            string[] objects = {
                "<< /Type /Catalog /Pages 2 0 R >>",
                "<< /Type /Pages /Count 1 /Kids [3 0 R] >>",
                "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 " + w + " " + h + "] /Resources << /XObject << /Ticket 5 0 R >> >> /Contents 4 0 R >>",
                "<< /Length " + content.Length + " >>\nstream\n" + content + "endstream",
                "<< /Type /XObject /Subtype /Image /Width " + source.Width + " /Height " + source.Height +
                    " /ColorSpace /DeviceGray /BitsPerComponent 8 /Interpolate false /Filter /FlateDecode /Length " + pixels.Length + " >>\nstream\n"
            };
            for (int i = 1; i < offsets.Length; i++)
            {
                offsets[i] = pdf.Position;
                Write(pdf, i + " 0 obj\n" + objects[i - 1]);
                if (i == 5) { pdf.Write(pixels, 0, pixels.Length); Write(pdf, "\nendstream"); }
                Write(pdf, "\nendobj\n");
            }
            long xref = pdf.Position;
            Write(pdf, "xref\n0 6\n0000000000 65535 f \n");
            for (int i = 1; i < offsets.Length; i++) Write(pdf, offsets[i].ToString("D10") + " 00000 n \n");
            Write(pdf, "trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n" + xref + "\n%%EOF\n");
            return pdf.ToArray();
        }
    }

    private static void Ack(Stream stream)
    {
        if (stream.ReadByte() != 0) throw new IOException("Print Link no aceptó el trabajo.");
    }

    private static void Part(Stream stream, byte type, string name, byte[] bytes)
    {
        stream.WriteByte(type);
        Write(stream, bytes.Length + " " + name + "\n");
        Ack(stream);
        stream.Write(bytes, 0, bytes.Length);
        stream.WriteByte(0);
        Ack(stream);
    }

    internal static void Send(string queue, string title, byte[] pdf, int port = 515)
    {
        string suffix = Guid.NewGuid().ToString("N"), data = "dfA001" + suffix;
        string safeTitle = Regex.Replace(title ?? "Ticket", @"[\x00-\x1F\x7F]", " ");
        if (safeTitle.Length > 120) safeTitle = safeTitle.Substring(0, 120);
        byte[] control = Encoding.UTF8.GetBytes("H" + Environment.MachineName + "\nPFacturacion\nJ" + safeTitle + "\nf" + data + "\nU" + data + "\n");
        try
        {
            using (var client = new TcpClient(AddressFamily.InterNetwork))
            {
                client.SendTimeout = client.ReceiveTimeout = 8000;
                client.Connect(IPAddress.Loopback, port);
                using (var stream = client.GetStream())
                {
                    stream.WriteByte(2);
                    Write(stream, queue + "\n");
                    Ack(stream);
                    Part(stream, 2, "cfA001" + suffix, control);
                    Part(stream, 3, data, pdf);
                }
            }
        }
        catch (SocketException ex) { throw new InvalidOperationException("No se pudo conectar con la cola local de Print Link.", ex); }
        catch (IOException ex) { throw new InvalidOperationException("Print Link no confirmó la recepción del ticket.", ex); }
    }
}
