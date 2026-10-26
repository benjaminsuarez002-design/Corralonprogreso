SET XACT_ABORT ON;
BEGIN TRANSACTION;
IF OBJECT_ID(N'dbo.CajaWebEstado',N'U') IS NULL
BEGIN
 CREATE TABLE dbo.CajaWebEstado (
  Fecha date NOT NULL, Seccion nvarchar(80) NOT NULL, Usuario nvarchar(150) NOT NULL,
  Payload nvarchar(max) NOT NULL, Version bigint NOT NULL CONSTRAINT DF_CajaWebEstado_Version DEFAULT 1,
  Actualizado datetime2 NOT NULL CONSTRAINT DF_CajaWebEstado_Actualizado DEFAULT SYSUTCDATETIME(),
  CONSTRAINT PK_CajaWebEstado PRIMARY KEY(Fecha,Seccion,Usuario)
 );
END;
IF OBJECT_ID(N'dbo.CajaWebMercadoPago',N'U') IS NULL
BEGIN
 CREATE TABLE dbo.CajaWebMercadoPago (
  Fecha date NOT NULL, ID nvarchar(100) NOT NULL, Nombre nvarchar(300) NOT NULL,
  Importe decimal(18,2) NOT NULL, Sucursal nvarchar(40) NULL,
  Payload nvarchar(max) NOT NULL, Actualizado datetime2 NOT NULL DEFAULT SYSUTCDATETIME(),
  CONSTRAINT PK_CajaWebMercadoPago PRIMARY KEY(Fecha,ID)
 );
END;
COMMIT;
