import { FocusData, Task, TaskSection, WeeklyGoal, DailyHabit, Recurrence, RecurrenceType } from './types';

/**
 * Generates a unique ID for tasks
 */
function generateId(): string {
	return Date.now().toString(36) + Math.random().toString(36).substring(2, 11);
}

/**
 * Parses a markdown task line into a Task object
 * Format: "- [ ] Task title" or "- [x] Task title"
 * Optional URL: "- [ ] Task title 🔗 https://example.com"
 * Optional do date: "- [ ] Task title 📅 2026-01-27"
 * Optional do time: "- [ ] Task title 📅 2026-01-27 ⏰ 14:30"
 * Optional completed date: "- [x] Task title ✅ 2026-01-27"
 */
function parseTaskLine(line: string, section: TaskSection): Task | null {
	const match = line.match(/^-\s*\[([ xX])\]\s*(.+)$/);
	if (!match) return null;

	const completed = match[1].toLowerCase() === 'x';
	let title = match[2].trim();
	let url: string | undefined;
	let doDate: string | undefined;
	let doTime: string | undefined;
	let completedAt: string | undefined;

	// Extract URL if present (format: 🔗 https://...)
	const urlMatch = title.match(/\s*🔗\s*(https?:\/\/\S+)\s*$/);
	if (urlMatch) {
		url = urlMatch[1];
		title = title.replace(urlMatch[0], '').trim();
	}

	// Extract completed date if present (format: ✅ YYYY-MM-DD)
	const completedMatch = title.match(/\s*✅\s*(\d{4}-\d{2}-\d{2})\s*$/);
	if (completedMatch) {
		completedAt = completedMatch[1];
		title = title.replace(completedMatch[0], '').trim();
	}

	// Extract do time if present (format: ⏰ HH:MM)
	const timeMatch = title.match(/\s*⏰\s*(\d{1,2}:\d{2})\s*$/);
	if (timeMatch) {
		doTime = timeMatch[1];
		title = title.replace(timeMatch[0], '').trim();
	}

	// Extract do date if present (format: 📅 YYYY-MM-DD)
	const dateMatch = title.match(/\s*📅\s*(\d{4}-\d{2}-\d{2})\s*$/);
	if (dateMatch) {
		doDate = dateMatch[1];
		title = title.replace(dateMatch[0], '').trim();
	}

	// Extract recurrence if present (format: 🔁 days:3, 🔁 weeks:2:1, 🔁 months:1:19)
	let recurrence: Recurrence | undefined;
	const recurrenceMatch = title.match(/\s*🔁\s*(days|weeks|months):(\d+)(?::(\d+))?\s*$/);
	if (recurrenceMatch) {
		recurrence = {
			type: recurrenceMatch[1] as RecurrenceType,
			interval: parseInt(recurrenceMatch[2]),
		};
		if (recurrence.type === 'weeks' && recurrenceMatch[3]) {
			recurrence.dayOfWeek = parseInt(recurrenceMatch[3]);
		}
		if (recurrence.type === 'months' && recurrenceMatch[3]) {
			recurrence.dayOfMonth = parseInt(recurrenceMatch[3]);
		}
		title = title.replace(recurrenceMatch[0], '').trim();
	}

	return {
		id: generateId(),
		title,
		completed,
		completedAt,
		section,
		url,
		doDate,
		doTime,
		recurrence,
	};
}

/**
 * Parses the frontmatter from the task file
 */
function parseFrontmatter(content: string): { weekOf: string; goals: WeeklyGoal[]; habitResetDate: string; bodyStart: number } {
	const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);

	const today = new Date().toISOString().split('T')[0];
	let weekOf = today;
	let habitResetDate = today;
	let goals: WeeklyGoal[] = [];
	let bodyStart = 0;

	if (frontmatterMatch) {
		const frontmatter = frontmatterMatch[1];
		bodyStart = frontmatterMatch[0].length;

		// Parse weekOf
		const weekOfMatch = frontmatter.match(/weekOf:\s*(\d{4}-\d{2}-\d{2})/);
		if (weekOfMatch) {
			weekOf = weekOfMatch[1];
		}

		// Parse habitResetDate
		const habitResetMatch = frontmatter.match(/habitResetDate:\s*(\d{4}-\d{2}-\d{2})/);
		if (habitResetMatch) {
			habitResetDate = habitResetMatch[1];
		}

		// Parse goals
		const goalsMatch = frontmatter.match(/goals:\n((?:\s+-\s+.+\n?)*)/);
		if (goalsMatch) {
			const goalLines = goalsMatch[1].split('\n').filter(line => line.trim());
			goals = goalLines.map(line => {
				const goalTitle = line.replace(/^\s*-\s*/, '').trim();
				return {
					id: generateId(),
					title: goalTitle,
				};
			});
		}
	}

	return { weekOf, goals, habitResetDate, bodyStart };
}

/**
 * Parses a month header like "### January 2026" and returns the month key "2026-01"
 */
function parseMonthHeader(line: string): string | null {
	const match = line.match(/^###\s+(\w+)\s+(\d{4})$/);
	if (!match) return null;

	const monthNames: Record<string, string> = {
		january: '01', february: '02', march: '03', april: '04',
		may: '05', june: '06', july: '07', august: '08',
		september: '09', october: '10', november: '11', december: '12',
	};

	const monthNum = monthNames[match[1].toLowerCase()];
	if (!monthNum) return null;

	return `${match[2]}-${monthNum}`;
}

/**
 * Parses a habit line into a DailyHabit object
 * Format: "- [ ] Habit title" or "- [x] Habit title"
 */
function parseHabitLine(line: string): DailyHabit | null {
	const match = line.match(/^-\s*\[([ xX])\]\s*(.+)$/);
	if (!match) return null;

	const completedToday = match[1].toLowerCase() === 'x';
	const title = match[2].trim();

	return {
		id: generateId(),
		title,
		completedToday,
	};
}

/**
 * Parses the entire task file content into FocusData
 */
export function parseTaskFile(content: string): FocusData {
	const { weekOf, goals, habitResetDate, bodyStart } = parseFrontmatter(content);
	const body = content.slice(bodyStart);

	const habits: DailyHabit[] = [];
	const tasks: FocusData['tasks'] = {
		immediate: [],
		thisWeek: [],
		unscheduled: [],
	};

	const completedTasks: Record<string, Task[]> = {};

	let currentSection: TaskSection | null = null;
	let inHabitsSection = false;
	let inCompletedSection = false;
	let currentMonth: string | null = null;

	const lines = body.split('\n');
	for (const line of lines) {
		const trimmedLine = line.trim();

		// Check for section headers
		if (trimmedLine.toLowerCase() === '## daily habits') {
			currentSection = null;
			inHabitsSection = true;
			inCompletedSection = false;
			currentMonth = null;
			continue;
		} else if (trimmedLine.toLowerCase() === '## immediate') {
			currentSection = 'immediate';
			inHabitsSection = false;
			inCompletedSection = false;
			currentMonth = null;
			continue;
		} else if (trimmedLine.toLowerCase() === '## this week') {
			currentSection = 'thisWeek';
			inHabitsSection = false;
			inCompletedSection = false;
			currentMonth = null;
			continue;
		} else if (trimmedLine.toLowerCase() === '## unscheduled') {
			currentSection = 'unscheduled';
			inHabitsSection = false;
			inCompletedSection = false;
			currentMonth = null;
			continue;
		} else if (trimmedLine.toLowerCase() === '## completed') {
			currentSection = null;
			inHabitsSection = false;
			inCompletedSection = true;
			currentMonth = null;
			continue;
		}

		// Check for month headers within completed section
		if (inCompletedSection && trimmedLine.startsWith('###')) {
			const monthKey = parseMonthHeader(trimmedLine);
			if (monthKey) {
				currentMonth = monthKey;
				if (!completedTasks[currentMonth]) {
					completedTasks[currentMonth] = [];
				}
			}
			continue;
		}

		// Parse habit or task lines
		if (trimmedLine.startsWith('-')) {
			if (inHabitsSection) {
				// Parse as habit (max 3)
				if (habits.length < 3) {
					const habit = parseHabitLine(trimmedLine);
					if (habit) {
						habits.push(habit);
					}
				}
			} else if (inCompletedSection && currentMonth) {
				// Parse as completed task (section doesn't matter for archived tasks)
				const task = parseTaskLine(trimmedLine, 'unscheduled');
				if (task) {
					task.completed = true; // Ensure it's marked completed
					completedTasks[currentMonth].push(task);
				}
			} else if (currentSection) {
				const task = parseTaskLine(trimmedLine, currentSection);
				if (task) {
					tasks[currentSection].push(task);
				}
			}
		}
	}

	return {
		weekOf,
		goals,
		habits,
		habitResetDate,
		tasks,
		completedTasks,
	};
}

/**
 * Serializes a Task to markdown format
 */
function serializeTask(task: Task, includeCompletedAt = false): string {
	const checkbox = task.completed ? '[x]' : '[ ]';
	const datePart = task.doDate ? ` 📅 ${task.doDate}` : '';
	const timePart = task.doTime ? ` ⏰ ${task.doTime}` : '';
	const recurrencePart = task.recurrence
		? ` 🔁 ${task.recurrence.type}:${task.recurrence.interval}${
			task.recurrence.type === 'weeks' && task.recurrence.dayOfWeek != null ? ':' + task.recurrence.dayOfWeek : ''
		}${
			task.recurrence.type === 'months' && task.recurrence.dayOfMonth != null ? ':' + task.recurrence.dayOfMonth : ''
		}`
		: '';
	const completedPart = includeCompletedAt && task.completedAt ? ` ✅ ${task.completedAt}` : '';
	const urlPart = task.url ? ` 🔗 ${task.url}` : '';
	return `- ${checkbox} ${task.title}${datePart}${timePart}${recurrencePart}${completedPart}${urlPart}`;
}

/**
 * Formats a month key like "2026-01" to "January 2026"
 */
function formatMonthHeader(monthKey: string): string {
	const [year, month] = monthKey.split('-');
	const monthNames = [
		'January', 'February', 'March', 'April', 'May', 'June',
		'July', 'August', 'September', 'October', 'November', 'December',
	];
	return `${monthNames[parseInt(month, 10) - 1]} ${year}`;
}

/**
 * Serializes a DailyHabit to markdown format
 */
function serializeHabit(habit: DailyHabit): string {
	const checkbox = habit.completedToday ? '[x]' : '[ ]';
	return `- ${checkbox} ${habit.title}`;
}

/**
 * Serializes FocusData back to markdown format
 */
export function serializeTaskFile(data: FocusData): string {
	const lines: string[] = [];

	// Frontmatter
	lines.push('---');
	lines.push(`weekOf: ${data.weekOf}`);
	lines.push(`habitResetDate: ${data.habitResetDate}`);
	if (data.goals.length > 0) {
		lines.push('goals:');
		for (const goal of data.goals) {
			lines.push(`  - ${goal.title}`);
		}
	} else {
		lines.push('goals: []');
	}
	lines.push('---');
	lines.push('');

	// Daily Habits section (only if there are habits)
	if (data.habits && data.habits.length > 0) {
		lines.push('## Daily Habits');
		for (const habit of data.habits) {
			lines.push(serializeHabit(habit));
		}
		lines.push('');
	}

	// Immediate section
	lines.push('## Immediate');
	for (const task of data.tasks.immediate) {
		lines.push(serializeTask(task));
	}
	lines.push('');

	// This week section
	lines.push('## This week');
	for (const task of data.tasks.thisWeek) {
		lines.push(serializeTask(task));
	}
	lines.push('');

	// Unscheduled section
	lines.push('## Unscheduled');
	for (const task of data.tasks.unscheduled) {
		lines.push(serializeTask(task));
	}
	lines.push('');

	// Completed section (archived by month)
	const completedTasks = data.completedTasks || {};
	const monthKeys = Object.keys(completedTasks).sort().reverse(); // Most recent first

	if (monthKeys.length > 0) {
		lines.push('## Completed');
		lines.push('');

		for (const monthKey of monthKeys) {
			const tasks = completedTasks[monthKey];
			if (tasks && tasks.length > 0) {
				lines.push(`### ${formatMonthHeader(monthKey)}`);
				for (const task of tasks) {
					lines.push(serializeTask(task, true));
				}
				lines.push('');
			}
		}
	}

	return lines.join('\n');
}

/**
 * Creates a default/empty task file content
 */
export function createDefaultTaskFile(): string {
	const today = new Date().toISOString().split('T')[0];
	return serializeTaskFile({
		weekOf: today,
		goals: [],
		habits: [],
		habitResetDate: today,
		tasks: {
			immediate: [],
			thisWeek: [],
			unscheduled: [],
		},
		completedTasks: {},
	});
}

/**
 * Gets the current week's Monday date in ISO format
 */
export function getCurrentWeekStart(): string {
	const now = new Date();
	const day = now.getDay();
	const diff = now.getDate() - day + (day === 0 ? -6 : 1); // Adjust for Sunday
	const monday = new Date(now.setDate(diff));
	return monday.toISOString().split('T')[0];
}

/**
 * Checks if today is Sunday (for auto-opening planning view)
 */
export function isSunday(): boolean {
	return new Date().getDay() === 0;
}

/**
 * Computes the next occurrence date for a recurring task
 */
export function computeNextRecurrenceDate(recurrence: Recurrence, fromDate?: string): string {
	const base = fromDate ? new Date(fromDate + 'T00:00:00') : new Date();

	switch (recurrence.type) {
		case 'days':
			base.setDate(base.getDate() + recurrence.interval);
			break;
		case 'weeks':
			base.setDate(base.getDate() + recurrence.interval * 7);
			break;
		case 'months': {
			base.setMonth(base.getMonth() + recurrence.interval);
			if (recurrence.dayOfMonth != null) {
				// Clamp to last day of the target month
				const lastDay = new Date(base.getFullYear(), base.getMonth() + 1, 0).getDate();
				base.setDate(Math.min(recurrence.dayOfMonth, lastDay));
			}
			break;
		}
	}

	return base.toISOString().split('T')[0];
}
