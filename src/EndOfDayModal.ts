import { Modal } from 'obsidian';
import { FocusData } from './types';
import type FocusPlugin from './main';

export class EndOfDayModal extends Modal {
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
		contentEl.addClass('focus-end-of-day-modal');

		if (!this.data) return;

		// Header
		contentEl.createEl('h2', { text: 'End of day review' });

		const today = new Date().toLocaleDateString('en-US', {
			weekday: 'long',
			month: 'short',
			day: 'numeric',
		});
		contentEl.createEl('p', { text: today, cls: 'focus-date-subtitle' });

		// Immediate tasks summary
		const immediateTasks = this.data.tasks.immediate;
		const completedImmediate = immediateTasks.filter(t => t.completed);
		const incompleteImmediate = immediateTasks.filter(t => !t.completed);

		// Progress section
		const progressSection = contentEl.createEl('div', { cls: 'focus-review-section' });
		progressSection.createEl('h3', { text: 'Today\'s focus' });

		if (immediateTasks.length === 0) {
			progressSection.createEl('p', {
				text: 'No tasks were in your immediate focus today.',
				cls: 'focus-empty-state',
			});
		} else {
			const progressText = `${completedImmediate.length}/${immediateTasks.length} tasks completed`;
			progressSection.createEl('p', { text: progressText, cls: 'focus-progress-text' });

			// List completed tasks
			if (completedImmediate.length > 0) {
				const completedList = progressSection.createEl('div', { cls: 'focus-completed-list' });
				completedList.createEl('h4', { text: 'Completed' });
				for (const task of completedImmediate) {
					completedList.createEl('div', {
						text: `✓ ${task.title}`,
						cls: 'focus-completed-task',
					});
				}
			}

			// List incomplete tasks
			if (incompleteImmediate.length > 0) {
				const incompleteList = progressSection.createEl('div', { cls: 'focus-incomplete-list' });
				incompleteList.createEl('h4', { text: 'Still pending' });
				for (const task of incompleteImmediate) {
					const taskRow = incompleteList.createEl('div', { cls: 'focus-incomplete-task-row' });
					taskRow.createEl('span', { text: `○ ${task.title}` });

					// Quick complete button
					const completeBtn = taskRow.createEl('button', {
						text: 'Complete',
						cls: 'focus-quick-complete-btn',
					});
					completeBtn.addEventListener('click', () => {
						task.completed = true;
						void this.plugin.saveTaskData(this.data!).then(() => {
							// Sync completion to source file if task came from vault
							if (task.sourceFile) {
								void this.plugin.syncTaskCompletionToSource(task);
							}
							this.plugin.refreshFocusView();
							this.render();
						});
					});
				}
			}
		}

		// Motivational message based on completion
		const messageSection = contentEl.createEl('div', { cls: 'focus-review-message' });
		if (immediateTasks.length === 0) {
			messageSection.createEl('p', { text: 'Plan your focus for tomorrow!' });
		} else if (completedImmediate.length === immediateTasks.length) {
			messageSection.createEl('p', { text: 'Great job! You completed everything.' });
		} else if (completedImmediate.length >= immediateTasks.length / 2) {
			messageSection.createEl('p', { text: 'You did amazing today! The rest can wait until tomorrow.' });
		} else {
			messageSection.createEl('p', { text: 'Every step counts. Tomorrow is a new day.' });
		}

		// Actions
		const actionsEl = contentEl.createEl('div', { cls: 'focus-review-actions' });

		const doneBtn = actionsEl.createEl('button', {
			text: 'Done',
			cls: 'mod-cta',
		});
		doneBtn.addEventListener('click', () => this.close());
	}

	onClose(): void {
		const { contentEl } = this;
		contentEl.empty();
	}
}
