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

-- /stop also cancels older questions that are still queued or backing off.
do $$
declare
  client uuid := gen_random_uuid();
  integration uuid := gen_random_uuid();
  delivered_id bigint;
  backoff_id bigint;
  queued_id bigint;
  stop_id bigint;
  newer_id bigint;
  claimed public.telegram_updates%rowtype;
begin
  insert into auth.users(id) values(client);
  insert into public.telegram_integrations(id,client_id,bot_user_id,bot_username,encrypted_token,webhook_secret_sha256,status)
  values(integration,client,101,'StopQueueBot','test-only',repeat('e',64),'active');
  insert into public.telegram_updates(integration_id,update_id,raw_update,telegram_chat_id,status,attempt_count)
  values(integration,8,'{}',1,'retry',1) returning id into delivered_id;
  insert into public.telegram_deliveries(update_id,chunk_index,message_content,status)
  values(delivered_id,0,'','sent');
  insert into public.telegram_updates(integration_id,update_id,raw_update,telegram_chat_id,status,attempt_count,available_at)
  values(integration,9,'{}',1,'retry',1,now()+interval '5 minutes') returning id into backoff_id;
  insert into public.telegram_updates(integration_id,update_id,raw_update,telegram_chat_id)
  values(integration,10,'{}',1) returning id into queued_id;
  insert into public.telegram_updates(integration_id,update_id,raw_update,telegram_chat_id,update_kind)
  values(integration,11,'{"message":{"text":"/stop"}}',1,'command') returning id into stop_id;
  insert into public.telegram_updates(integration_id,update_id,raw_update,telegram_chat_id)
  values(integration,12,'{}',1) returning id into newer_id;

  select * into claimed from public.claim_pending_telegram_control_updates(gen_random_uuid(),60,1);
  assert claimed.id = stop_id, 'control lane claims /stop ahead of the older question';
  assert public.request_cancel_telegram_update_for_chat(integration,1,stop_id),
    '/stop must report the queued older question as cancelled';
  assert (select cancel_requested from public.telegram_updates where id=queued_id);
  assert (select cancel_requested and available_at <= now() from public.telegram_updates where id=backoff_id),
    'a backing-off question is cancelled and becomes claimable for cleanup';
  assert not (select cancel_requested from public.telegram_updates where id=delivered_id),
    'a partly delivered answer is left alone';
  assert not (select cancel_requested from public.telegram_updates where id=newer_id),
    'a question sent after /stop is not cancelled';
  select * into claimed
  from public.claim_pending_telegram_updates(gen_random_uuid(),60,10) as cleanup
  where cleanup.integration_id = integration;
  assert claimed.cancel_requested and claimed.id in (queued_id, backoff_id),
    'cancelled questions are claimed as cleanup despite the busy chat';
end;
$$;

-- Disconnect and bot swap settle open receipts of the queue rows they drop.
do $$
declare
  client uuid := gen_random_uuid();
  integration uuid := gen_random_uuid();
  lease uuid := gen_random_uuid();
  processing_id bigint;
  receipt_id uuid := gen_random_uuid();
begin
  insert into auth.users(id) values(client);
  insert into public.telegram_integrations(id,client_id,bot_user_id,bot_username,encrypted_token,webhook_secret_sha256,status)
  values(integration,client,102,'ReceiptBot','test-only',repeat('f',64),'active');
  insert into public.telegram_updates(integration_id,update_id,raw_update,telegram_chat_id,status,lease_id,lease_expires_at,attempt_count)
  values(integration,1,'{}',1,'processing',lease,now()+interval '1 minute',1) returning id into processing_id;
  insert into public.fred_request_ledger(id,client_id,origin,telegram_update_id,agent_key,user_event_id,assistant_event_id,request_content_sha256)
  values(receipt_id,client,'telegram',processing_id,'fred',gen_random_uuid(),gen_random_uuid(),repeat('a',64));

  assert public.cancel_all_telegram_updates_for_integration(integration) = 1;
  assert (select status = 'cancelled' and terminal_at is not null
            and error_code = 'telegram_integration_disconnected' and failure_phase = 'ingress'
          from public.fred_request_ledger where id = receipt_id),
    'disconnect must close the receipt of the cancelled queue row';

  insert into public.telegram_updates(integration_id,update_id,raw_update,telegram_chat_id,status,lease_id,lease_expires_at,attempt_count)
  values(integration,2,'{}',1,'processing',lease,now()+interval '1 minute',1) returning id into processing_id;
  receipt_id := gen_random_uuid();
  insert into public.fred_request_ledger(id,client_id,origin,telegram_update_id,agent_key,user_event_id,assistant_event_id,request_content_sha256)
  values(receipt_id,client,'telegram',processing_id,'fred',gen_random_uuid(),gen_random_uuid(),repeat('b',64));

  assert public.swap_telegram_bot(integration,client,102,103,'SwappedBot','test-only',gen_random_uuid(),repeat('c',64),repeat('d',64),now()+interval '10 minutes');
  assert (select status = 'cancelled' and terminal_at is not null and error_code = 'telegram_bot_swapped'
          from public.fred_request_ledger where id = receipt_id),
    'bot swap must close the receipt before deleting its queue row';
end;
$$;
rollback;
