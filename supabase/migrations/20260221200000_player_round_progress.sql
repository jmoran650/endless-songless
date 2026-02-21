begin;

alter table public.game_room_players
  add column if not exists round_progress jsonb not null default '[]'::jsonb;

alter table public.game_room_players
  add column if not exists solved_at_ms bigint;

update public.game_room_players
set round_progress = '[]'::jsonb
where round_progress is null
   or jsonb_typeof(round_progress) is distinct from 'array';

alter table public.game_room_players
  drop constraint if exists game_room_players_round_progress_check;

alter table public.game_room_players
  add constraint game_room_players_round_progress_check
  check (
    case
      when jsonb_typeof(round_progress) = 'array'
        then jsonb_array_length(round_progress) <= 6
      else false
    end
  );

alter table public.game_room_players
  drop constraint if exists game_room_players_solved_at_ms_check;

alter table public.game_room_players
  add constraint game_room_players_solved_at_ms_check
  check (solved_at_ms is null or solved_at_ms > 0);

commit;
