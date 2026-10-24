# For the judges

Thanks for taking a look at Hallway. This page is everything you need. **You do not need an AWS account, and you do not need to deploy or run any backend.** The backend is already running and is shared by everyone who tries the app.

## What it is

Hallway is a phone app (iPhone and Android) that plans your re:Invent 2026 week. You say what you want to learn, an agent on Amazon Bedrock picks sessions, and Hallway builds a week with no clashes and time to walk between venues. It then reserves seats in your real re:Invent account, and lets a group of friends share a calendar and find the time everyone is free. It uses all 12 operations of the AWS Events API.

## What you need

- **An Android phone** (the easy way: you just install a file), **or an iPhone plus a Mac** (see the iPhone row below for why).
- **An AWS Builder ID that is registered for re:Invent 2026.** The app signs you in and reads your real schedule from the AWS Events API. For an account that isn't registered, that API refuses the request (`403`) and the app stops on the sign-in screen with a "not registered" message. If that's you, use the demo video below.

That's all for Android: no AWS account, no CDK, no Android Studio, and **no Expo Go or any other app**. You install Hallway itself.

## Ways to try it

Pick one.

| | How |
|---|---|
| **Android** | Download `hallway.apk` from the **[latest release](https://github.com/MatiSantoro/reinvent-hallway/releases/latest)**. Open it on the phone and allow "install unknown apps" for your browser when Android asks. |
| **iPhone** | There is no installable iPhone file: that needs a paid Apple Developer account, which we don't have. If you have a **Mac with Xcode** and an iPhone, you can build it onto your phone with a free Apple ID in a few minutes: follow [Run it on an iPhone](README.md#run-it-on-an-iphone-no-paid-apple-account) in the README (`npx expo run:ios --device`). The app then works for 7 days. |
| **Watch, no install** | Demo video: **`<VIDEO LINK: add before submitting>`** |
| **Build it yourself** | Only if you want to. See [Run it yourself](README.md#run-it-yourself) in the README. You will need the shared backend address and app key, listed [just below](#backend-address-and-key-for-building-it-yourself). |

## Backend address and key (for building it yourself)

Only needed if you build the app yourself. Put these two lines in a file called `app/.env`:

```
EXPO_PUBLIC_BACKEND_URL=https://9y85ebqg0m.execute-api.us-east-1.amazonaws.com
EXPO_PUBLIC_API_KEY=d71d7673db1a1ba4d9aff36f16b9d8ca90fe2cc5a769b90a
```

This is the shared backend that every judge uses. The key is not a secret: it ships inside the app and this repository is public, so anyone can read it. It only keeps casual traffic out. What protects the backend is a daily limit on planning calls, shared and per person. [DECISIONS.md](DECISIONS.md) explains why. The backend is switched off after judging, so these values stop working then.

## Five-minute tour

1. **Sign in** with your Builder ID. The browser opens, you approve, and you come back to the app. Your login stays on the phone.
2. **Plan.** Type something like *"Agents and MCP, Python, nothing before 9am, one fun session outside my job"*, or pick a certification (the chips show current exam versions). Tap **Build my week**. The agent takes roughly 10 to 25 seconds. You get a day-by-day plan with a reason for each pick and walking blocks between venues.
3. **Reserve.** Use **Reserve** on a single session, or **Reserve all**. A green border and "✓ RESERVED" mean you hold a seat. If a session can't be booked, its card says why (full, clash, and so on).
4. **Explore.** Search and filter the whole catalog. Everything is filtered on the phone.
5. **My week.** *Schedule* shows what you hold seats for; *Favorites* shows what you only starred. **Sync walking time** adds walking blocks to your calendar.
6. **Groups.** See below.

> **Heads up: reservations are real.** Reserve, favorite and walking-time actions change your actual re:Invent schedule. You can undo them from **My week** (Cancel seat, Unfavorite, Remove).

## Trying Groups together

You do not need to be in the same room or on the same Wi-Fi. A group lives on the shared backend, not on anyone's phone.

1. Judge A opens **Groups**, creates a group (*Squad: go together* or *Team: split and cover more*), and shares the **invite code** (8 characters, unique to that group) or the invite link.
2. Judge B opens **Groups**, enters the code, and joins. Up to 50 people can join one group.
3. Names are unique inside a group, so if two of you pick the same name, the second one is asked to choose another. Joining a group you are already in just tells you so.
4. Both can now see the group's plan as a **Calendar** (an hour-by-hour day view) or a **List**, propose sessions from the **whole catalog** (search by title, code or speaker), plan a meetup at any day and time, tap **I'm in** to reserve their own seat, use **Find free time** (with their own hours and minimum length), and in a Team group use **Split sessions** so the team covers more ground.

Members only share their busy times, never what the busy times are.

**Owner.** Whoever creates a group is its owner. The owner can remove a member (for example someone who lost their phone), remove anyone's proposed item, and delete the group for everyone. If the owner leaves, the member who has been in the group longest becomes the owner. When the last member leaves, the group and its invite code are deleted.

## What to expect

- **Planning is not instant.** The agent call takes roughly 10 to 25 seconds, and the screen says what it is doing.
- **Shared limits.** To keep the demo cheap, planning is capped at 100 calls a day across all judges, and at 25 a day for each person (a group of judges on the same Wi-Fi share that 25). If you ever see a "planning limit" message, the phone falls back to ranking sessions locally.
- **The AWS Events API can say no.** It can close an operation (`409`), refuse when you are over a quota (`429`, Hallway waits and retries), or report a session as full. Hallway shows these messages instead of hiding them, and checks `GetSchedule` after every change.
- **Walking times and certification mappings are our own estimates.** The API has venue names but no coordinates, and no certification field.

## If something goes wrong

- **Sign-in says "could not reach oauth.awsevents.com" or "Unable to resolve host" (Android).** This is a phone network setting, not a bug in your account. Turn off **battery saver** (or set Hallway to "unrestricted" in the phone's battery settings), then try again. If it persists, switch between Wi-Fi and mobile data, or set **Private DNS** to `dns.google` in Settings > Connections > More connection settings.
- **Chrome shows "127.0.0.1 refused to connect" after you sign in.** You have an older build. Install the latest `hallway.apk` from the release.
- **"Not registered for re:Invent 2026".** Your Builder ID is not registered for the event, so the AWS Events API refuses it. Use the demo video instead.
- **"The app key is missing or out of date" (building yourself).** Copy the two lines from [the section above](#backend-address-and-key-for-building-it-yourself) into `app/.env` and restart the dev server with `npx expo start --dev-client --clear`.

## Privacy and design

Your AWS login never leaves your phone, and the backend cannot tell who is calling it. That is deliberate, and it is why the backend is protected with limits rather than logins. [DECISIONS.md](DECISIONS.md) explains the trade-offs, including why we did not verify the token on the server.

## Where to look in the code

| What | Where |
|---|---|
| Builder ID sign-in (OAuth + PKCE, local callback) | `app/src/api/auth.ts`, `app/src/api/loopback.ts` |
| All 12 AWS Events API operations | `app/src/api/events.ts` |
| Write, then verify (no blind retries) | `app/src/logic/reconcile.ts` |
| Clashes, daily cap, walking time | `app/src/logic/scheduler.ts` |
| Agent planner (Bedrock via our backend) | `app/src/logic/planner.ts`, `backend/lambda/planner.py` |
| Groups, free-time finder, team split | `backend/lambda/groups.py`, `backend/lambda/schedule_math.py` |
| Architecture diagram | [README](README.md#how-it-works) |
