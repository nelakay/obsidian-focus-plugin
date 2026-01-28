import { createDAVClient } from 'tsdav';
import { CalDAVSettings, DiscoveredCalendar } from '../types';

// Type for the client returned by createDAVClient
type DAVClientInstance = Awaited<ReturnType<typeof createDAVClient>>;

/**
 * CalDAV client wrapper for Focus plugin
 * Handles connection, calendar discovery, and VTODO operations
 */
export class CalDAVClient {
	private client: DAVClientInstance | null = null;
	private settings: CalDAVSettings;

	constructor(settings: CalDAVSettings) {
		this.settings = settings;
	}

	/**
	 * Update settings (e.g., when user changes credentials)
	 */
	updateSettings(settings: CalDAVSettings): void {
		this.settings = settings;
		this.client = null; // Force reconnection with new settings
	}

	/**
	 * Establish connection to CalDAV server
	 */
	async connect(): Promise<void> {
		if (!this.settings.username || !this.settings.password) {
			throw new Error('CalDAV credentials not configured');
		}

		if (!this.settings.serverUrl) {
			throw new Error('CalDAV server URL not configured');
		}

		try {
			this.client = await createDAVClient({
				serverUrl: this.settings.serverUrl,
				credentials: {
					username: this.settings.username,
					password: this.settings.password,
				},
				authMethod: 'Basic',
				defaultAccountType: 'caldav',
			});
		} catch (e) {
			const error = e as Error;
			if (error.message?.includes('401') || error.message?.includes('Unauthorized')) {
				throw new Error('Invalid credentials. For iCloud, use an app-specific password.');
			}
			if (error.message?.includes('fetch') || error.message?.includes('network')) {
				throw new Error('Network error. Check your internet connection.');
			}
			throw new Error(`Connection failed: ${error.message}`);
		}
	}

	/**
	 * Test connection and return discovered calendars
	 */
	async testConnection(): Promise<DiscoveredCalendar[]> {
		await this.connect();
		if (!this.client) throw new Error('Client not initialized');

		try {
			const calendars = await this.client.fetchCalendars();
			return calendars.map((cal) => {
				// displayName can be string or Record<string, unknown> depending on tsdav version
				let name: string;
				if (typeof cal.displayName === 'string') {
					name = cal.displayName;
				} else {
					name = cal.url.split('/').filter(Boolean).pop() || 'Unnamed';
				}
				return {
					displayName: name,
					url: cal.url,
				};
			});
		} catch (e) {
			const error = e as Error;
			throw new Error(`Failed to fetch calendars: ${error.message}`);
		}
	}

	/**
	 * Create a VTODO on the calendar
	 */
	async createVTODO(
		calendarUrl: string,
		uid: string,
		vtodoString: string
	): Promise<{ etag: string; url: string }> {
		if (!this.client) await this.connect();

		const filename = `${uid}.ics`;
		const objectUrl = `${calendarUrl.replace(/\/$/, '')}/${filename}`;

		try {
			const response = await this.client!.createCalendarObject({
				calendar: { url: calendarUrl },
				filename,
				iCalString: vtodoString,
			});

			// tsdav returns the response, extract etag if available
			const etag = (response as { etag?: string })?.etag || '';
			return { etag, url: objectUrl };
		} catch (e) {
			const error = e as Error;
			throw new Error(`Failed to create VTODO: ${error.message}`);
		}
	}

	/**
	 * Update an existing VTODO
	 */
	async updateVTODO(
		objectUrl: string,
		vtodoString: string,
		etag: string
	): Promise<{ etag: string }> {
		if (!this.client) await this.connect();

		try {
			const response = await this.client!.updateCalendarObject({
				calendarObject: {
					url: objectUrl,
					etag,
					data: vtodoString,
				},
			});

			const newEtag = (response as { etag?: string })?.etag || etag;
			return { etag: newEtag };
		} catch (e) {
			const error = e as Error;
			// Handle ETag mismatch (412 Precondition Failed)
			if (error.message?.includes('412')) {
				throw new Error('Calendar item was modified. Will retry on next sync.');
			}
			throw new Error(`Failed to update VTODO: ${error.message}`);
		}
	}

	/**
	 * Delete a VTODO from the calendar
	 */
	async deleteVTODO(objectUrl: string, etag?: string): Promise<void> {
		if (!this.client) await this.connect();

		try {
			await this.client!.deleteCalendarObject({
				calendarObject: {
					url: objectUrl,
					etag: etag || '',
				},
			});
		} catch (e) {
			const error = e as Error;
			// Ignore 404 errors (already deleted)
			if (error.message?.includes('404')) {
				return;
			}
			throw new Error(`Failed to delete VTODO: ${error.message}`);
		}
	}

	/**
	 * Fetch all VTODOs from the calendar
	 */
	async fetchVTODOs(calendarUrl: string): Promise<Array<{
		url: string;
		etag: string;
		data: string;
	}>> {
		if (!this.client) await this.connect();

		try {
			const objects = await this.client!.fetchCalendarObjects({
				calendar: { url: calendarUrl },
				filters: {
					'comp-filter': {
						_attributes: { name: 'VCALENDAR' },
						'comp-filter': { _attributes: { name: 'VTODO' } },
					},
				},
			});

			return objects.map((obj) => ({
				url: obj.url,
				etag: obj.etag || '',
				data: obj.data || '',
			}));
		} catch (e) {
			const error = e as Error;
			throw new Error(`Failed to fetch VTODOs: ${error.message}`);
		}
	}

	/**
	 * Check if client is connected
	 */
	isConnected(): boolean {
		return this.client !== null;
	}
}
