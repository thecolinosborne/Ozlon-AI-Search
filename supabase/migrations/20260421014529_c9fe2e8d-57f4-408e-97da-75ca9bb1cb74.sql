
CREATE OR REPLACE FUNCTION public.match_knowledge(query_embedding extensions.vector, match_threshold double precision DEFAULT 0.5, match_count integer DEFAULT 10, filter_user_id uuid DEFAULT NULL::uuid, filter_domain text DEFAULT NULL::text, filter_category text DEFAULT NULL::text)
 RETURNS TABLE(id uuid, source_person text, source_material text, category text, domain text, title text, content text, tags text[], similarity double precision)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'extensions', 'public'
AS $function$
BEGIN
  RETURN QUERY
  SELECT
    ke.id,
    ke.source_person,
    ke.source_material,
    ke.category,
    ke.domain,
    ke.title,
    ke.content,
    ke.tags,
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

CREATE OR REPLACE FUNCTION public.match_wisdom_memories(query_embedding extensions.vector, match_threshold double precision DEFAULT 0.5, match_count integer DEFAULT 10, filter_user_id uuid DEFAULT NULL::uuid, filter_memory_type text DEFAULT NULL::text)
 RETURNS TABLE(id uuid, memory_type text, content text, summary text, salience double precision, confidence double precision, recurrence_count integer, last_accessed_at timestamp with time zone, updated_at timestamp with time zone, metadata jsonb, similarity double precision)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'extensions', 'public'
AS $function$
BEGIN
  RETURN QUERY
  SELECT
    wm.id, wm.memory_type, wm.content, wm.summary,
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

CREATE OR REPLACE FUNCTION public.match_reflections(query_embedding extensions.vector, match_threshold double precision DEFAULT 0.5, match_count integer DEFAULT 10, filter_user_id uuid DEFAULT NULL::uuid, filter_note_type text DEFAULT NULL::text)
 RETURNS TABLE(id uuid, note_type text, content text, importance double precision, source_ids jsonb, created_at timestamp with time zone, metadata jsonb, similarity double precision)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'extensions', 'public'
AS $function$
BEGIN
  RETURN QUERY
  SELECT
    rn.id, rn.note_type, rn.content, rn.importance,
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
