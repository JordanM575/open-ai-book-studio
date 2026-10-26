# Event brief: Meta Global AI Developer Hackathon

**Source:** the participant guide supplied on 2026-10-26, plus the event page and waiver supplied on
2026-10-25:
<https://cerebralvalley.ai/e/meta-ai-developer-hackathon> and
<https://cerebralvalley.ai/e/meta-ai-developer-hackathon/waiver>.
The guide explains the event; the Official Rules control if they differ from this summary.

## What it is

A ten-day, virtual, worldwide hackathon for building with Meta's newest models. Participants get
access to the Muse Spark series, Muse Wonder, Muse Image, Muse Voice Transcribe and SAM 3.1 through
the Meta Model API, can run Meta open-weights models (Muse Glimmer and Muse Spark Open), and can code
with the Muse Code coding agent.

The event is free to enter for selected participants. Applications were reviewed on a rolling basis
against two equally weighted criteria: the clarity and feasibility of the project idea, and the
technical skill shown by the applicant's previous work. Links to GitHub, LinkedIn or a shipped product
help verify that work.

**Building period:** October 27 – November 4, 2026. The kickoff is October 26 at 12:00 PM ET.

## Problem statements

Every project must build towards one of two problem statements, and must incorporate Meta's models.

| Problem statement | What it asks for |
| --- | --- |
| Build for Your World | Bring Meta's models into a domain you know firsthand; solve a real problem and free up time or mental space, or make something possible that was not before |
| Push the Frontier | Apply the models to software, robotics, manufacturing, energy, materials or another frontier; give a machine a new capability, accelerate an experiment or unlock a better way to understand and control a physical system |

AI Book Studio fits **Build for Your World**: a local-first writing studio for authors, with the
author's own files and a writing partner that can plan, draft, revise and illustrate.

## Dates and schedule

All times are Eastern. The Mac is in Eastern time; after November 1 the zone changes from EDT to EST.
All sessions are streamed live; the stream opens shortly before the first session.

| Date | Event |
| --- | --- |
| October 13, 9:00 AM | Applications opened |
| October 25, 11:59 PM | Application deadline, or earlier if 20,000 places fill |
| October 26, 9:00 AM | Applicant approval notifications due |
| **October 26, 12:00 PM** | **Kickoff:** opening remarks, overview, rules, prizes, judging and the Meta speaker kickoff |
| October 27, 12:00 – 1:00 PM | *Agents 101: Build a Multimodal AI Agent* — Suraj Subramanian |
| October 28, 12:00 – 1:00 PM | *Agents 102: Best Practices for Verifiable Agents* — Yash Khare |
| October 30, 12:00 – 1:00 PM | *Building Specialized Intelligence on Fireworks: From Inference to Training with Muse Open Models* — Sinan Ozdemir |
| Weekdays | Discord office hours, 10:00 – 11:00 AM ET, text answers in `#office-hours` |
| November 3 | Last full day for submission questions and technical troubleshooting |
| **November 4, 9:00 PM** | **Final Discord office hours; submissions due on the CV platform** |
| November 5 – 8 | Judging period |
| November 9, 12:00 PM | Closing ceremony: top 10 teams announced (five per track), live final judging, winners revealed, community vote opens |
| November 16 | Community vote winner announced on Discord |

## Community and teams

Join the Hackathon Discord from the event page. Useful channels:

| Channel | Purpose |
| --- | --- |
| `#general` | Socialise and meet other hackers |
| `#announcements` | Official updates and reminders |
| `#intros` | Introduce yourself and what you are building |
| `#team-search` | Find teammates before the event; maximum team size is four |
| `#questions` | General questions for Cerebral Valley |
| `#office-hours` | Questions for the Meta team, weekdays 10:00 – 11:00 AM ET |
| `#baseten` | Baseten support and credit questions |

Teams are optional and capped at **four participants**; solo participants are allowed. Each member
must claim their own Meta Model API credits; credits cannot be claimed on someone else's behalf.

## Tracks

Every project enters exactly one track. The participant guide names the two tracks and their prizes
but does not restate the entry criteria, so the definitions below come from the earlier event page
summary. Confirm the current wording in the Official Rules or ask in `#questions`.

| Track | Who | Judged on |
| --- | --- | --- |
| Indie Developer | Individual builders and students | Creativity, technical ambition, and whether it works |
| Startup | Teams and founders building a real product | Technical execution and whether it holds up in production |

A solo submission belongs in the Indie track. The Startup track is appropriate only if the submission
is made as a team or company and the product is being positioned as a real business.

## Models and tools

The project must incorporate Meta's models. That can be the Meta Model API, Meta open weights, or
both; the guide lists the Muse Spark series, Muse Wonder, Muse Image, Muse Voice Transcribe, SAM 3.1,
Muse Glimmer, Muse Spark Open and Muse Code.

| Capability | Meta surface named by the event | Intended use in the project |
| --- | --- | --- |
| Planning and prose | Muse Spark series, Muse Wonder | Chapter planning, drafting, revision, continuity checks |
| Images | Muse Image | Chapter illustrations, character portraits, cover concepts |
| Segmentation | SAM 3.1 | Select a character or object in an illustration, cut it out, build a cover or character card |
| Speech | Muse Voice Transcribe | Dictated notes, scene transcription, accessibility for drafting |
| Open weights | Muse Glimmer and Muse Spark Open through Baseten, Modal or Fireworks | Private or cost-controlled inference, and a fallback if the hosted API is unavailable |
| Coding | Muse Code | Development speed during the event; not part of the shipped app |

Exact model identifiers, endpoints and request shapes must be confirmed after acceptance. Do not
hard-code an identifier from an announcement; put them behind the provider registry and a capability
test. Baseten's docs use `meta-models/muse-spark-open`, but the hackathon endpoint is
`meta-models/muse-spark-open-1026`.

## Rules

- **Open source:** repositories must be public. Submit a public repository; a private repository with
  judge access is only acceptable if the portal explicitly supports it.
- **Team size:** a maximum of four participants. Solo entrants are allowed.
- **New work only:** everything presented must have been built during the event. Startups may build
  on an existing product or codebase, but must clearly identify what was newly developed during the
  Hackathon.
- **Demo scope:** the demo must highlight only the features, code and functionality built during the
  Hackathon. Judges must be able to identify what was created during the event. Failure to clearly
  identify original contributions can result in immediate disqualification at the judges' discretion.
- **Access:** the repository must be publicly accessible, the video link must work, and everyone who
  worked on the project must be listed on the submission page.
- **Banned projects:** projects are disqualified if they violate legal, ethical or platform policies,
  or use code, data or assets the team does not have the rights to.

### Team composition and outside help

The guide caps a team at four and allows solo entrants, but it does **not** say the Indie track is
solo-only. A team of up to four is therefore the safe reading for either track, subject to the
Official Rules.

What is not optional is disclosure. Anyone who contributes code, assets or other work is a team
member and must be listed on the submission page. Colleagues who only give feedback or review are not
contributors, but if they write code, fix bugs, design assets or build the demo, add them to the team
and keep the total at four. Unlisted contributors breach the "everyone who worked on the project"
rule and undermine the new-work disclosure. If the colleagues are co-workers and the product is being
positioned as a company effort, the Startup track and its rules may fit better.

### Sample anti-projects

Generic or policy-violating projects are disqualified. The guide's examples include AI medical
advice, skin-blemish detection, basic RAG applications, simple image analysers, generic "AI for
education" chatbots, job-application screeners, nutrition coaches, personality analysers, and sports
analysers or coaches. Anything political or involving war is also excluded. This list is not
exhaustive.

AI Book Studio is not in the anti-project list, but the submission should keep the demo clearly on
authoring: a working writing studio, not a generic chat wrapper.

## Resources and credits

### Meta Model API

- **$150 in Meta Model API credits** for each accepted participant. Claim through the credit form
  linked from the event page. Credits are distributed in batches; check the Billing page.
- A credit card must be on the account before credits can be used. A temporary pre-authorisation
  charge may appear and is released automatically within a few business days.
- Set a spend-limit notification in Billing if you do not want to spend beyond the $150.
- Claim by **November 4, 9:00 PM ET**. Every participant, including each team member, claims
  individually; credits cannot be claimed on someone else's behalf.
- Docs: overview, quickstart guide and model list. Cookbook: API cookbook, API fundamentals, Muse
  Code recipes and the OSS model cookbook. On-demand sessions cover Muse Spark, building with Muse
  Spark and Muse Code, and the superintelligence blueprint.

### Inference partners

Credits are not guaranteed and are distributed at each partner's discretion.

| Partner | Offer | Requirements |
| --- | --- | --- |
| Baseten | $100 in credits and a 2M TPM rate limit, up to 2,000 participants | Use case reviewed; selected applicants notified by email. Credits are per individual, not per team. Use `meta-models/muse-spark-open-1026` for the event. |
| Modal | $100 in credits, first 1,000 participants | For running Meta's open-weight models through Endpoints, plus serverless GPUs, sandboxes and training tools |
| Fireworks | $25 in credits | Shortlist of teams reviewed with Fireworks; redemption details by email |

Baseten's docs cover the quickstart, Chat Completions API examples, reading Muse Spark Open's
reasoning output, and sending images and audio. Ask in the partner's Discord channel for help.

## Judging

Judging happens in three stages.

1. **Stage one — pass/fail.** The project must reasonably fit the theme and reasonably use the Meta
   Model API and/or Meta's open-weight models.
2. **Stage two — rubric.** Every passing submission is scored from 0 to 10 on four weighted
   categories.
3. **Stage three — finals.** The top five projects per track go to a live final round, where judges
   watch the video demos and rank them with the same rubric.

| Category (weight) | What it measures |
| --- | --- |
| Impact (30%) | Real-world potential: who benefits, how much it matters, whether it could become something people use, and whether it fits a problem statement |
| Use of Meta AI tooling (25%) | How creatively the team used Meta's AI tooling, whether it went beyond a basic integration, and whether it surfaced surprising capabilities |
| Technical depth and execution (20%) | Whether the engineering is sound, refined and crafted with care |
| Demo (25%) | Whether the demo is working and impressive, whether the product holds up live, and whether the video is genuinely cool to watch |

## Prizes

Total prize pool: **$1,000,000** — $400,000 for the Indie Developer track, $550,000 for the Startup
track, and $50,000 in bonus prizes.

### Indie Developer — $400,000

| Place | Prize |
| --- | --- |
| 1st | $150,000 |
| 2nd | $100,000 |
| 3rd | $75,000 |
| 4th | $50,000 |
| 5th | $25,000 |

### Startup — $550,000

| Place | Prize |
| --- | --- |
| 1st | $250,000 |
| 2nd | $150,000 |
| 3rd | $75,000 |
| 4th | $50,000 |
| 5th | $25,000 |

### Bonus prizes — $50,000

| Prize | Amount | What it rewards | How it is judged |
| --- | --- | --- | --- |
| Most Viral Project | $20,000 | Highest engagement on X after the event | Post the demo on X and submit the link; total likes, reposts and comments up to November 8 EOD |
| Best Build on Meta Open Weight Models | $10,000 | Best project built on Muse Glimmer or Muse Spark Open, on the participant's own hardware or partner inference | Flagged in round one; the infrastructure partner verifies the model is eligible |
| Community Vote | $10,000 | Most votes in the public gallery | One vote per verified account; winner announced November 16 |
| Best Agentic Use-Case | $5,000 | Strongest use of AI agents for meaningful tasks, decisions or multi-step workflows | Autonomy, effectiveness and practical usefulness |
| Best Creative Build | $5,000 | Most original and compelling project built with Muse Image or Muse Wonder | Flagged in round one; creative originality, execution and effective use of the model |

## Submission

Solo participants, teams and startups submit through the Cerebral Valley platform by **November 4 at
9:00 PM ET**. Teams and startups submit one project, not one submission per person. Each team
appoints one **Representative** to enter the project. Late submissions are not considered.

The submission requires a **three-minute demo video** that highlights the specific features, code and
functionality built during the Hackathon. The video is a primary judging artefact alongside the code
and the live product.

Expect to provide:

- [ ] Project name, track and theme.
- [ ] A public repository, or a judge-accessible private repository if the portal allows it.
- [ ] A three-minute demo video that shows the product working with Meta models.
- [ ] A README that explains the problem, the product, the architecture and how to run it.
- [ ] A list of the Meta models and partner services used.
- [ ] A short description of what was built during the event and what existed before it.
- [ ] Team member names and links; every contributor must be listed.
- [ ] Confirmation that no secrets, personal data or author manuscripts are in the repository.
- [ ] A working video link and a repository that is accessible without credentials.

## Eligibility

The event is open worldwide except where local law prohibits participation or receiving an award. The
published exclusions include people or organisations subject to certain sanctions or export controls,
and residents of Belarus, China, Russia, Ukraine, Syria and other comprehensively sanctioned regions.
Employees, contractors and interns of Meta and Cerebral Valley, government-affiliated individuals and
their immediate families and households are not eligible.

This is a summary, not legal advice. Read the full waiver and the Official Rules:
<https://cerebralvalley.ai/e/meta-ai-developer-hackathon/waiver>.

Check the Official Rules for:

- whether pre-existing code is allowed, and how it must be disclosed;
- the required repository visibility and licence;
- what the submission form asks for, including demo video length;
- IP ownership, use of Meta marks, and publicity permissions;
- the exact deadline and time zone;
- any limits on model use, spending or team size.

## Links

- Event page: <https://cerebralvalley.ai/e/meta-ai-developer-hackathon>
- Waiver: <https://cerebralvalley.ai/e/meta-ai-developer-hackathon/waiver>
- Participant guide and Discord, livestream, credit-claim forms and submission portal: linked from
  the event page and the participant portal.
- Official Rules: published on the event page before October 26, 2026.
