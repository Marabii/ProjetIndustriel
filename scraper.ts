import puppeteer, { Browser, Page } from "puppeteer";
import * as fs from "fs";
import * as XLSX from "xlsx";
import * as readline from "readline";

interface Config {
  profiles: string[];
  selectors: {
    experience: {
      experienceItem: string;
      jobTitle: string;
      details: string;
      description: string;
    };
    education: {
      educationItem: string;
      institution: string;
      details: string;
    };
  };
  outputFile: string;
}

interface ExperienceData {
  "Profil": string;
  "Titre du poste": string;
  "Entreprise et type d'emploi": string;
  "Dates et durée": string;
  "Lieu": string;
  "Description": string;
  "Compétences": string;
}

interface EducationData {
  "Profil": string;
  "Établissement": string;
  "Diplôme": string;
  "Durée": string;
}

let scrapingEnabled = false;

// Helper function for delays
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// Load configuration
function loadConfig(): Config {
  const configFile = fs.readFileSync("./config.json", "utf-8");
  return JSON.parse(configFile);
}

// Setup keyboard listener for F9
function setupKeyboardListener() {
  if (process.stdin.isTTY) {
    readline.emitKeypressEvents(process.stdin);
    process.stdin.setRawMode(true);
  }

  process.stdin.on("keypress", (_str, key) => {
    if (key.name === "f9") {
      console.log("\n[INFO] F9 detected! Starting scraping...");
      scrapingEnabled = true;
    }
    if (key.ctrl && key.name === "c") {
      process.exit();
    }
  });
}

// Check if an experience item has children of the same type
async function hasChildrenOfSameType(
  element: any,
  selector: string
): Promise<boolean> {
  const children = await element.$$(selector);
  return children.length > 0;
}

// Check if an element is a child of another element with the same selector
async function isChildElement(
  page: Page,
  element: any,
  selector: string
): Promise<boolean> {
  const isChild = await page.evaluate(
    (el, sel) => {
      // Check if any parent element matches the selector
      let parent = el.parentElement;
      while (parent) {
        if (parent.matches(sel)) {
          return true;
        }
        parent = parent.parentElement;
      }
      return false;
    },
    element,
    selector
  );
  return isChild;
}

// Scrape experience from a single profile
async function scrapeExperience(
  page: Page,
  profileUrl: string,
  config: Config
): Promise<ExperienceData[]> {
  const experienceData: ExperienceData[] = [];

  // Navigate to experience page
  const experienceUrl = profileUrl + "/details/experience";
  console.log(`[INFO] Navigating to: ${experienceUrl}`);

  await page.goto(experienceUrl, { waitUntil: "domcontentloaded", timeout: 60000 });

  // Wait a bit for dynamic content to load
  await delay(3000);

  // Get all experience items
  const experienceItems = await page.$$(config.selectors.experience.experienceItem);
  console.log(`[INFO] Found ${experienceItems.length} experience items`);

  for (let i = 0; i < experienceItems.length; i++) {
    const item = experienceItems[i];

    // Check if this item is a child of another experience item
    const isChild = await isChildElement(
      page,
      item,
      config.selectors.experience.experienceItem
    );

    if (isChild) {
      console.log(`[INFO] Skipping experience item ${i + 1} (is a child element)`);
      continue;
    }

    // Check if this item has children of the same type (case 2)
    const hasChildren = await hasChildrenOfSameType(
      item,
      config.selectors.experience.experienceItem
    );

    if (hasChildren) {
      console.log(`[INFO] Skipping experience item ${i + 1} (has children)`);
      continue;
    }

    try {
      // Extract job title
      const jobTitleElement = await item.$(
        config.selectors.experience.jobTitle.replace(
          config.selectors.experience.experienceItem + " ",
          ""
        )
      );
      const jobTitle = jobTitleElement
        ? await page.evaluate(
            (el) => el.textContent?.trim() || "",
            jobTitleElement
          )
        : "";

      // Extract details (company, dates, location)
      const detailsSelector = config.selectors.experience.details;
      const detailsElements = await item.$$(
        detailsSelector
          .replace(config.selectors.experience.experienceItem + " ", "")
          .split(" > ")[0] +
          " > " +
          detailsSelector.split(" > ").slice(1).join(" > ")
      );

      let companyAndType = "";
      let datesAndDuration = "";
      let location = "";

      if (detailsElements.length >= 3) {
        companyAndType = await page.evaluate(
          (el) => el.textContent?.trim() || "",
          detailsElements[0]
        );
        datesAndDuration = await page.evaluate(
          (el) => el.textContent?.trim() || "",
          detailsElements[1]
        );
        location = await page.evaluate(
          (el) => el.textContent?.trim() || "",
          detailsElements[2]
        );
      }

      // Extract description and skills
      const descriptionSelector = config.selectors.experience.description.replace(
        config.selectors.experience.experienceItem + " ",
        ""
      );
      const descriptionElements = await item.$$(descriptionSelector);

      let description = "null";
      let skills = "null";

      if (descriptionElements.length === 0) {
        // No elements found
        description = "null";
        skills = "null";
      } else if (descriptionElements.length === 1) {
        // Only one element, assume it's skills
        skills = await page.evaluate(
          (el) => el.textContent?.trim() || "",
          descriptionElements[0]
        );
        description = "null";
      } else if (descriptionElements.length >= 2) {
        // Two elements: first is description, second is skills
        description = await page.evaluate(
          (el) => el.textContent?.trim() || "",
          descriptionElements[0]
        );
        skills = await page.evaluate(
          (el) => el.textContent?.trim() || "",
          descriptionElements[1]
        );
      }

      experienceData.push({
        "Profil": profileUrl,
        "Titre du poste": jobTitle,
        "Entreprise et type d'emploi": companyAndType,
        "Dates et durée": datesAndDuration,
        "Lieu": location,
        "Description": description,
        "Compétences": skills,
      });

      console.log(`[INFO] Extracted experience ${i + 1}: ${jobTitle}`);
    } catch (error) {
      console.error(
        `[ERROR] Failed to extract experience item ${i + 1}:`,
        error
      );
    }
  }

  return experienceData;
}

// Scrape education from a single profile
async function scrapeEducation(page: Page, profileUrl: string, config: Config): Promise<EducationData[]> {
  const educationData: EducationData[] = [];

  // Navigate to education page
  const educationUrl = profileUrl + "/details/education";
  console.log(`[INFO] Navigating to: ${educationUrl}`);

  await page.goto(educationUrl, { waitUntil: "domcontentloaded", timeout: 60000 });

  // Wait a bit for dynamic content to load
  await delay(3000);

  // Get all education items
  const educationItems = await page.$$(config.selectors.education.educationItem);
  console.log(`[INFO] Found ${educationItems.length} education items`);

  for (let i = 0; i < educationItems.length; i++) {
    const item = educationItems[i];

    try {
      // Extract institution
      const institutionElement = await item.$(
        config.selectors.education.institution.replace(
          config.selectors.education.educationItem + " ",
          ""
        )
      );
      const institution = institutionElement
        ? await page.evaluate((el) => el.textContent?.trim() || "", institutionElement)
        : "";

      // Extract diploma and duration
      const detailsSelector = config.selectors.education.details;
      const detailsElements = await item.$$(
        detailsSelector
          .replace(config.selectors.education.educationItem + " ", "")
          .split(" > ")[0] +
          " > " +
          detailsSelector.split(" > ").slice(1).join(" > ")
      );

      let diploma = "";
      let duration = "";

      if (detailsElements.length >= 1) {
        diploma = await page.evaluate((el) => el.textContent?.trim() || "", detailsElements[0]);
      }
      if (detailsElements.length >= 2) {
        duration = await page.evaluate((el) => el.textContent?.trim() || "", detailsElements[1]);
      }

      educationData.push({
        "Profil": profileUrl,
        "Établissement": institution,
        "Diplôme": diploma,
        "Durée": duration,
      });

      console.log(`[INFO] Extracted education ${i + 1}: ${institution}`);
    } catch (error) {
      console.error(`[ERROR] Failed to extract education item ${i + 1}:`, error);
    }
  }

  return educationData;
}

// Export data to Excel
function exportToExcel(experienceData: ExperienceData[], educationData: EducationData[], outputFile: string) {
  const workbook = XLSX.utils.book_new();

  // Create experience sheet
  if (experienceData.length > 0) {
    const experienceSheet = XLSX.utils.json_to_sheet(experienceData);
    XLSX.utils.book_append_sheet(workbook, experienceSheet, "Expérience");
  }

  // Create education sheet
  if (educationData.length > 0) {
    const educationSheet = XLSX.utils.json_to_sheet(educationData);
    XLSX.utils.book_append_sheet(workbook, educationSheet, "Éducation");
  }

  // Write to file
  XLSX.writeFile(workbook, outputFile);
  console.log(`[INFO] Data exported to ${outputFile}`);
}

// Main function
async function main() {
  console.log("[INFO] LinkedIn Scraper Starting...");

  // Load configuration
  const config = loadConfig();
  console.log(`[INFO] Loaded ${config.profiles.length} profiles from config`);

  // Launch browser
  const browser: Browser = await puppeteer.launch({
    headless: false,
    defaultViewport: null,
    args: ["--start-maximized"],
  });

  const page: Page = await browser.newPage();

  // Navigate to LinkedIn
  await page.goto("https://www.linkedin.com", { waitUntil: "domcontentloaded" });

  console.log("\n===========================================");
  console.log("[INFO] Please log in to your LinkedIn account");
  console.log("[INFO] After logging in, press F9 to start scraping");
  console.log("===========================================\n");

  // Setup keyboard listener
  setupKeyboardListener();

  // Wait for user to trigger scraping
  while (!scrapingEnabled) {
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  // Start scraping
  const allExperienceData: ExperienceData[] = [];
  const allEducationData: EducationData[] = [];

  for (const profileUrl of config.profiles) {
    console.log(`\n[INFO] Processing profile: ${profileUrl}`);

    // Scrape experience
    try {
      const experienceData = await scrapeExperience(page, profileUrl, config);
      allExperienceData.push(...experienceData);
      console.log(
        `[INFO] Extracted ${experienceData.length} experience items from this profile`
      );
    } catch (error) {
      console.error(`[ERROR] Failed to scrape experience from ${profileUrl}:`, error);
    }

    // Small delay between sections
    await delay(2000);

    // Scrape education
    try {
      const educationData = await scrapeEducation(page, profileUrl, config);
      allEducationData.push(...educationData);
      console.log(
        `[INFO] Extracted ${educationData.length} education items from this profile`
      );
    } catch (error) {
      console.error(`[ERROR] Failed to scrape education from ${profileUrl}:`, error);
    }

    // Small delay between profiles
    await delay(2000);
  }

  // Export data
  if (allExperienceData.length > 0 || allEducationData.length > 0) {
    exportToExcel(allExperienceData, allEducationData, config.outputFile);
    console.log(
      `\n[SUCCESS] Scraping complete! Total experiences: ${allExperienceData.length}, Total education: ${allEducationData.length}`
    );
  } else {
    console.log("\n[WARNING] No data was extracted");
  }

  // Close browser
  await browser.close();
  process.exit(0);
}

// Run the scraper
main().catch(console.error);
