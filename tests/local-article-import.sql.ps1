$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
$source = Get-Content -Raw -LiteralPath (Join-Path $repo 'CorralonWebServer.cs')
$source = $source.Substring(0, $source.IndexOf('internal static class Program'))
# Exercise the actual implementation against session-local copies only.
$source = $source.Replace('dbo.[Artículos]', '#TestArticles').Replace('dbo.ArtsStock', '#TestStock').Replace('dbo.Proveedores', '#TestProviders').Replace('dbo.Rubros', '#TestRubros').Replace('dbo.Sucursales', '#TestBranches')
$source += @'
internal static class ImportTests {
  static void Check(bool ok, string text) { if (!ok) throw new Exception(text); Console.WriteLine("PASS " + text); }
  static object Scalar(SqlConnection c, string sql) { using (var cmd=new SqlCommand(sql,c)) return cmd.ExecuteScalar(); }
  static void Run(SqlConnection c, string sql) { using (var cmd=new SqlCommand(sql,c)) cmd.ExecuteNonQuery(); }
  static string Version(SqlConnection c,string id,bool includeSuspended=false) {
    var m=typeof(LocalArticleImport).GetMethod("Article",System.Reflection.BindingFlags.Static|System.Reflection.BindingFlags.NonPublic);
    return (string)((Dictionary<string,object>)m.Invoke(null,new object[]{c,null,id,includeSuspended}))["version"];
  }
  static void CopySchema(SqlConnection c,string original,string temporary) {
    var definitions=new List<string>();
    using(var cmd=new SqlCommand("SELECT c.name,t.name,c.max_length,c.is_nullable,c.is_identity,d.definition FROM sys.columns c JOIN sys.types t ON c.user_type_id=t.user_type_id LEFT JOIN sys.default_constraints d ON c.default_object_id=d.object_id WHERE c.object_id=OBJECT_ID(@name) ORDER BY c.column_id",c)) {
      cmd.Parameters.AddWithValue("@name",original);
      using(var r=cmd.ExecuteReader()) while(r.Read()) {
        string type=r.GetString(1);
        if(type=="nvarchar"||type=="varchar"||type=="varbinary") type+="("+(r.GetInt16(2)<0?"MAX":(r.GetInt16(2)/(r.GetString(1)=="nvarchar"?2:1)).ToString())+")";
        definitions.Add("["+r.GetString(0)+"] "+type+(r.GetBoolean(4)?" IDENTITY(1,1)":"")+(r.GetBoolean(3)?" NULL":" NOT NULL")+(r.IsDBNull(5)?"":" DEFAULT "+r.GetString(5)));
      }
    }
    Run(c,"CREATE TABLE "+temporary+" ("+String.Join(",",definitions)+")");
  }
  public static void Main() {
    using(var c=LocalArticleImport.Connect()) {
      CopySchema(c,"dbo.Artículos","#TestArticles"); CopySchema(c,"dbo.ArtsStock","#TestStock");
      Run(c,"CREATE TABLE #TestProviders(IDProveedor int); INSERT #TestProviders VALUES(1),(2); CREATE TABLE #TestRubros(IDRubro int); INSERT #TestRubros VALUES(1),(2); CREATE TABLE #TestBranches(IDSuc int); INSERT #TestBranches VALUES(1),(2);");
      Run(c,"INSERT #TestArticles(IDArt,[Descripción],DescImpr,IDProveedor,IDArtProv,PorcGanMin,PorcGanMay,PorcGanInt,StockAct) VALUES('000001','ORIGINAL','IMPR ORIGINAL',1,'OLD',0.3,0.4,0.5,27); INSERT #TestStock(IDArt,IDSuc,StockAct) VALUES('000001',1,27)");
      var update=new LocalArticleImport.Item {mode="update",id="000001",version=Version(c,"000001"),codigo="REPLACED",descripcion="MUST NOT REPLACE",costo=100,rubro=2,iva=.105m,margen=null};
      var add=new LocalArticleImport.Item {mode="new",codigo="NEW",descripcion="new article",costo=50,rubro=1,iva=.105m,margen=30};
      var batch=new LocalArticleImport.Batch {provider=2,rows=new List<LocalArticleImport.Item>{update,add},validateOnly=true};
      LocalArticleImport.Apply(c,batch);
      Check(Convert.ToInt32(Scalar(c,"SELECT COUNT(*) FROM #TestArticles"))==1,"validation writes nothing");
      batch.validateOnly=false; LocalArticleImport.Apply(c,batch);
      Check(Convert.ToInt32(Scalar(c,"SELECT COUNT(*) FROM #TestArticles"))==2,"mixed batch creates and updates");
      Check((string)Scalar(c,"SELECT IDArt FROM #TestArticles WHERE IDArtProv='NEW'")=="000002","ID allocated from database");
      Check((string)Scalar(c,"SELECT [Descripción] FROM #TestArticles WHERE IDArt='000002'")=="NEW ARTICLE","new description saved in uppercase");
      Check((string)Scalar(c,"SELECT [Descripción] FROM #TestArticles WHERE IDArt='000001'")=="ORIGINAL","description preserved");
      Check(Convert.ToInt32(Scalar(c,"SELECT StockAct FROM #TestArticles WHERE IDArt='000001'"))==27,"article stock preserved");
      Check(Convert.ToInt32(Scalar(c,"SELECT COUNT(*) FROM #TestStock WHERE IDArt='000002'"))==2,"new stock rows for each branch");
      Check(Convert.ToDecimal(Scalar(c,"SELECT PrecioVta3 FROM #TestArticles WHERE IDArt='000001'"))==143.65m,"retail price computed with changed IVA");
      Check(Convert.ToDecimal(Scalar(c,"SELECT PrecioVta1 FROM #TestArticles WHERE IDArt='000001'"))==154.70m,"distinct existing margins preserved");
      Check(Convert.ToInt32(Scalar(c,"SELECT IDPorcIVA FROM #TestArticles WHERE IDArt='000001'"))==2,"existing IVA type updated");
      Check(Convert.ToInt32(Scalar(c,"SELECT IDPorcIVA FROM #TestArticles WHERE IDArt='000002'"))==2,"new IVA type assigned");
      Check(Convert.ToInt32(Scalar(c,"SELECT IDProveedor FROM #TestArticles WHERE IDArt='000001'"))==2,"provider updated");
      bool rejected=false; try { LocalArticleImport.Apply(c,new LocalArticleImport.Batch {provider=2,rows=new List<LocalArticleImport.Item>{update}}); } catch(InvalidOperationException) { rejected=true; }
      Check(rejected,"stale selection rejected");
      add.codigo="NEW2"; add.descripcion="NEXT";
      var duplicate=new LocalArticleImport.Item{mode="new",codigo="REPLACED",descripcion="DUP",costo=50,rubro=1,iva=.21m,margen=30};
      rejected=false; try { LocalArticleImport.Apply(c,new LocalArticleImport.Batch {provider=2,rows=new List<LocalArticleImport.Item>{add,duplicate}}); } catch(InvalidOperationException) { rejected=true; }
      Check(rejected && Convert.ToInt32(Scalar(c,"SELECT COUNT(*) FROM #TestArticles"))==2,"duplicate rejects entire batch");
      update.version=Version(c,"000001"); update.margen=60;
      LocalArticleImport.Apply(c,new LocalArticleImport.Batch {provider=2,rows=new List<LocalArticleImport.Item>{update}});
      Check(Convert.ToDecimal(Scalar(c,"SELECT PrecioVta1 FROM #TestArticles WHERE IDArt='000001'"))==176.80m,"explicit margin recalculates prices");
      Run(c,"ALTER TABLE #TestArticles ADD CONSTRAINT CK_Test_Import CHECK (IDArtProv<>'SQLFAIL')");
      duplicate.codigo="SQLFAIL"; duplicate.descripcion="DB FAILURE";
      rejected=false; try { LocalArticleImport.Apply(c,new LocalArticleImport.Batch {provider=2,rows=new List<LocalArticleImport.Item>{add,duplicate}}); } catch(SqlException) { rejected=true; }
      Check(rejected && Convert.ToInt32(Scalar(c,"SELECT COUNT(*) FROM #TestArticles"))==2,"database failure rolls back earlier insert");
      update.version=Version(c,"000001");
      Run(c,"UPDATE #TestArticles SET Suspendido=1 WHERE IDArt='000001'");
      rejected=false; try { LocalArticleImport.Apply(c,new LocalArticleImport.Batch {provider=2,rows=new List<LocalArticleImport.Item>{update}}); } catch(InvalidOperationException) { rejected=true; }
      Check(rejected,"suspended article cannot be updated from a previous selection");
      Check(Convert.ToInt32(Scalar(c,"SELECT Suspendido FROM #TestArticles WHERE IDArt='000001'"))==1,"suspended status preserved");
      var replacement=new LocalArticleImport.Item{mode="new",codigo="REPLACED",descripcion="ORIGINAL",costo=80,rubro=1,iva=.21m,margen=30};
      LocalArticleImport.Apply(c,new LocalArticleImport.Batch {provider=2,rows=new List<LocalArticleImport.Item>{replacement}});
      Check(Convert.ToInt32(Scalar(c,"SELECT COUNT(*) FROM #TestArticles WHERE IDArtProv='REPLACED' AND ISNULL(Suspendido,0)=0"))==1,"suspended duplicate code and description allow a new active article");
      Check(Convert.ToInt32(Scalar(c,"SELECT Suspendido FROM #TestArticles WHERE IDArt='000001'"))==1,"new import does not reactivate or modify suspended article");
      update.version=Version(c,"000001",true); update.reactivar=true; update.codigo="REACTIVATED";
      batch=new LocalArticleImport.Batch{provider=2,rows=new List<LocalArticleImport.Item>{update},validateOnly=true};
      LocalArticleImport.Apply(c,batch);
      Check(Convert.ToInt32(Scalar(c,"SELECT Suspendido FROM #TestArticles WHERE IDArt='000001'"))==1,"validation does not reactivate suspended selection");
      duplicate.codigo="SQLFAIL"; duplicate.descripcion="FAIL AFTER REACTIVATION";
      rejected=false; try{LocalArticleImport.Apply(c,new LocalArticleImport.Batch{provider=2,rows=new List<LocalArticleImport.Item>{update,duplicate}});}catch(SqlException){rejected=true;}
      Check(rejected && Convert.ToInt32(Scalar(c,"SELECT Suspendido FROM #TestArticles WHERE IDArt='000001'"))==1,"failed batch rolls back reactivation");
      batch.validateOnly=false; LocalArticleImport.Apply(c,batch);
      Check(Convert.ToInt32(Scalar(c,"SELECT Suspendido FROM #TestArticles WHERE IDArt='000001'"))==0,"explicit suspended selection reactivates on apply");
      Check((string)Scalar(c,"SELECT IDArtProv FROM #TestArticles WHERE IDArt='000001'")=="REACTIVATED","reactivation saves updated data in same transaction");

    }
  }
}
'@
$testSource = Join-Path $repo '.codex-staging\LocalArticleImportTests.cs'
$testExe = Join-Path $repo '.codex-staging\LocalArticleImportTests.exe'
[IO.File]::WriteAllText($testSource, $source, [Text.UTF8Encoding]::new($false))
& "$env:WINDIR\Microsoft.NET\Framework64\v4.0.30319\csc.exe" /nologo /target:exe "/out:$testExe" /reference:System.Windows.Forms.dll /reference:System.Drawing.dll /reference:System.Data.dll /reference:System.Security.dll /reference:System.Web.Extensions.dll $testSource
if ($LASTEXITCODE -ne 0) { throw 'No se pudo compilar la prueba.' }
& $testExe
if ($LASTEXITCODE -ne 0) { throw 'Fallo la prueba SQL.' }
