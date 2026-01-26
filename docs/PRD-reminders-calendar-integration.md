# PRD: Reminders & Calendar Integration

**Version:** 1.0
**Date:** 2026-01-26
**Status:** Draft

---

## Overview

This document outlines the requirements for adding reminder capabilities and calendar integration to the Obsidian Focus plugin. The goal is to enable users to schedule tasks with specific "do dates" (reminder dates), have those tasks appear on their calendar, and receive notifications at the scheduled time.

---

## Problem Statement

Currently, the Focus plugin manages tasks across three sections (Immediate, This Week, Unscheduled) but lacks:

1. **Time-based scheduling** - No way to specify when a task should be done
2. **Reminder notifications** - No alerts when it's time to work on a task
3. **Calendar visibility** - Tasks don't appear alongside other commitments
4. **External capture** - No way to add tasks from outside Obsidian (e.g., Slack)
5. **Periodic review integration** - No connection to daily/weekly notes for reviews

---

## Goals

| Goal | Success Metric |
|------|----------------|
| Users can schedule tasks for specific dates/times | 100% of tasks support optional do dates |
| Users receive notifications at scheduled times | Notifications delivered via calendar app |
| Tasks appear on user's calendar (BusyCal, etc.) | Bi-directional sync with < 5 min latency |
| Users can capture tasks from Slack | Tasks created within 30 seconds of Slack message |
| Daily/weekly reviews link to periodic notes | One-click open/create for daily/weekly notes |

---

## Non-Goals

- Full bi-directional calendar sync (moving tasks on calendar does NOT update Obsidian do date)
- Support for all calendar applications (focusing on CalDAV-compatible apps)
- Recurring tasks (future enhancement)
- Task duration customization beyond 30-minute default (future enhancement)
- Multi-user/team task sharing

---

## Features

### Feature 1: Do Dates

**Description:**
Add optional "do date" and "do time" fields to tasks. A do date represents when the user wants to be reminded to work on the task, not a deadline.

**User Stories:**
- As a user, I want to set a specific date and time for a task so I'm reminded when to do it
- As a user, I want to see which tasks are scheduled for today
- As a user, I want tasks without do dates to remain in their current sections

**Requirements:**

| ID | Requirement | Priority |
|----|-------------|----------|
| DD-1 | Add `doDate` (ISO date string) field to Task interface | P0 |
| DD-2 | Add `doTime` (HH:MM format) field to Task interface | P0 |
| DD-3 | Update markdown parser to serialize/deserialize do dates | P0 |
| DD-4 | Add date picker UI in AddTaskModal | P0 |
| DD-5 | Add date picker UI in PlanningModal task editing | P0 |
| DD-6 | Display do date/time in FocusView task list | P0 |
| DD-7 | Support natural language date input (e.g., "tomorrow", "next Monday") | P1 |
| DD-8 | Sort tasks by do date within each section | P1 |
| DD-9 | Visual indicator for overdue tasks (do date in past) | P1 |
| DD-10 | Quick-set buttons for common dates (Today, Tomorrow, Next Week) | P2 |

**Markdown Format:**
```markdown
- [ ] Task title 📅 2026-01-27 ⏰ 14:30
- [ ] Task without time 📅 2026-01-27
- [ ] Task without do date
```

**Data Model Change:**
```typescript
interface Task {
  id: string;
  title: string;
  completed: boolean;
  section: TaskSection;
  url?: string;
  doDate?: string;    // ISO date: "2026-01-27"
  doTime?: string;    // 24h time: "14:30"
  // existing fields...
}
```

---

### Feature 2: Periodic Notes Integration

**Description:**
Enable the End of Day and Planning modals to open or create daily/weekly notes for review purposes.

**User Stories:**
- As a user, I want to open today's daily note from the End of Day modal to journal my reflections
- As a user, I want to create a new daily note if one doesn't exist
- As a user, I want to open this week's note from the Planning modal to review weekly goals
- As a user, I want the plugin to respect my existing periodic notes folder structure

**Requirements:**

| ID | Requirement | Priority |
|----|-------------|----------|
| PN-1 | Add settings for daily note folder path | P0 |
| PN-2 | Add settings for daily note filename format (e.g., `YYYY-MM-DD`) | P0 |
| PN-3 | Add settings for weekly note folder path | P0 |
| PN-4 | Add settings for weekly note filename format (e.g., `YYYY-[W]WW`) | P0 |
| PN-5 | Add "Open Daily Note" button to EndOfDayModal | P0 |
| PN-6 | Create daily note from template if it doesn't exist | P0 |
| PN-7 | Add "Open Weekly Note" button to PlanningModal | P0 |
| PN-8 | Create weekly note from template if it doesn't exist | P0 |
| PN-9 | Auto-detect settings from Obsidian Daily Notes plugin if installed | P1 |
| PN-10 | Auto-detect settings from Periodic Notes community plugin if installed | P1 |
| PN-11 | Add optional daily/weekly note template paths in settings | P2 |

**Settings UI:**
```
Periodic Notes
├── Daily Notes
│   ├── Folder: [daily-notes/]
│   ├── Format: [YYYY-MM-DD]
│   └── Template: [templates/daily.md] (optional)
└── Weekly Notes
    ├── Folder: [weekly-notes/]
    ├── Format: [YYYY-[W]WW]
    └── Template: [templates/weekly.md] (optional)
```

---

### Feature 3: CalDAV Calendar Integration (BusyCal)

**Description:**
Sync tasks with do dates to CalDAV-compatible calendar applications (BusyCal, Fantastical, Apple Calendar via iCloud) as VTODO items. Tasks appear on the calendar grid at their scheduled time and completion status syncs bidirectionally.

**User Stories:**
- As a user, I want my scheduled tasks to appear on my BusyCal calendar
- As a user, I want to receive calendar notifications at the task's do time
- As a user, I want to mark a task complete in BusyCal and have it sync to Obsidian
- As a user, I want tasks to show as 30-minute blocks on my calendar
- As a user, I want to rearrange tasks on my calendar without affecting the Obsidian do date

**Requirements:**

#### Tier 1: Read (Obsidian → Calendar)

| ID | Requirement | Priority |
|----|-------------|----------|
| CAL-1 | Add CalDAV account settings (server URL, username, password) | P0 |
| CAL-2 | Implement CalDAV authentication and connection test | P0 |
| CAL-3 | Discover available task calendars from CalDAV server | P0 |
| CAL-4 | Allow user to select target calendar for Focus tasks | P0 |
| CAL-5 | Create VTODO for tasks with do dates | P0 |
| CAL-6 | Set VTODO DUE property from doDate/doTime | P0 |
| CAL-7 | Set VTODO DURATION to 30 minutes (PT30M) | P0 |
| CAL-8 | Include task URL in VTODO URL property | P0 |
| CAL-9 | Add VALARM for reminder notification (configurable: 0, 5, 15, 30 min before) | P0 |
| CAL-10 | Update VTODO when task is edited in Obsidian | P0 |
| CAL-11 | Delete VTODO when task is deleted in Obsidian | P0 |
| CAL-12 | Delete VTODO when do date is removed from task | P0 |
| CAL-13 | Store CalDAV UID mapping for each synced task | P0 |
| CAL-14 | Handle CalDAV connection errors gracefully | P1 |
| CAL-15 | Add manual "Sync Now" button in settings | P1 |
| CAL-16 | Show sync status indicator in FocusView | P2 |

#### Tier 2: Write (Calendar → Obsidian)

| ID | Requirement | Priority |
|----|-------------|----------|
| CAL-20 | Poll CalDAV server for VTODO changes (configurable interval: 1-5 min) | P0 |
| CAL-21 | Detect VTODO STATUS:COMPLETED changes | P0 |
| CAL-22 | Mark Obsidian task as completed when VTODO is completed | P0 |
| CAL-23 | Handle completion conflicts (completed in both places) | P1 |
| CAL-24 | Detect VTODO deletion and optionally delete/archive Obsidian task | P2 |
| CAL-25 | Support CalDAV sync-token for efficient change detection | P2 |

**VTODO Format:**
```
BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Obsidian Focus Plugin//EN
BEGIN:VTODO
UID:focus-task-abc123@obsidian
DTSTAMP:20260126T120000Z
SUMMARY:Buy groceries
DUE:20260127T143000
DURATION:PT30M
STATUS:NEEDS-ACTION
URL:https://instacart.com
BEGIN:VALARM
TRIGGER:-PT15M
ACTION:DISPLAY
DESCRIPTION:Buy groceries
END:VALARM
END:VTODO
END:VCALENDAR
```

**Settings UI:**
```
Calendar Integration
├── CalDAV Server: [caldav.icloud.com]
├── Username: [user@example.com]
├── Password: [••••••••] (app-specific password)
├── [Test Connection]
├── Calendar: [Focus Tasks ▼] (dropdown of discovered calendars)
├── Default Reminder: [15 minutes before ▼]
├── Sync Interval: [5 minutes ▼]
└── [Sync Now]
```

**Compatibility Notes:**
- BusyCal: Full VTODO support, displays on calendar grid
- Fantastical: Full VTODO support
- Apple Calendar: VTODOs sync to Reminders app, not calendar grid
- Google Calendar: Does NOT support CalDAV VTODO - excluded from this feature

---

### Feature 4: Slack Bot Integration

**Description:**
A Slack bot that allows users to create tasks in Focus by sending messages. The bot parses natural language to extract do dates, URLs, tags, and wiki links.

**User Stories:**
- As a user, I want to send a Slack message to create a task in Obsidian
- As a user, I want to specify a do date using natural language ("tomorrow at 3pm")
- As a user, I want to include a URL that gets attached to the task
- As a user, I want to create a new note by including [[Note Name]] in my message

**Requirements:**

| ID | Requirement | Priority |
|----|-------------|----------|
| SL-1 | Create Slack bot application (documentation for user setup) | P0 |
| SL-2 | Bot receives slash command or direct message | P0 |
| SL-3 | Parse natural language dates using chrono-node or similar | P0 |
| SL-4 | Extract URLs from message | P0 |
| SL-5 | Extract wiki links [[Note Name]] from message | P0 |
| SL-6 | Write parsed task to inbox file in synced folder | P0 |
| SL-7 | Plugin watches inbox file for new tasks | P0 |
| SL-8 | Import tasks from inbox file into Focus | P0 |
| SL-9 | Create linked notes if they don't exist | P1 |
| SL-10 | Send confirmation message back to Slack | P1 |
| SL-11 | Support configurable default section for imported tasks | P1 |
| SL-12 | Extract #tags from message (for future use) | P2 |

**Message Format Examples:**
```
/focus Buy groceries tomorrow at 3pm https://instacart.com
/focus Review [[Project Alpha]] notes next Monday 10am
/focus Call dentist #health
```

**Parsed Output (inbox file):**
```markdown
- [ ] Buy groceries 📅 2026-01-27 ⏰ 15:00 🔗 https://instacart.com
- [ ] Review [[Project Alpha]] notes 📅 2026-02-02 ⏰ 10:00
- [ ] Call dentist
```

**Architecture:**
```
┌──────────────┐    ┌─────────────────────┐    ┌──────────────────┐
│    Slack     │───▶│  Bot (Vercel/Rail-  │───▶│  focus-inbox.md  │
│  /focus cmd  │    │  way, free tier)    │    │  (iCloud/Dropbox)│
└──────────────┘    └─────────────────────┘    └────────┬─────────┘
                                                        │
                                                        ▼
                                               ┌──────────────────┐
                                               │  Obsidian Focus  │
                                               │  Plugin (watch)  │
                                               └──────────────────┘
```

**Settings UI:**
```
Slack Integration
├── Inbox File Path: [focus-inbox.md]
├── Default Section: [Unscheduled ▼]
├── Auto-create Linked Notes: [✓]
└── [View Setup Instructions]
```

---

## Technical Considerations

### Dependencies

| Feature | New Dependencies |
|---------|------------------|
| Do Dates | None (use native Date APIs) or chrono-node for natural language |
| Periodic Notes | None (use Obsidian vault API) |
| CalDAV | tsdav or ts-caldav npm package |
| Slack Bot | Separate deployment (Vercel/Railway), @slack/bolt |

### Data Migration

- Existing tasks without do dates remain unchanged
- Markdown format is backward compatible (new fields are optional)
- No database migration required

### Security

- CalDAV credentials stored in Obsidian settings (plugin data)
- Recommend app-specific passwords for iCloud
- Slack bot tokens managed externally (not in Obsidian)

### Performance

- CalDAV sync is debounced (batch changes over 2 seconds)
- Polling interval is configurable (default 5 minutes)
- Inbox file watching uses Obsidian's native file watcher

---

## Implementation Phases

### Phase 1: Foundation (3-4 days)
- [ ] Do Dates: Add fields, parser, UI
- [ ] Periodic Notes: Settings and open/create from modals

### Phase 2: Calendar Integration (6-7 days)
- [ ] CalDAV Tier 1: Connection, VTODO creation, sync to calendar
- [ ] CalDAV Tier 2: Completion sync back to Obsidian

### Phase 3: External Capture (3-4 days)
- [ ] Slack Bot: Setup documentation, bot code, inbox file integration

**Total Estimated Effort: 12-15 days**

---

## Success Criteria

| Criterion | Measurement |
|-----------|-------------|
| Do dates work reliably | Tasks with do dates persist correctly through save/load cycles |
| Calendar sync is functional | Tasks appear in BusyCal within 30 seconds of adding do date |
| Completion sync works | Completing in BusyCal marks task done in Obsidian within 5 minutes |
| Notifications are delivered | Calendar app sends notification at scheduled time |
| Slack capture works | Task appears in Obsidian within 60 seconds of Slack message |
| Periodic notes integration works | Daily/weekly notes open or create with one click |

---

## Open Questions

1. **Default reminder time:** What should the default VALARM trigger be? (Proposed: 15 minutes)
2. **Overdue task handling:** Should overdue tasks be visually distinct? Auto-moved to Immediate?
3. **Slack bot hosting:** Should we provide a hosted option or require self-hosting?
4. **Google Calendar users:** Should we implement VEVENT fallback for Google Calendar?
5. **Task duration:** Should users be able to customize duration beyond 30-minute default?

---

## Appendix

### A. CalDAV Server URLs

| Service | CalDAV URL |
|---------|------------|
| iCloud | `caldav.icloud.com` |
| Fastmail | `caldav.fastmail.com` |
| Nextcloud | `{server}/remote.php/dav` |
| Google (events only) | `apidata.googleusercontent.com/caldav/v2` |

### B. Natural Language Date Examples

| Input | Parsed |
|-------|--------|
| "tomorrow" | Next day, no time |
| "tomorrow at 3pm" | Next day, 15:00 |
| "next Monday" | Following Monday, no time |
| "Jan 30 10:30am" | 2026-01-30, 10:30 |
| "in 2 hours" | Current date, current time + 2h |

### C. Related Obsidian Plugins

- **Daily Notes** (core plugin): May auto-detect settings
- **Periodic Notes** (community): May auto-detect settings
- **Calendar** (community): Potential future integration
- **Reminders** (community): Different approach, not conflicting
