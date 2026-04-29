-- Add 'scheduled' to the allowed status values for schedule_slots
ALTER TABLE public.schedule_slots DROP CONSTRAINT schedule_slots_status_check;
ALTER TABLE public.schedule_slots ADD CONSTRAINT schedule_slots_status_check
  CHECK (status IN ('planned', 'ready', 'scheduled', 'posted', 'failed'));
