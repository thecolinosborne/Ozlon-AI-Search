REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.protect_profile_privilege_columns() FROM PUBLIC, anon, authenticated;

REVOKE ALL ON FUNCTION public.get_user_secret(uuid, uuid, text, bytea) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.store_user_secret(uuid, uuid, text, bytea, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_user_secret(uuid, uuid, text, bytea) TO service_role;
GRANT EXECUTE ON FUNCTION public.store_user_secret(uuid, uuid, text, bytea, text) TO service_role;

CREATE OR REPLACE FUNCTION public.match_email_attachments(query_embedding extensions.vector, match_threshold double precision DEFAULT 0.5, match_count integer DEFAULT 10, filter_user_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(id uuid, filename text, sender text, subject text, received_at timestamp with time zone, summary text, extracted_text text, similarity double precision)
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'extensions', 'public'
AS $function$
BEGIN
  IF auth.uid() IS NOT NULL THEN filter_user_id := auth.uid(); END IF;
  IF filter_user_id IS NULL THEN RETURN; END IF;
  RETURN QUERY
  SELECT ea.id, ea.filename, ea.sender, ea.subject, ea.received_at, ea.summary,
         ea.extracted_text,
         (1 - (ea.embedding <=> query_embedding))::float AS similarity
  FROM public.email_attachments ea
  WHERE ea.user_id = filter_user_id
    AND ea.embedding IS NOT NULL
    AND (1 - (ea.embedding <=> query_embedding)) > match_threshold
  ORDER BY ea.embedding <=> query_embedding
  LIMIT match_count;
END;
$function$;

CREATE OR REPLACE FUNCTION public.match_knowledge(query_embedding extensions.vector, match_threshold double precision DEFAULT 0.5, match_count integer DEFAULT 10, filter_user_id uuid DEFAULT NULL::uuid, filter_domain text DEFAULT NULL::text, filter_category text DEFAULT NULL::text)
 RETURNS TABLE(id uuid, source_person text, source_material text, category text, domain text, title text, content text, tags text[], similarity double precision)
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'extensions', 'public'
AS $function$
BEGIN
  IF auth.uid() IS NOT NULL THEN filter_user_id := auth.uid(); END IF;
  IF filter_user_id IS NULL THEN RETURN; END IF;
  RETURN QUERY
  SELECT ke.id, ke.source_person, ke.source_material, ke.category, ke.domain,
         ke.title, ke.content, ke.tags,
         1 - (ke.embedding <=> query_embedding)::FLOAT AS similarity
  FROM public.knowledge_entries ke
  WHERE ke.user_id = filter_user_id
    AND 1 - (ke.embedding <=> query_embedding) > match_threshold
    AND (filter_domain IS NULL OR ke.domain = filter_domain)
    AND (filter_category IS NULL OR ke.category = filter_category)
  ORDER BY ke.embedding <=> query_embedding
  LIMIT match_count;
END;
$function$;

CREATE OR REPLACE FUNCTION public.match_reflections(query_embedding extensions.vector, match_threshold double precision DEFAULT 0.5, match_count integer DEFAULT 10, filter_user_id uuid DEFAULT NULL::uuid, filter_note_type text DEFAULT NULL::text)
 RETURNS TABLE(id uuid, note_type text, content text, importance double precision, source_ids jsonb, created_at timestamp with time zone, metadata jsonb, similarity double precision)
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'extensions', 'public'
AS $function$
BEGIN
  IF auth.uid() IS NOT NULL THEN filter_user_id := auth.uid(); END IF;
  IF filter_user_id IS NULL THEN RETURN; END IF;
  RETURN QUERY
  SELECT rn.id, rn.note_type, rn.content, rn.importance,
         rn.source_ids, rn.created_at, rn.metadata,
         (1 - (rn.embedding <=> query_embedding))::float AS similarity
  FROM public.reflection_notes rn
  WHERE rn.user_id = filter_user_id
    AND (1 - (rn.embedding <=> query_embedding)) > match_threshold
    AND (filter_note_type IS NULL OR rn.note_type = filter_note_type)
  ORDER BY rn.embedding <=> query_embedding
  LIMIT match_count;
END;
$function$;

CREATE OR REPLACE FUNCTION public.match_research_plans(query_embedding extensions.vector, match_threshold double precision DEFAULT 0.75, match_count integer DEFAULT 5, filter_user_id uuid DEFAULT NULL::uuid, max_age_hours integer DEFAULT 168)
 RETURNS TABLE(id uuid, original_question text, final_answer text, confidence numeric, gaps_detected text[], sub_queries jsonb, created_at timestamp with time zone, similarity double precision)
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'extensions', 'public'
AS $function$
BEGIN
  IF auth.uid() IS NOT NULL THEN filter_user_id := auth.uid(); END IF;
  IF filter_user_id IS NULL THEN RETURN; END IF;
  RETURN QUERY
  SELECT rp.id, rp.original_question, rp.final_answer, rp.confidence,
         rp.gaps_detected, rp.sub_queries, rp.created_at,
         (1 - (rp.original_question_embedding <=> query_embedding))::float AS similarity
  FROM public.research_plans rp
  WHERE rp.user_id = filter_user_id
    AND rp.original_question_embedding IS NOT NULL
    AND rp.status = 'completed'
    AND rp.created_at > now() - (max_age_hours || ' hours')::interval
    AND (1 - (rp.original_question_embedding <=> query_embedding)) > match_threshold
  ORDER BY rp.original_question_embedding <=> query_embedding
  LIMIT match_count;
END;
$function$;

CREATE OR REPLACE FUNCTION public.match_signal_moments(query_embedding extensions.vector, match_threshold double precision DEFAULT 0.85, match_count integer DEFAULT 5, filter_user_id uuid DEFAULT NULL::uuid, hours_back integer DEFAULT 48)
 RETURNS TABLE(id uuid, kind text, headline text, salience double precision, status text, created_at timestamp with time zone, similarity double precision)
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'extensions', 'public'
AS $function$
BEGIN
  IF auth.uid() IS NOT NULL THEN filter_user_id := auth.uid(); END IF;
  IF filter_user_id IS NULL THEN RETURN; END IF;
  RETURN QUERY
  SELECT sm.id, sm.kind, sm.headline, sm.salience, sm.status, sm.created_at,
         (1 - (sm.embedding <=> query_embedding))::float AS similarity
  FROM public.signal_moments sm
  WHERE sm.user_id = filter_user_id
    AND sm.embedding IS NOT NULL
    AND sm.created_at > now() - (hours_back || ' hours')::interval
    AND (1 - (sm.embedding <=> query_embedding)) > match_threshold
  ORDER BY sm.embedding <=> query_embedding
  LIMIT match_count;
END;
$function$;

CREATE OR REPLACE FUNCTION public.match_wisdom_memories(query_embedding extensions.vector, match_threshold double precision DEFAULT 0.5, match_count integer DEFAULT 10, filter_user_id uuid DEFAULT NULL::uuid, filter_memory_type text DEFAULT NULL::text)
 RETURNS TABLE(id uuid, memory_type text, content text, summary text, salience double precision, confidence double precision, recurrence_count integer, last_accessed_at timestamp with time zone, updated_at timestamp with time zone, metadata jsonb, similarity double precision)
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'extensions', 'public'
AS $function$
BEGIN
  IF auth.uid() IS NOT NULL THEN filter_user_id := auth.uid(); END IF;
  IF filter_user_id IS NULL THEN RETURN; END IF;
  RETURN QUERY
  SELECT wm.id, wm.memory_type, wm.content, wm.summary,
         wm.salience, wm.confidence, wm.recurrence_count,
         wm.last_accessed_at, wm.updated_at, wm.metadata,
         (1 - (wm.embedding <=> query_embedding))::float AS similarity
  FROM public.wisdom_memories wm
  WHERE wm.user_id = filter_user_id
    AND (1 - (wm.embedding <=> query_embedding)) > match_threshold
    AND (filter_memory_type IS NULL OR wm.memory_type = filter_memory_type)
  ORDER BY wm.embedding <=> query_embedding
  LIMIT match_count;
END;
$function$;

REVOKE ALL ON FUNCTION public.match_email_attachments(extensions.vector, double precision, integer, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.match_knowledge(extensions.vector, double precision, integer, uuid, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.match_reflections(extensions.vector, double precision, integer, uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.match_research_plans(extensions.vector, double precision, integer, uuid, integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.match_signal_moments(extensions.vector, double precision, integer, uuid, integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.match_wisdom_memories(extensions.vector, double precision, integer, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.match_email_attachments(extensions.vector, double precision, integer, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.match_knowledge(extensions.vector, double precision, integer, uuid, text, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.match_reflections(extensions.vector, double precision, integer, uuid, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.match_research_plans(extensions.vector, double precision, integer, uuid, integer) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.match_signal_moments(extensions.vector, double precision, integer, uuid, integer) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.match_wisdom_memories(extensions.vector, double precision, integer, uuid, text) TO authenticated, service_role;