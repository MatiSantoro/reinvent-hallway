# Decisions

Short notes on choices that shaped the app, and what we would change for a public launch.

## 1. The backend never sees the Builder ID token

**Decision:** the app signs in with Builder ID and calls the AWS Events API itself. The backend only gets what the user chooses to share: a display name, session ids and times, and busy time ranges (never what they are).

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

**Why this is enough for now:** the worst case is a few dollars a day, and nothing here holds a credential or personal data beyond a display name and busy time ranges.

## 3. Option we did not take: verify the Builder ID token on the backend

The backend would receive the token, check it with AWS Events, and either allow the request or issue its own short-lived session token.

**Why not now:**
- The backend would hold a live credential for every user, which undoes decision 1 and the privacy claim in the README.
- Users would have to trust the operator of the instance.
- Every protected request would depend on a call to AWS Events. A rate limit or outage there would break the app, and we have not verified that the API allows server-side calls.
- Groups would be tied to real identities, against the "members only share busy times" design.

**What it would take, for a public launch:** verify the token once, never store or log it, and return a short-lived signed session. That limits exposure to a single request, but the token still reaches the server, so the privacy line in the README would have to be rewritten.

## 4. Builder ID must be registered for re:Invent 2026

The catalog returns `403` for a Builder ID that is not registered for the event, and the app stays on the sign-in screen with a "not registered" message. There is no demo mode.
