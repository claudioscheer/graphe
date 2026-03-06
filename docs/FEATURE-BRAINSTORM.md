# Graphe Feature Brainstorm: Cross-Module Intelligence & Power Features

## Context

Graphe has 4 rich data types (Bible verses with Strong's/morphology/lemma tags, Dictionaries with cognates, Commentaries with embedded references, Cross-references with vote scores) but they're mostly used in isolation. The goal is to create features that **connect these data types in surprising, powerful ways** — like MyBible's "double-click a word → search all dictionaries" pattern, but taken much further.

---

## Feature Ideas

### 1. Universal Word Tap — Multi-Dictionary + Multi-Source Lookup

**What:** Double-click/tap any word in a verse → search ALL installed dictionaries (not just the configured Strong's dict) for that word AND its Strong's number. Show a unified panel with tabs per dictionary, plus inline morphology, cognates, and every verse where that exact Strong's number appears.
**Why:** Users shouldn't have to manually switch dictionaries. One tap = everything you could ever want to know about a word.
**Data:** Bible verses (Strong's tags) → ALL dictionary modules → cognate groups → morphology tables → verse search by Strong's number.
**Complexity:** Medium

### 2. Verse X-Ray — Structural Breakdown Panel

**What:** Select any verse → show a "X-Ray" view that explodes it into: each word mapped to its Strong's number, morphology decoded in plain language, lemma (root form), every cross-reference for that verse ranked by votes, commentary snippets from ALL installed commentaries, and cognate word family for each key word.
**Why:** One-click deep dive into any verse. No hunting through panels. Everything about a verse in one place.
**Data:** Verse text parsing → Strong's → ALL dictionaries → morphology resolver → ALL cross-ref modules → ALL commentary modules.
**Complexity:** Large

### 3. Translation Comparison Matrix

**What:** Select a verse → open a matrix showing that verse across ALL installed Bible modules side-by-side. Highlight words that differ between translations. If both have Strong's, show where the same Strong's number got translated differently.
**Why:** Comparing translations is the #1 reason people install multiple Bible modules. Make it effortless.
**Data:** Same verse coordinates across all Bible modules. Strong's tag comparison between modules.
**Complexity:** Medium

### 4. Strong's Heatmap — Word Frequency Visualization

**What:** Pick any Strong's number (or click one in a verse) → see a visual heatmap of the entire Bible showing where that word appears. Each book is a row, chapters are columns, cell color = frequency. Click any cell to jump there.
**Why:** Instantly see the "shape" of a word's usage across Scripture. Is "agape" concentrated in John's writings? Does "covenant" peak in certain OT books?
**Data:** Search all verses for Strong's number, aggregate by book/chapter. Uses existing `searchVerses` but with aggregation.
**Complexity:** Medium

### 5. Cognate Web Explorer — Interactive Word Family Graph

**What:** Click a Strong's number → see a visual graph/tree of its entire cognate family. Each node is a related Strong's number with its short definition. Click any node to see its verses. Edges show the family relationships.
**Why:** Understanding word families unlocks deeper meaning. "Grace" (charis), "gift" (charisma), "thankfulness" (eucharistia) are all one family.
**Data:** `cognate_strong_numbers` table (group_id links families) → dictionary entries for each → verse search for each.
**Complexity:** Medium-Large

### 6. Cross-Reference Chain Explorer

**What:** Start from any verse → see its cross-references → click one → see ITS cross-references → keep going. Show the chain as a breadcrumb trail or a branching tree. Discover how verses connect across the Bible through chains of references.
**Why:** Cross-references are a web, not a list. Following chains reveals thematic threads that span the entire Bible.
**Data:** `cross_references` table, recursive lookups. Vote scores to rank/filter.
**Complexity:** Medium

### 7. Reverse Strong's Lookup — "Which Greek/Hebrew words become THIS English word?"

**What:** Type an English word (e.g., "love") → find ALL Strong's numbers whose verses contain that word in translation. Show each Strong's number with its definition, frequency, and sample verses. Reveals that "love" maps to agape, phileo, eros, storge, etc.
**Why:** This is the reverse of the normal flow (Strong's → English). Incredibly useful for word studies.
**Data:** Full-text search across Bible modules → extract Strong's numbers from matching verses → dictionary lookup for each.
**Complexity:** Medium

### 8. Morphology Pattern Search — "Find all imperatives in Romans"

**What:** Search by grammatical form: "show me all verbs in the imperative mood in Romans" or "all aorist tenses in Hebrews." Filter by book, testament, or whole Bible.
**Why:** Grammatical patterns reveal authorial intent. Paul's imperatives in Romans 12 vs his indicatives in Romans 1-11 tell a story.
**Data:** Parse morphology codes from `<m>` tags in verses. Filter by decoded morphology segments. Uses existing morphology resolver.
**Complexity:** Medium-Large

### 9. Commentary Consensus — Multi-Commentary Side-by-Side

**What:** When viewing a verse, show commentary entries from ALL installed commentary modules stacked or tabbed. Quick-switch between commentators without changing panes.
**Why:** Scholars compare commentators. Currently you need one pane per commentary. This puts them all in one view.
**Data:** `getCommentary` across all commentary modules for same book/chapter/verse.
**Complexity:** Small-Medium

### 10. "Verses Like This" — Similarity Finder

**What:** Select a verse → find other verses that share the most Strong's numbers with it. Rank by overlap count. "John 3:16 shares 5 Strong's numbers with Romans 5:8, 4 with 1 John 4:9..."
**Why:** Discovers thematic parallels that aren't in cross-reference databases. Finds connections nobody manually catalogued.
**Data:** Parse Strong's from selected verse → search all verses for each Strong's number → compute intersection scores → rank.
**Complexity:** Large (but could be pre-computed per chapter)

### 11. Smart Bookmarks & Study Notes with Verse Links

**What:** Add personal notes/bookmarks to any verse. Notes can reference other verses (auto-detected and linked). Show a "my notes" panel. Export/import notes.
**Why:** Every serious Bible student takes notes. Currently no annotation system exists.
**Data:** New local SQLite table for user data. Reference parser (already exists in commentary-view) for linking.
**Complexity:** Medium

### 12. Word Frequency Dashboard — Per Book/Chapter Statistics

**What:** Open a dashboard for any book → see: most frequent Strong's numbers, unique words (hapax legomena), vocabulary richness, key theological terms. Compare two books side-by-side.
**Why:** Reveals authorial style and emphasis. "John uses agape 37 times, Luke only 11." Useful for introduction-to-a-book study.
**Data:** Aggregate Strong's numbers across all verses in a book. Count, rank, compare.
**Complexity:** Medium

### 13. Parallel Passage Detector

**What:** Automatically detect and link parallel passages (e.g., Synoptic Gospels, Chronicles/Kings). Show them side-by-side with differences highlighted.
**Why:** Comparing parallel accounts is fundamental to Bible study. Currently manual.
**Data:** Could use cross-references with high vote counts as a starting point. Or compute via Strong's number overlap between verse ranges.
**Complexity:** Large

### 14. Reading History & "Continue Where You Left Off"

**What:** Track which chapters the user has read. Show a progress dashboard. "You've read 45% of the NT." Resume reading from last position. Suggest next chapter.
**Why:** Motivation and tracking for systematic reading.
**Data:** New state tracking in AppStateStore. Minimal new data.
**Complexity:** Small

### 15. Quick Cross-Reference Preview on Hover

**What:** Hover over any verse number → show a tooltip with its top 3-5 cross-references (text preview included). No click needed.
**Why:** Cross-references are currently hidden behind clicks. Making them visible on hover makes the Bible feel "hyperlinked."
**Data:** `getCrossReferences` for hovered verse. Fetch verse text for top results.
**Complexity:** Small

### 16. Strong's Number Journey — Timeline View

**What:** Pick a Strong's number → see a horizontal timeline of every occurrence from Genesis to Revelation, with verse snippets. Scroll through its "story" across the Bible.
**Why:** Words evolve in usage across Scripture. Seeing the timeline reveals patterns.
**Data:** Search verses by Strong's → sort by book order → render timeline.
**Complexity:** Medium

### 17. Multi-Strong's Intersection Search — "Where do these concepts meet?"

**What:** Enter 2-3 Strong's numbers → find verses containing ALL of them. "Where do 'faith' (G4102) and 'works' (G2041) appear together?"
**Why:** Finding thematic intersections is incredibly powerful for topical study. Current search supports this but the UX doesn't encourage it.
**Data:** Existing `searchVerses` with multiple `strong:` terms. Better UX around composing these queries.
**Complexity:** Small

### 18. Contextual Dictionary — Show Meaning IN THIS Context

**What:** When looking up a Strong's number, highlight which specific sense/definition applies in the current verse context (based on morphology, surrounding words, or commentary hints).
**Why:** Many Strong's numbers have multiple meanings. "Logos" can mean word, reason, account, etc. Context determines meaning.
**Data:** Morphology code → narrow definition. Cross-reference with commentary text for current verse.
**Complexity:** Large

### 19. Export Study Session — PDF/Markdown Report

**What:** After a study session, export: selected verses with annotations, dictionary lookups performed, cross-references explored, commentary notes — all as a formatted PDF or Markdown document.
**Why:** Students and pastors need to capture their research for sermons, lessons, papers.
**Data:** Track session activity (lookups, navigations, selections). Format existing data into export.
**Complexity:** Medium

### 20. Inline Cross-References — Show References IN the Verse Text

**What:** Toggle that shows cross-reference markers inline next to each verse (like footnote markers). Hover to preview, click to navigate.
**Why:** Makes the cross-reference network visible while reading, not hidden in a separate panel.
**Data:** Cross-references for current chapter, matched to verse numbers.
**Complexity:** Small-Medium

### 21. "Surprise Me" — Random Deep Dive

**What:** Button that picks a random verse, shows it with full X-Ray view (Strong's, morphology, cross-refs, commentary), and presents an interesting fact: "This verse contains a word used only here in the entire Bible" or "This verse is cross-referenced by 15 other verses."
**Why:** Serendipitous discovery. Makes opening the app fun even without a study plan.
**Data:** Random verse selection + all cross-module analysis. `getDictionaryRandomTopics` pattern already exists.
**Complexity:** Medium

### 22. Keyboard-Driven Study Mode — Vim-like Navigation

**What:** Power-user mode: `j/k` to move between verses, `d` to look up dictionary, `x` to show cross-refs, `c` to show commentary, `/` to search, `g` to go-to reference. All without touching the mouse.
**Why:** Power users (scholars, pastors) who live in the app want speed. Keyboard-driven = fastest possible study.
**Data:** All existing features, just new key bindings and focus management.
**Complexity:** Medium

### 23. Scripture Memory / Flashcard Mode

**What:** Select verses to memorize. Flashcard view progressively hides words. Track progress with spaced repetition. Quiz mode: show reference, recall text (or vice versa).
**Why:** Memorization is a core spiritual discipline. No good desktop app does this integrated with a study tool.
**Data:** Verse text from any module. New local state for memorization progress.
**Complexity:** Medium

---

## Prioritization Suggestion

**Quick wins (Small, high impact):**

- #1 Universal Word Tap (multi-dictionary lookup)
- #15 Quick Cross-Reference Preview on Hover
- #17 Multi-Strong's Intersection Search
- #14 Reading History
- #20 Inline Cross-References

**High-value medium effort:**

- #3 Translation Comparison Matrix
- #4 Strong's Heatmap
- #7 Reverse Strong's Lookup
- #9 Commentary Consensus
- #6 Cross-Reference Chain Explorer

**Ambitious game-changers:**

- #2 Verse X-Ray
- #5 Cognate Web Explorer
- #10 "Verses Like This" Similarity Finder
- #8 Morphology Pattern Search

---

## Verification

These features all build on existing data and IPC methods. No new external dependencies required for most. The main implementation work is:

1. New renderer UI components
2. New IPC channels for aggregation queries
3. New SQLite queries (mostly compositions of existing patterns)
4. State management for new panels/views
