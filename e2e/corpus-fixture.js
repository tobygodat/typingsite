import { fileURLToPath } from 'node:url';
import { build } from 'vite';
import { appEntry } from './built-assets.js';

const fixtures = {
  'accent-quote': "for (const quote of quoteCorpus) if (quote.id.startsWith('short-precise-')) quote.text = \"It's here. \" + quote.text;",
  'race-marks': "quoteCorpus.splice(0, quoteCorpus.length, ...quoteCorpus.filter((quote) => quote.text.includes('\"')));",
  'empty-gentle': "quoteCorpus.splice(0, quoteCorpus.length, ...quoteCorpus.filter((quote) => !quote.id.startsWith('short-gentle-')));",
};

const compiled = new Map();

async function compileCorpus(name) {
  const entry = '\0stilltype-corpus-fixture';
  const typing = fileURLToPath(new URL('../src/typing.ts', import.meta.url));
  const main = fileURLToPath(new URL('../src/main.tsx', import.meta.url));

  const result = await build({
    configFile: false,
    publicDir: false,
    logLevel: 'error',
    plugins: [{
      name: 'stilltype-corpus-fixture',
      resolveId(id) { if (id === 'stilltype-corpus-fixture') return entry; },
      load(id) {
        if (id === entry) return `import { quoteCorpus } from ${JSON.stringify(typing)};\n${fixtures[name]}\nawait import(${JSON.stringify(main)});`;
      },
    }],
    build: {
      target: 'es2022',
      write: false,
      rolldownOptions: { input: 'stilltype-corpus-fixture', output: { codeSplitting: false } },
    },
  });

  const script = result.output.find((file) => file.type === 'chunk' && file.isEntry);

  if (!script) throw new Error(`Corpus fixture ${name} emitted no entry`);

  return script.code;
}

export async function useCorpusFixture(page, name) {
  if (!fixtures[name]) throw new Error(`Unknown corpus fixture ${name}`);

  if (!compiled.has(name)) compiled.set(name, compileCorpus(name));
  const body = await compiled.get(name);
  await page.route(`**${appEntry}`, (route) => route.fulfill({ status: 200, contentType: 'text/javascript', body }));
}
