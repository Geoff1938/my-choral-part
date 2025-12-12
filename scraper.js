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
    this.exceptionsFile = path.join(__dirname, 'data', 'indexing-exceptions.json'); // Exception report

    // Songs URLs (madrigals and carols - single songs merged into main index)
    this.madrigalsUrl = `${this.baseUrl}/Madrigals-etc/Madrigals-complist.html`;
    this.carolsUrl = `${this.baseUrl}/Carols%20&%20Anthems/Carols-complist.html`;

    // Delay between HTTP requests (ms) - be respectful to the server
    this.requestDelay = 200;

    // Cache for loaded index (avoid reloading from disk on every request)
    this.indexCache = null;

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
    this.skippedWorks = [];

    // Section merges: Map URL patterns to merged section names
    // When multiple section names point to the same MIDI file, use this combined name
    this.sectionMerges = {
      // Verdi Requiem - multiple sections in one MIDI file
      '/Verdi/Requiem/rex.mid': 'Rex Tremendae, Recordare',
      '/Verdi/Requiem/ingemisco.mid': 'Ingemisco, Confutatis, Lacrymosa'
    };

    // Composer name normalization rules
    // Maps variant names to canonical names
    this.composerNameMap = {
      // Bach family - standardize JS Bach format
      'Bach (J S)': 'Bach, JS',
      // Bare surnames to full names (same person confirmed)
      'Archer': 'Archer (Malcolm)',
      'Bainton': 'Bainton (F)',
      'Batten': 'Batten (Adrian)',
      'Berlioz': 'Berlioz (Hector)',
      'Blow': 'Blow (John)',
      'Brahms': 'Brahms (Johannes)',
      'Britten': 'Britten (Benjamin)',
      'Bruckner': 'Bruckner (Anton)',
      'Byrd': 'Byrd (William)',
      'Charpentier': 'Charpentier (M A)',
      'Cooke': 'Cooke (Arnold)',
      'Croft': 'Croft (William)',
      'Darke': 'Darke (Harold)',
      'Debussy': 'Debussy (Claude)',
      'Delius': 'Delius (Frederick)',
      'Dering': 'Dering (Richard)',
      'Elgar': 'Elgar (Edward)',
      'Farmer': 'Farmer (John)',
      'Farrant': 'Farrant (Richard)',
      'Finzi': 'Finzi (Gerald)',
      'Franck': 'Franck (Cesar)',
      'Gibbons': 'Gibbons (Orlando)',
      'Goss': 'Goss (John)',
      'Hadley': 'Hadley (Patrick)',
      'Hassler': 'Hassler (Hans Leo)',
      'Haydn': 'Haydn (Joseph)',
      'Holst': 'Holst (Gustav)',
      'Howells': 'Howells (Herbert)',
      'Ives': 'Ives (Charles)',
      'Kodaly': 'Kodaly (Zoltan)',
      'Lassus': 'Lassus (Orlande de)',
      'Leighton': 'Leighton (Kenneth)',
      'Mathias': 'Mathias (William)',
      'Mendelssohn': 'Mendelssohn (Felix)',
      'Mendelssohn (Franz )': 'Mendelssohn (Felix)',
      'Monteverdi': 'Monteverdi (Claudio)',
      'Morley': 'Morley (Thomas)',
      'Mudd': 'Mudd (Thomas)',
      'Parry': 'Parry (C Hubert H)',
      'Parsons': 'Parsons (Robert)',
      'Pearsall': 'Pearsall (Robert)',
      'Philips': 'Philips (Peter)',
      'Porter': 'Porter (Walter)',
      'Purcell': 'Purcell (Henry)',
      'Purcell (Edward C)': 'Purcell (Henry)',
      'Rachmaninoff': 'Rachmaninoff (Sergei)',
      'Scheidt': 'Scheidt (Samuel)',
      'Stainer': 'Stainer (John)',
      'Stanford': 'Stanford (C V)',
      'Sullivan': 'Sullivan (Arthur)',
      'Tallis': 'Tallis (Thomas)',
      'Tavener': 'Tavener (John)',
      'Tchaikovsky': 'Tchaikovsky (P I)',
      'Tomkins': 'Tomkins (Thomas)',
      'Trad': 'Trad (arr. ??)',
      'Tye': 'Tye (Christopher)',
      'Vaughan Williams': 'Vaughan Williams (Ralph)',
      'Vaughan Williams (R)': 'Vaughan Williams (Ralph)',
      'Warlock': 'Warlock (Peter)',
      'Wishart': 'Wishart (Peter)',
      'Wood': 'Wood (Charles)',
      // Junk entries to clean up
      'Rutter   -  not publicly             available': 'Rutter (John)',
      'Weelkes - See also  the List for Partworks  and Madrigals': 'Weelkes (Thomas)',
      // Bennett - standardize format (keeping separate people separate)
      'Bennett W S': 'Bennett (W S)'
    };

    // Configure axios with browser-like headers to avoid blocking
    this.axiosConfig = {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
        'Accept-Language': 'en-GB,en-US;q=0.9,en;q=0.8',
        'Accept-Encoding': 'gzip, deflate, br',
        'Referer': 'https://www.learnchoralmusic.co.uk/',
        'Connection': 'keep-alive',
        'Cache-Control': 'max-age=0',
        'Sec-Fetch-Dest': 'document',
        'Sec-Fetch-Mode': 'navigate',
        'Sec-Fetch-Site': 'same-origin',
        'Upgrade-Insecure-Requests': '1'
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

  // Helper function to normalize composer names to canonical form
  normalizeComposerName(name) {
    if (!name) return name;
    const cleaned = this.cleanWhitespace(name);
    return this.composerNameMap[cleaned] || cleaned;
  }

  // Helper function to check if a section name is a continuation (starts with dashes)
  isContinuationSection(name) {
    // Matches names that start with "- -" or "---" patterns
    return /^[\s-]*-[\s-]+-/.test(name);
  }

  // Helper function to extract the parent section prefix for continuation sections
  // e.g., "2: Dies Irae - Tuba Mirum" -> "2: Dies Irae" (used when sub-sections follow)
  // e.g., "7: Libera Me (1)" -> "7: Libera Me" (strips trailing part numbers)
  // This extracts just the numbered section header without the first sub-section name
  extractParentSectionPrefix(name) {
    // First, strip trailing part numbers like "(1)" or "(2)"
    // e.g., "7: Libera Me (1)" -> "7: Libera Me"
    let cleaned = name.replace(/\s*\(\d+\)\s*$/, '').trim();

    // Match pattern like "N: Section Name" where N is a number (possibly with letters like "3a")
    // If followed by " - SubSection", extract just the "N: Section Name" part
    const match = cleaned.match(/^(\d+[a-z]?:\s*[^-]+?)\s+-\s+/i);
    if (match) {
      return match[1].trim();
    }

    // No " - " pattern found, return the cleaned name
    return cleaned;
  }

  // Helper function to extract the actual name from a continuation section
  // Handles multiple sub-movements that were on separate lines (separated by <br>)
  // e.g. "- - - - - - - - - Ingemisco, - - - - - - - - - Confutatis, - - - - - - - - - Lacrymosa"
  // becomes "Ingemisco, Confutatis, Lacrymosa"
  extractContinuationName(name) {
    // Split by the dash pattern (which appears before each sub-movement)
    // The pattern "- - - - - - - - -" or similar variations
    const parts = name.split(/\s*-\s+-\s+-\s+-\s+-\s+-\s+-\s+-\s+-\s*/)
      .map(part => part.trim())
      .filter(part => part.length > 0);

    if (parts.length > 1) {
      // Multiple sub-movements - join with comma if not already present
      return parts.map(p => p.replace(/,\s*$/, '')).join(', ');
    }

    // Single item - just remove leading dashes and spaces
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
          
          const rawComposerName = composerCell.text().trim();
          const composerName = this.normalizeComposerName(rawComposerName);

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
              // Get section name from the link text if a link exists, otherwise use full cell text
              // This avoids picking up extra text like "[ Choir 1 ]" that's outside the link
              const sectionLink = sectionNameCell.find('a').first();
              let sectionName = sectionLink.length > 0
                ? this.cleanWhitespace(sectionLink.text())
                : this.cleanWhitespace(sectionNameCell.text());

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
                  // Extract just the numbered prefix (e.g., "2: Dies Irae" from "2: Dies Irae - Tuba Mirum")
                  lastParentSection = this.extractParentSectionPrefix(sectionName);
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

      // Look for links to additional parts (Part 2, Part 3, next page, etc.)
      const additionalPartLinks = [];
      $('a').each((index, link) => {
        const $link = $(link);
        const linkText = $link.text().trim().toLowerCase();
        const linkHref = $link.attr('href');

        if (linkHref && linkHref !== '#') {
          // Look for patterns like "Part 2", "Part II", "Part 3", "next page", etc.
          const partPattern = /part\s*(\d+|[ivxIVX]+)/i;
          const nextPagePattern = /next\s*page/i;
          const isPartLink = partPattern.test(linkText);
          const isNextPageLink = nextPagePattern.test(linkText);

          // Also check if href contains part2, part3, etc. pattern (e.g., messiah2.html)
          const hrefPartPattern = /\d+\.html?$/i;
          const isHrefPartLink = hrefPartPattern.test(linkHref);

          if (isPartLink || isNextPageLink || (isHrefPartLink && linkText.includes('page'))) {
            // Convert relative URL to absolute
            let fullUrl = linkHref.startsWith('http') ? linkHref :
              linkHref.startsWith('/') ? `${this.baseUrl}${linkHref}` :
              `${workUrl.substring(0, workUrl.lastIndexOf('/'))}/${linkHref}`;

            // Avoid duplicates
            if (!additionalPartLinks.some(p => p.url === fullUrl)) {
              console.log(`Found link to additional part: "${linkText}" -> ${fullUrl}`);
              additionalPartLinks.push({ text: linkText, url: fullUrl });
            }
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
    const composerMap = new Map(); // Map composer name (lowercase) to index entry for merging

    // Helper to find or create a composer entry in the index
    const getOrCreateComposer = (composerName) => {
      const key = composerName.toLowerCase();
      if (composerMap.has(key)) {
        return composerMap.get(key);
      }
      const newComposer = {
        name: composerName,
        works: [],
        seenWorkNames: new Map() // Track work names to detect duplicates
      };
      completeIndex.push(newComposer);
      composerMap.set(key, newComposer);
      return newComposer;
    };

    for (const composer of filteredComposers) {
      console.log(`Processing composer: ${composer.name}`);
      const composerData = getOrCreateComposer(composer.name);

      // Track work names to detect duplicates within this composer
      const seenWorkNames = composerData.seenWorkNames;

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
    }

    // Clean up temporary seenWorkNames property before saving
    for (const composer of completeIndex) {
      delete composer.seenWorkNames;
    }

    // Now scrape and merge madrigals and carols (single songs)
    // Note: mergeSongsIntoIndex may add new composers, so we pass completeIndex
    console.log('\n--- Scraping madrigals and carols ---');
    await this.mergeSongsIntoIndex(completeIndex, exceptions, testMode);

    // Clean up seenWorkNames again (in case mergeSongsIntoIndex added new composers)
    for (const composer of completeIndex) {
      delete composer.seenWorkNames;
    }

    // Remove composers with no works
    const filteredIndex = completeIndex.filter(c => c.works.length > 0);

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
    await fs.writeJSON(this.dataFile, filteredIndex, { spaces: 2 });
    console.log(`Index saved to ${this.dataFile}`);
    console.log(`Total composers with works: ${filteredIndex.length}`);

    return filteredIndex;
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
    // Return cached index if available
    if (this.indexCache) {
      return this.indexCache;
    }

    try {
      // Try loading the full index first
      if (await fs.pathExists(this.dataFile)) {
        console.log('Loading full MIDI index...');
        const fullIndex = await fs.readJSON(this.dataFile);
        // If full index has data, cache and return it
        if (fullIndex && fullIndex.length > 0) {
          this.indexCache = fullIndex;
          return fullIndex;
        }
        console.log('Full index is empty, falling back to initial index...');
      }

      // Fallback to initial index (A composers only)
      if (await fs.pathExists(this.initialIndexFile)) {
        console.log('Loading initial MIDI index (A composers only)...');
        const initialIndex = await fs.readJSON(this.initialIndexFile);
        this.indexCache = initialIndex;
        return initialIndex;
      }

      console.log('No index file found');
    } catch (error) {
      console.error('Error loading index:', error.message);
    }
    return [];
  }

  /**
   * Clear the cached index, forcing a reload from disk on next access
   * Used after index rebuild to hot-reload the new index
   */
  clearCache() {
    this.indexCache = null;
    console.log('Index cache cleared - will reload from disk on next access');
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

    // Helper function to normalize text: lowercase, remove punctuation, collapse whitespace
    const normalizeText = (text) => {
      return text.toLowerCase()
        .replace(/[^\w\s]/g, ' ')  // Replace punctuation with spaces
        .replace(/\s+/g, ' ')       // Collapse multiple spaces
        .trim();
    };

    // Helper function to check if search phrase appears in text (words in order)
    // Each search term must match the start of a word, and terms must appear in sequence
    const matchesPhrase = (text) => {
      const normalizedText = normalizeText(text);
      const words = normalizedText.split(' ');

      // Find the first word that starts with the first search term
      for (let startIdx = 0; startIdx <= words.length - terms.length; startIdx++) {
        let matches = true;
        for (let termIdx = 0; termIdx < terms.length; termIdx++) {
          if (!words[startIdx + termIdx].startsWith(terms[termIdx])) {
            matches = false;
            break;
          }
        }
        if (matches) return true;
      }
      return false;
    };

    // Search through the index
    for (const composer of index) {
      let composerMatches = false;

      // Check composer name
      if (options.composers && matchesPhrase(composer.name)) {
        results.composers.push({
          name: composer.name
        });
        composerMatches = true;
      }

      // Check works
      if (options.works || options.movements) {
        for (const work of composer.works) {
          let workMatches = false;
          const isSingleSectionWork = work.sections && work.sections.length === 1 &&
                                       work.sections[0].name === work.name;

          // Check work name - but skip if it's a single-section work (to avoid duplicates with movements)
          if (options.works && !isSingleSectionWork && matchesPhrase(work.name)) {
            results.works.push({
              composer: composer.name,
              work: work.name
            });
            workMatches = true;
          }

          // Check if phrase matches across composer + work combination
          // Skip for single-section works to avoid duplicates
          if (options.works && !isSingleSectionWork && !workMatches && !composerMatches) {
            const combinedText = `${composer.name} ${work.name}`;
            if (matchesPhrase(combinedText)) {
              results.works.push({
                composer: composer.name,
                work: work.name
              });
              workMatches = true;
            }
          }

          // Check movements/sections - only match if search phrase is in the section name itself
          if (options.movements && work.sections) {
            for (const section of work.sections) {
              const sectionMatches = matchesPhrase(section.name);

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
    // Support both exact match and slug-style lookup (case-insensitive, hyphens = spaces)
    const composer = index.find(c =>
      c.name === composerName ||
      this.nameToSlug(c.name) === composerName.toLowerCase()
    );
    return composer ? composer.works : [];
  }

  /**
   * Convert a name to a URL-safe slug
   * @param {string} name - Name to convert
   * @returns {string} Slug version
   */
  nameToSlug(name) {
    return name.toLowerCase().replace(/\s+/g, '-');
  }

  /**
   * Resolve slugs to actual composer and work names
   * @param {string} composerSlug - Composer slug (lowercase, hyphenated)
   * @param {string} workSlug - Work slug (lowercase, hyphenated)
   * @returns {Promise<Object|null>} Object with composer and work names, or null if not found
   */
  async resolveSlug(composerSlug, workSlug) {
    const index = await this.loadIndex();
    const composer = index.find(c =>
      c.name === composerSlug ||
      this.nameToSlug(c.name) === composerSlug.toLowerCase()
    );
    if (!composer) return null;

    const work = composer.works.find(w =>
      w.name === workSlug ||
      this.nameToSlug(w.name) === workSlug.toLowerCase()
    );
    if (!work) return null;

    return {
      composer: composer.name,
      work: work.name
    };
  }

  /**
   * Get all sections/movements for a specific work
   * @param {string} composerName - Exact composer name or slug
   * @param {string} workName - Exact work name or slug
   * @returns {Promise<Array>} Array of sections with MIDI URLs
   * @example
   * const sections = await scraper.getWorkSections('Bach', 'Mass in B Minor');
   * // Returns: [{ name: "Kyrie", midiUrl: "/Bach/..." }, ...]
   */
  async getWorkSections(composerName, workName) {
    const index = await this.loadIndex();
    // Support both exact match and slug-style lookup
    const composer = index.find(c =>
      c.name === composerName ||
      this.nameToSlug(c.name) === composerName.toLowerCase()
    );
    if (!composer) return [];

    const work = composer.works.find(w =>
      w.name === workName ||
      this.nameToSlug(w.name) === workName.toLowerCase()
    );
    return work ? work.sections : [];
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

            const rawComposerName = this.cleanWhitespace(firstCell.text());
            const composerName = this.normalizeComposerName(rawComposerName);

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