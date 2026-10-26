using System;
using System.Collections.Generic;
using System.Data.SqlClient;
using System.IO;
using System.Reflection;
using System.Net;
using System.Text;
using System.Web.Script.Serialization;

internal static class PurchaseSqlChecks
{
    static readonly JavaScriptSerializer Json = new JavaScriptSerializer();
    static Type Api;
    static object Call(string name, params object[] args)
    {
        try { return Api.GetMethod(name, BindingFlags.NonPublic | BindingFlags.Static).Invoke(null, args); }
        catch (TargetInvocationException ex) { throw ex.InnerException; }
    }
    static object Scalar(SqlConnection c, string query)
    {
        using (var command = new SqlCommand(query, c)) return command.ExecuteScalar();
    }
    static void Assert(bool value, string description) { if (!value) throw new Exception(description); }
    static Dictionary<string, object> Payload(int type, int payment, decimal discount)
    {
        var data = new Dictionary<string, object> { { "id", Guid.NewGuid().ToString() }, { "tipo", type }, { "numero", "9998-87654321" },
            { "fecha", DateTime.Today.ToString("yyyy-MM-dd") }, { "periodo", DateTime.Today.ToString("yyyy-MM-01") }, { "vencimiento", DateTime.Today.AddDays(30).ToString("yyyy-MM-dd") },
            { "proveedor", 13 }, { "puntoVenta", 7 }, { "pago", payment }, { "tipoBien", 2 }, { "cuenta", "30" }, { "concepto", "PRUEBA CON ROLLBACK" },
            { "cuit", "33-70833259-9" }, { "descuento", discount }, { "movimiento", 0 }, { "enStock", false }, { "nota", "PRUEBA REVERSIBLE NO CONFIRMAR" }, { "usuarioId", "test-rollback" } };
        data["impuestos"] = new object[] {
            new Dictionary<string, object> { {"impuesto",0},{"neto",1},{"importe",1000m},{"porcentaje",.21m},{"descripcion","NETO"} },
            new Dictionary<string, object> { {"impuesto",1},{"neto",1},{"importe",210m},{"porcentaje",.21m},{"descripcion","IVA"} }
        };
        return data;
    }
    static Dictionary<string, object> Confirm(SqlConnection c, Dictionary<string, object> data)
    {
        return (Dictionary<string, object>)Json.DeserializeObject(Json.Serialize(Call("PurchaseConfirm", c, data, true)));
    }
    static Dictionary<string, object> Query(SqlConnection c, string query)
    {
        using (var listener = new HttpListener())
        {
            listener.Prefixes.Add("http://localhost:18087/"); listener.Start();
            var request=(HttpWebRequest)WebRequest.Create("http://localhost:18087/?"+query);request.Proxy=null;
            var responseTask=request.GetResponseAsync();var context=listener.GetContext();
            var result=Call("PurchaseQuery",c,context.Request);
            byte[] bytes=Encoding.UTF8.GetBytes(Json.Serialize(result));context.Response.ContentLength64=bytes.Length;
            context.Response.OutputStream.Write(bytes,0,bytes.Length);context.Response.Close();
            using(var response=responseTask.GetAwaiter().GetResult())using(var reader=new StreamReader(response.GetResponseStream()))
                return (Dictionary<string,object>)Json.DeserializeObject(reader.ReadToEnd());
        }
    }
    static void Reject(SqlConnection c, Dictionary<string, object> data, string fragment)
    {
        try { Confirm(c, data); throw new Exception("Se aceptó " + fragment); }
        catch (InvalidOperationException ex) { Assert(ex.Message.IndexOf(fragment, StringComparison.OrdinalIgnoreCase) >= 0, ex.Message); }
    }
    static void Main(string[] args)
    {
        Api = Assembly.LoadFile(Path.Combine(AppDomain.CurrentDomain.BaseDirectory, args.Length>0?args[0]:"FacturacionCopiaApi.next.exe")).GetType("FacturacionCopiaApi");
        using (var c = (SqlConnection)Call("Connect"))
        {
            var before = new Dictionary<string, int>();
            string[] tables = { "ComprasTP", "ComprasTS", "OrdPagosTP", "OrdPagosTSFac", "OrdPagosTSPag" };
            foreach (string table in tables) before[table] = Convert.ToInt32(Scalar(c, "SELECT COUNT(*) FROM dbo." + table));
            var options=Query(c,"consulta=opciones");
            foreach(string key in new[]{"tipos","proveedores","cuentas","pagos","bienes","impuestos","puntosVenta"}) Assert(((object[])options[key]).Length>0,"Sin opciones SQL: "+key);
            Query(c,"consulta=proveedor&proveedor=13");Query(c,"consulta=movimientos&proveedor=13&puntoVenta=7");
            Query(c,"consulta=numero&tipo=51");Query(c,"consulta=buscar");Query(c,"consulta=iva");Query(c,"consulta=cuenta-corriente&proveedor=13");Query(c,"consulta=cuenta-corriente");
            int real=Convert.ToInt32(Scalar(c,"SELECT TOP 1 IDRecibo FROM dbo.ComprasTP WHERE Confirmado=1 ORDER BY IDRecibo DESC"));
            Assert(((object[])Query(c,"consulta=detalle&id="+real)["factura"]).Length==1,"Detalle de factura no visible");
            foreach (var scenario in new[] { new[] {21,3}, new[] {46,1}, new[] {31,3}, new[] {51,3} })
            {
                var result = Confirm(c, Payload(scenario[0],scenario[1], scenario[0]==46?.15m:0m));
                var invoice = (Dictionary<string,object>)((object[])result["factura"])[0];
                decimal expected = scenario[0]==31||scenario[0]==51 ? -1210m : 1210m;
                Assert(Convert.ToDecimal(invoice["Total"]) == expected, "Signo de compra/crédito incorrecto");
                Assert(((object[])result["impuestos"]).Length==2, "Faltan impuestos");
                Assert(((object[])result["pagos"]).Length==(scenario[1]==1?1:0), "Orden de pago incorrecta");
                if(scenario[0]==46) {
                    var credit=(Dictionary<string,object>)((object[])result["credito"])[0];
                    Assert(Convert.ToDecimal(credit["Total"])==-181.5m,"Crédito por descuento incorrecto");
                    var cash = (Dictionary<string,object>)((object[])result["pagos"])[0];
                    Assert(Convert.ToDecimal(cash["TotalPagos"])==1028.5m && Convert.ToDecimal(cash["Importe"])==1028.5m,"El pago debe conservar el importe neto del descuento");
                }
                int id=Convert.ToInt32(invoice["IDRecibo"]);
                Assert(Convert.ToInt32(Scalar(c,"SELECT COUNT(*) FROM dbo.ComprasTP WHERE IDRecibo="+id))==0,"La prueba dejó una compra real");
            }
            var invalid=Payload(21,3,0); invalid["cuit"]="123"; Reject(c,invalid,"CUIT");
            invalid=Payload(21,3,0);invalid["periodo"]=DateTime.Today.AddMonths(-1).ToString("yyyy-MM-01");Reject(c,invalid,"período");
            invalid=Payload(21,3,0);invalid["impuestos"]=new object[]{((object[])invalid["impuestos"])[0]};Reject(c,invalid,"netos");
            invalid=Payload(46,3,0);invalid["numero"]="0000-00000001";Reject(c,invalid,"número");
            invalid=Payload(46,3,0);invalid["movimiento"]=1;Reject(c,invalid,"stock");
            using(var cmd=new SqlCommand("SELECT TOP 1 r.IDRecibo,p.IDProveedor,p.CUIT,p.CodCta,d.IDDepósito FROM dbo.RecibosTP r JOIN dbo.Proveedores p ON p.IDProveedor=r.IDProveedor AND p.Suspendido=0 JOIN dbo.Cuentas a ON a.CodCuenta=p.CodCta JOIN dbo.[Depósitos] d ON d.IDSucAsoc=r.IDSuc AND d.IDEmp=a.IDEmp AND d.IDDepósito>1 WHERE r.IDTipoMov=23 AND r.Confirmado=1 AND r.Anulado=0 AND r.IDFactura IS NULL AND ISNULL(r.NroFactura,'')='' ORDER BY r.IDRecibo DESC",c))
            {
                int movement=0;var data=Payload(46,3,0);
                using(var reader=cmd.ExecuteReader())if(reader.Read()) {movement=reader.GetInt32(0);data["movimiento"]=movement;data["enStock"]=true;data["proveedor"]=reader[1];data["cuit"]=reader[2] is DBNull?"":reader[2];data["cuenta"]=reader[3];data["puntoVenta"]=reader[4];}
                if(movement>0) {
                    var linked=Confirm(c,data);var invoice=(Dictionary<string,object>)((object[])linked["factura"])[0];
                    Assert(Convert.ToInt32(invoice["stockId"])==movement,"Vínculo de stock incorrecto");
                    Assert(Scalar(c,"SELECT IDFactura FROM dbo.RecibosTP WHERE IDRecibo="+movement) is DBNull,"No se revirtió el vínculo del stock");
                }
            }
            foreach(string table in tables) Assert(before[table]==Convert.ToInt32(Scalar(c,"SELECT COUNT(*) FROM dbo."+table)),"Cambió la cantidad de registros: "+table);
            Console.WriteLine("PASS SQL: opciones y consultas; compra IVA/CC; contado y OP; crédito; descuento; numeración automática; CUIT/período/netos/stock inválidos; vínculo de stock. Todas las inserciones y vínculos revertidos.");
        }
    }
}
