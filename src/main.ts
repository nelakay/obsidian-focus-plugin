import { Notice, Plugin, WorkspaceLeaf, TFile, TFolder, normalizePath } from 'obsidian';
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
		this.addRibbonIcon('target', 'Open Focus', () => {
			this.activateFocusView();
		});

		// Add commands
		this.addCommand({
			id: 'open-focus-view',
			name: 'Open Focus View',
			callback: () => {
				this.activateFocusView();
			},
		});

		this.addCommand({
			id: 'open-planning-view',
			name: 'Open Planning View',
			callback: () => {
				this.openPlanningModal();
			},
		});

		this.addCommand({
			id: 'quick-add-task',
			name: 'Quick Add Task',
			callback: () => {
				this.openAddTaskModal(true); // Default to "Add to This Week" checked
			},
		});

		this.addCommand({
			id: 'sync-vault-tasks',
			name: 'Sync Tasks from Vault',
			callback: () => {
				this.syncVaultTasks();
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

		this.syncDebounceTimeout = setTimeout(async () => {
			await this.syncVaultTasks(true); // silent mode
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

		if (!file) {
			// Create the directory if it doesn't exist
			const dir = filePath.substring(0, filePath.lastIndexOf('/'));
			if (dir) {
				const dirExists = this.app.vault.getAbstractFileByPath(dir);
				if (!dirExists) {
					await this.app.vault.createFolder(dir);
				}
			}

			// Create the task file with default content
			const defaultContent = createDefaultTaskFile();
			await this.app.vault.create(filePath, defaultContent);
			new Notice(`Created task file: ${filePath}`);
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
					new Notice(`Maximum ${this.settings.maxImmediateTasks} tasks in Immediate. Move one out first.`);
					return;
				}
			}

			const newTask: Task = {
				id: Date.now().toString(36) + Math.random().toString(36).substr(2, 9),
				title,
				completed: false,
				section: section,
			};

			data.tasks[section].push(newTask);
			await this.saveTaskData(data);

			this.refreshFocusView();

			const sectionName = section === 'immediate'
				? 'Immediate'
				: section === 'thisWeek'
					? 'This Week'
					: 'Unscheduled';
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
		const existingTitles = new Set([
			...data.tasks.immediate.map(t => t.title),
			...data.tasks.thisWeek.map(t => t.title),
			...data.tasks.unscheduled.map(t => t.title),
		]);

		let newTasksCount = 0;
		const files = this.app.vault.getMarkdownFiles();

		for (const file of files) {
			// Skip the focus task file itself
			if (file.path === taskFilePath) continue;

			const content = await this.app.vault.read(file);
			const lines = content.split('\n');

			for (let i = 0; i < lines.length; i++) {
				const line = lines[i];
				// Match uncompleted tasks: - [ ] task text
				const match = line.match(/^[\s]*-\s*\[\s*\]\s*(.+)$/);
				if (!match) continue;

				const taskText = match[1].trim();

				// If tag mode, check for the tag
				if (this.settings.vaultSyncMode === 'tag') {
					if (!taskText.includes(this.settings.vaultSyncTag)) continue;
				}

				// Skip if task already exists (by title)
				if (existingTitles.has(taskText)) continue;

				// Add the task
				const newTask: Task = {
					id: Date.now().toString(36) + Math.random().toString(36).substr(2, 9) + i,
					title: taskText,
					completed: false,
					section: 'unscheduled',
					sourceFile: file.path,
					sourceLine: i + 1,
				};

				data.tasks.unscheduled.push(newTask);
				existingTitles.add(taskText);
				newTasksCount++;
			}
		}

		if (newTasksCount > 0) {
			await this.saveTaskData(data);
			this.refreshFocusView();
		}

		if (!silent) {
			new Notice(`Synced ${newTasksCount} new task${newTasksCount === 1 ? '' : 's'} from vault`);
		}
		return newTasksCount;
	}

	/**
	 * Sync task completion status back to the source file
	 * Called when a task with sourceFile is completed/uncompleted
	 */
	async syncTaskCompletionToSource(task: Task): Promise<void> {
		if (!task.sourceFile || !task.sourceLine) return;

		const file = this.app.vault.getAbstractFileByPath(task.sourceFile);
		if (!(file instanceof TFile)) return;

		try {
			const content = await this.app.vault.read(file);
			const lines = content.split('\n');
			const lineIndex = task.sourceLine - 1; // sourceLine is 1-indexed

			if (lineIndex < 0 || lineIndex >= lines.length) return;

			const line = lines[lineIndex];

			// Update the checkbox based on completion status
			if (task.completed) {
				// Change [ ] to [x]
				lines[lineIndex] = line.replace(/^(\s*-\s*)\[\s*\]/, '$1[x]');
			} else {
				// Change [x] to [ ]
				lines[lineIndex] = line.replace(/^(\s*-\s*)\[[xX]\]/, '$1[ ]');
			}

			// Only write if something changed
			if (lines[lineIndex] !== line) {
				await this.app.vault.modify(file, lines.join('\n'));
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
