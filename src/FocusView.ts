import { ItemView, WorkspaceLeaf, Menu, Notice, TFile } from 'obsidian';
import { FOCUS_VIEW_TYPE, Task, TaskSection, FocusData } from './types';
import type FocusPlugin from './main';

export class FocusView extends ItemView {
	plugin: FocusPlugin;
	private draggedTask: Task | null = null;
	private draggedFromSection: TaskSection | null = null;
	private selectedTaskIndex: number = -1;
	private selectedSection: TaskSection | null = null;
	private data: FocusData | null = null;

	constructor(leaf: WorkspaceLeaf, plugin: FocusPlugin) {
		super(leaf);
		this.plugin = plugin;
		// Add class immediately in constructor so styles apply on Obsidian restart
		this.containerEl.addClass('focus-plugin-view');
	}

	getViewType(): string {
		return FOCUS_VIEW_TYPE;
	}

	getDisplayText(): string {
		return 'Focus';
	}

	getIcon(): string {
		return 'target';
	}

	async onOpen(): Promise<void> {
		// Setup keyboard navigation
		this.containerEl.addEventListener('keydown', this.handleKeyDown.bind(this));
		this.containerEl.setAttribute('tabindex', '0');

		// Add class to main container for styling scope
		this.containerEl.addClass('focus-plugin-view');

		await this.render();
	}

	async onClose(): Promise<void> {
		this.containerEl.removeEventListener('keydown', this.handleKeyDown.bind(this));
		await Promise.resolve();
	}

	private handleKeyDown(e: KeyboardEvent): void {
		if (!this.data) return;

		const allTasks = [
			...this.data.tasks.immediate.filter(t => !t.completed),
			...this.data.tasks.thisWeek.filter(t => !t.completed),
		];

		if (allTasks.length === 0) return;

		switch (e.key) {
			case 'ArrowDown':
			case 'j':
				e.preventDefault();
				this.selectedTaskIndex = Math.min(this.selectedTaskIndex + 1, allTasks.length - 1);
				this.updateSelection();
				break;

			case 'ArrowUp':
			case 'k':
				e.preventDefault();
				this.selectedTaskIndex = Math.max(this.selectedTaskIndex - 1, 0);
				this.updateSelection();
				break;

			case 'Enter':
			case ' ':
				e.preventDefault();
				if (this.selectedTaskIndex >= 0 && this.selectedTaskIndex < allTasks.length) {
					const task = allTasks[this.selectedTaskIndex];
					void this.toggleTaskCompleteById(task.id);
				}
				break;

			case 'i':
				e.preventDefault();
				if (this.selectedTaskIndex >= 0) {
					const task = allTasks[this.selectedTaskIndex];
					if (task.section === 'thisWeek') {
						void this.moveTaskById(task.id, 'thisWeek', 'immediate');
					}
				}
				break;

			case 'w':
				e.preventDefault();
				if (this.selectedTaskIndex >= 0) {
					const task = allTasks[this.selectedTaskIndex];
					if (task.section === 'immediate') {
						void this.moveTaskById(task.id, 'immediate', 'thisWeek');
					}
				}
				break;

			case 'u':
				e.preventDefault();
				if (this.selectedTaskIndex >= 0) {
					const task = allTasks[this.selectedTaskIndex];
					void this.moveTaskById(task.id, task.section, 'unscheduled');
					new Notice('Task moved to unscheduled');
				}
				break;

			case 'Escape':
				this.selectedTaskIndex = -1;
				this.updateSelection();
				break;
		}
	}

	private updateSelection(): void {
		// Remove all previous selections
		this.containerEl.querySelectorAll('.focus-task-selected').forEach(el => {
			el.removeClass('focus-task-selected');
		});

		if (this.selectedTaskIndex < 0 || !this.data) return;

		const allTasks = [
			...this.data.tasks.immediate.filter(t => !t.completed),
			...this.data.tasks.thisWeek.filter(t => !t.completed),
		];

		if (this.selectedTaskIndex >= allTasks.length) return;

		const task = allTasks[this.selectedTaskIndex];
		const taskEl = this.containerEl.querySelector(`[data-task-id="${task.id}"]`);
		if (taskEl) {
			taskEl.addClass('focus-task-selected');
			taskEl.scrollIntoView({ block: 'nearest' });
		}
	}

	private async toggleTaskCompleteById(taskId: string): Promise<void> {
		if (!this.data) return;

		for (const section of ['immediate', 'thisWeek', 'unscheduled'] as TaskSection[]) {
			const taskIndex = this.data.tasks[section].findIndex(t => t.id === taskId);
			if (taskIndex > -1) {
				const task = this.data.tasks[section][taskIndex];
				await this.archiveOrRestoreTask(task, section, this.data);
				return;
			}
		}
	}

	/**
	 * Archives a completed task to the monthly bucket, or restores it if uncompleting
	 */
	private async archiveOrRestoreTask(task: Task, section: TaskSection, data: FocusData): Promise<void> {
		task.completed = !task.completed;

		if (task.completed) {
			// Task is being completed - archive it
			const today = new Date().toISOString().split('T')[0];
			task.completedAt = today;

			// Get month key (e.g., "2026-01")
			const monthKey = today.substring(0, 7);

			// Initialize completedTasks if needed
			if (!data.completedTasks) {
				data.completedTasks = {};
			}
			if (!data.completedTasks[monthKey]) {
				data.completedTasks[monthKey] = [];
			}

			// Remove from active section
			const index = data.tasks[section].findIndex(t => t.id === task.id);
			if (index > -1) {
				data.tasks[section].splice(index, 1);
			}

			// Add to completed archive
			data.completedTasks[monthKey].push(task);
		} else {
			// Task is being uncompleted - this shouldn't happen from active list
			// but handle it gracefully
			task.completedAt = undefined;
		}

		await this.plugin.saveTaskData(data);

		// Sync completion to source file if task came from vault
		if (task.sourceFile) {
			await this.plugin.syncTaskCompletionToSource(task);
		}

		await this.render();
	}

	private async moveTaskById(taskId: string, fromSection: TaskSection, toSection: TaskSection): Promise<void> {
		if (!this.data) return;

		// Check max immediate
		if (toSection === 'immediate') {
			const activeImmediate = this.data.tasks.immediate.filter(t => !t.completed);
			if (activeImmediate.length >= this.plugin.settings.maxImmediateTasks) {
				new Notice(`Maximum ${this.plugin.settings.maxImmediateTasks} tasks in immediate.`);
				return;
			}
		}

		const task = this.data.tasks[fromSection].find(t => t.id === taskId);
		if (!task) return;

		// Remove from old section
		const fromIndex = this.data.tasks[fromSection].findIndex(t => t.id === taskId);
		if (fromIndex > -1) {
			this.data.tasks[fromSection].splice(fromIndex, 1);
		}

		// Add to new section
		task.section = toSection;
		this.data.tasks[toSection].push(task);

		await this.plugin.saveTaskData(this.data);
		await this.render();
	}

	async render(): Promise<void> {
		const container = this.containerEl.children[1];
		container.empty();
		container.addClass('focus-view-container');

		this.data = await this.plugin.loadTaskData();

		// Header with add button
		const header = container.createEl('div', { cls: 'focus-header' });
		header.createEl('h2', { text: 'Focus mode', cls: 'focus-title' });

		const headerActions = header.createEl('div', { cls: 'focus-header-actions' });

		// Toggle completed visibility button
		const toggleCompletedBtn = headerActions.createEl('button', {
			cls: 'focus-header-btn focus-toggle-completed-btn',
			attr: {
				title: this.plugin.settings.hideCompletedTasks
					? 'Show completed tasks'
					: 'Hide completed tasks',
			},
		});
		toggleCompletedBtn.innerHTML = this.plugin.settings.hideCompletedTasks
			? '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>'
			: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>';
		toggleCompletedBtn.addEventListener('click', async () => {
			this.plugin.settings.hideCompletedTasks = !this.plugin.settings.hideCompletedTasks;
			await this.plugin.saveSettings();
			await this.render();
		});

		const addButton = headerActions.createEl('button', {
			text: '+',
			cls: 'focus-header-btn focus-header-add-btn',
			attr: { title: 'Add task' },
		});
		addButton.addEventListener('click', () => {
			this.plugin.openAddTaskModal(true); // Default to This Week when triggered from Focus view
		});

		// Immediate section
		this.renderSection(container, 'Immediate', 'immediate', this.data.tasks.immediate, this.data);

		// This week section
		this.renderSection(container, 'This week', 'thisWeek', this.data.tasks.thisWeek, this.data);

		// Completed section with monthly archives
		this.renderCompletedSection(container, this.data);

		// Footer with link to task file
		this.renderFooter(container);

		// Restore selection if any
		this.updateSelection();
	}

	private renderCompletedSection(container: Element, data: FocusData): void {
		const completedTasks = data.completedTasks || {};
		const monthKeys = Object.keys(completedTasks).sort().reverse(); // Most recent first

		// Count total completed tasks
		const totalCompleted = monthKeys.reduce((sum, key) => sum + (completedTasks[key]?.length || 0), 0);

		if (totalCompleted === 0) return;

		const sectionEl = container.createEl('div', { cls: 'focus-section focus-section-completed' });

		// Section header
		const headerEl = sectionEl.createEl('div', { cls: 'focus-section-header' });
		headerEl.createEl('span', {
			text: `Completed (${totalCompleted})`,
			cls: 'focus-section-title',
		});

		// Render each month as a collapsible group
		for (const monthKey of monthKeys) {
			const tasks = completedTasks[monthKey];
			if (!tasks || tasks.length === 0) continue;

			this.renderMonthGroup(sectionEl, monthKey, tasks, data);
		}
	}

	private renderMonthGroup(container: Element, monthKey: string, tasks: Task[], data: FocusData): void {
		const monthEl = container.createEl('div', { cls: 'focus-month-group' });

		// Format month header (e.g., "2026-01" -> "January 2026")
		const [year, month] = monthKey.split('-');
		const monthNames = [
			'January', 'February', 'March', 'April', 'May', 'June',
			'July', 'August', 'September', 'October', 'November', 'December',
		];
		const monthName = `${monthNames[parseInt(month, 10) - 1]} ${year}`;

		// Collapsible header
		const headerEl = monthEl.createEl('div', { cls: 'focus-month-header' });
		const toggleIcon = headerEl.createEl('span', { cls: 'focus-month-toggle', text: '▶' });
		headerEl.createEl('span', { text: `${monthName} (${tasks.length})`, cls: 'focus-month-title' });

		// Task list (hidden by default)
		const listEl = monthEl.createEl('div', { cls: 'focus-month-tasks focus-month-collapsed' });

		for (const task of tasks) {
			this.renderCompletedTask(listEl, task, monthKey, data);
		}

		// Toggle visibility on click
		headerEl.addEventListener('click', () => {
			const isCollapsed = listEl.hasClass('focus-month-collapsed');
			if (isCollapsed) {
				listEl.removeClass('focus-month-collapsed');
				toggleIcon.setText('▼');
			} else {
				listEl.addClass('focus-month-collapsed');
				toggleIcon.setText('▶');
			}
		});
	}

	private renderCompletedTask(container: Element, task: Task, monthKey: string, data: FocusData): void {
		const taskEl = container.createEl('div', {
			cls: 'focus-task focus-task-completed',
			attr: { 'data-task-id': task.id },
		});

		// Checkbox (allows uncompleting)
		const checkbox = taskEl.createEl('input', {
			type: 'checkbox',
			cls: 'focus-task-checkbox',
		});
		checkbox.checked = true;
		checkbox.addEventListener('change', async () => {
			await this.restoreTaskFromArchive(task, monthKey, data);
		});

		// Task title with completion date
		const titleEl = taskEl.createEl('span', { cls: 'focus-task-title' });
		titleEl.createEl('span', { text: task.title });
		if (task.completedAt) {
			titleEl.createEl('span', {
				text: ` (${task.completedAt})`,
				cls: 'focus-task-completed-date',
			});
		}
	}

	private async restoreTaskFromArchive(task: Task, monthKey: string, data: FocusData): Promise<void> {
		// Remove from completed archive
		const tasks = data.completedTasks[monthKey];
		if (tasks) {
			const index = tasks.findIndex(t => t.id === task.id);
			if (index > -1) {
				tasks.splice(index, 1);
			}
			// Clean up empty month
			if (tasks.length === 0) {
				delete data.completedTasks[monthKey];
			}
		}

		// Restore to original section (or default to unscheduled)
		task.completed = false;
		task.completedAt = undefined;
		const targetSection = task.section || 'unscheduled';
		data.tasks[targetSection].push(task);

		await this.plugin.saveTaskData(data);

		// Sync to source file if needed
		if (task.sourceFile) {
			await this.plugin.syncTaskCompletionToSource(task);
		}

		await this.render();
	}

	private renderFooter(container: Element): void {
		const footer = container.createEl('div', { cls: 'focus-footer' });

		const fileLink = footer.createEl('a', {
			text: 'Edit task file',
			cls: 'focus-file-link',
			href: '#',
		});

		fileLink.addEventListener('click', (e) => {
			e.preventDefault();
			const filePath = this.plugin.settings.taskFilePath;
			const file = this.plugin.app.vault.getAbstractFileByPath(filePath);
			if (file instanceof TFile) {
				void this.plugin.app.workspace.getLeaf().openFile(file);
			}
		});
	}

	private renderSection(
		container: Element,
		title: string,
		section: TaskSection,
		tasks: Task[],
		data: FocusData
	): void {
		const sectionEl = container.createEl('div', { cls: `focus-section focus-section-${section}` });

		// Section header
		const headerEl = sectionEl.createEl('div', { cls: 'focus-section-header' });
		const activeTasks = tasks.filter(t => !t.completed);
		const maxIndicator = section === 'immediate' ? `/${this.plugin.settings.maxImmediateTasks}` : '';
		headerEl.createEl('span', {
			text: `${title} (${activeTasks.length}${maxIndicator})`,
			cls: 'focus-section-title',
		});

		// Task list
		const listEl = sectionEl.createEl('div', {
			cls: 'focus-task-list',
			attr: { 'data-section': section },
		});

		// Make section a drop target
		this.setupDropZone(listEl, section, data);

		// Filter and sort tasks
		let displayTasks = [...tasks];

		// Hide completed if setting is enabled
		if (this.plugin.settings.hideCompletedTasks) {
			displayTasks = displayTasks.filter(t => !t.completed);
		}

		// Sort: active first, then by do date, then completed last
		displayTasks.sort((a, b) => {
			// Completed tasks always go last
			if (a.completed !== b.completed) {
				return a.completed ? 1 : -1;
			}

			// For active tasks, sort by do date
			if (!a.completed && !b.completed) {
				// Tasks with do dates come before tasks without
				if (a.doDate && !b.doDate) return -1;
				if (!a.doDate && b.doDate) return 1;

				// Both have do dates - sort chronologically
				if (a.doDate && b.doDate) {
					const dateCompare = a.doDate.localeCompare(b.doDate);
					if (dateCompare !== 0) return dateCompare;

					// Same date - sort by time
					if (a.doTime && b.doTime) {
						return a.doTime.localeCompare(b.doTime);
					}
					if (a.doTime && !b.doTime) return -1;
					if (!a.doTime && b.doTime) return 1;
				}
			}

			return 0;
		});

		for (const task of displayTasks) {
			this.renderTask(listEl, task, section, data);
		}

		// Empty state / drop hint
		if (tasks.length === 0) {
			listEl.createEl('div', {
				text: section === 'immediate' ? 'Drop tasks here to focus' : 'No tasks scheduled',
				cls: 'focus-empty-state',
			});
		}
	}

	private renderTask(container: Element, task: Task, section: TaskSection, data: FocusData): void {
		const taskEl = container.createEl('div', {
			cls: `focus-task ${task.completed ? 'focus-task-completed' : ''}`,
			attr: {
				draggable: task.completed ? 'false' : 'true',
				'data-task-id': task.id,
			},
		});

		// Drag handle
		if (!task.completed) {
			taskEl.createEl('span', { cls: 'focus-drag-handle', text: '⋮⋮' });
		}

		// Checkbox
		const checkbox = taskEl.createEl('input', {
			type: 'checkbox',
			cls: 'focus-checkbox',
		});
		checkbox.checked = task.completed;
		checkbox.addEventListener('change', () => {
			void this.toggleTaskComplete(task, data);
		});

		// Task title with wiki-link support
		const titleEl = taskEl.createEl('span', { cls: 'focus-task-title' });
		this.renderTaskTitle(titleEl, task.title);

		// Goal indicator - hidden for now
		// if (task.goalId) {
		// 	const goal = data.goals?.find(g => g.id === task.goalId);
		// 	if (goal) {
		// 		const goalEl = taskEl.createEl('span', {
		// 			cls: 'focus-goal-indicator',
		// 			attr: { title: `Goal: ${goal.title}` },
		// 		});
		// 		goalEl.createEl('span', { text: '🎯' });
		// 	}
		// }

		// Source file indicator (if synced from vault)
		if (task.sourceFile) {
			const sourceEl = taskEl.createEl('span', {
				cls: 'focus-source-indicator',
				attr: { title: `From: ${task.sourceFile}` },
			});
			sourceEl.createEl('span', { text: '📄' });
		}

		// URL indicator (if task has a link)
		if (task.url) {
			const urlEl = taskEl.createEl('a', {
				cls: 'focus-url-indicator',
				href: task.url,
				attr: { title: task.url },
			});
			urlEl.createEl('span', { text: '🔗' });
			urlEl.addEventListener('click', (e) => {
				e.stopPropagation();
				// Let the browser handle the link naturally
			});
		}

		// Do date indicator (if task has a scheduled date)
		if (task.doDate) {
			const isOverdue = this.isTaskOverdue(task);
			const dateDisplay = this.formatDoDate(task.doDate, task.doTime);
			const dateEl = taskEl.createEl('span', {
				cls: `focus-date-indicator ${isOverdue ? 'focus-date-overdue' : ''}`,
				attr: { title: `Scheduled: ${task.doDate}${task.doTime ? ' ' + task.doTime : ''}` },
			});
			dateEl.createEl('span', { text: `📅 ${dateDisplay}` });
		}

		// Setup drag events (only for non-completed tasks)
		if (!task.completed) {
			this.setupDragEvents(taskEl, task, section);
		}

		// Context menu
		taskEl.addEventListener('contextmenu', (e) => {
			e.preventDefault();
			this.showContextMenu(e, task, section, data);
		});
	}

	/**
	 * Render task title with clickable [[wiki-links]]
	 */
	/**
	 * Check if a task is overdue based on its do date/time
	 */
	private isTaskOverdue(task: Task): boolean {
		if (!task.doDate || task.completed) return false;

		const now = new Date();
		const today = now.toISOString().split('T')[0];

		if (task.doDate < today) {
			return true;
		}

		if (task.doDate === today && task.doTime) {
			const [hours, minutes] = task.doTime.split(':').map(Number);
			const taskTime = new Date(now);
			taskTime.setHours(hours, minutes, 0, 0);
			return now > taskTime;
		}

		return false;
	}

	/**
	 * Format do date for display (e.g., "Today", "Tomorrow", "Jan 27", "Jan 27 2:30pm")
	 */
	private formatDoDate(doDate: string, doTime?: string): string {
		const now = new Date();
		const today = now.toISOString().split('T')[0];

		const tomorrow = new Date(now);
		tomorrow.setDate(tomorrow.getDate() + 1);
		const tomorrowStr = tomorrow.toISOString().split('T')[0];

		let dateStr: string;

		if (doDate === today) {
			dateStr = 'Today';
		} else if (doDate === tomorrowStr) {
			dateStr = 'Tomorrow';
		} else {
			const date = new Date(doDate + 'T00:00:00');
			const month = date.toLocaleDateString('en-US', { month: 'short' });
			const day = date.getDate();
			dateStr = `${month} ${day}`;
		}

		if (doTime) {
			const [hours, minutes] = doTime.split(':').map(Number);
			const period = hours >= 12 ? 'pm' : 'am';
			const hour12 = hours % 12 || 12;
			const timeStr = minutes === 0 ? `${hour12}${period}` : `${hour12}:${minutes.toString().padStart(2, '0')}${period}`;
			return `${dateStr} ${timeStr}`;
		}

		return dateStr;
	}

	/**
	 * Render task title with clickable [[wiki-links]]
	 */
	private renderTaskTitle(container: HTMLElement, title: string): void {
		// Regex to match [[link]] or [[link|alias]]
		const linkRegex = /\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g;
		let lastIndex = 0;
		let match;

		while ((match = linkRegex.exec(title)) !== null) {
			// Add text before the link
			if (match.index > lastIndex) {
				container.appendText(title.slice(lastIndex, match.index));
			}

			// Create clickable link
			const notePath = match[1];
			const displayText = match[2] || match[1];

			const linkEl = container.createEl('a', {
				text: displayText,
				cls: 'focus-wiki-link',
				href: '#',
			});

			linkEl.addEventListener('click', (e) => {
				e.preventDefault();
				e.stopPropagation();
				void this.plugin.openLinkedNote(`[[${notePath}]]`);
			});

			lastIndex = match.index + match[0].length;
		}

		// Add remaining text after last link
		if (lastIndex < title.length) {
			container.appendText(title.slice(lastIndex));
		}

		// If no links were found, just set the text
		if (lastIndex === 0) {
			container.setText(title);
		}
	}

	private setupDragEvents(taskEl: HTMLElement, task: Task, section: TaskSection): void {
		taskEl.addEventListener('dragstart', (e) => {
			this.draggedTask = task;
			this.draggedFromSection = section;
			taskEl.addClass('focus-task-dragging');
			e.dataTransfer?.setData('text/plain', task.id);
		});

		taskEl.addEventListener('dragend', () => {
			taskEl.removeClass('focus-task-dragging');
			this.draggedTask = null;
			this.draggedFromSection = null;
			// Remove all drop indicators
			this.containerEl.querySelectorAll('.focus-drop-active').forEach(el => {
				el.removeClass('focus-drop-active');
			});
		});
	}

	private setupDropZone(listEl: HTMLElement, section: TaskSection, data: FocusData): void {
		listEl.addEventListener('dragover', (e) => {
			e.preventDefault();
			if (this.draggedTask && this.draggedFromSection !== section) {
				listEl.addClass('focus-drop-active');
			}
		});

		listEl.addEventListener('dragleave', () => {
			listEl.removeClass('focus-drop-active');
		});

		listEl.addEventListener('drop', (e) => {
			e.preventDefault();
			listEl.removeClass('focus-drop-active');

			if (!this.draggedTask || this.draggedFromSection === section) return;

			// Check max immediate tasks
			if (section === 'immediate') {
				const activeImmediate = data.tasks.immediate.filter(t => !t.completed);
				if (activeImmediate.length >= this.plugin.settings.maxImmediateTasks) {
					new Notice(`Maximum ${this.plugin.settings.maxImmediateTasks} tasks in immediate. Remove one first.`);
					return;
				}
			}

			void this.moveTask(this.draggedTask, this.draggedFromSection!, section, data);
		});
	}

	private async toggleTaskComplete(task: Task, data: FocusData): Promise<void> {
		await this.archiveOrRestoreTask(task, task.section, data);
	}

	private async moveTask(
		task: Task,
		fromSection: TaskSection,
		toSection: TaskSection,
		data: FocusData
	): Promise<void> {
		// Remove from old section
		const fromIndex = data.tasks[fromSection].findIndex(t => t.id === task.id);
		if (fromIndex > -1) {
			data.tasks[fromSection].splice(fromIndex, 1);
		}

		// Add to new section
		task.section = toSection;
		data.tasks[toSection].push(task);

		await this.plugin.saveTaskData(data);
		await this.render();
	}

	private showContextMenu(e: MouseEvent, task: Task, section: TaskSection, data: FocusData): void {
		const menu = new Menu();

		// Complete/Uncomplete
		menu.addItem((item) => {
			item
				.setTitle(task.completed ? 'Mark incomplete' : 'Mark complete')
				.setIcon(task.completed ? 'circle' : 'check-circle')
				.onClick(() => {
					void this.toggleTaskComplete(task, data);
				});
		});

		menu.addSeparator();

		// Move to Immediate (if in This week)
		if (section === 'thisWeek' && !task.completed) {
			menu.addItem((item) => {
				item
					.setTitle('Move to immediate')
					.setIcon('arrow-up')
					.onClick(() => {
						const activeImmediate = data.tasks.immediate.filter(t => !t.completed);
						if (activeImmediate.length >= this.plugin.settings.maxImmediateTasks) {
							new Notice(`Maximum ${this.plugin.settings.maxImmediateTasks} tasks in immediate.`);
							return;
						}
						void this.moveTask(task, section, 'immediate', data);
					});
			});
		}

		// Move to This week (if in Immediate)
		if (section === 'immediate' && !task.completed) {
			menu.addItem((item) => {
				item
					.setTitle('Move to this week')
					.setIcon('arrow-down')
					.onClick(() => {
						void this.moveTask(task, section, 'thisWeek', data);
					});
			});
		}

		menu.addSeparator();

		// Deprioritize (move to backlog)
		if (!task.completed) {
			menu.addItem((item) => {
				item
					.setTitle('Deprioritize')
					.setIcon('arrow-down-to-line')
					.onClick(() => {
						void this.moveTask(task, section, 'unscheduled', data).then(() => {
							new Notice('Task moved to backlog.');
						});
					});
			});
		}

		// Open source file (if synced)
		if (task.sourceFile) {
			menu.addItem((item) => {
				item
					.setTitle('Open source file')
					.setIcon('file')
					.onClick(() => {
						const file = this.plugin.app.vault.getAbstractFileByPath(task.sourceFile!);
						if (file instanceof TFile) {
							void this.plugin.app.workspace.getLeaf().openFile(file);
						}
					});
			});
		}

		// Delete
		menu.addItem((item) => {
			item
				.setTitle('Delete')
				.setIcon('trash')
				.onClick(() => {
					const fromIndex = data.tasks[section].findIndex(t => t.id === task.id);
					if (fromIndex > -1) {
						data.tasks[section].splice(fromIndex, 1);
						void this.plugin.saveTaskData(data).then(() => {
							void this.render();
							new Notice('Task deleted');
						});
					}
				});
		});

		menu.showAtMouseEvent(e);
	}
}
