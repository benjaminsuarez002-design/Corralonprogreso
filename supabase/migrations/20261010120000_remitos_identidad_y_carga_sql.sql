ALTER TABLE public.remitos ADD COLUMN IF NOT EXISTS proveedor_web_id text;
ALTER TABLE public.remitos ADD COLUMN IF NOT EXISTS proveedor_sql_id integer;
ALTER TABLE public.remitos ADD COLUMN IF NOT EXISTS sql_resultado jsonb;
ALTER TABLE public.items_remito ADD COLUMN IF NOT EXISTS idart text;
COMMENT ON COLUMN public.remitos.proveedor_web_id IS 'Identidad interna del proveedor web seleccionado.';
COMMENT ON COLUMN public.remitos.proveedor_sql_id IS 'Codigo ERP del proveedor al confirmar el remito.';
COMMENT ON COLUMN public.items_remito.idart IS 'IDArt del catalogo Index seleccionado; null para texto libre.';
