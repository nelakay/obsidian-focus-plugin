import { Modal, Setting } from 'obsidian';
import { TaskSection } from './types';
import type FocusPlugin from './main';

export class AddTaskModal extends Modal {
	plugin: FocusPlugin;
	defaultToThisWeek: boolean;
	taskTitle: string = '';
	taskUrl: string = '';
	addToThisWeek: boolean;
	onSubmit: (title: string, section: TaskSection, url?: string) => void;

	constructor(
		plugin: FocusPlugin,
		defaultToThisWeek: boolean,
		onSubmit: (title: string, section: TaskSection, url?: string) => void
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
		this.onSubmit(this.taskTitle.trim(), section, url);
		this.close();
	}

	onClose(): void {
		const { contentEl } = this;
		contentEl.empty();
	}
}
