/**
 * Unit tests for RecentWorksManager
 */

const { RecentWorksManager } = require('../../../public/api/RecentWorksManager.js');

describe('RecentWorksManager', () => {
    let manager;
    let mockLocalStorage;

    beforeEach(() => {
        // Mock localStorage
        mockLocalStorage = {};
        global.localStorage = {
            getItem: jest.fn((key) => mockLocalStorage[key] || null),
            setItem: jest.fn((key, value) => {
                mockLocalStorage[key] = value;
            }),
            removeItem: jest.fn((key) => {
                delete mockLocalStorage[key];
            }),
            clear: jest.fn(() => {
                mockLocalStorage = {};
            })
        };

        // Mock console methods
        jest.spyOn(console, 'error').mockImplementation(() => {});

        manager = new RecentWorksManager();
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    describe('constructor', () => {
        test('initializes with default storage key', () => {
            expect(manager.storageKey).toBe('recentWorks');
        });

        test('initializes with max count of 5', () => {
            expect(manager.maxCount).toBe(5);
        });
    });

    describe('load()', () => {
        test('returns empty array when no data stored', async () => {
            const result = await manager.load();

            expect(result).toEqual([]);
            expect(localStorage.getItem).toHaveBeenCalledWith('recentWorks');
        });

        test('returns stored works array', async () => {
            const storedWorks = [
                { composer: 'Bach', work: 'Mass in B Minor' },
                { composer: 'Handel', work: 'Messiah' }
            ];
            mockLocalStorage['recentWorks'] = JSON.stringify(storedWorks);

            const result = await manager.load();

            expect(result).toEqual(storedWorks);
        });

        test('returns empty array when stored data is not an array', async () => {
            mockLocalStorage['recentWorks'] = JSON.stringify({ invalid: 'data' });

            const result = await manager.load();

            expect(result).toEqual([]);
        });

        test('handles JSON parse errors gracefully', async () => {
            mockLocalStorage['recentWorks'] = 'invalid json';

            const result = await manager.load();

            expect(result).toEqual([]);
            expect(console.error).toHaveBeenCalled();
        });

        test('handles localStorage errors gracefully', async () => {
            localStorage.getItem.mockImplementation(() => {
                throw new Error('Storage error');
            });

            const result = await manager.load();

            expect(result).toEqual([]);
            expect(console.error).toHaveBeenCalled();
        });
    });

    describe('save()', () => {
        test('saves a new recent work', async () => {
            const result = await manager.save('Bach', 'Mass in B Minor');

            expect(result).toEqual([
                { composer: 'Bach', work: 'Mass in B Minor' }
            ]);
            expect(localStorage.setItem).toHaveBeenCalled();
        });

        test('adds new work to beginning of list', async () => {
            mockLocalStorage['recentWorks'] = JSON.stringify([
                { composer: 'Handel', work: 'Messiah' }
            ]);

            const result = await manager.save('Bach', 'Mass in B Minor');

            expect(result[0]).toEqual({ composer: 'Bach', work: 'Mass in B Minor' });
            expect(result[1]).toEqual({ composer: 'Handel', work: 'Messiah' });
        });

        test('deduplicates works', async () => {
            mockLocalStorage['recentWorks'] = JSON.stringify([
                { composer: 'Bach', work: 'Mass in B Minor' },
                { composer: 'Handel', work: 'Messiah' }
            ]);

            const result = await manager.save('Bach', 'Mass in B Minor');

            expect(result).toHaveLength(2);
            expect(result[0]).toEqual({ composer: 'Bach', work: 'Mass in B Minor' });
            expect(result[1]).toEqual({ composer: 'Handel', work: 'Messiah' });
        });

        test('stores movement when provided', async () => {
            const result = await manager.save('Handel', 'Messiah', 'Hallelujah');

            expect(result).toEqual([
                { composer: 'Handel', work: 'Messiah', movement: 'Hallelujah' }
            ]);
            expect(JSON.parse(mockLocalStorage['recentWorks'])).toEqual(result);
        });

        test('omits movement key when movement is not provided', async () => {
            const result = await manager.save('Bach', 'Mass in B Minor');

            expect(result[0]).not.toHaveProperty('movement');
        });

        test('deduplicates by composer and work regardless of movement', async () => {
            mockLocalStorage['recentWorks'] = JSON.stringify([
                { composer: 'Handel', work: 'Messiah', movement: 'Overture' }
            ]);

            const result = await manager.save('Handel', 'Messiah', 'Hallelujah');

            expect(result).toEqual([
                { composer: 'Handel', work: 'Messiah', movement: 'Hallelujah' }
            ]);
        });

        test('limits to maxCount (5) works', async () => {
            const existingWorks = [];
            for (let i = 0; i < 5; i++) {
                existingWorks.push({ composer: `Composer${i}`, work: `Work${i}` });
            }
            mockLocalStorage['recentWorks'] = JSON.stringify(existingWorks);

            const result = await manager.save('NewComposer', 'NewWork');

            expect(result).toHaveLength(5);
            expect(result[0]).toEqual({ composer: 'NewComposer', work: 'NewWork' });
            expect(result[4]).toEqual({ composer: 'Composer3', work: 'Work3' });
            // Composer4 should have been dropped
            expect(result.find(w => w.composer === 'Composer4')).toBeUndefined();
        });

        test('handles save errors gracefully', async () => {
            localStorage.setItem.mockImplementation(() => {
                throw new Error('Storage error');
            });

            const result = await manager.save('Bach', 'Mass in B Minor');

            expect(result).toEqual([]);
            expect(console.error).toHaveBeenCalled();
        });
    });

    describe('clear()', () => {
        test('clears recent works from storage', async () => {
            mockLocalStorage['recentWorks'] = JSON.stringify([
                { composer: 'Bach', work: 'Mass in B Minor' }
            ]);

            await manager.clear();

            expect(localStorage.removeItem).toHaveBeenCalledWith('recentWorks');
            expect(mockLocalStorage['recentWorks']).toBeUndefined();
        });

        test('handles clear errors gracefully', async () => {
            localStorage.removeItem.mockImplementation(() => {
                throw new Error('Storage error');
            });

            await expect(manager.clear()).resolves.not.toThrow();
            expect(console.error).toHaveBeenCalled();
        });
    });
});
