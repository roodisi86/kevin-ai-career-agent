-- Move RLS helper functions out of the API-exposed `public` schema so they
-- cannot be called directly via /rest/v1/rpc (Supabase advisor 0029).
-- Policies reference functions by OID, so they keep working after the move.
-- bootstrap_tenant() stays in public on purpose: the app calls it via RPC.

create schema if not exists app_private;
revoke all on schema app_private from public, anon;
grant usage on schema app_private to authenticated;

alter function public.is_tenant_member(uuid) set schema app_private;
alter function public.candidate_in_tenant(uuid, uuid) set schema app_private;
alter function public.storage_path_tenant_member(text) set schema app_private;
alter function public.bump_profile_version() set schema app_private;

-- Re-point the body that referenced the old location.
create or replace function app_private.storage_path_tenant_member(p_name text) returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_folder text := (storage.foldername(p_name))[1];
begin
  if v_folder is null
     or v_folder !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return false;
  end if;
  return app_private.is_tenant_member(v_folder::uuid);
end;
$$;

revoke all on function app_private.storage_path_tenant_member(text) from public, anon;
grant execute on function app_private.storage_path_tenant_member(text) to authenticated;
