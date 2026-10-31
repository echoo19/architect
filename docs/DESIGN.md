# Design

This is how Architect looks and moves: the desktop app, the site's mocks and the launch film. The
values live in `packages/ui/src/styles` and every screen uses them. Where this file and older notes
disagree, this file wins.

It follows the owner's direction of Oct 29 (calm, clean and smooth, after Hestia) and of Nov 1
(clean and premium, with motion as smooth as a Dynamic Island). The hierarchy, spacing, icon,
material and motion rules below apply principles that Hestia's design notes gather from NN/g,
Apple's Human Interface Guidelines, Material 3 and Linear's interface refresh. Architect keeps its
own identity: one dark ground, white text, Inter and Inter Tight, and Spark's amber and Glimmer's
blue as the only accents. The rest of this file spells out what that means in practice.

## Rules

1. **One flat ground.** The app sits on a single near-black. Nothing is painted on it: no
   gradients, glows, radial washes, vignettes, dot grids, grain or patterns. Depth comes from two
   materials (a card's faint top light and rim; a floating surface's frost and shadow), never from
   decoration.
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
5. **Few, clear surfaces.** A card is one container. Rows inside it are split by hairlines, not
   boxed again, and nothing inside it is a card or a tile. Group by space first, by hairline
   second, by surface last.
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
| `rim` / `rim-hover` | `rgb(255 255 255 / 0.07)` / `0.13`, inset 1px | a card's or a float's edge; the rim under the pointer |
| `rim-top` | `rgb(255 255 255 / 0.06)`, inset 1px along the top | the lit top edge |
| `float` | `rgb(24 24 24 / 0.8)` with `blur(20px) saturate(1.2)` | what floats; solid `raised` where blur is missing |

There is one theme. The window, the native title bar and `color-scheme` are always dark.

## Type

- **Inter Tight** (variable) for titles and for numbers that matter. Weight 600. Tracking tightens
  with size: -0.03em at 56px, -0.024em at 40px, -0.018em at 28px, -0.012em below. Tighter than that
  and the word gaps close up.
- **Inter** (variable) for everything else. Weight 400 for reading, 500 for labels and controls.
- **Geist Mono** only for code, file contents, diffs and identifiers a user might copy.
- Numbers that change or line up use tabular figures, and so do the figures in meta (`30 of 36`,
  `$0.23 of $5.00`, `Oct 29`).

## Hierarchy

Text stays white, so size, weight and space carry the hierarchy, and they have to carry it
clearly. Rows of text that all look the same are a defect.

- **At most three type sizes on one surface** (a card, a panel, a dialog, the inspector). A page
  may add its 40px title.
- **Adjacent levels differ in two properties, not one.** A row's title is 14px at 500 and its
  detail 13px at 400. A card's title is Inter Tight 600 in a 56px row; its rows are Inter. A group
  heading inside a card (13px, 500) sits 8px above its rows and 24px below the group before it, so
  space does the second job.
- **Weights 400, 500 and 600 only.** 600 is for titles and big figures, one per group.
- **Nothing under 13px** except keyboard hints.
- **The squint test.** Blur a screenshot: one title, the primary rows and quieter meta should still
  show. If it all turns into one grey, fix the hierarchy before anything else.

| Step | Size / line height | Use |
|---|---|---|
| `hero` | 56 / 1.0 | one number or one sentence that is the point of the screen |
| `title` | 40 / 1.05 | page title |
| `h1` | 28 / 1.15 | section title on a long page |
| `h2` | 20 / 1.3 | a heading on the ground, outside any card; an empty state's title; a dialog's title |
| `body` | 15 / 1.55 | reading text, chat; a card's or a panel's title, in Inter Tight 600 |
| `ui` | 14 / 1.45 | controls, rows, tables |
| `small` | 13 / 1.45 | the smallest text; use rarely |

Nothing below 13px except keyboard hints.

## Shape and space

- Radius: cards 20, dialogs 20, controls and fields 12, chips and segmented controls 999, small
  marks 8.
- Spacing is on a 4px scale (4, 8, 12, 16, 20, 24, 32, 40, 56, 64); only 1-2px optical nudges are
  off it. Cards pad 24; rows are 48 tall; page gutters are 40, content max width 1120 for reading
  pages.
- **Proximity before lines.** The gap inside a group is clearly smaller than the gap between
  groups (4-8 inside, 16-24 between), and a heading sits closer to what it heads than to what is
  above it. A hairline is added only where space can't do the job.
- **Aligned edges.** Text in rows starts on one edge: icons and avatars sit in a fixed 24px
  leading column (`RowIcon`), so text never zig-zags. Figures and status go at the trailing edge.

## Material

Two materials, and nothing else makes depth (`surface-card` and `surface-float` in `theme.css`).

- **A card** (`Card`, `Panel`, `DataTable`, a card built on a flow screen) is the flat card fill, a soft
  `rim`, and a brighter hairline along its top edge (`rim-top`); no gradient, as everywhere. No backdrop blur and no grain on
  cards. The light is fixed; it never moves, animates or brightens.
- **What floats** (menus, popovers, selects, tooltips, toasts, dialogs, the drawer, the palette and
  the inspector) is `float`: slightly see-through with a light blur, the same rims, and the one
  soft shadow, `0 24px 60px -12px rgb(0 0 0 / 0.6)`. Nothing else casts a shadow.
- **Hover brightens a rim only** (`rim-hover`, or the `hover` fill of a row inside a card).
  Nothing grows, moves or changes size under the pointer, so hover never shifts the layout.

## Icons

- **An icon does a job.** It names an action, a kind of thing or a state. If removing it loses
  nothing, it goes. No icon floats alone as decoration.
- **Monochrome, in the row's text colour,** Lucide at one stroke (1.8). An icon takes a colour only
  when it *is* the state: a repaired check in the student's blue, a paused or running mark in
  Spark's amber, a failure in red.
- **No tiles.** An icon sits bare in its leading column (`RowIcon`); no coloured or grey squares
  behind icons in rows. The agent avatar (an initial on the student's soft blue) is an identity,
  not an icon, and keeps its square. The one tile left is the 48px mark of an empty or error state.
- Icon-only buttons are for what is universal or repeats everywhere (close, add, fold, more), and
  they always carry a label and a tooltip.

## One set of parts

Every screen is built from the same few measures, so two screens never disagree about what a row,
a strip or a title is. When a new part needs a size, it takes one from this table.

| Part | Measure |
|---|---|
| Window chrome | the sidebar's top strip is 56 tall, its wordmark on the line of the macOS traffic lights and a chat's title; a page's 48px top strip drags the window; a flow or setup header is 56 tall, the native title bar's height, so the window controls end on its hairline; a page's side panel floats 8px in from the window's edge, under the strip |
| Page title | 40px Inter Tight 600, in a 48px row under the 48px strip that drags the window; 32px to the content |
| Card and panel title | 15px Inter Tight 600 in a 56px row; an optional 16px icon before it, one control after it |
| Row icon | `RowIcon`: a 16px icon centred in a 24px leading column, no tile; an avatar takes the same column |
| Heading on the ground | 20px (`h2`), for a section of a page outside any card ("By organization", "Rounds") |
| Side padding | 24 in cards, panels, tables and dialogs; 16 inside the floating inspector; 40 for a page |
| Rows | 48 for one line, 56 for a title with a detail line; inspector control rows 40; sidebar rows 40, nested 36 |
| Hairlines | `line` between rows and around cards; `line-strong` around controls; a row never gets a box of its own |
| Strips (Segmented, PageTabs, the inspector's tabs) | one shape: a pill on `field` with a hairline, 4px inside, 32px segments, so the strip is 40 tall like a control; the selected segment is `raised` with a strong edge and slides |
| Controls | buttons 44 / 40 / 36 / 32; icon buttons 40 / 36 / 32 / 28; fields 40; all radius 12, chips and strips full |
| Icons | Lucide at stroke 1.8: 16 in rows, controls and titles, 14 in small buttons, 20 in an empty state's tile; marks of 13 or less at 2.2 |
| Hover, selected, chosen | hover `hover` in 150ms; the selected row or tab `selected`; a chosen tile or card `selected` with a light edge |
| Empty and error states | a 48px tile with a 20px icon, a 20px title, at most one line under it, at most two buttons; inside a card, one quiet line instead |
| Toasts | `raised`, radius 20, at the bottom right, one at a time per kind (`key`); an Undo is the toast's one button |
| Scrollbars | 10px, shown only while the pointer is over the region (`scroll-quiet`), in the sidebar, a page, the inspector and tables |

## Places and their parts

The sidebar leads with Architect's places, an icon and a word each: Lab, Fields, Experiments,
Models, Compute (decision 073). The agents and their chats follow under a hairline. A place's page
has a 40px title and nothing under it; its one primary action, if it has one, sits at the title's
right. In the personal edition (decision 076) there are no places: New agent and the agents lead,
and the wordmark reads "Architect" instead of "Architect Lab".

- **Card and CardGrid.** A card is the flat card surface with a title row: the title at 15px Inter
  Tight, an optional 16px icon before it and one optional control after it. A `Panel` is the same
  surface for the flow screens, and its title is set the same way. Rows inside a card
  (`CardRow`) run edge to edge, split by hairlines, with a `RowIcon` or an avatar at the left and
  a figure, a status word or a chevron at the right. A grid holds one column on a narrow
  window and two or three on a wide one; rows of cards on one page share their columns so their
  edges line up. The cards rise in one after another on first mount.
- **The Lab** has one focal point: Needs you and Running side by side at the top of two columns,
  each column a stack of cards at its own height, so a short card never stretches into an empty
  one. Needs you groups what waits by kind (questions, results, approvals, lessons, versions). What
  a card lacks is said in a few words on a quiet line ("Nothing is running"), never with a
  placeholder illustration.
- **One word per concept.** Organizations are "Taught on" or "Never seen" ("sealed" only where a
  line explains what never seen means); the models go by their short names (Spark, Glimmer), never
  "Teacher" and "Student". A new version is shown beside the one in use with both scores, never
  as simply "ready". A change in a score carries its unit ("+25 points"), and a count agrees
  with its number ("1 task").
- **Sidebar.** Rows are `NavItem`s: 40px, a 16px icon, the label, and a status word or spinner at
  the right. The current page's row takes the selected fill, which slides between the places.
- **Inspector.** The panel at a screen's right with the settings of what the screen shows (the
  teacher, the student, teaching, evaluation, budget). It floats: the float material at radius
  20, 8px in from the window's right edge, the strip above and the edge below. Its tabs are the
  same pill strip as every other, lined up with its content 16px in, whose selected fill slides
  between them; a button folds it to a 48px rail of the tabs' icons, and opening it there lands
  on that tab. It is 400px wide, room for up to five tabs by name, so no
  name is cut and none is reduced to an icon. A screen may head it with what it is about (a
  model's name) and may open it on a tab, such as Budget from a line that sends the person there.
  It remembers its tab and whether it was folded, per screen.
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
- **RiskCoveragePlot.** A certificate's curve (decision 077): the share answered across, the error
  up; the bound as a white line, the error measured as small dots, the target as a stronger
  hairline, the certified point in the student's blue, with a three-item key under it.
- **DataTable.** A table of records on the card surface: sortable headers with an arrow on the
  sorted one, a header that stays in place while the body scrolls, rows that open on click or
  Enter. An empty cell is a dash read out as "None", never a zero.

## Motion

The app uses the `motion` library through `@architect/ui` (screens import the wrappers, not
`motion` itself). Numbers use NumberFlow, which never shows a half-rolled or wrong value.

| Name | Setting | Use |
|---|---|---|
| `snappy` | spring, 0.25 s, bounce 0.15 | controls, toggles, segmented indicators, press |
| `smooth` | spring, 0.36 s, bounce 0 | layout changes, flow steps, cards, disclosures, the inspector's width |
| `settle` | spring, 0.28 s, bounce 0 | what changes many times a minute: a place, a tab's content, the sidebar's fill |
| `exit` | 0.16 s ease-in | anything leaving |
| `leave` | 0.10 s ease-in | a page or a tab's content making way for the next |

Nothing bounces past where it lands but a control's own indicator, and that by a hair. Motion is
for what a person does; nothing loops except a spinner while work runs.

What these come to, measured from the springs themselves (a throwaway probe of `motion-dom`'s
spring, since hidden runs complete every transition at once):

| Change | Old page gone | New one within half a pixel | Overshoot |
|---|---|---|---|
| A place (8px rise) | 100 ms | 240 ms after the click | none |
| A flow step (24px slide) | 100 ms | 330 ms after the click | none |
| A tab's content (6px rise) | 100 ms | 230 ms after the click | none |
| The sidebar's fill, 300px away | | 265 ms | none |
| A segmented indicator, 100px away | | 135 ms | 0.6px |

- **Press:** controls scale to 0.97 while pressed. Rows and cards don't scale; they take the hover
  fill.
- **Places:** the old page fades out in 100ms, then the new one rises 8px into place with `settle`:
  from below when the person moved down the sidebar, from above when they moved up. The sidebar
  never moves; its selected fill slides to the new place.
- **Flow steps:** each step (Describe, Define, Train, Results; an import's stages) slides in 24px
  from the side the person is moving toward with `smooth`, while the header stays put; the
  stepper's pill slides from the step left to the step reached. Coming into the flow from a place
  counts as moving forward.
- **Tabs:** the indicator slides between tabs with `snappy`; the content fades out in 100ms and
  the new tab's rises 6px with `settle`. It never travels sideways, so a wide table under the
  tabs never shows a scrollbar for a moment.
- **Lists and sections:** on first mount, items rise 12px and fade in, 30ms apart, at most 8 in a
  stagger (cards in a grid, the Lab's columns, a sidebar agent's chats). Later inserts expand into
  place; removals collapse.
- **Shared elements:** the segmented indicator, the selected tab, the sidebar's selected place,
  the stepper's current pill and the selected row move with `layoutId`, so the eye can follow them.
- **Disclosures** animate their height; they never jump.
- **The inspector** folds to its rail and opens again by springing its width with `smooth`; its
  content is clipped, never squeezed. The open panel stays anchored at its left and fades out in
  100ms while the rail, anchored at the right, fades in with `settle`, so the panel is never empty
  and nothing drifts across it.
- **Dialogs, menus and toasts** scale from 0.97 and fade in; a toast also rises 12px, and the
  others close up the gap with a layout spring. On exit they fade out faster than they came. A
  dialog grows from the control that opened it: its scale is centred on that control's middle, so
  the few pixels it travels lead from there. A menu or popover grows from its trigger's side.
- **Side panels** (Models' model panel) open by springing their width from nothing with
  `smooth`, the page making room as they come, and close the same way with `settle`
  (`SidePresence`). Their content keeps its own width and is clipped, never squeezed.
- **Crisp text at rest.** Everything lands on whole pixels: springs end exactly on their target,
  where the transform is cleared. `will-change` is set only on what is moving, never left on at
  rest. An entrance that blurs ends with `filter: none`. Nothing is clipped or overlaps mid-motion
  except where a panel's edge clips its content on purpose.
- **Numbers** that change while a person watches (a run's check score in the Lab, rounds, tasks,
  scores on the training screen) roll to their new value; meters and progress spring to theirs.
- **Reduced motion:** with the system setting on, or when `ARCHITECT_HIDDEN=1` runs the app for
  tests and screenshots, every transition completes instantly. Captures never show a frame from the
  middle of an animation.

### Checking motion

Hidden windows draw few frames on their own, so motion is checked with a throwaway harness kept
out of the repo. The built app runs hidden, its renderer not told so, and a CDP screencast both
drives and grabs about 100 frames a second while a `requestAnimationFrame` probe records each key
element's box and effective opacity every frame. It looks for long frames (over 24ms), a box that
jumps in one frame, a moment with nothing on screen, and positions that never settle on whole
pixels. The pass on Nov 1 found:

| Transition | Found | Now |
|---|---|---|
| Models' panel opening | appeared at full width in one frame, and the table under it jumped 350px | springs open; on first open one frame of about 65ms remains while the panel's report loads |
| Inspector fold and unfold | the open content vanished in the first frame, leaving an empty panel with the rail drifting across it | the two cross-fade, each anchored to its own edge |
| A place, a tab, the palette, a toast | no frame over 24ms, nothing jumps more than 4px; a page is near-empty for about 30ms between the old fading and the new rising | unchanged |
| The Lab's cards on arrival | they rise and fade together; one frame of about 60ms while the run rows load | unchanged; the load costs the frame, not the motion |

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
