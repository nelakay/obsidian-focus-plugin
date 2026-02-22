import { createClient, SupabaseClient, Session } from '@supabase/supabase-js';

// Public Supabase credentials — security is enforced by Row Level Security, not by hiding these
const SUPABASE_URL = 'https://mhieisdpfojkxebawtfj.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1oaWVpc2RwZm9qa3hlYmF3dGZqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzA2OTMyMTIsImV4cCI6MjA4NjI2OTIxMn0.FtCtTdpDvQ11n8RlTG4TEitb9SOeqWdySCfSQnjltas';

let client: SupabaseClient | null = null;
let currentSession: Session | null = null;

/**
 * Initialize the Supabase client with hardcoded project credentials.
 * Returns the client instance.
 */
export function initSupabase(): SupabaseClient {
	client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
		auth: {
			persistSession: false, // Obsidian plugin manages its own persistence
			autoRefreshToken: true,
		},
	});
	return client;
}

/**
 * Get the current Supabase client, or null if not initialized.
 */
export function getSupabase(): SupabaseClient | null {
	return client;
}

/**
 * Sign in with email/password and store the session.
 */
export async function signIn(email: string, password: string): Promise<{ session: Session | null; error: string | null }> {
	if (!client) return { session: null, error: 'Supabase client not initialized' };

	const { data, error } = await client.auth.signInWithPassword({ email, password });
	if (error) return { session: null, error: error.message };

	currentSession = data.session;
	return { session: data.session, error: null };
}

/**
 * Sign out and clear the session.
 */
export async function signOut(): Promise<void> {
	if (client) {
		await client.auth.signOut();
	}
	currentSession = null;
}

/**
 * Get the current user ID from the session.
 */
export function getUserId(): string | null {
	return currentSession?.user?.id ?? null;
}

/**
 * Get the current session.
 */
export function getSession(): Session | null {
	return currentSession;
}

/**
 * Set the session (used when restoring from saved credentials).
 */
export function setSession(session: Session | null): void {
	currentSession = session;
}

/**
 * Destroy the client and clean up.
 */
export function destroySupabase(): void {
	client = null;
	currentSession = null;
}
