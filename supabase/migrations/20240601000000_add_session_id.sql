-- Add session_id column to designs table
ALTER TABLE public.designs ADD COLUMN IF NOT EXISTS session_id UUID;

-- Create index on session_id for faster lookups
CREATE INDEX IF NOT EXISTS idx_designs_session_id ON public.designs(session_id);

-- Update existing rows with a default UUID
UPDATE public.designs SET session_id = gen_random_uuid() WHERE session_id IS NULL;

-- Make session_id non-nullable after updating existing rows
ALTER TABLE public.designs ALTER COLUMN session_id SET NOT NULL; 