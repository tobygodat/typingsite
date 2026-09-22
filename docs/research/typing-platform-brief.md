# Typing platform research and product brief

Imported on 21 September 2026 from the [original three-page brief](typing-platform-brief.docx). The text and all 16 source URLs are retained; page breaks and Word styling are omitted. This is an archived research synthesis, not a new verification of the linked sites.

Monkeytype · keybr · TypeGG · TypeRacer    |    21 September 2026

Recommendation  Build a clean typing site where every race can lead to useful practice, and practice feeds back into visible progress. Combine the experience users already enjoy with a clearer answer to “what should I work on next?”

## What people value and what frustrates them

| Site | Keep | Pain points reported |
| --- | --- | --- |
| Monkeytype | Clean interface, customization, instant solo practice and progress statistics. [1][1] [2][2] [6][6] | Useful modes can be hard to discover. Short, easy tests can be mistaken for general typing ability. [7][7] [11][11] |
| keybr | Focused weak-key practice, gradual progression and detailed feedback. Some experienced users also find it useful. [2][2] [3][3] | Getting stuck on unlocks; unclear targeting; artificial-feeling exercises. Reports of improvement are mixed. [2][2] [3][3] [10][10] |
| TypeRacer | Human competition, quotes and the requirement to correct mistakes. [1][1] [4][4] | Dated appearance, downtime between short races and cumbersome post-race practice. [1][1] [4][4] [6][6] |
| TypeGG | Quote selection, difficulty-based progression, performance points and competitive play. [1][1] [5][5] [15][15] | Some users find the competition and longer texts intimidating. Independent feedback is thinner than for the older sites. [1][1] [12][12] |

## The strongest product opportunity

Users already combine sites for different jobs. One discussion explicitly asks for a single click from a race into practice of missed words. Other users report switching between keybr and Monkeytype, or treating Monkeytype and TypeGG as complementary. [4][4] [5][5] [6][6]

The opportunity is a shared skill profile across racing, drills and progress tracking. Missed-word practice alone is already available in Monkeytype, and TypeGG already combines modern competitive modes with progression. The connected learning experience needs to earn the differentiation. [13][13] [14][14] [15][15]

Evidence strength: clean design, targeted practice and competition recur across discussions. Exact scoring preferences and TypeGG complaints are less established. The recent “Big 3” post is one enthusiastic opinion; some replies question whether it is promotional. [1][1]

## The recommended experience

Start with people who can already touch type and want to improve while enjoying competition. A complete beginner course can come later.

A five-minute session might look like this: race a quote → see your two biggest slowdowns → practice them for one minute → try a fresh quote containing similar patterns → see whether accuracy or timing improved. This is a proposed workflow, not a proven learning outcome.

Play  A quiet, Monkeytype-inspired typing surface. Quotes and word tests, font and theme controls, keyboard shortcuts, instant restart, and an optional minimal race-progress display.

Train  A visible “practice my mistakes” action after each run. Use both errors and hesitation on letter pairs or words. Explain the recommendation, allow manual targeting, and offer real sentences as well as focused drills.

Compete  Private friend races first, then public matching when enough people are active. Offer personal-best ghosts and daily challenges immediately. Label recorded opponents clearly so they cannot be mistaken for live players.

## Design decisions that resolve the tensions

Keep progression understandable. Show why a drill was selected, recent evidence of improvement and a way to move on. Avoid a single opaque letter unlock that blocks the whole experience. [3][3] [10][10]

Separate the scores. Keep quote performance points, live race rating and personal learning progress distinct. Always display test length, content and correction rules with WPM. A harder drill should not look like lost competitive skill. [7][7] [8][8]

Support different goals. Offer named presets for speed bursts, accurate prose and targeted practice. Use mandatory correction in ranked quote races; keep relaxed practice available. Users disagree about how strict all practice should be. [2][2] [4][4] [8][8]

Make the text worth typing. Provide varied, curated quotes with clear length and difficulty filters. Keep long-text practice available. Difficulty should be explained through length, vocabulary, punctuation and typing patterns. [4][4] [5][5]

Protect the typing flow. No layout shifts, moving distractions or countdown in solo practice. Show the actual mistyped characters, with cues beyond color alone. Keep detailed analytics off the active typing screen. [6][6] [9][9]

## Build in this order

First: excellent typing feel, curated texts, accurate event capture, instant targeted drills and one shared progress view. Next: daily quote challenges, saved ghosts, clear difficulty ratings and friend rooms. Later: public matchmaking, seasonal ranks, additional languages and advanced personalization.

Treat the osu!-like elements as difficulty, mastery, replayability and score progression. A rhythm mechanic or music synchronization is a separate idea; the reviewed comments do not establish demand for it.

## The ML component worth building

Learn which short exercise will help a particular typist next. Start with a transparent baseline that selects their slowest or most error-prone letter pairs. Then train a model to predict errors and timing from the text plus that user’s recent history, and use it to recommend appropriate practice.

Collect timing, errors and corrections within your own practice and race modes. A timing model can find hesitation; it cannot reliably infer which finger someone used. Keep a stable ranked difficulty system separate from personalized training recommendations.

Validate prediction on future sessions and held-out users. Validate learning with equal-duration practice groups and fresh passages at the start, end and a later retest. Measure accuracy, corrected WPM and return usage. Better scores on repeatedly practiced quotes do not establish transfer to unfamiliar text or everyday writing. [16][16]

The résumé-worthy result would be evidence that your exercise selection improves learning or retention over a simple weak-pair baseline, alongside a fast, reliable multiplayer product. Do not require an LLM to generate every exercise.

## What the research supports

There is credible demand for a clean competitive typing experience with easier targeted practice. There is weaker evidence that users want to abandon all existing sites. Test the connected race-to-drill workflow before building an entire replacement ecosystem.

## Sources and scope

Qualitative synthesis of accessible r/typing discussions and comments, with official pages used to check overlapping features. This is not a census or a representative survey. Self-reported gains are anecdotes; creator promotions are not independent validation. Older complaints may have been addressed. Source links below support the numbered references.

[1. Big 3 site comparison](https://www.reddit.com/r/typing/comments/1wlopt2/what_are_your_thoughts_on_the_big_3_typing_sites/)  —  20–21 Sep 2026

[2. Monkeytype or keybr discussion](https://www.reddit.com/r/typing/comments/159emep/monkeytype_or_keybr_overall_which_site_improves/)  —  Jul 2023; later replies

[3. Keybr benefits and conflicting results](https://www.reddit.com/r/typing/comments/1fisntp/keybr_is_actually_highly_underrated_5_wpm_within/)  —  Sep 2024; later replies

[4. Request for better racing and post-race drills](https://www.reddit.com/r/typing/comments/1gci25j/)  —  Oct 2024

[5. TypeGG and Monkeytype as complements](https://www.reddit.com/r/typing/comments/1sk9066/typegg_vs_monkeytype/)  —  Apr 2026

[6. Practice recommendations and race downtime](https://www.reddit.com/r/typing/comments/1szrqus/best_website_to_pracitice_speed_and_accuracy/)  —  Apr 2026

[7. Misleading comparisons between WPM scores](https://www.reddit.com/r/typing/comments/1oth67l/)  —  Nov 2025

[8. Competition treated as a game in its own right](https://www.reddit.com/r/typing/comments/1hp8n5c/259_wpm_60_seconds_on_monkeytype_e200_5_all_time/)  —  Dec 2024

[9. Feedback on waits and visible typing errors](https://www.reddit.com/r/typing/comments/1d6ttps/)  —  Jun 2024

[10. Keybr weak-key selection confusion](https://www.reddit.com/r/typing/comments/1s388o2/keybr_training_every_key_except_my_weakest/)  —  Mar 2026

[11. Discovering Monkeytype quote mode](https://www.reddit.com/r/typing/comments/1b6bne7/)  —  Mar 2024

[12. TypeGG difficulty discussion](https://www.reddit.com/r/typing/comments/1w5tu30/bad_typist_help/)  —  Sep 2026

[13. Monkeytype existing missed and slow word practice](https://monkeytype.com/about)  —  Official site

[14. TypeGG modes and recent updates](https://typegg.io/)  —  Official site

[15. TypeGG metrics and ranked play](https://wiki.typegg.io/Main_Page)  —  Official wiki

[16. Typing practice versus composing text](https://www.reddit.com/r/typing/comments/1ohbvkb/how_to_convert_your_typing_test_speed_into_real/)  —  Oct 2025

[1]: https://www.reddit.com/r/typing/comments/1wlopt2/what_are_your_thoughts_on_the_big_3_typing_sites/
[2]: https://www.reddit.com/r/typing/comments/159emep/monkeytype_or_keybr_overall_which_site_improves/
[3]: https://www.reddit.com/r/typing/comments/1fisntp/keybr_is_actually_highly_underrated_5_wpm_within/
[4]: https://www.reddit.com/r/typing/comments/1gci25j/
[5]: https://www.reddit.com/r/typing/comments/1sk9066/typegg_vs_monkeytype/
[6]: https://www.reddit.com/r/typing/comments/1szrqus/best_website_to_pracitice_speed_and_accuracy/
[7]: https://www.reddit.com/r/typing/comments/1oth67l/
[8]: https://www.reddit.com/r/typing/comments/1hp8n5c/259_wpm_60_seconds_on_monkeytype_e200_5_all_time/
[9]: https://www.reddit.com/r/typing/comments/1d6ttps/
[10]: https://www.reddit.com/r/typing/comments/1s388o2/keybr_training_every_key_except_my_weakest/
[11]: https://www.reddit.com/r/typing/comments/1b6bne7/
[12]: https://www.reddit.com/r/typing/comments/1w5tu30/bad_typist_help/
[13]: https://monkeytype.com/about
[14]: https://typegg.io/
[15]: https://wiki.typegg.io/Main_Page
[16]: https://www.reddit.com/r/typing/comments/1ohbvkb/how_to_convert_your_typing_test_speed_into_real/
