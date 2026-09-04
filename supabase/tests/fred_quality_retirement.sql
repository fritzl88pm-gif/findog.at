-- Run ONLY in a disposable database with migrations through 20260830 applied.
-- psql -v ON_ERROR_STOP=1 -f supabase/tests/fred_quality_retirement.sql
-- This script applies both retirement migrations and verifies cleanup twice.
\set ON_ERROR_STOP on
set plpgsql.check_asserts = on;

create temporary table qa_fixture (payload jsonb, conversation_id uuid, user_message_id bigint, messages_before jsonb);

do $$
declare
  client uuid := gen_random_uuid();
  conversation uuid := gen_random_uuid();
  integration uuid := gen_random_uuid();
  lease uuid := gen_random_uuid();
  request uuid := gen_random_uuid();
  user_event uuid := gen_random_uuid();
  assistant_event uuid := gen_random_uuid();
  queued bigint;
  completed_queue bigint;
  user_message bigint;
  p jsonb;
begin
  insert into auth.users(id) values (client);
  insert into public.telegram_integrations(id,client_id,bot_user_id,bot_username,encrypted_token,webhook_secret_sha256,status)
  values (integration,client,100,'QaRetirementBot','test-only',repeat('d',64),'active');
  insert into public.telegram_updates(integration_id,update_id,raw_update,telegram_chat_id,status,lease_id,lease_expires_at)
  values (integration,100,'{}',100,'processing',lease,now()+interval '1 hour') returning id into queued;
  insert into public.telegram_updates(integration_id,update_id,raw_update,telegram_chat_id,status)
  values (integration,101,'{}',100,'completed') returning id into completed_queue;
  insert into public.telegram_deliveries(update_id,chunk_index,message_content,status)
  values (queued,0,'active delivery','sent'),(completed_queue,0,'retired delivery','sent');
  insert into public.fred_conversations(id,client_id,weknora_channel_id,weknora_session_id,origin,telegram_integration_id)
  values (conversation,client,'qa-test',conversation::text,'telegram',integration);
  p := jsonb_build_object('request_id',request,'client_id',client,'origin','telegram',
    'telegram_update_id',queued,'telegram_update_row_id',queued,'telegram_lease_id',lease,
    'agent_key','fred','content','Test question','user_event_id',user_event,
    'assistant_event_id',assistant_event,'conversation_id',conversation,
    'web_search_enabled',true,'pro_mode_enabled',false);
  perform public.create_fred_request_receipt(p);
  insert into public.fred_messages(conversation_id,client_id,role,content,bridge_event_id)
  values (conversation,client,'user','Test question',user_event) returning id into user_message;
  perform public.transition_fred_request_receipt(jsonb_build_object('request_id',request,
    'status','user_persisted','conversation_id',conversation,'user_message_id',user_message));
  perform public.transition_fred_request_receipt(jsonb_build_object('request_id',request,'status','generating'));
  insert into public.admin_request_history(user_id,conversation_id,request_id,content)
  values (client,conversation,request,'Test question');
  insert into public.fred_quality_review_batches(cutoff_at,candidate_count,candidate_set_sha256,status)
  values (now(),1,repeat('a',64),'awaiting_review');
  insert into public.fred_quality_review_batches(cutoff_at,candidate_count,candidate_set_sha256,status,reviewed_at)
  values (now(),0,repeat('b',64),'pending_confirmation',now());
  insert into qa_fixture values (p,conversation,user_message,
    (select jsonb_agg(to_jsonb(m) order by m.id) from public.fred_messages m));
end;
$$;

\ir ../migrations/20260904212100_retire_fred_quality_review_compat.sql
\ir ../migrations/20260904212132_remove_fred_quality_content.sql
\ir ../migrations/20260904212132_remove_fred_quality_content.sql

do $$
declare
  f qa_fixture%rowtype;
  result jsonb;
  assistant_message bigint;
  new_request uuid := gen_random_uuid();
  new_payload jsonb;
  function_call text;
  before_audit jsonb;
begin
  select * into strict f from qa_fixture;
  assert not exists(select 1 from public.fred_request_ledger where request_content is not null), 'Ledger copies remain';
  assert not exists(select 1 from public.admin_request_history where content is not null), 'Admin copies remain';
  assert (select count(*) from public.fred_quality_retirement_audit)=1, 'Cleanup audit duplicated';
  assert (select ledger_contents_removed=1 and admin_contents_removed=1 and delivery_contents_removed=1
    from public.fred_quality_retirement_audit), 'Incorrect cleanup counts';
  assert f.messages_before=(select jsonb_agg(to_jsonb(m) order by m.id) from public.fred_messages m), 'Cleanup changed user messages';
  assert exists(select 1 from public.fred_conversations where id=f.conversation_id), 'Cleanup deleted conversation';
  assert exists(select 1 from public.telegram_deliveries where message_content='active delivery'), 'Active delivery cleared';
  assert not exists(select 1 from public.telegram_deliveries where message_content='retired delivery'), 'Terminal copy retained';
  assert not exists(select 1 from public.fred_quality_review_batches where status in ('awaiting_review','pending_confirmation')), 'QA still pending';
  assert exists(select 1 from public.fred_quality_review_batches where candidate_set_sha256=repeat('b',64) and reviewed_at is not null), 'Review provenance lost';

  -- Same receipt and same content remain idempotent after cleanup.
  result := public.create_fred_request_receipt(f.payload);
  assert result->>'request_id'=f.payload->>'request_id', 'Retry created another request';
  begin
    perform public.create_fred_request_receipt(f.payload || '{"content":"Different question"}'::jsonb);
    raise exception 'Changed request content was accepted';
  exception when unique_violation then null;
  end;
  result := public.resume_fred_request_receipt(f.payload);
  assert result->>'status'='generating' and result->>'content_deleted'='false', 'QA cleanup blocked resume';
  assert result->>'web_search_enabled'='true', 'Ingress mode was lost';

  -- Bridge persistence and transition after QA removal must remain possible.
  insert into public.fred_messages(conversation_id,client_id,role,content,bridge_event_id)
  values(f.conversation_id,(f.payload->>'client_id')::uuid,'assistant','Test answer',
    (f.payload->>'assistant_event_id')::uuid) returning id into assistant_message;
  perform public.transition_fred_request_receipt(jsonb_build_object('request_id',f.payload->>'request_id',
    'status','completed','assistant_message_id',assistant_message));
  result := public.resume_fred_request_receipt(f.payload);
  assert result->>'answer'='Test answer' and result->>'content_deleted'='false', 'Persisted answer unavailable';

  -- Web receipts accept the existing interface but retain only a hash.
  new_payload := jsonb_build_object('request_id',new_request,'client_id',f.payload->>'client_id',
    'origin','web','agent_key','fred','content','New request','user_event_id',gen_random_uuid(),
    'assistant_event_id',gen_random_uuid());
  perform public.create_fred_request_receipt(new_payload);
  assert exists(select 1 from public.fred_request_ledger where id=new_request and request_content is null
    and request_content_sha256=encode(extensions.digest('New request','sha256'),'hex')), 'New receipt retained content or lost hash';
  -- Old application processes cannot recreate an admin or ledger text copy.
  insert into public.admin_request_history(user_id,conversation_id,content)
  values ((f.payload->>'client_id')::uuid,f.conversation_id,'Legacy writer');
  update public.fred_request_ledger set request_content='Legacy writer' where id=new_request;
  assert not exists(select 1 from public.admin_request_history where content is not null), 'Legacy admin write retained';
  assert not exists(select 1 from public.fred_request_ledger where request_content is not null), 'Legacy ledger write retained';

  -- All retired public entrypoints fail without changing their metadata.
  select jsonb_agg(to_jsonb(b) order by b.id) into before_audit from public.fred_quality_review_batches b;
  foreach function_call in array array[
    'select public.prepare_fred_quality_review_batch()',
    'select * from public.get_fred_quality_review_batch(gen_random_uuid())',
    'select public.mark_fred_quality_review_batch_reviewed(gen_random_uuid(),repeat(''a'',64))',
    'select public.delete_confirmed_fred_quality_batch(gen_random_uuid(),repeat(''a'',64))'
  ] loop
    begin
      execute function_call;
      raise exception 'Retired QA function succeeded';
    exception when sqlstate '55000' then
      assert sqlerrm='Fred quality review has been retired', 'Unexpected QA error';
    end;
  end loop;
  assert before_audit=(select jsonb_agg(to_jsonb(b) order by b.id) from public.fred_quality_review_batches b), 'Retired RPC changed metadata';

  -- Existing queue completion still clears operational delivery payloads.
  update public.telegram_updates set status='completed',raw_update='{}'
  where id=(f.payload->>'telegram_update_id')::bigint;
  assert not exists(select 1 from public.telegram_deliveries where message_content<>''), 'Terminal queue kept answer copy';

  -- A true user deletion remains authoritative even after QA retirement.
  perform public.delete_owned_fred_conversations((f.payload->>'client_id')::uuid,array[f.conversation_id]);
  result := public.resume_fred_request_receipt(f.payload);
  assert result->>'content_deleted'='true', 'User-deleted request can be resumed';
  assert exists(select 1 from public.fred_request_ledger where id=(f.payload->>'request_id')::uuid
    and content_deletion_reason='user_conversation_delete' and request_content_sha256 is null), 'User deletion did not override QA reason';
  assert exists(select 1 from public.fred_conversation_tombstones where conversation_id=f.conversation_id), 'Deletion fence missing';
  perform public.record_fred_webhook_event(jsonb_build_object('delivery_sha256',repeat('c',64),
    'channel_id','qa-test','session_id',f.conversation_id::text,'event_type','message_received',
    'content','Late answer','provider_created_at',now(),'raw_event','{}'::jsonb));
  assert not exists(select 1 from public.fred_webhook_events where delivery_sha256=repeat('c',64)), 'Late webhook stored deleted content';
  delete from auth.users where id=(f.payload->>'client_id')::uuid;
  assert not exists(select 1 from public.fred_request_ledger where id=new_request), 'Account cascade failed';
  assert exists(select 1 from public.fred_conversation_tombstones where conversation_id=f.conversation_id), 'Account deletion removed tombstone';
end;
$$;

select 'Fred QA retirement: all database checks passed' as result;
