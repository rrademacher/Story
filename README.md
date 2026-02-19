# Story Room Mobile (Android + Ollama)

Standalone React Native (Expo) mobile app scaffold for running the Story Room workflow against a user-provided Ollama backend.

## Features implemented

- Android-ready standalone mobile scaffold using Expo.
- User-configurable Ollama host + port.
- Model dropdown populated from `GET /api/tags`.
- Story-room scene loop adapted from the provided application example.
- Story bible review stage with retry + editable bible text before acceptance; acceptance then presents three scene-start options.
- Auto Mode toggle: Editor auto-selects the best continuation option and auto-accepts scene-review steps to run hands-free.
- Character review voice updated to method-actor style feedback in third person.
- Retry Revision now rebuilds from the original draft + original direction and includes any additional user suggestions.
- Added a "Start Over Completely" control to wipe all persisted story state and return to setup.
- **Character Corner**:
  - Lists all known characters.
  - Character detail editor for full memory objects (`workingMemory`, `episodicMemory`, and `longTermMemory`) as editable JSON.
- **Admin Prompt Editor**:
  - Edits default backend prompts/instructions for all generation steps.
- Duplicate-character mitigation:
  - Name normalization (`trim + lowercase`) for identity matching.
  - Character merge logic for updates from extracted/new character sets.
- Character feedback and memory updates are limited to characters actually present in a scene.
- Retry option during review (`Retry Revision`) to generate an alternative revision pass.
- Compact story-context memory management:
  - Rolling summary + per-scene summaries + last two full scenes for prompt context.
- Lightweight long-term character memory retrieval:
  - Per-character long-term memory entries are appended (not overwritten).
  - A planning/retrieval step uses token-overlap ranking to inject relevant memory into character reactions.
- File-based story state save/load (JSON) from inside the app (choose filename for save, pick file for load; no raw JSON editor display).

## Run locally

1. Install dependencies:
   ```bash
   npm install
   ```
2. Start app:
   ```bash
   npm run start
   ```
3. Open on Android device via Expo Go, or run:
   ```bash
   npm run android
   ```

## Ollama requirements

- Ollama server must be reachable from the Android device.
- Example local endpoint: `http://<LAN_IP>:11434`
- Ensure model(s) are pulled on the server before connecting.

## Notes

- This scaffold uses non-streaming Ollama chat responses (`/api/chat`, `stream: false`) for simpler mobile state handling.
- Prompt templates are stored in `src/defaultPrompts.js` and editable in-app via Admin Prompt Editor.

## Troubleshooting

- If bundling fails with `Cannot find module 'babel-preset-expo'`, reinstall with dev dependencies enabled:
  ```bash
  npm install --include=dev
  ```
  Then clear Metro cache and restart:
  ```bash
  npx expo start -c
  ```
