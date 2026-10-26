ALTER TABLE public.proveedores ADD COLUMN IF NOT EXISTS codigo_proveedor text;
UPDATE public.proveedores SET codigo_proveedor = id_proveedor WHERE codigo_proveedor IS NULL;
ALTER TABLE public.proveedores ALTER COLUMN codigo_proveedor SET NOT NULL;
ALTER TABLE public.proveedores ADD COLUMN IF NOT EXISTS id_interno text GENERATED ALWAYS AS (id_proveedor) STORED;
CREATE INDEX IF NOT EXISTS proveedores_codigo_externo_idx ON public.proveedores(codigo_proveedor);
COMMENT ON COLUMN public.proveedores.id_proveedor IS 'Clave interna inmutable de la lista. Conserva las relaciones historicas; no es el codigo ERP editable.';
COMMENT ON COLUMN public.proveedores.codigo_proveedor IS 'Codigo ERP editable y no unico: varias listas pueden compartirlo.';
CREATE OR REPLACE FUNCTION public.proveedores_identidad_guard() RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
 IF TG_OP = 'UPDATE' AND NEW.id_proveedor IS DISTINCT FROM OLD.id_proveedor THEN
  RAISE EXCEPTION 'La clave interna del proveedor no se puede cambiar. Recargue la pagina y edite el codigo del proveedor.' USING ERRCODE = '23514';
 END IF;
 IF TG_OP = 'INSERT' AND NEW.codigo_proveedor IS NULL THEN NEW.codigo_proveedor := NEW.id_proveedor; END IF;
 IF btrim(NEW.codigo_proveedor) = '' THEN RAISE EXCEPTION 'El codigo del proveedor es obligatorio' USING ERRCODE = '23514'; END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS proveedores_identidad_guard ON public.proveedores;
CREATE TRIGGER proveedores_identidad_guard BEFORE INSERT OR UPDATE ON public.proveedores FOR EACH ROW EXECUTE FUNCTION public.proveedores_identidad_guard();
ALTER TABLE public.listas_json_proveedores ADD COLUMN IF NOT EXISTS previous_provider_ids text[] NOT NULL DEFAULT '{}';
COMMENT ON COLUMN public.listas_json_proveedores.previous_provider_ids IS 'Claves historicas explicitamente retiradas por una migracion; nunca inferir equivalencia por nombre.';

