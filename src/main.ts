import { Notice, Plugin, WorkspaceLeaf, TFile, normalizePath } from 'obsidian';
import {
	FocusPluginSettings,
	DEFAULT_SETTINGS,
	FOCUS_VIEW_TYPE,
	FocusData,
	TaskSection,
	Task,
	DayOfWeek,
} from './types';
import { FocusView } from './FocusView';
import { AddTaskModal } from './AddTaskModal';
import { PlanningModal } from './PlanningModal';
import { EndOfDayModal } from './EndOfDayModal';
import { FocusSettingTab } from './SettingsTab';
import { parseTaskFile, serializeTaskFile, createDefaultTaskFile } from './taskParser';

export default class FocusPlugin extends Plugin {
	settings: FocusPluginSettings;
	private hasShownPlanningPrompt = false;
	private endOfDayTimeout: ReturnType<typeof setTimeout> | null = null;
	private syncDebounceTimeout: ReturnType<typeof setTimeout> | null = null;

	async onload(): Promise<void> {
		await this.loadSettings();

		// Register the Focus view
		this.registerView(FOCUS_VIEW_TYPE, (leaf) => new FocusView(leaf, this));

		// Add ribbon icon
		this.addRibbonIcon('target', 'Open focus', () => {
			void this.activateFocusView();
		});

		// Add commands
		this.addCommand({
			id: 'open-view',
			name: 'Open view',
			callback: () => {
				void this.activateFocusView();
			},
		});

		this.addCommand({
			id: 'open-planning',
			name: 'Open planning',
			callback: () => {
				this.openPlanningModal();
			},
		});

		this.addCommand({
			id: 'quick-add-task',
			name: 'Quick add task',
			callback: () => {
				this.openAddTaskModal(true); // Default to "Add to This Week" checked
			},
		});

		this.addCommand({
			id: 'sync-vault-tasks',
			name: 'Sync tasks from vault',
			callback: () => {
				void this.syncVaultTasks();
			},
		});

		// Add settings tab
		this.addSettingTab(new FocusSettingTab(this.app, this));

		// Check if it's planning day and show reminder
		if (this.settings.planningReminderEnabled && this.isPlanningDay() && !this.hasShownPlanningPrompt) {
			this.hasShownPlanningPrompt = true;
			// Delay to let Obsidian fully load
			setTimeout(() => {
				new Notice(`It's ${this.getDayName(this.settings.planningReminderDay)}! Time for weekly planning.`, 5000);
				this.openPlanningModal();
			}, 2000);
		}

		// Schedule end of day review
		if (this.settings.endOfDayReviewEnabled) {
			this.scheduleEndOfDayReview();
		}

		// Setup auto-sync for vault tasks when files change
		this.setupAutoSync();

		// Ensure task file exists on load
		await this.ensureTaskFileExists();
	}

	onunload(): void {
		if (this.endOfDayTimeout) {
			clearTimeout(this.endOfDayTimeout);
		}
		if (this.syncDebounceTimeout) {
			clearTimeout(this.syncDebounceTimeout);
		}
	}

	/**
	 * Setup auto-sync: watch for file changes and sync tasks automatically
	 */
	private setupAutoSync(): void {
		if (this.settings.vaultSyncMode === 'off') return;

		// Listen for file modifications
		this.registerEvent(
			this.app.vault.on('modify', (file) => {
				if (!(file instanceof TFile)) return;
				if (!file.path.endsWith('.md')) return;
				// Don't sync changes to the focus task file itself
				if (file.path === normalizePath(this.settings.taskFilePath)) return;

				// Debounce the sync to avoid too many operations
				this.debouncedSync();
			})
		);

		// Listen for new files
		this.registerEvent(
			this.app.vault.on('create', (file) => {
				if (!(file instanceof TFile)) return;
				if (!file.path.endsWith('.md')) return;

				this.debouncedSync();
			})
		);
	}

	/**
	 * Debounced sync - waits 2 seconds after last change before syncing
	 */
	private debouncedSync(): void {
		if (this.settings.vaultSyncMode === 'off') return;

		if (this.syncDebounceTimeout) {
			clearTimeout(this.syncDebounceTimeout);
		}

		this.syncDebounceTimeout = setTimeout(() => {
			void this.syncVaultTasks(true); // silent mode
		}, 2000);
	}

	async loadSettings(): Promise<void> {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
	}

	private isPlanningDay(): boolean {
		return new Date().getDay() === this.settings.planningReminderDay;
	}

	private getDayName(day: DayOfWeek): string {
		const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
		return days[day];
	}

	scheduleEndOfDayReview(): void {
		if (this.endOfDayTimeout) {
			clearTimeout(this.endOfDayTimeout);
		}

		if (!this.settings.endOfDayReviewEnabled) return;

		const [hours, minutes] = this.settings.endOfDayReviewTime.split(':').map(Number);
		const now = new Date();
		const reviewTime = new Date();
		reviewTime.setHours(hours, minutes, 0, 0);

		// If the time has passed today, schedule for tomorrow
		if (reviewTime <= now) {
			reviewTime.setDate(reviewTime.getDate() + 1);
		}

		const msUntilReview = reviewTime.getTime() - now.getTime();

		this.endOfDayTimeout = setTimeout(() => {
			this.showEndOfDayReview();
			// Reschedule for next day
			this.scheduleEndOfDayReview();
		}, msUntilReview);
	}

	private showEndOfDayReview(): void {
		new Notice('Time for your end of day review!', 5000);
		const modal = new EndOfDayModal(this);
		modal.open();
	}

	async activateFocusView(): Promise<void> {
		const { workspace } = this.app;

		let leaf: WorkspaceLeaf | null = null;
		const leaves = workspace.getLeavesOfType(FOCUS_VIEW_TYPE);

		if (leaves.length > 0) {
			// View already open, focus it
			leaf = leaves[0];
		} else {
			// Open in right sidebar
			leaf = workspace.getRightLeaf(false);
			if (leaf) {
				await leaf.setViewState({
					type: FOCUS_VIEW_TYPE,
					active: true,
				});
			}
		}

		if (leaf) {
			workspace.revealLeaf(leaf);
		}
	}

	async ensureTaskFileExists(): Promise<void> {
		const filePath = normalizePath(this.settings.taskFilePath);
		const file = this.app.vault.getAbstractFileByPath(filePath);

		if (file) return; // File already exists

		try {
			// Create parent folder if needed
			const dir = filePath.substring(0, filePath.lastIndexOf('/'));
			if (dir && !this.app.vault.getAbstractFileByPath(dir)) {
				await this.app.vault.createFolder(dir);
			}
		} catch {
			// Folder may already exist, continue
		}

		try {
			const defaultContent = createDefaultTaskFile();
			await this.app.vault.create(filePath, defaultContent);
			new Notice(`Created task file: ${filePath}`);
		} catch {
			// File may already exist
		}
	}

	async loadTaskData(): Promise<FocusData> {
		const filePath = normalizePath(this.settings.taskFilePath);
		const file = this.app.vault.getAbstractFileByPath(filePath);

		if (file instanceof TFile) {
			const content = await this.app.vault.read(file);
			return parseTaskFile(content);
		}

		// File doesn't exist, return empty data
		return {
			weekOf: new Date().toISOString().split('T')[0],
			goals: [],
			tasks: {
				immediate: [],
				thisWeek: [],
				unscheduled: [],
			},
		};
	}

	async saveTaskData(data: FocusData): Promise<void> {
		const filePath = normalizePath(this.settings.taskFilePath);
		let file = this.app.vault.getAbstractFileByPath(filePath);

		const content = serializeTaskFile(data);

		if (file instanceof TFile) {
			await this.app.vault.modify(file, content);
		} else {
			// Create file if it doesn't exist
			await this.ensureTaskFileExists();
			file = this.app.vault.getAbstractFileByPath(filePath);
			if (file instanceof TFile) {
				await this.app.vault.modify(file, content);
			}
		}
	}

	/**
	 * Open the add task modal
	 * @param defaultToThisWeek - If true, the "Add to This Week" checkbox will be checked by default
	 */
	openAddTaskModal(defaultToThisWeek: boolean = false): void {
		const modal = new AddTaskModal(this, defaultToThisWeek, async (title, section) => {
			const data = await this.loadTaskData();

			// Check max immediate (though currently modal only supports thisWeek/unscheduled)
			if (section === 'immediate') {
				const activeImmediate = data.tasks.immediate.filter(t => !t.completed);
				if (activeImmediate.length >= this.settings.maxImmediateTasks) {
					new Notice(`Maximum ${this.settings.maxImmediateTasks} tasks in immediate. Move one out first.`);
					return;
				}
			}

			const newTask: Task = {
				id: Date.now().toString(36) + Math.random().toString(36).substring(2, 11),
				title,
				completed: false,
				section: section,
			};

			data.tasks[section].push(newTask);
			await this.saveTaskData(data);

			this.refreshFocusView();

			const sectionName = section === 'immediate'
				? 'immediate'
				: section === 'thisWeek'
					? 'this week'
					: 'unscheduled';
			new Notice(`Task added to ${sectionName}`);
		});
		modal.open();
	}

	openPlanningModal(): void {
		const modal = new PlanningModal(this);
		modal.open();
	}

	refreshFocusView(): void {
		const leaves = this.app.workspace.getLeavesOfType(FOCUS_VIEW_TYPE);
		for (const leaf of leaves) {
			const view = leaf.view;
			if (view instanceof FocusView) {
				view.render();
			}
		}
	}

	/**
	 * Scan the vault for tasks and sync them to the Unscheduled backlog
	 * Also syncs completion status for existing synced tasks
	 * @param silent - If true, don't show notices (used for auto-sync)
	 */
	async syncVaultTasks(silent: boolean = false): Promise<number> {
		if (this.settings.vaultSyncMode === 'off') {
			if (!silent) {
				new Notice('Vault sync is disabled. Enable it in settings.');
			}
			return 0;
		}

		const data = await this.loadTaskData();
		const taskFilePath = normalizePath(this.settings.taskFilePath);

		// Build a map of existing tasks by title for quick lookup
		const existingTasksByTitle = new Map<string, { task: Task; section: TaskSection }>();
		for (const section of ['immediate', 'thisWeek', 'unscheduled'] as TaskSection[]) {
			for (const task of data.tasks[section]) {
				existingTasksByTitle.set(task.title, { task, section });
			}
		}

		let newTasksCount = 0;
		let syncedCompletions = 0;
		const files = this.app.vault.getMarkdownFiles();

		for (const file of files) {
			// Skip the focus task file itself
			if (file.path === taskFilePath) continue;

			const content = await this.app.vault.read(file);
			const lines = content.split('\n');

			for (let i = 0; i < lines.length; i++) {
				const line = lines[i];
				// Match both completed and uncompleted tasks: - [ ] or - [x]
				const match = line.match(/^[\s]*-\s*\[([xX\s])\]\s*(.+)$/);
				if (!match) continue;

				const isCompleted = match[1].toLowerCase() === 'x';
				const taskText = match[2].trim();

				// If tag mode, check for the tag
				if (this.settings.vaultSyncMode === 'tag') {
					if (!taskText.includes(this.settings.vaultSyncTag)) continue;
				}

				// Check if this task already exists in Focus
				const existing = existingTasksByTitle.get(taskText);

				if (existing) {
					// Task exists - sync completion status from vault to Focus
					if (existing.task.sourceFile === file.path && existing.task.completed !== isCompleted) {
						existing.task.completed = isCompleted;
						existing.task.sourceLine = i + 1; // Update line number
						syncedCompletions++;
					}
				} else if (!isCompleted) {
					// New uncompleted task - add to Focus
					const newTask: Task = {
						id: Date.now().toString(36) + Math.random().toString(36).substring(2, 11) + i,
						title: taskText,
						completed: false,
						section: 'unscheduled',
						sourceFile: file.path,
						sourceLine: i + 1,
					};

					data.tasks.unscheduled.push(newTask);
					existingTasksByTitle.set(taskText, { task: newTask, section: 'unscheduled' });
					newTasksCount++;
				}
			}
		}

		if (newTasksCount > 0 || syncedCompletions > 0) {
			await this.saveTaskData(data);
			this.refreshFocusView();
		}

		if (!silent) {
			const messages: string[] = [];
			if (newTasksCount > 0) {
				messages.push(`${newTasksCount} new task${newTasksCount === 1 ? '' : 's'}`);
			}
			if (syncedCompletions > 0) {
				messages.push(`${syncedCompletions} completion${syncedCompletions === 1 ? '' : 's'} synced`);
			}
			if (messages.length > 0) {
				new Notice(`Vault sync: ${messages.join(', ')}`);
			} else {
				new Notice('Vault sync: Already up to date');
			}
		}
		return newTasksCount + syncedCompletions;
	}

	/**
	 * Sync task completion status back to the source file
	 * Called when a task with sourceFile is completed/uncompleted
	 * Uses content matching instead of line numbers for reliability
	 */
	async syncTaskCompletionToSource(task: Task): Promise<void> {
		if (!task.sourceFile) return;

		const file = this.app.vault.getAbstractFileByPath(task.sourceFile);
		if (!(file instanceof TFile)) return;

		try {
			const content = await this.app.vault.read(file);
			const lines = content.split('\n');

			// Find the task by matching its title content (more reliable than line number)
			// We need to find a line that contains the task title in a checkbox format
			const taskTitle = task.title.trim();
			let foundIndex = -1;

			for (let i = 0; i < lines.length; i++) {
				const line = lines[i];
				// Match both completed and uncompleted checkboxes
				const match = line.match(/^(\s*-\s*)\[([xX\s])\]\s*(.+)$/);
				if (match) {
					const lineTaskText = match[3].trim();
					if (lineTaskText === taskTitle) {
						foundIndex = i;
						break;
					}
				}
			}

			if (foundIndex === -1) {
				console.warn('Focus: Could not find task in source file:', task.title);
				return;
			}

			const line = lines[foundIndex];
			const originalLine = line;

			// Update the checkbox based on completion status
			if (task.completed) {
				// Change [ ] to [x]
				lines[foundIndex] = line.replace(/^(\s*-\s*)\[\s*\]/, '$1[x]');
			} else {
				// Change [x] to [ ]
				lines[foundIndex] = line.replace(/^(\s*-\s*)\[[xX]\]/, '$1[ ]');
			}

			// Only write if something changed
			if (lines[foundIndex] !== originalLine) {
				await this.app.vault.modify(file, lines.join('\n'));
				// Update the sourceLine to the current position
				task.sourceLine = foundIndex + 1;
			}
		} catch (error) {
			console.error('Focus: Failed to sync task completion to source file', error);
		}
	}

	/**
	 * Open a wiki-linked note from a task
	 */
	async openLinkedNote(link: string): Promise<void> {
		// Extract the note name from [[link]] or [[link|alias]]
		const match = link.match(/\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/);
		if (!match) return;

		const notePath = match[1];
		const file = this.app.metadataCache.getFirstLinkpathDest(notePath, '');

		if (file) {
			// File exists, open it
			await this.app.workspace.getLeaf().openFile(file);
		} else {
			// File doesn't exist, create it (Obsidian default behavior)
			const newFile = await this.app.vault.create(`${notePath}.md`, '');
			await this.app.workspace.getLeaf().openFile(newFile);
		}
	}

	/**
	 * Perform weekly rollover of tasks
	 */
	async performWeeklyRollover(): Promise<void> {
		const data = await this.loadTaskData();
		let changed = false;

		// Roll over incomplete Immediate tasks to This Week
		if (this.settings.rolloverImmediateToThisWeek) {
			const incompleteTasks = data.tasks.immediate.filter(t => !t.completed);
			for (const task of incompleteTasks) {
				task.section = 'thisWeek';
				data.tasks.thisWeek.push(task);
				changed = true;
			}
			data.tasks.immediate = data.tasks.immediate.filter(t => t.completed);
		}

		// Roll over incomplete This Week tasks to Unscheduled
		if (this.settings.rolloverThisWeekToUnscheduled) {
			const incompleteTasks = data.tasks.thisWeek.filter(t => !t.completed);
			for (const task of incompleteTasks) {
				task.section = 'unscheduled';
				data.tasks.unscheduled.push(task);
				changed = true;
			}
			data.tasks.thisWeek = data.tasks.thisWeek.filter(t => t.completed);
		}

		// Update the week
		data.weekOf = new Date().toISOString().split('T')[0];

		if (changed) {
			await this.saveTaskData(data);
			this.refreshFocusView();
			new Notice('Weekly rollover complete');
		}
	}
}
