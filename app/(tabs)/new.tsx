import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { AudioModule, RecordingPresets, setAudioModeAsync, useAudioRecorder } from 'expo-audio';
import {
  ExpoSpeechRecognitionModule,
  useSpeechRecognitionEvent,
} from 'expo-speech-recognition';
import {
  Client,
  DraftItem,
  createClient,
  createInvoice,
  getSetting,
  getTaxRates,
  listClients,
  setInvoicePaymentTerms,
} from '../../lib/db';
import { formatCents, parseDollarsToCents, todayISO } from '../../lib/format';
import { refreshReminders } from '../../lib/reminders';
import { getApiKey, getCustomApiSecrets, getGeminiKey } from '../../lib/secrets';
import { voiceToInvoice } from '../../lib/openai';
import { extractInvoiceWithCustomApi } from '../../lib/customApi';
import { extractInvoiceWithGemini } from '../../lib/gemini';
import { parseTranscriptLocal } from '../../lib/parseLocal';
import { VoiceProvider, getProviderInfo, getVoiceProvider, isVoiceReady } from '../../lib/voice';
import { theme, spacing } from '../../lib/theme';
import { Button, Card, EmptyState, Field, Screen, Title } from '../../components/ui';

type Phase = 'idle' | 'recording' | 'listening' | 'processing' | 'review';
type ProcStage = 'transcribing' | 'extracting' | null;

function emptyItem(): DraftItem {
  return { description: '', quantity: '1', rate: '' };
}

function addDaysISO(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

export default function NewInvoiceScreen() {
  const [phaseState, setPhaseState] = useState<Phase>('idle');
  const phaseRef = useRef<Phase>('idle');
  const setPhase = (p: Phase) => {
    phaseRef.current = p;
    setPhaseState(p);
  };
  const phase = phaseState;

  const [procStage, setProcStage] = useState<ProcStage>(null);
  const [provider, setProvider] = useState<VoiceProvider>('ondevice');
  const [voiceReady, setVoiceReady] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [recSecs, setRecSecs] = useState(0);
  const [liveTranscript, setLiveTranscript] = useState('');
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const transcriptRef = useRef('');
  const finalRef = useRef('');
  const cancelledRef = useRef(false);
  const finalizeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [clients, setClients] = useState<Client[]>([]);
  const [clientId, setClientId] = useState<number | null>(null);
  const [newClientName, setNewClientName] = useState('');
  const [items, setItems] = useState<DraftItem[]>([emptyItem()]);
  const [gstPct, setGstPct] = useState('5');
  const [pstPct, setPstPct] = useState('6');
  const [notes, setNotes] = useState('');
  const [dueDate, setDueDate] = useState(addDaysISO(14));
  const [paymentTerms, setPaymentTerms] = useState('Net 15');
  const [saving, setSaving] = useState(false);

  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);

  // ---------- Speech recognition events (on-device & Gemini providers) ----------

  useSpeechRecognitionEvent('result', (event) => {
    const t = event.results?.[0]?.transcript ?? '';
    if (!t) return;
    if (event.isFinal) {
      // Continuous mode yields a final result per utterance; keep them all.
      finalRef.current = (finalRef.current ? finalRef.current + ' ' : '') + t.trim();
      transcriptRef.current = finalRef.current;
    } else {
      transcriptRef.current = (finalRef.current ? finalRef.current + ' ' : '') + t.trim();
    }
    setLiveTranscript(transcriptRef.current);
  });

  useSpeechRecognitionEvent('end', () => {
    if (cancelledRef.current) {
      cancelledRef.current = false;
      return;
    }
    if (phaseRef.current === 'listening') {
      finalizeListening();
    }
  });

  useSpeechRecognitionEvent('error', (event) => {
    if (phaseRef.current === 'listening') {
      const msg = event.message || event.error || 'unknown error';
      // "no-speech" just means silence — treat like tapping Done with nothing heard.
      if (String(event.error).includes('no-speech') && !transcriptRef.current.trim()) {
        setError("Didn't catch that — try again, speaking clearly.");
      } else if (transcriptRef.current.trim()) {
        finalizeListening();
        return;
      } else {
        setError(`Speech recognition had a problem (${msg}). Try again.`);
      }
      setPhase('idle');
    }
  });

  const refresh = useCallback(async () => {
    setClients(listClients());
    setProvider(getVoiceProvider());
    setVoiceReady(await isVoiceReady());
    const rates = getTaxRates();
    setGstPct(String(rates.gst * 100));
    setPstPct(String(rates.pst * 100));
    setDueDate(addDaysISO(parseInt(getSetting('default_due_days', '14'), 10) || 14));
    setPaymentTerms(getSetting('default_payment_terms', 'Net 15'));
  }, []);

  useFocusEffect(
    useCallback(() => {
      refresh();
    }, [refresh])
  );

  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      if (finalizeTimerRef.current) clearTimeout(finalizeTimerRef.current);
    };
  }, []);

  const startTimer = () => {
    setRecSecs(0);
    timerRef.current = setInterval(() => setRecSecs((s) => s + 1), 1000);
  };
  const stopTimer = () => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  };

  // ---------- Voice: OpenAI path (record audio -> Whisper) ----------

  const startRecording = async () => {
    setError(null);
    try {
      const perm = await AudioModule.requestRecordingPermissionsAsync();
      if (!perm.granted) {
        setError('Microphone permission is needed to dictate invoices. Allow it in your phone settings.');
        return;
      }
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
      await recorder.prepareToRecordAsync();
      recorder.record();
      startTimer();
      setPhase('recording');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not start recording.');
    }
  };

  const stopRecording = async () => {
    stopTimer();
    setPhase('processing');
    setProcStage('transcribing');
    try {
      await recorder.stop();
      const uri = recorder.uri;
      if (!uri) throw new Error('Recording failed — no audio was captured.');
      const key = await getApiKey();
      if (!key) throw new Error('No OpenAI API key. Add one in Settings first.');
      const { extracted } = await voiceToInvoice(uri, key, setProcStage);
      applyExtracted(extracted.clientName, extracted.notes, extracted.items);
      setPhase('review');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong processing that recording.');
      setPhase('idle');
    } finally {
      setProcStage(null);
    }
  };

  const cancelRecording = async () => {
    stopTimer();
    try {
      await recorder.stop();
    } catch {
      /* not recording */
    }
    setPhase('idle');
  };

  // ---------- Voice: on-device / Gemini path (live speech recognition) ----------

  const startListening = async () => {
    setError(null);
    try {
      const perm = await ExpoSpeechRecognitionModule.requestPermissionsAsync();
      if (!perm.granted) {
        setError('Microphone and speech recognition permission are needed. Allow them in your phone settings.');
        return;
      }
      if (!ExpoSpeechRecognitionModule.isRecognitionAvailable()) {
        setError("This phone doesn't have speech recognition available right now. Try the OpenAI option in Settings.");
        return;
      }
      transcriptRef.current = '';
      finalRef.current = '';
      setLiveTranscript('');
      cancelledRef.current = false;
      setPhase('listening');
      startTimer();
      ExpoSpeechRecognitionModule.start({
        lang: 'en-US',
        interimResults: true,
        // Keep listening across pauses instead of stopping at the first
        // silence — the user taps Done when finished.
        continuous: true,
        androidIntentOptions: {
          // Tolerate longer thinking-pauses mid-dictation (ms).
          EXTRA_SPEECH_INPUT_COMPLETE_SILENCE_LENGTH_MILLIS: 6000,
          EXTRA_SPEECH_INPUT_POSSIBLY_COMPLETE_SILENCE_LENGTH_MILLIS: 4000,
          EXTRA_SPEECH_INPUT_MINIMUM_LENGTH_MILLIS: 3000,
        },
      });
    } catch (e) {
      stopTimer();
      setError(e instanceof Error ? e.message : 'Could not start listening.');
      setPhase('idle');
    }
  };

  const finalizeListening = async () => {
    if (finalizeTimerRef.current) clearTimeout(finalizeTimerRef.current);
    stopTimer();
    const transcript = transcriptRef.current.trim();
    if (!transcript) {
      setError("Didn't catch that — try again, speaking clearly.");
      setPhase('idle');
      return;
    }
    setPhase('processing');
    setProcStage('extracting');
    try {
      if (provider === 'gemini') {
        const key = await getGeminiKey();
        if (!key) throw new Error('No Gemini API key. Add one in Settings first.');
        const extracted = await extractInvoiceWithGemini(transcript, key);
        applyExtracted(extracted.clientName, extracted.notes, extracted.items);
      } else if (provider === 'custom') {
        const cfg = await getCustomApiSecrets();
        if (!cfg) throw new Error('No custom API configured. Add it in Settings first.');
        const extracted = await extractInvoiceWithCustomApi(transcript, cfg);
        applyExtracted(extracted.clientName, extracted.notes, extracted.items);
      } else {
        const extracted = parseTranscriptLocal(transcript);
        applyExtracted(extracted.clientName, extracted.notes, extracted.items);
      }
      setPhase('review');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong building that invoice.');
      setPhase('idle');
    } finally {
      setProcStage(null);
    }
  };

  const stopListening = () => {
    // The 'end' event finalizes. Safety net in case it never fires.
    if (finalizeTimerRef.current) clearTimeout(finalizeTimerRef.current);
    finalizeTimerRef.current = setTimeout(() => {
      if (phaseRef.current === 'listening') finalizeListening();
    }, 4000);
    try {
      ExpoSpeechRecognitionModule.stop();
    } catch {
      finalizeListening();
    }
  };

  const cancelListening = () => {
    cancelledRef.current = true;
    if (finalizeTimerRef.current) clearTimeout(finalizeTimerRef.current);
    stopTimer();
    try {
      ExpoSpeechRecognitionModule.abort();
    } catch {
      /* not listening */
    }
    setLiveTranscript('');
    setPhase('idle');
  };

  const startVoice = () => {
    if (provider === 'openai') startRecording();
    else startListening();
  };

  // ---------- Form ----------

  const applyExtracted = (
    clientName: string,
    extractedNotes: string,
    extractedItems: { description: string; quantity: number; rate: number }[]
  ) => {
    if (clientName) {
      const match = clients.find((c) => c.name.toLowerCase().includes(clientName.toLowerCase()));
      if (match) {
        setClientId(match.id);
        setNewClientName('');
      } else {
        setClientId(null);
        setNewClientName(clientName);
      }
    }
    if (extractedItems.length > 0) {
      setItems(
        extractedItems.map((i) => ({
          description: i.description,
          quantity: String(i.quantity),
          rate: i.rate > 0 ? String(i.rate) : '',
        }))
      );
    }
    if (extractedNotes) setNotes(extractedNotes);
    setPaymentTerms(getSetting('default_payment_terms', 'Net 15'));
  };

  const updateItem = (index: number, patch: Partial<DraftItem>) => {
    setItems((prev) => prev.map((it, i) => (i === index ? { ...it, ...patch } : it)));
  };

  const removeItem = (index: number) => {
    setItems((prev) => (prev.length > 1 ? prev.filter((_, i) => i !== index) : [emptyItem()]));
  };

  const parsedItems = items
    .filter((i) => i.description.trim())
    .map((i) => ({
      description: i.description.trim(),
      quantity: parseFloat(i.quantity) > 0 ? parseFloat(i.quantity) : 1,
      rate_cents: parseDollarsToCents(i.rate),
    }));

  const subtotal = parsedItems.reduce((s, i) => s + Math.round(i.quantity * i.rate_cents), 0);
  const gst = Math.round(subtotal * ((parseFloat(gstPct) || 0) / 100));
  const pst = Math.round(subtotal * ((parseFloat(pstPct) || 0) / 100));

  const save = async () => {
    setError(null);
    let resolvedClientId = clientId;
    if (!resolvedClientId) {
      if (!newClientName.trim()) {
        setError('Pick a client or type a new client name.');
        return;
      }
      resolvedClientId = createClient(newClientName.trim()).id;
      setClients(listClients());
    }
    if (parsedItems.length === 0) {
      setError('Add at least one line item with a description.');
      return;
    }
    setSaving(true);
    try {
      const invoice = createInvoice({
        clientId: resolvedClientId,
        items: parsedItems,
        gstRate: (parseFloat(gstPct) || 0) / 100,
        pstRate: (parseFloat(pstPct) || 0) / 100,
        notes,
        dueDate: dueDate || todayISO(),
        status: 'unpaid',
      });
      if (paymentTerms.trim()) setInvoicePaymentTerms(invoice.id, paymentTerms.trim());
      resetForm();
      refreshReminders();
      router.push(`/invoice/${invoice.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save the invoice.');
    } finally {
      setSaving(false);
    }
  };

  const resetForm = () => {
    setPhase('idle');
    setItems([emptyItem()]);
    setNotes('');
    setNewClientName('');
    setClientId(null);
    setError(null);
    setLiveTranscript('');
    const rates = getTaxRates();
    setGstPct(String(rates.gst * 100));
    setPstPct(String(rates.pst * 100));
    setDueDate(addDaysISO(parseInt(getSetting('default_due_days', '14'), 10) || 14));
    setPaymentTerms(getSetting('default_payment_terms', 'Net 15'));
  };

  const confirmDiscard = () => {
    Alert.alert('Discard invoice?', 'Your recording and entries will be lost.', [
      { text: 'Keep editing', style: 'cancel' },
      { text: 'Discard', style: 'destructive', onPress: resetForm },
    ]);
  };

  // ---------- Render ----------

  const providerInfo = getProviderInfo(provider);
  const keyHint =
    provider === 'openai'
      ? 'Add your OpenAI key in Settings to enable voice.'
      : provider === 'gemini'
        ? 'Add your free Gemini key in Settings to enable voice.'
        : provider === 'custom'
          ? 'Add your custom API details in Settings to enable voice.'
          : null;
  const keyName = provider === 'gemini' ? 'Gemini' : provider === 'custom' ? 'custom API' : 'OpenAI';

  return (
    <Screen style={{ padding: 0 }}>
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <View style={styles.header}>
          <Title>New Invoice</Title>
        </View>

        {voiceReady === false && keyHint && (
          <Card style={styles.keyCard}>
            <Text style={styles.keyTitle}>Voice needs {keyName === 'custom API' ? 'a custom API' : `a ${keyName}`} key</Text>
            <Text style={styles.keyText}>
              {keyHint} Until then you can still type invoices manually below.
            </Text>
            <Button title="Open Settings" variant="secondary" onPress={() => router.push('/(tabs)/settings')} />
          </Card>
        )}

        {error && (
          <Card style={styles.errorCard}>
            <Text style={styles.errorText}>{error}</Text>
          </Card>
        )}

        {/* ---- Voice capture ---- */}
        {phase !== 'review' && (
          <Card style={styles.voiceCard}>
            {phase === 'idle' && (
              <>
                <TouchableOpacity
                  style={[styles.micButton, !voiceReady && styles.micDisabled]}
                  onPress={startVoice}
                  activeOpacity={0.8}
                  disabled={!voiceReady}
                >
                  <Text style={styles.micText}>🎙</Text>
                </TouchableOpacity>
                <Text style={styles.voiceHint}>
                  {voiceReady
                    ? `Tap and say the job — using ${providerInfo.name}.`
                    : keyHint ?? 'Voice is getting ready…'}
                </Text>
                <Text style={styles.voiceExample}>
                  “Furnace filter change for John Smith, 85 dollars, plus two hours labour at 90 an hour.”
                </Text>
                <Button title="Type it instead" variant="ghost" onPress={() => setPhase('review')} />
              </>
            )}

            {phase === 'recording' && (
              <>
                <View style={[styles.micButton, styles.micRecording]}>
                  <Text style={styles.micText}>●</Text>
                </View>
                <Text style={styles.recTime}>
                  {String(Math.floor(recSecs / 60)).padStart(1, '0')}:{String(recSecs % 60).padStart(2, '0')}
                </Text>
                <Text style={styles.voiceHint}>Recording… tap Done when finished.</Text>
                <View style={styles.recActions}>
                  <Button title="Cancel" variant="secondary" onPress={cancelRecording} style={styles.recBtn} />
                  <Button title="Done ✓" onPress={stopRecording} style={styles.recBtn} />
                </View>
              </>
            )}

            {phase === 'listening' && (
              <>
                <View style={[styles.micButton, styles.micRecording]}>
                  <Text style={styles.micText}>🎙</Text>
                </View>
                <Text style={styles.recTime}>
                  {String(Math.floor(recSecs / 60)).padStart(1, '0')}:{String(recSecs % 60).padStart(2, '0')}
                </Text>
                <Text style={styles.voiceHint}>Listening… take your time, tap Done when finished.</Text>
                {liveTranscript ? (
                  <Text style={styles.liveText}>“{liveTranscript}”</Text>
                ) : null}
                <View style={styles.recActions}>
                  <Button title="Cancel" variant="secondary" onPress={cancelListening} style={styles.recBtn} />
                  <Button title="Done ✓" onPress={stopListening} style={styles.recBtn} />
                </View>
              </>
            )}

            {phase === 'processing' && (
              <>
                <Text style={styles.procTitle}>
                  {procStage === 'transcribing' ? 'Transcribing…' : 'Building your invoice…'}
                </Text>
                <Text style={styles.voiceHint}>This usually takes a few seconds.</Text>
              </>
            )}
          </Card>
        )}

        {/* ---- Review / edit form ---- */}
        {phase === 'review' && (
          <>
            <Text style={styles.sectionTitle}>Client</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.clientRow}>
              {clients.map((c) => (
                <TouchableOpacity
                  key={c.id}
                  onPress={() => {
                    setClientId(c.id);
                    setNewClientName('');
                  }}
                  style={[styles.clientChip, clientId === c.id && styles.clientChipActive]}
                  activeOpacity={0.7}
                >
                  <Text style={[styles.clientChipText, clientId === c.id && styles.clientChipTextActive]}>
                    {c.name}
                  </Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
            <Field
              voice label="Or new client name"
              placeholder="e.g. John Smith"
              value={newClientName}
              onChangeText={(t) => {
                setNewClientName(t);
                if (t) setClientId(null);
              }}
            />
            {clients.length === 0 && <EmptyState message="No clients yet — type the client name above and they'll be saved with this invoice." />}

            <Text style={styles.sectionTitle}>Line items</Text>
            {items.map((item, i) => (
              <Card key={i}>
                <Field
                  voice
                  label={`Item ${i + 1}`}
                  placeholder="What did you do?"
                  value={item.description}
                  onChangeText={(t) => updateItem(i, { description: t })}
                />
                <View style={styles.itemRow}>
                  <Field
                    label="Qty"
                    keyboardType="decimal-pad"
                    value={item.quantity}
                    onChangeText={(t) => updateItem(i, { quantity: t })}
                    style={{ flex: 1 }}
                  />
                  <Field
                    label="Rate ($)"
                    keyboardType="decimal-pad"
                    placeholder="0.00"
                    value={item.rate}
                    onChangeText={(t) => updateItem(i, { rate: t })}
                    style={{ flex: 2, marginLeft: spacing.sm }}
                  />
                  <TouchableOpacity onPress={() => removeItem(i)} style={styles.removeBtn} activeOpacity={0.7}>
                    <Text style={styles.removeText}>✕</Text>
                  </TouchableOpacity>
                </View>
              </Card>
            ))}
            <Button title="+ Add item" variant="secondary" onPress={() => setItems((p) => [...p, emptyItem()])} />

            <Text style={styles.sectionTitle}>Taxes</Text>
            <View style={styles.itemRow}>
              <Field
                label="GST %"
                keyboardType="decimal-pad"
                value={gstPct}
                onChangeText={setGstPct}
                style={{ flex: 1 }}
              />
              <Field
                label="PST %"
                keyboardType="decimal-pad"
                value={pstPct}
                onChangeText={setPstPct}
                style={{ flex: 1, marginLeft: spacing.sm }}
              />
            </View>

            <Card>
              <View style={styles.totalRow}>
                <Text style={styles.totalLabel}>Subtotal</Text>
                <Text style={styles.totalValue}>{formatCents(subtotal)}</Text>
              </View>
              <View style={styles.totalRow}>
                <Text style={styles.totalLabel}>GST</Text>
                <Text style={styles.totalValue}>{formatCents(gst)}</Text>
              </View>
              <View style={styles.totalRow}>
                <Text style={styles.totalLabel}>PST</Text>
                <Text style={styles.totalValue}>{formatCents(pst)}</Text>
              </View>
              <View style={[styles.totalRow, styles.grandRow]}>
                <Text style={styles.grandLabel}>Total</Text>
                <Text style={styles.grandValue}>{formatCents(subtotal + gst + pst)}</Text>
              </View>
            </Card>

            <Field
              voice
              label="Notes (optional)"
              placeholder="Anything the client should know…"
              value={notes}
              onChangeText={setNotes}
              multiline
              numberOfLines={3}
            />
            <Field label="Due date (YYYY-MM-DD)" value={dueDate} onChangeText={setDueDate} placeholder={todayISO()} />
            <Field
              label="Payment terms"
              placeholder="e.g. Net 15"
              value={paymentTerms}
              onChangeText={setPaymentTerms}
            />

            <View style={styles.actions}>
              <Button title="Save Invoice" onPress={save} loading={saving} style={styles.saveBtn} />
              <Button title="Discard" variant="danger" onPress={confirmDiscard} />
            </View>
          </>
        )}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  scroll: { padding: spacing.md, paddingBottom: spacing.xl },
  header: { marginBottom: spacing.sm },
  keyCard: { borderColor: theme.warning },
  keyTitle: { color: theme.text, fontSize: 17, fontWeight: '700', marginBottom: 6 },
  keyText: { color: theme.muted, fontSize: 14, lineHeight: 20, marginBottom: spacing.sm },
  errorCard: { borderColor: theme.danger },
  errorText: { color: theme.danger, fontSize: 14, lineHeight: 20 },
  voiceCard: { alignItems: 'center', paddingVertical: spacing.lg },
  micButton: {
    width: 120,
    height: 120,
    borderRadius: 60,
    backgroundColor: theme.accent,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.md,
  },
  micDisabled: { opacity: 0.35 },
  micRecording: { backgroundColor: theme.danger },
  micText: { fontSize: 48 },
  voiceHint: { color: theme.muted, fontSize: 15, textAlign: 'center', marginBottom: 6, paddingHorizontal: spacing.md },
  voiceExample: {
    color: theme.muted,
    fontSize: 13,
    fontStyle: 'italic',
    textAlign: 'center',
    marginBottom: spacing.md,
    paddingHorizontal: spacing.lg,
  },
  liveText: {
    color: theme.text,
    fontSize: 15,
    fontStyle: 'italic',
    textAlign: 'center',
    marginVertical: spacing.sm,
    paddingHorizontal: spacing.md,
  },
  recTime: { color: theme.text, fontSize: 40, fontWeight: '800', marginBottom: 4, fontVariant: ['tabular-nums'] },
  recActions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md },
  recBtn: { minWidth: 130 },
  procTitle: { color: theme.text, fontSize: 20, fontWeight: '700', marginBottom: 6 },
  sectionTitle: { color: theme.text, fontSize: 19, fontWeight: '700', marginTop: spacing.lg, marginBottom: spacing.sm },
  clientRow: { marginBottom: spacing.sm },
  clientChip: {
    paddingHorizontal: 18,
    paddingVertical: 12,
    borderRadius: 999,
    backgroundColor: theme.surface,
    borderWidth: 1,
    borderColor: theme.border,
    marginRight: 8,
  },
  clientChipActive: { backgroundColor: theme.accent, borderColor: theme.accent },
  clientChipText: { color: theme.text, fontWeight: '600', fontSize: 15 },
  clientChipTextActive: { color: '#0b0f0d' },
  itemRow: { flexDirection: 'row', alignItems: 'flex-end' },
  removeBtn: {
    width: 52,
    height: 52,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: spacing.sm,
    marginBottom: 10,
    backgroundColor: theme.surface2,
  },
  removeText: { color: theme.danger, fontSize: 18, fontWeight: '700' },
  totalRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4 },
  totalLabel: { color: theme.muted, fontSize: 15 },
  totalValue: { color: theme.text, fontSize: 15, fontWeight: '600', fontVariant: ['tabular-nums'] },
  grandRow: { borderTopWidth: 1, borderTopColor: theme.border, marginTop: 6, paddingTop: 10 },
  grandLabel: { color: theme.text, fontSize: 18, fontWeight: '800' },
  grandValue: { color: theme.accent, fontSize: 22, fontWeight: '800', fontVariant: ['tabular-nums'] },
  actions: { marginTop: spacing.lg, gap: spacing.sm },
  saveBtn: { minHeight: 60 },
});
