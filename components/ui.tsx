import React, { useId, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  StyleSheet,
  Text,
  TextInput,
  TextInputProps,
  TouchableOpacity,
  View,
  ViewStyle,
} from 'react-native';
import { ExpoSpeechRecognitionModule, useSpeechRecognitionEvent } from 'expo-speech-recognition';
import { theme, spacing } from '../lib/theme';
import { DisplayStatus } from '../lib/db';

export function Screen({ children, style }: { children: React.ReactNode; style?: ViewStyle }) {
  return <View style={[styles.screen, style]}>{children}</View>;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.bg, padding: spacing.md },
});

export function Title({ children }: { children: React.ReactNode }) {
  return <Text style={tStyles.title}>{children}</Text>;
}

export function Subtitle({ children }: { children: React.ReactNode }) {
  return <Text style={tStyles.subtitle}>{children}</Text>;
}

const tStyles = StyleSheet.create({
  title: { color: theme.text, fontSize: 28, fontWeight: '800', marginBottom: 4 },
  subtitle: { color: theme.muted, fontSize: 15, marginBottom: spacing.md },
});

interface ButtonProps {
  title: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost';
  disabled?: boolean;
  loading?: boolean;
  style?: ViewStyle;
}

export function Button({ title, onPress, variant = 'primary', disabled, loading, style }: ButtonProps) {
  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={disabled || loading}
      activeOpacity={0.75}
      style={[
        bStyles.base,
        variant === 'primary' && bStyles.primary,
        variant === 'secondary' && bStyles.secondary,
        variant === 'danger' && bStyles.danger,
        variant === 'ghost' && bStyles.ghost,
        (disabled || loading) && bStyles.disabled,
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={variant === 'primary' ? '#0b0f0d' : theme.text} />
      ) : (
        <Text
          style={[
            bStyles.label,
            variant === 'primary' && bStyles.labelPrimary,
            variant === 'danger' && bStyles.labelDanger,
          ]}
        >
          {title}
        </Text>
      )}
    </TouchableOpacity>
  );
}

const bStyles = StyleSheet.create({
  base: {
    minHeight: 56,
    borderRadius: theme.radius,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
  },
  primary: { backgroundColor: theme.accent },
  secondary: { backgroundColor: theme.surface2, borderWidth: 1, borderColor: theme.border },
  danger: { backgroundColor: 'transparent', borderWidth: 1, borderColor: theme.danger },
  ghost: { backgroundColor: 'transparent' },
  disabled: { opacity: 0.5 },
  label: { color: theme.text, fontSize: 17, fontWeight: '700' },
  labelPrimary: { color: '#0b0f0d' },
  labelDanger: { color: theme.danger },
});

interface FieldProps extends TextInputProps {
  label: string;
  /** Show a mic button that dictates into this field (free, on-device, no key needed). */
  voice?: boolean;
}

// Only one field dictates at a time across the whole app.
let activeVoiceField: string | null = null;

export function Field({ label, style, voice, ...props }: FieldProps) {
  const id = useId();
  const [listening, setListening] = useState(false);
  const baseRef = useRef('');
  const finalRef = useRef('');
  const transcriptRef = useRef('');

  const commitLive = () => {
    const base = baseRef.current.trim();
    const heard = transcriptRef.current.trim();
    if (heard) props.onChangeText?.(base ? `${base} ${heard}` : heard);
  };

  useSpeechRecognitionEvent('result', (event) => {
    if (activeVoiceField !== id) return;
    const t = event.results?.[0]?.transcript ?? '';
    if (!t) return;
    if (event.isFinal) {
      finalRef.current = (finalRef.current ? finalRef.current + ' ' : '') + t.trim();
      transcriptRef.current = finalRef.current;
    } else {
      transcriptRef.current = (finalRef.current ? finalRef.current + ' ' : '') + t.trim();
    }
    commitLive();
  });

  const finishListening = () => {
    if (activeVoiceField !== id) return;
    activeVoiceField = null;
    setListening(false);
  };
  useSpeechRecognitionEvent('end', finishListening);
  useSpeechRecognitionEvent('error', finishListening);

  const toggleVoice = async () => {
    if (listening) {
      try {
        ExpoSpeechRecognitionModule.stop();
      } catch {
        // 'end' event finishes us off
      }
      return;
    }
    try {
      const perm = await ExpoSpeechRecognitionModule.requestPermissionsAsync();
      if (!perm.granted) {
        Alert.alert('Microphone needed', 'Allow microphone access to dictate into this field.');
        return;
      }
      if (!ExpoSpeechRecognitionModule.isRecognitionAvailable()) {
        Alert.alert('Not available', "This phone doesn't have speech recognition available right now.");
        return;
      }
      if (activeVoiceField) {
        try {
          ExpoSpeechRecognitionModule.stop();
        } catch {
          // ignore
        }
      }
      activeVoiceField = id;
      baseRef.current = props.value ?? '';
      finalRef.current = '';
      transcriptRef.current = '';
      setListening(true);
      ExpoSpeechRecognitionModule.start({
        lang: 'en-US',
        interimResults: true,
        continuous: true,
        androidIntentOptions: {
          EXTRA_SPEECH_INPUT_COMPLETE_SILENCE_LENGTH_MILLIS: 6000,
          EXTRA_SPEECH_INPUT_POSSIBLY_COMPLETE_SILENCE_LENGTH_MILLIS: 4000,
          EXTRA_SPEECH_INPUT_MINIMUM_LENGTH_MILLIS: 3000,
        },
      });
    } catch (e) {
      activeVoiceField = null;
      setListening(false);
      Alert.alert('Could not start dictation', e instanceof Error ? e.message : 'Unknown error');
    }
  };

  return (
    <View style={[fStyles.wrap, style as ViewStyle]}>
      <View style={fStyles.labelRow}>
        <Text style={fStyles.label}>{label}</Text>
        {voice ? (
          <TouchableOpacity onPress={toggleVoice} activeOpacity={0.7} style={fStyles.micBtn}>
            <Text style={[fStyles.micText, listening && fStyles.micActive]}>{listening ? '⏹' : '🎙'}</Text>
          </TouchableOpacity>
        ) : null}
      </View>
      <TextInput
        style={fStyles.input}
        placeholderTextColor={theme.muted}
        {...props}
      />
    </View>
  );
}

const fStyles = StyleSheet.create({
  wrap: { marginBottom: spacing.sm },
  labelRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 },
  label: { color: theme.muted, fontSize: 13, fontWeight: '600' },
  micBtn: { paddingHorizontal: 8, paddingVertical: 2 },
  micText: { fontSize: 18, color: theme.muted },
  micActive: { color: theme.danger },
  input: {
    backgroundColor: theme.surface,
    borderWidth: 1,
    borderColor: theme.border,
    borderRadius: theme.radius,
    color: theme.text,
    fontSize: 17,
    minHeight: 52,
    paddingHorizontal: spacing.md,
    paddingVertical: 12,
  },
});

const STATUS_COLORS: Record<DisplayStatus, string> = {
  draft: theme.muted,
  unpaid: theme.warning,
  overdue: theme.danger,
  paid: theme.accent,
};

export function StatusBadge({ status }: { status: DisplayStatus }) {
  const color = STATUS_COLORS[status];
  return (
    <View style={[sStyles.badge, { borderColor: color }]}>
      <Text style={[sStyles.text, { color }]}>{status.toUpperCase()}</Text>
    </View>
  );
}

const sStyles = StyleSheet.create({
  badge: {
    borderWidth: 1.5,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
    alignSelf: 'flex-start',
  },
  text: { fontSize: 11, fontWeight: '800', letterSpacing: 0.5 },
});

export function Card({ children, style }: { children: React.ReactNode; style?: ViewStyle }) {
  return <View style={[cStyles.card, style]}>{children}</View>;
}

const cStyles = StyleSheet.create({
  card: {
    backgroundColor: theme.surface,
    borderWidth: 1,
    borderColor: theme.border,
    borderRadius: theme.radius,
    padding: spacing.md,
    marginBottom: spacing.sm,
  },
});

export function EmptyState({ message }: { message: string }) {
  return (
    <View style={eStyles.wrap}>
      <Text style={eStyles.text}>{message}</Text>
    </View>
  );
}

const eStyles = StyleSheet.create({
  wrap: { padding: spacing.xl, alignItems: 'center' },
  text: { color: theme.muted, fontSize: 16, textAlign: 'center', lineHeight: 24 },
});
