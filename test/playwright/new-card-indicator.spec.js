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

import {
    expect,
    mockAnkiRouteHandler,
    test,
} from './playwright-util.js';

test.beforeEach(async ({context}) => {
    const welcome = await context.waitForEvent('page');
    await welcome.close(); // Close the welcome tab so our main tab becomes the foreground tab -- otherwise, the screenshot can hang
});

test('shows visual indicator for cards in new queue', async ({ page, context, extensionId }) => {
    await context.route('http://127.0.0.1:8765', async (route) => {
        const postData = JSON.parse((await route.request().postData()));
        
        if (postData.action === 'findNotes') {
            await route.fulfill({ body: JSON.stringify({ result: [1000] }) });
        } else if (postData.action === 'notesInfo') {
            await route.fulfill({ 
                body: JSON.stringify({ 
                    result: [{
                        noteId: 1000,
                        modelName: 'testModel',
                        tags: [],
                        fields: { word: { value: 'test', order: 0 } },
                        cards: [2000],
                        cardsInfo: [{ noteId: 1000, cardId: 2000, flags: 0 }]
                    }] 
                }) 
            });
        } else if (postData.action === 'cardsInfo') {
            await route.fulfill({ 
                body: JSON.stringify({ 
                    result: [{ noteId: 1000, cardId: 2000, flags: 0 }] 
                }) 
            });
        } else {
            await route.fulfill({ body: JSON.stringify({ result: null }) });
        }
    });

    await page.goto(`chrome-extension://${extensionId}/search.html`);
    await page.locator('#anki-connectButton').click();
    
    await page.locator('#query-parser-content').fill('test');
    await page.keyboard.press('Enter');
    
    await page.waitForSelector('.action-button[data-action^="add-duplicate"]');
    
    const hasNewCardClass = await page.locator('.action-button[data-action^="add-duplicate"]').evaluate(
        button => button.classList.contains('action-button-new-card')
    );
    expect(hasNewCardClass).toBeTruthy();
});
