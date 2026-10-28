-- AdPulse OOH Tracking System (AdPulse OTS) — Clean initial seed
-- Previous sample data removed.
insert into public.docs (path, collection, doc_id, data) values
  ('settings/brand', 'settings', 'brand', '{"agency": "AdPulse IMC", "email": "media@adpulse.pk", "logo": null, "phone": "+92 300 0000000", "theme": "adpulse", "web": "adpulse.pk"}'::jsonb)
on conflict (path) do update set data = excluded.data, updated_at = now();
