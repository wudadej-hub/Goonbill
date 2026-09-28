import { useCallback, useState } from 'react';
import { Alert, Image, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useFocusEffect, useLocalSearchParams } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import * as FileSystem from 'expo-file-system/legacy';
import {
  ChangeOrder,
  JobPhoto,
  MaterialEntry,
  TimeEntry,
  addJobPhoto,
  billChangeOrder,
  billMaterialEntry,
  billTimeEntry,
  createChangeOrder,
  createMaterialEntry,
  createTimeEntry,
  deleteChangeOrder,
  deleteJobPhoto,
  deleteMaterialEntry,
  deleteTimeEntry,
  getInvoice,
  listChangeOrders,
  listJobPhotos,
  listMaterialEntries,
  listTimeEntries,
  setChangeOrderStatus,
} from '../../lib/db';
import { formatCents, formatDate, parseDollarsToCents, todayISO } from '../../lib/format';
import { theme, spacing } from '../../lib/theme';
import { Button, Card, EmptyState, Field, Screen, Title } from '../../components/ui';

/** Copy a picked image into app storage so it survives cache cleanups. */
async function persistPhoto(pickedUri: string): Promise<string> {
  const dir = `${FileSystem.documentDirectory}job-photos/`;
  const info = await FileSystem.getInfoAsync(dir);
  if (!info.exists) {
    await FileSystem.makeDirectoryAsync(dir, { intermediates: true });
  }
  const name = `photo-${Date.now()}-${Math.floor(Math.random() * 1e6)}.jpg`;
  const dest = `${dir}${name}`;
  await FileSystem.copyAsync({ from: pickedUri, to: dest });
  return dest;
}

async function pickImage(): Promise<string | null> {
  const lib = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!lib.granted) {
    Alert.alert('Permission needed', 'Allow photo access to attach job photos.');
    return null;
  }
  const res = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images'],
    quality: 0.7,
  });
  if (res.canceled || !res.assets[0]) return null;
  return persistPhoto(res.assets[0].uri);
}

async function takePhoto(): Promise<string | null> {
  const cam = await ImagePicker.requestCameraPermissionsAsync();
  if (!cam.granted) {
    Alert.alert('Permission needed', 'Allow camera access to take job photos.');
    return null;
  }
  const res = await ImagePicker.launchCameraAsync({
    mediaTypes: ['images'],
    quality: 0.7,
  });
  if (res.canceled || !res.assets[0]) return null;
  return persistPhoto(res.assets[0].uri);
}

/** Let the user snap a fresh photo or pick an existing one. */
function choosePhoto(source: 'camera' | 'library' | 'ask', onDone: (uri: string | null) => void): void {
  const go = async (which: 'camera' | 'library') => {
    onDone(which === 'camera' ? await takePhoto() : await pickImage());
  };
  if (source === 'camera') return void go('camera');
  if (source === 'library') return void go('library');
  Alert.alert('Add photo', undefined, [
    { text: 'Take photo', onPress: () => go('camera') },
    { text: 'Choose from library', onPress: () => go('library') },
    { text: 'Cancel', style: 'cancel' },
  ]);
}

export default function JobDocsScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const invoiceId = Number(id);
  const [invNumber, setInvNumber] = useState('');
  const [timeEntries, setTimeEntries] = useState<TimeEntry[]>([]);
  const [materials, setMaterials] = useState<MaterialEntry[]>([]);
  const [changeOrders, setChangeOrders] = useState<ChangeOrder[]>([]);
  const [photos, setPhotos] = useState<JobPhoto[]>([]);

  // forms
  const [showTime, setShowTime] = useState(false);
  const [tDate, setTDate] = useState(todayISO());
  const [tHours, setTHours] = useState('');
  const [tDesc, setTDesc] = useState('');
  const [tRate, setTRate] = useState('');
  const [showMat, setShowMat] = useState(false);
  const [mDesc, setMDesc] = useState('');
  const [mCost, setMCost] = useState('');
  const [mReceipt, setMReceipt] = useState('');
  const [showCo, setShowCo] = useState(false);
  const [coDesc, setCoDesc] = useState('');
  const [coAmount, setCoAmount] = useState('');
  const [coApprover, setCoApprover] = useState('');
  const [approvingId, setApprovingId] = useState<number | null>(null);

  const load = useCallback(() => {
    const inv = getInvoice(invoiceId);
    setInvNumber(inv ? inv.number : '');
    setTimeEntries(listTimeEntries(invoiceId));
    setMaterials(listMaterialEntries(invoiceId));
    setChangeOrders(listChangeOrders(invoiceId));
    setPhotos(listJobPhotos(invoiceId));
  }, [invoiceId]);

  useFocusEffect(load);

  const addTime = () => {
    const hours = parseFloat(tHours);
    if (!hours || hours <= 0) {
      Alert.alert('Hours?', 'Enter the hours worked, e.g. 2.5.');
      return;
    }
    createTimeEntry(invoiceId, tDate || todayISO(), hours, tDesc, parseDollarsToCents(tRate));
    setTHours('');
    setTDesc('');
    setTRate('');
    setShowTime(false);
    load();
  };

  const addMaterial = () => {
    if (!mDesc.trim()) {
      Alert.alert('Description?', 'Say what the material was.');
      return;
    }
    createMaterialEntry(invoiceId, mDesc, parseDollarsToCents(mCost), mReceipt);
    setMDesc('');
    setMCost('');
    setMReceipt('');
    setShowMat(false);
    load();
  };

  const addChangeOrder = () => {
    if (!coDesc.trim()) {
      Alert.alert('Description?', 'Describe the extra work.');
      return;
    }
    createChangeOrder(invoiceId, coDesc, parseDollarsToCents(coAmount));
    setCoDesc('');
    setCoAmount('');
    setShowCo(false);
    load();
  };

  const approveCo = (co: ChangeOrder) => {
    if (!coApprover.trim()) {
      Alert.alert('Client approval', 'Type the name of the client who approved this — get it in writing before you do the work.');
      return;
    }
    setChangeOrderStatus(co.id, 'approved', coApprover.trim());
    setCoApprover('');
    setApprovingId(null);
    load();
  };

  const addPhoto = (kind: 'before' | 'after') => {
    choosePhoto('ask', (uri) => {
      if (!uri) return;
      addJobPhoto(invoiceId, uri, kind, '');
      load();
    });
  };

  const removePhoto = (p: JobPhoto) => {
    Alert.alert('Remove photo?', 'The photo will be deleted from this job.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: async () => {
          deleteJobPhoto(p.id);
          try {
            await FileSystem.deleteAsync(p.uri, { idempotent: true });
          } catch {}
          load();
        },
      },
    ]);
  };

  const before = photos.filter((p) => p.kind === 'before');
  const after = photos.filter((p) => p.kind === 'after');

  return (
    <Screen style={{ padding: 0 }}>
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <Title>Job Docs</Title>
        <Text style={styles.sub}>{invNumber} — hours, materials, change orders, and photos for this job.</Text>

        {/* ---- Time log ---- */}
        <Text style={styles.sectionTitle}>Time log</Text>
        {timeEntries.length === 0 && !showTime ? <EmptyState message="No hours tracked yet." /> : null}
        {timeEntries.map((t) => (
          <Card key={t.id}>
            <View style={styles.row}>
              <View style={styles.main}>
                <Text style={styles.itemTitle}>
                  {t.hours}h · {formatDate(t.work_date)}
                </Text>
                {t.description ? <Text style={styles.itemSub}>{t.description}</Text> : null}
                <Text style={styles.itemSub}>
                  {t.rate_cents > 0 ? `${formatCents(t.rate_cents)}/h = ` : ''}
                  {t.rate_cents > 0 ? formatCents(Math.round(t.hours * t.rate_cents)) : ''}
                  {t.billed ? ' · on invoice ✓' : ''}
                </Text>
              </View>
              <View style={styles.itemActions}>
                {!t.billed && t.rate_cents > 0 ? (
                  <TouchableOpacity
                    onPress={() => {
                      billTimeEntry(t.id);
                      load();
                    }}
                    activeOpacity={0.7}
                  >
                    <Text style={styles.link}>+ Invoice</Text>
                  </TouchableOpacity>
                ) : null}
                <TouchableOpacity
                  onPress={() => {
                    deleteTimeEntry(t.id);
                    load();
                  }}
                  activeOpacity={0.7}
                >
                  <Text style={styles.linkDanger}>✕</Text>
                </TouchableOpacity>
              </View>
            </View>
          </Card>
        ))}
        {showTime ? (
          <Card>
            <Field label="Date (YYYY-MM-DD)" value={tDate} onChangeText={setTDate} />
            <View style={styles.formRow}>
              <Field label="Hours" keyboardType="decimal-pad" placeholder="2.5" value={tHours} onChangeText={setTHours} style={{ flex: 1 }} />
              <Field label="Rate $/h (optional)" keyboardType="decimal-pad" placeholder="90.00" value={tRate} onChangeText={setTRate} style={{ flex: 1, marginLeft: spacing.sm }} />
            </View>
            <Field voice label="What was done" placeholder="e.g. Installed subfloor" value={tDesc} onChangeText={setTDesc} />
            <Button title="Save hours" onPress={addTime} />
          </Card>
        ) : (
          <Button title="+ Log hours" variant="secondary" onPress={() => setShowTime(true)} />
        )}

        {/* ---- Materials ---- */}
        <Text style={styles.sectionTitle}>Materials & receipts</Text>
        {materials.length === 0 && !showMat ? <EmptyState message="No materials tracked yet." /> : null}
        {materials.map((m) => (
          <Card key={m.id}>
            <View style={styles.row}>
              {m.receipt_uri ? <Image source={{ uri: m.receipt_uri }} style={styles.thumb} /> : null}
              <View style={styles.main}>
                <Text style={styles.itemTitle}>{m.description}</Text>
                <Text style={styles.itemSub}>
                  {formatCents(m.cost_cents)}
                  {m.billed ? ' · on invoice ✓' : ''}
                </Text>
              </View>
              <View style={styles.itemActions}>
                {!m.billed ? (
                  <TouchableOpacity
                    onPress={() => {
                      billMaterialEntry(m.id);
                      load();
                    }}
                    activeOpacity={0.7}
                  >
                    <Text style={styles.link}>+ Invoice</Text>
                  </TouchableOpacity>
                ) : null}
                <TouchableOpacity
                  onPress={() => {
                    deleteMaterialEntry(m.id);
                    load();
                  }}
                  activeOpacity={0.7}
                >
                  <Text style={styles.linkDanger}>✕</Text>
                </TouchableOpacity>
              </View>
            </View>
          </Card>
        ))}
        {showMat ? (
          <Card>
            <Field voice label="Material" placeholder="e.g. 2×4 lumber, 20 pcs" value={mDesc} onChangeText={setMDesc} />
            <Field label="Cost ($)" keyboardType="decimal-pad" placeholder="0.00" value={mCost} onChangeText={setMCost} />
            {mReceipt ? (
              <Image source={{ uri: mReceipt }} style={styles.receiptPreview} />
            ) : (
              <Button
                title="📷 Attach receipt photo"
                variant="secondary"
                onPress={() =>
                  choosePhoto('ask', (uri) => {
                    if (uri) setMReceipt(uri);
                  })
                }
              />
            )}
            <View style={{ height: spacing.sm }} />
            <Button title="Save material" onPress={addMaterial} />
          </Card>
        ) : (
          <Button title="+ Add material" variant="secondary" onPress={() => setShowMat(true)} />
        )}

        {/* ---- Change orders ---- */}
        <Text style={styles.sectionTitle}>Change orders</Text>
        <Text style={styles.hint}>Extra work the client approves in writing — before you do it.</Text>
        {changeOrders.length === 0 && !showCo ? (
          <EmptyState message="No change orders. When the client asks for more, log it here first." />
        ) : null}
        {changeOrders.map((co) => (
          <Card key={co.id} style={co.status === 'approved' ? styles.coApproved : undefined}>
            <View style={styles.row}>
              <View style={styles.main}>
                <Text style={styles.itemTitle}>{co.description}</Text>
                <Text style={styles.itemSub}>
                  {formatCents(co.amount_cents)} · {co.status}
                  {co.client_approval ? ` · approved by ${co.client_approval}` : ''}
                  {co.billed ? ' · on invoice ✓' : ''}
                </Text>
              </View>
              <TouchableOpacity
                onPress={() => {
                  deleteChangeOrder(co.id);
                  load();
                }}
                activeOpacity={0.7}
              >
                <Text style={styles.linkDanger}>✕</Text>
              </TouchableOpacity>
            </View>
            {co.status === 'pending' ? (
              approvingId === co.id ? (
                <View style={styles.approveRow}>
                  <Field
                    voice
                    label="Client name (written approval)"
                    placeholder="Who approved this?"
                    value={coApprover}
                    onChangeText={setCoApprover}
                    style={{ flex: 1 }}
                  />
                  <Button title="Approve" onPress={() => approveCo(co)} style={styles.approveBtn} />
                </View>
              ) : (
                <View style={styles.coActions}>
                  <Button title="Approve…" variant="secondary" onPress={() => setApprovingId(co.id)} style={styles.coBtn} />
                  <Button
                    title="Decline"
                    variant="ghost"
                    onPress={() => {
                      setChangeOrderStatus(co.id, 'declined');
                      load();
                    }}
                    style={styles.coBtn}
                  />
                </View>
              )
            ) : null}
            {co.status === 'approved' && !co.billed ? (
              <Button
                title="+ Add to invoice"
                variant="secondary"
                onPress={() => {
                  billChangeOrder(co.id);
                  load();
                }}
              />
            ) : null}
          </Card>
        ))}
        {showCo ? (
          <Card>
            <Field voice label="Extra work" placeholder="e.g. Client added a second coat of paint" multiline value={coDesc} onChangeText={setCoDesc} />
            <Field label="Extra charge ($)" keyboardType="decimal-pad" placeholder="0.00" value={coAmount} onChangeText={setCoAmount} />
            <Button title="Save change order" onPress={addChangeOrder} />
          </Card>
        ) : (
          <Button title="+ Change order" variant="secondary" onPress={() => setShowCo(true)} />
        )}

        {/* ---- Photos ---- */}
        <Text style={styles.sectionTitle}>Before / after photos</Text>
        <Text style={styles.photoLabel}>Before</Text>
        <View style={styles.photoGrid}>
          {before.map((p) => (
            <TouchableOpacity key={p.id} onPress={() => removePhoto(p)} activeOpacity={0.7}>
              <Image source={{ uri: p.uri }} style={styles.photo} />
            </TouchableOpacity>
          ))}
          <TouchableOpacity style={styles.addPhoto} onPress={() => addPhoto('before')} activeOpacity={0.7}>
            <Text style={styles.addPhotoText}>+ Before</Text>
          </TouchableOpacity>
        </View>
        <Text style={styles.photoLabel}>After</Text>
        <View style={styles.photoGrid}>
          {after.map((p) => (
            <TouchableOpacity key={p.id} onPress={() => removePhoto(p)} activeOpacity={0.7}>
              <Image source={{ uri: p.uri }} style={styles.photo} />
            </TouchableOpacity>
          ))}
          <TouchableOpacity style={styles.addPhoto} onPress={() => addPhoto('after')} activeOpacity={0.7}>
            <Text style={styles.addPhotoText}>+ After</Text>
          </TouchableOpacity>
        </View>
        <Text style={styles.hint}>Tap a photo to remove it.</Text>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  scroll: { padding: spacing.md, paddingBottom: spacing.xl },
  sub: { color: theme.muted, fontSize: 14, marginBottom: spacing.sm },
  sectionTitle: { color: theme.text, fontSize: 19, fontWeight: '700', marginTop: spacing.lg, marginBottom: 2 },
  hint: { color: theme.muted, fontSize: 13, marginBottom: spacing.sm, lineHeight: 18 },
  row: { flexDirection: 'row', alignItems: 'center' },
  main: { flex: 1, paddingRight: spacing.sm },
  itemTitle: { color: theme.text, fontSize: 16, fontWeight: '600' },
  itemSub: { color: theme.muted, fontSize: 13, marginTop: 2 },
  itemActions: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  link: { color: theme.accent, fontSize: 15, fontWeight: '700' },
  linkDanger: { color: theme.danger, fontSize: 18 },
  formRow: { flexDirection: 'row' },
  thumb: { width: 52, height: 52, borderRadius: 8, marginRight: spacing.sm },
  receiptPreview: { width: '100%', height: 180, borderRadius: 8, marginBottom: spacing.sm },
  coApproved: { borderColor: theme.accent },
  coActions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm },
  coBtn: { flex: 1, minHeight: 48 },
  approveRow: { flexDirection: 'row', alignItems: 'flex-end', gap: spacing.sm, marginTop: spacing.sm },
  approveBtn: { minHeight: 52, marginBottom: 12 },
  photoLabel: { color: theme.muted, fontSize: 14, fontWeight: '600', marginTop: spacing.sm, marginBottom: spacing.sm },
  photoGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  photo: { width: 104, height: 104, borderRadius: 8 },
  addPhoto: {
    width: 104,
    height: 104,
    borderRadius: 8,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: theme.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  addPhotoText: { color: theme.muted, fontSize: 14, fontWeight: '600' },
});
