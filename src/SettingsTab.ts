import { App, PluginSettingTab, Setting, Hotkey } from 'obsidian';
import { DAY_NAMES, DayOfWeek, COMMAND_IDS, VaultSyncMode } from './types';
import type FocusPlugin from './main';

export class FocusSettingTab extends PluginSettingTab {
	plugin: FocusPlugin;

	constructor(app: App, plugin: FocusPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		new Setting(containerEl).setName('Focus settings').setHeading();

		// ===== HOTKEYS SECTION =====
		this.renderHotkeysSection(containerEl);

		// ===== TASK SETTINGS =====
		new Setting(containerEl).setName('Task settings').setHeading();

		new Setting(containerEl)
			.setName('Task file path')
			.setDesc('Path to the markdown file that stores your tasks (relative to vault root)')
			.addText((text) =>
				text
					.setPlaceholder('Focus/tasks.md')
					.setValue(this.plugin.settings.taskFilePath)
					.onChange(async (value) => {
						this.plugin.settings.taskFilePath = value || 'Focus/tasks.md';
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName('Maximum immediate tasks')
			.setDesc('Maximum number of tasks allowed in the Immediate section (3-5 recommended)')
			.addSlider((slider) =>
				slider
					.setLimits(1, 7, 1)
					.setValue(this.plugin.settings.maxImmediateTasks)
					.setDynamicTooltip()
					.onChange(async (value) => {
						this.plugin.settings.maxImmediateTasks = value;
						await this.plugin.saveSettings();
						this.plugin.refreshFocusView();
					})
			);

		// ===== VAULT SYNC SECTION =====
		new Setting(containerEl).setName('Vault task sync').setHeading();

		new Setting(containerEl)
			.setName('Sync tasks from vault')
			.setDesc('Pull tasks from other notes in your vault into the Unscheduled backlog')
			.addDropdown((dropdown) =>
				dropdown
					.addOption('off', 'Off - Only use Focus task file')
					.addOption('all', 'All - Sync all tasks from vault')
					.addOption('tag', 'Tag - Only sync tasks with a specific tag')
					.setValue(this.plugin.settings.vaultSyncMode)
					.onChange(async (value: VaultSyncMode) => {
						this.plugin.settings.vaultSyncMode = value;
						await this.plugin.saveSettings();
						// Re-render to show/hide tag input
						this.display();
					})
			);

		// Show tag input only when tag mode is selected
		if (this.plugin.settings.vaultSyncMode === 'tag') {
			new Setting(containerEl)
				.setName('Sync tag')
				.setDesc('Only tasks containing this tag will be synced (e.g., #focus)')
				.addText((text) =>
					text
						.setPlaceholder('#focus')
						.setValue(this.plugin.settings.vaultSyncTag)
						.onChange(async (value) => {
							// Ensure it starts with #
							if (value && !value.startsWith('#')) {
								value = '#' + value;
							}
							this.plugin.settings.vaultSyncTag = value || '#focus';
							await this.plugin.saveSettings();
						})
				);
		}

		// Sync button (only show if sync is enabled)
		if (this.plugin.settings.vaultSyncMode !== 'off') {
			new Setting(containerEl)
				.setName('Sync now')
				.setDesc('Manually scan vault for tasks and add to Unscheduled')
				.addButton((button) =>
					button
						.setButtonText('Sync Tasks')
						.setCta()
						.onClick(async () => {
							button.setButtonText('Syncing...');
							button.setDisabled(true);
							const count = await this.plugin.syncVaultTasks();
							button.setButtonText('Sync Tasks');
							button.setDisabled(false);
						})
				);
		}

		// ===== REMINDERS SECTION =====
		new Setting(containerEl).setName('Reminders').setHeading();

		new Setting(containerEl)
			.setName('Weekly planning reminder')
			.setDesc('Show a reminder to do weekly planning')
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.planningReminderEnabled)
					.onChange(async (value) => {
						this.plugin.settings.planningReminderEnabled = value;
						await this.plugin.saveSettings();
						// Re-render to show/hide day dropdown
						this.display();
					})
			);

		if (this.plugin.settings.planningReminderEnabled) {
			new Setting(containerEl)
				.setName('Planning day')
				.setDesc('Which day to show the planning reminder')
				.addDropdown((dropdown) => {
					for (let i = 0; i <= 6; i++) {
						dropdown.addOption(i.toString(), DAY_NAMES[i as DayOfWeek]);
					}
					dropdown
						.setValue(this.plugin.settings.planningReminderDay.toString())
						.onChange(async (value) => {
							this.plugin.settings.planningReminderDay = parseInt(value) as DayOfWeek;
							await this.plugin.saveSettings();
						});
				});
		}

		new Setting(containerEl)
			.setName('End of day review')
			.setDesc('Show a reminder to review your day')
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.endOfDayReviewEnabled)
					.onChange(async (value) => {
						this.plugin.settings.endOfDayReviewEnabled = value;
						await this.plugin.saveSettings();
						this.display();
					})
			);

		if (this.plugin.settings.endOfDayReviewEnabled) {
			new Setting(containerEl)
				.setName('Review time')
				.setDesc('When to show the end of day review prompt (24h format)')
				.addText((text) =>
					text
						.setPlaceholder('21:00')
						.setValue(this.plugin.settings.endOfDayReviewTime)
						.onChange(async (value) => {
							// Validate HH:MM format
							if (/^([01]?[0-9]|2[0-3]):[0-5][0-9]$/.test(value)) {
								this.plugin.settings.endOfDayReviewTime = value;
								await this.plugin.saveSettings();
								this.plugin.scheduleEndOfDayReview();
							}
						})
				);
		}

		// ===== ROLLOVER SECTION =====
		new Setting(containerEl)
			.setName('Weekly rollover')
			.setDesc('What happens to incomplete tasks when a new week starts')
			.setHeading();

		new Setting(containerEl)
			.setName('Roll over Immediate → This Week')
			.setDesc('Move incomplete Immediate tasks to This Week on planning day')
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.rolloverImmediateToThisWeek)
					.onChange(async (value) => {
						this.plugin.settings.rolloverImmediateToThisWeek = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName('Roll over This Week → Unscheduled')
			.setDesc('Move incomplete This Week tasks to Unscheduled on planning day')
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.rolloverThisWeekToUnscheduled)
					.onChange(async (value) => {
						this.plugin.settings.rolloverThisWeekToUnscheduled = value;
						await this.plugin.saveSettings();
					})
			);

		// ===== ABOUT SECTION =====
		new Setting(containerEl)
			.setName('About')
			.setDesc('Focus is a visibility firewall for your tasks. It helps you focus on what matters NOW by hiding everything else.')
			.setHeading();
	}

	private renderHotkeysSection(containerEl: HTMLElement): void {
		new Setting(containerEl).setName('Hotkeys').setHeading();

		const commands = [
			{ id: COMMAND_IDS.openFocusView, name: 'Open focus view' },
			{ id: COMMAND_IDS.openPlanningView, name: 'Open planning view' },
			{ id: COMMAND_IDS.quickAddTask, name: 'Quick add task' },
		];

		for (const cmd of commands) {
			const hotkey = this.getHotkeyForCommand(cmd.id);
			const hotkeyText = hotkey ? this.formatHotkey(hotkey) : 'Not set';

			new Setting(containerEl)
				.setName(cmd.name)
				.setDesc(hotkeyText)
				.addButton((button) =>
					button
						.setButtonText('Set Hotkey')
						.onClick(() => {
							// Open Obsidian's hotkey settings and search for this command
							// @ts-ignore - accessing internal API
							this.app.setting.openTabById('hotkeys');
							// @ts-ignore
							const hotkeyTab = this.app.setting.activeTab;
							if (hotkeyTab && hotkeyTab.searchComponent) {
								hotkeyTab.searchComponent.setValue('Focus:');
								hotkeyTab.updateHotkeyVisibility();
							}
						})
				);
		}
	}

	private getHotkeyForCommand(commandId: string): Hotkey | null {
		// @ts-ignore - accessing internal API
		const customKeys = this.app.hotkeyManager?.customKeys || {};
		const hotkeys = customKeys[commandId];
		if (hotkeys && hotkeys.length > 0) {
			return hotkeys[0];
		}
		return null;
	}

	private formatHotkey(hotkey: Hotkey): string {
		const parts: string[] = [];
		if (hotkey.modifiers.includes('Mod')) {
			parts.push('⌘');
		}
		if (hotkey.modifiers.includes('Ctrl')) {
			parts.push('⌃');
		}
		if (hotkey.modifiers.includes('Alt')) {
			parts.push('⌥');
		}
		if (hotkey.modifiers.includes('Shift')) {
			parts.push('⇧');
		}
		parts.push(hotkey.key.toUpperCase());
		return parts.join(' ');
	}
}
