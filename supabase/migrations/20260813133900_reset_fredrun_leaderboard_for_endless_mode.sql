-- Fredrun v2 changes the scoring curve, so only the previous round scores are reset.
delete from public.fredrun_scores;
