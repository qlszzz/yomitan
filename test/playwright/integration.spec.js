/*
 * Copyright (C) 2023-2025  Yomitan Authors
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 */

import path from 'path';
import {createDictionaryArchiveData} from '../../dev/dictionary-archive-util.js';
import {deferPromise} from '../../ext/js/core/utilities.js';
import {
    expect,
    getExpectedAddNoteBody,
    getMockModelFields,
    mockAnkiRouteHandler,
    root,
    test,
    writeToClipboardFromPage,
} from './playwright-util.js';

test.beforeEach(async ({context}) => {
    // Wait for the on-install welcome.html tab to load, which becomes the foreground tab
    const welcome = await context.waitForEvent('page');
    await welcome.close(); // Close the welcome tab so our main tab becomes the foreground tab -- otherwise, the screenshot can hang
});

test('search clipboard', async ({page, extensionId}) => {
    await page.goto(`chrome-extension://${extensionId}/search.html`);
    await page.locator('#search-option-clipboard-monitor-container > label').click();
    await page.waitForTimeout(200); // Race

    await writeToClipboardFromPage(page, 'あ');
    await expect(page.locator('#search-textbox')).toHaveValue('あ');
});

test('anki add', async ({context, page, extensionId}) => {
    // Mock anki routes
    /** @type {import('core').DeferredPromiseDetails<Record<string, unknown>>} */
    const addNotePromiseDetails = deferPromise();
    await context.route(/127.0.0.1:8765\/*/, (route) => {
        void mockAnkiRouteHandler(route);
        const req = route.request();
        if (req.url().includes('127.0.0.1:8765')) {
            /** @type {unknown} */
            const requestJson = req.postDataJSON();
            if (
                typeof requestJson === 'object' &&
                requestJson !== null &&
                /** @type {Record<string, unknown>} */ (requestJson).action === 'addNote'
            ) {
                addNotePromiseDetails.resolve(/** @type {Record<string, unknown>} */ (requestJson));
            }
        }
    });

    // Open settings
    await page.goto(`chrome-extension://${extensionId}/settings.html`);

    await expect(page.locator('id=dictionaries')).toBeVisible();

    // Load in test dictionary
    const dictionary = await createDictionaryArchiveData(path.join(root, 'test/data/dictionaries/valid-dictionary1'), 'valid-dictionary1');
    await page.locator('input[id="dictionary-import-file-input"]').setInputFiles({
        name: 'valid-dictionary1.zip',
        mimeType: 'application/x-zip',
        buffer: Buffer.from(dictionary),
    });
    await expect(page.locator('id=dictionaries')).toHaveText('Dictionaries (1 installed, 1 enabled)', {timeout: 1 * 60 * 1000});

    // Connect to anki
    await page.locator('.toggle', {has: page.locator('[data-setting="anki.enable"]')}).click();
    await expect(page.locator('#anki-error-message')).toHaveText('Connected');

    // Prep anki deck
    await page.locator('[data-modal-action="show,anki-cards"]').click();
    await page.locator('select.anki-card-deck').selectOption('Mock Deck');
    await page.locator('select.anki-card-model').selectOption('Mock Model');
    const mockFields = getMockModelFields();
    for (const [modelField, value] of mockFields) {
        await page.locator(`[data-setting="anki.terms.fields.${modelField}.value"]`).fill(value);
    }
    await page.locator('#anki-cards-modal > div > div.modal-footer > button:nth-child(2)').click();
    await writeToClipboardFromPage(page, '読むの例文');

    // Add to anki deck
    await page.goto(`chrome-extension://${extensionId}/search.html`);
    await expect(async () => {
        await page.locator('#search-textbox').clear();
        await page.locator('#search-textbox').fill('読む');
        await expect(page.locator('#search-textbox')).toHaveValue('読む');
    }).toPass({timeout: 5000});
    await page.locator('#search-textbox').press('Enter');
    await page.locator('[data-mode="term-kanji"]').click();
    const addNoteReqBody = await addNotePromiseDetails.promise;
    expect(addNoteReqBody).toMatchObject(getExpectedAddNoteBody());
});

test('anki add duplicate with new card indicator', async ({context, page, extensionId}) => {
    // Mock anki routes
    await context.route(/127.0.0.1:8765\/*/, (route) => {
        const req = route.request();
        if (req.url().includes('127.0.0.1:8765')) {
            /** @type {unknown} */
            const requestJson = req.postDataJSON();
            if (
                typeof requestJson === 'object' &&
                requestJson !== null
            ) {
                const action = /** @type {Record<string, unknown>} */ (requestJson).action;
                if (action === 'findNotes') {
                    return route.fulfill({
                        status: 200,
                        contentType: 'text/json',
                        body: JSON.stringify({result: [1234]})
                    });
                } else if (action === 'notesInfo') {
                    return route.fulfill({
                        status: 200,
                        contentType: 'text/json',
                        body: JSON.stringify({
                            result: [{
                                noteId: 1234,
                                modelName: 'Mock Model',
                                tags: [],
                                fields: {
                                    Expression: {value: '読む', order: 0},
                                    Reading: {value: 'よむ', order: 1},
                                    Meaning: {value: 'to read', order: 2}
                                },
                                cards: [5678]
                            }]
                        })
                    });
                } else if (action === 'findCards') {
                    return route.fulfill({
                        status: 200,
                        contentType: 'text/json',
                        body: JSON.stringify({result: [5678]})
                    });
                } else if (action === 'cardsInfo') {
                    return route.fulfill({
                        status: 200,
                        contentType: 'text/json',
                        body: JSON.stringify({
                            result: [{
                                cardId: 5678,
                                noteId: 1234,
                                deckName: 'Mock Deck',
                                queue: 0, // 0 = new card
                                flags: 0
                            }]
                        })
                    });
                }
            }
        }
        
        void mockAnkiRouteHandler(route);
    });

    // Open settings
    await page.goto(`chrome-extension://${extensionId}/settings.html`);
    await expect(page.locator('id=dictionaries')).toBeVisible();

    // Load in test dictionary
    const dictionary = await createDictionaryArchiveData(path.join(root, 'test/data/dictionaries/valid-dictionary1'), 'valid-dictionary1');
    await page.locator('input[id="dictionary-import-file-input"]').setInputFiles({
        name: 'valid-dictionary1.zip',
        mimeType: 'application/x-zip',
        buffer: Buffer.from(dictionary),
    });
    await expect(page.locator('id=dictionaries')).toHaveText('Dictionaries (1 installed, 1 enabled)', {timeout: 1 * 60 * 1000});

    // Connect to anki
    await page.locator('.toggle', {has: page.locator('[data-setting="anki.enable"]')}).click();
    await expect(page.locator('#anki-error-message')).toHaveText('Connected');

    await page.locator('[data-setting="anki.duplicateBehavior"]').selectOption('allow');

    await page.goto(`chrome-extension://${extensionId}/search.html`);
    await expect(async () => {
        await page.locator('#search-textbox').clear();
        await page.locator('#search-textbox').fill('読む');
        await expect(page.locator('#search-textbox')).toHaveValue('読む');
    }).toPass({timeout: 5000});
    await page.locator('#search-textbox').press('Enter');
    
    await expect(page.locator('[data-mode="term-kanji"]')).toHaveClass(/duplicate-card-new/);
});
