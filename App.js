import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Modal,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Picker } from '@react-native-picker/picker';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';
import { DEFAULT_PROMPTS } from './src/defaultPrompts';

const STORAGE_KEY = 'story-room-mobile-v2';

const PHASE = {
  LOADING: 'LOADING',
  SETUP: 'SETUP',
  BIBLE_REVIEW: 'BIBLE_REVIEW',
  DRAFTING: 'DRAFTING',
  ED_REVIEW: 'ED_REVIEW',
  CHAR_REACT: 'CHAR_REACT',
  AUTH_REVISE: 'AUTH_REVISE',
  USER_EDIT: 'USER_EDIT',
  CONT_CHOICE: 'CONT_CHOICE',
};

const PHASE_LABEL = {
  [PHASE.LOADING]: 'Loading...',
  [PHASE.SETUP]: 'Setup',
  [PHASE.BIBLE_REVIEW]: 'Story Bible Review',
  [PHASE.DRAFTING]: 'Author Drafting',
  [PHASE.ED_REVIEW]: 'Editor Reviewing',
  [PHASE.CHAR_REACT]: 'Characters Reacting',
  [PHASE.AUTH_REVISE]: 'Author Revising',
  [PHASE.USER_EDIT]: 'Your Review',
  [PHASE.CONT_CHOICE]: 'Choose Direction',
};

const ROLE_COLORS = {
  Author: '#f59e0b',
  Editor: '#38bdf8',
  System: '#9ca3af',
};

const STOPWORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'if', 'then', 'to', 'of', 'in', 'on', 'for', 'with', 'at', 'by', 'from', 'is', 'are', 'was', 'were',
  'this', 'that', 'it', 'as', 'be', 'been', 'their', 'his', 'her', 'they', 'them', 'he', 'she', 'you', 'i', 'we', 'our', 'your', 'scene',
]);

function normalizeName(name) {
  return (name || '').trim().toLowerCase();
}


function escapeRegex(value) {
  return (value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function parseStoredBool(value, fallback = false) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const v = value.trim().toLowerCase();
    if (v === 'true') return true;
    if (v === 'false') return false;
  }
  if (typeof value === 'number') return value !== 0;
  return fallback;
}

function fill(template, vars) {
  return (template || '').replace(/\{\{(\w+)\}\}/g, (_, k) => (vars[k] ?? '').toString());
}

function cleanJsonText(raw) {
  const s = (raw || '').trim().replace(/```json|```/gi, '');
  const firstBrace = Math.min(...[s.indexOf('{') >= 0 ? s.indexOf('{') : Infinity, s.indexOf('[') >= 0 ? s.indexOf('[') : Infinity]);
  if (firstBrace !== Infinity) return s.slice(firstBrace);
  return s;
}

function tryParseJson(raw, fallback) {
  try {
    return JSON.parse(cleanJsonText(raw));
  } catch {
    return fallback;
  }
}

function tokenize(text) {
  return (text || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((t) => t && !STOPWORDS.has(t));
}

function appendUniqueMemory(existing, incoming) {
  const out = Array.isArray(existing) ? [...existing] : [];
  for (const item of Array.isArray(incoming) ? incoming : []) {
    if (!item || typeof item !== 'object') continue;
    if (!item.id) item.id = `mem-${Date.now()}-${Math.random()}`;
    if (!out.some((e) => e.id === item.id)) out.push(item);
  }
  return out;
}

function normalizeCharacter(c) {
  const name = (c?.name || 'Unknown').trim();
  return {
    name,
    role: c?.role || 'character',
    backstory: c?.backstory || '',
    persistentBackstory: c?.persistentBackstory || c?.backstory || '',
    personality: c?.personality || 'complex',
    workingMemory: {
      status: c?.workingMemory?.status || 'present',
      relationships: c?.workingMemory?.relationships || 'unknown',
      goals: c?.workingMemory?.goals || 'unclear',
    },
    episodicMemory: Array.isArray(c?.episodicMemory) ? c.episodicMemory : [],
    longTermMemory: appendUniqueMemory([], c?.longTermMemory || []),
  };
}

function mergeCharacters(existing, incoming) {
  const map = new Map();
  for (const raw of existing.map(normalizeCharacter)) map.set(normalizeName(raw.name), raw);

  for (const raw of incoming.map(normalizeCharacter)) {
    const key = normalizeName(raw.name);
    if (!key) continue;
    const prior = map.get(key);
    if (!prior) {
      map.set(key, raw);
      continue;
    }
    map.set(key, {
      ...prior,
      ...raw,
      name: prior.name.length >= raw.name.length ? prior.name : raw.name,
      backstory: prior.backstory || raw.backstory,
      persistentBackstory: prior.persistentBackstory || raw.persistentBackstory || prior.backstory || raw.backstory,
      workingMemory: { ...prior.workingMemory, ...raw.workingMemory },
      episodicMemory: [...(prior.episodicMemory || []), ...(raw.episodicMemory || [])],
      longTermMemory: appendUniqueMemory(prior.longTermMemory || [], raw.longTermMemory || []),
    });
  }

  return [...map.values()];
}

function buildStoryCtx({ bible, rollingSummary, sceneSummaries, approved }) {
  const parts = [];
  if (bible) {
    parts.push('=== STORY BIBLE ===');
    parts.push(bible);
  }
  if (rollingSummary) {
    parts.push('=== ROLLING STORY SUMMARY ===');
    parts.push(rollingSummary);
  }
  const recentSummaries = (sceneSummaries || []).slice(-8);
  if (recentSummaries.length) {
    parts.push('=== RECENT SCENE SUMMARIES ===');
    recentSummaries.forEach((s) => parts.push(`Scene ${s.sceneNum}: ${s.summary}`));
  }
  const lastScenes = (approved || []).slice(-2);
  if (lastScenes.length) {
    parts.push('=== LAST APPROVED SCENES (FULL TEXT) ===');
    lastScenes.forEach((s, idx) => parts.push(`--- Scene ${approved.length - lastScenes.length + idx + 1} ---\n${s}`));
  }
  return parts.join('\n\n');
}

function buildCharSummary(chars) {
  if (!chars?.length) return 'No characters yet.';
  return chars
    .map(
      (c) =>
        `${c.name} (${c.role}): traits=${c.personality} | goals=${c.workingMemory?.goals || '?'} | relationships=${c.workingMemory?.relationships || '?'} | status=${c.workingMemory?.status || '?'}`,
    )
    .join('\n');
}

function rankCharacterMemories(character, queryText, limit = 3) {
  const queryTokens = new Set(tokenize(queryText));
  const memories = Array.isArray(character?.longTermMemory) ? character.longTermMemory : [];
  const scored = memories
    .map((m) => {
      const memTokens = tokenize(`${m.text || ''} ${(m.tags || []).join(' ')}`);
      let score = 0;
      memTokens.forEach((t) => {
        if (queryTokens.has(t)) score += 1;
      });
      return { memory: m, score };
    })
    .sort((a, b) => b.score - a.score || (b.memory?.sceneNum || 0) - (a.memory?.sceneNum || 0));

  return scored.slice(0, limit).map((x) => x.memory.text).filter(Boolean);
}

function nameLikelyInScene(name, sceneText) {
  const n = (name || '').trim();
  if (!n) return false;
  const escaped = n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`\\b${escaped}\\b`, 'i');
  return re.test(sceneText || '');
}

export default function App() {
  const [phase, setPhase] = useState(PHASE.LOADING);
  const [isBusy, setIsBusy] = useState(false);

  const [serverHost, setServerHost] = useState('192.168.1.100');
  const [serverPort, setServerPort] = useState('11434');
  const [models, setModels] = useState([]);
  const [model, setModel] = useState('');

  const [storyBible, setStoryBible] = useState('');
  const [approved, setApproved] = useState([]);
  const [sceneSummaries, setSceneSummaries] = useState([]);
  const [rollingSummary, setRollingSummary] = useState('');
  const [characters, setCharacters] = useState([]);
  const [chat, setChat] = useState([]);
  const [editableDraft, setEditableDraft] = useState('');
  const [contOptions, setContOptions] = useState([]);
  const [setupInput, setSetupInput] = useState('');
  const [setupAuthorOpen, setSetupAuthorOpen] = useState('');
  const [pendingBible, setPendingBible] = useState('');
  const [customInput, setCustomInput] = useState('');
  const [sceneNum, setSceneNum] = useState(1);
  const [autoMode, setAutoMode] = useState(false);
  const autoModeRef = useRef(false);
  const [isHydrated, setIsHydrated] = useState(false);
  const [revisionNotes, setRevisionNotes] = useState('');

  const [lastCycle, setLastCycle] = useState(null);

  const [prompts, setPrompts] = useState(DEFAULT_PROMPTS);
  const [adminOpen, setAdminOpen] = useState(false);
  const [characterCornerOpen, setCharacterCornerOpen] = useState(false);
  const [activeCharacter, setActiveCharacter] = useState(null);
  const [characterEditorOpen, setCharacterEditorOpen] = useState(false);
  const [workingMemoryJson, setWorkingMemoryJson] = useState('');
  const [episodicJson, setEpisodicJson] = useState('');
  const [longTermJson, setLongTermJson] = useState('');

  const [storyFileName, setStoryFileName] = useState('story-room-state.json');

  const baseUrl = useMemo(() => `http://${serverHost.trim()}:${serverPort.trim()}`, [serverHost, serverPort]);

  const addMsg = (role, content) => setChat((prev) => [...prev, { id: `${Date.now()}-${Math.random()}`, role, content }]);
  const sys = (content) => addMsg('System', content);

  async function persist(next) {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  }

  function makeSnapshot(overrides = {}) {
    return {
      serverHost,
      serverPort,
      model,
      prompts,
      storyBible,
      approved,
      sceneSummaries,
      rollingSummary,
      characters,
      sceneNum,
      contOptions,
      lastCycle,
      setupAuthorOpen,
      pendingBible,
      autoMode,
      revisionNotes,
      ...overrides,
    };
  }

  async function fetchModels() {
    try {
      const res = await fetch(`${baseUrl}/api/tags`);
      const data = await res.json();
      const names = (data.models || []).map((m) => m.name).filter(Boolean);
      setModels(names);
      if (!model && names[0]) setModel(names[0]);
      if (!names.length) Alert.alert('No models found', 'Your Ollama server responded, but no models were listed.');
    } catch {
      Alert.alert('Ollama connection failed', `Could not fetch models from ${baseUrl}.`);
    }
  }

  async function callOllama(systemPrompt, userPrompt, options = {}) {
    if (!model) throw new Error('Pick a model first');
    const res = await fetch(`${baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        stream: false,
        options: { num_predict: options.maxTokens || 1200 },
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
      }),
    });
    if (!res.ok) throw new Error(`Ollama error ${res.status}`);
    const data = await res.json();
    return data?.message?.content || '';
  }

  async function identifySceneParticipants(sceneText, knownCharacters) {
    const knownNames = knownCharacters.map((c) => c.name);
    if (!knownNames.length) return [];

    const llmRaw = await callOllama(
      prompts.sceneParticipantsSystem,
      fill(prompts.sceneParticipantsUser, {
        knownNames: knownNames.join(', '),
        scene: sceneText,
      }),
      { maxTokens: 700 },
    );

    const parsed = tryParseJson(llmRaw, []);
    const normalizedKnown = new Set(knownNames.map(normalizeName));

    const fromStructured = Array.isArray(parsed)
      ? parsed
          .map((item) => {
            if (typeof item === 'string') return { name: item, active: true };
            if (!item || typeof item !== 'object') return null;
            return {
              name: item.name,
              active: item.active === true || item.participating === true,
            };
          })
          .filter((item) => item && item.name && item.active)
          .map((item) => normalizeName(item.name))
          .filter((key) => normalizedKnown.has(key))
      : [];

    const activeSet = new Set(fromStructured);

    // Fallback: only count clear on-scene participation cues, not mentions.
    for (const c of knownCharacters) {
      const n = c.name.trim();
      if (!n) continue;
      const esc = escapeRegex(n);
      const dialogueCue = new RegExp(`(?:^|\n)\s*${esc}\s*[:—-]`, 'i');
      const stagedCue = new RegExp(`\b${esc}\b\s+(?:walks|steps|enters|says|asks|replies|leans|turns|nods|looks|whispers|shouts)\b`, 'i');
      const spokenCue = new RegExp(`\b(?:to|at)\s+${esc}\b|\b${esc}\b\s+(?:says|asks|replies)\b`, 'i');
      if (dialogueCue.test(sceneText) || stagedCue.test(sceneText) || spokenCue.test(sceneText)) {
        activeSet.add(normalizeName(c.name));
      }
    }

    return knownCharacters.filter((c) => activeSet.has(normalizeName(c.name)));
  }


  function memoryPlanningSnippet(character, draft) {
    const retrieved = rankCharacterMemories(character, draft, 4);
    return retrieved.length ? retrieved.join(' | ') : 'No directly relevant long-term memories found.';
  }



  useEffect(() => {
    autoModeRef.current = autoMode;
  }, [autoMode]);

  useEffect(() => {
    if (!isHydrated || phase !== PHASE.CONT_CHOICE || !autoModeRef.current || isBusy || !contOptions.length || !storyBible) return;
    (async () => {
      try {
        await autoAdvanceFromChoices(contOptions, characters, approved, storyBible, sceneNum);
      } catch (e) {
        sys(`Auto selection failed: ${e.message}`);
      }
    })();
  }, [isHydrated, phase, isBusy, contOptions, storyBible, sceneNum]);

  useEffect(() => {
    (async () => {
      try {
        const raw = await AsyncStorage.getItem(STORAGE_KEY);
        if (!raw) {
          setPhase(PHASE.SETUP);
          setIsHydrated(true);
          return;
        }
        const s = JSON.parse(raw);
        setServerHost(s.serverHost || '192.168.1.100');
        setServerPort(s.serverPort || '11434');
        setModel(s.model || '');
        setStoryBible(s.storyBible || '');
        setApproved(s.approved || []);
        setSceneSummaries(s.sceneSummaries || []);
        setRollingSummary(s.rollingSummary || '');
        setCharacters((s.characters || []).map(normalizeCharacter));
        setSceneNum(s.sceneNum || 1);
        setContOptions(s.contOptions || []);
        setPrompts(s.prompts || DEFAULT_PROMPTS);
        setLastCycle(s.lastCycle || null);
        setSetupAuthorOpen(s.setupAuthorOpen || '');
        setPendingBible(s.pendingBible || '');
        setAutoMode(parseStoredBool(s.autoMode, false));
        setRevisionNotes(s.revisionNotes || '');
        setPhase(s.pendingBible ? PHASE.BIBLE_REVIEW : s.storyBible ? PHASE.CONT_CHOICE : PHASE.SETUP);
        setIsHydrated(true);
      } catch {
        setPhase(PHASE.SETUP);
        setIsHydrated(true);
      }
    })();
  }, []);

  async function handleSetup() {
    if (!setupInput.trim() || isBusy) return;
    setIsBusy(true);
    try {
      sys('The Author and Editor are entering the room...');
      const authorOpen = await callOllama(prompts.setupAuthorSystem, fill(prompts.setupAuthorUser, { premise: setupInput.trim() }));
      addMsg('Author', authorOpen);

      const edResp = await callOllama(prompts.setupEditorSystem, fill(prompts.setupEditorUser, { authorOpen }));
      addMsg('Editor', edResp);

      const match = edResp.match(/=== STORY BIBLE ===([\s\S]*?)=== END BIBLE ===/);
      const bible = match ? match[1].trim() : edResp;

      setSetupAuthorOpen(authorOpen);
      setPendingBible(bible);
      setPhase(PHASE.BIBLE_REVIEW);

      await persist(
        makeSnapshot({
          setupAuthorOpen: authorOpen,
          pendingBible: bible,
        }),
      );
    } catch (e) {
      sys(`Setup failed: ${e.message}`);
    } finally {
      setIsBusy(false);
    }
  }

  async function retryStoryBible() {
    if (isBusy) return;
    await handleSetup();
  }

  async function acceptStoryBible() {
    if (isBusy || !pendingBible.trim()) return;
    const firstOpt = [
      {
        label: 'Begin Scene 1',
        direction: 'Open the story, establishing the world and introducing at least two characters from the story bible.',
        pov: 'Author',
      },
      {
        label: 'Start with a personal rupture',
        direction: 'Begin with a key relationship fracture that reveals private goals and conflicting loyalties.',
        pov: 'Character POV',
      },
      {
        label: 'Introduce an outsider catalyst',
        direction: 'Open with a new character arrival whose agenda destabilizes existing alliances and ignites a secondary plot.',
        pov: 'New Character',
      },
    ];

    setStoryBible(pendingBible.trim());
    setPendingBible('');
    setSceneNum(1);
    setCharacters([]);
    setApproved([]);
    setSceneSummaries([]);
    setRollingSummary('');
    setContOptions(firstOpt);
    setChat([]);
    setRevisionNotes('');
    setPhase(PHASE.CONT_CHOICE);

    await persist(
      makeSnapshot({
        storyBible: pendingBible.trim(),
        pendingBible: '',
        setupAuthorOpen,
        sceneNum: 1,
        characters: [],
        approved: [],
        sceneSummaries: [],
        rollingSummary: '',
        contOptions: firstOpt,
        lastCycle: null,
      }),
    );

    if (autoModeRef.current) {
      await autoAdvanceFromChoices(firstOpt, [], [], pendingBible.trim(), 1);
    }
  }



  async function pickBestOption(options, ctx, chars, nextSceneNum) {
    const serialized = JSON.stringify(options);
    const response = await callOllama(
      prompts.autoOptionReviewSystem,
      fill(prompts.autoOptionReviewUser, {
        sceneNum: nextSceneNum,
        context: ctx,
        characterSummary: buildCharSummary(chars),
        options: serialized,
      }),
      { maxTokens: 500 },
    );
    const parsed = tryParseJson(response, null);
    const idx = Number(parsed?.selectedIndex);
    if (Number.isInteger(idx) && idx >= 0 && idx < options.length) {
      return { index: idx, rationale: parsed?.rationale || 'Editor-selected for arc momentum.' };
    }
    return { index: 0, rationale: 'Fallback to first option.' };
  }

  async function autoAdvanceFromChoices(options, chars, scenes, bible, num) {
    if (!autoModeRef.current || !Array.isArray(options) || !options.length || isBusy) return;
    const ctx = buildStoryCtx({ bible, rollingSummary, sceneSummaries, approved: scenes });
    const pick = await pickBestOption(options, ctx, chars, num);
    const chosen = options[pick.index] || options[0];
    sys(`Auto Mode chose: ${chosen.label} (${pick.rationale})`);
    setChat([]);
    await runSceneCycle(chosen.direction, chars, scenes, bible, num);
  }

  async function buildRevisedScene({ ctx, allChars, draft, edReview, sceneChars, num, direction, userSuggestions }) {
    return callOllama(
      fill(prompts.reviseSystem, { context: ctx, characterSummary: buildCharSummary(allChars) }),
      fill(prompts.reviseUser, {
        draft,
        allFeedback: `ORIGINAL DIRECTION: ${direction || 'N/A'}\n\nEDITOR FEEDBACK:\n${edReview}\n\nCHARACTERS IN THIS SCENE: ${sceneChars.map((c) => c.name).join(', ')}\n\nADDITIONAL USER SUGGESTIONS:\n${userSuggestions || 'None provided.'}`,
      }),
      { maxTokens: 1800 },
    );
  }

  async function runSceneCycle(direction, chars, scenes, bible, num) {
    setIsBusy(true);
    try {
      const ctx = buildStoryCtx({ bible, rollingSummary, sceneSummaries, approved: scenes });
      const charSum = buildCharSummary(chars);

      setPhase(PHASE.DRAFTING);
      const draft = await callOllama(fill(prompts.draftSystem, { context: ctx, characterSummary: charSum }), fill(prompts.draftUser, { sceneNum: num, direction }), {
        maxTokens: 1600,
      });
      addMsg('Author', `**[Scene ${num} — First Draft]**\n\n${draft}`);

      setPhase(PHASE.ED_REVIEW);
      const edReview = await callOllama(fill(prompts.editorReviewSystem, { context: ctx }), fill(prompts.editorReviewUser, { draft }));
      addMsg('Editor', edReview);

      setPhase(PHASE.CHAR_REACT);
      const extraction = await callOllama(
        prompts.extractCharactersSystem,
        fill(prompts.extractCharactersUser, { knownNames: chars.map((c) => c.name).join(', ') || 'none', draft }),
      );
      const extractedNames = tryParseJson(extraction, []).filter((n) => typeof n === 'string');
      const existingKeys = new Set(chars.map((c) => normalizeName(c.name)));
      const uniqueNewNames = [...new Set(extractedNames.map((n) => n.trim()).filter(Boolean))].filter((n) => !existingKeys.has(normalizeName(n)));

      const newChars = [];
      for (const name of uniqueNewNames.slice(0, 6)) {
        const profileRaw = await callOllama(prompts.profileSystem, fill(prompts.profileUser, { context: ctx, name, draft }));
        const p = tryParseJson(profileRaw, {});
        newChars.push(normalizeCharacter({ name, role: p.role, backstory: p.backstory, persistentBackstory: p.backstory, personality: p.personality, workingMemory: p.workingMemory }));
      }

      const allChars = mergeCharacters(chars, newChars);
      const sceneChars = await identifySceneParticipants(draft, allChars);

      for (const c of sceneChars) {
        const planMem = memoryPlanningSnippet(c, draft);
        const reaction = await callOllama(
          fill(prompts.characterReactionSystem, {
            name: c.name,
            role: c.role,
            personality: c.personality,
            backstory: c.persistentBackstory || c.backstory,
            status: c.workingMemory.status,
            goals: c.workingMemory.goals,
            relationships: c.workingMemory.relationships,
            episodicSummary: c.episodicMemory.slice(-6).join('; ') || 'no prior scenes',
            planMem,
          }),
          fill(prompts.characterReactionUser, { draft, name: c.name }),
          { maxTokens: 500 },
        );
        addMsg(c.name, reaction);
      }

      setPhase(PHASE.AUTH_REVISE);
      const revised = await buildRevisedScene({ ctx, allChars, draft, edReview, sceneChars, num, direction, userSuggestions: revisionNotes });
      addMsg('Author', `**[Scene ${num} — Revised]**\n\n${revised}`);

      setEditableDraft(revised);
      setCharacters(allChars);
      setLastCycle({ sceneNum: num, direction, draft, edReview, sceneCharacterNames: sceneChars.map((c) => c.name), allCharacterNames: allChars.map((c) => c.name) });
      setPhase(PHASE.USER_EDIT);

      await persist(makeSnapshot({ characters: allChars, lastCycle: { sceneNum: num, direction, draft, edReview, sceneCharacterNames: sceneChars.map((c) => c.name), allCharacterNames: allChars.map((c) => c.name) } }));

      if (autoModeRef.current) {
        sys('Auto Mode: auto-accepting revised scene and continuing.');
        await autoAcceptScene(revised, allChars);
      }
    } catch (e) {
      sys(`Scene cycle failed: ${e.message}`);
      setPhase(PHASE.CONT_CHOICE);
    } finally {
      setIsBusy(false);
    }
  }

  async function retryRevision() {
    if (isBusy || !lastCycle?.draft || !lastCycle?.edReview) return;
    setIsBusy(true);
    try {
      setPhase(PHASE.AUTH_REVISE);
      const ctx = buildStoryCtx({ bible: storyBible, rollingSummary, sceneSummaries, approved });
      const sceneChars = characters.filter((c) => lastCycle.sceneCharacterNames.map(normalizeName).includes(normalizeName(c.name)));
      const revised = await buildRevisedScene({ ctx, allChars: characters, draft: lastCycle.draft, edReview: lastCycle.edReview, sceneChars, num: sceneNum, direction: lastCycle.direction, userSuggestions: revisionNotes });
      setEditableDraft(revised);
      addMsg('System', 'Generated a new revision from the initial draft and suggestion, incorporating any additional user suggestions.');
      addMsg('Author', `**[Scene ${sceneNum} — Revised Retry]**\n\n${revised}`);
      setPhase(PHASE.USER_EDIT);
      await persist(makeSnapshot());
    } catch (e) {
      sys(`Retry failed: ${e.message}`);
      setPhase(PHASE.USER_EDIT);
    } finally {
      setIsBusy(false);
    }
  }

  async function autoAcceptScene(sceneText, characterListOverride) {
    const acceptedScene = (sceneText || '').trim();
    if (!acceptedScene) return;

    const currentCharacters = characterListOverride || characters;
    const newApproved = [...approved, acceptedScene];
    const newNum = sceneNum + 1;

    const sceneParticipants = await identifySceneParticipants(acceptedScene, currentCharacters);
    const participantKeys = new Set(sceneParticipants.map((c) => normalizeName(c.name)));

    const updatedChars = [];
    for (const c of currentCharacters) {
      if (!participantKeys.has(normalizeName(c.name))) {
        updatedChars.push(c);
        continue;
      }

      const memRaw = await callOllama(
        prompts.memoryUpdateSystem,
        fill(prompts.memoryUpdateUser, {
          name: c.name,
          persistentBackstory: c.persistentBackstory || c.backstory,
          workingMemory: JSON.stringify(c.workingMemory),
          episodicMemory: c.episodicMemory.slice(-10).join('; ') || 'none',
          scene: acceptedScene,
        }),
      );
      const upd = tryParseJson(memRaw, null);
      const episodicEntry = upd?.newEpisodicEntry || `Scene ${sceneNum}: ${c.name} was involved in unfolding events.`;
      const longTermEntry = {
        id: `mem-${sceneNum}-${normalizeName(c.name)}-${Date.now()}`,
        sceneNum,
        text: upd?.longTermMemoryEntry || episodicEntry,
        tags: Array.isArray(upd?.tags) ? upd.tags : tokenize(`${c.workingMemory?.goals || ''} ${c.workingMemory?.relationships || ''}`).slice(0, 6),
      };

      updatedChars.push(
        normalizeCharacter({
          ...c,
          workingMemory: upd?.workingMemory || c.workingMemory,
          episodicMemory: [...(c.episodicMemory || []), episodicEntry],
          longTermMemory: appendUniqueMemory(c.longTermMemory || [], [longTermEntry]),
        }),
      );
    }

    const summaryRaw = await callOllama(prompts.sceneSummarySystem, fill(prompts.sceneSummaryUser, { sceneNum, scene: acceptedScene }), { maxTokens: 300 });
    const sceneSummaryText = summaryRaw.trim() || `Scene ${sceneNum} advanced the main conflict.`;
    const newSceneSummaries = [...sceneSummaries, { sceneNum, summary: sceneSummaryText }];

    const rollingRaw = await callOllama(
      prompts.rollingSummarySystem,
      fill(prompts.rollingSummaryUser, {
        oldSummary: rollingSummary || 'No prior rolling summary.',
        sceneNum,
        sceneSummary: sceneSummaryText,
      }),
      { maxTokens: 500 },
    );
    const nextRolling = rollingRaw.trim() || rollingSummary;

    const ctx = buildStoryCtx({ bible: storyBible, rollingSummary: nextRolling, sceneSummaries: newSceneSummaries, approved: newApproved });
    const optsRaw = await callOllama(
      fill(prompts.continuationSystem, { context: ctx, characterSummary: buildCharSummary(updatedChars) }),
      fill(prompts.continuationUser, { sceneNum: newNum }),
      { maxTokens: 900 },
    );
    const parsedOpts = tryParseJson(optsRaw, []);
    const nextOpts = Array.isArray(parsedOpts) && parsedOpts.length
      ? parsedOpts
      : [{ label: 'Continue naturally', direction: 'Continue the story from where the last scene ended.', pov: 'Author' }];

    setApproved(newApproved);
    setSceneSummaries(newSceneSummaries);
    setRollingSummary(nextRolling);
    setCharacters(updatedChars);
    setSceneNum(newNum);
    setChat([{ id: `${Date.now()}`, role: 'System', content: `Scene ${sceneNum} accepted.` }]);
    setContOptions(nextOpts);
    setLastCycle(null);
    setPhase(PHASE.CONT_CHOICE);

    await persist(
      makeSnapshot({
        approved: newApproved,
        sceneSummaries: newSceneSummaries,
        rollingSummary: nextRolling,
        characters: updatedChars,
        sceneNum: newNum,
        contOptions: nextOpts,
        lastCycle: null,
      }),
    );

    if (autoModeRef.current) {
      await autoAdvanceFromChoices(nextOpts, updatedChars, newApproved, storyBible, newNum);
    }
  }

  async function handleAccept() {
    if (!editableDraft.trim() || isBusy) return;
    setIsBusy(true);
    try {
      await autoAcceptScene(editableDraft, characters);
    } catch (e) {
      sys(`Accept failed: ${e.message}`);
    } finally {
      setIsBusy(false);
    }
  }

  async function handleContinue(direction) {
    if (!direction.trim() || isBusy) return;
    setChat([]);
    setRevisionNotes('');
    await runSceneCycle(direction, characters, approved, storyBible, sceneNum);
  }


  function openCharacterEditor(character) {
    const normalized = normalizeCharacter(character);
    setActiveCharacter(normalized);
    setWorkingMemoryJson(JSON.stringify(normalized.workingMemory, null, 2));
    setEpisodicJson(JSON.stringify(normalized.episodicMemory, null, 2));
    setLongTermJson(JSON.stringify(normalized.longTermMemory, null, 2));
    setCharacterEditorOpen(true);
  }

  async function saveCharacterEdits() {
    if (!activeCharacter) return;
    const nextWorking = tryParseJson(workingMemoryJson, null);
    const nextEpisodic = tryParseJson(episodicJson, null);
    const nextLongTerm = tryParseJson(longTermJson, null);
    if (!nextWorking || !Array.isArray(nextEpisodic) || !Array.isArray(nextLongTerm)) {
      Alert.alert('Invalid JSON', 'workingMemory must be JSON object, episodicMemory must be array, longTermMemory must be array.');
      return;
    }

    const updated = mergeCharacters(
      characters.map((c) =>
        normalizeName(c.name) === normalizeName(activeCharacter.name)
          ? normalizeCharacter({ ...c, workingMemory: nextWorking, episodicMemory: nextEpisodic, longTermMemory: nextLongTerm })
          : c,
      ),
      [],
    );

    setCharacters(updated);
    setCharacterEditorOpen(false);
    await persist(makeSnapshot({ characters: updated }));
  }

  async function savePromptsAndClose() {
    setAdminOpen(false);
    await persist(makeSnapshot({ prompts }));
  }


  async function handleStartOver() {
    Alert.alert('Start Over Completely', 'This will erase all current story state. Continue?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Start Over',
        style: 'destructive',
        onPress: async () => {
          await AsyncStorage.removeItem(STORAGE_KEY);
          setPhase(PHASE.SETUP);
          setIsBusy(false);
          setStoryBible('');
          setApproved([]);
          setSceneSummaries([]);
          setRollingSummary('');
          setCharacters([]);
          setChat([]);
          setEditableDraft('');
          setContOptions([]);
          setSetupInput('');
          setSetupAuthorOpen('');
          setPendingBible('');
          setCustomInput('');
          setSceneNum(1);
          autoModeRef.current = false;
          setAutoMode(false);
          setRevisionNotes('');
          setLastCycle(null);
        },
      },
    ]);
  }

  async function exportStoryState() {
    try {
      const fileName = (storyFileName || 'story-room-state.json').trim().endsWith('.json')
        ? (storyFileName || 'story-room-state.json').trim()
        : `${(storyFileName || 'story-room-state').trim()}.json`;
      const payload = JSON.stringify(makeSnapshot(), null, 2);

      if (!FileSystem.StorageAccessFramework?.requestDirectoryPermissionsAsync) {
        throw new Error('Storage Access Framework is unavailable in this runtime.');
      }
      const perms = await FileSystem.StorageAccessFramework.requestDirectoryPermissionsAsync();
      if (!perms.granted) {
        Alert.alert('Export cancelled', 'Directory permission was not granted.');
        return;
      }

      let fileUri;
      try {
        fileUri = await FileSystem.StorageAccessFramework.createFileAsync(perms.directoryUri, fileName, 'application/json');
      } catch {
        const alt = fileName.replace(/\.json$/i, '') + `-${Date.now()}.json`;
        fileUri = await FileSystem.StorageAccessFramework.createFileAsync(perms.directoryUri, alt, 'application/json');
      }
      await FileSystem.writeAsStringAsync(fileUri, payload, { encoding: FileSystem.EncodingType.UTF8 });
      Alert.alert('Export complete', `Saved ${fileName}.`);
    } catch (e) {
      Alert.alert('Export failed', e.message || 'Could not save story file.');
    }
  }


  async function importStoryState() {
    try {
      const picked = await DocumentPicker.getDocumentAsync({
        type: 'application/json',
        copyToCacheDirectory: true,
        multiple: false,
      });
      if (picked.canceled || !picked.assets?.length) return;
      const uri = picked.assets[0].uri;
      const raw = await FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.UTF8 });
      const parsed = tryParseJson(raw, null);
      if (!parsed || typeof parsed !== 'object') {
        Alert.alert('Invalid story JSON', 'Selected file did not contain a valid story state JSON object.');
        return;
      }

      setServerHost(parsed.serverHost || '192.168.1.100');
      setServerPort(parsed.serverPort || '11434');
      setModel(parsed.model || '');
      setStoryBible(parsed.storyBible || '');
      setApproved(parsed.approved || []);
      setSceneSummaries(parsed.sceneSummaries || []);
      setRollingSummary(parsed.rollingSummary || '');
      setCharacters((parsed.characters || []).map(normalizeCharacter));
      setSceneNum(parsed.sceneNum || 1);
      setContOptions(parsed.contOptions || []);
      setPrompts(parsed.prompts || DEFAULT_PROMPTS);
      setLastCycle(parsed.lastCycle || null);
      setSetupAuthorOpen(parsed.setupAuthorOpen || '');
      setPendingBible(parsed.pendingBible || '');
      setAutoMode(parseStoredBool(parsed.autoMode, false));
      setRevisionNotes(parsed.revisionNotes || '');
      setPhase(parsed.pendingBible ? PHASE.BIBLE_REVIEW : parsed.storyBible ? PHASE.CONT_CHOICE : PHASE.SETUP);

      await persist({
        ...parsed,
        characters: (parsed.characters || []).map(normalizeCharacter),
        prompts: parsed.prompts || DEFAULT_PROMPTS,
        setupAuthorOpen: parsed.setupAuthorOpen || '',
        pendingBible: parsed.pendingBible || '',
        autoMode: parseStoredBool(parsed.autoMode, false),
        revisionNotes: parsed.revisionNotes || '',
      });
      Alert.alert('Import complete', 'Story state loaded successfully.');
    } catch (e) {
      Alert.alert('Import failed', e.message || 'Could not load story file.');
    }
  }


  if (phase === PHASE.LOADING) {
    return (
      <SafeAreaView style={styles.containerCenter}>
        <Text style={styles.muted}>Loading Story Room...</Text>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.title}>The Story Room (Android + Ollama)</Text>
        <Text style={styles.small}>Phase: {PHASE_LABEL[phase]}</Text>
        <Pressable
          style={[styles.buttonSecondary, { marginTop: 4 }]}
          onPress={async () => {
            const next = !autoModeRef.current;
            autoModeRef.current = next;
            setAutoMode(next);
            await persist(makeSnapshot({ autoMode: next }));
          }}
        >
          <Text style={styles.buttonText}>Auto Mode: {autoMode ? 'ON' : 'OFF'}</Text>
        </Pressable>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Backend</Text>
          <TextInput value={serverHost} onChangeText={setServerHost} placeholder="Ollama IP" style={styles.input} />
          <TextInput value={serverPort} onChangeText={setServerPort} placeholder="Port" style={styles.input} keyboardType="number-pad" />
          <Pressable style={styles.button} onPress={fetchModels}>
            <Text style={styles.buttonText}>Refresh Models</Text>
          </Pressable>
          <View style={styles.pickerWrap}>
            <Picker selectedValue={model} onValueChange={(v) => setModel(v)}>
              <Picker.Item label="Select a model" value="" />
              {models.map((m) => (
                <Picker.Item key={m} label={m} value={m} />
              ))}
            </Picker>
          </View>
        </View>

        <View style={styles.row}>
          <Pressable style={styles.buttonSecondary} onPress={() => setCharacterCornerOpen(true)}>
            <Text style={styles.buttonText}>Character Corner ({characters.length})</Text>
          </Pressable>
          <Pressable style={styles.buttonSecondary} onPress={() => setAdminOpen(true)}>
            <Text style={styles.buttonText}>Admin Prompts</Text>
          </Pressable>
        </View>

        <View style={styles.row}>
          <Pressable style={styles.buttonSecondary} onPress={handleStartOver}>
            <Text style={styles.buttonText}>Start Over Completely</Text>
          </Pressable>
        </View>

        <View style={styles.row}>
          <Pressable style={styles.buttonSecondary} onPress={exportStoryState}>
            <Text style={styles.buttonText}>Save Story File</Text>
          </Pressable>
          <Pressable style={styles.buttonSecondary} onPress={importStoryState}>
            <Text style={styles.buttonText}>Load Story File</Text>
          </Pressable>
        </View>
        <TextInput
          value={storyFileName}
          onChangeText={setStoryFileName}
          placeholder="File name (e.g. arc-1.json)"
          style={styles.input}
        />

        {phase === PHASE.SETUP && (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Setup Story Premise</Text>
            <TextInput value={setupInput} onChangeText={setSetupInput} style={styles.textarea} multiline />
            <Pressable style={styles.button} onPress={handleSetup}>
              <Text style={styles.buttonText}>{isBusy ? 'Opening...' : 'Open Story Room'}</Text>
            </Pressable>
          </View>
        )}


        {phase === PHASE.BIBLE_REVIEW && (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Review Story Bible</Text>
            {setupAuthorOpen ? <Text style={styles.small}>Author draft:
{setupAuthorOpen}</Text> : null}
            <TextInput value={pendingBible} onChangeText={setPendingBible} style={styles.textareaLg} multiline />
            <View style={styles.row}>
              <Pressable style={styles.button} onPress={acceptStoryBible}>
                <Text style={styles.buttonText}>{isBusy ? 'Accepting...' : 'Accept Story Bible'}</Text>
              </Pressable>
              <Pressable style={styles.buttonSecondary} onPress={retryStoryBible}>
                <Text style={styles.buttonText}>{isBusy ? 'Retrying...' : 'Retry Story Bible'}</Text>
              </Pressable>
            </View>
          </View>
        )}

        {storyBible ? (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Story Bible</Text>
            <Text style={styles.body}>{storyBible}</Text>
            {!!rollingSummary && (
              <>
                <Text style={[styles.cardTitle, { marginTop: 10 }]}>Rolling Summary</Text>
                <Text style={styles.body}>{rollingSummary}</Text>
              </>
            )}
          </View>
        ) : null}

        {approved.map((s, i) => (
          <View key={`${i}-${s.length}`} style={styles.card}>
            <Text style={styles.cardTitle}>Scene {i + 1}</Text>
            <Text style={styles.body}>{s}</Text>
            {sceneSummaries[i]?.summary ? <Text style={styles.small}>Summary: {sceneSummaries[i].summary}</Text> : null}
          </View>
        ))}

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Room Feed</Text>
          {chat.length === 0 ? <Text style={styles.muted}>The room is quiet...</Text> : null}
          {chat.map((m) => (
            <View key={m.id} style={styles.msgCard}>
              <Text style={[styles.msgRole, { color: ROLE_COLORS[m.role] || '#d1d5db' }]}>{m.role}</Text>
              <Text style={styles.body}>{m.content}</Text>
            </View>
          ))}
        </View>

        {phase === PHASE.USER_EDIT && (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Scene {sceneNum} — Your Review</Text>
            <TextInput value={editableDraft} onChangeText={setEditableDraft} style={styles.textareaLg} multiline />
            <Text style={styles.small}>Additional revision suggestions (used on Retry Revision):</Text>
            <TextInput value={revisionNotes} onChangeText={setRevisionNotes} style={styles.textarea} multiline />
            <View style={styles.row}>
              <Pressable style={styles.button} onPress={handleAccept}>
                <Text style={styles.buttonText}>{isBusy ? 'Accepting...' : 'Accept Scene & Continue'}</Text>
              </Pressable>
              <Pressable style={styles.buttonSecondary} onPress={retryRevision}>
                <Text style={styles.buttonText}>{isBusy ? 'Retrying...' : 'Retry Revision'}</Text>
              </Pressable>
            </View>
          </View>
        )}

        {phase === PHASE.CONT_CHOICE && !isBusy && (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Choose a direction for Scene {sceneNum}</Text>
            {contOptions.map((opt, i) => (
              <Pressable key={`${i}-${opt.label}`} style={styles.option} onPress={() => handleContinue(opt.direction)}>
                <Text style={styles.optionTitle}>[{opt.pov || 'Author'}] {opt.label}</Text>
                <Text style={styles.small}>{opt.direction}</Text>
              </Pressable>
            ))}
            <TextInput value={customInput} onChangeText={setCustomInput} placeholder="Or enter your own direction" style={styles.input} />
            <Pressable style={styles.button} onPress={() => customInput.trim() && handleContinue(customInput.trim())}>
              <Text style={styles.buttonText}>Go</Text>
            </Pressable>
          </View>
        )}
      </ScrollView>

      <Modal visible={characterCornerOpen} animationType="slide">
        <SafeAreaView style={styles.modalWrap}>
          <Text style={styles.title}>Character Corner</Text>
          <ScrollView>
            {characters.map((c) => (
              <Pressable key={c.name} style={styles.option} onPress={() => openCharacterEditor(c)}>
                <Text style={styles.optionTitle}>{c.name}</Text>
                <Text style={styles.small}>{c.role}</Text>
                <Text style={styles.small}>Goals: {c.workingMemory?.goals || 'n/a'}</Text>
              </Pressable>
            ))}
          </ScrollView>
          <Pressable style={styles.buttonSecondary} onPress={() => setCharacterCornerOpen(false)}>
            <Text style={styles.buttonText}>Close</Text>
          </Pressable>
        </SafeAreaView>
      </Modal>

      <Modal visible={characterEditorOpen} animationType="slide">
        <SafeAreaView style={styles.modalWrap}>
          <Text style={styles.title}>Edit: {activeCharacter?.name}</Text>
          <Text style={styles.cardTitle}>workingMemory (JSON object)</Text>
          <TextInput style={styles.textarea} multiline value={workingMemoryJson} onChangeText={setWorkingMemoryJson} />
          <Text style={styles.cardTitle}>episodicMemory (JSON array)</Text>
          <TextInput style={styles.textarea} multiline value={episodicJson} onChangeText={setEpisodicJson} />
          <Text style={styles.cardTitle}>longTermMemory (JSON array)</Text>
          <TextInput style={styles.textarea} multiline value={longTermJson} onChangeText={setLongTermJson} />
          <View style={styles.row}>
            <Pressable style={styles.button} onPress={saveCharacterEdits}>
              <Text style={styles.buttonText}>Save</Text>
            </Pressable>
            <Pressable style={styles.buttonSecondary} onPress={() => setCharacterEditorOpen(false)}>
              <Text style={styles.buttonText}>Cancel</Text>
            </Pressable>
          </View>
        </SafeAreaView>
      </Modal>

      <Modal visible={adminOpen} animationType="slide">
        <SafeAreaView style={styles.modalWrap}>
          <Text style={styles.title}>Admin Prompt Editor</Text>
          <ScrollView>
            {Object.keys(prompts).map((k) => (
              <View key={k} style={styles.card}>
                <Text style={styles.cardTitle}>{k}</Text>
                <TextInput value={prompts[k]} onChangeText={(v) => setPrompts((prev) => ({ ...prev, [k]: v }))} multiline style={styles.textarea} />
              </View>
            ))}
          </ScrollView>
          <View style={styles.row}>
            <Pressable style={styles.button} onPress={savePromptsAndClose}>
              <Text style={styles.buttonText}>Save</Text>
            </Pressable>
            <Pressable style={styles.buttonSecondary} onPress={() => setAdminOpen(false)}>
              <Text style={styles.buttonText}>Cancel</Text>
            </Pressable>
          </View>
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#030712' },
  containerCenter: { flex: 1, backgroundColor: '#030712', alignItems: 'center', justifyContent: 'center' },
  content: { padding: 16, gap: 12, paddingBottom: 50 },
  title: { color: '#fbbf24', fontSize: 22, fontWeight: '700' },
  small: { color: '#9ca3af', fontSize: 12 },
  body: { color: '#e5e7eb', fontSize: 14, lineHeight: 20 },
  muted: { color: '#6b7280' },
  card: { borderWidth: 1, borderColor: '#374151', borderRadius: 8, padding: 12, backgroundColor: '#111827' },
  cardTitle: { color: '#fbbf24', fontWeight: '700', marginBottom: 6 },
  input: {
    borderWidth: 1,
    borderColor: '#374151',
    borderRadius: 8,
    color: '#f9fafb',
    backgroundColor: '#1f2937',
    paddingHorizontal: 10,
    paddingVertical: 8,
    marginBottom: 8,
  },
  textarea: {
    borderWidth: 1,
    borderColor: '#374151',
    borderRadius: 8,
    color: '#f9fafb',
    backgroundColor: '#1f2937',
    paddingHorizontal: 10,
    paddingVertical: 8,
    minHeight: 120,
    textAlignVertical: 'top',
  },
  textareaLg: {
    borderWidth: 1,
    borderColor: '#374151',
    borderRadius: 8,
    color: '#f9fafb',
    backgroundColor: '#1f2937',
    paddingHorizontal: 10,
    paddingVertical: 8,
    minHeight: 220,
    textAlignVertical: 'top',
    marginBottom: 10,
  },
  button: { backgroundColor: '#b45309', paddingVertical: 10, borderRadius: 8, alignItems: 'center', marginTop: 8, flex: 1 },
  buttonSecondary: {
    backgroundColor: '#374151',
    paddingVertical: 10,
    borderRadius: 8,
    alignItems: 'center',
    marginTop: 8,
    flex: 1,
  },
  buttonText: { color: '#f9fafb', fontWeight: '700' },
  pickerWrap: {
    borderColor: '#374151',
    borderWidth: 1,
    borderRadius: 8,
    overflow: 'hidden',
    backgroundColor: '#1f2937',
  },
  row: { flexDirection: 'row', gap: 10 },
  option: { borderWidth: 1, borderColor: '#4b5563', borderRadius: 8, padding: 10, marginBottom: 8, backgroundColor: '#1f2937' },
  optionTitle: { color: '#f3f4f6', fontWeight: '700' },
  msgCard: { borderWidth: 1, borderColor: '#374151', borderRadius: 8, padding: 8, marginBottom: 8, backgroundColor: '#0f172a' },
  msgRole: { fontWeight: '700', marginBottom: 3 },
  modalWrap: { flex: 1, backgroundColor: '#030712', padding: 16 },
});
