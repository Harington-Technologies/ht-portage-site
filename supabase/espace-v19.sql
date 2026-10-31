-- v19 : inscriptions « Alerte missions » (formulaire public du site), enregistrées dans contacts
alter table public.contacts drop constraint if exists contacts_type_check;
alter table public.contacts add constraint contacts_type_check check (type in ('contact', 'simulation', 'alerte'));
select conname, pg_get_constraintdef(oid) from pg_constraint where conrelid = 'public.contacts'::regclass and conname = 'contacts_type_check';
