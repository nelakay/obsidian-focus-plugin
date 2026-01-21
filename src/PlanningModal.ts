import { Modal, Notice, Menu } from 'obsidian';
import { FocusData, Task, TaskSection, WeeklyGoal } from './types';
import type FocusPlugin from './main';

export class PlanningModal extends Modal {
	plugin: FocusPlugin;
	data: FocusData | null = null;

	constructor(plugin: FocusPlugin) {
		super(plugin.app);
		this.plugin = plugin;
	}

	async onOpen(): Promise<void> {
		this.data = await this.plugin.loadTaskData();
		this.render();
	}

	private render(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass('focus-planning-modal');

		if (!this.data) return;

		// Header with date
		const today = new Date();
		const dateStr = today.toLocaleDateString('en-US', {
			weekday: 'long',
			month: 'short',
			day: 'numeric',
			year: 'numeric',
		});
		contentEl.createEl('h2', { text: `Planning view — ${dateStr}` });

		// Weekly Goals section - hidden for now
		// this.renderGoalsSection(contentEl);

		// This Week's Tasks section (simplified, no goal grouping)
		this.renderThisWeekSection(contentEl);

		// Unscheduled Tasks
		this.renderUnscheduledSection(contentEl);

		// Action buttons
		const actionsEl = contentEl.createEl('div', { cls: 'focus-planning-actions' });

		const closeBtn = actionsEl.createEl('button', {
			text: 'Done planning',
			cls: 'mod-cta',
		});
		closeBtn.addEventListener('click', () => this.close());
	}

	private renderGoalsSection(container: HTMLElement): void {
		const section = container.createEl('div', { cls: 'focus-planning-section' });
		section.createEl('h3', { text: "This week's goals" });

		const goalsList = section.createEl('div', { cls: 'focus-goals-list' });

		if (this.data!.goals.length === 0) {
			goalsList.createEl('p', {
				text: 'No goals set for this week. Add goals to organize your tasks.',
				cls: 'focus-empty-state',
			});
		} else {
			for (const goal of this.data!.goals) {
				this.renderGoal(goalsList, goal);
			}
		}

		// Add goal input
		const addGoalEl = section.createEl('div', { cls: 'focus-add-goal' });
		const input = addGoalEl.createEl('input', {
			type: 'text',
			placeholder: 'Add a goal for this week...',
			cls: 'focus-goal-input',
		});

		input.addEventListener('keydown', (e) => {
			if (e.key === 'Enter' && input.value.trim()) {
				const newGoal: WeeklyGoal = {
					id: Date.now().toString(36) + Math.random().toString(36).substring(2, 11),
					title: input.value.trim(),
				};
				this.data!.goals.push(newGoal);
				void this.plugin.saveTaskData(this.data!).then(() => {
					this.render();
				});
			}
		});
	}

	private renderGoal(container: HTMLElement, goal: WeeklyGoal): void {
		const goalEl = container.createEl('div', { cls: 'focus-goal-item' });

		// Count tasks linked to this goal
		const linkedTasks = this.getTasksForGoal(goal.id);
		const completedCount = linkedTasks.filter(t => t.completed).length;
		const totalCount = linkedTasks.length;

		const titleEl = goalEl.createEl('div', { cls: 'focus-goal-info' });
		titleEl.createEl('span', {
			text: `🎯 ${goal.title}`,
			cls: 'focus-goal-title',
		});

		if (totalCount > 0) {
			titleEl.createEl('span', {
				text: `${completedCount}/${totalCount} tasks`,
				cls: 'focus-goal-progress',
			});
		}

		const deleteBtn = goalEl.createEl('button', {
			text: '×',
			cls: 'focus-goal-delete',
		});
		deleteBtn.addEventListener('click', () => {
			// Unlink all tasks from this goal before deleting
			this.unlinkTasksFromGoal(goal.id);

			const index = this.data!.goals.findIndex(g => g.id === goal.id);
			if (index > -1) {
				this.data!.goals.splice(index, 1);
				void this.plugin.saveTaskData(this.data!).then(() => {
					this.render();
				});
			}
		});
	}

	private getTasksForGoal(goalId: string): Task[] {
		const allTasks = [
			...this.data!.tasks.immediate,
			...this.data!.tasks.thisWeek,
			...this.data!.tasks.unscheduled,
		];
		return allTasks.filter(t => t.goalId === goalId);
	}

	private getTasksWithoutGoal(): Task[] {
		const scheduledTasks = [
			...this.data!.tasks.immediate,
			...this.data!.tasks.thisWeek,
		];
		return scheduledTasks.filter(t => !t.goalId);
	}

	private unlinkTasksFromGoal(goalId: string): void {
		for (const section of ['immediate', 'thisWeek', 'unscheduled'] as TaskSection[]) {
			for (const task of this.data!.tasks[section]) {
				if (task.goalId === goalId) {
					delete task.goalId;
				}
			}
		}
	}

	private renderThisWeekSection(container: HTMLElement): void {
		const section = container.createEl('div', { cls: 'focus-planning-section' });
		section.createEl('h3', { text: "This week's tasks" });

		const allScheduled = [
			...this.data!.tasks.immediate,
			...this.data!.tasks.thisWeek,
		];

		if (allScheduled.length === 0) {
			section.createEl('p', {
				text: 'No tasks scheduled this week. Schedule tasks from unscheduled below.',
				cls: 'focus-empty-state',
			});
			return;
		}

		// Show overall progress
		const completed = allScheduled.filter(t => t.completed).length;
		const total = allScheduled.length;
		section.createEl('p', {
			text: `${completed}/${total} tasks completed`,
			cls: 'focus-progress-summary',
		});

		const taskList = section.createEl('div', { cls: 'focus-planning-task-list' });

		// Sort: incomplete first, then completed
		const sorted = [...allScheduled].sort((a, b) => {
			if (a.completed === b.completed) return 0;
			return a.completed ? 1 : -1;
		});

		for (const task of sorted) {
			this.renderPlanningTaskSimple(taskList, task);
		}
	}

	// Keep the old method for potential future use
	private renderTasksByGoalSection(container: HTMLElement): void {
		const section = container.createEl('div', { cls: 'focus-planning-section' });
		section.createEl('h3', { text: "This week's tasks" });

		const allScheduled = [
			...this.data!.tasks.immediate,
			...this.data!.tasks.thisWeek,
		];

		if (allScheduled.length === 0) {
			section.createEl('p', {
				text: 'No tasks scheduled this week. Schedule tasks from unscheduled below.',
				cls: 'focus-empty-state',
			});
			return;
		}

		// Show overall progress
		const completed = allScheduled.filter(t => t.completed).length;
		const total = allScheduled.length;
		section.createEl('p', {
			text: `${completed}/${total} tasks completed`,
			cls: 'focus-progress-summary',
		});

		// Group tasks by goal
		const tasksByGoal = new Map<string | null, Task[]>();

		// Initialize with goals
		for (const goal of this.data!.goals) {
			tasksByGoal.set(goal.id, []);
		}
		tasksByGoal.set(null, []); // For tasks without a goal

		// Sort tasks into groups
		for (const task of allScheduled) {
			const goalId = task.goalId || null;
			if (!tasksByGoal.has(goalId)) {
				// Goal was deleted but task still references it
				tasksByGoal.set(null, [...(tasksByGoal.get(null) || []), task]);
			} else {
				tasksByGoal.get(goalId)!.push(task);
			}
		}

		// Render tasks grouped by goal
		for (const goal of this.data!.goals) {
			const tasks = tasksByGoal.get(goal.id) || [];
			if (tasks.length > 0) {
				this.renderGoalTaskGroup(section, goal, tasks);
			}
		}

		// Render tasks without a goal
		const unassignedTasks = tasksByGoal.get(null) || [];
		if (unassignedTasks.length > 0) {
			this.renderGoalTaskGroup(section, null, unassignedTasks);
		}
	}

	private renderGoalTaskGroup(container: HTMLElement, goal: WeeklyGoal | null, tasks: Task[]): void {
		const groupEl = container.createEl('div', { cls: 'focus-goal-group' });

		const headerText = goal ? `🎯 ${goal.title}` : '📋 No goal assigned';
		groupEl.createEl('div', {
			text: headerText,
			cls: 'focus-goal-group-header',
		});

		const taskList = groupEl.createEl('div', { cls: 'focus-planning-task-list' });

		// Sort: incomplete first, then completed
		const sorted = [...tasks].sort((a, b) => {
			if (a.completed === b.completed) return 0;
			return a.completed ? 1 : -1;
		});

		for (const task of sorted) {
			this.renderPlanningTask(taskList, task);
		}
	}

	private renderUnscheduledSection(container: HTMLElement): void {
		const section = container.createEl('div', { cls: 'focus-planning-section' });

		const headerEl = section.createEl('div', { cls: 'focus-section-header-row' });
		headerEl.createEl('h3', { text: `Unscheduled (${this.data!.tasks.unscheduled.length} tasks)` });

		if (this.data!.tasks.unscheduled.length === 0) {
			section.createEl('p', {
				text: 'No unscheduled tasks. Add tasks during the week with quick-add.',
				cls: 'focus-empty-state',
			});
			return;
		}

		const taskList = section.createEl('div', { cls: 'focus-planning-task-list' });

		for (const task of this.data!.tasks.unscheduled) {
			this.renderUnscheduledTask(taskList, task);
		}
	}

	private renderPlanningTaskSimple(container: HTMLElement, task: Task): void {
		const taskEl = container.createEl('div', {
			cls: `focus-planning-task ${task.completed ? 'focus-task-completed' : ''}`,
		});

		const checkbox = task.completed ? '☑' : '☐';
		taskEl.createEl('span', {
			text: `${checkbox} ${task.title}`,
			cls: 'focus-task-text',
		});

		const actionsEl = taskEl.createEl('div', { cls: 'focus-task-actions' });

		// Section badge only (no goal button)
		const sectionLabel = task.section === 'immediate' ? 'Immediate' : 'This week';
		actionsEl.createEl('span', {
			text: sectionLabel,
			cls: 'focus-task-section-badge',
		});
	}

	private renderPlanningTask(container: HTMLElement, task: Task): void {
		const taskEl = container.createEl('div', {
			cls: `focus-planning-task ${task.completed ? 'focus-task-completed' : ''}`,
		});

		const checkbox = task.completed ? '☑' : '☐';
		taskEl.createEl('span', {
			text: `${checkbox} ${task.title}`,
			cls: 'focus-task-text',
		});

		const actionsEl = taskEl.createEl('div', { cls: 'focus-task-actions' });

		// Goal assignment button
		const goalBtn = actionsEl.createEl('button', {
			cls: 'focus-goal-assign-btn',
		});
		goalBtn.textContent = task.goalId
			? this.getGoalEmoji(task.goalId)
			: '🎯';
		goalBtn.title = task.goalId
			? `Assigned to: ${this.getGoalTitle(task.goalId)}`
			: 'Assign to goal';

		goalBtn.addEventListener('click', (e) => {
			e.stopPropagation();
			this.showGoalAssignMenu(e, task);
		});

		// Section badge
		const sectionLabel = task.section === 'immediate' ? 'Immediate' : 'This week';
		actionsEl.createEl('span', {
			text: sectionLabel,
			cls: 'focus-task-section-badge',
		});
	}

	private renderUnscheduledTask(container: HTMLElement, task: Task): void {
		const taskEl = container.createEl('div', { cls: 'focus-unscheduled-task' });

		taskEl.createEl('span', {
			text: `☐ ${task.title}`,
			cls: 'focus-task-text',
		});

		const actionsEl = taskEl.createEl('div', { cls: 'focus-task-actions' });

		// Goal assignment button - hidden for now
		// if (this.data!.goals.length > 0) {
		// 	const goalBtn = actionsEl.createEl('button', {
		// 		cls: 'focus-goal-assign-btn',
		// 	});
		// 	goalBtn.textContent = task.goalId
		// 		? this.getGoalEmoji(task.goalId)
		// 		: '🎯';
		// 	goalBtn.title = task.goalId
		// 		? `Assigned to: ${this.getGoalTitle(task.goalId)}`
		// 		: 'Assign to goal';
		//
		// 	goalBtn.addEventListener('click', (e) => {
		// 		e.stopPropagation();
		// 		this.showGoalAssignMenu(e, task);
		// 	});
		// }

		// Schedule for This Week
		const scheduleBtn = actionsEl.createEl('button', {
			text: 'Schedule',
			cls: 'focus-schedule-btn',
		});
		scheduleBtn.addEventListener('click', () => {
			void this.moveTaskToSection(task, 'unscheduled', 'thisWeek').then(() => {
				new Notice(`"${task.title}" scheduled for this week`);
			});
		});

		// Delete
		const deleteBtn = actionsEl.createEl('button', {
			text: '×',
			cls: 'focus-delete-btn',
		});
		deleteBtn.addEventListener('click', () => {
			const index = this.data!.tasks.unscheduled.findIndex(t => t.id === task.id);
			if (index > -1) {
				this.data!.tasks.unscheduled.splice(index, 1);
				void this.plugin.saveTaskData(this.data!).then(() => {
					this.render();
					new Notice('Task deleted');
				});
			}
		});
	}

	private showGoalAssignMenu(e: MouseEvent, task: Task): void {
		const menu = new Menu();

		// Option to remove goal assignment
		if (task.goalId) {
			menu.addItem((item) => {
				item
					.setTitle('Remove from goal')
					.setIcon('x')
					.onClick(() => {
						delete task.goalId;
						void this.plugin.saveTaskData(this.data!).then(() => {
							this.render();
							this.plugin.refreshFocusView();
						});
					});
			});
			menu.addSeparator();
		}

		// List all goals
		for (const goal of this.data!.goals) {
			menu.addItem((item) => {
				const isCurrentGoal = task.goalId === goal.id;
				item
					.setTitle(`🎯 ${goal.title}`)
					.setIcon(isCurrentGoal ? 'check' : '')
					.onClick(() => {
						task.goalId = goal.id;
						void this.plugin.saveTaskData(this.data!).then(() => {
							this.render();
							this.plugin.refreshFocusView();
							new Notice(`Task assigned to "${goal.title}"`);
						});
					});
			});
		}

		if (this.data!.goals.length === 0) {
			menu.addItem((item) => {
				item
					.setTitle('No goals yet - add one above')
					.setDisabled(true);
			});
		}

		menu.showAtMouseEvent(e);
	}

	private getGoalTitle(goalId: string): string {
		const goal = this.data!.goals.find(g => g.id === goalId);
		return goal?.title || 'Unknown';
	}

	private getGoalEmoji(goalId: string): string {
		// Return a filled/assigned indicator
		return '✅';
	}

	private async moveTaskToSection(
		task: Task,
		fromSection: TaskSection,
		toSection: TaskSection
	): Promise<void> {
		const fromIndex = this.data!.tasks[fromSection].findIndex(t => t.id === task.id);
		if (fromIndex > -1) {
			this.data!.tasks[fromSection].splice(fromIndex, 1);
		}

		task.section = toSection;
		this.data!.tasks[toSection].push(task);

		await this.plugin.saveTaskData(this.data!);
		this.render();

		// Also refresh the focus view if open
		this.plugin.refreshFocusView();
	}

	onClose(): void {
		const { contentEl } = this;
		contentEl.empty();
		// Refresh focus view when closing planning
		this.plugin.refreshFocusView();
	}
}
