-- Keep an unknown application date unknown on insert (e.g. imported applications);
-- only fill it when a lead is moved forward from 'prospect'.
create or replace function app_private.track_application()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.stage in ('accepted', 'rejected', 'withdrawn') then
    if tg_op = 'INSERT' or old.stage not in ('accepted', 'rejected', 'withdrawn') then
      new.closed_at := now();
    end if;
  else
    new.closed_at := null;
  end if;
  if tg_op = 'UPDATE' and new.applied_on is null and old.stage = 'prospect' and new.stage not in ('prospect', 'on_hold') then
    new.applied_on := (now() at time zone 'Europe/Amsterdam')::date;
  end if;
  return new;
end;
$$;
