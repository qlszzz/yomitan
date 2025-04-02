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
    const welcome = await context.waitForEvent('page');
    await welcome.close(); // Close the welcome tab so our main tab becomes the foreground tab
});

test('anki new duplicate indicator', async ({context, page, extensionId}) => {
    await context.route(/127.0.0.1:8765\/*/, async (route) => {
        try {
            /** @type {unknown} */
            const requestJson = route.request().postDataJSON();
            if (typeof requestJson !== 'object' || requestJson === null) {
                throw new Error(`Invalid request type: ${typeof requestJson}`);
            }
            
            const action = /** @type {import('core').SerializableObject} */ (requestJson).action;
            
            if (action === 'canAddNotes') {
                const params = /** @type {Record<string, unknown>} */ (requestJson).params;
                const notes = /** @type {unknown[]} */ (params.notes);
                
                const hasAllowDuplicateFalse = notes.some(note => {
                    return note && typeof note === 'object' && 
                           /** @type {Record<string, unknown>} */ (note).options &&
                           typeof /** @type {Record<string, unknown>} */ (note).options === 'object' &&
                           /** @type {Record<string, unknown>} */ (/** @type {Record<string, unknown>} */ (note).options).allowDuplicate === false;
                });
                
                if (hasAllowDuplicateFalse) {
                    const response = Array(notes.length).fill(true);
                    response[0] = false; // First note is a duplicate
                    await route.fulfill({
                        status: 200,
                        contentType: 'text/json',
                        body: JSON.stringify({result: response}),
                    });
                    return;
                }
                
                await route.fulfill({
                    status: 200,
                    contentType: 'text/json',
                    body: JSON.stringify({result: Array(notes.length).fill(true)}),
                });
                return;
            }
            
            if (action === 'findNotes') {
                await route.fulfill({
                    status: 200,
                    contentType: 'text/json',
                    body: JSON.stringify({result: []}),
                });
                return;
            }
            
            await mockAnkiRouteHandler(route);
        } catch {
            await route.abort();
        }
    });

    await page.goto(`chrome-extension://${extensionId}/settings.html`);
    await expect(page.locator('id=dictionaries')).toBeVisible();

    const dictionary = await createDictionaryArchiveData(path.join(root, 'test/data/dictionaries/valid-dictionary1'), 'valid-dictionary1');
    await page.locator('input[id="dictionary-import-file-input"]').setInputFiles({
        name: 'valid-dictionary1.zip',
        mimeType: 'application/x-zip',
        buffer: Buffer.from(dictionary),
    });
    await expect(page.locator('id=dictionaries')).toHaveText('Dictionaries (1 installed, 1 enabled)', {timeout: 1 * 60 * 1000});

    await page.locator('.toggle', {has: page.locator('[data-setting="anki.enable"]')}).click();
    await expect(page.locator('#anki-error-message')).toHaveText('Connected');

    await page.locator('[data-setting="anki.duplicateBehavior"]').selectOption('new');

    await page.locator('[data-modal-action="show,anki-cards"]').click();
    await page.locator('select.anki-card-deck').selectOption('Mock Deck');
    await page.locator('select.anki-card-model').selectOption('Mock Model');
    const mockFields = getMockModelFields();
    for (const [modelField, value] of mockFields) {
        await page.locator(`[data-setting="anki.terms.fields.${modelField}.value"]`).fill(value);
    }
    await page.locator('#anki-cards-modal > div > div.modal-footer > button:nth-child(2)').click();

    await page.goto(`chrome-extension://${extensionId}/search.html`);
    await page.locator('#search-textbox').fill('読む');
    await page.locator('#search-textbox').press('Enter');

    await page.waitForSelector('.entry');

    const addDuplicateButton = page.locator('[data-mode="term-kanji"]');
    await expect(addDuplicateButton).toBeVisible();
    
    await expect(addDuplicateButton).toHaveAttribute('data-new-duplicate', 'true');
    
    const backgroundColor = await addDuplicateButton.evaluate((button) => {
        return window.getComputedStyle(button).backgroundColor;
    });
    
    expect(backgroundColor).not.toBe('rgba(0, 0, 0, 0)');
    expect(backgroundColor).not.toBe('transparent');
    
    await expect.soft(page).toHaveScreenshot('anki-new-duplicate-indicator.png');
});
