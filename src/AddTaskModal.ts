import { Modal, Setting } from 'obsidian';
import { TaskSection } from './types';
import type FocusPlugin from './main';

export class AddTaskModal extends Modal {
	plugin: FocusPlugin;
	defaultToThisWeek: boolean;
	taskTitle: string = '';
	taskUrl: string = '';
	taskDoDate: string = '';
	taskDoTime: string = '';
	addToThisWeek: boolean;
	onSubmit: (title: string, section: TaskSection, url?: string, doDate?: string, doTime?: string) => void;

	constructor(
		plugin: FocusPlugin,
		defaultToThisWeek: boolean,
		onSubmit: (title: string, section: TaskSection, url?: string, doDate?: string, doTime?: string) => void
	) {
		super(plugin.app);
		this.plugin = plugin;
		this.defaultToThisWeek = defaultToThisWeek;
		this.addToThisWeek = defaultToThisWeek;
		this.onSubmit = onSubmit;
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass('focus-add-task-modal');

		contentEl.createEl('h2', { text: 'Add task' });

		new Setting(contentEl)
			.setName('Task')
			.addText((text) => {
				text
					.setPlaceholder('What needs to be done?')
					.onChange((value) => {
						this.taskTitle = value;
					});
				text.inputEl.addEventListener('keydown', (e) => {
					if (e.key === 'Enter' && this.taskTitle.trim()) {
						this.submit();
					}
				});
				// Auto focus
				setTimeout(() => text.inputEl.focus(), 10);
			});

		new Setting(contentEl)
			.setName('URL')
			.setDesc('Optional link for this task')
			.addText((text) => {
				text
					.setPlaceholder('https://...')
					.onChange((value) => {
						this.taskUrl = value;
					});
			});

		// Do date setting with quick buttons
		const doDateSetting = new Setting(contentEl)
			.setName('Reminder date')
			.setDesc('When to be reminded about this task');

		// Add quick-set buttons
		const quickButtonsContainer = doDateSetting.controlEl.createDiv('focus-quick-date-buttons');

		const todayBtn = quickButtonsContainer.createEl('button', { text: 'Today', cls: 'focus-quick-date-btn' });
		todayBtn.addEventListener('click', () => {
			const today = new Date().toISOString().split('T')[0];
			this.taskDoDate = today;
			dateInput.value = today;
		});

		const tomorrowBtn = quickButtonsContainer.createEl('button', { text: 'Tomorrow', cls: 'focus-quick-date-btn' });
		tomorrowBtn.addEventListener('click', () => {
			const tomorrow = new Date();
			tomorrow.setDate(tomorrow.getDate() + 1);
			const dateStr = tomorrow.toISOString().split('T')[0];
			this.taskDoDate = dateStr;
			dateInput.value = dateStr;
		});

		const nextWeekBtn = quickButtonsContainer.createEl('button', { text: 'Next week', cls: 'focus-quick-date-btn' });
		nextWeekBtn.addEventListener('click', () => {
			const nextWeek = new Date();
			nextWeek.setDate(nextWeek.getDate() + 7);
			const dateStr = nextWeek.toISOString().split('T')[0];
			this.taskDoDate = dateStr;
			dateInput.value = dateStr;
		});

		const dateInput = doDateSetting.controlEl.createEl('input', {
			type: 'date',
			cls: 'focus-date-input'
		});
		dateInput.addEventListener('change', (e) => {
			this.taskDoDate = (e.target as HTMLInputElement).value;
		});

		// Do time setting
		new Setting(contentEl)
			.setName('Reminder time')
			.setDesc('Optional time for the reminder')
			.addText((text) => {
				text.inputEl.type = 'time';
				text.inputEl.addClass('focus-time-input');
				text.onChange((value) => {
					this.taskDoTime = value;
				});
			});

		new Setting(contentEl)
			.setName('Add to this week')
			.setDesc('Schedule this task for the current week')
			.addToggle((toggle) => {
				toggle
					.setValue(this.addToThisWeek)
					.onChange((value) => {
						this.addToThisWeek = value;
					});
			});

		new Setting(contentEl)
			.addButton((btn) => {
				btn
					.setButtonText('Add task')
					.setCta()
					.onClick(() => {
						if (this.taskTitle.trim()) {
							this.submit();
						}
					});
			})
			.addButton((btn) => {
				btn
					.setButtonText('Cancel')
					.onClick(() => {
						this.close();
					});
			});
	}

	private submit(): void {
		const section: TaskSection = this.addToThisWeek ? 'thisWeek' : 'unscheduled';
		const url = this.taskUrl.trim() || undefined;
		const doDate = this.taskDoDate || undefined;
		const doTime = this.taskDoTime || undefined;
		this.onSubmit(this.taskTitle.trim(), section, url, doDate, doTime);
		this.close();
	}

	onClose(): void {
		const { contentEl } = this;
		contentEl.empty();
	}
}
