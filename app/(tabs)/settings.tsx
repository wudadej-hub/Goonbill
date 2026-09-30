import { useCallback, useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { getSetting, setSetting } from '../../lib/db';
import { getApiKey, getCustomApiSecrets, getGeminiKey, setApiKey, setCustomApiSecrets, setGeminiKey } from '../../lib/secrets';
import { VOICE_PROVIDERS, VoiceProvider, getVoiceProvider, setVoiceProvider } from '../../lib/voice';
import { supabaseConfigured } from '../../lib/supabase';
import {
  syncSignUp,
  syncSignIn,
  syncSignOut,
  syncUser,
  syncNow,
  lastSyncAt,
  pendingPushCount,
  SyncUser,
} from '../../lib/sync';
import { stripeConfigured } from '../../lib/payments';
import { refreshReminders, reminderDays } from '../../lib/reminders';
import { theme, spacing } from '../../lib/theme';
import { Button, Card, Field, Screen, Title } from '../../components/ui';

export default function SettingsScreen() {
  const [businessName, setBusinessName] = useState('');
  const [businessAddress, setBusinessAddress] = useState('');
  const [businessPhone, setBusinessPhone] = useState('');
  const [businessEmail, setBusinessEmail] = useState('');
  const [gstPct, setGstPct] = useState('5');
  const [pstPct, setPstPct] = useState('6');
  const [dueDays, setDueDays] = useState('14');
  const [paymentMethods, setPaymentMethods] = useState('');
  const [defaultPaymentTerms, setDefaultPaymentTerms] = useState('Net 15');
  const [defaultPaymentSchedule, setDefaultPaymentSchedule] = useState('');
  const [defaultLateFees, setDefaultLateFees] = useState('');
  const [defaultScopePolicy, setDefaultScopePolicy] = useState('');
  const [provider, setProvider] = useState<VoiceProvider>('ondevice');
  const [openaiInput, setOpenaiInput] = useState('');
  const [openaiSaved, setOpenaiSaved] = useState(false);
  const [geminiInput, setGeminiInput] = useState('');
  const [geminiSaved, setGeminiSaved] = useState(false);
  const [customBaseUrl, setCustomBaseUrl] = useState('');
  const [customKeyInput, setCustomKeyInput] = useState('');
  const [customModel, setCustomModel] = useState('');
  const [customSaved, setCustomSaved] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  // Cloud sync
  const [cloudReady, setCloudReady] = useState(false);
  const [syncEmail, setSyncEmail] = useState('');
  const [syncPassword, setSyncPassword] = useState('');
  const [account, setAccount] = useState<SyncUser | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [lastSync, setLastSync] = useState(0);
  // Stripe
  const [stripeKey, setStripeKey] = useState('');
  const [stripeReady, setStripeReady] = useState(false);
  // Other online payment options
  const [paypalMe, setPaypalMe] = useState('');
  const [interacEmail, setInteracEmail] = useState('');
  const [cryptoBtc, setCryptoBtc] = useState('');
  const [cryptoEth, setCryptoEth] = useState('');
  // Reminders
  const [remindersOn, setRemindersOn] = useState(true);
  const [reminderDaysText, setReminderDaysText] = useState('0,3,7,14');

  const load = useCallback(async () => {
    setBusinessName(getSetting('business_name'));
    setBusinessAddress(getSetting('business_address'));
    setBusinessPhone(getSetting('business_phone'));
    setBusinessEmail(getSetting('business_email'));
    setGstPct(String((parseFloat(getSetting('gst_rate', '0.05')) || 0) * 100));
    setPstPct(String((parseFloat(getSetting('pst_rate', '0.06')) || 0) * 100));
    setDueDays(getSetting('default_due_days', '14'));
    setPaymentMethods(getSetting('payment_methods'));
    setDefaultPaymentTerms(getSetting('default_payment_terms', 'Net 15'));
    setDefaultPaymentSchedule(getSetting('default_payment_schedule'));
    setDefaultLateFees(getSetting('default_late_fees'));
    setDefaultScopePolicy(getSetting('default_scope_policy'));
    setProvider(getVoiceProvider());
    setOpenaiSaved(!!(await getApiKey()));
    setGeminiSaved(!!(await getGeminiKey()));
    setCustomSaved(!!(await getCustomApiSecrets()));
    setOpenaiInput('');
    setGeminiInput('');
    setCustomBaseUrl('');
    setCustomKeyInput('');
    setCustomModel('');
    setCloudReady(supabaseConfigured());
    setStripeKey('');
    setStripeReady(stripeConfigured());
    setPaypalMe(getSetting('paypal_me'));
    setInteracEmail(getSetting('interac_email'));
    setCryptoBtc(getSetting('crypto_btc'));
    setCryptoEth(getSetting('crypto_eth'));
    setRemindersOn(getSetting('reminders_enabled', '1') === '1');
    setRemindersOn(getSetting('reminders_enabled', '1') === '1');
    setReminderDaysText(getSetting('reminder_days', '0,3,7,14'));
    setLastSync(lastSyncAt());
    try {
      setAccount(await syncUser());
    } catch {
      setAccount(null);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const saveAll = async () => {
    setSaving(true);
    setMessage(null);
    try {
      setSetting('business_name', businessName);
      setSetting('business_address', businessAddress);
      setSetting('business_phone', businessPhone);
      setSetting('business_email', businessEmail);
      setSetting('gst_rate', String((parseFloat(gstPct) || 0) / 100));
      setSetting('pst_rate', String((parseFloat(pstPct) || 0) / 100));
      setSetting('default_due_days', dueDays);
      setSetting('payment_methods', paymentMethods);
      setSetting('default_payment_terms', defaultPaymentTerms);
      setSetting('default_payment_schedule', defaultPaymentSchedule);
      setSetting('default_late_fees', defaultLateFees);
      setSetting('default_scope_policy', defaultScopePolicy);
      setVoiceProvider(provider);
      // Stripe publishable key
      if (stripeKey.trim()) {
        setSetting('stripe_publishable_key', stripeKey.trim());
        setStripeKey('');
        setStripeReady(true);
      }
      // Other payment options
      setSetting('paypal_me', paypalMe.trim().replace(/^@/, ''));
      setSetting('interac_email', interacEmail.trim());
      setSetting('crypto_btc', cryptoBtc.trim());
      setSetting('crypto_eth', cryptoEth.trim());
      // Reminder prefs
      setSetting('reminders_enabled', remindersOn ? '1' : '0');
      setSetting('reminder_days', reminderDaysText);
      await refreshReminders();
      if (openaiInput.trim()) {
        await setApiKey(openaiInput.trim());
        setOpenaiInput('');
        setOpenaiSaved(true);
      }
      if (geminiInput.trim()) {
        await setGeminiKey(geminiInput.trim());
        setGeminiInput('');
        setGeminiSaved(true);
      }
      if (customBaseUrl.trim() || customKeyInput.trim() || customModel.trim()) {
        if (!customBaseUrl.trim() || !customKeyInput.trim() || !customModel.trim()) {
          throw new Error('Custom API needs all three: base URL, key, and model.');
        }
        await setCustomApiSecrets({
          baseUrl: customBaseUrl.trim(),
          apiKey: customKeyInput.trim(),
          model: customModel.trim(),
        });
        setCustomBaseUrl('');
        setCustomKeyInput('');
        setCustomModel('');
        setCustomSaved(true);
      }
      setMessage('Settings saved.');
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Could not save settings.');
    } finally {
      setSaving(false);
    }
  };

  const removeOpenaiKey = async () => {
    await setApiKey('');
    setOpenaiSaved(false);
    setOpenaiInput('');
    setMessage('OpenAI key removed.');
  };

  const removeGeminiKey = async () => {
    await setGeminiKey('');
    setGeminiSaved(false);
    setGeminiInput('');
    setMessage('Gemini key removed.');
  };

  const removeCustomApi = async () => {
    await setCustomApiSecrets({ baseUrl: '', apiKey: '', model: '' });
    setCustomSaved(false);
    setCustomBaseUrl('');
    setCustomKeyInput('');
    setCustomModel('');
    setMessage('Custom API removed.');
  };

  const handleSignUp = async () => {
    if (!syncEmail.trim() || !syncPassword) {
      setMessage('Enter an email and password for your sync account.');
      return;
    }
    setSyncing(true);
    try {
      const u = await syncSignUp(syncEmail, syncPassword);
      setAccount(u);
      setSyncPassword('');
      setMessage(`Sync account created for ${u.email}. Check your email to confirm, then sync.`);
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Sign-up failed.');
    } finally {
      setSyncing(false);
    }
  };

  const handleSignIn = async () => {
    if (!syncEmail.trim() || !syncPassword) {
      setMessage('Enter your sync email and password.');
      return;
    }
    setSyncing(true);
    try {
      const u = await syncSignIn(syncEmail, syncPassword);
      setAccount(u);
      setSyncPassword('');
      setMessage(`Signed in as ${u.email}.`);
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Sign-in failed.');
    } finally {
      setSyncing(false);
    }
  };

  const handleSignOut = async () => {
    await syncSignOut();
    setAccount(null);
    setMessage('Signed out of cloud sync.');
  };

  const handleSyncNow = async () => {
    setSyncing(true);
    setMessage(null);
    try {
      const r = await syncNow();
      setLastSync(r.at);
      const pending = pendingPushCount();
      setMessage(
        `Synced. Sent ${r.pushed} change${r.pushed === 1 ? '' : 's'}, received ${r.pulled}.` +
          (pending > 0 ? ` ${pending} still waiting.` : '')
      );
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Sync failed.');
    } finally {
      setSyncing(false);
    }
  };

  const removeStripeKey = () => {
    setSetting('stripe_publishable_key', '');
    setStripeReady(false);
    setMessage('Stripe key removed.');
  };

  return (
    <Screen style={{ padding: 0 }}>
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <Title>Settings</Title>

        <Button
          title="📖 How to use GoonBill"
          variant="secondary"
          onPress={() => router.push('/howto')}
          style={{ marginBottom: spacing.md }}
        />

        {message ? (
          <Card style={styles.msgCard}>
            <Text style={styles.msgText}>{message}</Text>
          </Card>
        ) : null}

        <Text style={styles.sectionTitle}>Business profile</Text>
        <Text style={styles.sectionHint}>This appears on your PDF invoices.</Text>
        <Field voice label="Business name" placeholder="e.g. Desjarlais Contracting" value={businessName} onChangeText={setBusinessName} />
        <Field voice label="Address" placeholder="Street, Town, SK  S0A 0A0" value={businessAddress} onChangeText={setBusinessAddress} />
        <Field label="Phone" placeholder="306-555-0123" keyboardType="phone-pad" value={businessPhone} onChangeText={setBusinessPhone} />
        <Field label="Email" placeholder="you@business.ca" keyboardType="email-address" autoCapitalize="none" value={businessEmail} onChangeText={setBusinessEmail} />
        <Field voice label="Accepted payment methods" placeholder="e.g. E-transfer, cash, cheque" value={paymentMethods} onChangeText={setPaymentMethods} />
        <Text style={styles.sectionHint}>Shown on your PDF invoices.</Text>

        <Text style={styles.sectionTitle}>Quotes & agreements</Text>
        <Text style={styles.sectionHint}>Defaults stamped onto every new quote. Edit per-quote any time.</Text>
        <Field voice label="Default invoice payment terms" placeholder="e.g. Net 15" value={defaultPaymentTerms} onChangeText={setDefaultPaymentTerms} />
        <Field
          voice label="Default payment schedule"
          placeholder="e.g. 50% deposit to schedule, balance on completion"
          multiline
          value={defaultPaymentSchedule}
          onChangeText={setDefaultPaymentSchedule}
        />
        <Field
          voice label="Default late-fee terms"
          placeholder="e.g. 2% per month on overdue balances"
          multiline
          value={defaultLateFees}
          onChangeText={setDefaultLateFees}
        />
        <Field
          voice label="Default scope-change policy"
          placeholder="Extra work needs a written change order first…"
          multiline
          value={defaultScopePolicy}
          onChangeText={setDefaultScopePolicy}
        />

        <Text style={styles.sectionTitle}>Taxes</Text>
        <Text style={styles.sectionHint}>Saskatchewan defaults. Applied automatically to every new invoice.</Text>
        <View style={styles.row}>
          <Field label="GST %" keyboardType="decimal-pad" value={gstPct} onChangeText={setGstPct} style={{ flex: 1 }} />
          <Field label="PST %" keyboardType="decimal-pad" value={pstPct} onChangeText={setPstPct} style={{ flex: 1, marginLeft: spacing.sm }} />
        </View>
        <Field label="Default due date (days from issue)" keyboardType="number-pad" value={dueDays} onChangeText={setDueDays} />

        <Text style={styles.sectionTitle}>Voice dictation</Text>
        <Text style={styles.sectionHint}>
          Pick how GoonBill turns your speech into invoices. Keys are stored encrypted on this device only.
        </Text>
        {VOICE_PROVIDERS.map((p) => (
          <TouchableOpacity
            key={p.id}
            onPress={() => setProvider(p.id)}
            activeOpacity={0.7}
            style={[styles.providerCard, provider === p.id && styles.providerActive]}
          >
            <View style={styles.providerRow}>
              <View style={[styles.radio, provider === p.id && styles.radioActive]} />
              <View style={{ flex: 1 }}>
                <Text style={styles.providerName}>{p.name}</Text>
                <Text style={styles.providerBlurb}>{p.blurb}</Text>
              </View>
            </View>
          </TouchableOpacity>
        ))}

        {provider === 'gemini' && (
          <Card style={geminiSaved ? styles.keyOk : undefined}>
            <Text style={styles.keyStatus}>{geminiSaved ? '● Gemini key saved' : '○ No Gemini key yet'}</Text>
            <Text style={styles.sectionHint}>
              Free key from Google AI Studio (aistudio.google.com → Get API key). Free tier covers normal use.
            </Text>
            <Field
              label={geminiSaved ? 'Replace key' : 'Gemini API key'}
              placeholder="AIza…"
              secureTextEntry
              autoCapitalize="none"
              autoCorrect={false}
              value={geminiInput}
              onChangeText={setGeminiInput}
            />
            {geminiSaved ? <Button title="Remove key" variant="danger" onPress={removeGeminiKey} /> : null}
          </Card>
        )}

        {provider === 'custom' && (
          <Card style={customSaved ? styles.keyOk : undefined}>
            <Text style={styles.keyStatus}>{customSaved ? '● Custom API saved' : '○ No custom API yet'}</Text>
            <Text style={styles.sectionHint}>
              Any endpoint that speaks the OpenAI chat format. Your phone does the listening; your API builds the invoice.
            </Text>
            <Field
              label="Base URL"
              placeholder="https://openrouter.ai/api/v1"
              autoCapitalize="none"
              autoCorrect={false}
              value={customBaseUrl}
              onChangeText={setCustomBaseUrl}
            />
            <Field
              label="API key"
              placeholder="your key…"
              secureTextEntry
              autoCapitalize="none"
              autoCorrect={false}
              value={customKeyInput}
              onChangeText={setCustomKeyInput}
            />
            <Field
              label="Model"
              placeholder="e.g. openai/gpt-4o-mini"
              autoCapitalize="none"
              autoCorrect={false}
              value={customModel}
              onChangeText={setCustomModel}
            />
            {customSaved ? <Button title="Remove custom API" variant="danger" onPress={removeCustomApi} /> : null}
          </Card>
        )}

        {provider === 'openai' && (
          <Card style={openaiSaved ? styles.keyOk : undefined}>
            <Text style={styles.keyStatus}>{openaiSaved ? '● OpenAI key saved' : '○ No OpenAI key yet'}</Text>
            <Text style={styles.sectionHint}>
              Used for transcription (Whisper) and invoice extraction (GPT-4o-mini). Needs billing on your OpenAI account.
            </Text>
            <Field
              label={openaiSaved ? 'Replace key' : 'OpenAI API key (starts with sk-)'}
              placeholder="sk-…"
              secureTextEntry
              autoCapitalize="none"
              autoCorrect={false}
              value={openaiInput}
              onChangeText={setOpenaiInput}
            />
            {openaiSaved ? <Button title="Remove key" variant="danger" onPress={removeOpenaiKey} /> : null}
          </Card>
        )}

        <Text style={styles.sectionTitle}>☁️ Cloud sync</Text>
        <Text style={styles.sectionHint}>
          Back up invoices, quotes and job photos to GoonBill Cloud and sync across devices.
          Create an account below — that's all it takes.
        </Text>
        <Card style={cloudReady ? styles.keyOk : undefined}>
          <Text style={styles.keyStatus}>● Connected to GoonBill Cloud</Text>
          {cloudReady ? (
            <>
              <Text style={styles.sectionHint}>
                {account ? `Signed in as ${account.email}` : 'Not signed in.'}
                {lastSync > 0 ? ` Last sync: ${new Date(lastSync).toLocaleString()}.` : ' Never synced.'}
              </Text>
              {!account ? (
                <>
                  <Field
                    label="Sync account email"
                    placeholder="you@example.com"
                    keyboardType="email-address"
                    autoCapitalize="none"
                    value={syncEmail}
                    onChangeText={setSyncEmail}
                  />
                  <Field
                    label="Password"
                    placeholder="min 6 characters"
                    secureTextEntry
                    value={syncPassword}
                    onChangeText={setSyncPassword}
                  />
                  <View style={styles.row}>
                    <Button title="Create account" onPress={handleSignUp} loading={syncing} style={{ flex: 1 }} />
                    <Button title="Sign in" variant="secondary" onPress={handleSignIn} loading={syncing} style={{ flex: 1, marginLeft: spacing.sm }} />
                  </View>
                </>
              ) : (
                <View style={styles.row}>
                  <Button title="Sync now" onPress={handleSyncNow} loading={syncing} style={{ flex: 1 }} />
                  <Button title="Sign out" variant="secondary" onPress={handleSignOut} style={{ flex: 1, marginLeft: spacing.sm }} />
                </View>
              )}
            </>
          ) : null}
        </Card>

        <Text style={styles.sectionTitle}>💳 Online payments</Text>
        <Text style={styles.sectionHint}>
          Let clients pay invoices by card. Needs a Stripe account (free to start; ~2.9% + 30¢ per payment).
          Also deploy the supabase/functions in this repo and set the STRIPE_SECRET_KEY secret.
        </Text>
        <Card style={stripeReady ? styles.keyOk : undefined}>
          <Text style={styles.keyStatus}>{stripeReady ? '● Stripe key saved' : '○ No Stripe key yet'}</Text>
          <Field
            label={stripeReady ? 'Replace publishable key' : 'Stripe publishable key (starts with pk_)'}
            placeholder="pk_live_… or pk_test_…"
            secureTextEntry
            autoCapitalize="none"
            autoCorrect={false}
            value={stripeKey}
            onChangeText={setStripeKey}
          />
          {stripeReady ? <Button title="Remove key" variant="danger" onPress={removeStripeKey} /> : null}
        </Card>

        <Text style={styles.sectionTitle}>💰 More ways to get paid</Text>
        <Text style={styles.sectionHint}>
          These show up as options when collecting payment on an invoice.
        </Text>
        <Card>
          <Field
            voice
            label="PayPal.Me username"
            placeholder="yourname (from paypal.me/yourname)"
            autoCapitalize="none"
            autoCorrect={false}
            value={paypalMe}
            onChangeText={setPaypalMe}
          />
          <Text style={styles.sectionHint}>Clients get a PayPal link with the invoice amount filled in.</Text>
          <Field
            label="Interac e-Transfer email"
            placeholder="you@example.com"
            keyboardType="email-address"
            autoCapitalize="none"
            value={interacEmail}
            onChangeText={setInteracEmail}
          />
          <Text style={styles.sectionHint}>One tap texts the client your e-transfer details with the amount.</Text>
          <Field
            label="Bitcoin (BTC) address"
            placeholder="bc1…"
            autoCapitalize="none"
            autoCorrect={false}
            value={cryptoBtc}
            onChangeText={setCryptoBtc}
          />
          <Field
            label="Ethereum (ETH) address"
            placeholder="0x…"
            autoCapitalize="none"
            autoCorrect={false}
            value={cryptoEth}
            onChangeText={setCryptoEth}
          />
          <Text style={styles.sectionHint}>Clients see a QR code they can scan from their wallet app.</Text>
        </Card>

        <Text style={styles.sectionTitle}>🔔 Payment reminders</Text>
        <Text style={styles.sectionHint}>
          GoonBill nudges you when invoices come due or go overdue — no server needed.
        </Text>
        <Card>
          <TouchableOpacity onPress={() => setRemindersOn(!remindersOn)} activeOpacity={0.7} style={styles.providerRow}>
            <View style={[styles.radio, remindersOn && styles.radioActive]} />
            <View style={{ flex: 1 }}>
              <Text style={styles.providerName}>Automatic reminders</Text>
              <Text style={styles.providerBlurb}>Notify me about upcoming and overdue invoices.</Text>
            </View>
          </TouchableOpacity>
          <Field
            label="Remind me (days after due date, comma separated)"
            placeholder="0,3,7,14"
            keyboardType="numbers-and-punctuation"
            value={reminderDaysText}
            onChangeText={setReminderDaysText}
          />
        </Card>

        <Button title="Save Settings" onPress={saveAll} loading={saving} style={styles.saveBtn} />
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  scroll: { padding: spacing.md, paddingBottom: spacing.xl },
  sectionTitle: { color: theme.text, fontSize: 19, fontWeight: '700', marginTop: spacing.lg, marginBottom: 2 },
  sectionHint: { color: theme.muted, fontSize: 13, marginBottom: spacing.sm, lineHeight: 18 },
  row: { flexDirection: 'row' },
  msgCard: { borderColor: theme.accent },
  msgText: { color: theme.text, fontSize: 14 },
  keyOk: { borderColor: theme.accent },
  keyStatus: { color: theme.muted, fontSize: 14, fontWeight: '600', marginBottom: spacing.sm },
  providerCard: {
    borderWidth: 1,
    borderColor: theme.border,
    borderRadius: 14,
    padding: spacing.md,
    marginBottom: spacing.sm,
    backgroundColor: theme.surface,
  },
  providerActive: { borderColor: theme.accent },
  providerRow: { flexDirection: 'row', alignItems: 'flex-start' },
  radio: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    borderColor: theme.muted,
    marginRight: spacing.sm,
    marginTop: 2,
  },
  radioActive: { borderColor: theme.accent, backgroundColor: theme.accent },
  providerName: { color: theme.text, fontSize: 16, fontWeight: '700', marginBottom: 2 },
  providerBlurb: { color: theme.muted, fontSize: 13, lineHeight: 18 },
  saveBtn: { minHeight: 60, marginTop: spacing.md },
  todo: { color: theme.muted, fontSize: 14, lineHeight: 22, marginBottom: 4 },
  todoHint: { color: theme.muted, fontSize: 12, fontStyle: 'italic', marginTop: 6 },
});
