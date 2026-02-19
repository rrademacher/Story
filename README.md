# Story Room Mobile (Android + Ollama)

Standalone React Native (Expo) mobile app scaffold for running the Story Room workflow against a user-provided Ollama backend.

## Features implemented

- Android-ready standalone mobile scaffold using Expo.
- User-configurable Ollama host + port.
- Model dropdown populated from `GET /api/tags`.
- Story-room scene loop adapted from the provided application example.
- **Character Corner**:
  - Lists all known characters.
  - Character detail editor for full memory objects (`workingMemory` and `episodicMemory`) as editable JSON.
- **Admin Prompt Editor**:
  - Edits default backend prompts/instructions for all generation steps.
- Duplicate-character mitigation:
  - Name normalization (`trim + lowercase`) for identity matching.
  - Character merge logic for updates from extracted/new character sets.

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
