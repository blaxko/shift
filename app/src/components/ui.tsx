// Shared UI primitives. NFR-A1 (48 dp targets), NFR-A2 (labels), NFR-A3 (>= 4.5:1 contrast, light + dark),
// NFR-A4 (layout flows at large font scale: no fixed heights on text), NFR-A5 (never colour alone).
import React, { type ReactNode } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View, useColorScheme, type ViewStyle } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { CLUSTER, IS_MAINNET } from '../config/constants';

export const palette = {
  light: { bg: '#FFFFFF', card: '#F3F4F6', text: '#111827', muted: '#4B5563', primary: '#0B5FFF', onPrimary: '#FFFFFF', danger: '#B00020', warn: '#8A4B00', ok: '#0B6B2E', border: '#9CA3AF' },
  dark: { bg: '#0B0F14', card: '#1A212B', text: '#F3F4F6', muted: '#A7B0BD', primary: '#7FB0FF', onPrimary: '#0B0F14', danger: '#FF9AA2', warn: '#FFC266', ok: '#7EE2A0', border: '#6B7280' },
} as const;

export function useTheme() {
  return palette[useColorScheme() === 'dark' ? 'dark' : 'light'];
}

export function Screen({ children }: { children: ReactNode }) {
  const t = useTheme();
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }}>
      <ScrollView contentContainerStyle={s.pad} keyboardShouldPersistTaps="handled">
        {!IS_MAINNET && (
          <View style={[s.badge, { borderColor: t.warn }]} accessible accessibilityLabel={`Warning: not on mainnet. Cluster ${CLUSTER}`}>
            <Text style={{ color: t.warn, fontWeight: '700' }}>DEVNET — not real ORE</Text>
          </View>
        )}
        {children}
      </ScrollView>
    </SafeAreaView>
  );
}

export function H1({ children }: { children: ReactNode }) {
  const t = useTheme();
  return (
    <Text accessibilityRole="header" style={{ color: t.text, fontSize: 26, fontWeight: '800' }}>
      {children}
    </Text>
  );
}

export function H2({ children }: { children: ReactNode }) {
  const t = useTheme();
  return (
    <Text accessibilityRole="header" style={{ color: t.text, fontSize: 18, fontWeight: '700', marginTop: 8 }}>
      {children}
    </Text>
  );
}

export function P({ children, muted, style, ...rest }: { children: ReactNode; muted?: boolean; style?: object; accessibilityLabel?: string }) {
  const t = useTheme();
  return (
    <Text style={[{ color: muted ? t.muted : t.text, fontSize: 16, lineHeight: 22 }, style]} {...rest}>
      {children}
    </Text>
  );
}

export function Card({ children, style }: { children: ReactNode; style?: ViewStyle }) {
  const t = useTheme();
  return <View style={[s.card, { backgroundColor: t.card, borderColor: t.border }, style]}>{children}</View>;
}

export function Banner({ tone, children }: { tone: 'info' | 'warn' | 'error'; children: ReactNode }) {
  const t = useTheme();
  const color = tone === 'error' ? t.danger : tone === 'warn' ? t.warn : t.text;
  const prefix = tone === 'error' ? 'Error: ' : tone === 'warn' ? 'Notice: ' : '';
  return (
    <View accessibilityRole="alert" style={[s.banner, { borderColor: color, backgroundColor: t.card }]}>
      <Text style={{ color, fontSize: 15, lineHeight: 21 }}>
        {prefix ? <Text style={{ fontWeight: '800' }}>{prefix}</Text> : null}
        {children}
      </Text>
    </View>
  );
}

export function Btn({
  title,
  onPress,
  disabled,
  busy,
  kind = 'primary',
  accessibilityLabel,
  accessibilityHint,
}: {
  title: string;
  onPress?: () => void;
  disabled?: boolean;
  busy?: boolean;
  kind?: 'primary' | 'secondary';
  accessibilityLabel?: string;
  accessibilityHint?: string;
}) {
  const t = useTheme();
  const off = disabled || busy;
  const primary = kind === 'primary';
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? title}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: !!off, busy: !!busy }}
      disabled={off}
      onPress={onPress}
      style={({ pressed }) => [
        s.btn,
        primary ? { backgroundColor: t.primary } : { borderColor: t.primary, borderWidth: 2 },
        off && { opacity: 0.45 },
        pressed && { opacity: 0.8 },
      ]}
    >
      {busy ? <ActivityIndicator color={primary ? t.onPrimary : t.primary} /> : null}
      <Text style={{ color: primary ? t.onPrimary : t.primary, fontSize: 17, fontWeight: '700', textAlign: 'center', flexShrink: 1 }}>{title}</Text>
    </Pressable>
  );
}

export function Choice({
  label,
  sub,
  selected,
  onPress,
  accessibilityLabel,
}: {
  label: string;
  sub?: string;
  selected: boolean;
  onPress: () => void;
  accessibilityLabel?: string;
}) {
  const t = useTheme();
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityLabel={accessibilityLabel ?? (sub ? `${label}. ${sub}` : label)}
      accessibilityState={{ selected }}
      onPress={onPress}
      style={[s.choice, { borderColor: selected ? t.primary : t.border, borderWidth: selected ? 3 : 1, backgroundColor: t.card }]}
    >
      <Text style={{ color: t.text, fontWeight: '700', fontSize: 16 }}>
        {selected ? '● ' : '○ '}
        {label}
      </Text>
      {sub ? <Text style={{ color: t.muted, fontSize: 14, marginTop: 2 }}>{sub}</Text> : null}
    </Pressable>
  );
}

export function Row({ label, value, strong, a11yValue }: { label: string; value: string; strong?: boolean; a11yValue?: string }) {
  const t = useTheme();
  return (
    <View style={s.row} accessible accessibilityLabel={`${label}: ${a11yValue ?? value}`}>
      <Text style={{ color: t.muted, fontSize: 15, flex: 1, paddingRight: 8 }}>{label}</Text>
      <Text style={{ color: t.text, fontSize: 15, fontWeight: strong ? '800' : '600', flexShrink: 0, textAlign: 'right' }}>{value}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  pad: { padding: 16, gap: 12 },
  card: { borderWidth: 1, borderRadius: 12, padding: 14, gap: 8 },
  banner: { borderWidth: 2, borderRadius: 10, padding: 12 },
  btn: { minHeight: 52, minWidth: 48, borderRadius: 12, paddingHorizontal: 18, paddingVertical: 12, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 8 },
  choice: { minHeight: 56, borderRadius: 12, padding: 12, justifyContent: 'center' },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', minHeight: 28 },
  badge: { borderWidth: 2, borderRadius: 8, padding: 8, alignItems: 'center' },
});
