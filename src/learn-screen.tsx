export function LearnScreen() {
  return (
<section id="learn-screen" className="screen" data-screen="learn" aria-labelledby="learn-heading" hidden>
        <header className="section-heading page-heading">
          <h1 id="learn-heading">Learn to type</h1>
        </header>

        <div className="learn-layout">
          <section id="lesson-current" className="lesson-current" aria-labelledby="lesson-current-heading">
            <p id="lesson-status" className="status" hidden><span className="status-dot" aria-hidden="true"></span><span id="lesson-status-word"></span></p>
            <h2 id="lesson-current-heading">Lesson 1</h2>
            <p id="lesson-current-copy"></p>
            <dl id="lesson-facts" className="lesson-facts" hidden></dl>
            <p id="lesson-current-meta" className="condition-copy"></p>
            <div className="lesson-actions">
              <button id="lesson-primary" className="btn btn-primary" type="button">Start lesson 1</button>
              <button id="lesson-secondary" className="btn btn-ghost" type="button" hidden></button>
            </div>
          </section>

          <figure className="finger-figure">
            <div id="lesson-keyboard" className="keyboard"></div>
            <figcaption className="finger-caption">
              <span id="finger-caption-keys"></span>
            </figcaption>
          </figure>
        </div>

        <section className="lesson-list-section" aria-labelledby="lesson-list-heading">
          <h2 id="lesson-list-heading">Lessons</h2>
          <p id="lesson-save-note" className="result-note"></p>
          <ol id="lesson-list" className="lesson-list"></ol>
        </section>
      </section>
  );
}
