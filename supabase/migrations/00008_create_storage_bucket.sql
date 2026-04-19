insert into storage.buckets (id, name, public, file_size_limit)
values ('content-assets', 'content-assets', false, 2147483648)
on conflict (id) do nothing;
