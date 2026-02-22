import { getSupabase, getUserId } from './supabaseClient';
import { FocusData, Task, TaskSection, WeeklyGoal, DailyHabit, Recurrence } from './types';
import type { RealtimeChannel } from '@supabase/supabase-js';

// ============================================================
// DB row types (mirrors PWA types)
// ============================================================

interface DbTask {
	id: string;
	user_id: string;
	title: string;
	completed: boolean;
	completed_at: string | null;
	section: string;
	goal_id: string | null;
	url: string | null;
	do_date: string | null;
	do_time: string | null;
	recurrence_type: string | null;
	recurrence_interval: number | null;
	recurrence_day_of_week: number | null;
	recurrence_day_of_month: number | null;
	sort_order: number;
	archived_month: string | null;
}

interface DbGoal {
	id: string;
	user_id: string;
	title: string;
	week_of: string;
	sort_order: number;
}

interface DbHabit {
	id: string;
	user_id: string;
	title: string;
	sort_order: number;
}

interface DbHabitCompletion {
	habit_id: string;
	date: string;
}

interface DbUserSettings {
	max_immediate_tasks: number;
	planning_reminder_enabled: boolean;
	planning_reminder_day: number;
	end_of_day_review_enabled: boolean;
	end_of_day_review_time: string;
	rollover_immediate_to_this_week: boolean;
	rollover_this_week_to_unscheduled: boolean;
	hide_completed_tasks: boolean;
	week_of: string | null;
	habit_reset_date: string | null;
}

// ============================================================
// Mappers: DB → Local
// ============================================================

function dbTaskToLocal(row: DbTask): Task {
	const recurrence: Recurrence | undefined =
		row.recurrence_type && row.recurrence_interval
			? {
				type: row.recurrence_type as Recurrence['type'],
				interval: row.recurrence_interval,
				dayOfWeek: row.recurrence_day_of_week ?? undefined,
				dayOfMonth: row.recurrence_day_of_month ?? undefined,
			}
			: undefined;

	return {
		id: row.id,
		title: row.title,
		completed: row.completed,
		completedAt: row.completed_at ?? undefined,
		section: row.section as TaskSection,
		goalId: row.goal_id ?? undefined,
		url: row.url ?? undefined,
		doDate: row.do_date ?? undefined,
		doTime: row.do_time ?? undefined,
		recurrence,
	};
}

function localTaskToDbFields(task: Task, userId: string): Record<string, unknown> {
	return {
		id: task.id,
		user_id: userId,
		title: task.title,
		completed: task.completed,
		completed_at: task.completedAt ?? null,
		section: task.section,
		goal_id: task.goalId ?? null,
		url: task.url ?? null,
		do_date: task.doDate ?? null,
		do_time: task.doTime ?? null,
		recurrence_type: task.recurrence?.type ?? null,
		recurrence_interval: task.recurrence?.interval ?? null,
		recurrence_day_of_week: task.recurrence?.dayOfWeek ?? null,
		recurrence_day_of_month: task.recurrence?.dayOfMonth ?? null,
		sort_order: 0,
		archived_month: null,
	};
}

// ============================================================
// Pull: Supabase → Local FocusData
// ============================================================

/**
 * Pull all data from Supabase and return as FocusData.
 * This is a full sync — replaces local data entirely.
 */
export async function pullFromRemote(): Promise<FocusData | null> {
	const supabase = getSupabase();
	const userId = getUserId();
	if (!supabase || !userId) return null;

	const today = new Date().toISOString().split('T')[0];

	const [tasksRes, goalsRes, habitsRes, completionsRes, settingsRes] = await Promise.all([
		supabase.from('tasks').select('*').eq('user_id', userId).order('sort_order'),
		supabase.from('goals').select('*').eq('user_id', userId).order('sort_order'),
		supabase.from('habits').select('*').eq('user_id', userId).order('sort_order'),
		supabase.from('habit_completions').select('*').eq('user_id', userId).eq('date', today),
		supabase.from('user_settings').select('*').eq('user_id', userId).single(),
	]);

	if (tasksRes.error) {
		console.error('Focus Sync: Failed to pull tasks', tasksRes.error);
		return null;
	}

	const allDbTasks = (tasksRes.data as DbTask[]) || [];

	// Track known remote IDs so pushToRemote only deletes tasks we've seen
	lastKnownRemoteTaskIds = new Set(allDbTasks.map(t => t.id));
	const dbGoals = (goalsRes.data as DbGoal[]) || [];
	lastKnownRemoteGoalIds = new Set(dbGoals.map(g => g.id));
	const dbHabits = (habitsRes.data as DbHabit[]) || [];
	lastKnownRemoteHabitIds = new Set(dbHabits.map(h => h.id));

	const activeTasks = allDbTasks.filter(t => !t.archived_month).map(dbTaskToLocal);
	const archivedTasks = allDbTasks.filter(t => t.archived_month).map(dbTaskToLocal);

	// Group active tasks by section
	const tasks: FocusData['tasks'] = {
		immediate: activeTasks.filter(t => t.section === 'immediate'),
		thisWeek: activeTasks.filter(t => t.section === 'thisWeek'),
		unscheduled: activeTasks.filter(t => t.section === 'unscheduled'),
	};

	// Group archived tasks by month
	const completedTasks: Record<string, Task[]> = {};
	for (const dbTask of allDbTasks.filter(t => t.archived_month)) {
		const key = dbTask.archived_month!;
		if (!completedTasks[key]) completedTasks[key] = [];
		completedTasks[key].push(dbTaskToLocal(dbTask));
	}

	// Map goals
	const goals: WeeklyGoal[] = dbGoals.map(g => ({ id: g.id, title: g.title }));

	// Map habits
	const completedHabitIds = new Set(
		((completionsRes.data as DbHabitCompletion[]) || []).map(c => c.habit_id)
	);
	const habits: DailyHabit[] = dbHabits.map(h => ({
		id: h.id,
		title: h.title,
		completedToday: completedHabitIds.has(h.id),
	}));

	// Settings
	const dbSettings = settingsRes.data as DbUserSettings | null;
	const weekOf = dbSettings?.week_of || today;
	const habitResetDate = dbSettings?.habit_reset_date || today;

	return {
		weekOf,
		goals,
		habits,
		habitResetDate,
		tasks,
		completedTasks,
	};
}

// ============================================================
// Push: Local FocusData → Supabase
// ============================================================

/**
 * Push all local FocusData to Supabase.
 * Uses upsert to handle both new and existing records.
 */
export async function pushToRemote(data: FocusData): Promise<boolean> {
	const supabase = getSupabase();
	const userId = getUserId();
	if (!supabase || !userId) return false;

	const today = new Date().toISOString().split('T')[0];

	try {
		// Collect all tasks (active + archived)
		const allTasks: Record<string, unknown>[] = [];
		let sortOrder = 0;

		for (const section of ['immediate', 'thisWeek', 'unscheduled'] as TaskSection[]) {
			for (const task of data.tasks[section]) {
				const fields = localTaskToDbFields(task, userId);
				fields.sort_order = sortOrder++;
				fields.section = section;
				allTasks.push(fields);
			}
		}

		// Add completed/archived tasks
		for (const [monthKey, tasks] of Object.entries(data.completedTasks || {})) {
			for (const task of tasks) {
				const fields = localTaskToDbFields(task, userId);
				fields.completed = true;
				fields.completed_at = task.completedAt ?? today;
				fields.archived_month = monthKey;
				fields.sort_order = sortOrder++;
				allTasks.push(fields);
			}
		}

		// Upsert all tasks
		if (allTasks.length > 0) {
			const { error } = await supabase.from('tasks').upsert(allTasks, { onConflict: 'id' });
			if (error) {
				console.error('Focus Sync: Failed to push tasks', error);
				return false;
			}
		}

		// Only delete tasks that we previously pulled from remote but are now gone locally.
		// This prevents wiping tasks added by other clients (e.g., the PWA).
		const localTaskIds = new Set(allTasks.map(t => t.id as string));
		const tasksToDelete = [...lastKnownRemoteTaskIds].filter(id => !localTaskIds.has(id));
		if (tasksToDelete.length > 0) {
			await supabase.from('tasks').delete().eq('user_id', userId).in('id', tasksToDelete);
		}
		lastKnownRemoteTaskIds = localTaskIds;

		// Upsert goals
		const goalFields = data.goals.map((g, i) => ({
			id: g.id,
			user_id: userId,
			title: g.title,
			week_of: data.weekOf,
			sort_order: i,
		}));
		if (goalFields.length > 0) {
			await supabase.from('goals').upsert(goalFields, { onConflict: 'id' });
		}
		const localGoalIds = new Set(data.goals.map(g => g.id));
		const goalsToDelete = [...lastKnownRemoteGoalIds].filter(id => !localGoalIds.has(id));
		if (goalsToDelete.length > 0) {
			await supabase.from('goals').delete().eq('user_id', userId).in('id', goalsToDelete);
		}
		lastKnownRemoteGoalIds = localGoalIds;

		// Upsert habits
		const habitFields = data.habits.map((h, i) => ({
			id: h.id,
			user_id: userId,
			title: h.title,
			sort_order: i,
		}));
		if (habitFields.length > 0) {
			await supabase.from('habits').upsert(habitFields, { onConflict: 'id' });
		}
		const localHabitIds = new Set(data.habits.map(h => h.id));
		const habitsToDelete = [...lastKnownRemoteHabitIds].filter(id => !localHabitIds.has(id));
		if (habitsToDelete.length > 0) {
			await supabase.from('habits').delete().eq('user_id', userId).in('id', habitsToDelete);
		}
		lastKnownRemoteHabitIds = localHabitIds;

		// Sync habit completions for today
		await supabase.from('habit_completions').delete().eq('user_id', userId).eq('date', today);
		const completedHabits = data.habits.filter(h => h.completedToday);
		if (completedHabits.length > 0) {
			await supabase.from('habit_completions').insert(
				completedHabits.map(h => ({ habit_id: h.id, user_id: userId, date: today }))
			);
		}

		// Update settings
		await supabase.from('user_settings').upsert({
			user_id: userId,
			week_of: data.weekOf,
			habit_reset_date: data.habitResetDate,
		}, { onConflict: 'user_id' });

		return true;
	} catch (err) {
		console.error('Focus Sync: Push failed', err);
		return false;
	}
}

// ============================================================
// Known remote ID tracking (prevents deleting tasks added by other clients)
// ============================================================

let lastKnownRemoteTaskIds: Set<string> = new Set();
let lastKnownRemoteGoalIds: Set<string> = new Set();
let lastKnownRemoteHabitIds: Set<string> = new Set();

// ============================================================
// Realtime subscription
// ============================================================

let realtimeChannel: RealtimeChannel | null = null;

/**
 * Subscribe to Realtime changes on the tasks table.
 * Calls the callback whenever a remote change is detected.
 */
export function subscribeToRealtime(onRemoteChange: () => void): void {
	const supabase = getSupabase();
	const userId = getUserId();
	if (!supabase || !userId) return;

	// Unsubscribe from any existing channel
	unsubscribeFromRealtime();

	realtimeChannel = supabase
		.channel('focus-sync')
		.on('postgres_changes', { event: '*', schema: 'public', table: 'tasks', filter: `user_id=eq.${userId}` }, () => {
			onRemoteChange();
		})
		.on('postgres_changes', { event: '*', schema: 'public', table: 'goals', filter: `user_id=eq.${userId}` }, () => {
			onRemoteChange();
		})
		.on('postgres_changes', { event: '*', schema: 'public', table: 'habits', filter: `user_id=eq.${userId}` }, () => {
			onRemoteChange();
		})
		.on('postgres_changes', { event: '*', schema: 'public', table: 'habit_completions', filter: `user_id=eq.${userId}` }, () => {
			onRemoteChange();
		})
		.subscribe();
}

/**
 * Unsubscribe from Realtime changes.
 */
export function unsubscribeFromRealtime(): void {
	if (realtimeChannel) {
		const supabase = getSupabase();
		if (supabase) {
			supabase.removeChannel(realtimeChannel);
		}
		realtimeChannel = null;
	}
}

// ============================================================
// Initial sync / ID migration
// ============================================================

/**
 * Migrate existing local tasks to use UUID-style IDs suitable for Supabase.
 * Returns true if any IDs were changed.
 */
export function migrateTaskIds(data: FocusData): boolean {
	let changed = false;

	const migrateId = (): string => {
		changed = true;
		return crypto.randomUUID();
	};

	// Migrate goals
	for (const goal of data.goals) {
		if (!isValidUUID(goal.id)) {
			goal.id = migrateId();
		}
	}

	// Migrate habits
	for (const habit of data.habits) {
		if (!isValidUUID(habit.id)) {
			habit.id = migrateId();
		}
	}

	// Migrate active tasks
	for (const section of ['immediate', 'thisWeek', 'unscheduled'] as TaskSection[]) {
		for (const task of data.tasks[section]) {
			if (!isValidUUID(task.id)) {
				task.id = migrateId();
			}
		}
	}

	// Migrate completed tasks
	for (const tasks of Object.values(data.completedTasks || {})) {
		for (const task of tasks) {
			if (!isValidUUID(task.id)) {
				task.id = migrateId();
			}
		}
	}

	return changed;
}

function isValidUUID(id: string): boolean {
	return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
}

