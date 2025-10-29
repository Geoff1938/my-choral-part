/**
 * Unit tests for RecentWorksManager
 */

// Copy of RecentWorksManager class for testing
class RecentWorksManager {
    constructor() {
        this.storageKey = 'recentWorks';
        this.maxCount = 5;
    }

    async load() {
        try {
            const stored = localStorage.getItem(this.storageKey);
            if (!stored) {
                return [];
            }

            const works = JSON.parse(stored);
            return Array.isArray(works) ? works : [];
        } catch (error) {
            console.error('Error loading recent works from localStorage:', error);
            return [];
        }
    }

    async save(composer, work) {
        try {
            let recent = await this.load();

            // Remove any existing entry for this work (dedup)
            recent = recent.filter(item =>
                !(item.composer === composer && item.work === work)
            );

            // Add to the beginning
            recent.unshift({ composer, work });

            // Limit to max count
            if (recent.length > this.maxCount) {
                recent = recent.slice(0, this.maxCount);
            }

            // Save to localStorage
            localStorage.setItem(this.storageKey, JSON.stringify(recent));

            return recent;
        } catch (error) {
            console.error('Error saving recent work to localStorage:', error);
            return [];
        }
    }

    async clear() {
        try {
            localStorage.removeItem(this.storageKey);
        } catch (error) {
            console.error('Error clearing recent works:', error);
        }
    }

    async saveToServer(composer, work) {
        try {
            const response = await fetch('/api/recent-works', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ composer, work })
            });

            if (!response.ok) {
                throw new Error(`Server returned ${response.status}`);
            }

            return await response.json();
        } catch (error) {
            console.error('Error saving recent work to server:', error);
            // Fallback to local storage
            return await this.save(composer, work);
        }
    }

    async loadFromServer() {
        try {
            const response = await fetch('/api/recent-works');

            if (!response.ok) {
                throw new Error(`Server returned ${response.status}`);
            }

            return await response.json();
        } catch (error) {
            console.error('Error loading recent works from server:', error);
            // Fallback to local storage
            return await this.load();
        }
    }
}

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
        global.console.error = jest.fn();

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

    describe('saveToServer()', () => {
        beforeEach(() => {
            global.fetch = jest.fn();
        });

        test('saves to server successfully', async () => {
            const serverResponse = [
                { composer: 'Bach', work: 'Mass in B Minor' }
            ];
            fetch.mockResolvedValue({
                ok: true,
                json: jest.fn().mockResolvedValue(serverResponse)
            });

            const result = await manager.saveToServer('Bach', 'Mass in B Minor');

            expect(fetch).toHaveBeenCalledWith('/api/recent-works', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ composer: 'Bach', work: 'Mass in B Minor' })
            });
            expect(result).toEqual(serverResponse);
        });

        test('falls back to local storage on server error', async () => {
            fetch.mockResolvedValue({
                ok: false,
                status: 500
            });

            const result = await manager.saveToServer('Bach', 'Mass in B Minor');

            expect(result).toEqual([
                { composer: 'Bach', work: 'Mass in B Minor' }
            ]);
            expect(localStorage.setItem).toHaveBeenCalled();
        });

        test('falls back to local storage on network error', async () => {
            fetch.mockRejectedValue(new Error('Network error'));

            const result = await manager.saveToServer('Bach', 'Mass in B Minor');

            expect(result).toEqual([
                { composer: 'Bach', work: 'Mass in B Minor' }
            ]);
            expect(localStorage.setItem).toHaveBeenCalled();
        });
    });

    describe('loadFromServer()', () => {
        beforeEach(() => {
            global.fetch = jest.fn();
        });

        test('loads from server successfully', async () => {
            const serverResponse = [
                { composer: 'Bach', work: 'Mass in B Minor' },
                { composer: 'Handel', work: 'Messiah' }
            ];
            fetch.mockResolvedValue({
                ok: true,
                json: jest.fn().mockResolvedValue(serverResponse)
            });

            const result = await manager.loadFromServer();

            expect(fetch).toHaveBeenCalledWith('/api/recent-works');
            expect(result).toEqual(serverResponse);
        });

        test('falls back to local storage on server error', async () => {
            fetch.mockResolvedValue({
                ok: false,
                status: 500
            });

            mockLocalStorage['recentWorks'] = JSON.stringify([
                { composer: 'Bach', work: 'Mass in B Minor' }
            ]);

            const result = await manager.loadFromServer();

            expect(result).toEqual([
                { composer: 'Bach', work: 'Mass in B Minor' }
            ]);
            expect(localStorage.getItem).toHaveBeenCalled();
        });

        test('falls back to local storage on network error', async () => {
            fetch.mockRejectedValue(new Error('Network error'));

            mockLocalStorage['recentWorks'] = JSON.stringify([
                { composer: 'Bach', work: 'Mass in B Minor' }
            ]);

            const result = await manager.loadFromServer();

            expect(result).toEqual([
                { composer: 'Bach', work: 'Mass in B Minor' }
            ]);
            expect(localStorage.getItem).toHaveBeenCalled();
        });
    });
});
