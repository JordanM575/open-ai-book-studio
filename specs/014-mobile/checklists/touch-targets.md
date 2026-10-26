# Touch-target audit

**Purpose**: record the coarse-pointer measurements required by spec 014 FR-011…FR-014.
**Date**: 2026-10-25
**Method**: `bun scripts/capture.mjs <size> <out> "<clicks>" --coarse`. The flag emulates
`(pointer: coarse)` and touch, then the app asserts that every visible interactive control is at least
44 × 44 CSS pixels and that `document.scrollWidth` does not exceed the viewport. A failure prints the
offending control and exits non-zero.

## Screens measured

| Viewport | Screen | Result |
| --- | --- | --- |
| 393 × 852 | Library | pass, no horizontal overflow |
| 393 × 852 | Workspace | pass |
| 393 × 852 | Chapter drawer | pass |
| 393 × 852 | Writing agent sheet | pass |
| 393 × 852 | Search | pass |
| 393 × 852 | Story Bible | pass |
| 393 × 852 | Model picker | pass |
| 393 × 852 | New book | pass |
| 393 × 852 | Connections | pass |
| 744 × 1133 | Library, workspace, Story Bible, model picker | pass |
| 1133 × 744 | Workspace, search | pass |

Every run reported `0 below 44px` after the fixes below. The same controls were inspected in light and
dark themes; the hit area is unchanged by theme.

## Controls that needed work

| Control | Before | Change |
| --- | --- | --- |
| Icon buttons in the header, rail and dialogs | 28–36px | Coarse-pointer and compact layouts set `min-block-size`/`min-inline-size` to `--touch-target` (44px); the icon stays the same size. |
| Checkbox and radio labels | Label height followed the text | Labels that wrap a checkbox/radio get the 44px minimum so the whole row is tappable. |
| Chapter delete | Appeared on hover only, so unreachable on touch | On coarse pointers it moves into the row and stays visible; it keeps the existing delete confirmation. |
| Agent send row | The keyboard hint pushed Send past the right edge at 393px | The hint hides below 520px and the button cannot shrink; Send is fully visible. |
| Library path | Clipped mid-character at 393px | The flex item can shrink and truncates with an ellipsis; the full path remains in `title`. |
| Dialog content | Tall dialogs could exceed the viewport | Dialogs cap at `100dvh - 48px` and scroll their content; Story Bible's nested scroll was removed. |

## Known limits

- The audit checks CSS pixel size and document overflow, not overlap between hit areas. The chapter
  row and the delete action were rearranged so their targets do not overlap.
- Electron emulates the pointer media feature for this check. A real iOS Simulator pass is still
  required by spec 014 T013–T015 once the web build and Capacitor shell exist.
- VoiceOver labels, focus order and rotation persistence are checked in T014–T015, not here.
