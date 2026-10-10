import React from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, TextInputProps, View, ViewStyle } from 'react-native';

export const C = {
  bg: '#0E1116',
  card: '#171B22',
  line: '#262C36',
  text: '#ECEFF4',
  dim: '#8B95A5',
  accent: '#FF9F1C', // warm orange
  accentText: '#1A1204',
  good: '#3DD68C',
  warn: '#F5C451',
  bad: '#FF6B6B',
  blue: '#6CA8FF',
};

export function Screen({ children }: { children: React.ReactNode }) {
  return <View style={{ flex: 1, backgroundColor: C.bg }}>{children}</View>;
}

export function Title({ children, sub }: { children: React.ReactNode; sub?: string }) {
  return (
    <View style={{ paddingHorizontal: 16, paddingTop: 8, paddingBottom: 12 }}>
      <Text style={s.title}>{children}</Text>
      {sub ? <Text style={s.sub}>{sub}</Text> : null}
    </View>
  );
}

export function H({ children }: { children: React.ReactNode }) {
  return <Text style={s.h}>{children}</Text>;
}

export function P({ children, dim, style }: { children: React.ReactNode; dim?: boolean; style?: object }) {
  return <Text style={[s.p, dim && { color: C.dim }, style]}>{children}</Text>;
}

export function Btn({
  label,
  onPress,
  kind = 'primary',
  busy,
  disabled,
  small,
  style,
}: {
  label: string;
  onPress: () => void;
  kind?: 'primary' | 'ghost' | 'danger';
  busy?: boolean;
  disabled?: boolean;
  small?: boolean;
  style?: ViewStyle;
}) {
  const off = disabled || busy;
  const bg = kind === 'primary' ? C.accent : 'transparent';
  const fg = kind === 'primary' ? C.accentText : kind === 'danger' ? C.bad : C.text;
  return (
    <Pressable
      onPress={onPress}
      disabled={off}
      style={({ pressed }) => [
        s.btn,
        small && s.btnSmall,
        { backgroundColor: bg, borderColor: kind === 'primary' ? bg : C.line, opacity: off ? 0.5 : pressed ? 0.8 : 1 },
        style,
      ]}
    >
      {busy ? <ActivityIndicator color={fg} /> : <Text style={[s.btnText, small && { fontSize: 13 }, { color: fg }]}>{label}</Text>}
    </Pressable>
  );
}

export function Chip({ label, on, onPress }: { label: string; on?: boolean; onPress?: () => void }) {
  return (
    <Pressable onPress={onPress} style={[s.chip, on && { backgroundColor: C.accent, borderColor: C.accent }]}>
      <Text style={[s.chipText, on && { color: C.accentText }]}>{label}</Text>
    </Pressable>
  );
}

export function Card({ children, style }: { children: React.ReactNode; style?: ViewStyle }) {
  return <View style={[s.card, style]}>{children}</View>;
}

export function Field(props: TextInputProps & { label?: string }) {
  const { label, style, ...rest } = props;
  return (
    <View style={{ marginBottom: 12 }}>
      {label ? <Text style={s.label}>{label}</Text> : null}
      <TextInput placeholderTextColor={C.dim} style={[s.input, style]} {...rest} />
    </View>
  );
}

export function Badge({ text, color = C.dim }: { text: string; color?: string }) {
  return (
    <View style={[s.badge, { borderColor: color }]}>
      <Text style={[s.badgeText, { color }]}>{text}</Text>
    </View>
  );
}

export function Row({ children, style }: { children: React.ReactNode; style?: ViewStyle }) {
  return <View style={[{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 8 }, style]}>{children}</View>;
}

export function Banner({ text, kind = 'info' }: { text: string; kind?: 'info' | 'warn' | 'bad' | 'good' }) {
  const color = kind === 'warn' ? C.warn : kind === 'bad' ? C.bad : kind === 'good' ? C.good : C.blue;
  return (
    <View style={[s.banner, { borderColor: color }]}>
      <Text style={{ color, fontSize: 13, lineHeight: 18 }}>{text}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  title: { color: C.text, fontSize: 28, fontWeight: '700', letterSpacing: -0.5 },
  sub: { color: C.dim, fontSize: 14, marginTop: 4 },
  h: { color: C.text, fontSize: 17, fontWeight: '700', marginTop: 16, marginBottom: 8 },
  p: { color: C.text, fontSize: 15, lineHeight: 21 },
  btn: {
    borderRadius: 12,
    paddingVertical: 13,
    paddingHorizontal: 16,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
  },
  btnSmall: { paddingVertical: 7, paddingHorizontal: 12, borderRadius: 10 },
  btnText: { fontSize: 15, fontWeight: '700' },
  chip: { borderWidth: 1, borderColor: C.line, borderRadius: 999, paddingVertical: 6, paddingHorizontal: 12 },
  chipText: { color: C.text, fontSize: 13, fontWeight: '600' },
  card: { backgroundColor: C.card, borderRadius: 14, padding: 14, borderWidth: 1, borderColor: C.line, marginBottom: 10 },
  label: { color: C.dim, fontSize: 12, fontWeight: '700', marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.6 },
  input: {
    backgroundColor: C.card,
    borderColor: C.line,
    borderWidth: 1,
    borderRadius: 12,
    color: C.text,
    fontSize: 15,
    paddingHorizontal: 12,
    paddingVertical: 11,
  },
  badge: { borderWidth: 1, borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 },
  badgeText: { fontSize: 11, fontWeight: '700' },
  banner: { borderWidth: 1, borderRadius: 12, padding: 12, marginBottom: 12, backgroundColor: '#12161C' },
});
