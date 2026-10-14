import React, { useState } from 'react';
import { ActivityIndicator, Image, ScrollView, Text, View } from 'react-native';
import { useApp } from '../state/AppState';
import { Icon, IconName, LOGO } from '../ui/icons';
import { Banner, Btn, C, P } from '../ui/kit';

const FEATURES: { icon: IconName; title: string; body: string }[] = [
  { icon: 'plan', title: 'An agent that picks your sessions', body: 'Describe your goals or the certification you are studying. It ranks the whole catalog for you.' },
  { icon: 'week', title: 'A week that actually works', body: 'No clashes, time to walk between venues, and one tap to reserve your seats.' },
  { icon: 'groups', title: 'Plan with your crew', body: 'Share a calendar and find the time everyone is free. Others see when you are busy, never why.' },
];

/** Soft glow behind the content, so the screen is not a flat dark rectangle. */
function Glow() {
  return (
    <View pointerEvents="none" style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, overflow: 'hidden' }}>
      <View style={{ position: 'absolute', top: -140, right: -120, width: 360, height: 360, borderRadius: 180, backgroundColor: C.accent, opacity: 0.1 }} />
      <View style={{ position: 'absolute', top: -60, right: -40, width: 200, height: 200, borderRadius: 100, backgroundColor: C.accent, opacity: 0.1 }} />
      <View style={{ position: 'absolute', bottom: -160, left: -140, width: 340, height: 340, borderRadius: 170, backgroundColor: C.blue, opacity: 0.07 }} />
    </View>
  );
}

function Wordmark({ size = 46 }: { size?: number }) {
  return (
    <Text style={{ fontSize: size, fontWeight: '900', letterSpacing: -size / 18, color: C.text }}>
      Hall<Text style={{ color: C.accent }}>way</Text>
    </Text>
  );
}

export function SignInScreen() {
  const app = useApp();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string>();

  if (app.status === 'starting' || app.status === 'loading') {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 }}>
        <Glow />
        <Image source={LOGO} style={{ width: 88, height: 88, marginBottom: 16 }} />
        <Wordmark size={34} />
        <ActivityIndicator color={C.accent} style={{ marginTop: 28 }} />
        <P dim style={{ marginTop: 12, textAlign: 'center' }}>
          {app.progress || 'Starting...'}
        </P>
      </View>
    );
  }

  return (
    <View style={{ flex: 1 }}>
      <Glow />
      <ScrollView contentContainerStyle={{ flexGrow: 1, justifyContent: 'center', padding: 24 }}>
        <Image source={LOGO} style={{ width: 84, height: 84, marginBottom: 18 }} />
        <Wordmark />
        <Text style={{ color: C.accent, fontSize: 12, fontWeight: '800', letterSpacing: 2.5, marginTop: 6 }}>
          YOUR RE:INVENT 2026 PLANNER
        </Text>

        <Text style={{ color: C.text, fontSize: 24, fontWeight: '800', lineHeight: 30, marginTop: 28, letterSpacing: -0.4 }}>
          Your week, planned in minutes.
        </Text>

        <View style={{ marginTop: 22, gap: 16 }}>
          {FEATURES.map((f) => (
            <View key={f.title} style={{ flexDirection: 'row', gap: 14, alignItems: 'flex-start' }}>
              <View
                style={{
                  width: 44,
                  height: 44,
                  borderRadius: 12,
                  backgroundColor: C.card,
                  borderWidth: 1,
                  borderColor: C.line,
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Icon name={f.icon} size={26} color={C.accent} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ color: C.text, fontSize: 15, fontWeight: '700' }}>{f.title}</Text>
                <Text style={{ color: C.dim, fontSize: 13.5, lineHeight: 19, marginTop: 2 }}>{f.body}</Text>
              </View>
            </View>
          ))}
        </View>

        <View style={{ marginTop: 30 }}>
          {app.status === 'notRegistered' ? (
            <Banner
              kind="warn"
              text="You're signed in, but not registered for re:Invent 2026. Register on the re:Invent site first, then try again."
            />
          ) : null}
          {app.status === 'error' && app.error ? <Banner kind="bad" text={app.error} /> : null}
          {err ? <Banner kind="bad" text={err} /> : null}

          <Btn
            label={app.status === 'notRegistered' || app.status === 'error' ? 'Try again' : 'Sign in with Builder ID'}
            busy={busy}
            onPress={async () => {
              setBusy(true);
              setErr(undefined);
              try {
                if (app.status === 'notRegistered' || app.status === 'error') await app.refreshCatalog();
                else await app.signIn();
              } catch (e) {
                setErr(e instanceof Error ? e.message : String(e));
              } finally {
                setBusy(false);
              }
            }}
          />
          <Text style={{ color: C.dim, fontSize: 12, textAlign: 'center', marginTop: 12, lineHeight: 17 }}>
            Your AWS login stays on this phone. Hallway reads your schedule straight from the official AWS Events API and
            only shares what you choose with your groups.
          </Text>
        </View>
      </ScrollView>
    </View>
  );
}
