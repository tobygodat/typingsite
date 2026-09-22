# Research summary

Imported 21 September 2026. This summary condenses the [full brief and its 16 sources](typing-platform-brief.md); it does not constitute a new live audit of the linked sites. The [original Word brief](typing-platform-brief.docx) is preserved byte for byte.

## Product direction

Help people who already touch type improve through enjoyable practice and competition. A shared skill profile connects Play, Train, and Compete so a race or solo run produces a useful next exercise and a meaningful progress comparison.

The user's goals are practical usefulness, strong career/resume signal, meaningful ML, and room for sustained iteration. “KBR” and “Typedig/Type G G” were interpreted during research as keybr and TypeGG. The osu!-like direction means difficulty, mastery, replayability, and score progression; it does not imply a music requirement.

## Evidence and implications

| Evidence type | What the brief reports | Product implication |
| --- | --- | --- |
| Sampled user opinions | Clean typing, targeted learning, and competition recur across discussions. Users describe switching between sites. [Site comparison](https://www.reddit.com/r/typing/comments/1wlopt2/what_are_your_thoughts_on_the_big_3_typing_sites/), [practice discussion](https://www.reddit.com/r/typing/comments/1szrqus/best_website_to_pracitice_speed_and_accuracy/) | Test whether one connected experience reduces switching. |
| Specific workflow request | A discussion asks for easier racing and post-race drills. [Race-to-practice discussion](https://www.reddit.com/r/typing/comments/1gci25j/) | Make the next drill easy to start from results. |
| Existing feature overlap, checked in the original research | Monkeytype already offers missed/slow-word practice; TypeGG already offers modern competitive progression. [Monkeytype](https://monkeytype.com/about), [TypeGG](https://typegg.io/), [TypeGG wiki](https://wiki.typegg.io/Main_Page) | Integration and demonstrable learning must justify the product. |
| Mixed reports | keybr targeting/unlocks can confuse people; reported learning gains conflict. [Targeting discussion](https://www.reddit.com/r/typing/comments/1s388o2/keybr_training_every_key_except_my_weakest/), [mixed improvement reports](https://www.reddit.com/r/typing/comments/1fisntp/keybr_is_actually_highly_underrated_5_wpm_within/) | Explain recommendations, allow manual targets, avoid blocking unlocks. |
| Measurement concern | WPM across different content and rules can mislead; typing tests do not establish writing performance. [WPM comparisons](https://www.reddit.com/r/typing/comments/1oth67l/), [typing versus composing](https://www.reddit.com/r/typing/comments/1ohbvkb/how_to_convert_your_typing_test_speed_into_real/) | Label scores and evaluate transfer using unfamiliar passages. |

## Differentiation hypothesis

**A short, explained race-to-drill-to-fresh-text loop will make targeted practice easier to use and more effective than disconnected sessions.** This is a hypothesis, not a confirmed novel invention or learning outcome.

Test usability first: can someone understand their top two weaknesses and complete the next drill without guidance? Then compare learning against equal-time generic practice and the transparent weak-pair baseline. If users do not take the next step, improve the workflow before adding modes. If a model predicts errors better but does not improve learning, retain the simpler recommender. See the [evaluation plan](../ml-data-evaluation.md).

## Limits of the evidence

The Reddit sample is qualitative and not representative of all typists. Improvement anecdotes are not causal evidence. TypeGG has thinner independent coverage, and some discussion may be promotional. Older complaints may have been fixed. Source dates and descriptions come from the original brief. Preserve the distinction between opinions, feature observations, and proposed product choices when making future claims.

No public outreach or posting is authorized by this handoff. Any future user study is a proposed stage, not an instruction to contact people now.

## Original idea and subsequent refinement

The typing-specific entry from the supplied broad idea list is retained here; unrelated ideas are omitted:

> Typing trainer web extension: a Monkeytype + Nitrotype hybrid. Monitors keystrokes and backspaces to determine typing errors, then parses that through an ML model for keybr-style adaptive training. Rank system, peer-to-peer competition, and a customizable minimal UI in the style of Monkeytype. Possible Zetamac integration.

The research direction narrows this to an in-app typing product: collect events only inside its typing surface, focus first on an understandable practice loop, and introduce competition in stages. Browser-wide capture, extension packaging, and Zetamac integration are deferred ideas. Timing can reveal hesitation; it cannot reliably identify actual finger use.

## Archive provenance

The imported artifact was named `typing-platform-brief.docx`; its supplied builder was `build_typing_brief.py`. The Markdown extraction retains the brief's text, table, reference numbers, source descriptions, and all 16 URLs. Neither external source-file paths nor the builder are needed to read or continue this project.

Original DOCX SHA-256: `db716b1fd479a22e381f209afa2ae63943a449a52fb0665921403b28a3fccf99`.
