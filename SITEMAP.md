# Marquee — Site map

Every screen in Marquee, who reaches it, and how they get there. Routes are the
hash routes the prototype ships (`prototypes/pipeline-v1.1/index.html`); the
built app serves the same paths per `SPEC.md` §5.

Four audiences share one product: the **organizer** (the program team), the
**speaker**, the **reviewer**, and the **public**. Only the organizer sees the
full sidebar; the other three each meet one surface and nothing else.

---

## 1. The whole site

```mermaid
flowchart TD
  Landing["#landing<br/>Marketing landing"]

  Landing --> Organizer
  Landing --> Speaker
  Landing --> Public

  subgraph Organizer["Organizer — the admin shell"]
    direction TB
    Dash["#dashboard<br/>Program pipeline"]
    Board["#board<br/>Program board"]
    Subs["#submissions<br/>Abstracts and Sessions"]
    Agenda["#agenda<br/>Agenda builder"]
    Onboard["#onboarding<br/>Speaker onboarding"]
    Forms["#forms<br/>Form builder"]
    Eval["#evaluation<br/>Evaluation plan"]
    Comms["#comms<br/>Communications"]
    Settings["#settings<br/>Conference settings"]
  end

  subgraph Reviewer["Reviewer — scoped to assigned tracks"]
    Home["#reviewer<br/>Reviewer home"]
    Queue["#reviewer/queue<br/>Review queue"]
  end

  subgraph Speaker["Speaker — magic-link portal"]
    Portal["#portal<br/>Speaker portal"]
  end

  subgraph Public["Public — server-rendered, no auth"]
    CFP["#cfp<br/>Call for speakers"]
    Proposals["/my-proposals<br/>Your proposals · email door"]
    Site["#publicAgenda<br/>Conference site"]
    Session["#s/:id<br/>Session page"]
    Person["#p/:name<br/>Speaker page"]
  end

  Eval --> Queue
  Forms --> CFP
  Agenda --> Site
  Site --> Session
  Site --> Person
  Onboard --> Portal
  CFP --> Proposals
  Proposals -->|emailed link| Portal
```

---

## 2. Organizer navigation — the sidebar

The sidebar is the organizer's whole map: brand, conference switcher, Program home,
the seven pipeline stages, then the modules. Every module is one click from home.

```mermaid
flowchart LR
  subgraph Chrome["Sidebar"]
    direction TB
    Switch["Conference switcher<br/>+ Create conference"]
    Home["Program home"]
    BoardNav["Program board"]
  end

  subgraph Pipeline["Pipeline — 1 to 7"]
    direction TB
    P1["1 Submitted"]
    P2["2 In review"]
    P3["3 Waved"]
    P4["4 Accepted"]
    P5["5 Onboarding"]
    P6["6 Scheduled"]
    P7["7 Published"]
  end

  subgraph Modules["Modules"]
    direction TB
    M1["CFP forms"]
    M2["Evaluation plan"]
    M3["Review queue"]
    M4["Agenda"]
    M5["Communications"]
    M6["Speaker portal"]
    M7["Conference site"]
    M8["Conference settings"]
  end

  subgraph Foot["Footer"]
    direction TB
    F1["API and CLI"]
    F2["Reset demo"]
  end

  Switch --> EventNew["#conferences/new"]
  Home --> Dash["#dashboard"]
  BoardNav --> Board["#board"]

  P1 & P2 & P3 & P4 & P6 & P7 --> Subs["#submissions<br/>pre-filtered by stage"]
  P5 --> Onb["#onboarding"]

  M1 --> Forms["#forms"]
  M2 --> Eval["#evaluation"]
  M3 --> Rev["#reviewer"]
  M4 --> Ag["#agenda"]
  M5 --> Comms["#comms"]
  M6 --> Portal["#portal"]
  M7 --> Site["#publicAgenda"]
  M8 --> Set["#settings"]
  F1 --> Docs["#api/docs"]
```

---

## 3. Settings and its sub-routes

```mermaid
flowchart LR
  Set["#settings<br/>Conference settings"]
  Set --> Details["Conference details<br/>name · dates · timezone · venue · logo"]
  Set --> Formats["Formats<br/>name · range · default duration"]
  Set --> Tracks["Tracks<br/>name · colour · order"]
  Set --> Buildings["Buildings<br/>name · address"]
  Set --> Rooms["Rooms<br/>capacity · building · AV · notes"]

  Set --> Venues["#settings/venues<br/>Venues — buildings, pins, site map"]
  Set --> Tasks["#settings/tasks<br/>Task templates"]
  Set --> Air["#settings/airtable<br/>Airtable mirror (inbound)"]
  Set --> Tokens["#settings/api<br/>API tokens"]
  Set --> Hooks["#settings/webhooks<br/>Outbound webhooks"]
  Tokens --> Docs["#api/docs<br/>API documentation"]
  Hooks --> Docs
```

---

## 4. The record spine

Everything an organizer does converges on one submission record. The board and
the lists are ways of finding it; the record owns every consequential action.

```mermaid
flowchart TD
  Board["#board<br/>Program board — read only"]
  Subs["#submissions<br/>filtered list · saved views · columns"]
  Search["Global search<br/>Cmd-K"]
  New["#submissions/new<br/>Create submission"]

  Board -->|"click a card"| Record
  Subs -->|"open a row"| Record
  Search --> Record
  New --> Record

  Record["#submissions/:id<br/>Submission record"]

  Record --> Decide["Decision<br/>approve · maybe · deny"]
  Record --> Message["One-off message"]
  Record --> Place["Place on agenda"]
  Record --> Publish["Publish"]
  Record --> PubView["View public page"]
```

---

## 5. The fresh install — cold start to open intake

A brand-new install has no conference. This is the walk that creates one, reachable
from `?empty=1` on any route and sticky until exited.

```mermaid
flowchart TD
  Fresh["Fresh install<br/>no conferences yet"]
  Fresh --> EventNew["#conferences/new<br/>Create conference"]

  EventNew -->|"start from scratch"| Created
  EventNew -->|"import from Sessionize"| Import["#import<br/>Sessionize importer"]
  Import --> Created

  Created["Conference exists<br/>checklist 1 of 5"]
  Created --> Tax["#settings<br/>tracks · formats · rooms"]
  Tax --> Form["#forms<br/>build the call for speakers"]
  Form --> Eval["#evaluation<br/>scorecard · committee · rounds"]
  Eval --> Open["#forms<br/>publish the form"]
  Open --> Live["Intake is open<br/>checklist 5 of 5"]

  Live --> CFP["#cfp<br/>public call for speakers"]
  Live --> Exit["Exit to the seeded demo"]
```

---

## 6. Public surfaces

The only routes served without auth. Nothing private leaks here: unpublished
titles have no public permalink.

```mermaid
flowchart TD
  CFP["#cfp<br/>Call for speakers"]
  CFP --> Draft["Draft autosave<br/>private resume link"]
  CFP --> Submitted["Submission received"]
  Submitted --> Mine["/my-proposals<br/>every proposal, one page"]
  Mine -->|emailed link, no password| Home["#portal<br/>submitter seat"]

  Site["#publicAgenda<br/>Conference site"]
  Site --> Sess["#s/:id<br/>Session page"]
  Site --> Spk["#p/:name<br/>Speaker page"]
  Site --> Embed["Embeds<br/>agenda · speaker gallery"]

  Cal["/i/:uid.ics<br/>calendar invite"]
  Feed["/agenda.json<br/>feed"]
```

---

## 7. Route table

| Route | Screen | Seat |
|---|---|---|
| `#landing` | Marketing landing | Public |
| `#conferences/new` | Create conference | Organizer |
| `#dashboard` | Program pipeline | Organizer |
| `#board` | Program board | Organizer |
| `#submissions` | Abstracts and Sessions | Organizer |
| `#submissions/new` | Create submission | Organizer |
| `#submissions/:id` | Submission record | Organizer |
| `#forms` | Form builder | Organizer |
| `#evaluation` | Evaluation plan | Organizer |
| `#evaluation/ai` | AI assist (optional, off the demo path) | Organizer |
| `#reviewer` | Reviewer home | Reviewer |
| `#reviewer/queue` | Review queue | Reviewer |
| `#onboarding` | Speaker onboarding — the chase board | Organizer |
| `#agenda` | Agenda builder | Organizer |
| `#comms` | Communications | Organizer |
| `#settings` | Conference settings | Organizer |
| `#settings/venues` | Venues — buildings, coordinates, site map | Organizer |
| `#settings/tasks` | Task templates | Organizer |
| `#settings/airtable` | Airtable mirror (inbound) | Organizer |
| `#settings/api` | API tokens | Organizer |
| `#settings/webhooks` | Outbound webhooks — endpoints, test delivery, deliveries log | Organizer |
| `#api/docs` | API documentation | Organizer |
| `#import` | Sessionize importer | Organizer |
| `#portal` | Speaker portal | Speaker |
| `#cfp` | Public call for speakers | Public |
| `/my-proposals` | Your proposals — the submitter's email door (aliases `/my-submissions`, `/proposals`) | Public |
| `#publicAgenda` | Conference site | Public |
| `#s/:id` | Public session page | Public |
| `#p/:name` | Public speaker page | Public |

Append `?empty=1` to any route to enter the fresh-install walk.
