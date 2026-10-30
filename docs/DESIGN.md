# Design

This is how Architect looks and moves: the desktop app, the site's mocks and the launch film. The
values live in `packages/ui/src/styles` and every screen uses them. Where this file and older notes
disagree, this file wins.

It follows the owner's direction of Oct 29: calm, clean and smooth, after Hestia. The rest of this
file spells out what that means in practice.

## Rules

1. **One flat ground.** The app sits on a single near-black. Nothing is painted on it: no
   gradients, glows, radial washes, vignettes, dot grids or patterns. Depth comes from surfaces
   and hairlines, and from shadow only under things that float (menus, dialogs, toasts).
2. **Text is white.** Every word uses `fg`. Size, weight and spacing make the hierarchy, never a
   grey. Only placeholders and disabled controls are dimmed (`fg-dim`). If a line only works when
   it is grey, it is probably a line to delete.
3. **Say it once.** No eyebrows (small labels above a title). No captions under numbers, cards or
   headings. No helper sentences that repeat what the layout already shows. A label stays only if
   the screen is unclear without it. A number is better than a sentence, an icon with a tooltip is
   better than a word, and details on demand are better than details always on.
4. **Color means something.** There is no decoration color. The student (Glimmer) is blue and so
   is work it got right; the mentor (Spark) is amber; red marks failures and danger. Status is a
   word or an icon (check, cross, lock), never a colored dot.
5. **Few, clear surfaces.** A card is a flat fill with a hairline edge. Rows inside a card are split
   by hairlines, not boxed again. Don't put a card inside a card. Group by space first, by
   hairline second, by surface last.
6. **Everything that appears, moves.** Nothing pops in or out. Motion is quick, physical and
   consistent, and it always explains something: where a thing came from, where it went, what
   changed.

## Color

| Token | Value | Use |
|---|---|---|
| `ground` | `#070707` | the app background, the sidebar, the title bar |
| `card` | `#101010` | cards, panels, table bodies |
| `raised` | `#161616` | the composer, menus, popovers, dialogs, toasts, an active segment |
| `field` | `#0c0c0c` | text fields inside a card |
| `hover` | `rgb(255 255 255 / 0.05)` | row and control hover |
| `selected` | `rgb(255 255 255 / 0.08)` | the selected row or tab |
| `line` | `rgb(255 255 255 / 0.08)` | hairlines, card edges |
| `line-strong` | `rgb(255 255 255 / 0.14)` | control edges, focus-adjacent edges |
| `fg` | `#f4f4f2` | all text and icons |
| `fg-dim` | `rgb(244 244 242 / 0.42)` | placeholders and disabled controls only |
| `primary` / `on-primary` | `#f4f4f2` / `#070707` | the one main action on a screen |
| `student` | `#8ab8ff` | Glimmer, passed work, kept changes |
| `mentor` | `#f0b470` | Spark |
| `danger` | `#ff6b5e` | failures, destructive actions, errors |
| `ring` | `rgb(244 244 242 / 0.6)` | keyboard focus ring, 2px, offset 2px |

There is one theme. The window, the native title bar and `color-scheme` are always dark.

## Type

- **Inter Tight** (variable) for titles and for numbers that matter. Weight 600. Tracking tightens
  with size: -0.03em at 56px, -0.024em at 40px, -0.018em at 28px, -0.012em below. Tighter than that
  and the word gaps close up.
- **Inter** (variable) for everything else. Weight 400 for reading, 500 for labels and controls.
- **Geist Mono** only for code, file contents, diffs and identifiers a user might copy.
- Numbers that change or line up use tabular figures.

| Step | Size / line height | Use |
|---|---|---|
| `hero` | 56 / 1.0 | one number or one sentence that is the point of the screen |
| `title` | 40 / 1.05 | page title |
| `h1` | 28 / 1.15 | section title on a long page |
| `h2` | 20 / 1.3 | card title |
| `body` | 15 / 1.55 | reading text, chat |
| `ui` | 14 / 1.45 | controls, rows, tables |
| `small` | 13 / 1.45 | the smallest text; use rarely |

Nothing below 13px except keyboard hints.

## Shape and space

- Radius: cards 20, dialogs 20, controls and fields 12, chips and segmented controls 999, small
  marks 8.
- A card's edge is `inset 0 0 0 1px line`. No inner highlight, no outer glow.
- Floating layers get one soft shadow: `0 24px 60px -12px rgb(0 0 0 / 0.6)`.
- Spacing is on a 4px grid. Cards pad 24; rows are 48 tall; page gutters are 40, content max
  width 1120 for reading pages.

## Places and their parts

The sidebar leads with Architect's places, an icon and a word each: Lab, Fields, Experiments,
Models, Compute (decision 073). The agents and their chats follow under a hairline. A place's page
has a 40px title and nothing under it; its one primary action, if it has one, sits at the title's
right.

- **Card and CardGrid.** A card is the flat card surface with a title row: the title at 15px Inter
  Tight, an optional 16px icon before it and one optional control after it. Rows inside a card
  (`CardRow`) run edge to edge, split by hairlines, with a 36px icon tile or an avatar at the left
  and a figure, a status word or a chevron at the right. A grid holds one column on a narrow
  window and two or three on a wide one; rows of cards on one page share their columns so their
  edges line up. The cards rise in one after another on first mount.
- **The Lab** has one focal point: Needs you and Running side by side, the same height. What a
  card lacks is said in a few words on a quiet line ("Nothing is running"), never with a
  placeholder illustration.
- **Inspector.** The panel at a screen's right with the settings of what the screen shows (the
  teacher, the student, teaching, evaluation, budget). Its tabs are a segmented strip whose
  selected fill slides between them; a button folds it to a 56px rail of the tabs' icons, and
  opening it there lands on that tab. With more than three tabs, the ones not open show their icon
  alone, with the name in a tooltip, so no name is ever cut. It remembers its tab and whether it
  was folded, per screen.
  Width changes with the `smooth` spring. It never holds a control that would break an invariant.
- **PageTabs.** A place's page in sections: a segmented strip under the title, an icon and a word
  each, whose selected fill slides between them; the open tab's content below. A click opens a
  tab without drawing the keyboard ring; arrow keys move between tabs.
- **ChoiceTiles.** A choice among a few things shown as icon tiles (an icon at the top left, the
  name under it), three to a row in an inspector. One or several may be chosen; the chosen tile
  takes the selected fill and a light edge. Arrow keys move between tiles.
- **ToggleRow.** A switch, its label, and at the far right the kind of value it governs ("Text",
  "USD", "Rounds"). The label flips the switch too.
- **Meter and CapMeter.** A meter fills to its share and springs to a new value; past its cap it
  is full and red. CapMeter adds the label and "used of cap" in tabular figures; Spark's meters are
  amber and the student's blue. An amount with no recorded cap stands alone, with no meter.
- **IntervalPlot.** A dot for each measured value and a line for its 95% interval, rows grouped
  under a name, faint guides at the ticks, figures at the right. A value not measured shows a dash
  and draws nothing. Each row reads out as its label, value and interval.
- **DataTable.** A table of records on the card surface: sortable headers with an arrow on the
  sorted one, a header that stays in place while the body scrolls, rows that open on click or
  Enter. An empty cell is a dash read out as "None", never a zero.

## Motion

The app uses the `motion` library through `@architect/ui` (screens import the wrappers, not
`motion` itself). Numbers use NumberFlow, which never shows a half-rolled or wrong value.

| Name | Setting | Use |
|---|---|---|
| `snappy` | spring, 0.25 s, bounce 0.15 | controls, toggles, segmented indicators, press |
| `smooth` | spring, 0.36 s, bounce 0 | layout changes, pages, cards, disclosures |
| `exit` | 0.16 s ease-in | anything leaving |

- **Press:** controls scale to 0.97 while pressed.
- **Pages and flow steps:** the new page slides in 24px from the side the user is moving toward
  and fades in; the old one fades out and does the reverse. No page ever cuts.
- **Lists and sections:** on first mount, items rise 12px and fade in, 30ms apart, at most 8 in a
  stagger. Later inserts expand into place; removals collapse.
- **Shared elements:** the segmented indicator, the selected tab, the selected row and a card that
  opens into a detail move with `layoutId`, so the eye can follow them.
- **Disclosures** animate their height; they never jump.
- **Dialogs and menus** scale from 0.97 and fade in; on exit they fade out faster than they came.
- **Progress** bars and rings spring to their value.
- **Reduced motion:** with the system setting on, or when `ARCHITECT_HIDDEN=1` runs the app for
  tests and screenshots, every transition completes instantly. Captures never show a frame from the
  middle of an animation.

## Copy

- Plain words, short. A button says what happens ("Start training", "Allow once").
- A title names the thing; it doesn't explain it.
- Status is one word: Ready, Training, Kept, Reverted, Failed.
- A screen has one primary action.

## The film and the site

The launch film and the site's mocks use the same tokens, fonts and motion: one dark ground, white
type, the student's blue and the mentor's amber, no gradients. In the film, every change of scene
grows out of something already on screen; nothing is replaced by a cut or a fade between unrelated
layouts.
