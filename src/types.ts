export interface Task {
	id: string;
	title: string;
	completed: boolean;
	section: TaskSection;
	goalId?: string; // Optional link to a weekly goal
	sourceFile?: string; // For vault-synced tasks, tracks original file
	sourceLine?: number; // Line number in source file
	url?: string; // Optional URL link
	doDate?: string; // ISO date: "2026-01-27" - when to be reminded
	doTime?: string; // 24h time: "14:30"
}

export type TaskSection = 'immediate' | 'thisWeek' | 'unscheduled';

export type DayOfWeek = 0 | 1 | 2 | 3 | 4 | 5 | 6; // 0 = Sunday, 6 = Saturday

export const DAY_NAMES: Record<DayOfWeek, string> = {
	0: 'Sunday',
	1: 'Monday',
	2: 'Tuesday',
	3: 'Wednesday',
	4: 'Thursday',
	5: 'Friday',
	6: 'Saturday',
};

export interface WeeklyGoal {
	id: string;
	title: string;
}

export interface FocusData {
	weekOf: string;
	goals: WeeklyGoal[];
	tasks: {
		immediate: Task[];
		thisWeek: Task[];
		unscheduled: Task[];
	};
}

export type VaultSyncMode = 'off' | 'all' | 'tag';

export interface FocusPluginSettings {
	// File settings
	taskFilePath: string;

	// Task limits
	maxImmediateTasks: number;

	// Planning reminder
	planningReminderEnabled: boolean;
	planningReminderDay: DayOfWeek;

	// End of day review
	endOfDayReviewEnabled: boolean;
	endOfDayReviewTime: string; // HH:MM format

	// Vault sync
	vaultSyncMode: VaultSyncMode;
	vaultSyncTag: string;
	vaultSyncFolders: string[]; // Empty = all folders

	// Rollover behavior
	rolloverImmediateToThisWeek: boolean;
	rolloverThisWeekToUnscheduled: boolean;

	// Display options
	hideCompletedTasks: boolean;

	// Periodic notes
	dailyNotesFolder: string;
	dailyNotesFormat: string;
	weeklyNotesFolder: string;
	weeklyNotesFormat: string;
}

export const DEFAULT_SETTINGS: FocusPluginSettings = {
	taskFilePath: 'focus-tasks.md',
	maxImmediateTasks: 5,
	planningReminderEnabled: true,
	planningReminderDay: 0, // Sunday
	endOfDayReviewEnabled: false,
	endOfDayReviewTime: '21:00',
	vaultSyncMode: 'off',
	vaultSyncTag: '#focus',
	vaultSyncFolders: [],
	rolloverImmediateToThisWeek: true,
	rolloverThisWeekToUnscheduled: true,
	hideCompletedTasks: false,
	dailyNotesFolder: '',
	dailyNotesFormat: 'YYYY-MM-DD',
	weeklyNotesFolder: '',
	weeklyNotesFormat: 'YYYY-[W]WW',
};

export const FOCUS_VIEW_TYPE = 'focus-view';
export const PLANNING_VIEW_TYPE = 'planning-view';

// Command IDs for hotkey display
export const COMMAND_IDS = {
	openFocusView: 'productivity-focus:open-view',
	openPlanningView: 'productivity-focus:open-planning',
	quickAddTask: 'productivity-focus:quick-add-task',
} as const;
