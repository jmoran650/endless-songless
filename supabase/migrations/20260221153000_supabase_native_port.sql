begin;

create extension if not exists pgcrypto;

create table if not exists public.users (
  id uuid primary key default gen_random_uuid(),
  username text not null,
  password_hash text not null,
  display_name text not null,
  friend_code text not null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint users_username_key unique (username),
  constraint users_friend_code_key unique (friend_code),
  constraint users_username_check check (char_length(trim(username)) > 0),
  constraint users_display_name_check check (char_length(trim(display_name)) > 0)
);

create table if not exists public.auth_sessions (
  id uuid primary key default gen_random_uuid(),
  token text not null unique,
  user_id uuid not null references public.users(id) on delete cascade,
  expires_at timestamptz not null,
  created_at timestamptz not null default timezone('utc', now()),
  revoked_at timestamptz
);

create table if not exists public.score_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  mode text not null default 'unlimited',
  score integer not null,
  date timestamptz not null default timezone('utc', now()),
  constraint score_entries_score_check check (score >= 0)
);

create table if not exists public.achievements (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  type text not null,
  unlocked_at timestamptz not null default timezone('utc', now()),
  constraint achievements_user_type_key unique (user_id, type)
);

create table if not exists public.game_rooms (
  code text primary key,
  host_id text,
  status text not null default 'lobby',
  round integer not null default 0,
  hint_index integer not null default 0,
  settings jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  current_song_id text,
  current_song jsonb,
  round_started_at_ms bigint,
  constraint game_rooms_code_check check (char_length(code) = 6 and code = upper(code)),
  constraint game_rooms_status_check check (status in ('lobby', 'active')),
  constraint game_rooms_round_check check (round >= 0),
  constraint game_rooms_hint_index_check check (hint_index >= 0)
);

create table if not exists public.game_room_players (
  room_code text not null references public.game_rooms(code) on delete cascade,
  player_id text not null,
  name text not null,
  score integer not null default 0,
  solved boolean not null default false,
  joined_at timestamptz not null default timezone('utc', now()),
  constraint game_room_players_pkey primary key (room_code, player_id),
  constraint game_room_players_name_check check (char_length(trim(name)) > 0),
  constraint game_room_players_score_check check (score >= 0)
);

create or replace function public.set_updated_at_timestamp()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = timezone('utc', now());
  return new;
end;
$$;

drop trigger if exists users_set_updated_at on public.users;
create trigger users_set_updated_at
before update on public.users
for each row
execute function public.set_updated_at_timestamp();

drop trigger if exists game_rooms_set_updated_at on public.game_rooms;
create trigger game_rooms_set_updated_at
before update on public.game_rooms
for each row
execute function public.set_updated_at_timestamp();

do $$
begin
  if to_regclass('public."User"') is not null then
    insert into public.users (
      id,
      username,
      password_hash,
      display_name,
      friend_code,
      created_at,
      updated_at
    )
    select
      id,
      username,
      "passwordHash",
      "displayName",
      "friendCode",
      coalesce("createdAt", timezone('utc', now())),
      coalesce("updatedAt", timezone('utc', now()))
    from public."User"
    on conflict (id) do update
    set
      username = excluded.username,
      password_hash = excluded.password_hash,
      display_name = excluded.display_name,
      friend_code = excluded.friend_code,
      created_at = excluded.created_at,
      updated_at = excluded.updated_at;
  end if;
end
$$;

do $$
begin
  if to_regclass('public."AuthSession"') is not null then
    insert into public.auth_sessions (
      id,
      token,
      user_id,
      expires_at,
      created_at
    )
    select
      id,
      token,
      "userId",
      "expiresAt",
      coalesce("createdAt", timezone('utc', now()))
    from public."AuthSession"
    on conflict (id) do update
    set
      token = excluded.token,
      user_id = excluded.user_id,
      expires_at = excluded.expires_at,
      created_at = excluded.created_at;
  end if;
end
$$;

do $$
begin
  if to_regclass('public."ScoreEntry"') is not null then
    insert into public.score_entries (
      id,
      user_id,
      mode,
      score,
      date
    )
    select
      id,
      "userId",
      mode,
      score,
      coalesce(date, timezone('utc', now()))
    from public."ScoreEntry"
    on conflict (id) do update
    set
      user_id = excluded.user_id,
      mode = excluded.mode,
      score = excluded.score,
      date = excluded.date;
  end if;
end
$$;

do $$
begin
  if to_regclass('public."Achievement"') is not null then
    insert into public.achievements (
      id,
      user_id,
      type,
      unlocked_at
    )
    select
      id,
      "userId",
      type,
      coalesce("unlockedAt", timezone('utc', now()))
    from public."Achievement"
    on conflict (id) do update
    set
      user_id = excluded.user_id,
      type = excluded.type,
      unlocked_at = excluded.unlocked_at;
  end if;
end
$$;

create index if not exists auth_sessions_active_user_expires_idx
  on public.auth_sessions (user_id, expires_at desc)
  where revoked_at is null;

create index if not exists auth_sessions_active_token_idx
  on public.auth_sessions (token)
  where revoked_at is null;

create index if not exists score_entries_leaderboard_idx
  on public.score_entries (score desc, date desc);

create index if not exists score_entries_user_date_idx
  on public.score_entries (user_id, date desc);

create index if not exists achievements_user_idx
  on public.achievements (user_id);

create index if not exists game_rooms_status_created_idx
  on public.game_rooms (status, created_at desc);

create index if not exists game_room_players_room_joined_idx
  on public.game_room_players (room_code, joined_at asc);

create or replace function public.songless_current_user_id()
returns uuid
language plpgsql
stable
as $$
declare
  raw_value text;
begin
  raw_value := nullif(current_setting('songless.user_id', true), '');
  if raw_value is null then
    return null;
  end if;

  begin
    return raw_value::uuid;
  exception
    when others then
      return null;
  end;
end;
$$;

create or replace function public.songless_backend_trusted()
returns boolean
language sql
stable
as $$
  select coalesce(current_setting('songless.backend', true), 'false') = 'true';
$$;

create or replace function public.songless_effective_user_id()
returns uuid
language sql
stable
as $$
  select coalesce((select auth.uid()), public.songless_current_user_id());
$$;

alter table public.users enable row level security;
alter table public.users force row level security;

alter table public.auth_sessions enable row level security;
alter table public.auth_sessions force row level security;

alter table public.score_entries enable row level security;
alter table public.score_entries force row level security;

alter table public.achievements enable row level security;
alter table public.achievements force row level security;

alter table public.game_rooms enable row level security;
alter table public.game_rooms force row level security;

alter table public.game_room_players enable row level security;
alter table public.game_room_players force row level security;

drop policy if exists users_select_policy on public.users;
create policy users_select_policy
on public.users
for select
using (
  (select public.songless_backend_trusted())
  or id = (select public.songless_effective_user_id())
);

drop policy if exists users_insert_policy on public.users;
create policy users_insert_policy
on public.users
for insert
with check (
  (select public.songless_backend_trusted())
  or id = (select public.songless_effective_user_id())
);

drop policy if exists users_update_policy on public.users;
create policy users_update_policy
on public.users
for update
using (
  (select public.songless_backend_trusted())
  or id = (select public.songless_effective_user_id())
)
with check (
  (select public.songless_backend_trusted())
  or id = (select public.songless_effective_user_id())
);

drop policy if exists users_delete_policy on public.users;
create policy users_delete_policy
on public.users
for delete
using ((select public.songless_backend_trusted()));

drop policy if exists auth_sessions_all_policy on public.auth_sessions;
create policy auth_sessions_all_policy
on public.auth_sessions
for all
using (
  (select public.songless_backend_trusted())
  or user_id = (select public.songless_effective_user_id())
)
with check (
  (select public.songless_backend_trusted())
  or user_id = (select public.songless_effective_user_id())
);

drop policy if exists score_entries_select_policy on public.score_entries;
create policy score_entries_select_policy
on public.score_entries
for select
using (
  (select public.songless_backend_trusted())
  or user_id = (select public.songless_effective_user_id())
);

drop policy if exists score_entries_insert_policy on public.score_entries;
create policy score_entries_insert_policy
on public.score_entries
for insert
with check (
  (select public.songless_backend_trusted())
  or user_id = (select public.songless_effective_user_id())
);

drop policy if exists score_entries_update_policy on public.score_entries;
create policy score_entries_update_policy
on public.score_entries
for update
using (
  (select public.songless_backend_trusted())
  or user_id = (select public.songless_effective_user_id())
)
with check (
  (select public.songless_backend_trusted())
  or user_id = (select public.songless_effective_user_id())
);

drop policy if exists score_entries_delete_policy on public.score_entries;
create policy score_entries_delete_policy
on public.score_entries
for delete
using (
  (select public.songless_backend_trusted())
  or user_id = (select public.songless_effective_user_id())
);

drop policy if exists achievements_all_policy on public.achievements;
create policy achievements_all_policy
on public.achievements
for all
using (
  (select public.songless_backend_trusted())
  or user_id = (select public.songless_effective_user_id())
)
with check (
  (select public.songless_backend_trusted())
  or user_id = (select public.songless_effective_user_id())
);

drop policy if exists game_rooms_backend_policy on public.game_rooms;
create policy game_rooms_backend_policy
on public.game_rooms
for all
using ((select public.songless_backend_trusted()))
with check ((select public.songless_backend_trusted()));

drop policy if exists game_room_players_backend_policy on public.game_room_players;
create policy game_room_players_backend_policy
on public.game_room_players
for all
using ((select public.songless_backend_trusted()))
with check ((select public.songless_backend_trusted()));

revoke all on public.users from anon, authenticated;
revoke all on public.auth_sessions from anon, authenticated;
revoke all on public.score_entries from anon, authenticated;
revoke all on public.achievements from anon, authenticated;
revoke all on public.game_rooms from anon, authenticated;
revoke all on public.game_room_players from anon, authenticated;

grant select, insert, update, delete on public.users to service_role;
grant select, insert, update, delete on public.auth_sessions to service_role;
grant select, insert, update, delete on public.score_entries to service_role;
grant select, insert, update, delete on public.achievements to service_role;
grant select, insert, update, delete on public.game_rooms to service_role;
grant select, insert, update, delete on public.game_room_players to service_role;

commit;
