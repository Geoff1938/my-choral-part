const axios = require('axios');
const cheerio = require('cheerio');
const fs = require('fs-extra');
const path = require('path');

class ChoralMusicScraper {
  constructor() {
    this.baseUrl = 'https://www.learnchoralmusic.co.uk';
    this.composerListUrl = `${this.baseUrl}/complist.html#list`;
    this.dataFile = path.join(__dirname, 'data', 'midi-index-full.json'); // Full index (all composers)
    this.initialIndexFile = path.join(__dirname, 'data', 'initial-index.json'); // Initial index (A composers only)
    this.recentWorksFile = path.join(__dirname, 'data', 'recent-works.json');
  }

  // Helper function to convert absolute URL to relative (removes base URL)
  toRelativeUrl(absoluteUrl) {
    if (absoluteUrl.startsWith(this.baseUrl)) {
      return absoluteUrl.substring(this.baseUrl.length);
    }
    return absoluteUrl;
  }

  async initializeDataDirectory() {
    await fs.ensureDir(path.dirname(this.dataFile));
  }

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
      const response = await axios.get(this.composerListUrl);
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

  async scrapeWorkSections(workUrl, visitedUrls = new Set()) {
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

      const response = await axios.get(fullUrl);
      const $ = cheerio.load(response.data);

      const sections = [];

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

          // Process data rows (skip header row)
          $table.find('tr').slice(headerRowIndex + 1).each((rowIndex, row) => {
            const $row = $(row);
            const cells = $row.find('td, th');

            if (cells.length > unemphasizedColumnIndex) {
              const sectionNameCell = cells.first();
              const sectionName = sectionNameCell.text().trim();

              if (sectionName && sectionName !== '') {
                const midiCell = cells.eq(unemphasizedColumnIndex);

                console.log(`Section "${sectionName}" - MIDI cell content: "${midiCell.text().trim()}"`);

                // Look for any link in the MIDI cell
                const midiLink = midiCell.find('a').first();

                if (midiLink.length > 0) {
                  const midiUrl = midiLink.attr('href');
                  console.log(`Found MIDI link: ${midiUrl}`);
                  if (midiUrl && midiUrl !== '#') {
                    // Convert relative URL to absolute first
                    const fullMidiUrl = midiUrl.startsWith('http') ? midiUrl :
                      midiUrl.startsWith('/') ? `${this.baseUrl}${midiUrl}` :
                      `${workUrl.substring(0, workUrl.lastIndexOf('/'))}/${midiUrl}`;

                    // Store as relative URL to save space
                    sections.push({
                      name: sectionName,
                      midiUrl: this.toRelativeUrl(fullMidiUrl)
                    });
                    console.log(`Added section: ${sectionName} -> ${this.toRelativeUrl(fullMidiUrl)}`);
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
        await new Promise(resolve => setTimeout(resolve, 500)); // Be respectful
        const additionalSections = await this.scrapeWorkSections(partLink.url, visitedUrls);
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
      
      for (const work of composer.works) {
        console.log(`  Processing work: ${work.name}`);
        const sections = await this.scrapeWorkSections(work.url);
        
        if (sections.length > 0) {
          composerData.works.push({
            name: work.name,
            url: work.url,
            sections: sections
          });
        }
        
        // Add a small delay to be respectful to the server
        await new Promise(resolve => setTimeout(resolve, 500));
      }
      
      if (composerData.works.length > 0) {
        completeIndex.push(composerData);
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

  async loadIndex() {
    try {
      // Try loading the full index first
      if (await fs.pathExists(this.dataFile)) {
        console.log('Loading full MIDI index...');
        return await fs.readJSON(this.dataFile);
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

  async searchComposers(searchTerm) {
    const index = await this.loadIndex();
    const searchLower = searchTerm.toLowerCase();

    return index.filter(composer =>
      composer.name.toLowerCase().includes(searchLower)
    );
  }

  // Advanced search that matches word beginnings only and searches across multiple categories
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

          // Check movements/sections
          if (options.movements && work.sections) {
            for (const section of work.sections) {
              const sectionMatches = matchesAllTerms(section.name);
              const combinedWithWork = matchesAllTerms(`${work.name} ${section.name}`);
              const combinedWithComposer = matchesAllTerms(`${composer.name} ${section.name}`);
              const combinedAll = matchesAllTerms(`${composer.name} ${work.name} ${section.name}`);

              if (sectionMatches || combinedWithWork || combinedWithComposer || combinedAll) {
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

  async getComposerWorks(composerName) {
    const index = await this.loadIndex();
    const composer = index.find(c => c.name === composerName);
    return composer ? composer.works : [];
  }

  async getWorkSections(composerName, workName) {
    const index = await this.loadIndex();
    const composer = index.find(c => c.name === composerName);
    if (!composer) return [];
    
    const work = composer.works.find(w => w.name === workName);
    return work ? work.sections : [];
  }

  async saveRecentWork(composerName, workName) {
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
    recentWorks.unshift({
      composer: composerName,
      work: workName,
      timestamp: new Date().toISOString()
    });
    
    // Keep only last 5
    recentWorks = recentWorks.slice(0, 5);
    
    await fs.writeJSON(this.recentWorksFile, recentWorks, { spaces: 2 });
    return recentWorks;
  }

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
}

module.exports = ChoralMusicScraper;