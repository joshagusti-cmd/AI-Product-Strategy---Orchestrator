-- Bring-your-own provider key, per workspace (feature-ideas.md /
-- backlog.md "Bring-your-own provider key, per workspace ... reframes
-- true multi-provider routing from a platform-wide credential Aiven
-- itself needs into a per-workspace one a customer supplies and
-- stores encrypted"). A workspace admin pastes in their own real
-- OpenAI or Google API key; it's encrypted at rest via Supabase Vault
-- (not a column this repo controls the encryption of itself), and
-- orchestrate/index.ts (see that file's own comments) actually calls
-- that real provider for real, for that workspace's own real
-- Orchestrate runs, the moment a key is configured — no more silent
-- substitution to Claude for that provider. Aiven never holds a
-- platform-wide OpenAI/Google credential; there is nothing to expose
-- across every customer, and this repo genuinely can't (and doesn't
-- try to) verify a specific real key works, since it holds none of
-- its own to test with — exactly the same trust boundary
-- ANTHROPIC_API_KEY itself already has (a real secret this build
-- never holds, only correctly calls when the operator supplies one).

-- Connection status only — never the raw key. `vault_secret_id` points
-- at the real encrypted secret; `key_suffix` (the real key's last 4
-- characters) is the one non-secret detail kept here so the UI can
-- show "Connected — ...ab12" without ever re-decrypting or
-- re-displaying the full key after it's saved, the same "shown once,
-- never again" discipline the external-agent connector's own API key
-- already has (migrations/0017), just enforced by never storing the
-- full value outside Vault at all, rather than only hashing it.
create table public.workspace_provider_keys (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  provider text not null check (provider in ('openai', 'google')),
  vault_secret_id uuid not null,
  key_suffix text not null,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (workspace_id, provider)
);

alter table public.workspace_provider_keys enable row level security;

-- Readable by any workspace member (so a non-admin can see which
-- providers are actually connected) — but this table never carries a
-- usable secret, so there's nothing sensitive to gate further. No
-- insert/update/delete policy at all: a raw key has to pass through
-- vault.create_secret()/vault.update_secret() first, which only the
-- security-definer RPCs below can reach — there is no meaningful
-- direct-write path for a client to have anyway.
create policy "select own workspace provider keys" on public.workspace_provider_keys for select
  using (private.is_workspace_member(workspace_id));

-- Admin-only RPC: the sole way a real key gets stored or rotated.
-- Encrypts it via vault.create_secret (new provider) or
-- vault.update_secret (replacing an existing one) — the raw key is
-- never written to any table this repo's own RLS/backups would expose
-- in plaintext. Never returns the key back to the caller; the admin
-- who just typed it already has it, and no other caller has any
-- legitimate reason to read it back.
create or replace function public.set_provider_key(ws uuid, p_provider text, p_api_key text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  existing_secret_id uuid;
  new_secret_id uuid;
  suffix text;
  actor_email text;
begin
  if not private.is_workspace_admin(ws) then
    raise exception 'Only a workspace admin can configure a provider key.';
  end if;
  if ws = '00000000-0000-0000-0000-000000000001' then
    raise exception 'The shared public demo workspace cannot configure provider keys.';
  end if;
  if p_provider not in ('openai', 'google') then
    raise exception 'Unknown provider: %. Must be openai or google.', p_provider;
  end if;
  if p_api_key is null or length(trim(p_api_key)) < 10 then
    raise exception 'That does not look like a real API key.';
  end if;

  suffix := right(trim(p_api_key), 4);

  select vault_secret_id into existing_secret_id
  from public.workspace_provider_keys
  where workspace_id = ws and provider = p_provider;

  if existing_secret_id is not null then
    perform vault.update_secret(existing_secret_id, trim(p_api_key));
    update public.workspace_provider_keys
    set key_suffix = suffix, created_by = auth.uid(), created_at = now()
    where workspace_id = ws and provider = p_provider;
  else
    new_secret_id := vault.create_secret(
      trim(p_api_key), null,
      'Aiven Orchestrator: ' || p_provider || ' key for workspace ' || ws::text
    );
    insert into public.workspace_provider_keys (workspace_id, provider, vault_secret_id, key_suffix, created_by)
    values (ws, p_provider, new_secret_id, suffix, auth.uid());
  end if;

  select email into actor_email from auth.users where id = auth.uid();
  insert into public.audit_log (workspace_id, actor, action, risk, detail)
  values (
    ws, coalesce(actor_email, 'Unknown admin'),
    'Configured a real ' || initcap(p_provider) || ' provider key',
    null,
    'Multi-provider routing for ' || initcap(p_provider) || ' models is now real for this workspace — that provider''s agents no longer silently fall back to Claude.'
  );
end;
$$;

revoke execute on function public.set_provider_key(uuid, text, text) from public, anon;
grant execute on function public.set_provider_key(uuid, text, text) to authenticated;

-- Admin-only RPC: removes a configured key for real, deleting the
-- underlying Vault secret outright, not just this table's pointer to
-- it. That provider's agents fall back to the safe Claude substitute
-- again, exactly as if BYOK had never been configured.
create or replace function public.remove_provider_key(ws uuid, p_provider text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  secret_id uuid;
  actor_email text;
begin
  if not private.is_workspace_admin(ws) then
    raise exception 'Only a workspace admin can remove a provider key.';
  end if;

  select vault_secret_id into secret_id
  from public.workspace_provider_keys
  where workspace_id = ws and provider = p_provider;
  if secret_id is null then
    raise exception 'No % key configured for this workspace.', p_provider;
  end if;

  delete from vault.secrets where id = secret_id;
  delete from public.workspace_provider_keys where workspace_id = ws and provider = p_provider;

  select email into actor_email from auth.users where id = auth.uid();
  insert into public.audit_log (workspace_id, actor, action, risk, detail)
  values (
    ws, coalesce(actor_email, 'Unknown admin'), 'Removed the ' || initcap(p_provider) || ' provider key', null,
    initcap(p_provider) || ' models now fall back to the safe Claude substitute for this workspace again.'
  );
end;
$$;

revoke execute on function public.remove_provider_key(uuid, text) from public, anon;
grant execute on function public.remove_provider_key(uuid, text) to authenticated;

-- Service-role-only: the one path that ever decrypts a real key back
-- out of Vault, and it's reachable only by orchestrate/index.ts's own
-- service-role credential (see serviceRoleFetch there) — never by an
-- anon or authenticated caller, even a workspace admin's own session,
-- so a real key can never be read back out through the browser once
-- saved. Returns null if the workspace hasn't configured that
-- provider, which orchestrate/index.ts treats as "fall back to
-- Claude," the same as before BYOK existed.
create or replace function public.get_provider_key_for_service_role(ws uuid, p_provider text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  secret_id uuid;
  raw_key text;
begin
  select vault_secret_id into secret_id
  from public.workspace_provider_keys
  where workspace_id = ws and provider = p_provider;
  if secret_id is null then
    return null;
  end if;

  select decrypted_secret into raw_key from vault.decrypted_secrets where id = secret_id;
  return raw_key;
end;
$$;

revoke execute on function public.get_provider_key_for_service_role(uuid, text) from public, anon, authenticated;
grant execute on function public.get_provider_key_for_service_role(uuid, text) to service_role;
