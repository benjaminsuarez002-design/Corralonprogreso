using System;
using System.Collections.Generic;
using System.Reflection;
class HistorialTransferCheck {
 static MethodInfo method;
 static Dictionary<string,object> Input(string budget,int origin=1,int destination=2,int type=57,string user="Ana") {return new Dictionary<string,object>{{"presupuestoId",budget},{"sucursal",origin},{"sucursalDestino",destination},{"tipoMovimiento",type},{"usuarioId",user},{"accion","transferir-presupuesto"}};}
 static Dictionary<string,object> Call(Dictionary<string,object> data){try{return (Dictionary<string,object>)method.Invoke(null,new object[]{data});}catch(TargetInvocationException ex){throw ex.InnerException;}}
 static void Check(bool ok,string message){if(!ok)throw new Exception(message);Console.WriteLine("PASS "+message);}
 static void Reject(Dictionary<string,object> data){try{Call(data);}catch(InvalidOperationException){return;}throw new Exception("Acepto datos invalidos");}
 static void Main(string[] args){
  method=Assembly.LoadFrom(args[0]).GetType("FacturacionCopiaApi").GetMethod("StockBudgetTransferInput",BindingFlags.NonPublic|BindingFlags.Static);
  var input=Input("presupuesto-A");var first=Call(input);var retry=Call(Input("presupuesto-A"));var anotherUser=Call(Input("presupuesto-A",1,2,57,"Juan"));var reversed=Call(Input("presupuesto-A",2,1));var other=Call(Input("presupuesto-B"));
  Guid guid;Check(Guid.TryParse((string)first["id"],out guid),"identificador compatible con Cargar stock");
  Check((string)first["id"]==(string)retry["id"],"reintento conserva identidad");
  Check((string)first["id"]==(string)anotherUser["id"]&&(string)first["id"]==(string)reversed["id"],"otra PC, usuario o sucursal no genera otra identidad para el mismo presupuesto");
  Check((string)first["id"]!=(string)other["id"],"presupuestos distintos mantienen identidades separadas");
  Check((string)first["accion"]=="confirmar"&&!first.ContainsKey("presupuestoId")&&input.ContainsKey("presupuestoId"),"adapta sin modificar los datos originales");
  Reject(Input(""));Reject(Input("A",1,1));Reject(Input("A",2,2));Reject(Input("A",3,1));Reject(Input("A",1,2,23));
  Check(true,"rechaza presupuesto ausente, misma sucursal y movimiento distinto de transferencia");
  Console.WriteLine("Sin conexiones SQL ni movimientos reales.");
 }
}
