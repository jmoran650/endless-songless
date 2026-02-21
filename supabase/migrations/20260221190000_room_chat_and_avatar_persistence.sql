begin;

alter table public.users
  add column if not exists avatar_key text;

alter table public.users
  drop constraint if exists users_avatar_key_check;

alter table public.users
  add constraint users_avatar_key_check
  check (
    avatar_key is null
    or (
      char_length(avatar_key) between 1 and 32
      and avatar_key ~ '^[a-z0-9_-]+$'
    )
  );

alter table public.game_room_players
  add column if not exists avatar_key text;

alter table public.game_room_players
  drop constraint if exists game_room_players_avatar_key_check;

alter table public.game_room_players
  add constraint game_room_players_avatar_key_check
  check (
    avatar_key is null
    or (
      char_length(avatar_key) between 1 and 32
      and avatar_key ~ '^[a-z0-9_-]+$'
    )
  );

create table if not exists public.game_room_chat_messages (
  id bigint generated always as identity primary key,
  room_code text not null references public.game_rooms(code) on delete cascade,
  sender_id text not null,
  sender_name text not null,
  sender_avatar_key text,
  message text not null,
  created_at timestamptz not null default timezone('utc', now()),
  constraint game_room_chat_messages_sender_name_check check (char_length(trim(sender_name)) > 0),
  constraint game_room_chat_messages_sender_avatar_key_check check (
    sender_avatar_key is null
    or (
      char_length(sender_avatar_key) between 1 and 32
      and sender_avatar_key ~ '^[a-z0-9_-]+$'
    )
  ),
  constraint game_room_chat_messages_message_check check (
    char_length(trim(message)) > 0
    and char_length(message) <= 280
  )
);

create index if not exists game_room_chat_messages_room_created_idx
  on public.game_room_chat_messages (room_code, created_at desc, id desc);

alter table public.game_room_chat_messages enable row level security;
alter table public.game_room_chat_messages force row level security;

drop policy if exists game_room_chat_messages_backend_policy on public.game_room_chat_messages;
create policy game_room_chat_messages_backend_policy
on public.game_room_chat_messages
for all
using ((select public.songless_backend_trusted()))
with check ((select public.songless_backend_trusted()));

revoke all on public.game_room_chat_messages from anon, authenticated;
grant select, insert, update, delete on public.game_room_chat_messages to service_role;

do $$
begin
  if to_regclass('public.game_room_chat_messages_id_seq') is not null then
    execute 'grant usage, select on sequence public.game_room_chat_messages_id_seq to service_role';
  end if;
end;
$$;

commit;
