# Feature Specification: Mobile Targets

**Feature Branch**: `014-mobile`

**Status**: In progress

**Input**: "I want to target ipad mini and iphone."

## Overview

AI Book Studio is a local-first writing studio. Its reference devices are now the **iPhone** (393 ×
852 logical points) and **iPad mini** (744 × 1133). Desktop remains supported at 1440 × 900, but the
small layouts are designed first and must not be a squeezed desktop.

The same React renderer serves Electron, the planned browser build and the Capacitor iOS shell. A
phone gets a single-column workspace with a bottom action bar, a chapter drawer and a full-screen
agent; an iPad mini gets the chapter rail beside the manuscript and the agent as a sheet until the
window is wide enough for a side panel. The manuscript is always the solid, readable surface.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Write on an iPhone (Priority: P1)

An author opens a book on an iPhone, sees the chapter title and prose without horizontal scrolling,
and can move between chapters, search, open the agent and reach book tools from a bottom bar.

**Acceptance**

- At 393 × 852 the workspace uses one column and the manuscript has at least 20px side padding.
- The header shows back, book title and save state; it does not overflow.
- The bottom bar exposes Chapters, Search, Agent and More with labels and 44px touch targets.
- Chapters open in a drawer over a scrim and close after a chapter is chosen.
- The agent opens as a full-screen sheet with a visible close control.
- Every dialog fits within `calc(100vw - 48px)`.

### User Story 2 - Plan on an iPad mini (Priority: P1)

An author opens the studio on an iPad mini in portrait and sees the chapter rail beside the
manuscript, with the header actions available without a menu.

**Acceptance**

- At 744 × 1133 the rail is visible, the manuscript is centred and at least 430px wide.
- Header actions fit on one row at 744px.
- The agent is a full-screen sheet below 1000px and a 400px side panel at or above 1000px.
- Rotating to landscape keeps the same chapter and unsaved text.

### User Story 3 - Keep the studio honest on touch (Priority: P1)

An author uses the app without a mouse or hardware keyboard and can still reach every action.

**Acceptance**

- No interactive control is smaller than 44 × 44 logical points.
- Focus order follows the visual order; icon-only buttons have accessible names.
- Reduced transparency and reduced motion are honoured.
- The save status is announced when it changes.

### User Story 4 - Run inside the Capacitor shell (Priority: P2)

The same layout runs in a Capacitor WKWebView on iOS without Expo or React Native.

**Acceptance**

- The Capacitor shell loads the web build from `webDir` and launches on the iOS Simulator.
- The layout respects the safe-area insets at the top and bottom.
- A missing native plugin degrades with an explanation instead of a blank screen.

## Requirements

### Layout

- **FR-001** The renderer MUST support 393 × 852, 744 × 1133 and 1440 × 900 without horizontal
  scrolling.
- **FR-002** Below 700px the workspace MUST be one column with a bottom action bar.
- **FR-003** Between 700px and 999px the chapter rail MUST remain visible beside the manuscript.
- **FR-004** At or above 1000px the workspace MUST use the three-pane desktop layout.
- **FR-005** The agent MUST be a full-screen sheet below 1000px and a 400px panel above it.
- **FR-006** Chapter navigation MUST be a drawer below 700px and a rail above it.
- **FR-007** Dialogs MUST be capped at `calc(100vw - 48px)` and remain scrollable.
- **FR-008** The manuscript MUST use 16/26 type and 20px side padding below 700px.
- **FR-009** The manuscript MUST keep its reading font and remain the only solid surface.

### Touch and accessibility

- **FR-010** Every interactive control MUST have a target of at least 44 × 44 logical points.
- **FR-011** Icon-only controls MUST have an accessible name and a visible focus ring.
- **FR-012** The bottom bar MUST label each icon and mark the active agent state.
- **FR-013** Reduced transparency and reduced motion preferences MUST be respected.
- **FR-014** The safe-area insets MUST be applied in the Capacitor shell.

### Behaviour

- **FR-015** Switching orientation MUST preserve the selected chapter and unsaved editor text.
- **FR-016** The mobile layout MUST NOT change the save protocol, conflict handling or file format.
- **FR-017** A missing native capability MUST produce an author-facing explanation, not a blank view.
- **FR-018** The mobile build MUST NOT add Expo or React Native to the app stack.
- **FR-019** Spec 014 owns native iOS library storage integration. It MUST use the shared library
  port and checked save/conflict contract; an unavailable or revoked permission MUST be explained
  without silently moving the library to a different storage tier.
- **FR-020** Native iOS provider credentials MUST use an accepted protected host store, remain outside
  the library and exports, and refuse storage with an explanation if protection is unavailable. No
  plaintext fallback is permitted.
- **FR-021** Native lifecycle and permission handling MUST represent pending, confirmed, failed or
  unconfirmed work honestly after suspension, resume or termination. A missing, denied or revoked
  capability MUST refuse the affected operation and explain recovery where available.

These native requirements are retained work, not a claim of an implemented adapter. Spec 010 owns
shared library ports and browser storage; spec 013 owns shared build and capability contracts. The
native decisions, implementation and target evidence in [the plan](plan.md) and [tasks](tasks.md)
remain open.

## Key Entities

- **Reference device**: a named viewport used for design and verification.
- **Bottom action bar**: the phone navigation surface.
- **Chapter drawer**: the phone chapter navigator.
- **Agent sheet**: the full-screen phone/tablet conversation surface.
- **Capacitor shell**: the native iOS wrapper around the web build.

## Success Criteria

- **SC-001** A book opens and prose is readable at 393 × 852 with no horizontal scroll.
- **SC-002** A book opens with the rail visible at 744 × 1133.
- **SC-003** Every bottom-bar and header action is reachable at 393px.
- **SC-004** The agent opens, covers the workspace and closes at 393px and 744px.
- **SC-005** Dialogs remain usable at 393px.
- **SC-006** Rotating the viewport keeps the selected chapter and unsaved text.
- **SC-007** The Capacitor shell launches the web build on the iOS Simulator.
- **SC-008** The existing 107 tests, typecheck, build and hidden smoke run still pass.

## Assumptions

- iPhone 393 × 852 and iPad mini 744 × 1133 are the reference viewports.
- Electron remains the desktop reference; the web build is the prerequisite for Capacitor.
- The Capacitor shell spike passed with Capacitor 8.5.3 on the iPhone 17 Pro simulator.
- Native iOS storage, protected credentials, lifecycle, permissions and capability/refusal
  integration belong to this spec. [D-117](../../docs/DECISIONS.md) is proposed; no native plugin,
  storage mechanism or credential adapter is selected by this ownership statement.
- The iOS runtime is iOS 26.5 under Xcode 26.6; commands need
  `DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer`.

## Non-Goals

- Android layout work.
- App Store signing, TestFlight or review.
- A separate React Native UI.
- Changing the manuscript format or sync model.
