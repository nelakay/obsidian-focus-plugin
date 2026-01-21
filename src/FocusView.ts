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
			const task = this.data.tasks[section].find(t => t.id === taskId);
			if (task) {
				task.completed = !task.completed;
				await this.plugin.saveTaskData(this.data);
				// Sync completion to source file if task came from vault
				if (task.sourceFile) {
					await this.plugin.syncTaskCompletionToSource(task);
				}
				await this.render();
				return;
			}
		}
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

		const addButton = header.createEl('button', {
			text: '+',
			cls: 'focus-header-add-btn',
			attr: { title: 'Add task' },
		});
		addButton.addEventListener('click', () => {
			this.plugin.openAddTaskModal(true); // Default to This Week when triggered from Focus view
		});

		// Immediate section
		this.renderSection(container, 'Immediate', 'immediate', this.data.tasks.immediate, this.data);

		// This week section
		this.renderSection(container, 'This week', 'thisWeek', this.data.tasks.thisWeek, this.data);

		// Restore selection if any
		this.updateSelection();
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

		// Render tasks (active first, then completed)
		const sortedTasks = [...tasks].sort((a, b) => {
			if (a.completed === b.completed) return 0;
			return a.completed ? 1 : -1;
		});

		for (const task of sortedTasks) {
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
		task.completed = !task.completed;
		await this.plugin.saveTaskData(data);
		// Sync completion to source file if task came from vault
		if (task.sourceFile) {
			await this.plugin.syncTaskCompletionToSource(task);
		}
		await this.render();
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
