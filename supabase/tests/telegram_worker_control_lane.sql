-- Run only against a disposable database with all project migrations applied.
\set ON_ERROR_STOP on
begin;
set plpgsql.check_asserts = on;
do $$
declare
  client uuid := gen_random_uuid();
  integration uuid := gen_random_uuid();
  generation_lease uuid := gen_random_uuid();
  control_lease uuid := gen_random_uuid();
  busy_id bigint;
  queued_id bigint;
  stop_id bigint;
  other_id bigint;
  claimed public.telegram_updates%rowtype;
begin
  insert into auth.users(id) values(client);
  insert into public.telegram_integrations(id,client_id,bot_user_id,bot_username,encrypted_token,webhook_secret_sha256,status)
  values(integration,client,100,'ControlTestBot','test-only',repeat('d',64),'active');
  insert into public.telegram_updates(integration_id,update_id,raw_update,telegram_chat_id,status,lease_id,lease_expires_at)
  values(integration,1,'{}',1,'processing',generation_lease,now()+interval '1 hour') returning id into busy_id;
  insert into public.telegram_updates(integration_id,update_id,raw_update,telegram_chat_id)
  values(integration,2,'{}',1) returning id into queued_id;
  insert into public.telegram_updates(integration_id,update_id,raw_update,telegram_chat_id,update_kind)
  values(integration,3,'{"message":{"text":"/stop@ControlTestBot"}}',1,'command') returning id into stop_id;
  insert into public.telegram_updates(integration_id,update_id,raw_update,telegram_chat_id)
  values(integration,4,'{}',2) returning id into other_id;

  select * into claimed from public.claim_pending_telegram_control_updates(control_lease,60,1);
  assert claimed.id = stop_id, 'control lane must claim stop despite a busy generation';
  assert claimed.lease_id = control_lease and claimed.attempt_count = 1;
  assert not exists(select 1 from public.claim_pending_telegram_control_updates(gen_random_uuid(),60,1)),
    'control lane must not claim normal messages or a leased stop twice';
  select * into claimed from public.claim_pending_telegram_updates(gen_random_uuid(),60,1);
  assert claimed.id = other_id, 'normal lane must preserve busy-chat exclusion';
  assert public.request_cancel_telegram_update_for_chat(integration,1,stop_id), 'stop must flag active generation';
  assert (select cancel_requested from public.telegram_updates where id=busy_id);
  assert (select status='pending' from public.telegram_updates where id=queued_id);
  assert not public.complete_telegram_update(stop_id,gen_random_uuid()), 'stale lease cannot complete stop';
  assert public.complete_telegram_update(stop_id,control_lease);

  -- Control commands also recover after a worker crash using a fresh lease.
  insert into public.telegram_updates(integration_id,update_id,raw_update,telegram_chat_id,update_kind,status,lease_id,lease_expires_at,attempt_count)
  values(integration,5,'{"message":{"text":"/stop"}}',1,'command','processing',gen_random_uuid(),now()-interval '1 second',1)
  returning id into stop_id;
  select * into claimed from public.claim_pending_telegram_control_updates(control_lease,60,1);
  assert claimed.id=stop_id and claimed.attempt_count=2 and claimed.lease_id=control_lease;
  assert not has_function_privilege('anon','public.claim_pending_telegram_control_updates(uuid,integer,integer)','execute');
  assert not has_function_privilege('authenticated','public.claim_telegram_updates_for_lane(uuid,integer,integer,boolean)','execute');
  assert has_function_privilege('service_role','public.claim_pending_telegram_control_updates(uuid,integer,integer)','execute');
end;
$$;
rollback;
