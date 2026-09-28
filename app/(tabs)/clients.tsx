import { useCallback, useState } from 'react';
import { Alert, FlatList, Modal, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { Client, createClient, deleteClient, listClients, updateClient } from '../../lib/db';
import { theme, spacing } from '../../lib/theme';
import { Button, Card, EmptyState, Field, Screen, Title } from '../../components/ui';

interface FormState {
  name: string;
  phone: string;
  email: string;
  address: string;
}

const EMPTY_FORM: FormState = { name: '', phone: '', email: '', address: '' };

export default function ClientsScreen() {
  const [clients, setClients] = useState<Client[]>([]);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Client | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => setClients(listClients()), []);
  useFocusEffect(load);

  const openAdd = () => {
    setEditing(null);
    setForm(EMPTY_FORM);
    setError(null);
    setModalOpen(true);
  };

  const openEdit = (client: Client) => {
    setEditing(client);
    setForm({ name: client.name, phone: client.phone, email: client.email, address: client.address });
    setError(null);
    setModalOpen(true);
  };

  const save = () => {
    if (!form.name.trim()) {
      setError('Client name is required.');
      return;
    }
    try {
      if (editing) {
        updateClient(editing.id, form);
      } else {
        createClient(form.name, form.phone, form.email, form.address);
      }
      setModalOpen(false);
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save client.');
    }
  };

  const confirmDelete = () => {
    if (!editing) return;
    Alert.alert('Delete client?', `${editing.name} will be removed.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => {
          try {
            deleteClient(editing.id);
            setModalOpen(false);
            load();
          } catch (e) {
            setError(e instanceof Error ? e.message : 'Could not delete client.');
          }
        },
      },
    ]);
  };

  return (
    <Screen style={{ padding: 0 }}>
      <View style={styles.header}>
        <Title>Clients</Title>
        <Button title="+ Add" onPress={openAdd} style={styles.addBtn} />
      </View>

      <FlatList
        data={clients}
        keyExtractor={(c) => String(c.id)}
        contentContainerStyle={styles.list}
        ListEmptyComponent={<EmptyState message="No clients yet. Add your first one — or just dictate an invoice and the client is saved automatically." />}
        renderItem={({ item }) => (
          <TouchableOpacity activeOpacity={0.7} onPress={() => openEdit(item)}>
            <Card>
              <Text style={styles.name}>{item.name}</Text>
              {item.phone ? <Text style={styles.detail}>{item.phone}</Text> : null}
              {item.email ? <Text style={styles.detail}>{item.email}</Text> : null}
              {item.address ? <Text style={styles.detail}>{item.address}</Text> : null}
            </Card>
          </TouchableOpacity>
        )}
      />

      <Modal visible={modalOpen} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setModalOpen(false)}>
        <View style={styles.modal}>
          <Text style={styles.modalTitle}>{editing ? 'Edit Client' : 'New Client'}</Text>
          {error ? <Text style={styles.error}>{error}</Text> : null}
          <Field voice label="Name *" placeholder="e.g. John Smith" value={form.name} onChangeText={(t) => setForm({ ...form, name: t })} autoFocus />
          <Field label="Phone" placeholder="306-555-0123" keyboardType="phone-pad" value={form.phone} onChangeText={(t) => setForm({ ...form, phone: t })} />
          <Field label="Email" placeholder="client@example.com" keyboardType="email-address" autoCapitalize="none" value={form.email} onChangeText={(t) => setForm({ ...form, email: t })} />
          <Field voice label="Address" placeholder="Street, Town, SK" value={form.address} onChangeText={(t) => setForm({ ...form, address: t })} />
          <View style={styles.modalActions}>
            <Button title="Save" onPress={save} style={styles.modalBtn} />
            <Button title="Cancel" variant="secondary" onPress={() => setModalOpen(false)} style={styles.modalBtn} />
            {editing ? <Button title="Delete" variant="danger" onPress={confirmDelete} style={styles.modalBtn} /> : null}
          </View>
        </View>
      </Modal>
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
    marginBottom: spacing.sm,
  },
  addBtn: { minHeight: 48, paddingHorizontal: spacing.lg },
  list: { paddingHorizontal: spacing.md, paddingBottom: spacing.xl },
  name: { color: theme.text, fontSize: 17, fontWeight: '700' },
  detail: { color: theme.muted, fontSize: 14, marginTop: 2 },
  modal: { flex: 1, backgroundColor: theme.bg, padding: spacing.lg, paddingTop: spacing.xl },
  modalTitle: { color: theme.text, fontSize: 24, fontWeight: '800', marginBottom: spacing.md },
  error: { color: theme.danger, fontSize: 14, marginBottom: spacing.sm },
  modalActions: { marginTop: spacing.md, gap: spacing.sm },
  modalBtn: { minHeight: 56 },
});
