import { App, PluginSettingTab, Setting, Hotkey, AbstractInputSuggest, TFolder, Notice } from 'obsidian';
import { DAY_NAMES, DayOfWeek, COMMAND_IDS, VaultSyncMode, CalDAVProvider, ReminderOffset, DiscoveredCalendar } from './types';
import type FocusPlugin from './main';

/**
 * File path suggester that shows existing files and folders as you type
 */
class FilePathSuggest extends AbstractInputSuggest<string> {
	private textInputEl: HTMLInputElement;

	constructor(app: App, inputEl: HTMLInputElement) {
		super(app, inputEl);
		this.textInputEl = inputEl;
	}

	getSuggestions(inputStr: string): string[] {
		const suggestions: string[] = [];
		const lowerInput = inputStr.toLowerCase();

		// Get all markdown files
		const files = this.app.vault.getMarkdownFiles();
		for (const file of files) {
			if (file.path.toLowerCase().includes(lowerInput)) {
				suggestions.push(file.path);
			}
		}

		// Also suggest folders (user might want to create a new file in a folder)
		const folders = this.app.vault.getAllLoadedFiles().filter(f => f instanceof TFolder) as TFolder[];
		for (const folder of folders) {
			if (folder.path && folder.path.toLowerCase().includes(lowerInput)) {
				// Suggest folder path with a trailing slash to indicate it's a folder
				suggestions.push(folder.path + '/');
			}
		}

		// Sort suggestions - exact matches first, then by length
		suggestions.sort((a, b) => {
			const aStartsWith = a.toLowerCase().startsWith(lowerInput);
			const bStartsWith = b.toLowerCase().startsWith(lowerInput);
			if (aStartsWith && !bStartsWith) return -1;
			if (!aStartsWith && bStartsWith) return 1;
			return a.length - b.length;
		});

		return suggestions.slice(0, 10); // Limit to 10 suggestions
	}

	renderSuggestion(value: string, el: HTMLElement): void {
		el.setText(value);
	}

	selectSuggestion(value: string): void {
		this.textInputEl.value = value;
		this.textInputEl.trigger('input');
		this.close();
	}
}

export class FocusSettingTab extends PluginSettingTab {
	plugin: FocusPlugin;

	constructor(app: App, plugin: FocusPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		// ===== HOTKEYS SECTION =====
		this.renderHotkeysSection(containerEl);

		// ===== TASK SETTINGS =====
		new Setting(containerEl).setName('Tasks').setHeading();

		new Setting(containerEl)
			.setName('Task file path')
			.setDesc('The path to the markdown file that stores your tasks. Select an existing file or type a new path.')
			.addText((text) => {
				text
					.setPlaceholder('focus-tasks.md')
					.setValue(this.plugin.settings.taskFilePath)
					.onChange(async (value) => {
						let newPath = value || 'focus-tasks.md';
						// Ensure .md extension (unless it's just a folder path ending with /)
						if (!newPath.endsWith('.md') && !newPath.endsWith('/')) {
							newPath = newPath + '.md';
						}
						// If it ends with /, append a default filename
						if (newPath.endsWith('/')) {
							newPath = newPath + 'focus-tasks.md';
						}

						this.plugin.settings.taskFilePath = newPath;
						await this.plugin.saveSettings();
						this.plugin.refreshFocusView();
					});

				// Add file path suggestions
				new FilePathSuggest(this.app, text.inputEl);
			});

		new Setting(containerEl)
			.setName('Maximum immediate tasks')
			.setDesc('Maximum number of tasks allowed in the immediate section (3-5 recommended)')
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
			.setDesc('Pull tasks from other notes in your vault into the unscheduled backlog')
			.addDropdown((dropdown) =>
				dropdown
					.addOption('off', 'Off - only use the Focus task file')
					.addOption('all', 'All - sync all tasks from vault')
					.addOption('tag', 'Tag - only sync tasks with a specific tag')
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
				.setDesc('Manually scan vault for tasks and add to unscheduled')
				.addButton((button) =>
					button
						.setButtonText('Sync tasks')
						.setCta()
						.onClick(() => {
							button.setButtonText('Syncing...');
							button.setDisabled(true);
							void this.plugin.syncVaultTasks().then(() => {
								button.setButtonText('Sync tasks');
								button.setDisabled(false);
							});
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
			.setName('Roll over immediate → this week')
			.setDesc('Move incomplete immediate tasks to this week on planning day')
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.rolloverImmediateToThisWeek)
					.onChange(async (value) => {
						this.plugin.settings.rolloverImmediateToThisWeek = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName('Roll over this week → unscheduled')
			.setDesc('Move incomplete this week tasks to unscheduled on planning day')
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.rolloverThisWeekToUnscheduled)
					.onChange(async (value) => {
						this.plugin.settings.rolloverThisWeekToUnscheduled = value;
						await this.plugin.saveSettings();
					})
			);

		// ===== PERIODIC NOTES SECTION =====
		new Setting(containerEl).setName('Periodic notes').setHeading();

		new Setting(containerEl)
			.setName('Daily notes folder')
			.setDesc('Folder where daily notes are stored (leave empty for vault root)')
			.addText((text) =>
				text
					.setPlaceholder('daily-notes/')
					.setValue(this.plugin.settings.dailyNotesFolder)
					.onChange(async (value) => {
						this.plugin.settings.dailyNotesFolder = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName('Daily notes format')
			.setDesc('Date format for daily note filenames (e.g., YYYY-MM-DD)')
			.addText((text) =>
				text
					.setPlaceholder('YYYY-MM-DD')
					.setValue(this.plugin.settings.dailyNotesFormat)
					.onChange(async (value) => {
						this.plugin.settings.dailyNotesFormat = value || 'YYYY-MM-DD';
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName('Daily notes template')
			.setDesc('Path to template file for new daily notes (leave empty for no template)')
			.addText((text) => {
				text
					.setPlaceholder('Templates/Daily.md')
					.setValue(this.plugin.settings.dailyNotesTemplate)
					.onChange(async (value) => {
						this.plugin.settings.dailyNotesTemplate = value;
						await this.plugin.saveSettings();
					});
				new FilePathSuggest(this.app, text.inputEl);
			});

		new Setting(containerEl)
			.setName('Weekly notes folder')
			.setDesc('Folder where weekly notes are stored (leave empty for vault root)')
			.addText((text) =>
				text
					.setPlaceholder('weekly-notes/')
					.setValue(this.plugin.settings.weeklyNotesFolder)
					.onChange(async (value) => {
						this.plugin.settings.weeklyNotesFolder = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName('Weekly notes format')
			.setDesc('Date format for weekly note filenames (e.g., YYYY-[W]WW)')
			.addText((text) =>
				text
					.setPlaceholder('YYYY-[W]WW')
					.setValue(this.plugin.settings.weeklyNotesFormat)
					.onChange(async (value) => {
						this.plugin.settings.weeklyNotesFormat = value || 'YYYY-[W]WW';
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName('Weekly notes template')
			.setDesc('Path to template file for new weekly notes (leave empty for no template)')
			.addText((text) => {
				text
					.setPlaceholder('Templates/Weekly.md')
					.setValue(this.plugin.settings.weeklyNotesTemplate)
					.onChange(async (value) => {
						this.plugin.settings.weeklyNotesTemplate = value;
						await this.plugin.saveSettings();
					});
				new FilePathSuggest(this.app, text.inputEl);
			});

		// ===== CALENDAR INTEGRATION SECTION =====
		this.renderCalDAVSection(containerEl);

		// ===== ABOUT SECTION =====
		new Setting(containerEl)
			.setName('About')
			.setDesc('Focus is a visibility firewall for your tasks. It helps you focus on what matters now by hiding everything else.')
			.setHeading();
	}

	private discoveredCalendars: DiscoveredCalendar[] = [];

	private renderCalDAVSection(containerEl: HTMLElement): void {
		new Setting(containerEl).setName('Calendar integration').setHeading();

		// Enable toggle
		new Setting(containerEl)
			.setName('Enable CalDAV sync')
			.setDesc('Sync tasks with do dates to your calendar as reminders')
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.caldav.enabled)
					.onChange(async (value) => {
						this.plugin.settings.caldav.enabled = value;
						await this.plugin.saveSettings();
						this.display(); // Re-render to show/hide options
					})
			);

		if (!this.plugin.settings.caldav.enabled) return;

		// Provider dropdown
		new Setting(containerEl)
			.setName('Calendar provider')
			.setDesc('Select your calendar service')
			.addDropdown((dropdown) =>
				dropdown
					.addOption('icloud', 'iCloud')
					.addOption('fastmail', 'Fastmail')
					.addOption('custom', 'Custom CalDAV server')
					.setValue(this.plugin.settings.caldav.provider)
					.onChange(async (value: CalDAVProvider) => {
						this.plugin.settings.caldav.provider = value;
						// Auto-fill server URL based on provider
						if (value === 'icloud') {
							this.plugin.settings.caldav.serverUrl = 'https://caldav.icloud.com';
						} else if (value === 'fastmail') {
							this.plugin.settings.caldav.serverUrl = 'https://caldav.fastmail.com';
						}
						await this.plugin.saveSettings();
						this.display();
					})
			);

		// Server URL (only show for custom)
		if (this.plugin.settings.caldav.provider === 'custom') {
			new Setting(containerEl)
				.setName('Server URL')
				.setDesc('CalDAV server URL')
				.addText((text) =>
					text
						.setPlaceholder('https://caldav.example.com')
						.setValue(this.plugin.settings.caldav.serverUrl)
						.onChange(async (value) => {
							this.plugin.settings.caldav.serverUrl = value;
							await this.plugin.saveSettings();
						})
				);
		}

		// Username
		new Setting(containerEl)
			.setName('Username')
			.setDesc(this.plugin.settings.caldav.provider === 'icloud' ? 'Your Apple ID email' : 'Your account email')
			.addText((text) =>
				text
					.setPlaceholder('email@example.com')
					.setValue(this.plugin.settings.caldav.username)
					.onChange(async (value) => {
						this.plugin.settings.caldav.username = value;
						await this.plugin.saveSettings();
					})
			);

		// Password
		const passwordDesc = this.plugin.settings.caldav.provider === 'icloud'
			? 'App-specific password (generate at appleid.apple.com)'
			: 'Your account password or app-specific password';
		new Setting(containerEl)
			.setName('Password')
			.setDesc(passwordDesc)
			.addText((text) => {
				text.inputEl.type = 'password';
				text
					.setPlaceholder('••••••••')
					.setValue(this.plugin.settings.caldav.password)
					.onChange(async (value) => {
						this.plugin.settings.caldav.password = value;
						await this.plugin.saveSettings();
					});
			});

		// Test connection button
		new Setting(containerEl)
			.setName('Test connection')
			.setDesc('Verify credentials and discover calendars')
			.addButton((button) =>
				button
					.setButtonText('Test Connection')
					.setCta()
					.onClick(async () => {
						button.setButtonText('Connecting...');
						button.setDisabled(true);
						try {
							this.discoveredCalendars = await this.plugin.testCalDAVConnection();
							new Notice(`Found ${this.discoveredCalendars.length} calendar(s)`);
							this.display(); // Re-render to show calendar dropdown
						} catch (e) {
							const error = e as Error;
							new Notice(`Connection failed: ${error.message}`);
						} finally {
							button.setButtonText('Test Connection');
							button.setDisabled(false);
						}
					})
			);

		// Calendar selection (only show if we have discovered calendars or a saved selection)
		if (this.discoveredCalendars.length > 0 || this.plugin.settings.caldav.selectedCalendarUrl) {
			new Setting(containerEl)
				.setName('Calendar')
				.setDesc('Select which calendar to sync tasks to')
				.addDropdown((dropdown) => {
					// Add discovered calendars
					for (const cal of this.discoveredCalendars) {
						dropdown.addOption(cal.url, cal.displayName);
					}
					// If we have a saved selection but no discovered calendars, show it
					if (this.discoveredCalendars.length === 0 && this.plugin.settings.caldav.selectedCalendarUrl) {
						dropdown.addOption(
							this.plugin.settings.caldav.selectedCalendarUrl,
							this.plugin.settings.caldav.selectedCalendarName || 'Selected calendar'
						);
					}
					dropdown
						.setValue(this.plugin.settings.caldav.selectedCalendarUrl)
						.onChange(async (value) => {
							this.plugin.settings.caldav.selectedCalendarUrl = value;
							// Save the display name too
							const cal = this.discoveredCalendars.find(c => c.url === value);
							this.plugin.settings.caldav.selectedCalendarName = cal?.displayName || '';
							await this.plugin.saveSettings();
						});
				});
		}

		// Reminder offset
		new Setting(containerEl)
			.setName('Default reminder')
			.setDesc('How long before the scheduled time to show a reminder')
			.addDropdown((dropdown) =>
				dropdown
					.addOption('0', 'At time of event')
					.addOption('5', '5 minutes before')
					.addOption('15', '15 minutes before')
					.addOption('30', '30 minutes before')
					.addOption('60', '1 hour before')
					.setValue(this.plugin.settings.caldav.defaultReminderOffset.toString())
					.onChange(async (value) => {
						this.plugin.settings.caldav.defaultReminderOffset = parseInt(value) as ReminderOffset;
						await this.plugin.saveSettings();
					})
			);

		// Sync interval
		new Setting(containerEl)
			.setName('Sync interval')
			.setDesc('How often to sync with calendar (in minutes)')
			.addDropdown((dropdown) =>
				dropdown
					.addOption('1', 'Every minute')
					.addOption('5', 'Every 5 minutes')
					.addOption('15', 'Every 15 minutes')
					.addOption('30', 'Every 30 minutes')
					.setValue(this.plugin.settings.caldav.syncIntervalMinutes.toString())
					.onChange(async (value) => {
						this.plugin.settings.caldav.syncIntervalMinutes = parseInt(value);
						await this.plugin.saveSettings();
						this.plugin.rescheduleCalDAVSync();
					})
			);
	}

	private renderHotkeysSection(containerEl: HTMLElement): void {
		new Setting(containerEl).setName('Keyboard shortcuts').setHeading();

		const commands = [
			{ id: COMMAND_IDS.openFocusView, name: 'Open view' },
			{ id: COMMAND_IDS.openPlanningView, name: 'Open planning' },
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
						.setButtonText('Set hotkey')
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
