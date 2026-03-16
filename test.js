import puppeteer from 'puppeteer';

(async () => {
  const browser = await puppeteer.launch({ headless: 'new' });
  const page = await browser.newPage();
  
  page.on('console', msg => console.log('PAGE LOG:', msg.text()));
  page.on('pageerror', error => console.log('PAGE ERROR:', error.message));

  console.log("Navigating to localhost:3000...");
  await page.goto('http://localhost:3000');
  
  console.log("Waiting for location button...");
  await page.waitForSelector('button');
  
  // Wait a bit to ensure JS is ready
  await new Promise(r => setTimeout(r, 2000));
  
  // Trigger a fake location load directly in DOM if we can't click the GPS button because it's blocked.
  // We'll just type "Roma" in the search input
  console.log("Typing Roma...");
  await page.type('input[placeholder="Inserisci una città o un paese..."]', 'Roma');
  await page.keyboard.press('Enter');
  
  console.log("Waiting for Segnala un mistero qui...");
  await page.waitForFunction(() => document.body.innerText.includes('Segnala un mistero qui'), { timeout: 10000 });
  
  console.log("Clicking Segnala un mistero qui...");
  const buttons = await page.$$('button');
  for (const b of buttons) {
    const text = await page.evaluate(el => el.textContent, b);
    if (text.includes('Segnala un mistero qui')) {
      await b.click();
      break;
    }
  }
  
  console.log("Filling form...");
  await page.waitForFunction(() => document.body.innerText.includes('Invia Segnalazione'), { timeout: 5000 });
  
  const inputs = await page.$$('input');
  await inputs[2].type('Test Mistery'); // First input is search, second range, third title
  
  const textarea = await page.$('textarea');
  await textarea.type('Test Description');
  
  console.log("Submitting...");
  const submitBtns = await page.$$('button');
  for (const b of submitBtns) {
    const text = await page.evaluate(el => el.textContent, b);
    if (text.includes('Invia Segnalazione')) {
      await b.click();
      break;
    }
  }
  
  console.log("Waiting for 3 seconds to catch errors...");
  await new Promise(r => setTimeout(r, 3000));
  
  await browser.close();
})();
