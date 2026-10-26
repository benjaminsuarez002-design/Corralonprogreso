$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$compiler = "$env:WINDIR\Microsoft.NET\Framework64\v4.0.30319\csc.exe"
$testSource = @'
using System;
using System.Collections.Generic;
using System.Data.SqlClient;
using System.Reflection;
using System.Net;
using System.Threading.Tasks;
using System.Web.Script.Serialization;
class StockPreviewCheck {
 static readonly JavaScriptSerializer json = new JavaScriptSerializer { MaxJsonLength = 20000000 };
 static object Invoke(Type t,string name,params object[] args){try{return t.GetMethod(name,BindingFlags.NonPublic|BindingFlags.Static).Invoke(null,args);}catch(TargetInvocationException ex){throw ex.InnerException;}}
 static Dictionary<string,object> Map(object obj){return json.Deserialize<Dictionary<string,object>>(json.Serialize(obj));}
 static void Main(){
  var type=Assembly.LoadFrom(System.IO.Path.Combine(AppDomain.CurrentDomain.BaseDirectory,"FacturacionCopiaApi.next.exe")).GetType("FacturacionCopiaApi");
  using(var cn=(SqlConnection)Invoke(type,"Connect")){
   string id="",code="";int branch=0,point=0,provider=0;decimal before=0;
   using(var cmd=cn.CreateCommand()){
    cmd.CommandText="SELECT TOP 1 a.IDArt,a.IDArtProv,a.IDProveedor,s.IDSuc,s.StockAct,p.IDDepósito FROM dbo.[Artículos] a INNER JOIN dbo.ArtsStock s ON s.IDArt=a.IDArt INNER JOIN dbo.[Depósitos] p ON p.IDSucAsoc=s.IDSuc INNER JOIN dbo.Proveedores pr ON pr.IDProveedor=a.IDProveedor WHERE a.Suspendido=0 AND pr.Suspendido=0 AND s.StockAct BETWEEN 0 AND 10000 ORDER BY a.IDArt,s.IDSuc,p.IDDepósito";
    using(var r=cmd.ExecuteReader()){if(!r.Read())throw new Exception("Sin artículo para previsualizar.");id=Convert.ToString(r[0]);code=Convert.ToString(r[1]);provider=Convert.ToInt32(r[2]);branch=Convert.ToInt32(r[3]);before=Convert.ToDecimal(r[4]);point=Convert.ToInt32(r[5]);}
   }
   var line=new Dictionary<string,object>{{"idart",id},{"codigo",code},{"cantidad",5},{"precioUnitario",100}};
   var data=new Dictionary<string,object>{{"id",Guid.NewGuid().ToString()},{"sucursal",branch},{"puntoVenta",point},{"proveedor",provider},{"tipoMovimiento",23},{"articulos",new object[]{line}}};
   Check(type,cn,data,before+5);
   data["tipoMovimiento"]=28;Check(type,cn,data,before-5);
   data["tipoMovimiento"]=20;Check(type,cn,data,before);
   data["tipoMovimiento"]=35;line["conteo"]=9;Check(type,cn,data,9);
   line["conteo"]=0;Check(type,cn,data,0);
   line.Remove("conteo");line["cantidad"]=-2;Check(type,cn,data,before-2);
   line["cantidad"]=5;data["tipoMovimiento"]=57;data["sucursalDestino"]=branch;
   try{Invoke(type,"StockIngreso",cn,data,false);throw new Exception("Aceptó misma sucursal.");}catch(InvalidOperationException){Console.WriteLine("PASS transferencia rechaza mismo destino");}
   using(var listener=new HttpListener()){
    listener.Prefixes.Add("http://localhost:19131/");listener.Start();
    foreach(string query in new[]{"","articulos","compras","movimientos","relacionados","detalle","pendientes"}){
     var task=Task.Run(()=>{using(var client=new WebClient()){return client.DownloadString("http://localhost:19131/?consulta="+query+"&sucursal="+branch+"&proveedor="+provider+"&recibo=0");}});
     var context=listener.GetContext();var result=Invoke(type,"StockConsulta",cn,context.Request);byte[] bytes=System.Text.Encoding.UTF8.GetBytes(json.Serialize(result));context.Response.OutputStream.Write(bytes,0,bytes.Length);context.Response.Close();task.Wait();Console.WriteLine("PASS consulta SQL "+(query==""?"cabecera":query));
    }
    listener.Stop();
   }
   using(var cmd=cn.CreateCommand()){cmd.CommandText="SELECT StockAct FROM dbo.ArtsStock WHERE IDArt=@id AND IDSuc=@branch";cmd.Parameters.AddWithValue("@id",id);cmd.Parameters.AddWithValue("@branch",branch);if(Convert.ToDecimal(cmd.ExecuteScalar())!=before)throw new Exception("La previsualización cambió stock.");}
   Console.WriteLine("PASS todas las pruebas fueron de lectura, sin confirmar movimientos");
  }
 }
 static void Check(Type type,SqlConnection cn,Dictionary<string,object> input,decimal expected){var result=Map(Invoke(type,"StockIngreso",cn,input,false));var lines=(System.Collections.ArrayList)result["articulos"];var first=(Dictionary<string,object>)lines[0];if(Convert.ToDecimal(first["stockDespues"])!=expected)throw new Exception("Stock inesperado.");Console.WriteLine("PASS previsualización movimiento "+input["tipoMovimiento"]);}
}
'@
$source = Join-Path $root 'tmp\stock-plan-inspect\StockPreviewCheck.cs'
[IO.File]::WriteAllText($source,$testSource)
& $compiler /nologo /target:exe "/out:$(Join-Path $root '.codex-staging\StockPreviewCheck.exe')" /reference:System.Data.dll /reference:System.Web.Extensions.dll $source
if ($LASTEXITCODE -ne 0) { throw 'No compiló la prueba de lectura.' }
& (Join-Path $root '.codex-staging\StockPreviewCheck.exe')
if ($LASTEXITCODE -ne 0) { throw 'Falló la previsualización de stock.' }
