import { createClient } from 'npm:@supabase/supabase-js@2.49.8';
import { makeHandler } from './handler.mjs';

Deno.serve(makeHandler({ env: name => Deno.env.get(name), createClient, fetch }));
