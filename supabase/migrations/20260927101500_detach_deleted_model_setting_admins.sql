-- Deleting an auth account detaches it from the model audit pointers through
-- ON DELETE SET NULL. The prepare triggers rejected that referential update as
-- an administrator change without an administrator id, so deleting any account
-- that had ever changed a model setting or the default model rolled back.
-- Permit exactly that detach. It keeps the revision (and therefore open
-- optimistic-concurrency tokens) and appends no history row; the history
-- retains changed_by without a foreign key.
create or replace function public.prepare_model_settings_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE'
    and old.updated_by is not null
    and new.updated_by is null
    and (to_jsonb(new) - 'updated_by') is not distinct from (to_jsonb(old) - 'updated_by')
    and not exists (
      select 1
      from auth.users as account
      where account.id = old.updated_by
    )
  then
    return new;
  end if;

  if tg_op = 'UPDATE' and new.updated_by is null then
    raise exception 'model setting updates require an administrator id'
      using errcode = '23502';
  end if;

  if tg_op = 'UPDATE' and new.model_id <> old.model_id then
    raise exception 'model ids are immutable'
      using errcode = '23514';
  end if;

  new.revision := nextval('public.model_settings_revision_seq'::regclass);
  new.updated_at := statement_timestamp();
  return new;
end;
$$;

revoke all on function public.prepare_model_settings_change()
  from public, anon, authenticated;

create or replace function public.prepare_model_default_policy_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE'
    and old.updated_by is not null
    and new.updated_by is null
    and (to_jsonb(new) - 'updated_by') is not distinct from (to_jsonb(old) - 'updated_by')
    and not exists (
      select 1
      from auth.users as account
      where account.id = old.updated_by
    )
  then
    return new;
  end if;

  if tg_op = 'UPDATE' and new.updated_by is null then
    raise exception 'default model updates require an administrator id'
      using errcode = '23502';
  end if;

  new.id := true;
  new.revision := nextval('public.model_default_policy_revision_seq'::regclass);
  new.updated_at := statement_timestamp();
  return new;
end;
$$;

revoke all on function public.prepare_model_default_policy_change()
  from public, anon, authenticated;

-- The revision is the history primary key, so only a new revision may append.
-- An INSERT trigger cannot compare OLD, hence one trigger per event.
drop trigger model_settings_append_history on public.model_settings;

create trigger model_settings_append_history
after insert on public.model_settings
for each row execute function public.append_model_settings_history();

create trigger model_settings_append_update_history
after update on public.model_settings
for each row
when (new.revision is distinct from old.revision)
execute function public.append_model_settings_history();

drop trigger model_default_policy_append_history on public.model_default_policy;

create trigger model_default_policy_append_history
after insert on public.model_default_policy
for each row execute function public.append_model_default_policy_history();

create trigger model_default_policy_append_update_history
after update on public.model_default_policy
for each row
when (new.revision is distinct from old.revision)
execute function public.append_model_default_policy_history();
