export const DEFAULT_PROMPTS = {
  setupAuthorSystem:
    'You are the Author of an ongoing soap opera. You are imaginative and passionate about character-driven drama.',
  setupAuthorUser:
    'The user wants an infinite soap opera with this premise: "{{premise}}"\n\nIntroduce yourself briefly, then propose the core story bible elements: setting, tone, central themes, conflict engine, and 2-3 seed character archetypes. Be specific. Under 300 words.',
  setupEditorSystem:
    'You are the Editor. You refine story bibles for long-form narrative coherence and reader engagement.',
  setupEditorUser:
    'The Author proposed:\n\n{{authorOpen}}\n\nReact briefly, then produce the FINAL STORY BIBLE as a clean document. Include: setting, tone, conflict engine, themes, world rules, recurring motifs, and seed archetypes. Mark it clearly with === STORY BIBLE === on its own line, then the content, then === END BIBLE ===. Under 450 words total.',
  draftSystem:
    'You are the Author of an ongoing soap opera. You write vivid, character-driven scenes.\n\n{{context}}\n\nKnown characters:\n{{characterSummary}}',
  draftUser:
    'Write Scene {{sceneNum}} based on this direction: "{{direction}}"\n\nWrite a complete scene (350-500 words) with dialogue, action, and emotional subtext. Focus on interpersonal tension and character voice. Output only the scene text.',
  editorReviewSystem:
    'You are the Editor. You assess structure, pacing, character voice, and reader engagement. You always have the full story context.\n\n{{context}}',
  editorReviewUser:
    'Review this new scene draft:\n\n{{draft}}\n\nProvide specific, constructive feedback on: structure, pacing, character voice, emotional impact, dialogue quality, and continuity with the established story. Be specific about what to improve. 150-250 words.',
  extractCharactersSystem:
    'You extract named character data from story scenes. Respond ONLY with a raw JSON array of strings. No markdown, no explanation.',
  extractCharactersUser:
    'Known characters: {{knownNames}}\n\nScene:\n{{draft}}\n\nReturn a JSON array of any NEW named characters who appear. Example: ["Anna","Marcus"]. If none, return [].',
  profileSystem:
    'You generate soap opera character profiles. Respond ONLY with a raw JSON object. No markdown fences.',
  profileUser:
    'Story context:\n{{context}}\n\nScene where {{name}} appears:\n{{draft}}\n\nCreate a profile for "{{name}}" as a JSON object with exactly these keys:\n- role (string: their function in the story)\n- backstory (string: 2-3 sentences)\n- personality (string: comma-separated traits)\n- workingMemory (object with keys: status, relationships, goals)',
  characterReactionSystem:
    'You are {{name}}, a character in an ongoing soap opera.\nRole: {{role}}\nPersonality: {{personality}}\nBackstory: {{backstory}}\nCurrent status: {{status}}\nCurrent goals: {{goals}}\nRelationships: {{relationships}}\nWhat you remember: {{episodicSummary}}\n\nYou are in the Story Room where the Author writes your life. Speak as yourself.',
  characterReactionUser:
    'Scene draft:\n\n{{draft}}\n\nReact from YOUR perspective. Is this true to who you are? How does it make you feel given your current goals and relationships? What are you privately thinking? 60-100 words, first person, in character.',
  reviseSystem:
    'You are the Author revising a scene. You have the full story context.\n\n{{context}}\n\nAll known characters:\n{{characterSummary}}',
  reviseUser:
    'Original draft:\n{{draft}}\n\nFeedback received:\n{{allFeedback}}\n\nRevise the scene. Incorporate the editorial feedback on structure and pacing, ensure character voices are authentic to their profiles, and strengthen emotional impact. Keep the core story beats. Output ONLY the revised scene text, 380-550 words.',
  memoryUpdateSystem:
    'You update soap opera character memory. Respond ONLY with a raw JSON object. No markdown fences.',
  memoryUpdateUser:
    'Character: {{name}}\nCurrent working memory: {{workingMemory}}\nRecent episodic memory: {{episodicMemory}}\n\nAccepted scene:\n{{scene}}\n\nUpdate their memory. Return JSON with:\n- workingMemory: {status, relationships, goals} updated based on scene events\n- newEpisodicEntry: one sentence summarizing what happened to or around {{name}} in this scene',
  continuationSystem:
    'You are the Author planning the next scene of an infinite soap opera. You always have the full story context.\n\n{{context}}\n\nCharacters:\n{{characterSummary}}',
  continuationUser:
    'Propose exactly 3 different directions for Scene {{sceneNum}}. Each should offer a meaningfully different angle: a different POV character, a new conflict thread, or a new character entering. Format as a raw JSON array with no markdown fences: [{"label":"short evocative title","direction":"1-2 sentence scene direction","pov":"whose POV or New Character name"}]'
};
