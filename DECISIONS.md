# Decisions

Short notes on choices that shaped the app, and what we would change for a public launch.

## 1. The backend never sees the Builder ID token

**Decision:** the app signs in with Builder ID and calls the AWS Events API itself. The backend only gets what the user chooses to share: a display name, session ids and times, and busy time ranges. Session codes (such as COM312-R) are sent only when the user taps Share my schedule; personal blocks are only ever sent as times, never with their title.

**Why:** the Builder ID access token works against the AWS Events API as the attendee. It can read their schedule and change their reservations. If our backend received it, a logging mistake, a compromised Lambda or anyone with access to the AWS account could act as that person. Keeping it on the phone means "your AWS login never leaves the phone" stays true, and people can try the app without trusting whoever runs the backend.

**Consequence:** the backend cannot tell who is calling it. The Builder ID sign-in gates the *app*, not the *API*.

## 2. How we protect the API without knowing who calls it

Because of decision 1, the API is protected by limits instead of by identity:

| Guard | What it does | What it does not do |
|---|---|---|
| Shared app key (`x-api-key`) | Rejects callers that don't have the key the app ships with. | It is inside the app bundle, so anyone who unpacks the app can read it. It is not security. |
| Daily cap on `/plan` (default 100 per UTC day, `planDailyLimit`) | Counts calls in DynamoDB with one atomic conditional write, so the Bedrock bill has a hard ceiling. Requests that fail validation do not use a slot. | It is shared by everyone, so on its own one heavy user could use up the day for the others. |
| Per-caller caps (25 `/plan` calls and 20 new groups per day, `planDailyLimitPerIp`, `groupDailyLimitPerIp`) | Stops one caller from using up the shared cap or filling the table. The caller address comes from API Gateway, which clients cannot fake. Only a short hash of it is stored, and it expires after 3 days. | People on the same network (a conference Wi-Fi, an office) share one address, so the limit is deliberately generous. Someone with many addresses can get around it, and the shared cap still bounds the total. |
| API Gateway throttle (10 requests/s, burst 20) | Stops tight loops. | |
| Optional budget alert (`alertEmail`, `monthlyBudgetUsd`) | Emails at 50%, 80% and 100% of the monthly budget. | It alerts, it does not stop spending. |

**The app key is public by design.** It ships inside the app, and the app and this repository are public, so anyone can read it. Expo's own docs say nothing embedded in an app can be kept secret. The caps and the budget alert are what actually limit the damage. After judging, turn the backend off (`cdk destroy`, or redeploy with `planDailyLimit=0`).

**Why this is enough for now:** the worst case is a few dollars a day, and nothing here holds a credential or personal data beyond a display name, busy time ranges and, if the user chose to share them, session codes.

## 3. A group owner without knowing who anyone is

Groups have an owner, but the backend still cannot tell who a person is. The owner is simply the member who created the group, and the app proves it with the same random secret every member gets when they create or join. The owner can remove a member, remove any item, and delete the group. If the owner leaves, the longest-standing member takes over, and when the last member leaves the group and its invite code are deleted.

**What this does not do:**
- A member who loses their phone (or reinstalls) loses their secret, and with it their membership. If they were the owner, the next member inherits it only after they leave or are removed. The owner can remove the lost member from the list.
- Nobody can prove they are the same person on a second device. Joining twice creates two members. The app stops you doing it twice from one phone, and names must be unique inside a group, but that is a convenience, not security.

## 4. Option we did not take: verify the Builder ID token on the backend

The backend would receive the token, check it with AWS Events, and either allow the request or issue its own short-lived session token.

**Why not now:**
- The backend would hold a live credential for every user, which undoes decision 1 and the privacy claim in the README.
- Users would have to trust the operator of the instance.
- Every protected request would depend on a call to AWS Events. A rate limit or outage there would break the app, and we have not verified that the API allows server-side calls.
- Groups would be tied to real identities, against the "members only share busy times and session codes" design.

**What it would take, for a public launch:** verify the token once, never store or log it, and return a short-lived signed session. That limits exposure to a single request, but the token still reaches the server, so the privacy line in the README would have to be rewritten.

## 5. Builder ID must be registered for re:Invent 2026

The catalog returns `403` for a Builder ID that is not registered for the event, and the app stays on the sign-in screen with a "not registered" message. There is no demo mode.

## 6. The API refuses some characters in personal time, and does not say which

For a while every personal-time block we sent came back `400 "The personal time entry could not be applied"`, even in an empty slot, and the message named no field. Sending the developer guide's own example (`Booth duty`, `2026-12-01T19:00:00` to `21:00:00`) worked, and changing one thing at a time showed the cause: the API refuses `[ ] { } | ^ \`, the backtick and emoji in the title, description and location. Our description tag was `[hallway]`, so every block failed.

The tag is now `(hallway)`, and everything typed by a person (a meetup title, a group name, a block title, a rename) goes through one cleaner (`apiText` in `app/src/logic/reconcile.ts`) that replaces or drops those characters before anything is sent. Accents, dashes, curly quotes and `( ) # : < > _ ·` are accepted. If a block is ever refused again, the banner still shows the exact times sent and the API's reply.

## 7. What a group sees of your schedule

The shared calendar used to show only when members were busy. It is more useful to see who is in which session, so a member can now choose to share their reserved sessions by code (for example `Ana: COM312-R`). The choice is explicit: nothing is shared until the member taps **Share my schedule**, and the backend returns a member's schedule to the group only if they did. Session codes are public catalog data. Personal blocks (a lunch, a walk, an appointment) are never sent with a title: they travel as a time range and show as "busy". **Find free time** still refreshes only the times, and keeps the codes only for a member who already shared them.

We did not share everything. The backend does not know who anyone is (see section 3), so anyone holding an invite code is a member, and a leaked code would expose every title. Sharing codes of sessions anyone can look up is a risk we accept; sharing private blocks is not.
