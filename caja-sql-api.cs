using System;
using System.Collections.Generic;
using System.Data;
using System.Data.SqlClient;
using System.Globalization;
using System.IO;
using System.Net;
using System.Text;

internal static partial class FacturacionCopiaApi
{
    // Only the copy of Access is used as a specification. Every runtime query uses SQL Server.
    private sealed class CajaSession { public string User, Token; public int Operator, Branch; public bool Admin, Restricted, Edit; public DateTime Expires; }
    private static readonly Dictionary<string,CajaSession> CajaSessions = new Dictionary<string,CajaSession>();
    private static readonly object CajaSessionGate = new object();
    private static DateTime CajaDate(object value) {
        DateTime date;
        if (!DateTime.TryParseExact(Text(value),"yyyy-MM-dd",CultureInfo.InvariantCulture,DateTimeStyles.None,out date)) throw new InvalidOperationException("Elegí una fecha de Caja válida.");
        return date.Date;
    }
    private static List<Dictionary<string,object>> CajaRows(SqlConnection c, SqlTransaction tx, string sql, params object[] args) { return RowsTx(c,tx,sql,args); }
    private static string CajaJson(object value) { return Json.Serialize(CajaCanonical(value)); }
    private static object CajaCanonical(object value) {
        var dict=value as Dictionary<string,object>;
        if(dict!=null){var sorted=new SortedDictionary<string,object>(StringComparer.Ordinal);foreach(var p in dict)sorted[p.Key]=CajaCanonical(p.Value);return sorted;}
        var list=value as System.Collections.IEnumerable;
        if(list!=null && !(value is string)){var items=new List<object>();foreach(var item in list)items.Add(CajaCanonical(item));return items;}
        return value==DBNull.Value?null:value;
    }
    private static object CajaStored(SqlConnection c,SqlTransaction tx,DateTime date,string section,string user) {
        var rows=CajaRows(c,tx,"SELECT Payload FROM dbo.CajaWebEstado WITH(HOLDLOCK) WHERE Fecha=@p0 AND Seccion=@p1 AND Usuario=@p2",date,section,user);
        return rows.Count==0?new Dictionary<string,object>():Json.DeserializeObject(Text(rows[0]["Payload"]));
    }
    private static void CajaStore(SqlConnection c,SqlTransaction tx,DateTime date,string section,string user,object value) {
        Execute(c,tx,"UPDATE dbo.CajaWebEstado WITH(UPDLOCK,HOLDLOCK) SET Payload=@p3,Version=Version+1,Actualizado=SYSUTCDATETIME() WHERE Fecha=@p0 AND Seccion=@p1 AND Usuario=@p2; IF @@ROWCOUNT=0 INSERT dbo.CajaWebEstado(Fecha,Seccion,Usuario,Payload) VALUES(@p0,@p1,@p2,@p3)",date,section,user,CajaJson(value));
    }
    private static Dictionary<string,object> CajaStatePayload(SqlConnection c,SqlTransaction tx,DateTime date,string section,string user) {
        var payload=Object(CajaStored(c,tx,date,section,user));
        if(section=="manual") {
            var byId=new Dictionary<string,object>();foreach(var row in CajaRows(c,tx,"SELECT ID,Payload FROM dbo.CajaWebMercadoPago WHERE Fecha=@p0 ORDER BY ID",date))byId[Text(row["ID"])]=Json.DeserializeObject(Text(row["Payload"]));
            var transfers=new List<object>();foreach(var item in PurchaseArray(Value(payload,"transfers"))){string id=Text(Value(Object(item),"id"));object row;if(byId.TryGetValue(id,out row)){transfers.Add(row);byId.Remove(id);}}
            foreach(var item in byId)transfers.Add(item.Value);payload["transfers"]=transfers.ToArray();
        }
        return payload;
    }
    private static CajaSession CajaAuthorize(HttpListenerRequest request,Dictionary<string,object> input) {
        string token=request.HttpMethod=="GET"?request.QueryString["token"]:Text(Value(input,"token"));
        lock(CajaSessionGate){CajaSession session;if(token!=null && CajaSessions.TryGetValue(token,out session) && session.Expires>DateTime.UtcNow)return session;}
        throw new InvalidOperationException("La sesión de Caja venció. Volvé a abrir Caja desde el menú.");
    }
    private static object CajaBootstrap(SqlConnection c,string userId) {
        if(String.IsNullOrWhiteSpace(userId) || userId.Length>150)throw new InvalidOperationException("Iniciá sesión para usar Caja.");
        // Same menu identity as the other SQL screens; permission is checked once, not on every edit.
        string url="https://firestore.googleapis.com/v1/projects/corralon-progreso/databases/(default)/documents/menuUsuarios/"+Uri.EscapeDataString(userId)+"?mask.fieldPaths=nivel&mask.fieldPaths=permisos&mask.fieldPaths=permisosEdicion&mask.fieldPaths=cajaModo&mask.fieldPaths=cajaSucursalId&mask.fieldPaths=idOperador&key=AIzaSyCxwUGX-rVusOI13j7oTfQuAtkeNXdAYH0";
        var req=(HttpWebRequest)WebRequest.Create(url);req.Timeout=8000;
        Dictionary<string,object> fields;
        using(var response=req.GetResponse())using(var reader=new StreamReader(response.GetResponseStream(),Encoding.UTF8))fields=Object(Value(Object(Json.DeserializeObject(reader.ReadToEnd())),"fields"));
        Func<string,string> field=key=>Text(Value(Object(Value(fields,key)),"stringValue"));
        bool admin=field("nivel")=="administrador", access=admin;
        foreach(var item in PurchaseArray(Value(Object(Value(Object(Value(fields,"permisos")),"arrayValue")),"values")))if(Text(Value(Object(item),"stringValue"))=="caja")access=true;
        if(!access)throw new InvalidOperationException("Tu usuario no tiene permiso de Caja.");
        var session=new CajaSession{User=userId,Token=Guid.NewGuid().ToString("N"),Admin=admin,Edit=admin||UserHasModuleEditPermission(fields,"caja"),Expires=DateTime.UtcNow.AddHours(12)};
        session.Restricted=!admin && (field("cajaModo")=="lector"||field("cajaModo")=="restringido");
        string branch=field("cajaSucursalId"); session.Branch=branch=="calle5_espana"?2:1;
        int.TryParse(Text(Value(Object(Value(fields,"idOperador")),"integerValue")),out session.Operator);
        if(session.Operator==0)int.TryParse(field("idOperador"),out session.Operator);
        lock(CajaSessionGate){var expired=new List<string>();foreach(var item in CajaSessions)if(item.Value.Expires<DateTime.UtcNow)expired.Add(item.Key);foreach(string key in expired)CajaSessions.Remove(key);CajaSessions[session.Token]=session;}
        return new {ok=true,token=session.Token,administrador=admin,editar=session.Edit,restringido=session.Restricted,sucursal=session.Branch,idOperador=session.Operator,
            depositos=Rows(c,"SELECT [IDDepósito] id,[Descripción] nombre,IDSucAsoc sucursal FROM dbo.[Depósitos] WHERE IDEmp=1 AND IDSucAsoc IN(1,2) ORDER BY [IDDepósito]"),
            cajasHoy=Rows(c,"SELECT c.IDRecibo,c.[IDDepósito] deposito,d.IDSucAsoc sucursal FROM dbo.CajaDiaTP c JOIN dbo.[Depósitos] d ON d.[IDDepósito]=c.[IDDepósito] AND d.IDEmp=c.IDEmp WHERE c.IDEmp=1 AND c.Anulado=0 AND c.Fecha>=CONVERT(date,GETDATE()) AND c.Fecha<DATEADD(day,1,CONVERT(date,GETDATE())) ORDER BY c.IDRecibo DESC"),
            operadores=Rows(c,"SELECT IDEmpleado id,Nombre nombre FROM dbo.Empleados ORDER BY Nombre"),
            pagos=Rows(c,"SELECT IDTipoPago id,TipoPago nombre FROM dbo.TiposPagos WHERE EnCaja<>0 ORDER BY IDTipoPago")};
    }
    private static void CajaCheckDate(CajaSession session,DateTime date) { if(session.Restricted && date!=DateTime.Today)throw new InvalidOperationException("Tu usuario solo puede consultar la Caja de hoy."); }
    private static Dictionary<string,object> CajaHeader(SqlConnection c,SqlTransaction tx,int id,bool edit,CajaSession session) {
        var rows=CajaRows(c,tx,"SELECT c.*,d.IDSucAsoc,d.[Descripción] PV,s.Sucursal FROM dbo.CajaDiaTP c WITH(UPDLOCK,HOLDLOCK) JOIN dbo.[Depósitos] d ON d.[IDDepósito]=c.[IDDepósito] AND d.IDEmp=c.IDEmp JOIN dbo.Sucursales s ON s.IDSuc=d.IDSucAsoc WHERE c.IDRecibo=@p0 AND c.IDEmp=1 AND c.Anulado=0",id);
        if(rows.Count!=1)throw new InvalidOperationException("La Caja no existe o fue anulada.");
        var h=rows[0];CajaCheckDate(session,Convert.ToDateTime(h["Fecha"]).Date);
        if(session.Restricted && Convert.ToInt32(h["IDSucAsoc"])!=session.Branch)throw new InvalidOperationException("La Caja pertenece a otra sucursal.");
        if(edit && (!session.Edit || Convert.ToBoolean(h["Confirmado"])))throw new InvalidOperationException("La Caja está cerrada o tu usuario no tiene permiso de edición.");
        return h;
    }
    private const string CajaSales="SELECT v.IDTipoPago,SUM(v.ImpEnt*t.ImpPor) Importe FROM dbo.FacturasATP f JOIN dbo.FacturasTSVal v ON v.IDRecibo=f.IDRecibo JOIN dbo.TipoComprobantes t ON t.IDComprob=f.IDComprob JOIN dbo.[Depósitos] d ON d.[IDDepósito]=f.[IDDepósito] AND d.IDEmp=f.IDEmp WHERE f.Fecha>=@p0 AND f.Fecha<@p1 AND f.IDEmp=1 AND f.Confirmado<>0 AND f.Anulada=0 AND t.IDTipoAcred>0 AND t.EnCaja<>0 AND f.EnInfVtas<>0 AND (@p2=0 OR d.IDSucAsoc=@p2) AND (@p3=0 OR f.[IDDepósito]=@p3)";
    private const string CajaReceipts="SELECT v.IDTipoPago,SUM(v.Importe) Importe FROM dbo.RecibosXTP r JOIN dbo.RecibosXTS v ON v.IDRecibo=r.IDRecibo JOIN dbo.TipoComprobantes t ON t.IDComprob=r.IDComprob JOIN dbo.[Depósitos] d ON d.[IDDepósito]=r.[IDDepósito] AND d.IDEmp=r.IDEmp WHERE r.Fecha>=@p0 AND r.Fecha<@p1 AND r.IDEmp=1 AND r.Confirmado<>0 AND r.Anulado=0 AND t.EnCaja<>0 AND (@p2=0 OR d.IDSucAsoc=@p2) AND (@p3=0 OR r.[IDDepósito]=@p3)";
    private const string CajaPayments="SELECT v.IDTipoPago,SUM(-v.Importe) Importe FROM dbo.OrdPagosTP r JOIN dbo.OrdPagosTSPag v ON v.NroOrden=r.NroOrden JOIN dbo.TipoComprobantes t ON t.IDComprob=r.IDTipoComp JOIN dbo.[Depósitos] d ON d.[IDDepósito]=r.[IDDepósito] AND d.IDEmp=r.IDEmp WHERE r.Fecha>=@p0 AND r.Fecha<@p1 AND r.IDEmp=1 AND r.Confirmado<>0 AND r.Anulado=0 AND t.EnCaja<>0 AND (@p2=0 OR d.IDSucAsoc=@p2) AND (@p3=0 OR r.[IDDepósito]=@p3)";
    private static List<Dictionary<string,object>> CajaAmounts(SqlConnection c,SqlTransaction tx,DateTime date,int branch,int deposit,int openId) {
        string filterSales=openId>0?" AND ISNULL(f.IDCaja,0) IN(0,@p4)":"";
        string filterOther=openId>0?" AND ISNULL(r.IDCaja,0) IN(0,@p4)":"";
        string sql="SELECT x.IDTipoPago,SUM(x.Importe) Importe FROM ("+CajaSales+filterSales+" GROUP BY v.IDTipoPago UNION ALL "+CajaReceipts+filterOther+" GROUP BY v.IDTipoPago UNION ALL "+CajaPayments+filterOther+" GROUP BY v.IDTipoPago) x GROUP BY x.IDTipoPago";
        return CajaRows(c,tx,sql,date,date.AddDays(1),branch,deposit,openId);
    }
    private static void CajaRecalculate(SqlConnection c,SqlTransaction tx,Dictionary<string,object> h) {
        int id=Convert.ToInt32(h["IDRecibo"]),branch=Convert.ToInt32(h["IDSucAsoc"]),deposit=0;
        DateTime date=Convert.ToDateTime(h["Fecha"]).Date;
        Execute(c,tx,"INSERT dbo.CajaDiaTS(IDRecibo,IDTipoPago) SELECT @p0,p.IDTipoPago FROM dbo.TiposPagos p WHERE p.EnCaja<>0 AND NOT EXISTS(SELECT 1 FROM dbo.CajaDiaTS x WHERE x.IDRecibo=@p0 AND x.IDTipoPago=p.IDTipoPago)",id);
        Execute(c,tx,"UPDATE dbo.CajaDiaTS SET Importe=0,ImpRet=0 WHERE IDRecibo=@p0",id);
        foreach(var row in CajaAmounts(c,tx,date,branch,deposit,id))Execute(c,tx,"UPDATE dbo.CajaDiaTS SET Importe=@p2 WHERE IDRecibo=@p0 AND IDTipoPago=@p1",id,row["IDTipoPago"],row["Importe"]);
        Execute(c,tx,"UPDATE dbo.CajaDiaTS SET ImpRet=(SELECT ISNULL(SUM(Importe),0) FROM dbo.CajaDiaTSEfec WHERE IDRecibo=@p0) WHERE IDRecibo=@p0 AND IDTipoPago=1; UPDATE dbo.CajaDiaTS SET ImpAct=ImpAnt+Importe+ImpRet WHERE IDRecibo=@p0; UPDATE dbo.CajaDiaTP SET Total=(SELECT ISNULL(SUM(ImpAct),0) FROM dbo.CajaDiaTS WHERE IDRecibo=@p0) WHERE IDRecibo=@p0",id);
    }
    private static object CajaForm(SqlConnection c,SqlTransaction tx,int id,CajaSession session) {
        var h=CajaHeader(c,tx,id,false,session);
        var detail=CajaRows(c,tx,"SELECT v.*,p.TipoPago FROM dbo.CajaDiaTS v JOIN dbo.TiposPagos p ON p.IDTipoPago=v.IDTipoPago WHERE v.IDRecibo=@p0 ORDER BY v.IDTipoPago",id);
        var cash=CajaRows(c,tx,"SELECT * FROM dbo.CajaDiaTSEfec WHERE IDRecibo=@p0 ORDER BY IDMov",id);
        DateTime date=Convert.ToDateTime(h["Fecha"]).Date;int branch=Convert.ToInt32(h["IDSucAsoc"]),deposit=Convert.ToBoolean(h["Global"])?0:Convert.ToInt32(h["IDDepósito"]);
        var cards=CajaRows(c,tx,"SELECT v.IDTarjeta,a.[Descripción] Tarjeta,SUM(v.ImpEnt*t.ImpPor) Importe FROM dbo.FacturasATP f JOIN dbo.FacturasTSVal v ON v.IDRecibo=f.IDRecibo JOIN dbo.Tarjetas a ON a.IDTarjeta=v.IDTarjeta JOIN dbo.TipoComprobantes t ON t.IDComprob=f.IDComprob JOIN dbo.[Depósitos] d ON d.[IDDepósito]=f.[IDDepósito] WHERE f.IDEmp=1 AND f.Fecha>=@p0 AND f.Fecha<@p1 AND f.Confirmado<>0 AND f.Anulada=0 AND t.IDTipoAcred>0 AND d.IDSucAsoc=@p2 AND (@p3=0 OR f.[IDDepósito]=@p3) AND v.IDTarjeta>0 GROUP BY v.IDTarjeta,a.[Descripción]",date,date.AddDays(1),branch,deposit);
        var sales=CajaRows(c,tx,"SELECT f.[IDDepósito] PV,SUM(f.Total) ImpVta,SUM(ISNULL(a.Costo,0)*t.StkPor*-1) ImpCosto,SUM(ISNULL(a.Articulos,0)*t.StkPor*-1) Articulos FROM dbo.FacturasATP f JOIN dbo.TipoComprobantes t ON t.IDComprob=f.IDComprob JOIN dbo.[Depósitos] d ON d.[IDDepósito]=f.[IDDepósito] OUTER APPLY(SELECT SUM(x.PrecioUniCpra*x.Cantidad) Costo,SUM(x.Cantidad) Articulos FROM dbo.FacturasATS x WHERE x.IDRecibo=f.IDRecibo) a WHERE f.IDEmp=1 AND f.Fecha>=@p0 AND f.Fecha<@p1 AND f.Confirmado<>0 AND f.Anulada=0 AND t.IDTipoAcred>0 AND f.EnInfVtas<>0 AND d.IDSucAsoc=@p2 AND (@p3=0 OR f.[IDDepósito]=@p3) GROUP BY f.[IDDepósito]",date,date.AddDays(1),branch,deposit);
        var receipts=CajaRows(c,tx,"SELECT SUM(r.Total) TotCob FROM dbo.RecibosXTP r JOIN dbo.[Depósitos] d ON d.[IDDepósito]=r.[IDDepósito] WHERE r.IDEmp=1 AND r.Fecha>=@p0 AND r.Fecha<@p1 AND r.Confirmado<>0 AND r.Anulado=0 AND d.IDSucAsoc=@p2 AND (@p3=0 OR r.[IDDepósito]=@p3)",date,date.AddDays(1),branch,deposit);
        var differences=CajaRows(c,tx,"SELECT f.IDRecibo,t.Abreviatura,f.NroFactura,f.Total,SUM(v.ImpEnt*t.ImpPor) TotImp,f.Total-SUM(v.ImpEnt*t.ImpPor) ImpDif FROM dbo.FacturasATP f JOIN dbo.FacturasTSVal v ON v.IDRecibo=f.IDRecibo JOIN dbo.TipoComprobantes t ON t.IDComprob=f.IDComprob JOIN dbo.[Depósitos] d ON d.[IDDepósito]=f.[IDDepósito] WHERE f.IDEmp=1 AND f.Fecha>=@p0 AND f.Fecha<@p1 AND f.Confirmado<>0 AND f.Anulada=0 AND t.EnCaja<>0 AND t.IDTipoAcred>0 AND d.IDSucAsoc=@p2 AND (@p3=0 OR f.[IDDepósito]=@p3) GROUP BY f.IDRecibo,t.Abreviatura,f.NroFactura,f.Total HAVING ABS(f.Total-SUM(v.ImpEnt*t.ImpPor))>0.01",date,date.AddDays(1),branch,deposit);
        return new {ok=true,cabecera=h,detalle=detail,efectivo=cash,tarjetas=cards,ventas=sales,cobros=receipts,diferencias=differences,version=ProviderVersion(new Dictionary<string,object>{{"cabecera",h},{"detalle",detail},{"efectivo",cash}})};
    }
    private static void CajaVerifyVersion(SqlConnection c,SqlTransaction tx,int id,CajaSession session,string expected) {
        if(String.IsNullOrWhiteSpace(expected))throw new InvalidOperationException("Volvé a cargar la Caja antes de guardar.");
        var form=Object(Json.DeserializeObject(Json.Serialize(CajaForm(c,tx,id,session))));
        if(Text(Value(form,"version"))!=expected)throw new InvalidOperationException("La Caja cambió en otra PC. Actualizá antes de guardar; tus datos siguen en pantalla.");
    }
    private static void CajaClose(SqlConnection c,SqlTransaction tx,Dictionary<string,object> h,string note) {
        int id=Convert.ToInt32(h["IDRecibo"]),branch=Convert.ToInt32(h["IDSucAsoc"]),deposit=Convert.ToBoolean(h["Global"])?0:Convert.ToInt32(h["IDDepósito"]);DateTime date=Convert.ToDateTime(h["Fecha"]).Date;
        if(Convert.ToBoolean(h["Confirmado"]))throw new InvalidOperationException("La Caja ya está cerrada.");
        CajaRecalculate(c,tx,h);
        foreach(string table in new[]{"FacturasATP","RecibosXTP","OrdPagosTP"})Execute(c,tx,"UPDATE f SET IDCaja=@p0 FROM dbo."+table+" f JOIN dbo.[Depósitos] d ON d.[IDDepósito]=f.[IDDepósito] AND d.IDEmp=f.IDEmp WHERE f.IDEmp=1 AND ISNULL(f.IDCaja,0)=0 AND f.Fecha>=@p1 AND f.Fecha<@p2 AND d.IDSucAsoc=@p3 AND (@p4=0 OR f.[IDDepósito]=@p4)",id,date,date.AddDays(1),branch,deposit);
        Execute(c,tx,"UPDATE dbo.CajaDiaTP SET Confirmado=1,Nota=@p1 WHERE IDRecibo=@p0",id,note);
        Execute(c,tx,"DELETE f FROM dbo.FacturasATP f JOIN dbo.[Depósitos] d ON d.[IDDepósito]=f.[IDDepósito] AND d.IDEmp=f.IDEmp WHERE f.IDEmp=1 AND f.Confirmado=0 AND f.Fecha<@p0 AND d.IDSucAsoc=@p1",date.AddDays(1),branch);
    }
    private const string CajaMenuUrl="https://firestore.googleapis.com/v1/projects/corralon-progreso/databases/(default)/documents/menuUsuarios";
    private static Dictionary<string,object> CajaMenuGet(string suffix) {
        var request=(HttpWebRequest)WebRequest.Create(CajaMenuUrl+suffix);request.Timeout=8000;
        using(var response=request.GetResponse())using(var reader=new StreamReader(response.GetResponseStream(),Encoding.UTF8))return Object(Json.DeserializeObject(reader.ReadToEnd()));
    }
    private static object CajaAdministrators() {
        var users=new List<object>();string page="";
        do { var result=CajaMenuGet("?pageSize=300&mask.fieldPaths=nivel&mask.fieldPaths=nombre&mask.fieldPaths=usuario"+(page.Length>0?"&pageToken="+Uri.EscapeDataString(page):""));
            foreach(var doc in PurchaseArray(Value(result,"documents"))) {var d=Object(doc);var fields=Object(Value(d,"fields"));if(Text(Value(Object(Value(fields,"nivel")),"stringValue"))!="administrador")continue;string name=Text(Value(d,"name"));users.Add(new {id=name.Substring(name.LastIndexOf('/')+1),nombre=Text(Value(Object(Value(fields,"nombre")),"stringValue")),usuario=Text(Value(Object(Value(fields,"usuario")),"stringValue"))});}
            page=Text(Value(result,"nextPageToken"));
        } while(page.Length>0);return new {ok=true,usuarios=users};
    }
    private static void CajaVerifyAdministrator(Dictionary<string,object> input) {
        string id=Text(Value(input,"administradorId")),password=Text(Value(input,"password"));
        if(id.Length==0 || id.Length>150 || password.Length==0 || password.Length>300)throw new InvalidOperationException("Ingresá el usuario y la contraseña de un administrador.");
        var doc=CajaMenuGet("/"+Uri.EscapeDataString(id)+"?mask.fieldPaths=nivel&mask.fieldPaths=password");var fields=Object(Value(doc,"fields"));
        if(Text(Value(Object(Value(fields,"nivel")),"stringValue"))!="administrador" || Text(Value(Object(Value(fields,"password")),"stringValue"))!=password)throw new InvalidOperationException("Usuario o contraseña de administrador incorrectos.");
    }
    private static void CajaDelete(SqlConnection c,SqlTransaction tx,Dictionary<string,object> h) {
        int id=Convert.ToInt32(h["IDRecibo"]);
        if(Convert.ToDateTime(h["Fecha"]).Date!=DateTime.Today || Convert.ToBoolean(h["Confirmado"]))throw new InvalidOperationException("Solo se puede eliminar una Caja abierta de hoy.");
        if(Convert.ToInt32(Scalar(c,tx,"SELECT (SELECT COUNT(*) FROM dbo.FacturasATP WHERE IDCaja=@p0)+(SELECT COUNT(*) FROM dbo.RecibosXTP WHERE IDCaja=@p0)+(SELECT COUNT(*) FROM dbo.OrdPagosTP WHERE IDCaja=@p0)",id))>0)throw new InvalidOperationException("La Caja tiene comprobantes vinculados. No se eliminó.");
        CajaStore(c,tx,DateTime.Today,"caja-eliminada",Convert.ToInt32(h["IDSucAsoc"]).ToString(CultureInfo.InvariantCulture),new {eliminada=true});
        Execute(c,tx,"DELETE dbo.CajaDiaTP WHERE IDRecibo=@p0",id);
    }
    private static object CajaValueInvoices(SqlConnection c,int id,int pay,int card,CajaSession session) {
        var h=CajaHeader(c,null,id,false,session);DateTime date=Convert.ToDateTime(h["Fecha"]).Date;int branch=Convert.ToInt32(h["IDSucAsoc"]);bool closed=Convert.ToBoolean(h["Confirmado"]);
        var rows=Rows(c,"SELECT f.IDRecibo idRecibo,f.NroFactura numero,t.Abreviatura comprobante,f.ApeYNom cliente,p.TipoPago tipoValor,SUM(v.ImpEnt*t.ImpPor) total,COALESCE(NULLIF(a.[Descripción],''),'Ninguna') cuenta FROM dbo.FacturasATP f JOIN dbo.FacturasTSVal v ON v.IDRecibo=f.IDRecibo JOIN dbo.TipoComprobantes t ON t.IDComprob=f.IDComprob JOIN dbo.[Depósitos] d ON d.[IDDepósito]=f.[IDDepósito] AND d.IDEmp=f.IDEmp JOIN dbo.TiposPagos p ON p.IDTipoPago=v.IDTipoPago LEFT JOIN dbo.Tarjetas a ON a.IDTarjeta=v.IDTarjeta WHERE f.IDEmp=1 AND f.Fecha>=@p0 AND f.Fecha<@p1 AND d.IDSucAsoc=@p2 AND f.Confirmado<>0 AND f.Anulada=0 AND t.IDTipoAcred>0 AND t.EnCaja<>0 AND f.EnInfVtas<>0 AND (@p3=0 OR v.IDTipoPago=@p3) AND (@p6=0 OR v.IDTarjeta=@p6) AND (f.IDCaja=@p4 OR (@p5=0 AND ISNULL(f.IDCaja,0)=0)) GROUP BY f.IDRecibo,f.NroFactura,t.Abreviatura,f.ApeYNom,p.TipoPago,a.[Descripción] ORDER BY f.IDRecibo DESC",date,date.AddDays(1),branch,pay,id,closed?1:0,card);
        return new {ok=true,filas=rows};
    }
    private static object CajaSqlHandle(SqlConnection c,HttpListenerRequest request) {
        var input=new Dictionary<string,object>();
        if(request.HttpMethod=="POST") {using(var reader=new StreamReader(request.InputStream,Encoding.UTF8)){string body=reader.ReadToEnd();if(body.Length>2000000)throw new InvalidOperationException("La carga es demasiado grande.");input=Object(Json.DeserializeObject(body));}}
        string action=request.HttpMethod=="GET"?request.QueryString["accion"]:Text(Value(input,"accion"));
        if(request.HttpMethod=="GET" && action=="bootstrap")return CajaBootstrap(c,request.QueryString["usuarioId"]);
        var session=CajaAuthorize(request,input);
        DateTime date=CajaDate(request.HttpMethod=="GET"?request.QueryString["fecha"]:Value(input,"fecha"));CajaCheckDate(session,date);
        int id=request.HttpMethod=="GET"?Convert.ToInt32(request.QueryString["id"]??"0"):(int)Number(Value(input,"id"));
        if(request.HttpMethod=="GET") {
            if(action=="formulario") {
                if(id==0){int deposit=Convert.ToInt32(request.QueryString["deposito"]??"0");object found=Scalar(c,null,"SELECT TOP 1 c.IDRecibo FROM dbo.CajaDiaTP c JOIN dbo.[Depósitos] d ON d.[IDDepósito]=c.[IDDepósito] AND d.IDEmp=c.IDEmp JOIN dbo.[Depósitos] elegido ON elegido.IDSucAsoc=d.IDSucAsoc AND elegido.IDEmp=d.IDEmp WHERE c.Fecha>=@p0 AND c.Fecha<@p1 AND c.IDEmp=1 AND elegido.[IDDepósito]=@p2 AND c.Anulado=0 ORDER BY c.IDRecibo DESC",date,date.AddDays(1),deposit);id=found==null?0:Convert.ToInt32(found);}
                if(id==0)return new {ok=true,cabecera=(object)null,detalle=new object[0],efectivo=new object[0],tarjetas=new object[0],version="",eliminada=Scalar(c,null,"SELECT 1 FROM dbo.CajaWebEstado w JOIN dbo.[Depósitos] d ON CONVERT(nvarchar(40),d.IDSucAsoc)=w.Usuario WHERE w.Fecha=@p0 AND w.Seccion='caja-eliminada' AND d.[IDDepósito]=@p1 AND d.IDEmp=1",date,Convert.ToInt32(request.QueryString["deposito"]??"0"))!=null};
                return CajaForm(c,null,id,session);
            }
            if(action=="comprobantes-valor")return CajaValueInvoices(c,id,Convert.ToInt32(request.QueryString["tipoValor"]??"0"),Convert.ToInt32(request.QueryString["tarjeta"]??"0"),session);
            if(action=="administradores")return CajaAdministrators();
            if(action=="consultar")return new {ok=true,filas=Rows(c,"SELECT c.IDRecibo,c.NroFactura,c.Fecha,c.Confirmado,c.Total,c.[IDDepósito],c.Nota,d.[Descripción] PV,d.IDSucAsoc FROM dbo.CajaDiaTP c JOIN dbo.[Depósitos] d ON d.[IDDepósito]=c.[IDDepósito] WHERE c.IDEmp=1 AND c.Anulado=0 AND c.Fecha>=@p0 AND c.Fecha<@p1 AND (@p2=0 OR d.IDSucAsoc=@p2) ORDER BY c.IDRecibo DESC",date,CajaDate(request.QueryString["hasta"]??date.ToString("yyyy-MM-dd")).AddDays(1),session.Restricted?session.Branch:0)};
            if(action=="estado") {string section=request.QueryString["seccion"];string user=section=="efectivo"?session.User:"";return new {ok=true,payload=CajaStatePayload(c,null,date,section,user)};}
            if(action=="dia")return CajaDay(c,null,date,session);
            if(action=="historial") {
                DateTime until=CajaDate(request.QueryString["hasta"]);if(until<date || (until-date).TotalDays>366)throw new InvalidOperationException("Consultá un rango de hasta un año.");if(session.Restricted && until!=date)throw new InvalidOperationException("Tu usuario solo puede consultar hoy.");
                return CajaHistory(c,date,until,session);
            }
            throw new InvalidOperationException("Consulta de Caja no disponible.");
        }
        if(action=="eliminar")CajaVerifyAdministrator(input);
        else if(!session.Edit)throw new InvalidOperationException("Tu usuario no tiene permiso de edición de Caja.");
        using(var tx=c.BeginTransaction(IsolationLevel.Serializable)){
            try {
                if(action=="actualizar-dia") {
                    var pending=CajaRows(c,tx,"SELECT c.IDRecibo FROM dbo.CajaDiaTP c WITH(UPDLOCK,HOLDLOCK) JOIN dbo.[Depósitos] d ON d.[IDDepósito]=c.[IDDepósito] AND d.IDEmp=c.IDEmp WHERE c.IDEmp=1 AND c.Anulado=0 AND c.Confirmado=0 AND c.Fecha>=@p0 AND c.Fecha<@p1 AND (@p2=0 OR d.IDSucAsoc=@p2)",date,date.AddDays(1),session.Restricted?session.Branch:0);
                    foreach(var row in pending)CajaRecalculate(c,tx,CajaHeader(c,tx,Convert.ToInt32(row["IDRecibo"]),true,session));
                    tx.Commit();return new {ok=true,cajasActualizadas=pending.Count};
                }
                if(action=="guardar-estado") {
                    string section=Text(Value(input,"seccion"));if(section!="manual" && section!="totales" && section!="efectivo" && section!="sistema")throw new InvalidOperationException("Sección de Caja inválida.");
                    string user=section=="efectivo"?session.User:"";
                    var current=CajaStatePayload(c,tx,date,section,user);var baseline=Object(Value(input,"anterior"));var changes=Object(Value(input,"cambios"));
                    if(section=="efectivo" && changes.ContainsKey("usuarioId") && Text(changes["usuarioId"])!=session.User)throw new InvalidOperationException("El conteo pertenece a otro usuario. Volvé a cargar Caja.");
                    foreach(var p in changes){if(CajaJson(Value(current,p.Key))!=CajaJson(Value(baseline,p.Key)))throw new InvalidOperationException("Caja cambió en otra PC. Recargá antes de guardar.");}
                    foreach(var p in changes)current[p.Key]=p.Value;
                    CajaStore(c,tx,date,section,user,current);
                    if(section=="manual" && changes.ContainsKey("transfers")) {
                        // The dedicated MP table is authoritative; parent payload only retains metadata.
                        Execute(c,tx,"DELETE dbo.CajaWebMercadoPago WHERE Fecha=@p0",date);
                        var seen=new HashSet<string>();foreach(var item in PurchaseArray(changes["transfers"])) {var r=Object(item);string rid=Text(Value(r,"id"));if(rid.Length==0||rid.Length>100||!seen.Add(rid))throw new InvalidOperationException("Transferencia Mercado Pago sin ID o repetida.");Execute(c,tx,"INSERT dbo.CajaWebMercadoPago(Fecha,ID,Nombre,Importe,Sucursal,Payload) VALUES(@p0,@p1,@p2,@p3,@p4,@p5)",date,rid,Text(Value(r,"name")),Number(Value(r,"amount")),Text(Value(r,"branchId")),CajaJson(r));}
                    }
                    tx.Commit();return new {ok=true,payload=current};
                }
                if(action=="abrir") {
                    if(date!=DateTime.Today)throw new InvalidOperationException("La nueva Caja debe tener la fecha de hoy.");
                    int deposit=(int)Number(Value(input,"deposito"));var deps=CajaRows(c,tx,"SELECT IDSucAsoc FROM dbo.[Depósitos] WITH(HOLDLOCK) WHERE [IDDepósito]=@p0 AND IDEmp=1",deposit);if(deps.Count!=1)throw new InvalidOperationException("Elegí un punto de venta válido.");int branch=Convert.ToInt32(deps[0]["IDSucAsoc"]);
                    if(session.Restricted && branch!=session.Branch)throw new InvalidOperationException("Elegí tu sucursal.");
                    if(CajaRows(c,tx,"SELECT c.IDRecibo FROM dbo.CajaDiaTP c WITH(UPDLOCK,HOLDLOCK) JOIN dbo.[Depósitos] d ON d.[IDDepósito]=c.[IDDepósito] WHERE c.Fecha>=@p0 AND c.Fecha<@p1 AND c.IDEmp=1 AND c.Anulado=0 AND d.IDSucAsoc=@p2",date,date.AddDays(1),branch).Count>0)throw new InvalidOperationException("Ya existe una Caja de hoy para esta sucursal. Consultá esa misma Caja.");
                    int oper=session.Operator;if(oper==0)oper=(int)Number(Value(input,"operador"));if(CajaRows(c,tx,"SELECT IDEmpleado FROM dbo.Empleados WHERE IDEmpleado=@p0",oper).Count!=1)throw new InvalidOperationException("Elegí un operador SQL válido.");
                    object sequence=Scalar(c,tx,"SELECT ISNULL(MAX(TRY_CONVERT(int,RIGHT(NroFactura,8))),0)+1 FROM dbo.CajaDiaTP WITH(UPDLOCK,HOLDLOCK) WHERE [IDDepósito]=@p0 AND IDEmp=1",deposit);
                    string number=deposit.ToString("D4")+"-"+Convert.ToInt32(sequence).ToString("D8");
                    id=Convert.ToInt32(Scalar(c,tx,"INSERT dbo.CajaDiaTP([IDDepósito],NroFactura,Fecha,IDOper,IDEmp,IDTipoCaja,Global,Nota) OUTPUT INSERTED.IDRecibo VALUES(@p0,@p1,@p2,@p3,1,1,@p4,@p5)",deposit,number,date,oper,true,Text(Value(input,"nota"))));
                    Execute(c,tx,"DELETE dbo.CajaWebEstado WHERE Fecha=@p0 AND Seccion='caja-eliminada' AND Usuario=@p1",date,branch.ToString(CultureInfo.InvariantCulture));
                    CajaRecalculate(c,tx,CajaHeader(c,tx,id,true,session));
                } else {
                    var h=CajaHeader(c,tx,id,action!="eliminar",session);date=Convert.ToDateTime(h["Fecha"]).Date;
                    CajaVerifyVersion(c,tx,id,session,Text(Value(input,"version")));
                    if(action=="eliminar") {CajaDelete(c,tx,h);tx.Commit();return new {ok=true,eliminada=true};}
                    if(action=="actualizar")CajaRecalculate(c,tx,h);
                    else if(action=="detalle") {
                        foreach(var item in PurchaseArray(Value(input,"filas"))){var r=Object(item);int pay=(int)Number(Value(r,"IDTipoPago"));int count=Execute(c,tx,"UPDATE dbo.CajaDiaTS SET ImpAnt=@p2,ImpCont=@p3,ImpFin=@p4,Nota=@p5,ImpAct=@p2+Importe+ImpRet WHERE IDRecibo=@p0 AND IDTipoPago=@p1",id,pay,Number(Value(r,"ImpAnt")),Number(Value(r,"ImpCont")),Number(Value(r,"ImpFin")),Text(Value(r,"Nota")));if(count!=1)throw new InvalidOperationException("El medio de pago de Caja cambió.");}
                        Execute(c,tx,"UPDATE dbo.CajaDiaTP SET Nota=@p1,Total=(SELECT ISNULL(SUM(ImpAct),0) FROM dbo.CajaDiaTS WHERE IDRecibo=@p0) WHERE IDRecibo=@p0",id,Text(Value(input,"nota")));
                    } else if(action=="efectivo") {
                        int mov=(int)Number(Value(input,"idMov"));if(mov==0)Execute(c,tx,"INSERT dbo.CajaDiaTSEfec(IDRecibo,Importe,Nota,Hora) VALUES(@p0,@p1,@p2,GETDATE())",id,Number(Value(input,"importe")),Text(Value(input,"nota")));
                        else {int count=Convert.ToBoolean(Value(input,"eliminar")??false)?Execute(c,tx,"DELETE dbo.CajaDiaTSEfec WHERE IDMov=@p0 AND IDRecibo=@p1",mov,id):Execute(c,tx,"UPDATE dbo.CajaDiaTSEfec SET Importe=@p2,Nota=@p3 WHERE IDMov=@p0 AND IDRecibo=@p1",mov,id,Number(Value(input,"importe")),Text(Value(input,"nota")));if(count!=1)throw new InvalidOperationException("El movimiento cambió.");}
                        CajaRecalculate(c,tx,h);
                    } else if(action=="cerrar") {
                        CajaClose(c,tx,h,Text(Value(input,"nota")));
                    } else throw new InvalidOperationException("Acción de Caja no disponible.");
                }
                object form=CajaForm(c,tx,id,session);tx.Commit();return form;
            }catch{try{tx.Rollback();}catch{}throw;}
        }
    }
    private static object CajaDay(SqlConnection c,SqlTransaction tx,DateTime date,CajaSession session) {
        var branches=new Dictionary<string,object>();var allTotals=new Dictionary<int,decimal>();
        var pays=CajaRows(c,tx,"SELECT IDTipoPago,TipoPago FROM dbo.TiposPagos WHERE EnCaja<>0 ORDER BY IDTipoPago");
        foreach(int branch in new[]{1,2}) {
            if(session.Restricted && branch!=session.Branch)continue;
            string key=branch==1?"progreso_ruta":"calle5_espana";var totals=new Dictionary<int,decimal>();foreach(var r in CajaAmounts(c,tx,date,branch,0,0))totals[Convert.ToInt32(r["IDTipoPago"])]=Number(r["Importe"]);
            var stored=CajaRows(c,tx,"SELECT v.IDTipoPago,v.ImpAnt,v.Importe,v.ImpRet FROM dbo.CajaDiaTS v WHERE v.IDRecibo=(SELECT TOP 1 x.IDRecibo FROM dbo.CajaDiaTP x JOIN dbo.[Depósitos] d ON d.[IDDepósito]=x.[IDDepósito] AND d.IDEmp=x.IDEmp WHERE x.IDEmp=1 AND x.Anulado=0 AND x.Fecha>=@p0 AND x.Fecha<@p1 AND d.IDSucAsoc=@p2 ORDER BY x.IDRecibo DESC)",date,date.AddDays(1),branch);
            var rows=new List<object>();foreach(var p in pays){int pay=Convert.ToInt32(p["IDTipoPago"]);decimal amount=totals.ContainsKey(pay)?totals[pay]:0,initial=0,ie=0;foreach(var v in stored)if(Convert.ToInt32(v["IDTipoPago"])==pay){amount=Number(v["Importe"]);initial=Number(v["ImpAnt"]);ie=Number(v["ImpRet"]);break;}rows.Add(new {type=Text(p["TipoPago"]),initial=initial,day=amount,ie=ie,final=initial+amount+ie});allTotals[pay]=(allTotals.ContainsKey(pay)?allTotals[pay]:0)+amount;}
            branches[key]=new {id=key,label=branch==1?"Suc. Progreso y Ruta":"Suc. Calle 5 y España",rows=rows};
        }
        var all=new List<object>();foreach(var p in pays){int pay=Convert.ToInt32(p["IDTipoPago"]);decimal amount=allTotals.ContainsKey(pay)?allTotals[pay]:0;all.Add(new {type=Text(p["TipoPago"]),initial=0,day=amount,ie=0,final=amount});}
        var cash=CajaRows(c,tx,"SELECT m.IDMov id,m.IDRecibo idRecibo,m.Importe amount,m.Nota note,CONVERT(varchar(5),m.Hora,108) hour,c.[IDDepósito] idDeposito,d.IDSucAsoc idSucursal,CASE WHEN d.IDSucAsoc=1 THEN 'progreso_ruta' ELSE 'calle5_espana' END branchId,d.[Descripción] Sucursal FROM dbo.CajaDiaTSEfec m JOIN dbo.CajaDiaTP c ON c.IDRecibo=m.IDRecibo JOIN dbo.[Depósitos] d ON d.[IDDepósito]=c.[IDDepósito] AND d.IDEmp=c.IDEmp WHERE c.IDEmp=1 AND c.Fecha>=@p0 AND c.Fecha<@p1 AND c.Anulado=0 AND (@p2=0 OR d.IDSucAsoc=@p2) ORDER BY m.Hora,m.IDMov",date,date.AddDays(1),session.Restricted?session.Branch:0);
        var receipts=CajaRows(c,tx,"SELECT r.IDRecibo id,r.IDRecibo idRecibo,r.NroFactura number,r.Cliente client,r.Concepto concept,r.Nota note,r.Total amount,CONVERT(varchar(5),r.FechaCarga,108) hour,r.[IDDepósito] idDeposito,d.IDSucAsoc idSucursal,CASE WHEN d.IDSucAsoc=1 THEN 'progreso_ruta' ELSE 'calle5_espana' END branchId,d.[Descripción] branch FROM dbo.RecibosXTP r JOIN dbo.[Depósitos] d ON d.[IDDepósito]=r.[IDDepósito] AND d.IDEmp=r.IDEmp WHERE r.IDEmp=1 AND r.Fecha>=@p0 AND r.Fecha<@p1 AND r.Confirmado<>0 AND r.Anulado=0 AND (@p2=0 OR d.IDSucAsoc=@p2) ORDER BY r.FechaCarga,r.IDRecibo",date,date.AddDays(1),session.Restricted?session.Branch:0);
        var paymentRows=CajaRows(c,tx,"SELECT r.IDRecibo,p.TipoPago type,SUM(v.Importe) amount FROM dbo.RecibosXTP r JOIN dbo.RecibosXTS v ON v.IDRecibo=r.IDRecibo JOIN dbo.TiposPagos p ON p.IDTipoPago=v.IDTipoPago WHERE r.IDEmp=1 AND r.Fecha>=@p0 AND r.Fecha<@p1 AND r.Confirmado<>0 AND r.Anulado=0 GROUP BY r.IDRecibo,p.TipoPago",date,date.AddDays(1));
        foreach(var receipt in receipts){var payments=new List<object>();foreach(var p in paymentRows)if(Convert.ToInt32(p["IDRecibo"])==Convert.ToInt32(receipt["id"]))payments.Add(new{type=p["type"],amount=p["amount"]});receipt["payments"]=payments;receipt["date"]=date.ToString("yyyy-MM-dd");}
        var system=CajaRows(c,tx,"SELECT CONCAT('sql-',f.IDRecibo,'-',v.Orden) id,f.IDRecibo idRecibo,v.Orden ordenValor,t.Abreviatura tipo_comp,f.NroFactura nro_factura,f.ApeYNom cliente,v.ImpEnt*t.ImpPor monto,p.TipoPago tipo_pago,d.IDSucAsoc idSucursal FROM dbo.FacturasATP f JOIN dbo.FacturasTSVal v ON v.IDRecibo=f.IDRecibo JOIN dbo.TipoComprobantes t ON t.IDComprob=f.IDComprob JOIN dbo.TiposPagos p ON p.IDTipoPago=v.IDTipoPago JOIN dbo.[Depósitos] d ON d.[IDDepósito]=f.[IDDepósito] AND d.IDEmp=f.IDEmp WHERE f.IDEmp=1 AND f.Fecha>=@p0 AND f.Fecha<@p1 AND f.Confirmado<>0 AND f.Anulada=0 AND t.IDTipoAcred>0 AND v.IDTarjeta=4 AND p.TipoPago='Transf Bria.' AND (@p2=0 OR d.IDSucAsoc=@p2) ORDER BY f.Fecha,t.Abreviatura,f.NroFactura,f.IDRecibo,v.Orden",date,date.AddDays(1),session.Restricted?session.Branch:0);
        var adjustments=Object(Value(Object(CajaStored(c,tx,date,"sistema","")),"rows"));var merged=new List<object>();var baseIds=new HashSet<string>();int order=0;
        foreach(var row in system){string rid=Text(row["id"]);baseIds.Add(rid);row["fecha"]=date.ToString("yyyy-MM-dd");row["source"]="imported";row["source_key"]=rid;row["orden"]=order++;var overlay=Object(Value(adjustments,rid));if(Convert.ToBoolean(Value(overlay,"deleted")??false))continue;foreach(var p in overlay)row[p.Key]=p.Value;merged.Add(row);}
        foreach(var p in adjustments){var row=Object(p.Value);if(!baseIds.Contains(p.Key) && Text(Value(row,"source"))=="manual" && !Convert.ToBoolean(Value(row,"deleted")??false))merged.Add(row);}
        var manual=CajaStatePayload(c,tx,date,"manual","");
        return new {ok=true,fecha=date.ToString("yyyy-MM-dd"),movimientos=new{sql=true,branches=branches,rows=all,globalOnlyRows=new object[0]},ingresosEgresos=new{rows=cash},recibos=new{rows=receipts},systemRows=merged,manual=manual,totales=CajaStored(c,tx,date,"totales",""),efectivo=CajaStored(c,tx,date,"efectivo",session.User)};
    }
    private static object CajaHistory(SqlConnection c,DateTime from,DateTime until,CajaSession session) {
        int branch=session.Restricted?session.Branch:0;
        var detail=Rows(c,"WITH cajas AS (SELECT c.IDRecibo,CONVERT(varchar(10),c.Fecha,23) fecha,d.IDSucAsoc,ROW_NUMBER() OVER(PARTITION BY CONVERT(date,c.Fecha),d.IDSucAsoc ORDER BY c.IDRecibo DESC) rn FROM dbo.CajaDiaTP c JOIN dbo.[Depósitos] d ON d.[IDDepósito]=c.[IDDepósito] AND d.IDEmp=c.IDEmp WHERE c.IDEmp=1 AND c.Anulado=0 AND c.Fecha>=@p0 AND c.Fecha<@p1 AND (@p2=0 OR d.IDSucAsoc=@p2)) SELECT c.fecha,c.IDSucAsoc sucursal,p.TipoPago type,v.ImpAnt initial,v.Importe day,v.ImpRet ie FROM cajas c JOIN dbo.CajaDiaTS v ON v.IDRecibo=c.IDRecibo JOIN dbo.TiposPagos p ON p.IDTipoPago=v.IDTipoPago WHERE c.rn=1 ORDER BY c.fecha,c.IDSucAsoc,v.IDTipoPago",from,until.AddDays(1),branch);
        var cash=Rows(c,"SELECT CONVERT(varchar(10),c.Fecha,23) fecha,m.IDMov id,m.IDRecibo idRecibo,m.Importe amount,m.Nota note,CONVERT(varchar(5),m.Hora,108) hour,CASE WHEN d.IDSucAsoc=1 THEN 'progreso_ruta' ELSE 'calle5_espana' END branchId FROM dbo.CajaDiaTSEfec m JOIN dbo.CajaDiaTP c ON c.IDRecibo=m.IDRecibo JOIN dbo.[Depósitos] d ON d.[IDDepósito]=c.[IDDepósito] AND d.IDEmp=c.IDEmp WHERE c.IDEmp=1 AND c.Anulado=0 AND c.Fecha>=@p0 AND c.Fecha<@p1 AND (@p2=0 OR d.IDSucAsoc=@p2) ORDER BY c.Fecha,m.Hora,m.IDMov",from,until.AddDays(1),branch);
        var publications=new List<object>();
        for(DateTime date=from;date<=until;date=date.AddDays(1)) {
            string key=date.ToString("yyyy-MM-dd");var groups=new Dictionary<string,object>();
            foreach(int b in new[]{1,2}) {var rows=new List<object>();foreach(var r in detail)if(Text(r["fecha"])==key && Convert.ToInt32(r["sucursal"])==b)rows.Add(new{type=r["type"],initial=r["initial"],day=r["day"],ie=r["ie"]});if(rows.Count>0)groups[b==1?"progreso_ruta":"calle5_espana"]=new{rows=rows};}
            var cashRows=new List<object>();foreach(var r in cash)if(Text(r["fecha"])==key)cashRows.Add(r);
            publications.Add(new{fecha=key,movimientos=new{sql=true,branches=groups},ingresosEgresos=new{rows=cashRows},recibos=new{rows=new object[0]}});
        }
        return new{ok=true,publicaciones=publications};
    }
}
