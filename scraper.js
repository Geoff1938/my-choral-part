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

  async initializeDataDirectory() {
    await fs.ensureDir(path.dirname(this.dataFile));
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
                // Convert relative URL to absolute
                const fullWorkUrl = workUrl.startsWith('http') ? workUrl : `${this.baseUrl}/${workUrl}`;
                works.push({
                  name: workName,
                  url: fullWorkUrl
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

  async scrapeWorkSections(workUrl) {
    try {
      console.log(`Scraping work: ${workUrl}`);
      const response = await axios.get(workUrl);
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
                    // Convert relative URL to absolute
                    const fullMidiUrl = midiUrl.startsWith('http') ? midiUrl :
                      midiUrl.startsWith('/') ? `${this.baseUrl}${midiUrl}` :
                      `${workUrl.substring(0, workUrl.lastIndexOf('/'))}/${midiUrl}`;

                    sections.push({
                      name: sectionName,
                      midiUrl: fullMidiUrl
                    });
                    console.log(`Added section: ${sectionName} -> ${fullMidiUrl}`);
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
      
      console.log(`Found ${sections.length} sections with MIDI files`);
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