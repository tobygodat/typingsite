import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { SettingsDialog } from '../src/settings-dialog.js';
import { ReleaseDialog } from '../src/release-dialog.js';

export const settingsMarkup = () => renderToStaticMarkup(createElement(SettingsDialog));
export const releaseMarkup = () => renderToStaticMarkup(createElement(ReleaseDialog));
