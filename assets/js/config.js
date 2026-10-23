// Configuration Supabase du site HT Portage.
// Renseignez l'URL du projet et la clé publique « anon » (Supabase › Project Settings › API).
// La clé anon est faite pour être publique : la sécurité repose sur les règles RLS de supabase/schema.sql.
// Ne mettez JAMAIS la clé « service_role » ici.
window.HTP_CONFIG = {
  supabaseUrl: '',      // ex. 'https://xxxxxxxx.supabase.co'
  supabaseAnonKey: '',  // ex. 'eyJhbGciOi...'
  contactEmail: 'contact@htportage.fr'
};
