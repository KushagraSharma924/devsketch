# Session-Based Drawing Implementation

## Overview

The application has been updated to implement a session-based drawing system. Instead of creating a new entry in the database for each figure, the application now maintains a single entry per drawing session, updating it whenever new figures are added or existing ones are modified.

## Key Changes

1. **Session ID Tracking**: Each drawing session now has a unique session ID (UUID), allowing the app to maintain state across browser refreshes.

2. **Database Schema Update**: Added a `session_id` column to the `designs` table to track which designs belong to which session.

3. **Single Entry Per Session**: Instead of creating multiple database entries as figures are added, all changes within a session update the same database record.

4. **New Drawing Button**: Added a button at the top of the canvas that allows users to start a new drawing session, creating a fresh database entry.

5. **Custom UUID Generator**: Implemented a lightweight UUID generator function instead of using an external package to avoid module resolution issues with Next.js.

## How It Works

1. When a user opens the drawing canvas, either:
   - They continue their most recent session (loaded from the database)
   - Or a new session is created if they have no previous sessions

2. As the user draws, all changes are saved to the same database entry, identified by the session ID.

3. The user can start a new drawing by clicking the "New Drawing" button, which:
   - Creates a new session ID
   - Creates a new database entry with that session ID
   - Clears the canvas for a fresh start

4. If the database connection is lost, the session ID and drawing data are saved to local storage as a fallback.

## Implementation Details

- Session IDs are generated using a custom UUID v4 generator function
- The application maintains real-time sync with the database using Supabase's real-time capabilities
- When offline, the application gracefully degrades to local storage

## UUID Generation

Instead of using the external `uuid` package, we implement a simple UUID generator:

```javascript
function generateUUID() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    const r = Math.random() * 16 | 0;
    const v = c == 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}
```

This avoids module resolution issues with Next.js while still providing unique IDs for sessions.

## Migration

To add the `session_id` column to your database, run the SQL migration in `supabase/migrations/20240601000000_add_session_id.sql`. This will:

1. Add the `session_id` column as a UUID
2. Create an index for faster lookups
3. Generate random UUIDs for any existing records
4. Make the column non-nullable 