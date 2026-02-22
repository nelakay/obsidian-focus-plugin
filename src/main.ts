import { Modal, Notice, Plugin, Setting, WorkspaceLeaf, TFile, normalizePath } from 'obsidian';
import {
	FocusPluginSettings,
	DEFAULT_SETTINGS,
	FOCUS_VIEW_TYPE,
	FocusData,
	TaskSection,
	Task,
	DayOfWeek,
	Recurrence,
} from './types';
import { FocusView } from './FocusView';
import { AddTaskModal } from './AddTaskModal';
import { PlanningModal } from './PlanningModal';
import { EndOfDayModal } from './EndOfDayModal';
import { FocusSettingTab } from './SettingsTab';
import { parseTaskFile, serializeTaskFile, createDefaultTaskFile } from './taskParser';
import { initSupabase, signIn, signOut as supabaseSignOut, destroySupabase, getUserId } from './supabaseClient';
import { pullFromRemote, pushToRemote, subscribeToRealtime, unsubscribeFromRealtime, migrateTaskIds } from './supabaseSync';

export default class FocusPlugin extends Plugin {
	settings: FocusPluginSettings;
	private hasShownPlanningPrompt = false;
	private endOfDayTimeout: ReturnType<typeof setTimeout> | null = null;
	private syncDebounceTimeout: ReturnType<typeof setTimeout> | null = null;

	// Cloud sync state
	isSyncingFromRemote = false;
	private cloudSyncDebounce: ReturnType<typeof setTimeout> | null = null;


	// Overflow modal state — suppresses remote sync while user is resolving overflow
	overflowModalOpen = false;

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

		// Watch the focus task file for direct edits
		this.setupTaskFileWatcher();

		// Watch for task file being moved/renamed
		this.setupTaskFileRenameWatcher();

		// Ensure task file exists on load
		await this.ensureTaskFileExists();

		// Initialize cloud sync if enabled
		if (this.settings.cloudSyncEnabled) {
			// Delay to let Obsidian fully load
			setTimeout(() => void this.initCloudSync(), 1500);
		}

		// Auto-sort tasks by do date on load (delay to let everything initialize)
		setTimeout(() => void this.runAutoSort(), 3000);

		// Periodic auto-sort every 5 minutes
		this.registerInterval(window.setInterval(() => {
			void this.runAutoSort();
		}, 5 * 60 * 1000));
	}

	onunload(): void {
		if (this.endOfDayTimeout) {
			clearTimeout(this.endOfDayTimeout);
		}
		if (this.syncDebounceTimeout) {
			clearTimeout(this.syncDebounceTimeout);
		}
		if (this.cloudSyncDebounce) {
			clearTimeout(this.cloudSyncDebounce);
		}
		unsubscribeFromRealtime();
		destroySupabase();
	}

	// ============================================================
	// Cloud Sync
	// ============================================================

	/**
	 * Initialize cloud sync: connect to Supabase, sign in, do initial sync,
	 * and subscribe to Realtime for live updates.
	 */
	async initCloudSync(): Promise<void> {
		if (!this.settings.cloudSyncEnabled) return;

		try {
			initSupabase();

			if (this.settings.supabaseEmail && this.settings.supabasePassword) {
				const { error } = await signIn(this.settings.supabaseEmail, this.settings.supabasePassword);
				if (error) {
					console.error('Focus: Cloud sync sign-in failed:', error);
					new Notice(`Focus cloud sync: Sign-in failed — ${error}`);
					return;
				}
			} else {
				console.warn('Focus: Cloud sync enabled but no email/password configured');
				return;
			}

			// Pull remote data first (Supabase is source of truth)
			const remoteData = await pullFromRemote();
			const remoteHasTasks = remoteData && (
				Object.values(remoteData.tasks).some(arr => arr.length > 0) ||
				Object.keys(remoteData.completedTasks).length > 0
			);

			if (remoteHasTasks) {
				// Remote has data — use it, overwriting local
				this.isSyncingFromRemote = true;
				await this.saveTaskDataWithoutSync(remoteData);
				this.refreshFocusView();
				this.isSyncingFromRemote = false;
			} else {
				// Remote is empty — seed it with local data (first-time setup)
				const data = await this.loadTaskData();
				migrateTaskIds(data);
				await pushToRemote(data);
				await this.saveTaskDataWithoutSync(data); // save migrated IDs
			}

			// Subscribe to realtime changes
			subscribeToRealtime(() => {
				this.onRemoteChange();
			});

			console.log('Focus: Cloud sync initialized');
		} catch (err) {
			console.error('Focus: Cloud sync init failed', err);
		}
	}

	/**
	 * Tear down cloud sync: unsubscribe, sign out, destroy client.
	 */
	async teardownCloudSync(): Promise<void> {
		unsubscribeFromRealtime();
		await supabaseSignOut();
		destroySupabase();
	}

	/**
	 * Called when a Realtime event fires — pull fresh data from Supabase.
	 * Uses a debounce to batch rapid-fire events.
	 */
	private onRemoteChange(): void {
		if (this.isSyncingFromRemote || this.overflowModalOpen) return;

		if (this.cloudSyncDebounce) {
			clearTimeout(this.cloudSyncDebounce);
		}

		this.cloudSyncDebounce = setTimeout(async () => {
			this.isSyncingFromRemote = true;
			try {
				const remoteData = await pullFromRemote();
				if (remoteData) {
					await this.saveTaskDataWithoutSync(remoteData);
					this.refreshFocusView();
				}
			} catch (err) {
				console.error('Focus: Remote sync failed', err);
			} finally {
				this.isSyncingFromRemote = false;
			}
		}, 500);
	}

	/**
	 * Push local changes to Supabase (called after saveTaskData).
	 * Skipped when we are applying remote changes to avoid loops.
	 */
	private async pushLocalChanges(data: FocusData): Promise<void> {
		if (!this.settings.cloudSyncEnabled || this.isSyncingFromRemote || !getUserId()) return;

		try {
			await pushToRemote(data);
		} catch (err) {
			console.error('Focus: Failed to push changes to cloud', err);
		}
	}

	/**
	 * Pull any remote changes that were suppressed while the overflow modal was open.
	 */
	async catchUpRemoteSync(): Promise<void> {
		if (!this.settings.cloudSyncEnabled || !getUserId()) return;
		this.isSyncingFromRemote = true;
		try {
			const remoteData = await pullFromRemote();
			if (remoteData) {
				await this.saveTaskDataWithoutSync(remoteData);
				this.refreshFocusView();
			}
		} catch (err) {
			console.error('Focus: Catch-up sync failed', err);
		} finally {
			this.isSyncingFromRemote = false;
		}
	}

	/**
	 * Save task data to the markdown file WITHOUT triggering a cloud push.
	 * Used when applying remote changes to avoid sync loops.
	 */
	private async saveTaskDataWithoutSync(data: FocusData): Promise<void> {
		const filePath = normalizePath(this.settings.taskFilePath);
		let file = this.app.vault.getAbstractFileByPath(filePath);

		const content = serializeTaskFile(data);

		if (file instanceof TFile) {
			await this.app.vault.modify(file, content);
		} else {
			await this.ensureTaskFileExists();
			file = this.app.vault.getAbstractFileByPath(filePath);
			if (file instanceof TFile) {
				await this.app.vault.modify(file, content);
			}
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
	 * Watch the focus task file for direct edits and refresh the sidebar
	 */
	private setupTaskFileWatcher(): void {
		this.registerEvent(
			this.app.vault.on('modify', (file) => {
				if (!(file instanceof TFile)) return;
				// Only watch the focus task file
				if (file.path !== normalizePath(this.settings.taskFilePath)) return;

				// Debounce to avoid too many refreshes while typing
				if (this.syncDebounceTimeout) {
					clearTimeout(this.syncDebounceTimeout);
				}

				this.syncDebounceTimeout = setTimeout(() => {
					this.refreshFocusView();
				}, 500);
			})
		);
	}

	/**
	 * Watch for the task file being moved or renamed in the vault.
	 * When detected, prompt the user to update the setting to the new path.
	 */
	private setupTaskFileRenameWatcher(): void {
		this.registerEvent(
			this.app.vault.on('rename', (file, oldPath) => {
				if (!(file instanceof TFile)) return;
				if (normalizePath(oldPath) !== normalizePath(this.settings.taskFilePath)) return;

				const newPath = file.path;
				const fragment = document.createDocumentFragment();
				fragment.appendText('Your task file was moved. ');

				const updateLink = document.createElement('a');
				updateLink.textContent = 'Update path';
				updateLink.href = '#';
				updateLink.style.fontWeight = 'bold';
				updateLink.addEventListener('click', async (e) => {
					e.preventDefault();
					this.settings.taskFilePath = newPath;
					await this.saveSettings();
					this.refreshFocusView();
					new Notice(`Task file path updated to: ${newPath}`);
				});
				fragment.appendChild(updateLink);

				fragment.appendText(` → ${newPath}`);

				new Notice(fragment, 10000);
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

		// Log for debugging - helps users understand when review is scheduled
		console.log(`Focus: End of day review scheduled for ${reviewTime.toLocaleString()}`);

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
			void workspace.revealLeaf(leaf);
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
		const today = new Date().toISOString().split('T')[0];
		return {
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

		// Push to cloud if enabled (skipped when applying remote changes)
		void this.pushLocalChanges(data);
	}

	/**
	 * Open the add task modal
	 * @param defaultToThisWeek - If true, the "Add to This Week" checkbox will be checked by default
	 */
	openAddTaskModal(defaultToThisWeek: boolean = false): void {
		const modal = new AddTaskModal(this, defaultToThisWeek, (title, section, url, doDate, doTime, recurrence) => {
			void this.addTask(title, section, url, doDate, doTime, recurrence);
		});
		modal.open();
	}

	private async addTask(title: string, section: TaskSection, url?: string, doDate?: string, doTime?: string, recurrence?: Recurrence): Promise<void> {
		const data = await this.loadTaskData();

		// Check max immediate (though currently modal only supports thisWeek/unscheduled)
		if (section === 'immediate') {
			const activeImmediate = data.tasks.immediate.filter((t) => !t.completed);
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
			url,
			doDate,
			doTime,
			recurrence,
		};

		data.tasks[section].push(newTask);
		await this.saveTaskData(data);

		this.refreshFocusView();

		const sectionName =
			section === 'immediate' ? 'immediate' : section === 'thisWeek' ? 'this week' : 'unscheduled';
		new Notice(`Task added to ${sectionName}`);
	}

	/**
	 * Auto-sort: move today's do-date tasks from thisWeek to immediate,
	 * and sort sections by do date
	 */
	async runAutoSort(): Promise<void> {
		if (this.overflowModalOpen) return;
		const data = await this.loadTaskData();
		const today = new Date().toISOString().split('T')[0];
		const maxImmediate = this.settings.maxImmediateTasks;
		let changed = false;

		// Find thisWeek tasks with doDate === today
		const todayTasks = data.tasks.thisWeek.filter(t => t.doDate === today && !t.completed);
		const overflowTasks: Task[] = [];

		for (const task of todayTasks) {
			const activeImmediate = data.tasks.immediate.filter(t => !t.completed);
			if (activeImmediate.length < maxImmediate) {
				// Move to immediate
				data.tasks.thisWeek = data.tasks.thisWeek.filter(t => t.id !== task.id);
				task.section = 'immediate';
				data.tasks.immediate.unshift(task);
				changed = true;
			} else {
				overflowTasks.push(task);
			}
		}

		// Sort sections: do-date tasks first (earliest first), then non-do-date
		for (const section of ['immediate', 'thisWeek', 'unscheduled'] as TaskSection[]) {
			data.tasks[section].sort((a, b) => {
				if (a.completed !== b.completed) return a.completed ? 1 : -1;
				if (a.doDate && !b.doDate) return -1;
				if (!a.doDate && b.doDate) return 1;
				if (a.doDate && b.doDate) return a.doDate.localeCompare(b.doDate);
				return 0;
			});
			changed = true;
		}

		if (changed) {
			await this.saveTaskData(data);
			this.refreshFocusView();
		}

		// Show overflow modal if needed
		if (overflowTasks.length > 0) {
			const modal = new AutoSortOverflowModal(this, data, overflowTasks);
			modal.open();
		}
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
				void view.render();
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
				new Notice('Vault sync: already up to date');
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
	 * Open a file, reusing an existing tab if the file is already open.
	 * Prevents duplicate tabs from being opened.
	 */
	async openFileWithoutDuplicate(file: TFile): Promise<void> {
		// Check if the file is already open in any leaf
		const existingLeaf = this.app.workspace.getLeavesOfType('markdown')
			.find(leaf => (leaf.view as any)?.file?.path === file.path);

		if (existingLeaf) {
			this.app.workspace.setActiveLeaf(existingLeaf, { focus: true });
		} else {
			await this.app.workspace.getLeaf(false).openFile(file);
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
			await this.openFileWithoutDuplicate(file);
		} else {
			// File doesn't exist, create it (Obsidian default behavior)
			const newFile = await this.app.vault.create(`${notePath}.md`, '');
			await this.openFileWithoutDuplicate(newFile);
		}
	}

	/**
	 * Format a date according to a format string (e.g., YYYY-MM-DD, YYYY-[W]WW)
	 * Brackets [...] are used to escape literal characters (like moment.js)
	 */
	private formatDate(date: Date, format: string): string {
		const year = date.getFullYear();
		const month = (date.getMonth() + 1).toString().padStart(2, '0');
		const day = date.getDate().toString().padStart(2, '0');

		// Calculate ISO week number
		const tempDate = new Date(date.getTime());
		tempDate.setHours(0, 0, 0, 0);
		tempDate.setDate(tempDate.getDate() + 3 - ((tempDate.getDay() + 6) % 7));
		const week1 = new Date(tempDate.getFullYear(), 0, 4);
		const weekNumber = (1 + Math.round(((tempDate.getTime() - week1.getTime()) / 86400000 - 3 + ((week1.getDay() + 6) % 7)) / 7))
			.toString()
			.padStart(2, '0');

		// Extract and preserve bracketed literals (e.g., [W] -> W)
		const literals: string[] = [];
		let result = format.replace(/\[([^\]]+)\]/g, (_, content) => {
			literals.push(content);
			return `\x00${literals.length - 1}\x00`;
		});

		// Do replacements
		result = result
			.replace('YYYY', year.toString())
			.replace('MM', month)
			.replace('DD', day)
			.replace('WW', weekNumber);

		// Restore literals
		result = result.replace(/\x00(\d+)\x00/g, (_, index) => literals[parseInt(index)]);

		return result;
	}

	/**
	 * Open or create today's daily note
	 */
	async openOrCreateDailyNote(): Promise<void> {
		const today = new Date();
		const filename = this.formatDate(today, this.settings.dailyNotesFormat);
		const folder = this.settings.dailyNotesFolder.replace(/\/$/, ''); // Remove trailing slash
		const filePath = folder ? `${folder}/${filename}.md` : `${filename}.md`;

		let file = this.app.vault.getAbstractFileByPath(filePath);

		if (!file) {
			// Create the folder if it doesn't exist
			if (folder) {
				const folderExists = this.app.vault.getAbstractFileByPath(folder);
				if (!folderExists) {
					await this.app.vault.createFolder(folder);
				}
			}
			// Get content from template or use default
			let content = `# ${filename}\n\n`;
			if (this.settings.dailyNotesTemplate) {
				const templateContent = await this.getTemplateContent(this.settings.dailyNotesTemplate);
				if (templateContent !== null) {
					content = templateContent;
				}
			}
			// Create the file
			file = await this.app.vault.create(filePath, content);
			new Notice(`Created daily note: ${filename}`);
		}

		if (file instanceof TFile) {
			await this.openFileWithoutDuplicate(file);
		}
	}

	/**
	 * Open or create this week's weekly note
	 */
	async openOrCreateWeeklyNote(): Promise<void> {
		const today = new Date();
		const filename = this.formatDate(today, this.settings.weeklyNotesFormat);
		const folder = this.settings.weeklyNotesFolder.replace(/\/$/, ''); // Remove trailing slash
		const filePath = folder ? `${folder}/${filename}.md` : `${filename}.md`;

		let file = this.app.vault.getAbstractFileByPath(filePath);

		if (!file) {
			// Create the folder if it doesn't exist
			if (folder) {
				const folderExists = this.app.vault.getAbstractFileByPath(folder);
				if (!folderExists) {
					await this.app.vault.createFolder(folder);
				}
			}
			// Get content from template or use default
			let content = `# ${filename}\n\n`;
			if (this.settings.weeklyNotesTemplate) {
				const templateContent = await this.getTemplateContent(this.settings.weeklyNotesTemplate);
				if (templateContent !== null) {
					content = templateContent;
				}
			}
			// Create the file
			file = await this.app.vault.create(filePath, content);
			new Notice(`Created weekly note: ${filename}`);
		}

		if (file instanceof TFile) {
			await this.openFileWithoutDuplicate(file);
		}
	}

	/**
	 * Read template file content, returns null if template doesn't exist
	 */
	private async getTemplateContent(templatePath: string): Promise<string | null> {
		if (!templatePath) return null;

		// Ensure .md extension
		const path = templatePath.endsWith('.md') ? templatePath : `${templatePath}.md`;
		const file = this.app.vault.getAbstractFileByPath(path);

		if (file instanceof TFile) {
			try {
				return await this.app.vault.read(file);
			} catch {
				console.warn(`Focus: Could not read template file: ${path}`);
				return null;
			}
		}

		return null;
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

/**
 * Modal shown when auto-sort can't fit today's tasks into Immediate
 */
class AutoSortOverflowModal extends Modal {
	private plugin: FocusPlugin;
	private overflowTaskIds: string[];

	constructor(plugin: FocusPlugin, _data: FocusData, overflowTasks: Task[]) {
		super(plugin.app);
		this.plugin = plugin;
		// Store IDs so we always look up fresh data
		this.overflowTaskIds = overflowTasks.map(t => t.id);
	}

	onOpen(): void {
		this.plugin.overflowModalOpen = true;
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass('focus-overflow-modal');

		// Load fresh data synchronously isn't possible, so render what we know
		// and reload in handlers
		contentEl.createEl('h2', { text: 'Immediate is full' });
		contentEl.createEl('p', {
			text: `${this.overflowTaskIds.length} task(s) due today need to move to Immediate, but it's at the limit (${this.plugin.settings.maxImmediateTasks}).`,
		});

		// We need fresh data to render the task lists
		void this.renderContent(contentEl);
	}

	private async renderContent(contentEl: HTMLElement): Promise<void> {
		const data = await this.plugin.loadTaskData();

		// Find the overflow tasks in fresh data
		const overflowTasks = this.overflowTaskIds
			.map(id => data.tasks.thisWeek.find(t => t.id === id))
			.filter((t): t is Task => t != null);

		if (overflowTasks.length === 0) {
			// All overflow tasks have been resolved (e.g. moved already)
			this.close();
			return;
		}

		contentEl.createEl('h3', { text: 'Tasks due today:' });
		const taskList = contentEl.createEl('ul');
		for (const task of overflowTasks) {
			taskList.createEl('li', { text: task.title });
		}

		new Setting(contentEl)
			.setName('Increase limit temporarily')
			.setDesc(`Allow ${this.plugin.settings.maxImmediateTasks + overflowTasks.length} immediate tasks for now`)
			.addButton((btn) =>
				btn.setButtonText('Increase limit').setCta().onClick(async () => {
					const freshData = await this.plugin.loadTaskData();
					for (const id of this.overflowTaskIds) {
						const task = freshData.tasks.thisWeek.find(t => t.id === id);
						if (task) {
							freshData.tasks.thisWeek = freshData.tasks.thisWeek.filter(t => t.id !== id);
							task.section = 'immediate';
							freshData.tasks.immediate.unshift(task);
						}
					}
					await this.plugin.saveTaskData(freshData);
					this.plugin.refreshFocusView();
					this.close();
				})
			);

		// Show non-do-date tasks in immediate that could be demoted
		const demotable = data.tasks.immediate.filter(t => !t.completed && !t.doDate);
		if (demotable.length > 0) {
			contentEl.createEl('h3', { text: 'Or move a task back to This Week:' });
			for (const task of demotable) {
				new Setting(contentEl)
					.setName(task.title)
					.addButton((btn) =>
						btn.setButtonText('Demote').onClick(async () => {
							const freshData = await this.plugin.loadTaskData();

							// Move this task to thisWeek
							const taskToDemote = freshData.tasks.immediate.find(t => t.id === task.id);
							if (taskToDemote) {
								freshData.tasks.immediate = freshData.tasks.immediate.filter(t => t.id !== task.id);
								taskToDemote.section = 'thisWeek';
								freshData.tasks.thisWeek.push(taskToDemote);
							}

							// Promote the first overflow task to immediate
							const promoteId = this.overflowTaskIds[0];
							if (promoteId) {
								const toPromote = freshData.tasks.thisWeek.find(t => t.id === promoteId);
								if (toPromote) {
									freshData.tasks.thisWeek = freshData.tasks.thisWeek.filter(t => t.id !== promoteId);
									toPromote.section = 'immediate';
									freshData.tasks.immediate.unshift(toPromote);
								}
								this.overflowTaskIds.shift();
							}

							await this.plugin.saveTaskData(freshData);
							this.plugin.refreshFocusView();

							if (this.overflowTaskIds.length === 0) {
								this.close();
							} else {
								// Re-render modal with remaining overflow
								this.onOpen();
							}
						})
					);
			}
		}

		new Setting(contentEl)
			.addButton((btn) =>
				btn.setButtonText('Dismiss').onClick(() => this.close())
			);
	}

	onClose(): void {
		this.plugin.overflowModalOpen = false;
		this.contentEl.empty();

		// Catch up on any remote changes we suppressed while the modal was open
		void this.plugin.catchUpRemoteSync();
	}
}
