import React, { useEffect, useMemo, useState } from 'react';
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
import { DEFAULT_PROMPTS } from './src/defaultPrompts';

const STORAGE_KEY = 'story-room-mobile-v1';

const PHASE = {
  LOADING: 'LOADING',
  SETUP: 'SETUP',
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

function normalizeName(name) {
  return (name || '').trim().toLowerCase();
}

function fill(template, vars) {
  return template.replace(/\{\{(\w+)\}\}/g, (_, k) => (vars[k] ?? '').toString());
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

function normalizeCharacter(c) {
  return {
    name: (c?.name || 'Unknown').trim(),
    role: c?.role || 'character',
    backstory: c?.backstory || '',
    personality: c?.personality || 'complex',
    workingMemory: {
      status: c?.workingMemory?.status || 'present',
      relationships: c?.workingMemory?.relationships || 'unknown',
      goals: c?.workingMemory?.goals || 'unclear',
    },
    episodicMemory: Array.isArray(c?.episodicMemory) ? c.episodicMemory : [],
  };
}

function mergeCharacters(existing, incoming) {
  const map = new Map();
  for (const c of existing.map(normalizeCharacter)) {
    map.set(normalizeName(c.name), c);
  }
  for (const raw of incoming.map(normalizeCharacter)) {
    const key = normalizeName(raw.name);
    if (!key) continue;
    const prior = map.get(key);
    if (!prior) {
      map.set(key, raw);
    } else {
      map.set(key, {
        ...prior,
        ...raw,
        name: prior.name.length >= raw.name.length ? prior.name : raw.name,
        workingMemory: { ...prior.workingMemory, ...raw.workingMemory },
        episodicMemory: [...new Set([...(prior.episodicMemory || []), ...(raw.episodicMemory || [])])],
      });
    }
  }
  return [...map.values()];
}

function buildStoryCtx(bible, scenes) {
  const parts = [];
  if (bible) {
    parts.push('=== STORY BIBLE ===');
    parts.push(bible);
  }
  if (scenes?.length) {
    parts.push('=== APPROVED SCENES ===');
    scenes.forEach((s, i) => {
      parts.push(`--- Scene ${i + 1} ---`);
      parts.push(s);
    });
  }
  return parts.join('\n\n');
}

function buildCharSummary(chars) {
  if (!chars?.length) return 'No characters yet.';
  return chars
    .map(
      (c) =>
        `${c.name} (${c.role}): traits=${c.personality} | goals=${c.workingMemory?.goals || '?'} | status=${c.workingMemory?.status || '?'}`,
    )
    .join('\n');
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
  const [characters, setCharacters] = useState([]);
  const [chat, setChat] = useState([]);
  const [editableDraft, setEditableDraft] = useState('');
  const [contOptions, setContOptions] = useState([]);
  const [setupInput, setSetupInput] = useState('');
  const [customInput, setCustomInput] = useState('');
  const [sceneNum, setSceneNum] = useState(1);

  const [prompts, setPrompts] = useState(DEFAULT_PROMPTS);
  const [adminOpen, setAdminOpen] = useState(false);
  const [characterCornerOpen, setCharacterCornerOpen] = useState(false);
  const [activeCharacter, setActiveCharacter] = useState(null);
  const [characterEditorOpen, setCharacterEditorOpen] = useState(false);
  const [workingMemoryJson, setWorkingMemoryJson] = useState('');
  const [episodicJson, setEpisodicJson] = useState('');

  const baseUrl = useMemo(() => `http://${serverHost.trim()}:${serverPort.trim()}`, [serverHost, serverPort]);

  const addMsg = (role, content) => setChat((prev) => [...prev, { id: `${Date.now()}-${Math.random()}`, role, content }]);
  const sys = (content) => addMsg('System', content);

  async function persist(next) {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  }

  async function fetchModels() {
    try {
      const res = await fetch(`${baseUrl}/api/tags`);
      const data = await res.json();
      const names = (data.models || []).map((m) => m.name).filter(Boolean);
      setModels(names);
      if (!model && names[0]) setModel(names[0]);
      if (!names.length) Alert.alert('No models found', 'Your Ollama server responded, but no models were listed.');
    } catch (e) {
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

  useEffect(() => {
    (async () => {
      try {
        const raw = await AsyncStorage.getItem(STORAGE_KEY);
        if (raw) {
          const s = JSON.parse(raw);
          setServerHost(s.serverHost || '192.168.1.100');
          setServerPort(s.serverPort || '11434');
          setModel(s.model || '');
          setStoryBible(s.storyBible || '');
          setApproved(s.approved || []);
          setCharacters((s.characters || []).map(normalizeCharacter));
          setSceneNum(s.sceneNum || 1);
          setContOptions(s.contOptions || []);
          setPrompts(s.prompts || DEFAULT_PROMPTS);
          setPhase(s.storyBible ? PHASE.CONT_CHOICE : PHASE.SETUP);
        } else {
          setPhase(PHASE.SETUP);
        }
      } catch {
        setPhase(PHASE.SETUP);
      }
    })();
  }, []);

  async function handleSetup() {
    if (!setupInput.trim() || isBusy) return;
    setIsBusy(true);
    try {
      sys('The Author and Editor are entering the room...');
      const authorOpen = await callOllama(
        prompts.setupAuthorSystem,
        fill(prompts.setupAuthorUser, { premise: setupInput.trim() }),
      );
      addMsg('Author', authorOpen);

      const edResp = await callOllama(
        prompts.setupEditorSystem,
        fill(prompts.setupEditorUser, { authorOpen }),
      );
      addMsg('Editor', edResp);

      const match = edResp.match(/=== STORY BIBLE ===([\s\S]*?)=== END BIBLE ===/);
      const bible = match ? match[1].trim() : edResp;

      const firstOpt = [
        {
          label: 'Begin Scene 1',
          direction: 'Open the story, establishing the world and introducing at least two characters from the story bible.',
          pov: 'Author',
        },
      ];
      setStoryBible(bible);
      setContOptions(firstOpt);
      setPhase(PHASE.CONT_CHOICE);
      await persist({
        serverHost,
        serverPort,
        model,
        prompts,
        storyBible: bible,
        approved: [],
        characters: [],
        sceneNum: 1,
        contOptions: firstOpt,
      });
    } catch (e) {
      sys(`Setup failed: ${e.message}`);
    } finally {
      setIsBusy(false);
    }
  }

  async function runSceneCycle(direction, chars, scenes, bible, num) {
    setIsBusy(true);
    try {
      const ctx = buildStoryCtx(bible, scenes);
      const charSum = buildCharSummary(chars);

      setPhase(PHASE.DRAFTING);
      const draft = await callOllama(
        fill(prompts.draftSystem, { context: ctx, characterSummary: charSum }),
        fill(prompts.draftUser, { sceneNum: num, direction }),
        { maxTokens: 1600 },
      );
      addMsg('Author', `**[Scene ${num} — First Draft]**\n\n${draft}`);

      setPhase(PHASE.ED_REVIEW);
      const edReview = await callOllama(
        fill(prompts.editorReviewSystem, { context: ctx }),
        fill(prompts.editorReviewUser, { draft }),
      );
      addMsg('Editor', edReview);

      setPhase(PHASE.CHAR_REACT);
      const extraction = await callOllama(
        prompts.extractCharactersSystem,
        fill(prompts.extractCharactersUser, { knownNames: chars.map((c) => c.name).join(', ') || 'none', draft }),
      );

      const extractedNames = tryParseJson(extraction, []).filter((n) => typeof n === 'string');
      const existingKeys = new Set(chars.map((c) => normalizeName(c.name)));
      const uniqueNewNames = [...new Set(extractedNames.map((n) => n.trim()).filter(Boolean))].filter(
        (n) => !existingKeys.has(normalizeName(n)),
      );

      const newChars = [];
      for (const name of uniqueNewNames.slice(0, 6)) {
        const profileRaw = await callOllama(
          prompts.profileSystem,
          fill(prompts.profileUser, { context: ctx, name, draft }),
        );
        const p = tryParseJson(profileRaw, {});
        newChars.push(
          normalizeCharacter({
            name,
            role: p.role,
            backstory: p.backstory,
            personality: p.personality,
            workingMemory: p.workingMemory,
            episodicMemory: [],
          }),
        );
      }

      const allChars = mergeCharacters(chars, newChars);

      for (const c of allChars) {
        const reaction = await callOllama(
          fill(prompts.characterReactionSystem, {
            name: c.name,
            role: c.role,
            personality: c.personality,
            backstory: c.backstory,
            status: c.workingMemory.status,
            goals: c.workingMemory.goals,
            relationships: c.workingMemory.relationships,
            episodicSummary: c.episodicMemory.slice(-4).join('; ') || 'no prior scenes',
          }),
          fill(prompts.characterReactionUser, { draft }),
          { maxTokens: 500 },
        );
        addMsg(c.name, reaction);
      }

      setPhase(PHASE.AUTH_REVISE);
      const revised = await callOllama(
        fill(prompts.reviseSystem, { context: ctx, characterSummary: buildCharSummary(allChars) }),
        fill(prompts.reviseUser, {
          draft,
          allFeedback: `EDITOR FEEDBACK:\n${edReview}\n\nCHARACTERS IN THIS SCENE: ${allChars.map((c) => c.name).join(', ')}`,
        }),
        { maxTokens: 1800 },
      );

      addMsg('Author', `**[Scene ${num} — Revised]**\n\n${revised}`);
      setEditableDraft(revised);
      setCharacters(allChars);
      setPhase(PHASE.USER_EDIT);

      await persist({
        serverHost,
        serverPort,
        model,
        prompts,
        storyBible: bible,
        approved: scenes,
        characters: allChars,
        sceneNum: num,
        contOptions: [],
      });
    } catch (e) {
      sys(`Scene cycle failed: ${e.message}`);
      setPhase(PHASE.CONT_CHOICE);
    } finally {
      setIsBusy(false);
    }
  }

  async function handleAccept() {
    if (!editableDraft.trim() || isBusy) return;
    setIsBusy(true);
    try {
      const newApproved = [...approved, editableDraft.trim()];
      const newNum = sceneNum + 1;
      const updated = [];
      for (const c of characters) {
        const memRaw = await callOllama(
          prompts.memoryUpdateSystem,
          fill(prompts.memoryUpdateUser, {
            name: c.name,
            workingMemory: JSON.stringify(c.workingMemory),
            episodicMemory: c.episodicMemory.slice(-5).join('; ') || 'none',
            scene: editableDraft,
          }),
        );
        const upd = tryParseJson(memRaw, null);
        if (upd) {
          updated.push(
            normalizeCharacter({
              ...c,
              workingMemory: upd.workingMemory || c.workingMemory,
              episodicMemory: [...(c.episodicMemory || []), upd.newEpisodicEntry || `Scene ${sceneNum} passed.`],
            }),
          );
        } else {
          updated.push(normalizeCharacter({ ...c, episodicMemory: [...(c.episodicMemory || []), `Scene ${sceneNum} passed.`] }));
        }
      }

      const ctx = buildStoryCtx(storyBible, newApproved);
      const optsRaw = await callOllama(
        fill(prompts.continuationSystem, { context: ctx, characterSummary: buildCharSummary(updated) }),
        fill(prompts.continuationUser, { sceneNum: newNum }),
        { maxTokens: 900 },
      );
      const opts = tryParseJson(optsRaw, []);

      setApproved(newApproved);
      setCharacters(mergeCharacters(updated, []));
      setSceneNum(newNum);
      setChat([{ id: `${Date.now()}`, role: 'System', content: `Scene ${sceneNum} accepted.` }]);
      setContOptions(
        Array.isArray(opts) && opts.length
          ? opts
          : [{ label: 'Continue naturally', direction: 'Continue the story from where the last scene ended.', pov: 'Author' }],
      );
      setPhase(PHASE.CONT_CHOICE);
      await persist({
        serverHost,
        serverPort,
        model,
        prompts,
        storyBible,
        approved: newApproved,
        characters: updated,
        sceneNum: newNum,
        contOptions: Array.isArray(opts) && opts.length ? opts : contOptions,
      });
    } catch (e) {
      sys(`Accept failed: ${e.message}`);
    } finally {
      setIsBusy(false);
    }
  }

  async function handleContinue(direction) {
    if (!direction.trim() || isBusy) return;
    setChat([]);
    await runSceneCycle(direction, characters, approved, storyBible, sceneNum);
  }

  function openCharacterEditor(character) {
    const normalized = normalizeCharacter(character);
    setActiveCharacter(normalized);
    setWorkingMemoryJson(JSON.stringify(normalized.workingMemory, null, 2));
    setEpisodicJson(JSON.stringify(normalized.episodicMemory, null, 2));
    setCharacterEditorOpen(true);
  }

  function saveCharacterEdits() {
    if (!activeCharacter) return;
    const nextWorking = tryParseJson(workingMemoryJson, null);
    const nextEpisodic = tryParseJson(episodicJson, null);
    if (!nextWorking || !Array.isArray(nextEpisodic)) {
      Alert.alert('Invalid JSON', 'workingMemory must be JSON object and episodicMemory must be a JSON array.');
      return;
    }

    const updated = mergeCharacters(
      characters.map((c) =>
        normalizeName(c.name) === normalizeName(activeCharacter.name)
          ? normalizeCharacter({ ...c, workingMemory: nextWorking, episodicMemory: nextEpisodic })
          : c,
      ),
      [],
    );
    setCharacters(updated);
    setCharacterEditorOpen(false);
  }

  function savePromptsAndClose() {
    setAdminOpen(false);
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

        {phase === PHASE.SETUP && (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Setup Story Premise</Text>
            <TextInput value={setupInput} onChangeText={setSetupInput} style={styles.textarea} multiline />
            <Pressable style={styles.button} onPress={handleSetup}>
              <Text style={styles.buttonText}>{isBusy ? 'Opening...' : 'Open Story Room'}</Text>
            </Pressable>
          </View>
        )}

        {storyBible ? (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Story Bible</Text>
            <Text style={styles.body}>{storyBible}</Text>
          </View>
        ) : null}

        {approved.map((s, i) => (
          <View key={`${i}-${s.length}`} style={styles.card}>
            <Text style={styles.cardTitle}>Scene {i + 1}</Text>
            <Text style={styles.body}>{s}</Text>
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
            <Pressable style={styles.button} onPress={handleAccept}>
              <Text style={styles.buttonText}>{isBusy ? 'Accepting...' : 'Accept Scene & Continue'}</Text>
            </Pressable>
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
            <TextInput
              value={customInput}
              onChangeText={setCustomInput}
              placeholder="Or enter your own direction"
              style={styles.input}
            />
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
                <TextInput
                  value={prompts[k]}
                  onChangeText={(v) => setPrompts((prev) => ({ ...prev, [k]: v }))}
                  multiline
                  style={styles.textarea}
                />
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
