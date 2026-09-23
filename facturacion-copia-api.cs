using System;
using System.Collections.Generic;
using System.Data;
using System.Data.SqlClient;
using System.IO;
using System.Net;
using System.Security.Cryptography;
using System.Text;
using System.Threading;
using System.Web.Script.Serialization;
using Microsoft.Win32;

// Servicio local de la copia de Facturación. Sólo PRES. ESPECIAL puede emitirse.
internal static class FacturacionCopiaApi
{
    private static readonly JavaScriptSerializer Json = new JavaScriptSerializer { MaxJsonLength = 16777216 };
    private static readonly string[] Origins = { "http://localhost:8080", "http://127.0.0.1:8080", "http://localhost:8081", "http://127.0.0.1:8081" };

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
    private static object Emit(SqlConnection connection, Dictionary<string, object> invoice, bool dryRun)
    {
        if (Id(Value(invoice, "idComprobante")) != 13) throw new InvalidOperationException("Sólo se puede emitir PRES. ESPECIAL desde esta copia.");
        int point = Id(Value(invoice, "idPuntoVenta")), seller = Id(Value(invoice, "vendedor"));
        int customer = Id(Value(invoice, "idCliente")), list = Id(Value(invoice, "listaPrecios"));
        if (list > 3) throw new InvalidOperationException("Lista de precios inválida.");
        string name = Limited(Value(Object(Value(invoice, "cliente")), "nombre"), 100, "Nombre del cliente").ToUpperInvariant();
        if (name.Length < 2 || name == "CONSUMIDOR FINAL") throw new InvalidOperationException("Ingresá el nombre del cliente, como exige Access.");
        DateTime date;
        if (!DateTime.TryParseExact(Text(Value(invoice, "fecha")), "yyyy-MM-dd", System.Globalization.CultureInfo.InvariantCulture,
            System.Globalization.DateTimeStyles.None, out date) || date.Date != DateTime.Today)
            throw new InvalidOperationException("Para emitir, la fecha debe ser la de hoy. Access exige autorización para otra fecha.");
        var items = Value(invoice, "articulos") as System.Collections.ArrayList;
        var payments = Value(invoice, "valores") as System.Collections.ArrayList;
        if (items == null || items.Count == 0 || items.Count > 200) throw new InvalidOperationException("Agregá entre 1 y 200 artículos.");
        if (payments == null || payments.Count == 0 || payments.Count > 30) throw new InvalidOperationException("Cargá los valores recibidos.");
        string draft = Limited(Value(invoice, "id"), 80, "Identificador del borrador");
        Guid draftId;
        if (!Guid.TryParse(draft, out draftId)) throw new InvalidOperationException("El borrador no tiene un identificador válido.");
        int oper = LocalOperator();
        var client = Object(Value(invoice, "cliente"));
        string docType = Text(Value(client, "tipoDocumento"));
        int docId = docType == "CUIT" ? 67 : docType == "DNI" ? 50 : 0;
        if (docId == 0) throw new InvalidOperationException("Tipo de documento no admitido para la emisión.");
        string doc = Limited(Value(client, "numeroDocumento"), 13, "Documento");
        string address = Limited(Value(client, "direccion"), 100, "Dirección");
        string phone = Limited(Value(client, "telefono"), 50, "Teléfono");
        string note = Limited(Value(invoice, "nota"), 160, "Nota");
        using (var tx = connection.BeginTransaction(IsolationLevel.Serializable))
        {
            try
            {
                // El GUID se guarda en Nota para reconocer reintentos después de un corte de red.
                string marker = "[WEB:" + draftId.ToString("N") + "]";
                object existing = Scalar(connection, tx, "SELECT TOP 1 IDRecibo FROM dbo.FacturasATP WITH (UPDLOCK,HOLDLOCK) WHERE IDComprob=13 AND Nota LIKE @p0 ORDER BY IDRecibo DESC", "%" + marker + "%");
                if (existing != null && existing != DBNull.Value)
                {
                    int prior = Convert.ToInt32(existing);
                    var found = Scalar(connection, tx, "SELECT NroFactura FROM dbo.FacturasATP WHERE IDRecibo=@p0 AND Confirmado=-1", prior);
                    if (found == null) throw new InvalidOperationException("Ya existe un intento previo con este borrador. Revisá el comprobante " + prior + " en Access.");
                    tx.Commit();
                    return new { ok = true, idRecibo = prior, numero = Text(found), yaEmitido = true };
                }
                var pointInfo = Scalar(connection, tx, "SELECT IDSucAsoc FROM dbo.[Depósitos] WHERE IDDepósito=@p0 AND IDEmp=1", point);
                if (pointInfo == null) throw new InvalidOperationException("Punto de venta inválido.");
                int branch = Convert.ToInt32(pointInfo);
                if (Scalar(connection, tx, "SELECT 1 FROM dbo.TiposCompXPV WHERE IDPtoVta=@p0 AND IDComprob=13", point) == null)
                    throw new InvalidOperationException("PRES. ESPECIAL no está habilitado en este punto de venta.");
                if (Scalar(connection, tx, "SELECT 1 FROM dbo.Empleados WHERE IDEmpleado=@p0 AND Susp=0", seller) == null)
                    throw new InvalidOperationException("Vendedor no disponible.");
                if (Scalar(connection, tx, "SELECT 1 FROM dbo.Clientes WHERE IDCliente=@p0 AND Suspendido=0", customer) == null)
                    throw new InvalidOperationException("Cliente no disponible.");
                int ivaType = 5;
                if (customer > 1)
                {
                    object v = Scalar(connection, tx, "SELECT IDTipoIVA FROM dbo.Clientes WHERE IDCliente=@p0", customer);
                    if (v != null && v != DBNull.Value) ivaType = Convert.ToInt32(v);
                }
                decimal gross = 0, net = 0, net21 = 0, net105 = 0, iva21 = 0, iva105 = 0, other = 0, qtySum = 0;
                var lines = new List<object[]>();
                foreach (object item in items)
                {
                    var row = Object(item);
                    string id = Limited(Value(row, "idart"), 20, "IDArt");
                    object[] article;
                    using (var cmd = new SqlCommand("SELECT a.[Descripción],a.PorcIVA1,a.PrecioCpraCI,a.UniMed,ISNULL(s.StockAct,0) FROM dbo.[Artículos] a LEFT JOIN dbo.ArtsStock s ON s.IDArt=a.IDArt AND s.IDSuc=@p1 WHERE a.IDArt=@p0 AND a.Suspendido=0", connection, tx))
                    {
                        cmd.Parameters.AddWithValue("@p0", id); cmd.Parameters.AddWithValue("@p1", branch);
                        using (var reader = cmd.ExecuteReader())
                        {
                            if (!reader.Read()) throw new InvalidOperationException("El artículo " + id + " ya no existe.");
                            article = new object[5]; reader.GetValues(article);
                            if (reader.Read()) throw new InvalidOperationException("Stock duplicado para el artículo " + id + ".");
                        }
                    }
                    decimal qty = Number(Value(row, "cantidad")), price = Number(Value(row, "precio")), basePrice = Number(Value(row, "precioBase"));
                    decimal discount = Number(Value(row, "descuento"));
                    if (qty <= 0 || qty > 100000 || price < 0 || price > 1000000000 || discount < 0 || discount > 100)
                        throw new InvalidOperationException("Cantidad, precio o descuento inválido en " + id + ".");
                    decimal iva = article[1] == DBNull.Value ? 0 : Convert.ToDecimal(article[1]);
                    decimal shownIva = Number(Value(row, "iva")) / 100m;
                    if (Math.Abs(shownIva - iva) > .0001m) throw new InvalidOperationException("Cambió el IVA del artículo " + id + ". Recargá el catálogo.");
                    price = Decimal.Round(price, 2, MidpointRounding.AwayFromZero);
                    decimal amount = Decimal.Round(qty * price, 2, MidpointRounding.AwayFromZero);
                    decimal tax = iva > 0 ? Decimal.Round(amount - amount / (1 + iva), 2, MidpointRounding.AwayFromZero) : 0;
                    decimal lineNet = amount - tax;
                    gross += amount; net += lineNet; qtySum += qty;
                    if (Math.Abs(iva - .21m) < .0001m) { iva21 += tax; net21 += lineNet; }
                    else if (Math.Abs(iva - .105m) < .0001m) { iva105 += tax; net105 += lineNet; }
                    else other += tax;
                    decimal cost = article[2] == DBNull.Value ? 0 : Convert.ToDecimal(article[2]);
                    decimal gain = Decimal.Round(amount - cost * qty, 2, MidpointRounding.AwayFromZero);
                    decimal margin = cost == 0 ? 0 : price / cost - 1;
                    lines.Add(new object[] { id, qty, price, amount, tax, gain, iva, discount / 100m, cost,
                        Limited(Value(row, "descripcion"), 150, "Descripción"), lineNet / qty, list,
                        basePrice > 0 ? basePrice : price, price, Convert.ToDecimal(article[4]), margin, article[3] == DBNull.Value ? null : article[3] });
                }
                if (gross <= 0 || gross > 1000000000) throw new InvalidOperationException("Total fuera de rango.");
                decimal paid = 0, cash = 0, bank = 0, card = 0, account = 0;
                var valueLines = new List<object[]>();
                foreach (object value in payments)
                {
                    var row = Object(value);
                    int paymentId = Id(Value(row, "idTipoPago"));
                    object kind = Scalar(connection, tx, "SELECT IDClasePago FROM dbo.TiposPagos WHERE IDTipoPago=@p0 AND EnCaja=1", paymentId);
                    if (kind == null) throw new InvalidOperationException("Medio de pago inválido.");
                    int cls = Convert.ToInt32(kind);
                    if (cls == 5) throw new InvalidOperationException("Access exige facturar las tarjetas en A o B; PRES. ESPECIAL no las admite.");
                    if (cls == 2) throw new InvalidOperationException("Los cheques necesitan datos y validaciones que esta pantalla todavía no recoge.");
                    decimal amount = Number(Value(row, "importe"));
                    if (amount <= 0 || amount > gross) throw new InvalidOperationException("Importe de pago inválido.");
                    int cardId = 0;
                    if (cls == 3)
                    {
                        string accountName = Text(Value(row, "tarjeta"));
                        if (accountName.Length == 0 || accountName == "Ninguna") throw new InvalidOperationException("Elegí la cuenta de la transferencia.");
                        object cardObj = Scalar(connection, tx, "SELECT IDTarjeta FROM dbo.Tarjetas WHERE [Descripción]=@p0 AND Susp=0", accountName);
                        if (cardObj == null) throw new InvalidOperationException("La cuenta de transferencia no existe en Access.");
                        cardId = Convert.ToInt32(cardObj);
                        bank += amount;
                    }
                    else if (cls == 6) { if (customer == 1) throw new InvalidOperationException("Cuenta corriente requiere un cliente registrado."); account += amount; }
                    else if (cls == 1) cash += amount;
                    else throw new InvalidOperationException("Medio de pago no admitido en PRES. ESPECIAL.");
                    paid += amount;
                    valueLines.Add(new object[] { paymentId, amount, cardId, Limited(Value(row, "descripcion"), 30, "Concepto") });
                }
                if (Math.Abs(paid - gross) > .005m) throw new InvalidOperationException("Los valores recibidos no coinciden con el total recalculado en SQL.");
                if (account > 0)
                {
                    object credit = Scalar(connection, tx, "SELECT ISNULL(ImpCred,0)-ISNULL(SaldoCC,0) FROM dbo.Clientes WHERE IDCliente=@p0", customer);
                    if (credit == null || Convert.ToDecimal(credit) < account) throw new InvalidOperationException("La cuenta corriente supera el crédito disponible.");
                }
                // Access usa DMax por comprobante y punto. TABLOCKX evita carreras también con altas desde Access.
                object maxObj = Scalar(connection, tx,
                    "SELECT MAX(TRY_CONVERT(int,RIGHT(NroFactura,8))) FROM dbo.FacturasATP WITH (TABLOCKX,HOLDLOCK) WHERE IDComprob=13 AND IDDepósito=@p0 AND Confirmado=-1 AND NroFactura LIKE @p1",
                    point, point.ToString("0000") + "-________");
                int next = maxObj == null || maxObj == DBNull.Value ? 1 : Convert.ToInt32(maxObj) + 1;
                string number = point.ToString("0000") + "-" + next.ToString("00000000");
                int receipt = Convert.ToInt32(Scalar(connection, tx,
                    "INSERT dbo.FacturasATP (IDDepósito,IDComprob,NroFactura,Fecha,IDCliente,ApeYNom,[Dirección],[Teléfono],IDTipoVta,Confirmado,Total,IDTipoIVA,IDTipoDocFis,CUIT,IDVend,TotalEF,TotalEC,SubTotal,ImpIVA1,SubTSDto,Impresa,ActStock,IDSuc,SubTot1,ImpIVA21,SubTot2,ImpIVA105,IDTipoCli,IDOper,Pagada,IDEmp,CantArts,TotalCC,TotalCH,Nota) " +
                    "OUTPUT INSERTED.IDRecibo VALUES (@p0,13,@p1,@p2,@p3,@p4,@p5,@p6,1,-1,@p7,@p8,@p9,@p10,@p11,@p12,@p13,@p14,@p15,-1,-1,@p16,@p17,@p18,@p19,@p20,@p21,@p22,1,@p23,@p24,@p25)",
                    point, number, date, customer, name, address, phone, gross, ivaType, docId, doc, seller,
                    cash, card, net, iva21 + iva105 + other, branch, net21, iva21, net105, iva105, list, oper, account == 0, 1, Convert.ToInt32(qtySum), account, bank,
                    (note.Length == 0 ? "" : note + " ") + marker));
                foreach (object[] line in lines)
                {
                    Execute(connection, tx,
                        "INSERT dbo.FacturasATS (IDRecibo,IDArt,Cantidad,PrecioUni,Importe,ImpIVA1,ImpGan,PorcIVA,PorcDto,PrecioUniCpra,ArtDesc,PrecioUniSI,IDLista,PrecioUniOrig,PUMonExt,Stock,PorcMV,UniMed) " +
                        "VALUES (@p0,@p1,@p2,@p3,@p4,@p5,@p6,@p7,@p8,@p9,@p10,@p11,@p12,@p13,@p14,@p15,@p16,@p17)",
                        receipt,line[0],line[1],line[2],line[3],line[4],line[5],line[6],line[7],line[8],line[9],line[10],line[11],line[12],line[13],line[14],line[15],line[16]);
                    int updated = Execute(connection, tx, "UPDATE dbo.ArtsStock SET StockAct=StockAct-@p0 WHERE IDArt=@p1 AND IDSuc=@p2", line[1],line[0],branch);
                    if (updated != 1) throw new InvalidOperationException("Falta un registro de stock único para " + line[0] + ".");
                }
                foreach (object[] payment in valueLines)
                    Execute(connection, tx, "INSERT dbo.FacturasTSVal (IDRecibo,IDTipoPago,Importe,ImpEnt,Cuotas,Concepto,FechaVto,IDTarjeta,Coef) VALUES (@p0,@p1,@p2,@p2,0,@p3,@p4,@p5,0)",
                        receipt,payment[0],payment[1],payment[3],date,payment[2]);
                if (dryRun) tx.Rollback(); else tx.Commit();
                return new { ok = true, idRecibo = receipt, numero = number, total = gross, pruebaTransaccion = dryRun, yaEmitido = false };
            }
            catch { try { tx.Rollback(); } catch { } throw; }
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
        try
        {
            using (var connection = Connect())
            {
                if (request.HttpMethod == "GET" && request.Url.AbsolutePath == "/bootstrap")
                {
                    Reply(context, 200, new { ok = true,
                        comprobantes = Rows(connection, "SELECT tc.IDComprob AS id, tc.Abreviatura AS codigo, tc.Descripcion AS nombre, tc.IDTipoAFIP AS idAfip, tc.EnLibroIVA AS libroIva, tc.ImpFis AS impresoraFiscal, tc.IDTipoMovStock AS tipoMovimientoStock, xp.IDPtoVta AS idPuntoVenta FROM dbo.TipoComprobantes tc INNER JOIN dbo.TiposCompXPV xp ON xp.IDComprob=tc.IDComprob WHERE tc.EnVtas=1 ORDER BY xp.IDPtoVta,tc.Abreviatura"),
                        puntosVenta = Rows(connection, "SELECT IDDepósito AS id, [Descripción] AS nombre, IDSucAsoc AS idSucursal, IDEmp AS idEmpresa, FE AS electronica, ImpFis AS impresoraFiscal FROM dbo.[Depósitos] ORDER BY IDDepósito"),
                        tiposPago = Rows(connection, "SELECT IDTipoPago AS id, TipoPago AS nombre, IDClasePago AS clase FROM dbo.TiposPagos WHERE EnCaja=1 ORDER BY IDTipoPago"),
                        tarjetas = Rows(connection, "SELECT IDTarjeta AS id, [Descripción] AS nombre FROM dbo.Tarjetas WHERE Susp=0 ORDER BY [Descripción]"),
                        listas = Rows(connection, "SELECT IDTipoCli AS id, TipoCliDesc AS nombre FROM dbo.TiposCli ORDER BY IDTipoCli"),
                        tiposIva = Rows(connection, "SELECT IDTipoIVA AS id, Descripcion AS nombre FROM dbo.TiposIVA ORDER BY IDTipoIVA"),
                        tiposDocumento = Rows(connection, "SELECT IDTipoDocFis AS id, TipoDocFis AS nombre FROM dbo.TiposDocFis ORDER BY IDTipoDocFis"),
                        vendedores = Rows(connection, "SELECT IDEmpleado AS id, Nombre AS nombre FROM dbo.Empleados WHERE Susp=0 ORDER BY Nombre"),
                        emisionHabilitada = false });
                    return;
                }
                if (request.HttpMethod == "GET" && request.Url.AbsolutePath == "/catalogo")
                {
                    int pointId = Id(request.QueryString["puntoVenta"]);
                    int listId = Id(request.QueryString["lista"]);
                    if (listId < 1 || listId > 3) throw new InvalidOperationException("Lista de precios inválida.");
                    var catalog = Rows(connection,
                        "SELECT a.IDArt AS idart,a.IDArtProv AS codProv,a.[Descripción] AS descripcion," +
                        "CASE @p1 WHEN 1 THEN a.PrecioVta1 WHEN 2 THEN a.PrecioVta2 ELSE a.PrecioVta3 END AS precioFinal," +
                        "ISNULL(s.StockAct,0) AS stock,a.PorcIVA1*100 AS iva " +
                        "FROM dbo.[Artículos] a " +
                        "CROSS JOIN dbo.[Depósitos] d " +
                        "LEFT JOIN dbo.ArtsStock s ON s.IDArt=a.IDArt AND s.IDSuc=d.IDSucAsoc " +
                        "WHERE d.IDDepósito=@p0 AND a.Suspendido=0 ORDER BY a.[Descripción],a.IDArt", pointId, listId);
                    Reply(context, 200, new { ok = true, catalogo = catalog });
                    return;
                }
                if (request.HttpMethod == "GET" && request.Url.AbsolutePath == "/clientes")
                {
                    string query = Text(request.QueryString["q"]);
                    if (query.Length < 2) { Reply(context, 200, new { ok = true, clientes = new object[0] }); return; }
                    if (query.Length > 80) throw new InvalidOperationException("Búsqueda demasiado larga.");
                    string pattern = "%" + query.Replace("[", "[[]").Replace("%", "[%]").Replace("_", "[_]") + "%";
                    var clients = Rows(connection,
                        "SELECT TOP 30 IDCliente AS id,[RazónSocial] AS nombre,CUIT AS documento,IDTipoIVA AS idTipoIva," +
                        "[Dirección] AS direccion,[Teléfono] AS telefono,Email AS email FROM dbo.Clientes " +
                        "WHERE Suspendido=0 AND ([RazónSocial] LIKE @p0 OR CUIT LIKE @p0) ORDER BY [RazónSocial],IDCliente", pattern);
                    Reply(context, 200, new { ok = true, clientes = clients });
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
                    Reply(context, 200, new { ok = true, total = total, valores = paid, emisionHabilitada = false, message = "Datos verificados contra SQL. La emisión todavía no está habilitada." });
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
                    Reply(context, 200, Emit(connection, Object(Value(envelope, "comprobante")), dryRun));
                    return;
                }
            }
            Reply(context, 404, new { ok = false, error = "Ruta no encontrada." });
        }
        catch (InvalidOperationException ex) { Reply(context, 409, new { ok = false, error = ex.Message }); }
        catch (SqlException ex) { Reply(context, 503, new { ok = false, error = "No se pudo consultar SQL Server: " + ex.Message }); }
        catch (Exception) { Reply(context, 500, new { ok = false, error = "No se pudo preparar el comprobante. Revisá la conexión local." }); }
    }
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
                ThreadPool.QueueUserWorkItem(_ => Handle(context));
            }
        }
    }
}
