const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');
const readline = require('readline');

// Global control variables
let scraperStarted = false;
let scraperStopped = false;

// Load configuration
function loadConfig(configPath) {
  const configFile = fs.readFileSync(configPath, 'utf-8');
  return JSON.parse(configFile);
}

// Setup keyboard listener
function setupKeyboardListener() {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: true
  });

  // Enable raw mode to capture single key presses
  if (process.stdin.isTTY) {
    process.stdin.setRawMode(true);
  }
  process.stdin.resume();
  process.stdin.setEncoding('utf8');

  process.stdin.on('data', (char) => {
    const key = char.toString();
    if (key.toLowerCase() === 's') {
      if (!scraperStarted) {
        scraperStarted = true;
        console.log('\n⏱️  Starting scraper...\n');
      } else {
        scraperStopped = true;
        console.log('\n⛔ Stopping scraper...\n');
      }
    }
    if (key === '\u0003' || key === '\u001B') { // Ctrl+C or Escape
      process.exit();
    }
  });
}

// Scrape experience data
async function scrapeExperience(page, config) {
  const selectors = config.selectors;
  const experiences = [];

  try {
    // Get all experience items
    const experienceItems = await page.$$(selectors.experienceItem);
    console.log(`Found ${experienceItems.length} experience items`);

    for (let idx = 0; idx < experienceItems.length; idx++) {
      if (scraperStopped) {
        console.log('Scraping stopped by user.');
        break;
      }

      const item = experienceItems[idx];
      const experienceData = {
        index: idx,
        role: null,
        company: null,
        position: null,
        duration: null,
        location: null,
        description: null,
        skills: null,
        has_children: false
      };

      try {
        // Check if this experience has children of the same type
        const children = await item.$$(selectors.experienceItem);
        if (children.length > 1) {
          experienceData.has_children = true;
          console.log(`Experience ${idx}: Skipping - has children components`);
          continue;
        }

        // Get role
        try {
          const roleElem = await item.$(selectors.role);
          if (roleElem) {
            const roleText = await page.evaluate((el) => el.textContent.trim(), roleElem);
            experienceData.role = roleText;
            console.log(`Experience ${idx}: Role = ${roleText}`);
          }
        } catch (e) {
          console.log(`Experience ${idx}: Error getting role - ${e.message}`);
        }

        // Get company, position, duration, and location
        try {
          const detailElems = await item.$$(selectors.companyAndDetails);
          const detailsText = [];

          for (const detailElem of detailElems) {
            const text = await page.evaluate((el) => el.textContent.trim(), detailElem);
            if (text) {
              detailsText.push(text);
            }
          }

          console.log(`Experience ${idx}: Found ${detailsText.length} detail elements`);

          if (detailsText.length >= 1) {
            const companyInfo = detailsText[0];
            const parts = companyInfo.split(' · ');
            if (parts.length >= 2) {
              experienceData.company = parts[0].trim();
              experienceData.position = parts[1].trim();
            } else {
              experienceData.company = companyInfo;
              experienceData.position = null;
            }
            console.log(`  Company: ${experienceData.company}, Position: ${experienceData.position}`);
          }

          if (detailsText.length >= 2) {
            experienceData.duration = detailsText[1];
            console.log(`  Duration: ${experienceData.duration}`);
          }

          if (detailsText.length >= 3) {
            experienceData.location = detailsText[2];
            console.log(`  Location: ${experienceData.location}`);
          }
        } catch (e) {
          console.log(`Experience ${idx}: Error getting company/position/duration/location - ${e.message}`);
        }

        // Get description and skills
        try {
          const skillDescElems = await item.$$(selectors.skills_and_description);
          const skillDescText = [];

          for (const elem of skillDescElems) {
            const text = await page.evaluate((el) => el.textContent.trim(), elem);
            if (text) {
              skillDescText.push(text);
            }
          }

          console.log(`Experience ${idx}: Found ${skillDescText.length} skill/description elements`);

          if (skillDescText.length === 0) {
            experienceData.description = null;
            experienceData.skills = null;
          } else if (skillDescText.length === 1) {
            // Single element is assumed to be skills
            experienceData.description = null;
            experienceData.skills = skillDescText[0];
            console.log(`  Skills: ${skillDescText[0]}`);
          } else {
            // First is description, last is skills
            experienceData.description = skillDescText[0];
            experienceData.skills = skillDescText[skillDescText.length - 1];
            console.log(`  Description: ${skillDescText[0]}`);
            console.log(`  Skills: ${skillDescText[skillDescText.length - 1]}`);
          }
        } catch (e) {
          console.log(`Experience ${idx}: Error getting skills/description - ${e.message}`);
        }

        experiences.push(experienceData);
      } catch (e) {
        console.log(`Experience ${idx}: Error processing item - ${e.message}`);
        experiences.push(experienceData);
      }
    }
  } catch (e) {
    console.log(`Error scraping experience: ${e.message}`);
  }

  return experiences;
}

// Launch browser and load all URLs
async function launchBrowserAndLoadUrls(config) {
  try {
    console.log('\n🌐 Launching browser (headless: ' + config.options.headless + ')...');
    const browser = await puppeteer.launch({
      headless: config.options.headless !== false,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
    });
    console.log('✓ Browser launched successfully!');

    // Load all URLs
    const pages = {};
    for (const url of config.urls) {
      try {
        console.log(`\n🔗 Navigating to: ${url}`);
        const page = await browser.newPage();
        await page.setViewport({ width: 1920, height: 1080 });

        try {
          await Promise.race([
            page.goto(url, { waitUntil: 'networkidle2' }),
            new Promise((_, reject) =>
              setTimeout(() => reject(new Error('Navigation timeout')), 30000)
            )
          ]);
          console.log('✓ Page loaded successfully');
        } catch (e) {
          console.log(`⚠️  Navigation timeout - continuing anyway...`);
        }

        // Wait a bit for dynamic content to load
        console.log('⏳ Waiting for dynamic content to load...');
        await new Promise(resolve => setTimeout(resolve, 3000));
        console.log('✓ Content loaded\n');

        pages[url] = page;
      } catch (e) {
        console.log(`Error loading ${url}: ${e.message}`);
      }
    }

    return { browser, pages };
  } catch (e) {
    console.error(`Failed to launch browser: ${e.message}`);
    throw e;
  }
}

// Scrape a loaded page
async function scrapeProfile(page, url, config) {
  try {
    const experiences = await scrapeExperience(page, config);

    return {
      url: url,
      success: true,
      experiences: experiences,
      total_experiences: experiences.length,
      error: null
    };
  } catch (e) {
    console.log(`Error scraping ${url}: ${e.message}`);
    return {
      url: url,
      success: false,
      experiences: [],
      total_experiences: 0,
      error: e.message
    };
  }
}

// Wait for start signal
async function waitForStart() {
  return new Promise((resolve) => {
    const checkInterval = setInterval(() => {
      if (scraperStarted) {
        clearInterval(checkInterval);
        resolve();
      }
    }, 100);
  });
}

// Main function
async function main() {
  const scriptDir = path.dirname(__filename);
  const configPath = path.join(scriptDir, 'config.json');
  const resultsPath = path.join(scriptDir, 'results.json');

  console.log('\n📋 Loading configuration...');
  const config = loadConfig(configPath);
  console.log('✓ Configuration loaded');
  console.log(`  URLs: ${config.urls.length}`);
  console.log(`  Headless mode: ${config.options.headless}`);

  // Launch browser and load all URLs
  let browser = null;
  let pages = null;
  try {
    const result = await launchBrowserAndLoadUrls(config);
    browser = result.browser;
    pages = result.pages;
  } catch (e) {
    console.error('Failed to launch browser. Exiting...');
    process.exit(1);
  }

  // Setup keyboard listener
  console.log('\n🎧 Setting up keyboard listener...');
  setupKeyboardListener();
  console.log('✓ Keyboard listener ready\n');
  console.log('╔════════════════════════════════════════╗');
  console.log('║  Press "s" to START scraping         ║');
  console.log('║  Press "s" again to STOP scraping    ║');
  console.log('╚════════════════════════════════════════╝\n');

  // Wait for user to press 's'
  await waitForStart();

  const allResults = {
    scraped_at: new Date().toISOString(),
    total_profiles: config.urls.length,
    profiles: []
  };

  // Scrape all loaded URLs
  for (const url of config.urls) {
    if (scraperStopped) {
      console.log('Scraping stopped by user.');
      break;
    }

    const page = pages[url];
    if (!page) {
      console.log(`Warning: No page found for ${url}`);
      continue;
    }

    const result = await scrapeProfile(page, url, config);
    allResults.profiles.push(result);
  }

  // Close browser
  await browser.close();
  console.log('\n🔌 Browser closed');

  // Save results
  console.log(`\n💾 Saving results to ${resultsPath}...`);
  fs.writeFileSync(resultsPath, JSON.stringify(allResults, null, 2), 'utf-8');

  console.log('✓ Results saved successfully!');

  // Print summary
  console.log('\n╔════════════════════════════════════════╗');
  console.log('║            SCRAPING SUMMARY            ║');
  console.log('╚════════════════════════════════════════╝');
  for (const profile of allResults.profiles) {
    console.log(`\n📍 URL: ${profile.url}`);
    console.log(`   Status: ${profile.success ? '✓ Success' : '✗ Failed'}`);
    console.log(`   Experiences found: ${profile.total_experiences}`);
    if (!profile.success) {
      console.log(`   Error: ${profile.error}`);
    }
  }

  console.log('\n✓ Scraping complete!\n');
  process.exit(0);
}

// Run main function
main().catch((e) => {
  console.error(`Fatal error: ${e.message}`);
  process.exit(1);
});
