// Book mode: pick it from "more", choose a book from its dropdown, type the page, and check the run
// card names the page and "Next page" moves on to page 2.
export default async ({ page, h, shot, note, check }) => {
  await h.openApp();
  await h.chooseMore('mode-book');
  check(await h.text('#mode-more-label') === 'book', '"more" is renamed to book');
  check(await h.text('#book-page') === 'page 1', 'the page number reads page 1');
  await shot('book-ready');
  await page.getByRole('combobox', { name: 'book', exact: true }).click();
  await shot('book-picker');
  await page.getByRole('listbox', { name: 'book', exact: true }).getByRole('option', { name: 'pride and prejudice' }).click();
  const text = await h.passage();
  check(text.startsWith('It is a truth universally acknowledged'), 'Pride and Prejudice starts at page 1');
  await h.type(text);
  await h.attr('body', 'data-view', 'results');
  await h.settle();
  const conditions = await h.text('#result-conditions');
  note('result', { wpm: await h.text('#result-wpm'), conditions, action: await h.text('#run-again') });
  check(conditions.startsWith('page 1 · pride and prejudice'), `run card names the page and book (${conditions})`);
  check(await h.text('#run-again') === 'Next page', 'the run-again button reads Next page');
  await shot('book-results');
  await page.locator('#run-again').click();
  await h.attr('body', 'data-view', 'practice');
  check(await h.text('#book-page') === 'page 2', 'Next page moves on to page 2');
  await shot('book-page-2');
};
