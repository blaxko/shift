// Shared UI primitives. NFR-A1 (48 dp targets), NFR-A2 (labels), NFR-A3 (>= 4.5:1 contrast, light + dark),
// NFR-A4 (layout flows at large font scale: no fixed heights on text), NFR-A5 (never colour alone).
import React, { type ReactNode } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View, useColorScheme, useWindowDimensions, type ViewStyle } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { CLUSTER, IS_MAINNET } from '../config/constants';
import { palette } from '../config/theme';
import { autoSpokenLabel, speakAmountsInText } from '../domain/a11yText';

export { palette };

export function useTheme() {
  return palette[useColorScheme() === 'dark' ? 'dark' : 'light'];
}

export function Screen({ children, onRefresh, refreshing }: { children: ReactNode; onRefresh?: () => void; refreshing?: boolean }) {
  const t = useTheme();
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }}>
      <ScrollView
        contentContainerStyle={s.pad}
        keyboardShouldPersistTaps="handled"
        refreshControl={onRefresh ? <RefreshControl refreshing={!!refreshing} onRefresh={onRefresh} /> : undefined}
      >
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
    <Text style={[{ color: muted ? t.muted : t.text, fontSize: 16, lineHeight: 22 }, style]} accessibilityLabel={rest.accessibilityLabel ?? autoSpokenLabel(children)}>
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
    <View
      accessibilityRole="alert"
      accessibilityLiveRegion={tone === 'error' ? 'assertive' : 'polite'}
      accessibilityLabel={(() => {
        const spoken = autoSpokenLabel(children);
        return spoken === undefined ? undefined : `${prefix}${spoken}`;
      })()}
      accessible={autoSpokenLabel(children) !== undefined ? true : undefined}
      style={[s.banner, { borderColor: color, backgroundColor: t.card }]}
    >
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
  const { fontScale } = useWindowDimensions();
  const stacked = fontScale >= 1.4; // NFR-A4: at large text sizes put the amount on its own line so it can never be clipped
  return (
    <View
      style={[s.row, stacked && { flexDirection: 'column', gap: 2 }]}
      accessible
      accessibilityLabel={`${label}: ${a11yValue ?? speakAmountsInText(value)}`}
    >
      <Text style={{ color: t.muted, fontSize: 15, flexShrink: 1, paddingRight: stacked ? 0 : 8, flex: stacked ? 0 : 1 }}>{label}</Text>
      <Text style={{ color: t.text, fontSize: 15, fontWeight: strong ? '800' : '600', flexShrink: stacked ? 1 : 0, textAlign: stacked ? 'left' : 'right' }}>{value}</Text>
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

/** Progress as a bar with a text equivalent (NFR-A2/A5): the numbers are always spelled out next to it. */
export function ProgressBar({ value, max, label }: { value: number; max: number; label: string }) {
  const t = useTheme();
  const pct = max > 0 ? Math.min(100, Math.max(0, (value / max) * 100)) : 0;
  return (
    <View accessible accessibilityRole="progressbar" accessibilityLabel={label} accessibilityValue={{ min: 0, max, now: Math.min(value, max) }}>
      <View style={{ height: 14, borderRadius: 7, backgroundColor: t.card, borderWidth: 1, borderColor: t.border, overflow: 'hidden' }}>
        <View style={{ width: `${pct}%`, height: '100%', backgroundColor: t.primary }} />
      </View>
    </View>
  );
}
