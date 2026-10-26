param([switch]$Descargar)
$ErrorActionPreference='Stop'
$taskRoot=Split-Path -Parent $PSScriptRoot
$taskDirectory=Join-Path $taskRoot 'servidor\padron-arca'
[IO.Directory]::CreateDirectory($taskDirectory) | Out-Null
$taskZip=Join-Path $taskDirectory 'apellidoNombreDenominacion.zip'
if($Descargar -or -not (Test-Path -LiteralPath $taskZip)){
 Invoke-WebRequest 'https://www.afip.gob.ar/genericos/cInscripcion/archivos/apellidoNombreDenominacion.zip' -OutFile $taskZip -TimeoutSec 180
}
Add-Type -AssemblyName System.IO.Compression,System.IO.Compression.FileSystem
$taskCode=@'
using System;
using System.Data;
using System.Data.SqlClient;
using System.IO;
using System.IO.Compression;
using System.Text;
using System.Globalization;
using System.Text.RegularExpressions;
public static class CorralonPadronImport {
 static object Query(SqlConnection c,SqlTransaction tx,string sql,params object[] args){using(var cmd=new SqlCommand(sql,c,tx)){cmd.CommandTimeout=600;for(int i=0;i<args.Length;i++)cmd.Parameters.AddWithValue("@p"+i,args[i]);return cmd.ExecuteScalar();}}
 public static void Run(SqlConnection c,string zip){
  if(Convert.ToInt32(Query(c,null,"DECLARE @r int; EXEC @r=sp_getapplock @Resource='Corralon.ImportarPadronArca',@LockMode='Exclusive',@LockOwner='Session',@LockTimeout=0; SELECT @r"))<0)throw new Exception("Ya hay una importacion de padron en curso.");
  try {
   Query(c,null,"IF OBJECT_ID('dbo.WebPadronArcaImportacion','U') IS NOT NULL DROP TABLE dbo.WebPadronArcaImportacion; CREATE TABLE dbo.WebPadronArcaImportacion(CUIT varchar(11) NOT NULL,Denominacion nvarchar(30) NOT NULL,Ganancias char(2) NULL,IVA char(2) NULL,Monotributo char(2) NULL)");
   long count=0;DateTime date=DateTime.MinValue;
   using(var archive=ZipFile.OpenRead(zip)){
    ZipArchiveEntry entry=null;foreach(var candidate in archive.Entries)if(candidate.Length>1000&&(entry==null||candidate.Length>entry.Length))entry=candidate;
    if(entry==null)throw new Exception("El ZIP no contiene el padron.");
    var match=Regex.Match(entry.FullName,@"\.(\d{8})\.");if(!match.Success||!DateTime.TryParseExact(match.Groups[1].Value,"yyyyMMdd",CultureInfo.InvariantCulture,DateTimeStyles.None,out date))throw new Exception("No se pudo identificar la fecha del padron.");
    using(var table=new DataTable())using(var bulk=new SqlBulkCopy(c,SqlBulkCopyOptions.TableLock,null)){
     foreach(var name in new[]{"CUIT","Denominacion","Ganancias","IVA","Monotributo"}){table.Columns.Add(name,typeof(string));bulk.ColumnMappings.Add(name,name);}
     bulk.DestinationTableName="dbo.WebPadronArcaImportacion";bulk.BatchSize=50000;bulk.BulkCopyTimeout=600;
     using(var reader=new StreamReader(entry.Open(),Encoding.GetEncoding(28591))){string line;while((line=reader.ReadLine())!=null){
      if(line.Length<47)continue;bool digits=true;for(int i=0;i<11;i++)if(line[i]<'0'||line[i]>'9'){digits=false;break;}if(!digits)continue;
      table.Rows.Add(line.Substring(0,11),line.Substring(11,30).Trim(),line.Substring(41,2),line.Substring(43,2),line.Substring(45,2));count++;
      if(table.Rows.Count==50000){bulk.WriteToServer(table);table.Clear();if(count%500000==0)Console.WriteLine("{0:N0} contribuyentes cargados...",count);}
     }}
     if(table.Rows.Count>0)bulk.WriteToServer(table);
    }
   }
   if(count<1000000)throw new Exception("El archivo parece incompleto. Se conserva el padron anterior.");
   Console.WriteLine("Creando indice por CUIT...");
   Query(c,null,"CREATE UNIQUE CLUSTERED INDEX IX_WebPadronArca_CUIT ON dbo.WebPadronArcaImportacion(CUIT)");
   using(var tx=c.BeginTransaction()){
    Query(c,tx,"IF OBJECT_ID('dbo.WebPadronArcaAnterior','U') IS NOT NULL DROP TABLE dbo.WebPadronArcaAnterior; IF OBJECT_ID('dbo.WebPadronArca','U') IS NOT NULL EXEC sp_rename 'dbo.WebPadronArca','WebPadronArcaAnterior'; EXEC sp_rename 'dbo.WebPadronArcaImportacion','WebPadronArca'; IF OBJECT_ID('dbo.WebPadronArcaEstado','U') IS NULL CREATE TABLE dbo.WebPadronArcaEstado(Id int NOT NULL PRIMARY KEY,FechaArchivo date NOT NULL,FechaCargaUtc datetime2 NOT NULL,Registros bigint NOT NULL); DELETE dbo.WebPadronArcaEstado; INSERT dbo.WebPadronArcaEstado VALUES(1,@p0,SYSUTCDATETIME(),@p1)",date,count);
    tx.Commit();
   }
   Query(c,null,"IF OBJECT_ID('dbo.WebPadronArcaAnterior','U') IS NOT NULL DROP TABLE dbo.WebPadronArcaAnterior");
   Console.WriteLine("Padron del {0:dd/MM/yyyy} disponible: {1:N0} registros.",date,count);
  }finally{Query(c,null,"EXEC sp_releaseapplock @Resource='Corralon.ImportarPadronArca',@LockOwner='Session'");}
 }
}
'@
Add-Type -TypeDefinition $taskCode -ReferencedAssemblies System.Data,System.Xml,System.Core,System.IO.Compression,System.IO.Compression.FileSystem
$taskApi=([Reflection.Assembly]::LoadFrom((Join-Path $taskRoot 'servidor\FacturacionCopiaApi.exe'))).GetType('FacturacionCopiaApi',$true)
$taskConnection=$taskApi.GetMethod('Connect',[Reflection.BindingFlags]'NonPublic,Static').Invoke($null,@())
try{[CorralonPadronImport]::Run($taskConnection,$taskZip)}finally{$taskConnection.Close();$taskConnection.Dispose()}
