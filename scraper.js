const axios = require('axios');
const cheerio = require('cheerio');
const fs = require('fs-extra');
const path = require('path');

/**
 * Choral Music Scraper
 * Scrapes MIDI file metadata from learnchoralmusic.co.uk and provides search/query APIs
 */
class ChoralMusicScraper {
  /**
   * Initialize the scraper with configuration
   */
  constructor() {
    this.baseUrl = 'https://www.learnchoralmusic.co.uk';
    this.composerListUrl = `${this.baseUrl}/complist.html#list`;
    this.dataFile = path.join(__dirname, 'data', 'midi-index-full.json'); // Full index (all composers)
    this.initialIndexFile = path.join(__dirname, 'data', 'initial-index.json'); // Initial index (A composers only)
    this.recentWorksFile = path.join(__dirname, 'data', 'recent-works.json');
    this.exceptionsFile = path.join(__dirname, 'data', 'indexing-exceptions.json'); // Exception report

    // Songs URLs (madrigals and carols - single songs merged into main index)
    this.madrigalsUrl = `${this.baseUrl}/Madrigals-etc/Madrigals-complist.html`;
    this.carolsUrl = `${this.baseUrl}/Carols%20&%20Anthems/Carols-complist.html`;

    // Delay between HTTP requests (ms) - be respectful to the server
    this.requestDelay = 200;

    // Hard-coded rules for handling special cases
    // Work name transformations: Map URL patterns to renamed work names
    this.workNameTransforms = {
      // Mozart Requiem - two completions
      '/Mozart/Requiem/': 'Requiem (Sussmayr completion)',
      '/Mozart/Requiem-Levin/': 'Requiem (Levin completion)',
      // Monteverdi Beatus Vir - three versions
      '/Monteverdi/Beatus Vir/': 'Beatus Vir (Novello SSATB)',
      '/Monteverdi/Beatus Vir - SSATB/': 'Beatus Vir (Chappell SSATB)',
      '/Monteverdi/Beatus Vir - Jackson/': 'Beatus Vir (Jackson SSAATBB)'
    };

    // Works to skip entirely (URL patterns)
    this.skippedWorks = [
      '/Verdi/AltRequiem/'  // Same notes as main Requiem, just different dynamics
    ];

    // Section merges: Map URL patterns to merged section names
    // When multiple section names point to the same MIDI file, use this combined name
    this.sectionMerges = {
      // Verdi Requiem - multiple sections in one MIDI file
      '/Verdi/Requiem/rex.mid': 'Rex Tremendae, Recordare',
      '/Verdi/Requiem/ingemisco.mid': 'Ingemisco, Confutatis, Lacrymosa'
    };

    // Configure axios with browser-like headers to avoid blocking
    this.axiosConfig = {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept-Encoding': 'gzip, deflate, br',
        'Referer': 'https://www.learnchoralmusic.co.uk/',
        'Connection': 'keep-alive',
        'Cache-Control': 'no-cache'
      }
    };
  }

  // Helper function to convert absolute URL to relative (removes base URL)
  toRelativeUrl(absoluteUrl) {
    if (absoluteUrl.startsWith(this.baseUrl)) {
      return absoluteUrl.substring(this.baseUrl.length);
    }
    return absoluteUrl;
  }

  // Helper function to clean up whitespace in text (replace tabs, newlines, multiple spaces with single space)
  cleanWhitespace(text) {
    if (!text) return text;
    return text.replace(/[\t\n\r]+/g, ' ').replace(/\s+/g, ' ').trim();
  }

  // Helper function to check if a section name is a continuation (starts with dashes)
  isContinuationSection(name) {
    // Matches names that start with "- -" or "---" patterns
    return /^[\s-]*-[\s-]+-/.test(name);
  }

  // Helper function to extract the actual name from a continuation section
  extractContinuationName(name) {
    // Remove leading dashes and spaces, clean up whitespace
    return this.cleanWhitespace(name.replace(/^[\s-]+/, ''));
  }

  // Helper function to check if a work should be skipped
  shouldSkipWork(workUrl) {
    return this.skippedWorks.some(pattern => workUrl.includes(pattern));
  }

  // Helper function to get transformed work name (or original if no transform)
  getTransformedWorkName(workUrl, originalName) {
    for (const [pattern, newName] of Object.entries(this.workNameTransforms)) {
      if (workUrl.includes(pattern)) {
        return newName;
      }
    }
    return originalName;
  }

  // Helper function to get merged section name (or null if no merge)
  getMergedSectionName(midiUrl) {
    for (const [pattern, mergedName] of Object.entries(this.sectionMerges)) {
      if (midiUrl.includes(pattern)) {
        return mergedName;
      }
    }
    return null;
  }

  // Helper function to check if a URL points to a MIDI file (not an HTML page)
  isMidiFileUrl(url) {
    const lowerUrl = url.toLowerCase();
    return lowerUrl.endsWith('.mid') || lowerUrl.endsWith('.midi');
  }

  async initializeDataDirectory() {
    await fs.ensureDir(path.dirname(this.dataFile));
  }

  /**
   * Ensure the initial index file exists in the data directory
   * Copies from template if needed (important for Render's ephemeral filesystem)
   * @returns {Promise<void>}
   */
  async ensureInitialIndex() {
    // Ensure data directory exists
    await this.initializeDataDirectory();

    // Check if initial index exists in data directory
    const initialIndexExists = await fs.pathExists(this.initialIndexFile);

    if (!initialIndexExists) {
      // Copy template from root to data directory
      const templatePath = path.join(__dirname, 'initial-index-template.json');
      const templateExists = await fs.pathExists(templatePath);

      if (templateExists) {
        console.log('Copying initial index template to data directory...');
        await fs.copy(templatePath, this.initialIndexFile);
        console.log('Initial index copied successfully');
      } else {
        console.log('Warning: No initial index template found');
      }
    } else {
      console.log('Initial index already exists in data directory');
    }
  }

  async scrapeComposerList() {
    console.log('Starting to scrape composer list...');

    try {
      const response = await axios.get(this.composerListUrl, this.axiosConfig);
      const $ = cheerio.load(response.data);
      
      const composers = [];
      
      // Find the table with composer information
      $('table tr').each((index, row) => {
        const $row = $(row);
        const cells = $row.find('td');
        
        if (cells.length >= 2) {
          const composerCell = cells.eq(0);
          const worksCell = cells.eq(1);
          
          const composerName = composerCell.text().trim();
          
          if (composerName && worksCell.length > 0) {
            const works = [];
            
            // Extract work links from the works cell
            worksCell.find('a').each((workIndex, workLink) => {
              const $workLink = $(workLink);
              const workName = $workLink.text().trim();
              const workUrl = $workLink.attr('href');
              
              if (workName && workUrl) {
                // Convert to absolute URL first (if needed), then store as relative
                const fullWorkUrl = workUrl.startsWith('http') ? workUrl : `${this.baseUrl}/${workUrl}`;
                works.push({
                  name: workName,
                  url: this.toRelativeUrl(fullWorkUrl)
                });
              }
            });
            
            if (works.length > 0) {
              composers.push({
                name: composerName,
                works: works
              });
            }
          }
        }
      });
      
      console.log(`Found ${composers.length} composers`);
      return composers;
    } catch (error) {
      console.error('Error scraping composer list:', error.message);
      return [];
    }
  }

  async scrapeWorkSections(workUrl, visitedUrls = new Set(), exceptions = null, composerName = '', workName = '') {
    try {
      // Convert relative URL to absolute URL if needed
      let fullUrl;
      if (workUrl.startsWith('http')) {
        fullUrl = workUrl;
      } else {
        // For relative URLs, properly encode the path components
        const relativePath = workUrl.startsWith('/') ? workUrl : '/' + workUrl;
        // Split path, encode each component, then rejoin
        const pathParts = relativePath.split('/');
        const encodedParts = pathParts.map(part => encodeURIComponent(part));
        const encodedPath = encodedParts.join('/');
        fullUrl = `${this.baseUrl}${encodedPath}`;
      }

      console.log(`Scraping work: ${workUrl}`);

      // Prevent infinite loops
      if (visitedUrls.has(workUrl)) {
        console.log(`Already visited ${workUrl}, skipping`);
        return [];
      }
      visitedUrls.add(workUrl);

      const response = await axios.get(fullUrl, this.axiosConfig);
      const $ = cheerio.load(response.data);

      const sections = [];

      // Track seen MIDI URLs to handle merged sections (avoid duplicates)
      const seenMidiUrls = new Set();

      // Look for tables with MIDI file information
      $('table').each((tableIndex, table) => {
        const $table = $(table);

        // Look through all rows to find header row with column names
        let unemphasizedColumnIndex = -1;
        let headerRowIndex = -1;

        $table.find('tr').each((rowIndex, row) => {
          const $row = $(row);
          $row.find('td, th').each((colIndex, cell) => {
            const cellText = $(cell).text().trim().toLowerCase();
            if (cellText.includes('unemphasized') || cellText.includes('unemphasised') ||
                cellText === 'un' || cellText.startsWith('un-') || cellText.includes('unemp')) {
              unemphasizedColumnIndex = colIndex;
              headerRowIndex = rowIndex;
              console.log(`Found unemphasized column at row ${rowIndex}, col ${colIndex}: "${cellText}"`);
              return false; // break inner loop
            }
          });
          if (unemphasizedColumnIndex >= 0) return false; // break outer loop
        });

        if (unemphasizedColumnIndex >= 0) {
          console.log(`Processing table ${tableIndex}, UN column at index ${unemphasizedColumnIndex}`);

          // Track the last "parent" section for handling continuation rows
          let lastParentSection = null;

          // Process data rows (skip header row)
          $table.find('tr').slice(headerRowIndex + 1).each((rowIndex, row) => {
            const $row = $(row);
            const cells = $row.find('td, th');

            if (cells.length > unemphasizedColumnIndex) {
              const sectionNameCell = cells.first();
              let sectionName = this.cleanWhitespace(sectionNameCell.text());

              if (sectionName && sectionName !== '') {
                const midiCell = cells.eq(unemphasizedColumnIndex);

                // Check if this is a continuation section (starts with "- - -" pattern)
                if (this.isContinuationSection(sectionName)) {
                  const continuationName = this.extractContinuationName(sectionName);
                  if (lastParentSection && continuationName) {
                    // Prepend the parent section name
                    sectionName = `${lastParentSection} - ${continuationName}`;
                    console.log(`Continuation section: "${continuationName}" -> "${sectionName}"`);
                  } else {
                    sectionName = continuationName || sectionName;
                  }
                } else {
                  // This is a parent section - remember it for continuations
                  lastParentSection = sectionName;
                }

                console.log(`Section "${sectionName}" - MIDI cell content: "${midiCell.text().trim()}"`);

                // Look for any link in the MIDI cell
                const midiLink = midiCell.find('a').first();

                if (midiLink.length > 0) {
                  const midiUrl = midiLink.attr('href');
                  console.log(`Found link: ${midiUrl}`);
                  if (midiUrl && midiUrl !== '#') {
                    // Check if this is actually a MIDI file URL (not an HTML page)
                    if (!this.isMidiFileUrl(midiUrl)) {
                      console.log(`  SKIPPING: Link is not a MIDI file: ${midiUrl}`);
                      // Record this as an unavailable work
                      if (exceptions) {
                        exceptions.unavailableWorks.push({
                          composer: composerName,
                          work: workName,
                          section: sectionName,
                          url: midiUrl,
                          reason: 'Link points to HTML page, not MIDI file'
                        });
                      }
                    } else {
                      // Convert relative URL to absolute first
                      const fullMidiUrl = midiUrl.startsWith('http') ? midiUrl :
                        midiUrl.startsWith('/') ? `${this.baseUrl}${midiUrl}` :
                        `${workUrl.substring(0, workUrl.lastIndexOf('/'))}/${midiUrl}`;

                      const relativeMidiUrl = this.toRelativeUrl(fullMidiUrl);

                      // Check if this MIDI URL has a merged section name
                      const mergedName = this.getMergedSectionName(relativeMidiUrl);
                      const finalSectionName = mergedName || sectionName;

                      // Check if we've already added this MIDI URL (for merged sections)
                      if (seenMidiUrls.has(relativeMidiUrl)) {
                        console.log(`  SKIPPING duplicate MIDI URL: ${relativeMidiUrl} (already added as merged section)`);
                      } else {
                        seenMidiUrls.add(relativeMidiUrl);
                        // Store as relative URL to save space
                        sections.push({
                          name: finalSectionName,
                          midiUrl: relativeMidiUrl
                        });
                        console.log(`Added section: ${finalSectionName} -> ${relativeMidiUrl}`);
                      }
                    }
                  }
                } else {
                  // Check if the cell has "yes" text which might indicate availability
                  const cellText = midiCell.text().trim().toLowerCase();
                  if (cellText === 'yes') {
                    console.log(`Found "yes" for section "${sectionName}" but no direct MIDI link`);
                  }
                }
              }
            }
          });
        }
      });

      // Look for links to additional parts (Part 2, Part 3, etc.)
      const additionalPartLinks = [];
      $('a').each((index, link) => {
        const $link = $(link);
        const linkText = $link.text().trim();
        const linkHref = $link.attr('href');

        if (linkHref && linkHref !== '#') {
          // Look for patterns like "Part 2", "Part II", "Part 3", etc.
          const partPattern = /part\s*(\d+|[ivxIVX]+)/i;
          const match = linkText.match(partPattern);

          if (match) {
            // Convert relative URL to absolute
            let fullUrl = linkHref.startsWith('http') ? linkHref :
              linkHref.startsWith('/') ? `${this.baseUrl}${linkHref}` :
              `${workUrl.substring(0, workUrl.lastIndexOf('/'))}/${linkHref}`;

            console.log(`Found link to additional part: "${linkText}" -> ${fullUrl}`);
            additionalPartLinks.push({ text: linkText, url: fullUrl });
          }
        }
      });

      // Scrape additional parts
      for (const partLink of additionalPartLinks) {
        console.log(`Following link to: ${partLink.text}`);
        await new Promise(resolve => setTimeout(resolve, this.requestDelay));
        const additionalSections = await this.scrapeWorkSections(partLink.url, visitedUrls, exceptions, composerName, workName);
        sections.push(...additionalSections);
      }

      console.log(`Found ${sections.length} sections total with MIDI files`);
      return sections;
    } catch (error) {
      console.error(`Error scraping work ${workUrl}:`, error.message);
      return [];
    }
  }

  async buildCompleteIndex(testMode = false) {
    console.log('Building complete MIDI index...');
    await this.initializeDataDirectory();

    // Track exceptions (duplicates, unavailable works, etc.) for review
    const exceptions = {
      duplicateWorks: [],
      unavailableWorks: [],
      skippedWorks: [],
      unavailableSongs: [],
      timestamp: new Date().toISOString()
    };

    const composers = await this.scrapeComposerList();
    let filteredComposers = composers;

    // In test mode, only process composers starting with A or B
    if (testMode) {
      filteredComposers = composers.filter(composer => {
        const firstLetter = composer.name.charAt(0).toUpperCase();
        return firstLetter === 'A'; // Just A composers for faster testing
      });
      console.log(`Test mode: Processing ${filteredComposers.length} composers (A only)`);
    }

    const completeIndex = [];

    for (const composer of filteredComposers) {
      console.log(`Processing composer: ${composer.name}`);
      const composerData = {
        name: composer.name,
        works: []
      };

      // Track work names to detect duplicates within this composer
      const seenWorkNames = new Map(); // Map<workName, firstUrl>

      for (const work of composer.works) {
        console.log(`  Processing work: ${work.name}`);

        // Check if this work should be skipped entirely
        if (this.shouldSkipWork(work.url)) {
          console.log(`  SKIPPING WORK (hardcoded rule): "${work.name}" at ${work.url}`);
          exceptions.skippedWorks.push({
            composer: composer.name,
            workName: work.name,
            url: work.url,
            reason: 'Hardcoded skip rule'
          });
          continue;
        }

        // Apply work name transformation if applicable
        const transformedWorkName = this.getTransformedWorkName(work.url, work.name);
        if (transformedWorkName !== work.name) {
          console.log(`  TRANSFORMING WORK NAME: "${work.name}" -> "${transformedWorkName}"`);
        }

        // Check for duplicate work names (using transformed name)
        if (seenWorkNames.has(transformedWorkName)) {
          const firstUrl = seenWorkNames.get(transformedWorkName);
          console.log(`  DUPLICATE WORK DETECTED: "${transformedWorkName}" - skipping (first: ${firstUrl}, duplicate: ${work.url})`);
          exceptions.duplicateWorks.push({
            composer: composer.name,
            workName: transformedWorkName,
            firstUrl: firstUrl,
            duplicateUrl: work.url
          });
          continue; // Skip this duplicate
        }

        // Remember this work name (transformed)
        seenWorkNames.set(transformedWorkName, work.url);

        const sections = await this.scrapeWorkSections(work.url, new Set(), exceptions, composer.name, transformedWorkName);

        if (sections.length > 0) {
          composerData.works.push({
            name: transformedWorkName,
            url: work.url,
            sections: sections
          });
        }

        // Add a delay to be respectful to the server and avoid rate limiting
        await new Promise(resolve => setTimeout(resolve, this.requestDelay));
      }

      if (composerData.works.length > 0) {
        completeIndex.push(composerData);
      }
    }

    // Now scrape and merge madrigals and carols (single songs)
    console.log('\n--- Scraping madrigals and carols ---');
    await this.mergeSongsIntoIndex(completeIndex, exceptions, testMode);

    // Save the exception report if there are any exceptions
    const hasExceptions = exceptions.duplicateWorks.length > 0 ||
                          exceptions.unavailableWorks.length > 0 ||
                          exceptions.skippedWorks.length > 0 ||
                          exceptions.unavailableSongs.length > 0;
    if (hasExceptions) {
      await fs.writeJSON(this.exceptionsFile, exceptions, { spaces: 2 });
      console.log(`Exception report saved to ${this.exceptionsFile}`);
      if (exceptions.duplicateWorks.length > 0) {
        console.log(`  - ${exceptions.duplicateWorks.length} duplicate works found`);
      }
      if (exceptions.unavailableWorks.length > 0) {
        console.log(`  - ${exceptions.unavailableWorks.length} unavailable works (non-MIDI links)`);
      }
      if (exceptions.skippedWorks.length > 0) {
        console.log(`  - ${exceptions.skippedWorks.length} works skipped (hardcoded rules)`);
      }
      if (exceptions.unavailableSongs.length > 0) {
        console.log(`  - ${exceptions.unavailableSongs.length} unavailable songs (non-MIDI links)`);
      }
    }

    // Save the index to file
    await fs.writeJSON(this.dataFile, completeIndex, { spaces: 2 });
    console.log(`Index saved to ${this.dataFile}`);
    console.log(`Total composers with works: ${completeIndex.length}`);

    return completeIndex;
  }

  async buildIndexInBackground(testMode = false) {
    console.log('Starting background index build...');
    try {
      await this.buildCompleteIndex(testMode);
      console.log('Background index build completed successfully');
    } catch (error) {
      console.error('Background index build failed:', error.message);
    }
  }

  /**
   * Merge songs (madrigals and carols) into the main index
   * Songs become single-section works
   * @param {Array} index - The main index to merge into (modified in place)
   * @param {Object} exceptions - Exception tracking object
   * @param {boolean} testMode - If true, only process composers starting with 'A'
   */
  async mergeSongsIntoIndex(index, exceptions, testMode = false) {
    // Create a map of existing composers for easy lookup
    const composerMap = new Map();
    for (const composer of index) {
      composerMap.set(composer.name.toLowerCase(), composer);
    }

    // Helper to find or create a composer entry
    const getOrCreateComposer = (composerName) => {
      const key = composerName.toLowerCase();
      if (composerMap.has(key)) {
        return composerMap.get(key);
      }
      // Create new composer entry
      const newComposer = {
        name: composerName,
        works: []
      };
      index.push(newComposer);
      composerMap.set(key, newComposer);
      return newComposer;
    };

    // Helper to check if a work already exists for a composer
    const workExists = (composer, workName) => {
      const workNameLower = workName.toLowerCase();
      return composer.works.some(w => w.name.toLowerCase() === workNameLower);
    };

    // Scrape madrigals
    console.log('Scraping madrigals...');
    const madrigals = await this.scrapeSongsPage(
      this.madrigalsUrl,
      'madrigals',
      '/Madrigals-etc',
      exceptions
    );

    // Merge madrigals into index
    let madrigalCount = 0;
    for (const songComposer of madrigals) {
      // In test mode, only process composers starting with A
      if (testMode && !songComposer.name.charAt(0).toUpperCase().startsWith('A')) {
        continue;
      }

      const composer = getOrCreateComposer(songComposer.name);

      for (const song of songComposer.songs) {
        // Check for duplicate work names
        if (workExists(composer, song.name)) {
          console.log(`  Skipping duplicate: ${songComposer.name} - ${song.name}`);
          continue;
        }

        // Add song as a single-section work
        composer.works.push({
          name: song.name,
          url: null, // Songs don't have a work page
          sections: [
            {
              name: song.name,
              midiUrl: song.midiUrl
            }
          ]
        });
        madrigalCount++;
      }
    }
    console.log(`Merged ${madrigalCount} madrigals`);

    // Add delay between pages
    await new Promise(resolve => setTimeout(resolve, this.requestDelay));

    // Scrape carols
    console.log('Scraping carols...');
    const carols = await this.scrapeSongsPage(
      this.carolsUrl,
      'carols',
      '/Carols & Anthems',
      exceptions
    );

    // Merge carols into index
    let carolCount = 0;
    for (const songComposer of carols) {
      // In test mode, only process composers starting with A
      if (testMode && !songComposer.name.charAt(0).toUpperCase().startsWith('A')) {
        continue;
      }

      const composer = getOrCreateComposer(songComposer.name);

      for (const song of songComposer.songs) {
        // Check for duplicate work names
        if (workExists(composer, song.name)) {
          console.log(`  Skipping duplicate: ${songComposer.name} - ${song.name}`);
          continue;
        }

        // Add song as a single-section work
        composer.works.push({
          name: song.name,
          url: null, // Songs don't have a work page
          sections: [
            {
              name: song.name,
              midiUrl: song.midiUrl
            }
          ]
        });
        carolCount++;
      }
    }
    console.log(`Merged ${carolCount} carols`);

    // Sort index by composer name
    index.sort((a, b) => a.name.localeCompare(b.name));

    // Sort works within each composer
    for (const composer of index) {
      composer.works.sort((a, b) => a.name.localeCompare(b.name));
    }

    console.log(`Total songs merged: ${madrigalCount + carolCount}`);
  }

  /**
   * Load the MIDI index from disk
   * Tries full index first, falls back to initial index (A composers) if full index unavailable
   * @returns {Promise<Array>} Array of composer objects with works and sections
   * @example
   * const index = await scraper.loadIndex();
   * // Returns: [{ name: "Bach", works: [...] }, ...]
   */
  async loadIndex() {
    try {
      // Try loading the full index first
      if (await fs.pathExists(this.dataFile)) {
        console.log('Loading full MIDI index...');
        const fullIndex = await fs.readJSON(this.dataFile);
        // If full index has data, return it
        if (fullIndex && fullIndex.length > 0) {
          return fullIndex;
        }
        console.log('Full index is empty, falling back to initial index...');
      }

      // Fallback to initial index (A composers only)
      if (await fs.pathExists(this.initialIndexFile)) {
        console.log('Loading initial MIDI index (A composers only)...');
        return await fs.readJSON(this.initialIndexFile);
      }

      console.log('No index file found');
    } catch (error) {
      console.error('Error loading index:', error.message);
    }
    return [];
  }

  /**
   * Search for composers by name (substring match, case-insensitive)
   * @param {string} searchTerm - Search query
   * @returns {Promise<Array>} Array of matching composers
   * @example
   * const results = await scraper.searchComposers('bach');
   * // Returns: [{ name: "Bach", works: [...] }, { name: "Offenbach", ... }]
   */
  async searchComposers(searchTerm) {
    const index = await this.loadIndex();
    const searchLower = searchTerm.toLowerCase();

    return index.filter(composer =>
      composer.name.toLowerCase().includes(searchLower)
    );
  }

  /**
   * Advanced search across composers, works, and movements
   * Matches word beginnings only (e.g., "mag" matches "Magnificat" but not "Image")
   * @param {string} searchTerms - Space-separated search terms (all must match)
   * @param {Object} options - Search options
   * @param {boolean} options.composers - Search composer names (default: true)
   * @param {boolean} options.works - Search work names (default: false)
   * @param {boolean} options.movements - Search movement/section names (default: false)
   * @returns {Promise<Object>} Object with arrays: { composers, works, movements }
   * @example
   * const results = await scraper.advancedSearch('bach mag', { works: true });
   * // Returns: { composers: [], works: [{ composer: "Bach", work: "Magnificat" }], movements: [] }
   */
  async advancedSearch(searchTerms, options = { composers: true, works: false, movements: false }) {
    const index = await this.loadIndex();
    const results = {
      composers: [],
      works: [],
      movements: []
    };

    // Split search terms and convert to lowercase
    const terms = searchTerms.trim().toLowerCase().split(/\s+/).filter(t => t.length > 0);
    if (terms.length === 0) return results;

    // Helper function to check if any word in text starts with the search term
    const matchesWordStart = (text, term) => {
      const words = text.toLowerCase().split(/\s+/);
      return words.some(word => word.startsWith(term));
    };

    // Helper function to check if all terms match (in any combination)
    const matchesAllTerms = (text) => {
      return terms.every(term => matchesWordStart(text, term));
    };

    // Search through the index
    for (const composer of index) {
      let composerMatches = false;

      // Check composer name
      if (options.composers && matchesAllTerms(composer.name)) {
        results.composers.push({
          name: composer.name
        });
        composerMatches = true;
      }

      // Check works
      if (options.works || options.movements) {
        for (const work of composer.works) {
          let workMatches = false;

          // Check work name
          if (options.works && matchesAllTerms(work.name)) {
            results.works.push({
              composer: composer.name,
              work: work.name
            });
            workMatches = true;
          }

          // Check if all terms match across composer + work combination
          if (options.works && !workMatches && !composerMatches) {
            const combinedText = `${composer.name} ${work.name}`;
            if (matchesAllTerms(combinedText)) {
              results.works.push({
                composer: composer.name,
                work: work.name
              });
              workMatches = true;
            }
          }

          // Check movements/sections - only match if search term is in the section name itself
          if (options.movements && work.sections) {
            for (const section of work.sections) {
              const sectionMatches = matchesAllTerms(section.name);

              if (sectionMatches) {
                results.movements.push({
                  composer: composer.name,
                  work: work.name,
                  movement: section.name,
                  midiUrl: section.midiUrl
                });
              }
            }
          }
        }
      }
    }

    return results;
  }

  /**
   * Get all works for a specific composer
   * @param {string} composerName - Exact composer name
   * @returns {Promise<Array>} Array of works with sections
   * @example
   * const works = await scraper.getComposerWorks('Bach');
   * // Returns: [{ name: "Mass in B Minor", sections: [...] }, ...]
   */
  async getComposerWorks(composerName) {
    const index = await this.loadIndex();
    const composer = index.find(c => c.name === composerName);
    return composer ? composer.works : [];
  }

  /**
   * Get all sections/movements for a specific work
   * @param {string} composerName - Exact composer name
   * @param {string} workName - Exact work name
   * @returns {Promise<Array>} Array of sections with MIDI URLs
   * @example
   * const sections = await scraper.getWorkSections('Bach', 'Mass in B Minor');
   * // Returns: [{ name: "Kyrie", midiUrl: "/Bach/..." }, ...]
   */
  async getWorkSections(composerName, workName) {
    const index = await this.loadIndex();
    const composer = index.find(c => c.name === composerName);
    if (!composer) return [];

    const work = composer.works.find(w => w.name === workName);
    return work ? work.sections : [];
  }

  /**
   * Save a work to recent works list (max 5, most recent first)
   * @param {string} composerName - Composer name
   * @param {string} workName - Work name
   * @param {string} movementName - Movement name (optional)
   * @returns {Promise<Array>} Updated recent works array
   */
  async saveRecentWork(composerName, workName, movementName = null) {
    await this.initializeDataDirectory();

    let recentWorks = [];
    if (await fs.pathExists(this.recentWorksFile)) {
      try {
        recentWorks = await fs.readJSON(this.recentWorksFile);
      } catch (error) {
        console.error('Error loading recent works:', error.message);
      }
    }

    // Remove if already exists
    recentWorks = recentWorks.filter(item =>
      !(item.composer === composerName && item.work === workName)
    );

    // Add to beginning
    const entry = {
      composer: composerName,
      work: workName,
      timestamp: new Date().toISOString()
    };
    if (movementName) {
      entry.movement = movementName;
    }
    recentWorks.unshift(entry);

    // Keep only last 5
    recentWorks = recentWorks.slice(0, 5);

    await fs.writeJSON(this.recentWorksFile, recentWorks, { spaces: 2 });
    return recentWorks;
  }

  /**
   * Get recent works list
   * @returns {Promise<Array>} Array of recent works (max 5, most recent first)
   * @example
   * const recent = await scraper.getRecentWorks();
   * // Returns: [{ composer: "Bach", work: "...", timestamp: "..." }, ...]
   */
  async getRecentWorks() {
    if (await fs.pathExists(this.recentWorksFile)) {
      try {
        return await fs.readJSON(this.recentWorksFile);
      } catch (error) {
        console.error('Error loading recent works:', error.message);
      }
    }
    return [];
  }

  /**
   * Scrape a songs page (madrigals or carols) organized by composer
   * These pages use a table structure with composer names in the first column
   * and song links (to MIDI files) in the second column
   * @param {string} pageUrl - URL of the songs page
   * @param {string} category - Category name for logging (e.g., 'madrigals', 'carols')
   * @param {string} basePath - Base path for relative MIDI URLs (e.g., '/Madrigals-etc')
   * @param {Object} exceptions - Exception tracking object
   * @returns {Promise<Array>} Array of composer objects with songs
   */
  async scrapeSongsPage(pageUrl, category, basePath, exceptions) {
    console.log(`Scraping ${category} page: ${pageUrl}`);

    try {
      const response = await axios.get(pageUrl, this.axiosConfig);
      const $ = cheerio.load(response.data);

      const composers = [];

      // The page uses a table structure:
      // - First column (TD): Composer name with a named anchor
      // - Second column (TD): Links to MIDI files (songs)
      $('table tr').each((rowIndex, row) => {
        const $row = $(row);
        const cells = $row.find('td');

        if (cells.length >= 2) {
          const firstCell = cells.eq(0);
          const secondCell = cells.eq(1);

          // Check if first cell has a named anchor (indicates a composer row)
          const anchor = firstCell.find('a[name]');
          if (anchor.length > 0) {
            const anchorName = anchor.attr('name');

            // Skip navigation anchors (single letters, "list", etc.)
            if (!anchorName || anchorName.length <= 1 || anchorName === 'list') {
              return; // continue to next row
            }

            const composerName = this.cleanWhitespace(firstCell.text());

            if (composerName) {
              const composerData = {
                name: composerName,
                songs: []
              };

              // Find all song links in the second cell
              secondCell.find('a[href]').each((linkIndex, link) => {
                const $link = $(link);
                const href = $link.attr('href');
                const songName = this.cleanWhitespace($link.text());

                if (href && songName) {
                  // Check if this is a MIDI file
                  if (this.isMidiFileUrl(href)) {
                    // Build the full MIDI URL
                    let midiUrl;
                    if (href.startsWith('http')) {
                      midiUrl = this.toRelativeUrl(href);
                    } else if (href.startsWith('/')) {
                      midiUrl = href;
                    } else {
                      // Relative URL - prepend base path
                      midiUrl = `${basePath}/${href}`;
                    }

                    composerData.songs.push({
                      name: songName,
                      midiUrl: midiUrl
                    });
                  } else {
                    // Non-MIDI link - might be unavailable
                    // Skip common navigation patterns
                    if (!href.startsWith('#') && !href.startsWith('mailto:') &&
                        songName.length > 3 &&
                        !songName.match(/^(Part|Section|Back|Top|Home|Index)/i)) {
                      console.log(`  Non-MIDI link for "${songName}": ${href}`);
                      exceptions.unavailableSongs.push({
                        composer: composerName,
                        song: songName,
                        url: href,
                        category: category,
                        reason: 'Link points to non-MIDI file'
                      });
                    }
                  }
                }
              });

              // Only add composers with at least one song
              if (composerData.songs.length > 0) {
                composers.push(composerData);
                console.log(`Found composer: ${composerName} (${composerData.songs.length} songs)`);
              }
            }
          }
        }
      });

      console.log(`Found ${composers.length} composers with ${category}`);
      return composers;
    } catch (error) {
      console.error(`Error scraping ${category} page:`, error.message);
      return [];
    }
  }

}


module.exports = ChoralMusicScraper;