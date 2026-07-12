---
name: calendar-meeting-record-reporter
description: Create 30-minute Google Calendar meetings from Telegram text or voice requests, return Google Meet links, deliver every generated recording link to the originating chat once, and report meeting counts. Use when a user names a company and meeting time, asks for a Meet link, asks for recordings, or requests meeting totals.
---

# Calendar Meeting and Recording Reporter

Use the Telegram bot's deterministic meeting workflow. Do not call the Google Meet browser-joining plugin for scheduling or artifact delivery.

## Create a meeting

1. Require a company/title plus start date and time.
2. Resolve relative dates in `GOOGLE_CALENDAR_TIME_ZONE`.
3. Use 30 minutes when no duration or end time is supplied.
4. Preserve explicit attendee email addresses.
5. Create one Calendar event with Meet conferencing enabled.
6. Return the Meet link immediately.
7. Persist the Calendar event ID, Meet code, scheduled times, and originating Telegram chat ID.

Accept both:

- `/meet Acme kompaniyasi, ertaga soat 15:00`
- A Telegram voice/audio message containing the same information

Ask one focused question if the title, date, or time is missing. Never guess a missing date or start time.

## Deliver recordings

1. Start polling only after the scheduled end time.
2. Find conference records using the persisted Meet code and the event time window.
3. List every recording for each matching conference record.
4. Deliver only recordings in `FILE_GENERATED` state.
5. Send each recording's Drive export link to the originating Telegram chat.
6. Persist each recording resource name immediately after successful delivery.
7. Never deliver the same recording twice, including after a bot restart.
8. Continue tracking for `RECORDING_TRACKING_DAYS`; do not assume a recording exists merely because the meeting ended.

Recording requires OAuth access to Calendar, Meet metadata, and Meet-created Drive files. If authorization is missing, state that configuration is incomplete rather than claiming recording delivery is active.

## Counting

Count meetings from persisted event metadata, never from recording count. Treat multiple recordings from one event as one meeting.

## Guardrails

- Do not expose tokens, refresh tokens, service-account keys, or Telegram chat IDs.
- Do not create duplicate events when retrying recording delivery.
- Do not send a recording to any chat other than the chat stored for its event.
- Do not claim Google recorded a meeting unless a recording resource reaches `FILE_GENERATED`.
