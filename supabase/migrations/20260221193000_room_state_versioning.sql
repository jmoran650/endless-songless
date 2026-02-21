begin;

alter table public.game_rooms
  add column if not exists state_version bigint not null default 0;

commit;
