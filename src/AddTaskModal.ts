import { Modal, Setting } from 'obsidian';
import { TaskSection } from './types';
import type FocusPlugin from './main';

export class AddTaskModal extends Modal {
	plugin: FocusPlugin;
	defaultToThisWeek: boolean;
	taskTitle: string = '';
	addToThisWeek: boolean;
	onSubmit: (title: string, section: TaskSection) => void;

	constructor(
		plugin: FocusPlugin,
		defaultToThisWeek: boolean,
		onSubmit: (title: string, section: TaskSection) => void
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

		contentEl.createEl('h2', { text: 'Add Task' });

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
			.setName('Add to This Week')
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
					.setButtonText('Add Task')
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
		this.onSubmit(this.taskTitle.trim(), section);
		this.close();
	}

	onClose(): void {
		const { contentEl } = this;
		contentEl.empty();
	}
}
