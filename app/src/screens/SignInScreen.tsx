import React, { useState } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';
import { useApp } from '../state/AppState';
import { Banner, Btn, C, P } from '../ui/kit';

export function SignInScreen() {
  const app = useApp();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string>();

  if (app.status === 'starting' || app.status === 'loading') {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 }}>
        <ActivityIndicator color={C.accent} />
        <P dim style={{ marginTop: 12, textAlign: 'center' }}>
          {app.progress || 'Starting...'}
        </P>
      </View>
    );
  }

  return (
    <View style={{ flex: 1, justifyContent: 'center', padding: 24 }}>
      <Text style={{ color: C.accent, fontSize: 14, fontWeight: '800', letterSpacing: 2 }}>HALLWAY</Text>
      <Text style={{ color: C.text, fontSize: 34, fontWeight: '800', marginTop: 8, letterSpacing: -1 }}>
        Plan your re:Invent week, alone or with your crew.
      </Text>
      <P dim style={{ marginTop: 16, marginBottom: 32 }}>
        Sign in with your AWS Builder ID. Your login stays on this phone. Hallway talks to the official AWS Events API
        for your schedule, and only shares what you choose with your groups.
      </P>

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
    </View>
  );
}
