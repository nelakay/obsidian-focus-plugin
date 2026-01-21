import { FocusData, Task, TaskSection, WeeklyGoal } from './types';

/**
 * Generates a unique ID for tasks
 */
function generateId(): string {
	return Date.now().toString(36) + Math.random().toString(36).substring(2, 11);
}

/**
 * Parses a markdown task line into a Task object
 * Format: "- [ ] Task title" or "- [x] Task title"
 */
function parseTaskLine(line: string, section: TaskSection): Task | null {
	const match = line.match(/^-\s*\[([ xX])\]\s*(.+)$/);
	if (!match) return null;

	const completed = match[1].toLowerCase() === 'x';
	const title = match[2].trim();

	return {
		id: generateId(),
		title,
		completed,
		section,
	};
}

/**
 * Parses the frontmatter from the task file
 */
function parseFrontmatter(content: string): { weekOf: string; goals: WeeklyGoal[]; bodyStart: number } {
	const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);

	let weekOf = new Date().toISOString().split('T')[0];
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

	return { weekOf, goals, bodyStart };
}

/**
 * Parses the entire task file content into FocusData
 */
export function parseTaskFile(content: string): FocusData {
	const { weekOf, goals, bodyStart } = parseFrontmatter(content);
	const body = content.slice(bodyStart);

	const tasks: FocusData['tasks'] = {
		immediate: [],
		thisWeek: [],
		unscheduled: [],
	};

	let currentSection: TaskSection | null = null;

	const lines = body.split('\n');
	for (const line of lines) {
		const trimmedLine = line.trim();

		// Check for section headers
		if (trimmedLine.toLowerCase() === '## immediate') {
			currentSection = 'immediate';
			continue;
		} else if (trimmedLine.toLowerCase() === '## this week') {
			currentSection = 'thisWeek';
			continue;
		} else if (trimmedLine.toLowerCase() === '## unscheduled') {
			currentSection = 'unscheduled';
			continue;
		}

		// Parse task lines
		if (currentSection && trimmedLine.startsWith('-')) {
			const task = parseTaskLine(trimmedLine, currentSection);
			if (task) {
				tasks[currentSection].push(task);
			}
		}
	}

	return {
		weekOf,
		goals,
		tasks,
	};
}

/**
 * Serializes a Task to markdown format
 */
function serializeTask(task: Task): string {
	const checkbox = task.completed ? '[x]' : '[ ]';
	return `- ${checkbox} ${task.title}`;
}

/**
 * Serializes FocusData back to markdown format
 */
export function serializeTaskFile(data: FocusData): string {
	const lines: string[] = [];

	// Frontmatter
	lines.push('---');
	lines.push(`weekOf: ${data.weekOf}`);
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
		tasks: {
			immediate: [],
			thisWeek: [],
			unscheduled: [],
		},
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
