ALTER TABLE public.remitos
  ADD COLUMN IF NOT EXISTS numero_manual boolean NOT NULL DEFAULT false;

-- Preserve the previous exclusion for existing external numbering.
UPDATE public.remitos
SET numero_manual = true
WHERE substring(nro from '([0-9]+)$')::numeric >= 10000;

COMMENT ON COLUMN public.remitos.numero_manual IS
  'A manually assigned number; excluded from automatic remito numbering.';

NOTIFY pgrst, 'reload schema';
